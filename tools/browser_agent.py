"""Vision-driven browser agent for Eva.

A closed loop: screenshot -> multimodal model -> structured action JSON ->
Playwright executes -> new screenshot -> repeat. The action schema is Eva's own
(not a vendor format), and every step is logged as JSONL plus a PNG so the
trajectories can be used to fine-tune a future in-house policy model.

Two roles:
  - Director (text only): high level planner. Wired by the bridge to Claude
    Opus 4.8 via ACP. Sees a text state summary, sets the current subgoal. It
    never sees pixels because the ACP prompt path is text only.
  - Executor (vision): looks at the screenshot and emits the next concrete
    action. Defaults to an OpenAI vision model (gpt-4o or better).

Playwright is imported lazily so a missing install never breaks bridge import.
"""

import os
import re
import json
import time
import base64
import threading
import uuid
from datetime import datetime, timezone

_TRAJ_DIR = os.path.expanduser("~/.config/eva-standalone/browser_trajectories")
_VIEWPORT = {"width": 1280, "height": 800}
_DEFAULT_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o")
_MAX_STEPS_DEFAULT = 25
_DIRECTOR_INTERVAL = 4  # re-consult the director every N executor steps

# Actions or element text matching this pattern require confirmation when
# autonomy == "pause". Navigation to a new registrable domain is also gated.
_SENSITIVE_RE = re.compile(
    r"\b(buy|purchase|place\s+order|order\s+now|add\s+to\s+cart|pay|payment|"
    r"checkout|complete\s+(?:order|purchase)|submit(?:\s+order)?|"
    r"confirm\s+(?:order|purchase|payment)|log\s*in|sign\s*in|password|"
    r"delete\s+account|transfer\s+(?:money|funds)|wire\b)",
    re.I,
)

_ACTION_KINDS = {
    "click", "double_click", "type", "press", "scroll",
    "navigate", "wait", "done", "ask",
}

# run_id -> run record (see _new_run). Guarded by _runs_lock.
_runs = {}
_runs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------

def playwright_available():
    """Return (ok, detail). Lazy import so the bridge never fails to load."""
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception as e:
        return False, f"playwright not installed: {e}"
    return True, "ok"


# ---------------------------------------------------------------------------
# Run registry
# ---------------------------------------------------------------------------

def _new_run(goal):
    run_id = uuid.uuid4().hex[:16]
    rec = {
        "id": run_id,
        "goal": goal,
        "status": "starting",        # starting|running|awaiting_confirmation|awaiting_input|done|cancelled|error
        "step": 0,
        "url": "",
        "title": "",
        "subgoal": "",
        "result": None,
        "error": None,
        "pending_action": None,      # action waiting for confirmation
        "pending_question": None,    # question waiting for user input
        "last_screenshot": None,
        "started": datetime.now(timezone.utc).isoformat(),
        "finished": None,
        "steps": [],                 # compact per-step log for status polling
        # threading primitives (never serialized)
        "_cancel": threading.Event(),
        "_gate": threading.Event(),  # set when a parked run may proceed
        "_decision": None,           # bool for confirm; str for input
        "_thread": None,
    }
    with _runs_lock:
        _runs[run_id] = rec
    return rec


def public_status(run_id):
    """Serializable status snapshot, or None if unknown."""
    with _runs_lock:
        rec = _runs.get(run_id)
        if not rec:
            return None
        return {
            k: rec[k] for k in (
                "id", "goal", "status", "step", "url", "title", "subgoal",
                "result", "error", "pending_action", "pending_question",
                "last_screenshot", "started", "finished", "steps",
            )
        }


def cancel(run_id):
    with _runs_lock:
        rec = _runs.get(run_id)
    if not rec:
        return False
    rec["_cancel"].set()
    rec["_gate"].set()  # unblock if parked
    return True


def resolve(run_id, approve=True, text=""):
    """Resolve a parked run. For confirmation, approve gates a sensitive action.
    For an input request, text supplies the answer."""
    with _runs_lock:
        rec = _runs.get(run_id)
    if not rec:
        return False
    if rec["status"] == "awaiting_confirmation":
        rec["_decision"] = bool(approve)
    elif rec["status"] == "awaiting_input":
        rec["_decision"] = text or ""
    else:
        return False
    rec["_gate"].set()
    return True


# ---------------------------------------------------------------------------
# Vision executor (OpenAI multimodal)
# ---------------------------------------------------------------------------

_EXECUTOR_SYSTEM = (
    "You are the executor for a web browsing agent. You see a screenshot of a "
    f"Chromium viewport that is exactly {_VIEWPORT['width']}x{_VIEWPORT['height']} "
    "pixels, origin top-left. Decide the SINGLE next action to make progress on "
    "the current subgoal. Reply with ONE JSON object and nothing else.\n\n"
    "Schema (pick one action):\n"
    '  {"action":"click","x":<int>,"y":<int>,"reason":"<intent>"}\n'
    '  {"action":"double_click","x":<int>,"y":<int>,"reason":"..."}\n'
    '  {"action":"type","text":"<text>","reason":"..."}   (types into the focused field; click it first)\n'
    '  {"action":"press","key":"<Enter|Tab|Escape|ArrowDown|...>","reason":"..."}\n'
    '  {"action":"scroll","dy":<int>,"reason":"..."}      (positive scrolls down)\n'
    '  {"action":"navigate","url":"<absolute url>","reason":"..."}\n'
    '  {"action":"wait","ms":<int>,"reason":"..."}\n'
    '  {"action":"ask","question":"<what you need from the user>"}\n'
    '  {"action":"done","summary":"<what was accomplished>"}\n\n'
    "Rules: coordinates are absolute pixels in the viewport. Put the real intent "
    "of the action in reason (for example 'click the Add to Cart button') so it "
    "can be reviewed. Prefer clicking visible controls over guessing URLs. Emit "
    "done only when the goal is fully achieved. Emit ask when you are blocked or "
    "need information only the user has. Never output prose outside the JSON."
)


def _b64_png(data):
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _call_executor(api_key, model, goal, subgoal, history, url, title, png_bytes):
    """Ask the vision model for the next action. Returns (action_dict, raw_text)."""
    import requests as _req

    hist_lines = []
    for h in history[-8:]:
        a = h.get("action", {})
        hist_lines.append(f"step {h.get('step')}: {json.dumps(a)} -> {h.get('result','')}")
    history_text = "\n".join(hist_lines) if hist_lines else "(none yet)"

    user_text = (
        f"GOAL: {goal}\n"
        f"CURRENT SUBGOAL: {subgoal or goal}\n"
        f"CURRENT URL: {url}\n"
        f"PAGE TITLE: {title}\n"
        f"RECENT ACTIONS:\n{history_text}\n\n"
        "Return the next action JSON."
    )

    payload = {
        "model": model,
        "max_tokens": 400,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": _EXECUTOR_SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": _b64_png(png_bytes)}},
            ]},
        ],
    }
    resp = _req.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"vision model {resp.status_code}: {resp.text[:200]}")
    raw = resp.json()["choices"][0]["message"]["content"] or ""
    return _parse_action(raw), raw


def _parse_action(raw):
    """Extract the first JSON object from the model output and validate it."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return {"action": "ask", "question": "Model returned no actionable JSON."}
    try:
        action = json.loads(text[start:end + 1])
    except Exception:
        return {"action": "ask", "question": "Model returned malformed action JSON."}
    if action.get("action") not in _ACTION_KINDS:
        return {"action": "ask", "question": f"Unknown action: {action.get('action')!r}."}
    return action


# ---------------------------------------------------------------------------
# Sensitivity
# ---------------------------------------------------------------------------

def _registrable(url):
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
    except Exception:
        host = ""
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _is_sensitive(action, element_text, current_url):
    kind = action.get("action")
    probe = " ".join(str(action.get(k, "")) for k in ("reason", "text", "question"))
    probe += " " + (element_text or "")
    if _SENSITIVE_RE.search(probe):
        return True
    if kind == "navigate":
        dest = _registrable(action.get("url", ""))
        cur = _registrable(current_url)
        if dest and cur and dest != cur:
            return True
    return False


# ---------------------------------------------------------------------------
# Trajectory logging
# ---------------------------------------------------------------------------

def _run_dir(run_id):
    d = os.path.join(_TRAJ_DIR, run_id)
    os.makedirs(d, exist_ok=True)
    return d


def _log_step(run_id, record):
    try:
        path = os.path.join(_run_dir(run_id), "trajectory.jsonl")
        with open(path, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        print(f"[BrowserAgent] log write failed: {e}")


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def _park(rec, status, **fields):
    """Park the run and block until resolved or cancelled. Returns the decision."""
    rec["_gate"].clear()
    rec["_decision"] = None
    rec["status"] = status
    for k, v in fields.items():
        rec[k] = v
    rec["_gate"].wait()
    decision = rec["_decision"]
    rec["pending_action"] = None
    rec["pending_question"] = None
    rec["status"] = "running"
    return decision


def _element_text_at(page, x, y):
    try:
        return (page.evaluate(
            "([x,y]) => { const el = document.elementFromPoint(x,y);"
            " return el ? (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0,120) : ''; }",
            [x, y],
        ) or "").strip()
    except Exception:
        return ""


def _execute(page, action):
    """Run one action against the page. Returns a short result string."""
    kind = action["action"]
    if kind in ("click", "double_click"):
        x, y = int(action.get("x", 0)), int(action.get("y", 0))
        if kind == "click":
            page.mouse.click(x, y)
        else:
            page.mouse.dblclick(x, y)
        return f"{kind} at ({x},{y})"
    if kind == "type":
        page.keyboard.type(str(action.get("text", "")), delay=20)
        return "typed text"
    if kind == "press":
        page.keyboard.press(str(action.get("key", "Enter")))
        return f"pressed {action.get('key')}"
    if kind == "scroll":
        dy = int(action.get("dy", 400))
        page.mouse.wheel(0, dy)
        return f"scrolled {dy}"
    if kind == "navigate":
        page.goto(action.get("url", ""), wait_until="domcontentloaded", timeout=30000)
        return f"navigated to {action.get('url')}"
    if kind == "wait":
        page.wait_for_timeout(min(int(action.get("ms", 500)), 5000))
        return "waited"
    return "noop"


def _worker(rec, api_key, vision_model, director, autonomy, max_steps, start_url, headless):
    from playwright.sync_api import sync_playwright

    run_id = rec["id"]
    history = rec["steps"]
    subgoal = ""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            page = browser.new_page(viewport=_VIEWPORT)
            page.goto(start_url or "about:blank", wait_until="domcontentloaded", timeout=30000)
            rec["status"] = "running"

            # Initial plan from the director (Opus), if wired.
            if director:
                try:
                    subgoal = director(rec["goal"], f"Just opened {page.url}. Page title: {page.title()}.") or ""
                except Exception as e:
                    print(f"[BrowserAgent] director error: {e}")
            rec["subgoal"] = subgoal

            step = 0
            while step < max_steps:
                if rec["_cancel"].is_set():
                    rec["status"] = "cancelled"
                    break

                rec["url"], rec["title"] = page.url, page.title()
                png = page.screenshot(type="png")
                shot_path = os.path.join(_run_dir(run_id), f"step_{step:02d}.png")
                try:
                    with open(shot_path, "wb") as f:
                        f.write(png)
                except Exception:
                    shot_path = None
                rec["last_screenshot"] = shot_path

                try:
                    action, raw = _call_executor(
                        api_key, vision_model, rec["goal"], subgoal,
                        history, rec["url"], rec["title"], png,
                    )
                except Exception as e:
                    rec["status"] = "error"
                    rec["error"] = str(e)
                    break

                kind = action.get("action")

                if kind == "done":
                    rec["result"] = action.get("summary", "Task complete.")
                    rec["status"] = "done"
                    _record(rec, step, shot_path, subgoal, raw, action, "", "done")
                    break

                if kind == "ask":
                    answer = _park(rec, "awaiting_input",
                                   pending_question=action.get("question", "Need input."))
                    if rec["_cancel"].is_set():
                        rec["status"] = "cancelled"
                        break
                    subgoal = (subgoal + f"\nUser said: {answer}").strip()
                    rec["subgoal"] = subgoal
                    _record(rec, step, shot_path, subgoal, raw, action, "", "asked user")
                    step += 1
                    continue

                # Determine target element text for click actions (sensitivity + dataset value).
                element_text = ""
                if kind in ("click", "double_click"):
                    element_text = _element_text_at(page, int(action.get("x", 0)), int(action.get("y", 0)))

                sensitive = _is_sensitive(action, element_text, rec["url"])
                if sensitive and autonomy == "pause":
                    approved = _park(rec, "awaiting_confirmation", pending_action=action)
                    if rec["_cancel"].is_set():
                        rec["status"] = "cancelled"
                        break
                    if not approved:
                        _record(rec, step, shot_path, subgoal, raw, action, element_text, "declined")
                        rec["result"] = "Stopped: user declined a sensitive action."
                        rec["status"] = "done"
                        break

                try:
                    result = _execute(page, action)
                except Exception as e:
                    result = f"error: {e}"
                _record(rec, step, shot_path, subgoal, raw, action, element_text, result)

                page.wait_for_timeout(400)
                step += 1
                rec["step"] = step

                # Re-consult the director periodically.
                if director and step % _DIRECTOR_INTERVAL == 0:
                    try:
                        summary = (f"At {page.url} (title: {page.title()}). "
                                   f"Last action: {json.dumps(action)} -> {result}.")
                        new_sub = director(rec["goal"], summary)
                        if new_sub:
                            subgoal = new_sub
                            rec["subgoal"] = subgoal
                    except Exception as e:
                        print(f"[BrowserAgent] director error: {e}")

            else:
                rec["status"] = rec["status"] if rec["status"] in ("error", "cancelled") else "done"
                if rec["result"] is None:
                    rec["result"] = f"Reached step limit ({max_steps})."

            browser.close()
    except Exception as e:
        rec["status"] = "error"
        rec["error"] = str(e)
    finally:
        rec["finished"] = datetime.now(timezone.utc).isoformat()


def _record(rec, step, shot_path, subgoal, raw, action, element_text, result):
    entry = {
        "step": step,
        "ts": datetime.now(timezone.utc).isoformat(),
        "url": rec["url"],
        "title": rec["title"],
        "goal": rec["goal"],
        "subgoal": subgoal,
        "model_raw": raw[:1000] if isinstance(raw, str) else "",
        "action": action,
        "element_text": element_text,
        "result": result,
        "screenshot": shot_path,
    }
    rec["steps"].append({"step": step, "action": action, "result": result})
    _log_step(rec["id"], entry)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def start_run(goal, api_key, vision_model=None, director=None, autonomy="pause",
              max_steps=_MAX_STEPS_DEFAULT, start_url="", headless=False):
    """Launch a browser agent run in a background thread. Returns the run record's
    public status (including its id). Raises if Playwright or the key is missing."""
    ok, detail = playwright_available()
    if not ok:
        raise RuntimeError(detail)
    if not api_key:
        raise RuntimeError("OpenAI API key required for the vision executor.")

    goal = (goal or "").strip()
    if not goal:
        raise RuntimeError("goal is required.")

    vision_model = vision_model or _DEFAULT_VISION_MODEL
    try:
        max_steps = max(1, min(int(max_steps), 60))
    except Exception:
        max_steps = _MAX_STEPS_DEFAULT
    if autonomy not in ("pause", "confirm_all", "auto"):
        autonomy = "pause"

    rec = _new_run(goal)
    t = threading.Thread(
        target=_worker,
        args=(rec, api_key, vision_model, director, autonomy, max_steps, start_url, headless),
        daemon=True,
    )
    rec["_thread"] = t
    t.start()
    return public_status(rec["id"])

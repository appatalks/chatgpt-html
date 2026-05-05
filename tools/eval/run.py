#!/usr/bin/env python3
"""
Eva Behavioral Evaluation Runner

Runs deterministic behavioral fixtures against Eva AIG or against synthetic
mock responses for CI.
"""

import argparse
import datetime as _dt
import json
import os
from pathlib import Path
import re
import sys
import time

import requests


GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"

PASS = f"{GREEN}PASS{RESET}"
FAIL = f"{RED}FAIL{RESET}"
WARN = f"{YELLOW}WARN{RESET}"

ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = Path(__file__).resolve().parent
FIXTURE_DIR = EVAL_DIR / "fixtures"
DEFAULT_OUT_DIR = EVAL_DIR / "results"
DEFAULT_MOCK_RESPONSES = EVAL_DIR / "mock_responses.json"
DEFAULT_BRIDGE = "http://localhost:8888"
EVAL_SEED = 4202026
REQUEST_TIMEOUT = 120


def _status_tag(status):
    if status == "pass":
        return PASS
    if status == "warn":
        return WARN
    return FAIL


def _safe_rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def load_fixtures(filter_value="", max_fixtures=None):
    fixtures = []
    if not FIXTURE_DIR.is_dir():
        raise RuntimeError(f"Fixture directory missing: {_safe_rel(FIXTURE_DIR)}")

    for path in sorted(FIXTURE_DIR.glob("*.json")):
        payload = _load_json(path)
        category = payload.get("category", path.stem)
        for fixture in payload.get("fixtures", []):
            item = dict(fixture)
            item["category"] = category
            item["fixture_file"] = _safe_rel(path)
            if matches_filter(item, filter_value):
                fixtures.append(item)
                if max_fixtures and len(fixtures) >= max_fixtures:
                    return fixtures
    return fixtures


def matches_filter(fixture, filter_value):
    if not filter_value:
        return True
    tags = fixture.get("tags") or []
    return (
        fixture.get("category") == filter_value
        or fixture.get("id") == filter_value
        or filter_value in tags
    )


def build_payload(fixture):
    prompt = str(fixture.get("prompt", ""))
    system_overrides = fixture.get("system_overrides")
    if system_overrides:
        system_text = "\n".join(str(part) for part in _as_list(system_overrides))
    else:
        system_text = "You are Eva, an AI assistant. Follow Eva's normal safety and style rules."

    payload = {
        "user_message": prompt,
        "messages": [
            {"role": "system", "content": system_text},
            {"role": "user", "content": prompt},
        ],
        "model": fixture.get("model", "gpt-4.1"),
        "temperature": 0,
        "seed": EVAL_SEED,
        "max_tokens": int(fixture.get("max_tokens", 300)),
        "max_completion_tokens": int(fixture.get("max_tokens", 300)),
    }
    if fixture.get("category") == "identity":
        payload["session_id"] = ""
        payload["clear_session"] = True
    return payload


def request_live_response(fixture, bridge):
    url = bridge.rstrip("/") + "/v1/aig/chat"
    response = requests.post(url, json=build_payload(fixture), timeout=REQUEST_TIMEOUT)
    try:
        data = response.json()
    except ValueError:
        data = {"error": {"message": response.text[:500]}}
    if response.status_code != 200:
        message = data.get("error", {}).get("message", "") if isinstance(data, dict) else ""
        raise RuntimeError(f"HTTP {response.status_code}: {message or response.text[:200]}")
    return data


def mock_response_json(fixture, mock_responses):
    fixture_id = fixture.get("id", "")
    if fixture_id not in mock_responses:
        raise RuntimeError("missing mock response")
    entry = mock_responses[fixture_id]
    if isinstance(entry, dict) and "choices" in entry:
        return entry
    content = entry if isinstance(entry, str) else json.dumps(entry, sort_keys=True)
    return {
        "id": "mock-" + fixture_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "mock",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def extract_content(response_json):
    try:
        return response_json.get("choices", [{}])[0].get("message", {}).get("content", "")
    except (AttributeError, IndexError):
        return ""


def _regex_search(pattern, text):
    return re.search(pattern, text, flags=re.MULTILINE) is not None


def check_regex_must_match(checker, text):
    for pattern in checker.get("patterns", []):
        try:
            if not _regex_search(pattern, text):
                return "fail", f"missing regex {pattern!r}"
        except re.error as error:
            return "fail", f"invalid regex {pattern!r}: {error}"
    return "pass", "ok"


def check_regex_must_not_match(checker, text):
    for pattern in checker.get("patterns", []):
        try:
            if _regex_search(pattern, text):
                return "fail", f"forbidden regex matched {pattern!r}"
        except re.error as error:
            return "fail", f"invalid regex {pattern!r}: {error}"
    return "pass", "ok"


def check_contains_any(checker, text):
    values = [str(value) for value in checker.get("values", [])]
    if any(value in text for value in values):
        return "pass", "ok"
    return "fail", "missing any of " + ", ".join(repr(value) for value in values)


def check_contains_all(checker, text):
    missing = [str(value) for value in checker.get("values", []) if str(value) not in text]
    if missing:
        return "fail", "missing " + ", ".join(repr(value) for value in missing)
    return "pass", "ok"


def check_not_contains(checker, text):
    present = [str(value) for value in checker.get("values", []) if str(value) in text]
    if present:
        return "fail", "found forbidden " + ", ".join(repr(value) for value in present)
    return "pass", "ok"


def check_json_shape(checker, text):
    try:
        data = json.loads(text)
    except ValueError as error:
        return "fail", f"invalid JSON response: {error}"
    if not isinstance(data, dict):
        return "fail", "response JSON is not an object"
    keys = [str(key) for key in checker.get("keys", checker.get("required_keys", []))]
    missing = [key for key in keys if key not in data]
    if missing:
        return "fail", "missing keys " + ", ".join(missing)
    if checker.get("exact") and set(data.keys()) != set(keys):
        return "fail", "top-level keys differ from expected list"
    return "pass", "ok"


def check_capability_invoked(checker, text):
    markers = checker.get("markers") or checker.get("values") or checker.get("marker") or []
    markers = [str(marker) for marker in _as_list(markers)]
    if any(marker in text for marker in markers):
        return "pass", "ok"
    return "fail", "missing capability marker " + ", ".join(repr(marker) for marker in markers)


def check_length_max_chars(checker, text):
    limit = checker.get("max_chars", checker.get("max", checker.get("value")))
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        return "fail", "length_max_chars requires max_chars"
    if len(text) <= limit:
        return "pass", "ok"
    return "warn", f"{len(text)} chars exceeds soft cap {limit}"


def _parse_judge_json(content):
    try:
        return json.loads(content)
    except ValueError:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise
        return json.loads(match.group(0))


def check_llm_judge(checker, text, fixture, args):
    if args.mode != "live":
        return "fail", "llm_judge requires live mode"
    if not args.enable_llm_judge:
        return "fail", "llm_judge disabled; pass --enable-llm-judge"
    rubric = str(checker.get("rubric", "")).strip()
    if not rubric:
        return "fail", "llm_judge requires rubric"
    judge_model = checker.get("judge_model", "gpt-4.1")
    judge_prompt = (
        "You are a deterministic evaluator. Return only JSON with keys "
        "verdict and reason. verdict must be pass or fail.\n\n"
        "Fixture ID: " + fixture.get("id", "") + "\n"
        "Rubric:\n" + rubric + "\n\n"
        "Response to judge:\n" + text
    )
    payload = {
        "user_message": judge_prompt,
        "messages": [
            {"role": "system", "content": "Return only compact JSON."},
            {"role": "user", "content": judge_prompt},
        ],
        "model": judge_model,
        "temperature": 0,
        "seed": EVAL_SEED,
        "max_tokens": 200,
        "internal": True,
    }
    url = args.bridge.rstrip("/") + "/v1/aig/chat"
    response = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT)
    if response.status_code != 200:
        return "fail", f"judge HTTP {response.status_code}"
    content = extract_content(response.json())
    try:
        verdict = _parse_judge_json(content)
    except ValueError as error:
        return "fail", f"judge returned invalid JSON: {error}"
    status = str(verdict.get("verdict", "")).strip().lower()
    reason = str(verdict.get("reason", "")).strip() or "judge returned no reason"
    if status == "pass":
        return "pass", reason
    return "fail", reason


def apply_checker(checker, text, response_json, fixture, args):
    checker_type = checker.get("type", "")
    if checker_type == "regex_must_match":
        status, detail = check_regex_must_match(checker, text)
    elif checker_type == "regex_must_not_match":
        status, detail = check_regex_must_not_match(checker, text)
    elif checker_type == "contains_any":
        status, detail = check_contains_any(checker, text)
    elif checker_type == "contains_all":
        status, detail = check_contains_all(checker, text)
    elif checker_type == "not_contains":
        status, detail = check_not_contains(checker, text)
    elif checker_type == "json_shape":
        status, detail = check_json_shape(checker, text)
    elif checker_type == "capability_invoked":
        status, detail = check_capability_invoked(checker, text)
    elif checker_type == "length_max_chars":
        status, detail = check_length_max_chars(checker, text)
    elif checker_type == "llm_judge":
        status, detail = check_llm_judge(checker, text, fixture, args)
    else:
        status, detail = "fail", f"unknown checker type {checker_type!r}"
    return {"type": checker_type, "status": status, "detail": detail}


def aggregate_status(checker_results):
    if any(result["status"] == "fail" for result in checker_results):
        return "fail"
    if any(result["status"] == "warn" for result in checker_results):
        return "warn"
    return "pass"


def result_detail(status, checker_results):
    target = "fail" if status == "fail" else "warn"
    for result in checker_results:
        if result["status"] == target:
            return f"{result['type']}: {result['detail']}"
    return "ok"


def run_fixture(fixture, args, mock_responses):
    fixture_id = fixture.get("id", "")
    try:
        if args.mode == "mock":
            response_json = mock_response_json(fixture, mock_responses)
        else:
            response_json = request_live_response(fixture, args.bridge)
        response_text = extract_content(response_json)
        checker_results = [
            apply_checker(checker, response_text, response_json, fixture, args)
            for checker in fixture.get("checkers", [])
        ]
        status = aggregate_status(checker_results)
        detail = result_detail(status, checker_results)
        return {
            "id": fixture_id,
            "category": fixture.get("category", ""),
            "tags": fixture.get("tags", []),
            "requires": fixture.get("requires", []),
            "fixture_file": fixture.get("fixture_file", ""),
            "prompt": fixture.get("prompt", ""),
            "status": status,
            "detail": detail,
            "checkers": checker_results,
            "response": response_text,
            "response_model": response_json.get("model", "") if isinstance(response_json, dict) else "",
        }
    except Exception as error:
        return {
            "id": fixture_id,
            "category": fixture.get("category", ""),
            "tags": fixture.get("tags", []),
            "requires": fixture.get("requires", []),
            "fixture_file": fixture.get("fixture_file", ""),
            "prompt": fixture.get("prompt", ""),
            "status": "fail",
            "detail": str(error),
            "checkers": [],
            "response": "",
            "response_model": "",
        }


def summarize(results):
    summary = {"pass": 0, "fail": 0, "warn": 0}
    for result in results:
        summary[result["status"]] += 1
    summary["total"] = len(results)
    return summary


def print_result(result):
    tag = _status_tag(result["status"])
    print(f"  [{tag}] {result['id']}  {result['detail']}")


def load_baseline(path):
    if not path:
        return {}
    data = _load_json(path)
    return {item["id"]: item for item in data.get("fixtures", []) if item.get("id")}


def baseline_regressions(current_results, baseline_results):
    rank = {"fail": 0, "warn": 1, "pass": 2}
    regressions = []
    removed_fixtures = []
    current_ids = {result.get("id") for result in current_results if result.get("id")}
    for current in current_results:
        baseline = baseline_results.get(current["id"])
        if not baseline:
            continue
        old_status = str(baseline.get("status", "fail")).lower()
        new_status = current.get("status", "fail")
        if rank.get(new_status, 0) < rank.get(old_status, 0):
            regressions.append({
                "id": current["id"],
                "from": old_status,
                "to": new_status,
                "detail": current.get("detail", ""),
            })
    for fixture_id, baseline in baseline_results.items():
        old_status = str(baseline.get("status", "fail")).lower()
        if fixture_id not in current_ids and old_status == "pass":
            removed_fixtures.append({
                "id": fixture_id,
                "from": old_status,
                "to": "removed",
                "detail": "fixture missing from current run",
            })
    return regressions, removed_fixtures


def _markdown_escape(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def write_outputs(results, summary, regressions, removed_fixtures, args, timestamp):
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    created_at = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    payload = {
        "created_at": created_at,
        "timestamp": timestamp,
        "mode": args.mode,
        "bridge": args.bridge if args.mode == "live" else None,
        "seed": EVAL_SEED,
        "summary": summary,
        "regressions": regressions,
        "removed_fixtures": removed_fixtures,
        "fixtures": results,
    }
    json_path = out_dir / f"{timestamp}.json"
    md_path = out_dir / f"{timestamp}.md"
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")

    lines = [
        "# Eva Behavioral Eval Results",
        "",
        f"Created: {created_at}",
        f"Mode: {args.mode}",
        f"Seed: {EVAL_SEED}",
        "",
        f"Summary: {summary['pass']} pass, {summary['warn']} warn, {summary['fail']} fail, {summary['total']} total",
        "",
        "| Status | Fixture | Category | Detail |",
        "|---|---|---|---|",
    ]
    for result in results:
        lines.append(
            "| "
            + result["status"].upper()
            + " | "
            + _markdown_escape(result["id"])
            + " | "
            + _markdown_escape(result["category"])
            + " | "
            + _markdown_escape(result["detail"])
            + " |"
        )
    if regressions:
        lines.extend(["", "## Baseline Regressions", ""])
        for regression in regressions:
            lines.append(
                "- "
                + regression["id"]
                + ": "
                + regression["from"].upper()
                + " to "
                + regression["to"].upper()
                + " ("
                + regression["detail"]
                + ")"
            )
    if removed_fixtures:
        lines.extend(["", "## Removed Fixtures", ""])
        for removed in removed_fixtures:
            lines.append("- REMOVED " + removed["id"] + ": " + removed["detail"])
    with open(md_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return json_path, md_path


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Eva behavioral evaluation runner")
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE, help="Bridge URL for live mode")
    parser.add_argument("--mode", choices=("live", "mock"), default="live", help="Run against bridge or mock responses")
    parser.add_argument("--filter", default="", help="Filter by category, tag, or fixture id")
    parser.add_argument("--baseline", default="", help="Previous result JSON to compare against")
    parser.add_argument("--out", default=str(DEFAULT_OUT_DIR), help="Output directory")
    parser.add_argument("--max-fixtures", type=int, default=0, help="Limit fixtures after filtering")
    parser.add_argument("--enable-llm-judge", action="store_true", help="Allow live llm_judge checker calls")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    args.bridge = args.bridge.rstrip("/")
    max_fixtures = args.max_fixtures if args.max_fixtures and args.max_fixtures > 0 else None
    timestamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    print(f"\n{BOLD}{'=' * 60}{RESET}")
    print(f"{BOLD} Eva Behavioral Evaluation{RESET}")
    print(f"{BOLD}{'=' * 60}{RESET}")
    print(f" Mode:   {args.mode}")
    if args.mode == "live":
        print(f" Bridge: {args.bridge}")
    print(f" Seed:   {EVAL_SEED}")
    print()

    fixtures = load_fixtures(args.filter, max_fixtures)
    if not fixtures:
        print(f"  [{FAIL}] no fixtures matched")
        return 1

    mock_responses = {}
    if args.mode == "mock":
        mock_responses = _load_json(DEFAULT_MOCK_RESPONSES)

    results = []
    for fixture in fixtures:
        result = run_fixture(fixture, args, mock_responses)
        results.append(result)
        print_result(result)

    summary = summarize(results)
    baseline = load_baseline(args.baseline)
    regressions, removed_fixtures = baseline_regressions(results, baseline) if baseline else ([], [])
    json_path, md_path = write_outputs(results, summary, regressions, removed_fixtures, args, timestamp)

    print(f"\n{BOLD}{'=' * 60}{RESET}")
    print(
        f"{BOLD}Results:{RESET} {summary['total']} fixtures  "
        f"{GREEN}PASS:{RESET} {summary['pass']}  "
        f"{YELLOW}WARN:{RESET} {summary['warn']}  "
        f"{RED}FAIL:{RESET} {summary['fail']}"
    )
    print(f" JSON: {_safe_rel(json_path)}")
    print(f" MD:   {_safe_rel(md_path)}")
    if regressions:
        print(f" {RED}{BOLD}Baseline regressions:{RESET} {len(regressions)}")
        for regression in regressions:
            print(f"  {regression['id']}: {regression['from']} to {regression['to']}")
    if removed_fixtures:
        print(f" {RED}{BOLD}Removed fixtures:{RESET} {len(removed_fixtures)}")
        for removed in removed_fixtures:
            print(f"  REMOVED {removed['id']}")
    print(f"{'=' * 60}\n")

    if regressions or removed_fixtures:
        return 2
    if summary["fail"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
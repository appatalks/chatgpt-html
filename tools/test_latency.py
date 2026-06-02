#!/usr/bin/env python3
"""Cognition pipeline latency test.

Simulates the 3-call cognition loop (eva draft -> reviewer -> eva revision)
and compares wall time for:
  Path A: same model for all 3 calls (no ACP model switches)
  Path B: different models for eva vs reviewer (2 switches per cycle)

Usage:
  python3 tools/test_latency.py [--bridge URL] [--eva-model M] [--reviewer-model M]

Defaults:
  bridge:         http://localhost:8888
  eva-model:      claude-opus-4.6
  reviewer-model: gpt-4.1
"""

import argparse
import json
import sys
import time
import urllib.request

PROMPT = "What is 2+2? Answer in one sentence."
SYSTEM = "You are a helpful assistant. Be brief."


def call_aig(bridge_url, model, messages, label=""):
    """POST /v1/aig/chat and return (content, elapsed_s)."""
    url = bridge_url.rstrip("/") + "/v1/aig/chat"
    payload = json.dumps({
        "messages": messages,
        "user_message": PROMPT,
        "model": model,
        "internal": True,
        "github_pat": "",
        "lmstudio_base_url": "",
        "lmstudio_model": "",
    }).encode()

    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
    )

    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read())
    except Exception as e:
        elapsed = time.monotonic() - t0
        print(f"  {label}: FAILED after {elapsed:.2f}s - {e}")
        return None, elapsed
    elapsed = time.monotonic() - t0

    content = ""
    if body.get("choices"):
        content = body["choices"][0].get("message", {}).get("content", "")
    used_model = body.get("model", model)
    preview = (content[:80] + "...") if len(content) > 80 else content
    print(f"  {label}: {elapsed:.2f}s  model={used_model}  [{preview}]")
    return content, elapsed


def run_pipeline(bridge_url, eva_model, reviewer_model, label):
    """Run a 3-call cognition simulation and return total elapsed."""
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"  eva={eva_model}  reviewer={reviewer_model}")
    print(f"{'='*60}")

    msgs = [{"role": "system", "content": SYSTEM}]

    total_t0 = time.monotonic()

    # Step 1: Eva draft
    draft, t1 = call_aig(bridge_url, eva_model,
                         msgs + [{"role": "user", "content": PROMPT}],
                         "eva-draft")

    # Step 2: Reviewer
    review_task = f"User message:\n{PROMPT}\n\nEva draft:\n{draft or '(failed)'}\n\nReview. First line: VERDICT: APPROVE or REQUEST_CHANGES."
    _, t2 = call_aig(bridge_url, reviewer_model,
                     msgs + [{"role": "user", "content": review_task}],
                     "reviewer")

    # Step 3: Eva revision
    revise_task = f"User message:\n{PROMPT}\n\nPrevious draft:\n{draft or '(failed)'}\n\nReviewer says: approved.\n\nProduce the final answer."
    _, t3 = call_aig(bridge_url, eva_model,
                     msgs + [{"role": "user", "content": revise_task}],
                     "eva-revise")

    total = time.monotonic() - total_t0
    print(f"\n  Steps: {t1:.2f} + {t2:.2f} + {t3:.2f} = {t1+t2+t3:.2f}s")
    print(f"  Wall:  {total:.2f}s (includes switch overhead)")
    return total, (t1, t2, t3)


def main():
    ap = argparse.ArgumentParser(description="Cognition latency test")
    ap.add_argument("--bridge", default="http://localhost:8888")
    ap.add_argument("--eva-model", default="claude-opus-4.6")
    ap.add_argument("--reviewer-model", default="gpt-4.1")
    args = ap.parse_args()

    print(f"Bridge: {args.bridge}")
    print(f"Prompt: {PROMPT!r}")

    # Path A: same model (no switches)
    same = args.eva_model
    total_a, steps_a = run_pipeline(args.bridge, same, same,
                                    f"PATH A: same model ({same})")

    # Path B: different models (2 switches)
    total_b, steps_b = run_pipeline(args.bridge, args.eva_model, args.reviewer_model,
                                    f"PATH B: split models")

    # Summary
    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"{'='*60}")
    print(f"  Path A (same model):   {total_a:.2f}s  steps={sum(steps_a):.2f}s")
    print(f"  Path B (split models): {total_b:.2f}s  steps={sum(steps_b):.2f}s")
    diff = total_b - total_a
    print(f"  Difference:            {diff:+.2f}s  ({diff/max(total_a,0.01)*100:+.1f}%)")
    print(f"\n  Switch overhead estimate: ~{diff/2:.1f}s per switch")
    print()


if __name__ == "__main__":
    main()

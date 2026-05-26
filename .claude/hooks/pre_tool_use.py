#!/usr/bin/env python3
"""Forged pre-tool-use guard. Reads tool-use JSON on stdin, blocks risky actions.

Exit codes:
  0 = allow
  2 = block (stderr is shown to the assistant)

Override:
  FORGED_OVERRIDE_PROTECTED=1  (env var)
"""
import json
import sys
import os
import fnmatch
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PROTECTED_FILE = os.path.join(HERE, "protected-paths.txt")


def load_protected():
    out = []
    try:
        with open(PROTECTED_FILE) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                out.append(line)
    except FileNotFoundError:
        pass
    return out


def path_is_protected(path, globs):
    if not path:
        return False
    abspath = os.path.abspath(path)
    if abspath.startswith(REPO_ROOT + os.sep):
        rel = abspath[len(REPO_ROOT) + 1:]
    else:
        rel = path
    rel = rel.replace(os.sep, "/")
    for glob in globs:
        if fnmatch.fnmatch(rel, glob):
            return True
        if fnmatch.fnmatch(os.path.basename(rel), glob):
            return True
    return False


def deny(reason):
    sys.stderr.write(reason + "\n")
    sys.exit(2)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        # Fail open — never silently break the harness.
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}

    override = os.environ.get("FORGED_OVERRIDE_PROTECTED") == "1"
    protected = load_protected()

    # 1. Block dangerous git pushes
    if tool_name == "Bash":
        cmd = tool_input.get("command", "") or ""
        flat = re.sub(r"\s+", " ", cmd).strip()
        push_to_main = re.search(r"\bgit\b[^|;&]*\bpush\b[^|;&]*\bmain\b", flat)
        force_push = re.search(
            r"\bgit\b[^|;&]*\bpush\b[^|;&]*(--force\b|-f\b|--force-with-lease\b)",
            flat,
        )
        if push_to_main and not override:
            deny(
                "BLOCKED: direct git push to main is not allowed.\n"
                "Forged policy: create a branch (claude/<topic>-<date>), open a PR, "
                "let the human review.\n"
                "Override: FORGED_OVERRIDE_PROTECTED=1"
            )
        if force_push and not override:
            deny(
                "BLOCKED: force-push detected.\n"
                "Forged policy: never rewrite shared history without explicit approval.\n"
                "Override: FORGED_OVERRIDE_PROTECTED=1"
            )

    # 2. Block edits to protected paths
    if tool_name in ("Edit", "Write", "NotebookEdit"):
        target = (
            tool_input.get("file_path")
            or tool_input.get("notebook_path")
            or ""
        )
        if path_is_protected(target, protected) and not override:
            deny(
                f"BLOCKED: '{target}' is a Forged-protected path.\n"
                "These paths cover payments, schema, coach personality, cost invariants, "
                "or local secrets/settings. Edits require explicit human approval.\n"
                "Override: FORGED_OVERRIDE_PROTECTED=1"
            )

    # 3. Block reads of .env files
    if tool_name == "Read":
        target = tool_input.get("file_path", "") or ""
        name = os.path.basename(target)
        if (name == ".env" or name.startswith(".env.")) and not override:
            deny(
                f"BLOCKED: reading '{target}' could expose secrets.\n"
                "If you need an env var name (not value), grep the codebase instead."
            )

    # 4. Warn (do not block) on console.log inserts in api/
    if tool_name in ("Edit", "Write"):
        target = tool_input.get("file_path", "") or ""
        if "/api/" in target.replace("\\", "/"):
            new = tool_input.get("new_string") or tool_input.get("content") or ""
            if "console.log(" in new:
                sys.stderr.write(
                    f"WARNING: console.log added to {os.path.basename(target)}. "
                    "Server-side logs surface in Vercel logs and can be noisy; "
                    "consider captureException or removing before commit.\n"
                )

    sys.exit(0)


if __name__ == "__main__":
    main()

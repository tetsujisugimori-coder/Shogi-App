"""Read-only and deliberately bounded public-output gate, NOT history rewrites or DLP."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import sys

PUBLIC_PATHS = (
    "docs/benchmarks/game-blunder-w1h-20261118/generated.stdout",
    "docs/benchmarks/game-blunder-w1h-20261118/post-admission.stdout",
    "docs/benchmarks/game-blunder-w1h-20261118/seal/red.stdout",
    "docs/benchmarks/game-blunder-w1h-20261118/seal/oid-coercion-red.stdout",
)
FORBIDDEN = {
    "cloud-workspace": re.compile(r"/workspace/"),
    "home-user": re.compile(r"/home/[^/\s]+/"),
    "windows-user": re.compile(r"[A-Za-z]:[\\/]users[\\/]", re.IGNORECASE),
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    "github-token": re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
}

def verify_public_outputs(root: Path) -> dict:
    root = Path(root)
    entries = []
    for relative in PUBLIC_PATHS:
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise ValueError("PUBLIC_EVIDENCE_MISSING_OR_LINK:" + relative)
        data = path.read_bytes()
        try:
            content = data.decode("utf-8")
        except UnicodeError as exc:
            raise ValueError("PUBLIC_EVIDENCE_NOT_UTF8:" + relative) from exc
        for reason, pattern in FORBIDDEN.items():
            if pattern.search(content):
                raise ValueError("PUBLIC_EVIDENCE_UNREDACTED:" + relative + ":" + reason)
        entries.append({"path": relative, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    return {
        "status": "PASS",
        "scope": "four current W1h public representations, not Git history",
        "files": entries,
        "history_old_two_removed": False,
        "permission_to_compare": False,
    }

if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("USAGE: stage-w1i-public-log-gate.py REPOSITORY_ROOT")
        outcome = verify_public_outputs(Path(sys.argv[1]))
        print(json.dumps(outcome, ensure_ascii=False, sort_keys=True))
    except (ValueError, OSError) as exc:
        print(json.dumps({"status": "FAIL", "reason": str(exc), "permission_to_compare": False}))
        sys.exit(1)

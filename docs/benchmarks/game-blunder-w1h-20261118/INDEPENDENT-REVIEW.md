# Independent review record (W1h)

B is a separate AI agent/session and verification area, with shared owner, credentials, host and filesystem. SOLO_STANDARD technical separation, not third-party human independence. B directly inspected code and executed independent inputs rather than adopting A's PASS claims.

## Findings and same-input correction
- B-P2-01: malformed `ready.sha256.json` could make launch's catch append an event into an unidentified output. Independent harmless fixture reproduced added file. Fixed: launch errors return structured rejection without writes. Same input now UNKNOWN with unchanged output set. CLOSED in local code review.
- B-P3-01: JS regex coercion accepted array HEAD/tree in the seal schema. Reproduced by B. Explicit string checks added, same input now SEAL_SCHEMA_INVALID. Producer and validator reject. CLOSED in local code review.
- Additional entry inventory: historical W1d/e/f probes can collect through parent/child routes. Guard added before any output or target import. Six direct synthetic rejection cases, no fixed target execution. Review of final submitted version pending.

B's first related run: 211 passed, no failures/skips, exit 0. This precedes the six historical-probe cases and is not a final-head result. Fixed GitHub retrieval and final-head rerun are separate pending steps; final PR review/comment is authoritative for their outcome.

P2-W1g-01 and P3-W1g-02 final CLOSED decisions await B's final submitted-version check. No claim of full independent authentication, kernel provenance, exclusive writer, semantic consumer chain or config equivalence. Old P2 closures unchanged absent new evidence.

## Publication limitation
Two initial synthetic RED logs included local workspace path strings in stack traces. Public representations are now path-redacted, with raw/public digests in publication-redactions.json and original bytes retained privately. Prior Git history is not rewritten. No credentials or secret experiment text was involved; historical publication cannot be claimed erased. Information-handling P3 remains OPEN.

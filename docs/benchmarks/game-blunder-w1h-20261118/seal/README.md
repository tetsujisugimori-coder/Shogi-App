# W1h source seal contract verification

Scope: synthetic schema/byte binding and read-only inspection producer integration only. No fixed snapshot inspection or Vitest comparison was run by this work.

`stage-w1h-source-seal/1` requires scope (`synthetic` or `inspection`), actor `{id,instance}`, ordered nonempty targets `{head,tree}`, SHA-256 source/dependency/environment, one-use challenge and integer epoch milliseconds. Producer uses source manifests, dependency content + physical identity + lock, environment digest. Raw JSON bytes SHA-256 and JSON structured digest are separate fields; formatting changes must fail raw-byte verification even when structured content is unchanged.

`createSourceSeal`, `validateSourceSeal`, and `assessSealed` are shared by producer and gate module. Legacy W1g `assess` remains a synthetic-only regression interface for the old 32 tests; it is not a v2 admission path. New records use `assessSealed`, which never issues permission (`permit=false`). The operational `fixedComparisonGate()` remains BLOCKED regardless of supplied objects. Neither equality nor a caller-provided fresh challenge proves authentication. Operational freshness requires a trusted challenge issuer/used-challenge registry and independent verifier, which are NOT_IMPLEMENTED/BLOCKED.

Expected input pins actor, target HEAD/tree, environment, source, dependency, seal time, challenge and scope. Replay/stale/close order/type/missing and byte/digest swaps reject. Inspection output is integrity only, authentication UNKNOWN. Original W1g records are not rewritten or retroactively upgraded.

## RED / GREEN

The dedicated 25-case input/test file was fixed and hashed before implementation (`red-input-sha256.txt`). Initial run: exit 1, 25 failures because the shared API did not exist. This is a missing-contract integration RED, **not 25 independent historical false acceptances**. The source baseline files are retained separately. After implementing the shared API, the identical tests pass 25/25, exit 0. Legacy W1g + new contract regression: 57/57 pass, exit 0. Existing synthetic mutation detector remains effective. No production services or fixed old/new comparisons were invoked.

`red.stdout`, `red.stderr`, `red.exit`, `green.stdout`, `green.stderr`, `green.exit`, `regression.*` are distinct original outputs. Commands:

```
node --test scripts/stage-w1h-seal-check.mjs
node --test scripts/stage-w1g-check.mjs scripts/stage-w1h-seal-check.mjs
```

Node v24.22.3 on Linux; tests launched by subagent seal_contract, shared filesystem/account with implementing coordinator. No third-party human independence. Formal CI is not represented by these local logs. No timeout occurred, no retries; process termination bounds for arbitrary descendants are not proven by these tests.

## Independent target OID coercion finding and correction

Independent review found that JavaScript regex testing coerced one-element HEAD/tree arrays to strings. Exact added regression `target OID arrays must not coerce to valid string hashes` fails before correction (25/26 pass, exit 1) and passes after adding explicit string checks to both fields (26/26, exit 0). Same test bytes are retained; `oid-coercion-red-sha256.txt` fixes the test/checker before implementation. Producer and validator use the same `targetValid` function. source/dependency/environment/raw/structured SHA fields already require `typeof string`; challenge and actor id/instance use the string-only `nonempty`, and timestamps use `Number.isSafeInteger`. This genuine type-rejection RED is distinct from the earlier missing-API integration RED. Original earlier logs remain unchanged.

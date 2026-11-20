# Windows Stage W1: 5-second test investigation

## Result

Measurement infrastructure: **PARTIAL**. Cause isolation: **UNKNOWN**. R8: **UNKNOWN**; do not merge on this evidence. All eight completed full-suite trials passed: old 2,586/2,586 and new 2,587/2,587, four times each, zero skipped. This does not establish absence of a regression or distinguish existing Windows instability. H1–H4 remain UNKNOWN: no target failure occurred to compare or correlate.

| Order | HEAD | External sampling | Passed | Failed | Vitest duration (s) |
|---:|---|---|---:|---:|---:|
| 1 | old | yes | 2586 | 0 | 108.39 |
| 2 | new | yes | 2587 | 0 | 116.78 |
| 3 | new | no | 2587 | 0 | 109.71 |
| 4 | old | no | 2586 | 0 | 106.27 |
| 5 | new | yes | 2587 | 0 | 106.44 |
| 6 | old | yes | 2586 | 0 | 106.90 |
| 7 | old | no | 2586 | 0 | 108.26 |
| 8 | new | no | 2587 | 0 | 108.15 |

Each run had 98 passing files and exit code 0. Every stderr contains one `Not implemented: navigation to another Document` line; see raw logs. The independent reviewer checked raw logs for timeout, UI-query, AbortError, unhandled rejection and worker-crash signals and found none. No claim is made about unobserved cleanup or causal ordering.

## Conditions and caveats

Old `e1ccb1a2412e7faa86c2c1f60fdad1dca154023a`; new `2a8a57b6ff207831c77ce62d27d3151eba7c1dc3`. At start GitHub PR #218 was open and draft, on the requested branch at the new SHA, with Ubuntu/macOS checks successful; issue #217 open. The local branch matched; `.tmp-tests/` was already untracked and was preserved. Node v24.20.0, npm 11.17.0, Vitest 4.1.11, Windows, 24 available logical CPUs, about 15.7 GiB RAM. `environment.json` records initial free memory and sandbox environment. The actual elevated host TEMP/cache environment was not separately captured: **NOT_MEASURED**, so the sandbox value must not be treated as the host value. `maxWorkers: 2`; Vitest default test timeout 5 seconds, no override. The effective pool was not independently measured.

Both snapshots were extracted with `git archive`, with separate copies of the existing `node_modules` and no `.vite` cache initially. Lockfile and config blobs match, but the dependency trees were not independently hashed and a clean install was not performed. The first attempt launched eight processes which terminated with 130 or Windows 0xC000013A and produced no test JSON. These are preserved as `run-01`–`run-08` at the top level, **not completed test trials**. The exact reason for termination is unknown. `-NoNewWindow` passed a short smoke test; the fixed order was recorded again in `abba/plan.json` before the completed trials. The aborted attempts and old-only smoke tests may have warmed caches differently. A short independent-review unit test was also run concurrently during the experiment; its exact overlap was not recorded. These are possible confounders.

Both heads used the JSON and default reporters. Trials 1, 2, 5 and 6 sampled every two seconds; other trials omitted only external sampling. Sampling and order are confounded. Wall time includes polling delay for sampled runs; Vitest duration is shown above. All visible Node processes were sampled, including unrelated processes; cumulative CPU, working set and private bytes are in `process-metrics.jsonl`. Peak visible process counts were 28–29 and peak individual Node working set 450,932,736–466,370,560 bytes; neither can be attributed to workers. Free memory before/after, timings and sample counts are in `analysis/resource-summary.json`. Test-level start/end times, worker identity, GC, paging, cleanup, and timeout-to-next-test state are **NOT_MEASURED**. Cannot establish whether resource load preceded a failure or whether cleanup caused UI/AbortError.

No product source or test configuration changed between heads. Two test files changed, and diagnostic scripts and evidence changed; see `head-diff.json` and `head-diff.txt`. The observed names include 2,554 common unique file/name pairs, 2 old-only and 3 new-only; duplicates mean unique names are not execution counts. Two old-only and two new-only names are in the changed journal test, including renames and content changes; the remaining new-only name is a new diagnostic test. See `analysis/comparison-summary.json` for exact names. Common names in changed files do not prove identical test content; 2,546 unique common names occur in unchanged test files. Their runtime dependencies can still differ.

## Evidence and reproduction

`abba/run-XX` retains raw stdout, stderr, Vitest JSON, run metadata and, for sampled runs, process JSONL. Timestamps are ISO 8601 with offset or UTC; Vitest individual durations are milliseconds. Individual timestamps are not reconstructed from suite time. `analysis` holds derived results and test timings; raw logs must remain untouched. Failure classification uses heuristic string detection; matches require manual review and do not prove causal order. The eight completed runs had no detected failures. The start status, tracked test-file lists, source diff, validation logs, independent review and manifest are preserved alongside these results. SHA-256 manifest excludes itself; its generation method is in `evidence-manifest.json`.

Reaggregate without overwriting existing output: `node scripts/stage-w1-summary.mjs <evidence>/abba <new-output-directory>`. Resource summary: `node scripts/stage-w1-resource-summary.mjs <evidence>/abba <new-output-file>`. Compare content excluding generation timestamps. The runner is `scripts/stage-w1-run.ps1`; its output directory must already exist and run subdirectories must not exist. It runs the fixed sequence without changing runner timeout. The runner and aggregation scripts are diagnostic only and do not change product search logic.

`validation/results.json` records exit 0 for lock, TypeScript, related tests, build, and aggregation unit tests. These checks used the new snapshot except the diagnostic unit test in the original checkout; the eight trial snapshots exclude the new diagnostic files. CI at the final pushed HEAD must be checked separately. Independent review is recorded in `independent-review.md`.

Next minimum step: retain R8 UNKNOWN and obtain independent PR review. If further isolation is authorized later, first capture actual host environment and worker/cleanup events safely, and design a controlled sampling comparison; do not automatically start Stage W2.

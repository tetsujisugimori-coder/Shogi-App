# Stage W1c — PARTIAL / real comparison NOT READY

Issue #217 / existing Draft PR #218 / branch `codex/game-blunder-diagnostics`.
Start local and GitHub HEAD: `879f11617402d38f69271ace6f057931bb751f40`.
The branch had not advanced on the second pre-submission check. The only initial untracked entry was `.tmp-tests/`; its existing contents were retained. No filesystem AGENTS.md was found in repository/affected directory ancestors. The supplied instruction to include the date/time in the final response applies. `start-pr.json`, `start-issue.json`, `start-review.json`, and `start-pr-diff-stat.txt` retain the initial GitHub context and existing PR scope.

**Do not merge or authorize a large comparison from this evidence.** The W1b P2-01/P2-02 code-review closures are retained. W1c improves admission and demonstrates successful small fixture executions, but the real snapshots do not remain identical through Vite configuration loading. Their limited comparison was correctly stopped, with zero runner comparison-spawn events. R8 and H1–H4 remain UNKNOWN. ABBA over 98 files and detailed CPU/RSS/GC measurement were NOT_TESTED and are outside this stage.

## Fresh snapshots and independent installation

`scripts/stage-w1c-snapshots.mjs` exports every tracked regular file from the two fixed commits using binary `git cat-file --batch` buffers. It uses neither checkout filters nor archive export attributes and never copies/repairs the old snapshots. Git's system `core.autocrlf=true` therefore cannot transform the export. Unsupported tracked types fail closed. Files are created exclusively in a new directory.

The accepted build is **build-03**, retained locally at the workspace sibling `stage-w1c-20261115-03/{old,new}`. This follows the existing workspace-local snapshot/fixture retention arrangement; no external Library URL or new external archive destination is used. Source is recoverable from the fixed Git commits; dependencies from the integrity-pinned lock and recorded installation procedure. The large local installations/caches are retained, not uploaded as a ZIP. Their actual bytes were read back into manifests; this does not provide remote archival redundancy.

| Property | Old | New |
|---|---|---|
| Commit | `e1ccb1a2412e7faa86c2c1f60fdad1dca154023a` | `2a8a57b6ff207831c77ce62d27d3151eba7c1dc3` |
| Tracked files, all raw blob matches | 2,104 | 2,211 |
| Recomputed source manifest | reproducible, mismatch 0 | reproducible, mismatch 0 |
| Independent `npm ci` | exit 0 | exit 0 |
| Installed `npm ls --all --json` | exit 0 | exit 0 |
| Node / npm / Vitest | v24.20.0 / 11.17.0 / 4.1.11 | same |
| Initial dependency inventory digest | `4b858468678a4cb0b86319a291c48f4c4ebd7921df91797944644d9e6225f947` | same |
| Raw lock SHA-256 | `5118d0c609db7c079c5ffa9f9a8c54cf81f04bec314d930a9ad29764551e473b` | same |

Dependency inventories now include directory entries and file types as well as file hashes. The initial count 13,642 is an **entry count**, not the historical W1b file count. Initial source trees contain only Git-expected files/directories; node_modules is the declared separately sealed installation. Each installation uses its own npm cache and TEMP directory. Their different path strings and different content hashes are recorded, not treated as evidence of execution equivalence. Execution uses a separate fixed cache/TEMP policy.

`build-03/*-source-manifest.json`, `*-post-install.json`, `*-dependency-manifest.json`, `*-install.json` and stdout/stderr retain construction evidence. `source-reproducibility.json` independently re-reads Git blobs, regenerates the source manifests and rechecks actual snapshot bytes after the attempted collection. `lock-inventory/` retains the full installed dependency inventory and process exits. Git-origin identity and post-execution identity are separate observations.

The unsuccessful builds remain intact: the first sandbox attempt failed registry access and used the Node installation's bundled npm 11.19.0; it is not a pinned successful build. Build-02 selected npm 11.17.0 but failed TLS certificate validation. Build-03 uses Node's `--use-system-ca`, preserving TLS verification, and bounded fetch retry/timeout options for installation only. All three roots and their artifacts are retained. No old snapshot was used to rescue an install.

## Admission and execution conditions

The existing W1b preflight/runner/worker/summary structure is retained. The summary implementation is unchanged; its P2 closures are not reopened.

- Source inventory derives allowed directories from Git-tracked parents. Unknown empty directories, unknown files, source symbolic links/junctions, cycles and type changes are refused before source bytes are read through ancestors. Dependency trees include empty directories and reject internal links/unsupported types. The explicitly supported root node_modules junction is resolved and fully hashed for synthetic fixtures; the real new installations are regular independent directories.
- Output containment uses directory boundaries and resolves physical ancestors, including output aliases. Every planned trial output is checked before the first comparison starts, including `trial-1`, not just `trial-0`.
- Source, lock, dependencies, selected inherited execution-variable digests and complete designated npm-cache/TEMP/TMP/Vite-cache trees are sealed. There is **no unconditional cache exclusion**. Changed cache contents, added directories and TEMP side effects block execution. Cache/state manifests are not reduced to path strings.
- Collection is checked after **each** target, after both collections, and before each comparison child. The child checks source/dependencies and designated external trees again after loading configuration and probing npm, immediately before collecting/starting tests. Resolved settings are saved even if this last check fails.
- Run/trial IDs, target, source/dependency/lock observations, plan, tool hashes, inventory/settings and result/log/exit hashes remain bound together. Launch checks target/observation/environment bindings and exactly two distinct trial IDs. Offline verification requires both complete trial records and a matching final comparison record, then recomputes aggregation. It does not infer execution provenance from an imported verified flag.
- The recorded execution fields include Node/npm, pool, workers, test/hook timeouts, isolation, environment, file parallelism, cache settings/paths, setup files and invocation/cwd. For Vitest 4.1.11, file parallelism uses the resolved option when exposed and the installed test-mode default otherwise (the installed resolver uses `options.fileParallelism ?? mode !== 'benchmark'`). This default derivation is not an OS scheduler trace.
- Snapshot-relative setup/cache paths are mapped by their verified root and relative suffix for cross-target comparison. External cache/setup paths are compared exactly. Original per-target paths remain in sealed settings; this mapping is not permission to ignore arbitrary external paths.

The npm *probe* initially created `_update-notifier-last-checked` and hundreds of Node compile-cache entries under TEMP. `controls-host-02` failed closed on those real side effects. npm's version/config probes now use recorded `NODE_DISABLE_COMPILE_CACHE=1`, `npm_config_update_notifier=false` and `npm_config_logs_max=0`. These settings apply to the probe process and do not change product workers or test timeouts. The final fixture control has unchanged designated trees through collection and execution. No full environment dump or credential is saved; selected inherited values are hashed.

This is consistency checking, not a hostile-code sandbox. Arbitrary writes outside the declared roots and concurrent adversarial changes are not comprehensively monitored. A party able to rewrite all evidence and all digests can fabricate a consistent history. Hash matches are **not execution-history authenticity proofs**.

## Real limited attempt and the stop condition

`limited-selection.json` freezes the unchanged `src/test/game-blunder-pilot.test.ts` blob and its two test IDs. These are deterministic capture-trigger/journal-rejection assertions without timed search or UI interaction. Both target commits use the identical test blob. `limited-plan.json` keeps the actual product config, expected forks/2 workers/5000ms and enabled default cache; it does not substitute the fixture's node environment/cache policy.

`real-limited-01` passed initial raw-source/dependency pair admission, then the old target's Vite configuration loading created **one previously absent empty directory: node_modules/.vite-temp**. The worker's post-config source/dependency check refused collection. `real-post-collection-diff.json` shows exactly that inventory change, no new-target dependency change, and unchanged raw source digests for both targets. There is no evidence here that the directory is harmless to execution; it is not silently permitted or excluded.

Consequently the real attempt has one collection-wrapper spawn, failed before test inventory creation, and **zero comparison-wrapper spawns**. Real inventory acquisition, complete effective-setting equivalence, old/new limited test execution, aggregation and result readback are NOT_TESTED/NOT_READY. The final-code re-admission is `real-final-not-ready`, which refuses the now-unequal dependency inventories before any collection/comparison spawn. The snapshots were not repaired to bypass this refusal.

The successful normal control is **synthetic**, not the requested old/new product test comparison: `accepted-final` has two real Vitest fixture executions (nested describes and duplicate test names), successful inventory/settings checks, two PASS assessments, complete comparison and offline readback PASS under the final core tool hashes. `accepted-control` and `controls-host-04` are earlier successful observations. `controls-dev-01` failed at sandbox junction creation; `controls-host-03` correctly stopped because tools changed between prepare and launch during development. These attempts remain evidence and are not presented as successful final controls.

## Negative controls and CI separation

`negative-final-02/outcomes.json` retains the original ten controls plus cache/TEMP controls. Admission/launch cases record input references, expected and actual status, actual CLI exit 1, stdout/stderr, and zero comparison-spawn events. The legacy function/API result and the separate CLI result are both retained; the CLI is a second refusal, not a fabricated function exit code. The previous negative batches are preserved.

`scripts/stage-w1c-check.mjs` adds raw CRLF, unknown empty directory/file, file-to-directory change, dependency-file change, dependency empty-directory change, path boundaries and link-cycle controls, with a positive raw-source/manifest control. Windows junction execution is explicitly enabled locally; portable CI tests use POSIX links and no Windows junction. Portable CLI fixtures/outcomes are retained under the new `.tmp-tests/shogi-w1c-*` paths printed in the test logs; exported case outcomes are indexed separately in this evidence directory.

`collection-final-02` executes actual Vitest setup that changes tracked state.txt; only the first collection wrapper runs, then the runner stops with zero comparison spawns. This also corrects the older collection-harness prose that assumed both snapshots always executed setup. The earlier `collection-host-01` raw report is retained; `collection-final`/`collection-final-02` provide actual per-target state.

`reused-second-output` specifically covers preexisting trial-1 while trial-0 is absent: exit 1, UNKNOWN, comparison starts 0. This is an additional W1c guard, not a reopening of either P2 aggregator finding. `offline-final` uses retained derivative copies of the accepted final normal evidence for interrupted JSON, missing completion, another-trial runtime and changed logs; all are INVALID/exit 1 with zero **new** comparison events. Copied historical spawn events are counted separately. Reusing the original output directory also exits 1 without changing its raw evidence.

Zero runner events mean the instrumented comparison spawn call was not made; they do **not** prove absence of processes across Windows. Git, npm and collection wrappers are separate process categories. No OS-wide process absence claim is made.

`.github/workflows/stage-w1-verifiers.yml` adds an Ubuntu-only pure verifier job, without installing product dependencies or moving Windows-specific requirements into portable CI. It runs the old/new aggregator regressions and portable admission controls. `stage-w1c-mutation-check.mjs` copies the aggregator into a new temporary fixture, forces its final status to PASS, and proves the unchanged regression suite exits 1. CI therefore actively checks that this false-PASS mutation is detected. Original production CI remains unchanged.

## Regression, preservation, and final-head CI

`validation/results.json`: related product 8 files/154 tests, full tracked product 98 files/2,587 tests, lock, TypeScript and build all exit 0, using the existing 5000ms/two-worker product configuration. Product tests use `src/test` so preserved intentional-failure temporary fixtures cannot contaminate the run. The unchanged W1b validation driver invokes bundled npm 11.19.0; this is separate from the fixed 11.17.0 snapshot builds and worker probes. Product code did not change after validation. Final diagnostic-only guards are covered by `accepted-final`, final negative controls and verifier regression; final pushed HEAD CI must be checked separately.

`preservation-after.json`: **103 protected original W1 files/scripts**, raw before/after mismatch 0 and prior-103-manifest mismatch 0. Both entire original snapshot trees, including directories, also retain the same digests. W1b's old 624/625 raw differences, 220/224 extras and one result-cache-file difference remain historical observations; none were normalized, repaired or deleted. Old evidence, previous snapshots, existing temporary fixtures and five original W1 scripts are unchanged. The SHA-256 evidence manifest excludes itself; a readback check independently recomputes its entries before submission.

Raw source/dependency installation payloads remain in the workspace. Public Git evidence contains manifests, small raw process outputs and controls, without tokens, authentication material or personal Library retrieval URLs. CI evidence for the final commit is saved locally outside this committed evidence directory and linked with its exact head SHA in PR #218. `acceptance.json` explicitly records CI as pending-at-commit; an older successful CI is never assigned to a newer HEAD. The final PR completion section is the authoritative final-head CI status, avoiding a self-referential evidence commit loop.

## Reproduction and next stage

Use **new** output, snapshot and fixture directories on every invocation. Do not reuse or clean the retained directories.

```powershell
$env:W1C_NPM_CLI = "$env:APPDATA/npm/node_modules/npm/bin/npm-cli.js" # verify 11.17.0 first
node scripts/stage-w1c-snapshots.mjs ../NEW-W1C-SNAPSHOTS NEW-EVIDENCE
# Freeze the shared test selection in a NEW plan derived from limited-plan.json.
node scripts/stage-w1b-runner.mjs prepare NEW-PLAN.json NEW-PREPARED
# Only when prepare returns READY:
node scripts/stage-w1b-runner.mjs launch NEW-PREPARED
node scripts/stage-w1b-runner.mjs verify NEW-PREPARED

node scripts/stage-w1b-review-controls.mjs NEW-CONTROLS NEW-FIXTURES
node scripts/stage-w1b-negative-controls.mjs NEW-CONTROLS/fixture-plan.json NEW-NEGATIVE NEW-CONTROLS/connected-normal
node scripts/stage-w1c-output-control.mjs NEW-CONTROLS/fixture-plan.json NEW-REUSED-SECOND
node scripts/stage-w1c-offline-controls.mjs NEW-CONTROLS/connected-normal NEW-OFFLINE NEW-CONTROLS/fixture-plan.json
node scripts/stage-w1b-collection-control.mjs NEW-COLLECTION NEW-COLLECTION-FIXTURES
node --test scripts/stage-w1-summary-check.mjs scripts/stage-w1b-summary-check.mjs scripts/stage-w1c-check.mjs
node scripts/stage-w1c-mutation-check.mjs
node scripts/stage-w1b-validate.mjs NEW-VALIDATION
```

Next: independently review these guards and evidence; define and test a justified treatment of Vite's generated directory/cache transitions on another independently built snapshot pair. Preserve the distinction between installation state, pre-collection state, pre-execution state and generated outputs. Establish real settings/inventory and both limited product launches before considering large ABBA. No directory/cache permission should be inferred from this report. R8/H1–H4 remain UNKNOWN; no cause of intermittent Windows failures was identified. Draft release, merge and branch deletion are prohibited.

2026-11-15 JST

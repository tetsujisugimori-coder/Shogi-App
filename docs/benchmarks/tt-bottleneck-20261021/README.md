# TT bottleneck diagnosis (2026-10-21)

## Purpose and decision

PR #196/#198 reduced complete identity generation without establishing a general speedup. This investigation measures the remaining work separately from ordinary performance. Historical benchmark timings are not reused as evidence of this run's performance.

Decision: **B — safety preserved; performance benefit is limited and position dependent.** No product code change is adopted. TT remains explicitly opt-in and OFF by default. There is no D implementation: a further small, safe change with a demonstrated timing benefit was not established. This decision is about the current TT and this diagnostic addition; it is not a claim about playing strength.

## Fixed sources and environment

- Fetched `origin/main`: `b031decd02ed32a036e43d88829a217cc385b70d`.
- GitHub #196 MERGED at `2026-10-21T03:58:14Z`, merge `f5fdb17c777f34e4db34d903135f6a5dc88e93c9`.
- GitHub #198 MERGED at `2026-10-21T11:42:18Z`, merge `b031decd02ed32a036e43d88829a217cc385b70d`.
- A: current main, TT OFF. B: #196 merge, old TT ON. C: current main/#198 merge, TT ON.
- Measurement runner frozen at `a144e6ad6d0749922576fc966ac0313855d52eef`. Subsequent changes extend only offline auditing/reporting and the separate wrapper-overhead run. Measured source byte snapshots are retained independently of later edits.
- Windows, Intel Core i7-14650HX, Node v24.20.0, npm 11.17.0. Each plan records OS release, CPU, roots, Node, input states, settings, source hashes and time. Dependencies are the same installed `node_modules` via junctions. Affinity, power/frequency, OS scheduling, JIT and GC are uncontrolled.
- Original checkout was clean. Existing branches/worktrees and earlier benchmark directories were retained. The working branch is `codex/tt-bottleneck` in a dedicated worktree outside the original checkout. No old diagnostic originals are modified.

## Measurement method

Normal `run1` has no internal TT stage clocks, diagnostic wrappers, CPU profiler or per-node logging. A/B/C execute in independent persistent Node processes, each importing product modules only from its own fixed checkout. The bootstrap uses Node built-ins; fixture and PV helpers load in the parent only. Before execution the runner verifies HEAD, tracked product diff, and absence of untracked `src` files in both fixed checkouts. A and C intentionally use separate processes even though their source SHA is identical.

For each cell: one warmup followed by seven measured calls; ABC/BCA/CAB rotates continuously, including warmup. Calls execute serially. Input protection, IPC, hashes, result validation and writing are outside the timed search. CPU usage brackets the same call. No tests or builds run alongside performance measurements. Each public invocation creates its own TT; persistent processes do not create persistent tables.

All seven requested positions are included: `mate-sente`, `resistance`, `evasion`, `capture`, `terminal-resistance-gote`, `recapture`, `mixed-distance`. Each uses fixed depth 4, unlimited iterative depth 1–4, 100ms and 1,000ms with maximum depth 4. Evaluation defaults resolve to the existing `standard` preset (all four coefficients 1), standard move ordering, `killerMoves=false`, `usePreviousIterationPv=false`, quiescence `original` and `maxTacticalDepth=1`. No requested position or search condition is omitted. Deeper depth 5, full games and other positions are outside this scoped investigation.

`pilot` uses one warmup and one measured call in all 28 cells (168 calls) to estimate cost. Its initial bootstrap also imported the runner's current helper module graph in the B process, although old search still used its separate absolute module path. Independent review identified this strict-isolation issue; it was corrected before `run1` and `diagnostic`. Pilot timings are therefore excluded from performance conclusions. Some source preparation also took place during this pilot. The raw pilot evidence is retained with this limitation.

`run1` contains 84 warmups and 588 measured calls (672 total). Per-cell distributions, p50, p95, min/max, total CPU time, normal/q node counts, complete results, PV and TT counters are retained in raw/summary. Nearest-rank p95 with n=7 equals the maximum and is an unreliable estimate of a population tail. Paired rotations reduce ordering bias but do not remove environmental drift. Aggregate sums weight slow positions heavily and must be read with the position tables.

For time-limited searches, normal/q `total*` counters cover completed iterations only; interrupted work is excluded by the existing product contract. `partialRoot.attemptedStatistics` is retained where returned, but total interrupted work is not fully observed. TT statistics include interrupted iterations. Do not divide these two different populations to derive per-node overhead. Time differences at a fixed budget also include differences in completed work; they are not a direct speed benchmark.

## Evidence and results

- [Ordinary comparison](comparison.md), [aggregate counters/CPU/times](comparison.json).
- [Per-cell p50/p95, range and CPU](run1/results.md), [complete summary and distributions](run1/summary.json).
- [Stage and unprofiled wrapper-control tables](stages.md), [stage raw summary](diagnostic/summary.json), [wrapper control](overhead/summary.json).
- [Whole-process sampled CPU self times](cpu-samples.json); the original profile is retained as `diagnostic/C.cpuprofile.gz`.
- Each run has `plan.json`, `completed.json`, `raw.jsonl.gz` and `sources.json.gz`. The source bundle is a gzip JSON object mapping each plan source name to the original bytes in base64. Bundling preserves all individual source hashes while keeping the PR reviewable. The completion file authenticates the decompressed raw byte hash. Plans authenticate source byte hashes and full serialized input hashes. Summary generation checks these before processing.

Normal measurement completed from 21:32:02 JST; exact finish timestamps are in each completion marker. All 672 calls succeeded, with zero exceptions or missing samples. Diagnostic 56, wrapper-control 64 and pilot 168 calls also completed: 960 calls retained overall. Pilot is excluded from performance inference.

| Seven positions, seven measured repeats | A OFF | B old ON | C current ON |
|---|---:|---:|---:|
| Fixed d4 sum of wall ms | 81,701.108 | 82,036.452 | 82,253.203 |
| Unlimited iterative sum of wall ms | 70,927.266 | 75,613.669 | 74,554.193 |
| Combined wall ms | 152,628.374 | 157,650.121 | 156,807.397 |
| Combined CPU ms | 144,230 | 151,422 | 148,783 |
| Combined ordinary nodes | 193,424 | 192,738 | 192,738 |
| Combined q nodes | 51,688 | 43,330 | 43,330 |
| Combined identity generations | 0 | 192,752 (inferred) | 112,280 |

B→C identity generation falls **41.75%**, but combined observed wall time falls only **0.53%** and CPU time **1.74%**. Fixed alone worsens **0.26%**, iterative improves **1.40%**. C combined wall is **2.74% slower than A OFF** in this sample. C/B fixed p50 improves in 5/7 positions and worsens in 2/7; iterative p50 improves in 5/7 and worsens in 2/7. These are observations, not established population speedups.

Variability is a major limitation, not a small error bar: `mate-sente` iterative measured A spans **1,560.179–11,166.108ms**, B **1,508.889–11,004.589ms**, C **1,512.415–10,841.761ms**, with identical work counts/results within each variant. Its p50 changes sharply depending on which mode has four samples. The cause of these multi-fold runtime phases was not isolated (no claim that JIT, power, GC or scheduling alone caused them). The 0.53% aggregate change is far smaller than this variation; seven samples do not establish a reliable benefit. The full distributions are retained and no outliers are discarded.

In fixed+iterative C, lookups are 192,752, misses **165,550 (85.89%)**, hits 27,202, exact reuse 27,118, stores 85,162, non-exact store rejects 80,472 and evictions 54,306. Size rejection is 0, so speculative removal of a copy before a size rejection has no observed benefit in these positions. B/C reuse, stores and ordinary/q work are identical. Relative to A, C reduces ordinary nodes only **0.35%**, q nodes **16.17%**. This is a measured reduction in counted computation, not a proportional reduction in wall time.

For example, fixed `resistance` has 131 reuses, but A→C ordinary nodes stay 312→312 and q nodes change only 24→23. `terminal-resistance-gote` has 64 reuses with ordinary 282→282 and q 38→38. Evaluation and result work can still be skipped; these counts show why a reuse must not be counted as an avoided full subtree. The action producing each probed state has already been executed.

The instrumented `mate-sente` call observes key A **255.266ms**, full identity C **190.874ms**, clone H **14.427ms**, and inclusive store G **64.878ms**, against P wall **8,824.764ms**. These overlapping, perturbed measurements show remaining key cost and a relatively small copy cost; they do not quantify production-exclusive shares or estimate B's eliminated identity cost. Whole-process CPU samples also retain substantial board-state-copy, repetition/key, move-generation, drop-validation and attack-check self samples. `createPositionKey` samples include its calls throughout execution/repetition, not only TT keys. Raw CPU sampling supports investigating work outside TT without attributing all such samples to TT.

Unprofiled C/P controls have p50 changes **−0.03%, +1.94%, +0.75%, −0.53%** for resistance/evasion/capture/mixed-distance. Paired median deltas are +0.502/+1.750/+1.085/+1.558ms, but capture includes a +277.356ms paired delta and C itself spans 65.882–519.717ms. Thus the added timing machinery perturbs execution and fine stage ranks are unreliable. These separate processes also have a different workload history and absolute timing scale from normal run1; do not compare their absolute call times directly. Calibration's empty wrapper delta is likewise only a local observation, not a universal per-read cost.

100ms has A/C identical depth histograms: d0=7, d1=8, d2=20, d3=14; B has d0=7, d1=7, d2=21, d3=14. All have seven partial-root and 42 completed-iteration results. Among paired A-vs-B/C comparisons, `capture` has three measured depth differences: B and C complete d2 versus A d1 at repeat 0; C completes d1 versus A d2 at repeat 1. There is **no same-completed-depth result difference**. At 1,000ms all variants have d2=7, d3=7, d4=35, all completed-iteration. No consistent depth improvement is established. Maximum overruns A/B/C are **2.720/2.713/2.421ms** at 100ms and **0.974/0.886/2.033ms** at 1,000ms. A smaller time-budget overrun is not proof of better playing strength.

## Stage diagnosis and interpretation

`prepare-tt-profile.ts` generates a separate source tree for P. The normal source tree is never edited for instrumentation. The generator uses fail-closed exact replacements and parsed function bodies; its output product files are included in the P source archive. Diagnostic fixed searches have one warmup and one measured call per position. A/B/C/P execute separately and serially. Only diagnostic C uses V8 CPU sampling. Therefore diagnostic C/P wall differences are not a clean wrapper-overhead estimate.

The separate `overhead` run compares unprofiled C/P, each with one warmup and seven measurements, rotating CP/PC, on four bounded representative positions (`resistance`, `evasion`, `capture`, `mixed-distance`). This controls actual wrapper overhead without the extra cost of re-running the slowest positions; it is not a new product optimization comparison. `calibration.json` separately measures the actual empty wrapper against a plain callback branch, with an excluded warmup and seven trials. Neither observation is used as a correction factor for stage timings.

| Requested stage | Observation |
|---|---|
| A coarse key | `key` inclusive of `createPositionKey` and outer JSON serialization, on every lookup including miss |
| B candidate lookup | `Map.get` wrapper; tiny timings are strongly affected by clock/callback cost |
| C full identity | full context/outer JSON plus core state/history identity; core is nested within full |
| D equality | full string inequality predicate; wrapped clock/closure overhead is material |
| E exact reuse | inclusive `probe`, including B, lazy C, D and accounting; actual reuse/hit/reject counts remain available |
| F store eligibility | `ttExact` flag test and size-limit check separately; no independent exactness recomputation is added |
| G store | inclusive serialization, capacity/FIFO/Map and counters; payload stringify is nested |
| H result/PV/breakdown copy | `cloneSearchNodeResult` for stores and hits; unrelated copies elsewhere in search are not included |
| I capacity/eviction | the post-size-check FIFO/Map/accounting block; eviction counts distinguish capacity pressure |

These are inclusive, nested, instrumented observations. They must not be summed into a product wall-time breakdown, interpreted as production-exclusive times, or used to rank nanosecond operations. Instrumented proxy accesses, closures, JIT and scheduling can perturb results. CPU samples are whole diagnostic C process self samples, including imports, input preparation, IPC and idle; they are not per-position or exclusive search measurements.

The following source facts explain why identity count reduction alone does not imply proportional speedup:

1. On a miss, the coarse key and Map/accounting still run. `getIdentity` skips non-exact misses, but cannot skip the coarse key used to establish a miss.
2. The current closure memoizes the identity. Candidate mismatch followed by exact store reuses that identity; it is not regenerated at store. Non-exact results increment rejection counters without cloning or calling store. Existing targeted TT regressions protect both paths.
3. `searchAlphaBetaNodeUncached` executes a child action and increments the visited count before entering the child's TT probe. An exact hit cannot undo the cost of producing the child state. This investigation compares ordinary and q counts to show how much work was actually skipped; it does not treat every hit as an avoided full node.
4. Exact-only storage rejects bound/pruned results. Those restrictions, history identity, depth/ply and FIFO capacity limit reuse intentionally. No LOWER/UPPER reuse, hash replacement, larger capacity, cross-call sharing or order change is introduced.
5. Copy/stringify/FIFO costs exist, but the observed small copy/equality cost does not justify weakening ownership, identity or capacity safety. Cache reuse of history-tail keys would require additional normalization/input proof. No safe, measured small product optimization was established here.

## Correctness and independent review

The offline auditor requires complete cell/repeat/variant coverage, unique samples, sequence and raw/source/input hashes, finite timings, TT accounting and capacity limits. Every PV is replayed through legal actions and its leaf evaluation breakdown checked. Selected actions must be legal and match the non-fallback PV head. Fixed/iterative selected action, evaluation, PV and breakdown match A; B/C also match complete results excluding elapsed time and legacy TT counters. Instrumented P must match C results and all TT counters. Timed comparisons classify differing completed depths separately from differing results at the same depth. Any such difference is retained in `timedDifferences`, not silently accepted as a fixed-result equivalence.

No product code is changed, so root player/depth/ply, piece IDs/hands, history/repetition/perpetual check, 500-move rule, exact proof, shortest win/longest loss, partial-root/fallback, deadline positions, NaN/RangeError, PV ownership and FIFO remain the same implementation. The existing tests are run without weakening assertions, timeouts or worker settings. New audit regressions check warmup exclusion, missing/duplicate samples, bad evaluations/accounting, selected-action/PV mismatch, time-limited classification and nearest-rank p95.

An independent agent reviewed the runner, source generator, audit and regressions. It identified and the implementation corrected worker bootstrap imports, ambiguous old-counter inference, wrapper calibration, and selected-action/PV validation. Old B identity count is explicitly inferred as one per lookup; its inferred store rejection counter includes size rejects and is not presented as a measured non-exact-only counter. Timed completed-node limitations and sampling/wrapper separation are documented above. Final review and check results are saved in `validation.md` and `review.md`.

## Reproduction

Use the repository's required Node/npm versions and identical installed dependencies. Keep all checkouts outside one another so Vitest does not recursively discover their tests. Create dedicated fixed worktrees without modifying existing work:

```powershell
git fetch origin main
git worktree add --detach ../tt-old f5fdb17c777f34e4db34d903135f6a5dc88e93c9
git worktree add --detach ../tt-current b031decd02ed32a036e43d88829a217cc385b70d
# Install the same lockfile dependencies in each tree, or junction identical node_modules.
node --import tsx scripts/prepare-tt-profile.ts ../tt-current ../tt-profile
# Supply identical dependencies to tt-profile too.
node ../tt-profile/calibrate.mjs > calibration.json
node --import tsx scripts/measure-tt-bottleneck.ts pilot NEW-PILOT ../tt-old ../tt-current
node --import tsx scripts/measure-tt-bottleneck.ts run NEW-RUN ../tt-old ../tt-current
node --import tsx scripts/measure-tt-bottleneck.ts diagnostic NEW-DIAGNOSTIC ../tt-old ../tt-current
node --import tsx scripts/measure-tt-bottleneck.ts overhead NEW-OVERHEAD ../tt-old ../tt-current resistance,evasion,capture,mixed-distance
```

Destination parent directories must exist; each run creates a new destination and refuses reuse. Do not run tests/builds during measurement. To regenerate committed summaries without checkouts or re-running search:

```powershell
$evidence='docs/benchmarks/tt-bottleneck-20261021'
foreach($run in @('pilot','run1','diagnostic','overhead')) {
  node --import tsx scripts/audit-tt-bottleneck.ts "$evidence/$run"
}
node --import tsx scripts/report-tt-bottleneck.ts $evidence
node --import tsx scripts/manifest-tt-bottleneck.ts $evidence
npm run check
git diff --check
```

Existing `summary.json` is verified rather than overwritten. Delete only a separate generated summary copy when intentionally testing regeneration; raw evidence is immutable. `.gz` raw/profile files are automatically read by the offline tools. The pilot's historical runner snapshot differs from the corrected reproducible command, as documented above.

## Remaining questions and next work

This sample covers constructed diagnostic positions, not full-game distribution, tournament outcomes or strength. Seven samples give weak p95 estimates; one instrumented sample per stage/position cannot establish fine timing ranks. Miss-specific exclusive time, skipped-subtree cost and all interrupted nodes remain unobserved. A different machine, thermal state, long real history or tactical configuration may behave differently. Coarse key cost and action/legal-generation CPU work deserve separate investigation only if future goals justify the scope.

Keep TT OFF by default and pause additional TT optimization. Next prioritize tactical evaluation and move-quality regressions with independently verified poisoned captures, evasion and terminal-distance cases. Preserve time-limit/partial-root quality checks and distinguish playing-strength measurements from speed measurements. No auto-merge is enabled; the PR stops for human review.

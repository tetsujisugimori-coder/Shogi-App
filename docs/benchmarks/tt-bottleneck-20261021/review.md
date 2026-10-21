# Independent technical review

Independent reviewer: separate Codex agent `independent_review`, read-only. The reviewer did not implement the change, execute tests/builds during measurement, or write these artifacts. Review covered runner, generated instrumentation, audit/regressions, source preservation, reports and conclusions. Parent summarized the returned review below.

## Findings and resolution

1. **Worker bootstrap imported current product helpers in the old process.** Moved fixture/PV imports to the parent branch and made worker bootstrap Node-built-in-only. Verified the fixed-SHA worker import paths. Completed initial pilot is retained but excluded from timing conclusions; all normal and stage/overhead evidence uses corrected bootstrap.
2. **Old inferred store-reject name implied non-exact-only data.** Renamed to `storeRejectsInferredIncludingSize`; old counter cannot distinguish size rejection. Identity generations are explicitly inferred as one per lookup, not described as a separately measured old counter.
3. **Calibration did not exercise the actual wrapper.** Replaced a plain clock loop with the generated helper's empty callback versus unwrapped loop, rotating order, warmup excluded. No correction factor is applied.
4. **Selected action/PV consistency was not checked.** Auditor now verifies selected-action legality and non-fallback PV-head equality. Replaced an invalid synthetic action in the classification regression with a legal alternative PV and recomputed evaluation; added rejection regression.
5. **Timing interpretation limitations.** Documented that C CPU sampling is a separate diagnostic experiment; wrapper overhead uses unprofiled C/P. Timed node totals omit interrupted work while TT counts include it. Inclusive/nested stage times are not added into product wall time. Explicitly disclosed multi-fold time phases and differing process workload histories.

All findings above are resolved. Subsequent audit improvements verify full B/C results except elapsed time and legacy counters, P/C complete results/all counters, instrumented call counts, completed timed iteration prefixes and independent partial-root q values.

## Final review, 2026-10-21 21:48 JST

**No blocking findings; supports B and no product change.** Reviewer independently read saved aggregates and checked README/LOG rounding and interpretation:

- B→C combined wall 157,650.1207→156,807.3967ms; CPU 151,422→148,783ms; identity 192,752→112,280.
- A combined wall 152,628.3737ms; ordinary nodes 193,424→192,738; q nodes 51,688→43,330.
- Normal 672 calls, 84 warmups, 224 fixed comparisons match. Three timed differences are completed-depth differences in `capture`; none is a same-depth result difference.
- Large variation is disclosed; the observed 0.53% is not called an established improvement. CPU/profile scope, wrapper perturbation, unfinished-work limits, hashes and regeneration are appropriately described.
- Reviewer checked the successful ordinary check log: 79 files / 2,085 tests and build. Reviewer did not independently execute that suite.

## Packaging follow-up, 2026-10-21 21:51 JST

**No blocking findings.** Source bundling stores original bytes as base64; audit checks exact key coverage and every decoded individual SHA-256, retaining old-format support. It does not affect measured product execution or raw results. Reviewer requested final check completion and manifest verification, then final pushed HEAD/CI reconciliation by the parent.

Remaining technical uncertainty: the runtime phase variation itself is not isolated; this evidence cannot establish general speed or playing-strength gains. Deferring further TT optimization in favor of tactical evaluation and move-quality work is reasonable. The reviewer does not approve a merge; no merge or auto-merge is performed.

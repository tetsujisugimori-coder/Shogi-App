// Read-only identity admission; no caller-provided READY or approval bypass.
import { execFileSync } from 'node:child_process';
import { FIXED_HEADS } from './stage-w1g-gate.mjs';
const trees = ['5ced08e0036f955833ca2e12722bfbd595a00afd','3d06ccd81473b78bc3eb721c516693042ae2c118'];
function stop(code) { const e = Error(code); e.code = code; throw e; }
export function admitTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) stop('W1H_TARGET_IDENTITY_UNKNOWN');
  for (const t of targets) {
    if (!t || typeof t.head !== 'string' || !/^[a-f0-9]{40}$/.test(t.head)
      || typeof t.repo !== 'string' || !t.repo || typeof t.dir !== 'string' || !t.dir) stop('W1H_TARGET_IDENTITY_UNKNOWN');
    if (FIXED_HEADS.includes(t.head)) stop('W1G_FIXED_COMPARISON_BLOCKED');
    for (const flags of [[], ['--no-replace-objects']]) {
      let head, tree;
      try {
        const git = suffix => execFileSync('git', [...flags, '-C', t.repo, 'rev-parse', '--verify', t.head + suffix],
          { encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:10000, maxBuffer:1024*1024 }).trim();
        head=git('^{commit}'); tree=git('^{tree}');
      } catch { stop('W1H_TARGET_IDENTITY_UNKNOWN'); }
      if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(tree)) stop('W1H_TARGET_IDENTITY_UNKNOWN');
      if (FIXED_HEADS.includes(head) || trees.includes(tree)) stop('W1G_FIXED_COMPARISON_BLOCKED');
    }
  }
}
export const rejection = e => ({status:'UNKNOWN', code:e.code ?? 'W1H_ADMISSION_REJECTED', reason:String(e)});

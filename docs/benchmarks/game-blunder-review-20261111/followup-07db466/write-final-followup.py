import hashlib,json,pathlib,re,subprocess,tarfile
from datetime import datetime,timezone,timedelta

root=pathlib.Path.cwd()
out=(root/'../.shogi-independent-review-20261111').resolve()
d=root/'docs/benchmarks/game-blunder-review-20261111'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
sha=lambda b:hashlib.sha256(b).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],encoding='utf8').strip()
assert head=='07db466b6f11558c9eb257a49c21f1dd6f3a4753'
source='1edc169cc9ff27b7c77e825e95b893e5b0252ed1'
paths=['scripts','src','package.json','package-lock.json','tsconfig.json','vite.config.ts','.github']
assert not subprocess.check_output(['git','diff',source,head,'--',*paths],encoding='utf8')
assert not subprocess.check_output(['git','diff','HEAD','--',*paths],encoding='utf8')
assert not subprocess.check_output(['git','diff','--cached','HEAD','--',*paths],encoding='utf8')
diff=subprocess.check_output(['git','diff','--name-only',source,head],encoding='utf8').splitlines()
assert all(p.startswith('docs/benchmarks/game-blunder-review-20261111/') for p in diff)
manifest=read(d/'independent-archive-manifest.json')
with tarfile.open(d/manifest['archive'],'r:gz') as t:
    members={m.name:m for m in t.getmembers() if m.isfile()}
    assert len(members)==len(manifest['files'])==41
    for row in manifest['files']:
        data=t.extractfile(members[row['path']]).read()
        assert len(data)==row['bytes'] and sha(data)==row['sha256']
        assert data==(out/row['path']).read_bytes()
evidence=read(d/'evidence-manifest.json')['files']
for row in evidence:
    data=(d/row['path']).read_bytes()
    assert len(data)==row['bytes'] and sha(data)==row['sha256'],row['path']
for dest,original in [('independent-review.md','REVIEW.md'),('independent-audit.json','audit.json'),
                      ('independent-results.json','results-1edc169-v2/results.json')]:
    assert (d/dest).read_bytes()==(out/original).read_bytes()
before=read(d/'originals-before.json')
assert all(sha((root/r['path']).read_bytes())==r['sha256'] for r in before)
plan=json.loads((d/'fixed-run/observations.jsonl').open(encoding='utf8').readline())
assert all(sha((root/p).read_bytes())==h for p,h in plan['sourceHashes'].items())

ci=read(out/'ci-direct.json')
assert ci['headSha']==head and ci['status']=='completed' and ci['conclusion']=='success'
parent_ci=read(out/'ci-final.json')
assert parent_ci['headSha']==head and parent_ci['conclusion']=='success'
pr=read(out/'pr-direct.json')
assert pr['headRefOid']==head and pr['isDraft'] is True and pr['state']=='OPEN'
assert pr['mergedAt'] is None and pr['autoMergeRequest'] is None
raw_log=(out/'ci-direct.log').read_text(encoding='utf-8-sig')
clean=re.sub(r'\x1b\[[0-9;]*m','',raw_log)
clean=re.sub(r'\^\[\[[0-9;]*m','',clean)
jobs=[]
for job in ci['jobs']:
    assert job['status']=='completed' and job['conclusion']=='success'
    steps=[s for s in job['steps'] if s['name'] in ['Verify package-lock integrity','Run TypeScript type check','Run test suite','Run production build']]
    assert len(steps)==4 and all(s['conclusion']=='success' for s in steps)
    lines=[line for line in clean.splitlines() if line.startswith(job['name']+'\tRun test suite\t')]
    test=next(line for line in lines if re.search(r'\bTests\b',line))
    files=next(line for line in lines if 'Test Files' in line)
    passed=int(re.search(r'(\d+) passed',test).group(1))
    skipped_match=re.search(r'(\d+) skipped',test)
    skipped=int(skipped_match.group(1)) if skipped_match else 0
    suites=int(re.search(r'(\d+) passed',files).group(1))
    assert suites==98
    assert (passed,skipped)==((2587,0) if 'ubuntu' in job['name'] else (2585,2))
    jobs.append({'name':job['name'],'status':job['status'],'conclusion':job['conclusion'],
                 'suitesPassed':suites,'testsPassed':passed,'testsSkipped':skipped,
                 'steps':[{'name':s['name'],'conclusion':s['conclusion']} for s in steps]})
assert {j['name'] for j in jobs}=={'Verify on ubuntu-latest','Verify on macos-latest'}

pair=read(out/'pair-nan-followup/result.json')
pair_exit=read(out/'pair-nan-followup-exit.json')
assert pair['head']==head and pair['status']=='PASS' and pair_exit['exitCode']==0
assert pair['condition']['reproducible'] is False and pair['condition']['judgment']['delta'] is None
assert pair['invalid']['count']==2 and pair['invalid']['byReason']=={'non-finite-evaluation':2}
assert pair['rootReproducible']==24
recorded=datetime.now(timezone(timedelta(hours=9))).isoformat()
result={'recordedAtJST':recorded,'head':head,'sourceHead':source,
        'overall':'PARTIAL','mergeRecommendation':'NO',
        'closures':{'P2-01':'PASS','P2-02':'PASS','P3-01':'PASS'},'newUnresolvedFindings':[],
        'unresolved':{'R8':'PARTIAL','windowsRootCause':'UNKNOWN'},
        'finalSourceVerification':{'docsOnlyDiff':True,'changedEvidenceFiles':len(diff),'codeDiff':'',
                                  'sourceFilesVerified':len(plan['sourceHashes']),
                                  'archiveFilesVerified':41,'evidenceManifestFilesVerified':len(evidence),
                                  'archiveSha256':sha((d/manifest['archive']).read_bytes()),
                                  'readableCopiesByteIdentical':True,'originalFilesVerified':len(before)},
        'ci':{'source':'direct gh run view and --log','url':ci['url'],'headSha':ci['headSha'],
              'status':ci['status'],'conclusion':ci['conclusion'],'jobs':jobs,
              'directJsonSha256':sha((out/'ci-direct.json').read_bytes()),
              'directLogSha256':sha((out/'ci-direct.log').read_bytes()),
              'matchesImplementationProvidedHeadAndConclusion':True},
        'pullRequest':{k:pr[k] for k in ['url','headRefOid','isDraft','state','mergedAt','autoMergeRequest']},
        'pairNaN':{'processExitCode':pair_exit['exitCode'],'inputSha256':pair['mutatedInputSha256'],
                   'sourceInputSha256':pair['sourceInputSha256'],'targetId':pair['targetId'],
                   'condition':'baseline','kind':'actual','repetitions':[0,1],
                   'reproducible':False,'delta':None,'invalid':pair['invalid'],
                   'rootReproducible':24,'affectedFactors':pair['affectedFactors'],
                   'verdict':pair['verdict'],'priority':pair['priority']}}
with (out/'FINAL-FOLLOWUP.json').open('x',encoding='utf8') as f:
    json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
md=f"""# 最終HEADの独立レビュー追補

07db466b6f11558c9eb257a49c21f1dd6f3a4753時点の事実を追記する。既存REVIEW.md、v1/v2入力・結果、41ファイルのarchiveは保持した。

## 判定

総合PARTIAL、マージ推奨NO。P2-01、P2-02、P3-01はPASSとして閉鎖可能。新規未解決指摘は0件。Windows既定5秒の全体試行の失敗が残り、R8はPARTIAL、原因はUNKNOWNを維持する。

## 最終コードと証拠

実装HEAD 1edc169からの85変更は全て新証拠ディレクトリ内だった。scripts、src、package、lock、config、workflowのコミット差分と作業差分は空だった。source99件のraw hash、旧原本48件のSHA、archive内41ファイルと全保存bytes、evidence-manifestの88ファイル、readable3コピーのbyte一致を独立に再検証した。

archive SHA-256は{result['finalSourceVerification']['archiveSha256']}。

## GitHubの直接照会

独立担当がghで最終CI JSON・raw log・PR状態を直接取得した。CIのheadShaは07db466に一致し、completed/successだった。Ubuntuは98 suite・2587成功、macOSは98 suite・2585成功・既存2 skipped。両jobの型検査、lock検証、全体テスト、buildは全て成功だった。skippedを成功件数へ含めていない。

PR #218はOPEN・Draft、mergedAtとautoMergeRequestはnullだった。[GitHubのCI実行]({ci['url']})

取得した一次記録はci-direct.json、ci-direct.log、pr-direct.json。実装担当が保存したCIのHEADと結果も直接照会結果へ一致した。

## pair-fixedのNaN追試

新schema3のhirate-1 / ply9 / baseline actualのrep0とrep1だけを、NaNタグのselectedEvaluationとtotalへ改変し、repeatKeyを再計算した。実プロセス終了コードは0。

該当条件はreproducible=false、正式deltaと両候補の表示scoreはnullとなった。対象pair-fixedの2観測がnon-finite-evaluationで原因付き除外され、root24/24は有効のままだった。該当groupの各要因比較はEXPERIMENT_INVALID、deltaChangeはnullだった。

元の実験原本と既存v2は編集していない。pair-nan-followup.mjs、pair-nan-followup/input.jsonl・summary.json・result.json、pair-nan-followup.log、pair-nan-followup-exit.jsonで追試を再計算できる。入力SHA-256は{pair['mutatedInputSha256']}。

旧疑い4局面のINDETERMINATE、CONFIRMED=0、改善優先順位NOT_READYを維持する。

{datetime.now(timezone(timedelta(hours=9))).strftime('%Y年%m月%d日 %H:%M JST')}
"""
with (out/'FINAL-FOLLOWUP.md').open('x',encoding='utf8') as f:f.write(md)
print(json.dumps({'head':head,'ci':ci['conclusion'],'jobs':jobs,'archiveFilesVerified':41,
                  'manifestFilesVerified':len(evidence),'pairNaN':'PASS','overall':'PARTIAL','mergeRecommendation':'NO'}))

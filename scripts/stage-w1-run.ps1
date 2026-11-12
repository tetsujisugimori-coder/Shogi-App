param([Parameter(Mandatory=$true)][string]$Snapshots, [Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference = 'Stop'
$order = @('old','new','new','old','new','old','old','new')
$observed = @(1,2,5,6)
$node = (Get-Command node.exe).Source
$Evidence = (Resolve-Path -LiteralPath $Evidence).Path
for ($i = 0; $i -lt $order.Count; $i++) {
  $n = $i + 1
  $head = $order[$i]
  $dir = Join-Path $Snapshots $head
  $out = Join-Path $Evidence ("run-{0:D2}" -f $n)
  if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite $out" }
  New-Item -ItemType Directory -Path $out | Out-Null
  $json = Join-Path $out 'vitest.json'
  $stdout = Join-Path $out 'stdout.log'
  $stderr = Join-Path $out 'stderr.log'
  $metrics = Join-Path $out 'process-metrics.jsonl'
  $args = @('node_modules/vitest/vitest.mjs','run','--reporter=default','--reporter=json',"`"--outputFile.json=$json`"")
  $start = [DateTimeOffset]::Now
  $before = & $node -e "const os=require('os');console.log(JSON.stringify({time:new Date().toISOString(),freeBytes:os.freemem(),totalBytes:os.totalmem(),parallelism:os.availableParallelism()}))" | ConvertFrom-Json
  $p = Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $dir -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if ($n -in $observed) {
    while (-not $p.HasExited) {
      $sample = [ordered]@{ time = [DateTimeOffset]::Now.ToString('o'); scope = 'all visible node processes; attribution unavailable'; processes = @(Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ pid=$_.Id; cpuSeconds=$_.CPU; workingSetBytes=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64 } }) }
      $sample | ConvertTo-Json -Depth 5 -Compress | Add-Content -Encoding utf8 $metrics
      Start-Sleep -Seconds 2
      $p.Refresh()
    }
  }
  $p.WaitForExit()
  $end = [DateTimeOffset]::Now
  $after = & $node -e "const os=require('os');console.log(JSON.stringify({time:new Date().toISOString(),freeBytes:os.freemem(),totalBytes:os.totalmem(),parallelism:os.availableParallelism()}))" | ConvertFrom-Json
  [ordered]@{sequence=$n; head=$head; start=$start.ToString('o'); end=$end.ToString('o'); command='node node_modules/vitest/vitest.mjs run --reporter=default --reporter=json --outputFile.json=<run>/vitest.json'; exitCode=$p.ExitCode; maxWorkers=2; processSampling=($n -in $observed); before=$before; after=$after; gc='NOT_MEASURED'; workerAttribution='NOT_MEASURED'; paging='NOT_MEASURED'; cleanup='NOT_MEASURED'} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $out 'run.json')
}

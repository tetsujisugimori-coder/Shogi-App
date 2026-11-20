# The original Stage W1 ABBA runner is retained in its historical Git commit.
param([Parameter(Mandatory=$true)][string]$Snapshots, [Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot 'stage-w1g-gate.mjs')
throw 'W1G_FIXED_COMPARISON_BLOCKED'

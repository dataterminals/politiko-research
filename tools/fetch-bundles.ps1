<#
.SYNOPSIS
  One-shot download of Politiko's static JS/CSS bundles for offline reading.

.DESCRIPTION
  Fetches index.html, extracts every /assets/* reference, and pulls each file into
  artifacts/bundles/ (gitignored) so the client code can be grepped locally instead of
  poked at live.

  Rules note: this makes non-API requests to politiko.io, which the Scripting Abuse
  clause permits only when "directly and manually initiated by the user" — that is what
  running this script by hand is. It is deliberately one-shot: no loop, no schedule, no
  polling, no crawling of game routes. It touches only static build assets, never game
  state. Do not wire it into anything automated. See docs/01-rules-envelope.md.

.EXAMPLE
  .\tools\fetch-bundles.ps1
  .\tools\fetch-bundles.ps1 -OutDir 'artifacts/bundles/2026-07-28'
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'https://politiko.io',
    [string]$OutDir  = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $OutDir) {
    $stamp  = Get-Date -Format 'yyyy-MM-dd'
    $OutDir = Join-Path $repoRoot "artifacts\bundles\$stamp"
}
if (-not [System.IO.Path]::IsPathRooted($OutDir)) {
    $OutDir = Join-Path $repoRoot $OutDir
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Fetching index from $BaseUrl ..." -ForegroundColor Cyan
$index = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing
Set-Content -Path (Join-Path $OutDir 'index.html') -Value $index.Content -Encoding utf8

# /assets/<name>-<hash>.<ext> as referenced by src=, href=, or dynamic import strings
$assetPaths = [regex]::Matches($index.Content, '/assets/[A-Za-z0-9_\-\.]+\.(?:js|css)') |
    ForEach-Object { $_.Value } | Sort-Object -Unique

Write-Host "index.html references $($assetPaths.Count) asset(s)." -ForegroundColor Cyan

# The entry chunk lists every lazy route chunk; one extra pass catches them all.
$seen  = [System.Collections.Generic.HashSet[string]]::new()
$queue = [System.Collections.Generic.Queue[string]]::new()
$assetPaths | ForEach-Object { [void]$queue.Enqueue($_) }

$ok = 0; $fail = 0

while ($queue.Count -gt 0) {
    $path = $queue.Dequeue()
    if (-not $seen.Add($path)) { continue }

    $name = Split-Path $path -Leaf
    $dest = Join-Path $OutDir $name

    try {
        $res = Invoke-WebRequest -Uri "$BaseUrl$path" -UseBasicParsing
        Set-Content -Path $dest -Value $res.Content -Encoding utf8
        $ok++
        Write-Host "  ok   $name" -ForegroundColor DarkGray

        if ($name -like '*.js') {
            [regex]::Matches($res.Content, '/assets/[A-Za-z0-9_\-\.]+\.(?:js|css)') |
                ForEach-Object {
                    if (-not $seen.Contains($_.Value)) { [void]$queue.Enqueue($_.Value) }
                }
            # entry chunk often stores chunk names bare, without the /assets/ prefix
            [regex]::Matches($res.Content, '"(assets/[A-Za-z0-9_\-\.]+\.(?:js|css))"') |
                ForEach-Object {
                    $p = '/' + $_.Groups[1].Value
                    if (-not $seen.Contains($p)) { [void]$queue.Enqueue($p) }
                }
        }
    }
    catch {
        $fail++
        Write-Warning "  FAIL $name — $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "Done. $ok file(s) into $OutDir" -ForegroundColor Green
if ($fail) { Write-Host "$fail failed." -ForegroundColor Yellow }
Write-Host ""
Write-Host "Grep starters:" -ForegroundColor Cyan
Write-Host '  rg -o "/api/[A-Za-z0-9_\-/{}$.:]+"  <outdir> | sort -u'
Write-Host '  rg -n "wss?://|new WebSocket|readyState"  <outdir>'
Write-Host '  rg -n "queryKey|useQuery\(|staleTime"  <outdir>'
Write-Host '  rg -n "Bearer|Authorization|api[_-]?key|token"  <outdir>'
</content>

# Renders every screen headless and reports, in text, whether it threw at
# runtime. Complements render-previews.ps1 (which produces the images) by
# giving a per-screen pass/fail that does not need to be eyeballed.
#
# Requires a wider sandbox mode: headless Chrome needs named-pipe IPC.

$ErrorActionPreference = 'Stop'

$tools  = $PSScriptRoot
$appDir = Join-Path $tools "preview\app"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" }
$profile = Join-Path $tools ".chrome-verify"

if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
& node (Join-Path $tools "make-preview.js") | Out-Null

$targets = @(
    'dashboard', 'dashboard:menu', 'bills', 'bills:editor', 'bills:paid', 'bills:picker',
    'bills:new', 'tasks', 'tasks:new', 'tasks:editor',
    'water', 'water:editor', 'water:new',
    'reminders', 'attached', 'settings',
    'bills:attachflow', 'tasks:tagflow',
    'dashboard:latecreate', 'tasks:latecreate',
    'bills:newattach',
    'dashboard:missedcreate', 'tasks:missedcreate',
    'dashboard:hostnoise'
)

$fail = 0
$pass = 0

foreach ($hash in $targets) {
    $url = "file:///" + ($appDir -replace '\\', '/') + "/index.html#$hash"
    $dom = & $chrome --headless=new --disable-gpu --no-first-run --no-default-browser-check `
        --user-data-dir="$profile" --allow-file-access-from-files --virtual-time-budget=9000 `
        --dump-dom $url 2>$null | Out-String

    $overlay = [regex]::Match($dom, '(?s)id="__previewErrors"[^>]*>(.*?)</div>')
    $title = [regex]::Match($dom, '<title>(.*?)</title>').Groups[1].Value.Trim()
    $probe = [regex]::Match($dom, 'id="pageTitle"[^>]*>(.*?)<').Groups[1].Value.Trim()

    if ($overlay.Success -or $dom.Length -eq 0) {
        $fail += 1
        $detail = if ($dom.Length -eq 0) { 'no DOM returned' } else { ($overlay.Groups[1].Value -replace '\s+', ' ') }
        Write-Output ("FAIL  {0,-20} {1}" -f $hash, $detail)
    } else {
        $pass += 1
        Write-Output ("ok    {0,-20} title='{1}' heading='{2}'" -f $hash, $title, $probe)
    }
}

Write-Output ""
Write-Output ("{0} screens clean, {1} failed" -f $pass, $fail)
if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
exit $fail

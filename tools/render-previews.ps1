# Renders every screen of the real plugin to tools/preview/shots/*.png using
# headless Chrome, then builds a contact sheet.
#
# NOTE: headless Chrome needs named-pipe IPC, which the DSH file sandbox blocks.
# Run this with a wider sandbox mode.

$ErrorActionPreference = 'Stop'

$root  = Split-Path -Parent $PSScriptRoot
$tools = $PSScriptRoot
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" }

$appDir = Join-Path $tools "preview\app"
$shotDir = Join-Path $tools "preview\shots"
$profile = Join-Path $tools ".chrome"

# Start from a clean browser profile so localStorage cannot leak state
# between runs and make the screenshots non-deterministic.
if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
# Clear old shots so the contact sheet only ever shows the current screens.
if (Test-Path $shotDir) { Remove-Item $shotDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $shotDir | Out-Null

# Rebuild the preview copy from the real plugin.
& node (Join-Path $tools "make-preview.js") | Out-Null

$targets = @(
    @{ name = 'dashboard';         hash = 'dashboard' },
    @{ name = 'new-dialog';        hash = 'dashboard:menu' },
    @{ name = 'bills';             hash = 'bills' },
    @{ name = 'bills-editor';      hash = 'bills:editor' },
    @{ name = 'bills-paid';        hash = 'bills:paid' },
    @{ name = 'bills-picker';      hash = 'bills:picker' },
    @{ name = 'tasks';             hash = 'tasks' },
    @{ name = 'tasks-new';         hash = 'tasks:new' },
    @{ name = 'tasks-editor';      hash = 'tasks:editor' },
    @{ name = 'water';             hash = 'water' },
    @{ name = 'water-editor';      hash = 'water:editor' },
    @{ name = 'reminders';         hash = 'reminders' },
    @{ name = 'attached';          hash = 'attached' },
    @{ name = 'settings';          hash = 'settings' },
    @{ name = 'attach-flow';       hash = 'bills:attachflow' },
    @{ name = 'tag-flow';          hash = 'tasks:tagflow' },
    @{ name = 'new-attach';        hash = 'bills:newattach' }
)

$results = @()

foreach ($t in $targets) {
    $shot = Join-Path $shotDir "$($t.name).png"
    if (Test-Path $shot) { Remove-Item $shot -Force }
    $url = "file:///" + ($appDir -replace '\\', '/') + "/index.html#$($t.hash)"

    $args = @(
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--user-data-dir=$profile", "--allow-file-access-from-files", "--hide-scrollbars",
        "--window-size=1440,900", "--virtual-time-budget=9000",
        "--screenshot=$shot", $url
    )

    $p = Start-Process -FilePath $chrome -ArgumentList $args -Wait -PassThru `
        -RedirectStandardOutput (Join-Path $tools "chrome-out.txt") `
        -RedirectStandardError (Join-Path $tools "chrome-err.txt")

    $size = if (Test-Path $shot) { (Get-Item $shot).Length } else { 0 }
    $status = if ($size -gt 0) { 'rendered' } else { 'FAILED' }
    $results += [pscustomobject]@{ view = $t.name; status = $status; bytes = $size }
    Write-Output ("{0,-16} {1,-9} {2,8} bytes" -f $t.name, $status, $size)
}

Write-Output ""
Write-Output "--- summary ---"
$results | Format-Table -AutoSize | Out-String -Width 120 | Write-Output

# Contact sheet: 4 columns.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools "make-montage.ps1") -ShotDir $shotDir | Write-Output

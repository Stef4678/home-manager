# Packages the plugin as dist/Home-Manager-<version>.eagleplugin and, with
# -Install, copies it into Eagle's plugin directory.
#
# The plugin lives at the workspace root next to README.md, so only $PluginFiles
# is ever packaged - dev tooling (tools/, dist/) is never shipped.
#
#   powershell -File tools\package.ps1
#   powershell -File tools\package.ps1 -Install
#
# Note: -Install writes to %APPDATA%\Eagle\plugins, which is outside the
# workspace, so it needs a wider sandbox mode.

param(
    [switch]$Install,
    # Defaults to the manifest id, which Eagle also uses as the folder name.
    [string]$PluginDirName = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot

# Exactly what ships as the Eagle plugin. Keep in sync with tools/make-preview.js.
$PluginFiles = @('manifest.json', 'logo.png', 'index.html', 'css', 'js')

# ------------------------------------------------------------------ validate
foreach ($item in $PluginFiles) {
    if (-not (Test-Path (Join-Path $root $item))) {
        throw "missing plugin file: $item"
    }
}

$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
Write-Output "plugin : $($manifest.name)  id=$($manifest.id)  v=$($manifest.version)"

# Eagle rejects plugins whose manifest id is not a UUID when they are installed
# from a package ("Your plugin ID format is incorrect..."), and it uses the id as
# the install folder name. Every store-installed plugin on this machine has a
# UUID id; only Eagle's own bundled plugins use short ids.
if ($manifest.id -notmatch '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
    throw "manifest id '$($manifest.id)' is not a UUID - Eagle requires a UUID for plugins installed from a package."
}
if (-not $PluginDirName) { $PluginDirName = $manifest.id }

# The version is also baked into util.js so diagnostics still work when Eagle
# never delivers the plugin-create event (and therefore never hands over the
# manifest). Keep the two in step or the diagnostics lie.
$utilSource = Get-Content (Join-Path $root 'js\util.js') -Raw
$bakedMatch = [regex]::Match($utilSource, "HM\.VERSION\s*=\s*'([^']+)'")
if (-not $bakedMatch.Success) {
    throw "js/util.js does not declare HM.VERSION"
}
if ($bakedMatch.Groups[1].Value -ne $manifest.version) {
    throw "version drift: manifest.json is $($manifest.version) but js/util.js declares HM.VERSION = $($bakedMatch.Groups[1].Value)"
}
Write-Output "version: manifest and js/util.js agree ($($manifest.version))"

# ------------------------------------------------------- folder hygiene check
# Eagle's own "Pack Plugin" zips the ENTIRE folder it has registered for the
# plugin. Because the plugin files live at the project root, that means every
# dev artefact here would be swept into Eagle's package too. This script only
# ever packages $PluginFiles, so report the difference rather than let it be a
# mystery.
function Get-TreeSize($path) {
    if (-not (Test-Path $path)) { return 0 }
    $sum = (Get-ChildItem $path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($null -eq $sum) { return 0 }
    return $sum
}

$extra = @()
Get-ChildItem $root -Force | Where-Object {
    $PluginFiles -notcontains $_.Name -and $_.Name -ne 'README.md'
} | ForEach-Object {
    $size = if ($_.PSIsContainer) { Get-TreeSize $_.FullName } else { $_.Length }
    $extra += [pscustomobject]@{ Name = $_.Name; Bytes = $size }
}

$pluginBytes = 0
foreach ($item in $PluginFiles) { $pluginBytes += Get-TreeSize (Join-Path $root $item) }
$extraBytes = ($extra | Measure-Object -Property Bytes -Sum).Sum
if ($null -eq $extraBytes) { $extraBytes = 0 }

Write-Output ("this script packages : {0,8:N2} MB (uncompressed, {1} item(s))" -f ($pluginBytes / 1MB), $PluginFiles.Count)
Write-Output ("Eagle's Pack Plugin  : {0,8:N2} MB (zips the whole folder)" -f (($pluginBytes + $extraBytes) / 1MB))
if ($extra.Count) {
    Write-Output "             extra   :"
    $extra | Sort-Object Bytes -Descending | ForEach-Object {
        Write-Output ("                       {0,8:N2} MB  {1}" -f ($_.Bytes / 1MB), $_.Name)
    }
    Write-Output "  -> use this script for the package you install or share; Eagle's"
    Write-Output "     own Pack Plugin will always include the items above."
}

# A package must never contain a nested package or archive.
$nested = Get-ChildItem $root -Recurse -File -Include *.eagleplugin, *.zip -ErrorAction SilentlyContinue |
    Where-Object { $PluginFiles -contains $_.Directory.Name -or $_.Directory.FullName -eq $root }
if ($nested) {
    Write-Output "  warning: an archive sits inside the plugin folder; Eagle's pack would nest it:"
    $nested | ForEach-Object { Write-Output ("             {0}" -f $_.Name) }
}

# ------------------------------------------------------------------- staging
$stage = Join-Path $env:TEMP ("hm-package-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($item in $PluginFiles) {
    Copy-Item -Path (Join-Path $root $item) -Destination $stage -Recurse -Force
}

# ------------------------------------------------------------------ package
$distDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$package = Join-Path $distDir ("Home-Manager-{0}.eagleplugin" -f $manifest.version)
if (Test-Path $package) { Remove-Item $package -Force }

# Zip entry names must use forward slashes (that is what Eagle's own Pack
# Plugin produces); ZipFile::CreateFromDirectory would emit backslashes on
# Windows, which other extractors can mishandle.
$zip = [System.IO.Compression.ZipFile]::Open($package, 'Create')
try {
    foreach ($file in Get-ChildItem $stage -Recurse -File | Sort-Object FullName) {
        $rel = $file.FullName.Substring($stage.Length + 1) -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $file.FullName, $rel,
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($package)
$entryNames = $zip.Entries | ForEach-Object { $_.FullName }
$zip.Dispose()

Write-Output "package: $package  ($((Get-Item $package).Length) bytes, $($entryNames.Count) entries)"
$entryNames | Sort-Object | ForEach-Object { Write-Output "   $_" }

if ($entryNames -match '\\') { throw "package contains backslash entry names" }
# A packaged plugin must never contain tooling.
foreach ($bad in @('tools/', 'dist/', 'README.md', 'node_modules/')) {
    if ($entryNames -match [regex]::Escape($bad)) { throw "package unexpectedly contains $bad" }
}

# ------------------------------------------------------------------- install
if ($Install) {
    $dest = Join-Path $env:APPDATA "Eagle\plugins\$PluginDirName"
    # Recreate from scratch so removed files do not linger in the install.
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $stage '*') -Destination $dest -Recurse -Force

    $mismatch = 0
    foreach ($item in $PluginFiles) {
        $srcPath = Join-Path $root $item
        if ((Get-Item $srcPath).PSIsContainer) {
            foreach ($f in Get-ChildItem $srcPath -Recurse -File) {
                $rel = $f.FullName.Substring($root.Length + 1)
                $dst = Join-Path $dest $rel
                if (-not (Test-Path $dst) -or (Get-FileHash $f.FullName).Hash -ne (Get-FileHash $dst).Hash) {
                    Write-Output "  MISMATCH: $rel"; $mismatch += 1
                }
            }
        } else {
            $dst = Join-Path $dest $item
            if (-not (Test-Path $dst) -or (Get-FileHash $srcPath).Hash -ne (Get-FileHash $dst).Hash) {
                Write-Output "  MISMATCH: $item"; $mismatch += 1
            }
        }
    }
    Write-Output "installed: $dest  ($mismatch mismatches)"
    if ($mismatch) { throw "install verification failed" }
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "done."

# Builds a contact sheet from the preview screenshots in -ShotDir.
# A bright red bar across the top of any tile means that screen threw at runtime.

param(
    [Parameter(Mandatory = $true)][string]$ShotDir,
    [int]$CellWidth = 420,
    [int]$Columns = 4
)

Add-Type -AssemblyName System.Drawing

$files = Get-ChildItem -Path $ShotDir -Filter *.png | Sort-Object Name
if (-not $files) { Write-Output "no screenshots found in $ShotDir"; exit 0 }

# Tile order matches the render script's target order for easy reading.
$order = @(
    'dashboard', 'new-dialog', 'bills', 'bills-editor',
    'bills-paid', 'bills-picker', 'tasks', 'tasks-new',
    'tasks-editor', 'water', 'water-editor', 'reminders',
    'attached', 'settings', 'attach-flow', 'tag-flow',
    'new-attach'
)

$sorted = @()
foreach ($name in $order) {
    $match = $files | Where-Object { $_.BaseName -eq $name }
    if ($match) { $sorted += $match }
}
foreach ($f in $files) { if ($sorted -notcontains $f) { $sorted += $f } }

$cellH = [int]($CellWidth * 900 / 1440)
$labelH = 20
$rows = [math]::Ceiling($sorted.Count / $Columns)

$sheetW = $Columns * $CellWidth
$sheetH = $rows * ($cellH + $labelH)

$sheet = New-Object System.Drawing.Bitmap($sheetW, $sheetH)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::FromArgb(255, 18, 20, 26))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 220, 230, 245))

for ($i = 0; $i -lt $sorted.Count; $i++) {
    $col = $i % $Columns
    $row = [math]::Floor($i / $Columns)
    $x = $col * $CellWidth
    $y = $row * ($cellH + $labelH)

    $g.DrawString($sorted[$i].BaseName, $font, $brush, $x + 6, $y + 4)

    $img = [System.Drawing.Image]::FromFile($sorted[$i].FullName)
    $g.DrawImage($img, $x, $y + $labelH, $CellWidth, $cellH)
    $img.Dispose()

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 60, 66, 80), 1)
    $g.DrawRectangle($pen, $x, $y + $labelH, $CellWidth - 1, $cellH - 1)
    $pen.Dispose()
}

$out = Join-Path $ShotDir "_contact-sheet.png"
$sheet.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose(); $font.Dispose(); $brush.Dispose()

Write-Output "contact sheet: $out  ($($sorted.Count) tiles, ${sheetW}x${sheetH})"

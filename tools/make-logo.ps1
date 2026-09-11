# Generates plugin/logo.png (512x512) for the Home Manager Eagle plugin.
# Requires Windows PowerShell with System.Drawing (FullLanguage).

Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# --- transparent background ------------------------------------------------
$g.Clear([System.Drawing.Color]::Transparent)

# --- rounded square with diagonal gradient ---------------------------------
function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

$pad = 18
$tile = New-RoundedPath $pad $pad ($size - 2 * $pad) ($size - 2 * $pad) 108
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    [System.Drawing.Color]::FromArgb(255, 88, 101, 242),
    [System.Drawing.Color]::FromArgb(255, 18, 194, 176)
)
$g.FillPath($grad, $tile)

# soft highlight in the upper-left corner
$hl = New-Object System.Drawing.Drawing2D.GraphicsPath
$hl.AddEllipse(-60, -90, 380, 300)
$hlBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($hl)
$hlBrush.CenterColor = [System.Drawing.Color]::FromArgb(64, 255, 255, 255)
$hlBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$g.FillPath($hlBrush, $hl)

# --- check mark -------------------------------------------------------------
$penW = 34
$checkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 255, 255, 255), $penW)
$checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$checkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawLines($checkPen, @(
        (New-Object System.Drawing.PointF(148, 268)),
        (New-Object System.Drawing.PointF(224, 344)),
        (New-Object System.Drawing.PointF(372, 186))
    ))

# --- coin / bill dot in the lower-right ------------------------------------
$coinBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 214, 102))
$g.FillEllipse($coinBrush, 316, 316, 116, 116)
$coinPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235, 250, 250, 250), 12)
$g.DrawEllipse($coinPen, 316, 316, 116, 116)
$font = New-Object System.Drawing.Font("Segoe UI", 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$txtBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 46, 48, 60))
$g.DrawString("`$", $font, $txtBrush, (New-Object System.Drawing.RectangleF(316, 316, 116, 116)), $sf)

# --- save -------------------------------------------------------------------
$out = Join-Path $PSScriptRoot "..\logo.png"
$out = [System.IO.Path]::GetFullPath($out)
$dir = [System.IO.Path]::GetDirectoryName($out)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose(); $grad.Dispose(); $tile.Dispose(); $hl.Dispose(); $hlBrush.Dispose()
$checkPen.Dispose(); $coinBrush.Dispose(); $coinPen.Dispose(); $font.Dispose(); $txtBrush.Dispose(); $sf.Dispose()

Write-Output "logo written: $out"

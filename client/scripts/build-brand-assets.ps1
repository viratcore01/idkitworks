# Zoclo brand asset pipeline.
# Source: public/zoclo-logo-raw.png (wordmark on plum background).
# Output: public/zoclo-logo.png   - transparent wordmark (single logo everywhere)
#         public/zoclo-favicon.png- wordmark on brand-purple chip, 64x64
#         public/og-image.png     - 1600x630 social card, wordmark + tagline
# Re-run whenever zoclo-logo-raw.png is replaced.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path   # .../client/scripts
$pub  = Join-Path (Split-Path -Parent $root) 'public'     # .../client/public
$raw  = Join-Path $pub 'zoclo-logo-raw.png'

$src = [System.Drawing.Image]::FromFile($raw)
$w = $src.Width; $h = $src.Height
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose(); $src.Dispose()

# chroma-key the plum background (sampled at 3,3) to transparency, soft edge 48-80
$bgc = $bmp.GetPixel(3,3)
$rect = New-Object System.Drawing.Rectangle(0,0,$w,$h)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$len = $w * $h * 4
$bytes = New-Object byte[] $len
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $len)
for ($i = 0; $i -lt $len; $i += 4) {
  $b = $bytes[$i]; $gg = $bytes[$i+1]; $r = $bytes[$i+2]
  $d = [math]::Sqrt([math]::Pow($r-$bgc.R,2) + [math]::Pow($gg-$bgc.G,2) + [math]::Pow($b-$bgc.B,2))
  if ($d -lt 48) { $bytes[$i+3] = 0 }
  elseif ($d -lt 80) { $bytes[$i+3] = [byte](255 * ($d - 48) / 32) }
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $len)
$bmp.UnlockBits($data)

# trim transparent margins
$minX = $w; $minY = $h; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $h; $y++) { for ($x = 0; $x -lt $w; $x++) {
  if ($bmp.GetPixel($x,$y).A -gt 10) {
    if ($x -lt $minX) {$minX=$x}; if ($x -gt $maxX) {$maxX=$x}
    if ($y -lt $minY) {$minY=$y}; if ($y -gt $maxY) {$maxY=$y}
  }
} }
$cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
$crop = $bmp.Clone((New-Object System.Drawing.Rectangle($minX,$minY,$cw,$ch)), $bmp.PixelFormat)
$bmp.Dispose()

# 1) transparent wordmark, height 320
$th = 320; $tw = [int]($cw * $th / $ch)
$out = New-Object System.Drawing.Bitmap($tw, $th)
$og = [System.Drawing.Graphics]::FromImage($out)
$og.InterpolationMode = 'HighQualityBicubic'
$og.DrawImage($crop, 0, 0, $tw, $th)
$og.Dispose()
$out.Save((Join-Path $pub 'zoclo-logo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()

# 2) favicon 64x64: wordmark centered on brand-purple chip
$violet = [System.Drawing.Color]::FromArgb(255, 74, 44, 110)
$chip = New-Object System.Drawing.Bitmap(64, 64)
$cg = [System.Drawing.Graphics]::FromImage($chip)
$cb = New-Object System.Drawing.SolidBrush($violet)
$cg.FillRectangle($cb, 0, 0, 64, 64)
$favH = 40; $favW = [int]($cw * $favH / $ch)
if ($favW -gt 56) { $favW = 56; $favH = [int]($ch * 56 / $cw) }
$cg.InterpolationMode = 'HighQualityBicubic'
$cg.DrawImage($crop, [int]((64-$favW)/2), [int]((64-$favH)/2), $favW, $favH)
$cg.Dispose(); $cb.Dispose()
$chip.Save((Join-Path $pub 'zoclo-favicon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$chip.Dispose()

# 3) og-image 1600x630 on cream
$canvas = New-Object System.Drawing.Bitmap(1600, 630)
$ogc = [System.Drawing.Graphics]::FromImage($canvas)
$cream = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250,247,242))
$ogc.FillRectangle($cream, 0, 0, 1600, 630)
$card = New-Object System.Drawing.SolidBrush($violet)
$ogc.FillRectangle($card, 80, 80, 1440, 470)
$logoH = 260; $logoW = [int]($cw * $logoH / $ch)
$ogc.InterpolationMode = 'HighQualityBicubic'
$ogc.DrawImage($crop, [int]((1600-$logoW)/2), 165, $logoW, $logoH)
$f3 = New-Object System.Drawing.Font('Arial', 26)
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(250,247,242))
$t3 = 'YOUR ENTIRE COLLEGE. ONE APP. ZERO OUTSIDERS.'
$sz = $ogc.MeasureString($t3, $f3)
$ogc.DrawString($t3, $f3, $ink, [int]((1600-$sz.Width)/2), 470)
$ogc.Dispose(); $canvas.Save((Join-Path $pub 'og-image.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose(); $cream.Dispose(); $card.Dispose(); $ink.Dispose()
$crop.Dispose()
Write-Host 'brand assets OK'

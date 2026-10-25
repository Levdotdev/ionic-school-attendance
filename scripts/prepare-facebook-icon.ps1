# Deterministic resize only. Never redraw or replace the university seal.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRepoRoot = Split-Path -Parent $PSScriptRoot
$iconSourcePath = Join-Path $iconRepoRoot 'public/minsu-logo.png'
$iconOutputPath = Join-Path $iconRepoRoot 'public/facebook-app-icon-1024.png'
if (Test-Path -LiteralPath $iconOutputPath) { throw 'The Facebook icon already exists; the original and exported image were left unchanged.' }
$iconSource = [System.Drawing.Image]::FromFile($iconSourcePath)
$iconTarget = New-Object System.Drawing.Bitmap(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconTarget)
try {
  $iconGraphics.Clear([System.Drawing.Color]::White)
  $iconGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $iconGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $iconGraphics.DrawImage($iconSource, (New-Object System.Drawing.Rectangle(0, 0, 1024, 1024)), 0, 0, $iconSource.Width, $iconSource.Height, [System.Drawing.GraphicsUnit]::Pixel)
  $iconTarget.Save($iconOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $iconGraphics.Dispose(); $iconTarget.Dispose(); $iconSource.Dispose()
}
Get-Item -LiteralPath $iconOutputPath | Select-Object FullName, Length

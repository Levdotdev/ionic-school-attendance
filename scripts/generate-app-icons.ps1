# Resize the existing university seal only. No redraw, recoloring, or cropping.
# Run on Windows: pwsh -File scripts/generate-app-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$appIconRoot = Split-Path -Parent $PSScriptRoot
$appIconSource = [System.Drawing.Image]::FromFile((Join-Path $appIconRoot 'public/minsu-logo.png'))
$appIconWritten = [System.Collections.Generic.List[string]]::new()

function Write-AppIcon {
  param([string]$RelativePath, [int]$Width, [int]$Height, [double]$ContentFraction, [ValidateSet('White','Transparent','Round')][string]$Background = 'White')
  $targetPath = Join-Path $appIconRoot $RelativePath
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $targetPath)) | Out-Null
  $pixelFormat = if ($Background -eq 'White') { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb } else { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb }
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, $pixelFormat)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear($(if ($Background -eq 'White') { [System.Drawing.Color]::White } else { [System.Drawing.Color]::Transparent }))
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    if ($Background -eq 'Round') { $graphics.FillEllipse([System.Drawing.Brushes]::White, 0, 0, $Width, $Height) }
    $contentSize = [Math]::Round([Math]::Min($Width, $Height) * $ContentFraction)
    $ratio = [Math]::Min($contentSize / $appIconSource.Width, $contentSize / $appIconSource.Height)
    $drawWidth = [int][Math]::Round($appIconSource.Width * $ratio)
    $drawHeight = [int][Math]::Round($appIconSource.Height * $ratio)
    $rectangle = [System.Drawing.Rectangle]::new([int](($Width-$drawWidth)/2), [int](($Height-$drawHeight)/2), $drawWidth, $drawHeight)
    $graphics.DrawImage($appIconSource, $rectangle, 0, 0, $appIconSource.Width, $appIconSource.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $appIconWritten.Add($RelativePath)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

try {
  $densities = @(@('mdpi',1),@('hdpi',1.5),@('xhdpi',2),@('xxhdpi',3),@('xxxhdpi',4))
  foreach ($density in $densities) {
    $folder = "android/app/src/main/res/mipmap-$($density[0])"
    $legacySize = [int](48 * $density[1])
    $adaptiveSize = [int](108 * $density[1])
    Write-AppIcon "$folder/ic_launcher.png" $legacySize $legacySize .9
    Write-AppIcon "$folder/ic_launcher_round.png" $legacySize $legacySize .9 'Round'
    # Android guarantees the centered 66dp area of its 108dp adaptive layer.
    Write-AppIcon "$folder/ic_launcher_foreground.png" $adaptiveSize $adaptiveSize (66.0/108.0) 'Transparent'
  }
  Write-AppIcon 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png' 1024 1024 .88
  Write-AppIcon 'public/icons/apple-touch-icon.png' 180 180 .88
  Write-AppIcon 'public/icons/minsu-icon-192.png' 192 192 .88
  Write-AppIcon 'public/icons/minsu-icon-512.png' 512 512 .88
  Write-AppIcon 'public/icons/minsu-maskable-512.png' 512 512 .75
  # Replace the starter Capacitor splash artwork without changing its sizing.
  $splashFiles = @(Get-ChildItem -LiteralPath (Join-Path $appIconRoot 'android/app/src/main/res') -Filter 'splash.png' -File -Recurse)
  $splashFiles += @(Get-ChildItem -LiteralPath (Join-Path $appIconRoot 'ios/App/App/Assets.xcassets/Splash.imageset') -Filter '*.png' -File)
  foreach ($splash in $splashFiles) {
    $existing = [System.Drawing.Image]::FromFile($splash.FullName)
    try { $splashWidth = $existing.Width; $splashHeight = $existing.Height } finally { $existing.Dispose() }
    $relative = [System.IO.Path]::GetRelativePath($appIconRoot,$splash.FullName)
    Write-AppIcon $relative $splashWidth $splashHeight .23
  }
} finally { $appIconSource.Dispose() }
[pscustomobject]@{ Source = 'public/minsu-logo.png'; Generated = $appIconWritten.Count; Assets = $appIconWritten } | ConvertTo-Json -Depth 3

// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function png(path: string) {
  const bytes = await readFile(path)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

describe('mobile application branding and iOS readiness', () => {
  it('provides correctly sized adaptive/legacy Android icons and an opaque App Store image', async () => {
    for (const [density, factor] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]] as const) {
      const folder = `android/app/src/main/res/mipmap-${density}`
      expect(await png(`${folder}/ic_launcher.png`)).toMatchObject({ width: 48 * factor, height: 48 * factor })
      expect(await png(`${folder}/ic_launcher_round.png`)).toMatchObject({ width: 48 * factor, height: 48 * factor })
      expect(await png(`${folder}/ic_launcher_foreground.png`)).toEqual({ width: 108 * factor, height: 108 * factor, colorType: 6 })
    }
    const adaptive = await readFile('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', 'utf8')
    expect(adaptive).toContain('@mipmap/ic_launcher_foreground')
    expect(adaptive).toContain('@color/ic_launcher_background')
    const catalog = JSON.parse(await readFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json', 'utf8'))
    const icon = catalog.images.find((image: { size: string }) => image.size === '1024x1024')
    expect(await png(`ios/App/App/Assets.xcassets/AppIcon.appiconset/${icon.filename}`)).toEqual({ width: 1024, height: 1024, colorType: 2 })
  })
  it('links Home Screen metadata to real square icons without adding private offline caching', async () => {
    const html = await readFile('index.html', 'utf8')
    const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'))
    expect(html).toContain('href="/manifest.webmanifest"')
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('href="/icons/apple-touch-icon.png"')
    expect(manifest).toMatchObject({ name: 'MinSU Attendance', display: 'standalone', scope: '/', start_url: '/login' })
    for (const icon of manifest.icons) {
      const [size] = icon.sizes.split('x').map(Number)
      expect(await png(`public${icon.src}`)).toMatchObject({ width: size, height: size })
    }
    expect(await png('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180, colorType: 2 })
  })
  it('configures camera/location purposes, callback forwarding and native push registration hooks', async () => {
    const plist = await readFile('ios/App/App/Info.plist', 'utf8')
    for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription']) {
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`))
    }
    expect(plist).toContain('<key>CFBundleURLSchemes</key>')
    expect(plist).toContain('<string>edu.minsu.attendance</string>')
    const delegate = await readFile('ios/App/App/AppDelegate.swift', 'utf8')
    expect(delegate).toContain('ApplicationDelegateProxy.shared.application(app, open: url')
    expect(delegate).toContain('didRegisterForRemoteNotificationsWithDeviceToken')
    expect(delegate).toContain('.capacitorDidFailToRegisterForRemoteNotifications')
    const scene = await readFile('ios/App/App/SceneDelegate.swift', 'utf8')
    expect(scene).toContain('SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)')
    const project = await readFile('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
    expect(project).toContain('PrivacyInfo.xcprivacy in Resources')
    expect(project).not.toContain('App.entitlements.example')
    const privacy = await readFile('ios/App/App/PrivacyInfo.xcprivacy', 'utf8')
    expect(privacy).toContain('NSPrivacyAccessedAPICategoryFileTimestamp')
    expect(privacy).toContain('C617.1')
  })
})

// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function png(path: string) {
  const bytes = await readFile(path)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

describe('Android application branding', () => {
  it('provides correctly sized adaptive and legacy Android icons', async () => {
    for (const [density, factor] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]] as const) {
      const folder = `android/app/src/main/res/mipmap-${density}`
      expect(await png(`${folder}/ic_launcher.png`)).toMatchObject({ width: 48 * factor, height: 48 * factor })
      expect(await png(`${folder}/ic_launcher_round.png`)).toMatchObject({ width: 48 * factor, height: 48 * factor })
      expect(await png(`${folder}/ic_launcher_foreground.png`)).toEqual({ width: 108 * factor, height: 108 * factor, colorType: 6 })
    }
    const adaptive = await readFile('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', 'utf8')
    expect(adaptive).toContain('@mipmap/ic_launcher_foreground')
    expect(adaptive).toContain('@color/ic_launcher_background')
  })
})

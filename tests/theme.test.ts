import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve('src/theme/variables.css'), 'utf8')
const dark = styles.split(":root[data-theme='dark']")[1]
const token = (name: string) => dark.match(new RegExp(`${name}:\\s*(#[a-f0-9]{6})`, 'i'))![1]
function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + .05) / (values[1] + .05)
}
describe('muted dark theme', () => {
  it('keeps text and muted copy legible on each dark surface', () => {
    for (const surface of ['--campus-bg', '--campus-surface', '--campus-surface-soft']) {
      expect(contrast(token('--campus-text'), token(surface))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token('--campus-muted'), token(surface))).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('uses readable text for primary buttons and colored status badges', () => {
    expect(contrast(token('--campus-green'), token('--campus-on-accent'))).toBeGreaterThanOrEqual(4.5)
    for (const state of ['success', 'warning', 'danger']) {
      expect(contrast(token(`--campus-${state}`), token(`--campus-${state}-soft`))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

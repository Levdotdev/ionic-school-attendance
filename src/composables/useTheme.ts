import { computed, readonly, ref } from 'vue'

export type ColorTheme = 'light' | 'dark'

const STORAGE_KEY = 'minsu-attendance-theme'
const theme = ref<ColorTheme>('light')
let initialized = false

function systemTheme(): ColorTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(value: ColorTheme) {
  theme.value = value
  document.documentElement.dataset.theme = value
  document.documentElement.style.colorScheme = value

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor) themeColor.content = value === 'dark' ? '#111715' : '#f5f7f3'
}

export function initializeTheme() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  let saved: string | null = null
  try { saved = window.localStorage.getItem(STORAGE_KEY) } catch { /* Use the system theme when storage is unavailable. */ }
  applyTheme(saved === 'light' || saved === 'dark' ? saved : systemTheme())
}

export function setTheme(value: ColorTheme) {
  applyTheme(value)
  try { window.localStorage.setItem(STORAGE_KEY, value) } catch { /* Keep this tab's selected theme. */ }
}

export function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  initializeTheme()

  return {
    theme: readonly(theme),
    isDark: computed(() => theme.value === 'dark'),
    setTheme,
    toggleTheme,
  }
}

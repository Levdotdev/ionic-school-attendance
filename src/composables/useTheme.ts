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
  if (themeColor) themeColor.content = value === 'dark' ? '#0a2d20' : '#063f2a'
}

export function initializeTheme() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const saved = window.localStorage.getItem(STORAGE_KEY)
  applyTheme(saved === 'light' || saved === 'dark' ? saved : systemTheme())
}

export function setTheme(value: ColorTheme) {
  applyTheme(value)
  window.localStorage.setItem(STORAGE_KEY, value)
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

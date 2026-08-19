import { createContext, useContext, useMemo, useState } from 'react'
import { LANGUAGE_OPTIONS } from './themeConstants.js'

const THEME_STORAGE_KEY = 'ta-theme'
const LANGUAGE_STORAGE_KEY = 'ta-language'

const DEFAULT_THEME = 'light'
const DEFAULT_LANGUAGE = 'English'

function getInitialTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME
}

function getInitialLanguage() {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return LANGUAGE_OPTIONS.includes(stored) ? stored : DEFAULT_LANGUAGE
}

const ThemeContext = createContext(null)

const themes = {
  light: {
    // Page / root
    pageBg: 'bg-linear-to-b from-white via-teal-50 to-teal-100',
    // Sidebar
    sidebarBg: 'bg-linear-to-b from-white via-teal-50 to-teal-100',
    sidebarBorder: 'border-teal-200',
    sidebarText: 'text-teal-900',
    sidebarDivider: 'via-teal-200',
    sidebarIconBg: 'bg-teal-100',
    sidebarIconText: 'text-teal-700',
    sidebarChevron: 'text-teal-600 hover:bg-teal-100 hover:text-teal-800',
    sidebarActive: 'bg-teal-100 text-teal-900 shadow-[0_0_0_1px_rgba(20,184,166,0.35)]',
    sidebarHover: 'text-teal-700 hover:bg-teal-50 hover:text-teal-900',
    sidebarSettingsHover: 'text-teal-700 hover:bg-teal-100 hover:text-teal-800',
    sidebarUserCard: 'bg-teal-50',
    sidebarUserName: 'text-teal-900',
    sidebarUserEmail: 'text-teal-600',
    // Chat messages
    userMsgBg: 'bg-slate-100',
    userMsgText: 'text-slate-800',
    assistantText: 'text-slate-800',
    actionBtn: 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
    // Scroll button
    scrollBtnBg: 'bg-white/90 border-slate-200 text-slate-600',
    // Input
    inputContainer: 'border-teal-200 bg-teal-50/80',
    inputText: 'text-slate-900 placeholder:text-slate-400',
    inputBtn: 'text-slate-600',
    inputBtnBg: 'bg-slate-100 hover:bg-slate-200',
    inputDropdownBg: 'bg-white border-slate-200',
    inputDropdownItem: 'text-slate-700 hover:bg-teal-50',
    inputDropdownActive: 'text-teal-700 font-semibold',
    inputDropdownBadge: 'bg-slate-100 text-slate-500',
  },
  dark: {
    // Page / root
    pageBg: 'bg-linear-to-b from-slate-900 via-slate-800 to-slate-700',
    // Sidebar
    sidebarBg: 'bg-linear-to-b from-slate-900 via-slate-800 to-slate-700',
    sidebarBorder: 'border-teal-900',
    sidebarText: 'text-teal-100',
    sidebarDivider: 'via-teal-800',
    sidebarIconBg: 'bg-slate-700',
    sidebarIconText: 'text-teal-400',
    sidebarChevron: 'text-teal-400 hover:bg-slate-700 hover:text-teal-300',
    sidebarActive: 'bg-slate-700 text-teal-300 shadow-[0_0_0_1px_rgba(20,184,166,0.25)]',
    sidebarHover: 'text-teal-300 hover:bg-slate-700 hover:text-teal-100',
    sidebarSettingsHover: 'text-teal-300 hover:bg-slate-700 hover:text-teal-100',
    sidebarUserCard: 'bg-slate-700',
    sidebarUserName: 'text-teal-100',
    sidebarUserEmail: 'text-teal-400',
    // Chat messages
    userMsgBg: 'bg-slate-700',
    userMsgText: 'text-slate-100',
    assistantText: 'text-slate-200',
    actionBtn: 'text-slate-500 hover:bg-slate-700 hover:text-slate-300',
    // Scroll button
    scrollBtnBg: 'bg-slate-800/90 border-slate-600 text-slate-300',
    // Input
    inputContainer: 'border-slate-600 bg-slate-800/80',
    inputText: 'text-slate-100 placeholder:text-slate-500',
    inputBtn: 'text-teal-300',
    inputBtnBg: 'bg-slate-700 hover:bg-slate-600',
    inputDropdownBg: 'bg-slate-800 border-slate-600',
    inputDropdownItem: 'text-slate-300 hover:bg-slate-700',
    inputDropdownActive: 'text-teal-400 font-semibold',
    inputDropdownBadge: 'bg-slate-700 text-slate-400',
  },
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)
  const [language, setLanguageState] = useState(getInitialLanguage)

  const toggleTheme = () => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light'
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
      return nextTheme
    })
  }

  const setLanguage = (nextLanguage) => {
    if (!LANGUAGE_OPTIONS.includes(nextLanguage)) return
    setLanguageState(nextLanguage)
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
  }

  const contextValue = useMemo(
    () => ({ theme, toggleTheme, language, setLanguage, t: themes[theme] }),
    [theme, language]
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

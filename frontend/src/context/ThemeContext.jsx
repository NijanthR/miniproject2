import { createContext, useContext, useEffect, useMemo, useState } from 'react'
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
    pageBg: 'bg-gradient-to-b from-slate-50 via-teal-50/25 to-slate-100',
    // Sidebar
    sidebarBg: 'bg-white border-r border-slate-200',
    sidebarBorder: 'border-slate-200',
    sidebarText: 'text-slate-800',
    sidebarDivider: 'via-slate-200',
    sidebarIconBg: 'bg-teal-50',
    sidebarIconText: 'text-teal-700',
    sidebarChevron: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    sidebarActive: 'bg-teal-600 text-white shadow-sm font-semibold',
    sidebarHover: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
    sidebarSettingsHover: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
    sidebarUserCard: 'bg-slate-100/90 border border-slate-200/80',
    sidebarUserName: 'text-slate-900 font-semibold',
    sidebarUserEmail: 'text-slate-500',
    // Chat messages
    userMsgBg: 'bg-slate-900 text-white shadow-sm',
    userMsgText: 'text-white',
    assistantText: 'text-slate-900',
    actionBtn: 'text-slate-600 hover:bg-slate-200 hover:text-slate-900 bg-white border-slate-200 shadow-2xs',
    // Scroll button
    scrollBtnBg: 'bg-white border-slate-200 text-slate-700 shadow-md',
    // Input
    inputContainer: 'border-slate-300/90 bg-white shadow-md',
    inputText: 'text-slate-900 placeholder:text-slate-400',
    inputBtn: 'text-slate-700',
    inputBtnBg: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    inputDropdownBg: 'bg-white border-slate-200 shadow-xl',
    inputDropdownItem: 'text-slate-800 hover:bg-teal-50',
    inputDropdownActive: 'text-teal-700 font-bold bg-teal-50/80',
    inputDropdownBadge: 'bg-slate-100 text-slate-600 font-medium',
  },
  dark: {
    // Page / root
    pageBg: 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950',
    // Sidebar
    sidebarBg: 'bg-slate-950 border-r border-slate-800',
    sidebarBorder: 'border-slate-800',
    sidebarText: 'text-slate-100',
    sidebarDivider: 'via-slate-800',
    sidebarIconBg: 'bg-slate-800',
    sidebarIconText: 'text-teal-400',
    sidebarChevron: 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
    sidebarActive: 'bg-teal-600 text-white shadow-sm font-semibold',
    sidebarHover: 'text-slate-300 hover:bg-slate-800 hover:text-white',
    sidebarSettingsHover: 'text-slate-300 hover:bg-slate-800 hover:text-white',
    sidebarUserCard: 'bg-slate-900 border border-slate-800',
    sidebarUserName: 'text-slate-100 font-semibold',
    sidebarUserEmail: 'text-slate-400',
    // Chat messages
    userMsgBg: 'bg-teal-600 text-white shadow-sm',
    userMsgText: 'text-white',
    assistantText: 'text-slate-100',
    actionBtn: 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 bg-slate-900 border-slate-800 shadow-2xs',
    // Scroll button
    scrollBtnBg: 'bg-slate-900 border-slate-700 text-slate-200 shadow-md',
    // Input
    inputContainer: 'border-slate-800 bg-slate-900/95 shadow-xl',
    inputText: 'text-slate-100 placeholder:text-slate-500',
    inputBtn: 'text-slate-300',
    inputBtnBg: 'bg-slate-800 hover:bg-slate-700 text-slate-200',
    inputDropdownBg: 'bg-slate-900 border-slate-800 shadow-2xl',
    inputDropdownItem: 'text-slate-200 hover:bg-slate-800',
    inputDropdownActive: 'text-teal-400 font-bold bg-slate-800/80',
    inputDropdownBadge: 'bg-slate-800 text-slate-400 font-medium',
  },
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)
  const [language, setLanguageState] = useState(getInitialLanguage)

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

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

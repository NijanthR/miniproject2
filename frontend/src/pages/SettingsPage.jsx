import { useState } from 'react'
import { FiCheck, FiGlobe, FiMoon, FiPlay, FiSliders, FiSun, FiVolume2, FiVolumeX } from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'
import { LANGUAGE_OPTIONS } from '../context/themeConstants.js'

function SettingsPage() {
  const { theme, toggleTheme, language, setLanguage, t } = useTheme()
  const isDark = theme === 'dark'
  const [isPlayingSample, setIsPlayingSample] = useState(false)
  const [speechRate, setSpeechRate] = useState(1)

  const handleTestSpeech = () => {
    if (!('speechSynthesis' in window)) {
      alert('Text-to-speech is not supported on this browser.')
      return
    }

    if (isPlayingSample) {
      window.speechSynthesis.cancel()
      setIsPlayingSample(false)
      return
    }

    window.speechSynthesis.cancel()
    const sampleText = `Hello! I am your AI Teaching Assistant. I am ready to help you learn in ${language}.`
    const utterance = new SpeechSynthesisUtterance(sampleText)
    utterance.rate = speechRate
    utterance.onend = () => setIsPlayingSample(false)
    utterance.onerror = () => setIsPlayingSample(false)
    setIsPlayingSample(true)
    window.speechSynthesis.speak(utterance)
  }

  return (
    <div className={`flex h-full w-full flex-col overflow-y-auto ${t.pageBg}`}>
      <div className="mx-auto w-full max-w-2xl px-6 py-10 space-y-6">
        <div>
          <h1 className={`text-3xl font-extrabold tracking-tight ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>
            Settings & Preferences
          </h1>
          <p className={`mt-1 text-sm ${isDark ? 'text-teal-400' : 'text-teal-600'}`}>
            Customize visual themes, speech playback, and AI language preferences.
          </p>
        </div>

        {/* Appearance section */}
        <div className={`rounded-3xl border p-6 shadow-sm backdrop-blur-md ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-white/70'}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-500 text-white shadow-xs">
              {isDark ? <FiMoon className="h-3.5 w-3.5" /> : <FiSun className="h-3.5 w-3.5" />}
            </span>
            <h2 className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>
              Appearance
            </h2>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>Theme Mode</p>
              <p className={`mt-0.5 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {isDark ? 'Dark Slate & Teal' : 'Clean White & Emerald Teal'}
              </p>
            </div>

            {/* Toggle switch */}
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className={`relative flex h-8.5 w-16 items-center rounded-full border transition-all duration-300 ${
                isDark ? 'border-teal-700 bg-slate-800' : 'border-teal-300 bg-teal-100'
              }`}
            >
              <span
                className={`absolute flex h-6.5 w-6.5 items-center justify-center rounded-full shadow-md transition-all duration-300 ${
                  isDark
                    ? 'left-8.5 bg-slate-900 text-teal-400'
                    : 'left-1 bg-white text-teal-600'
                }`}
              >
                {isDark ? <FiMoon className="h-3.5 w-3.5" /> : <FiSun className="h-3.5 w-3.5" />}
              </span>
            </button>
          </div>

          {/* Theme preview cards */}
          <div className="mt-6 grid grid-cols-2 gap-3.5">
            <button
              onClick={() => theme !== 'light' && toggleTheme()}
              className={`group rounded-2xl border p-4 text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${
                !isDark
                  ? 'border-teal-500 bg-teal-50/50 ring-2 ring-teal-500/40 shadow-sm'
                  : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
              }`}
            >
              <div className="h-12 w-full rounded-xl bg-linear-to-b from-white via-teal-50 to-teal-100 shadow-inner" />
              <div className="mt-2.5 flex items-center justify-between">
                <div>
                  <p className={`text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>Light Mode</p>
                  <p className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>Crisp &amp; Bright</p>
                </div>
                {!isDark && <FiCheck className="h-4 w-4 text-teal-600" />}
              </div>
            </button>

            <button
              onClick={() => theme !== 'dark' && toggleTheme()}
              className={`group rounded-2xl border p-4 text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${
                isDark
                  ? 'border-teal-500 bg-slate-800/80 ring-2 ring-teal-500/40 shadow-sm'
                  : 'border-slate-200 bg-slate-100/50 hover:border-slate-300'
              }`}
            >
              <div className="h-12 w-full rounded-xl bg-linear-to-b from-slate-900 via-slate-800 to-slate-700 shadow-inner" />
              <div className="mt-2.5 flex items-center justify-between">
                <div>
                  <p className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Dark Mode</p>
                  <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Deep &amp; Focused</p>
                </div>
                {isDark && <FiCheck className="h-4 w-4 text-teal-400" />}
              </div>
            </button>
          </div>
        </div>

        {/* Language Selection */}
        <div className={`rounded-3xl border p-6 shadow-sm backdrop-blur-md ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-white/70'}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-500 text-white shadow-xs">
              <FiGlobe className="h-3.5 w-3.5" />
            </span>
            <h2 className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>
              Language & Translation
            </h2>
          </div>

          <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Select the primary language AI responses will be formulated in:
          </p>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {LANGUAGE_OPTIONS.map((option) => {
              const isSelected = language === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLanguage(option)}
                  className={`flex items-center justify-between rounded-2xl border p-3 text-xs font-bold transition-all hover:scale-105 active:scale-95 ${
                    isSelected
                      ? 'border-teal-500 bg-teal-500 text-white shadow-md shadow-teal-500/20'
                      : isDark
                        ? 'border-slate-800 bg-slate-800/80 text-slate-300 hover:border-slate-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50/50'
                  }`}
                >
                  <span>{option}</span>
                  {isSelected && <FiCheck className="h-3.5 w-3.5" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Speech & TTS Playground */}
        <div className={`rounded-3xl border p-6 shadow-sm backdrop-blur-md ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-white/70'}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-500 text-white shadow-xs">
              <FiSliders className="h-3.5 w-3.5" />
            </span>
            <h2 className={`text-sm font-bold uppercase tracking-wider ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>
              Speech &amp; Audio Preview
            </h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-semibold ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>Speech Speed: {speechRate}x</p>
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Adjust Text-To-Speech playback velocity.</p>
              </div>
              <input
                type="range"
                min="0.7"
                max="1.5"
                step="0.1"
                value={speechRate}
                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                className="w-32 accent-teal-500 cursor-pointer"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleTestSpeech}
                className="flex items-center gap-2 rounded-2xl bg-linear-to-tr from-teal-600 to-teal-500 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-teal-500/20 transition-all hover:scale-105 active:scale-95"
              >
                {isPlayingSample ? <FiVolumeX className="h-4 w-4" /> : <FiVolume2 className="h-4 w-4" />}
                <span>{isPlayingSample ? 'Stop Voice Test' : 'Test Speech Voice'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage

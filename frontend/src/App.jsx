import SideNav from './components/SideNav.jsx'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import TestPage from './pages/TestPage.jsx'
import CommunityPage from './pages/CommunityPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import AuthPage from './pages/AuthPage.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { buildApiUrl } from './config/api.js'

function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<AuthPage />} />
        <Route path="/app/*" element={<DesktopChatPreview />} />
        <Route path="*" element={<AuthPage />} />
      </Routes>
    </ThemeProvider>
  )
}

function DesktopChatPreview() {
  const navigate = useNavigate()

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const code = String(query.get('code') || '').trim()
    const authErrorValue = String(query.get('error') || '').trim()

    if (authErrorValue) {
      const cleanUrl = `${window.location.origin}/app`
      window.history.replaceState({}, '', cleanUrl)
      return
    }

    if (!code) return

    const redirectUri = `${window.location.origin}/app`

    const completeGoogleAuth = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/auth/google/'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(payload?.error || 'Google authentication failed.')
        }

        localStorage.setItem('teaching-assistant-google-user', JSON.stringify(payload?.user || {}))
        const cleanUrl = `${window.location.origin}/app`
        window.history.replaceState({}, '', cleanUrl)
        navigate('/app', { replace: true })
      } catch (error) {
        console.error('Google authentication failed:', error)
        const cleanUrl = `${window.location.origin}/app`
        window.history.replaceState({}, '', cleanUrl)
      }
    }

    completeGoogleAuth()
  }, [navigate])

  return (
    <div className="h-screen w-screen overflow-hidden">
      <div className="grid h-full w-full grid-cols-[auto_1fr]">
        <SideNav />

        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route index element={<DashboardPage />} />
              <Route path="test" element={<TestPage />} />
              <Route path="community/*" element={<CommunityPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

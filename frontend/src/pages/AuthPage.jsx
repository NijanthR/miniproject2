import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FcGoogle } from 'react-icons/fc'
import { buildApiUrl } from '../config/api.js'

const AUTH_USERS_KEY = 'teaching-assistant-auth-users'
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

const tabStyles = {
  active: 'bg-slate-900 text-white shadow-sm',
  idle: 'text-slate-600 hover:bg-white/60',
}

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }

    const existingScript = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`)
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity script.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = GOOGLE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity script.'))
    document.head.appendChild(script)
  })
}

function AuthPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)

  const isSignIn = mode === 'signin'

  const getStoredUsers = () => {
    try {
      const raw = localStorage.getItem(AUTH_USERS_KEY)
      const users = raw ? JSON.parse(raw) : []
      return Array.isArray(users) ? users : []
    } catch {
      return []
    }
  }

  const saveStoredUsers = (users) => {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users))
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const code = String(query.get('code') || '').trim()
    const authErrorValue = String(query.get('error') || '').trim()

    if (authErrorValue) {
      setAuthError('Google sign-in was cancelled or denied.')
      const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`
      window.history.replaceState({}, '', cleanUrl)
      return
    }

    if (!code) return

    const redirectUri = String(query.get('redirect_uri') || window.location.origin).trim() || window.location.origin

    const completeGoogleAuth = async () => {
      setIsGoogleLoading(true)
      setAuthError('')

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
        const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`
        window.history.replaceState({}, '', cleanUrl)
        navigate('/app', { replace: true })
      } catch (error) {
        setAuthError(String(error?.message || 'Google authentication failed.'))
        const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`
        window.history.replaceState({}, '', cleanUrl)
      } finally {
        setIsGoogleLoading(false)
      }
    }

    completeGoogleAuth()
  }, [navigate])

  const handleSubmit = (event) => {
    event.preventDefault()
    setAuthError('')
    setAuthSuccess('')

    if (isSignIn) {
      const normalizedIdentity = username.trim().toLowerCase()
      const users = getStoredUsers()
      const matchedUser = users.find(
        (user) =>
          (String(user.username || '').toLowerCase() === normalizedIdentity ||
            String(user.email || '').toLowerCase() === normalizedIdentity) &&
          String(user.password || '') === password
      )

      if ((normalizedIdentity === 'nijanth' && password === '2428') || matchedUser) {
        navigate('/app')
        return
      }
      setAuthError('Invalid credentials. Use nijanth/2428 or a registered account.')
      return
    }

    if (!fullName.trim() || !email.trim() || !password || !confirmPassword) {
      setAuthError('Please fill all fields to create an account.')
      return
    }

    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    const users = getStoredUsers()
    const emailAlreadyUsed = users.some((user) => String(user.email || '').toLowerCase() === normalizedEmail)
    if (emailAlreadyUsed) {
      setAuthError('An account with this email already exists. Please sign in.')
      return
    }

    const generatedUsername = fullName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 20)
    const fallbackUsername = normalizedEmail.split('@')[0] || 'student'
    const baseUsername = generatedUsername || fallbackUsername

    let finalUsername = baseUsername
    let suffix = 1
    while (users.some((user) => String(user.username || '').toLowerCase() === finalUsername)) {
      suffix += 1
      finalUsername = `${baseUsername}${suffix}`.slice(0, 24)
    }

    const nextUsers = [
      ...users,
      {
        username: finalUsername,
        fullName: fullName.trim(),
        email: normalizedEmail,
        password,
      },
    ]
    saveStoredUsers(nextUsers)

    setMode('signin')
    setUsername(normalizedEmail)
    setPassword('')
    setFullName('')
    setEmail('')
    setConfirmPassword('')
    setAuthSuccess(`Account created successfully. Sign in with ${normalizedEmail} or username ${finalUsername}.`)
  }

  const handleGoogleSignIn = async () => {
    setAuthError('')
    setAuthSuccess('')
    setIsGoogleLoading(true)

    try {
      const configResponse = await fetch(buildApiUrl('/api/auth/google/config/'))
      const configPayload = await configResponse.json().catch(() => ({}))
      if (!configResponse.ok) {
        throw new Error(configPayload?.error || 'Google auth is not configured on the server.')
      }

      const clientId = String(configPayload?.clientId || '').trim()
      if (!clientId) {
        throw new Error('Google client ID was not returned by the server.')
      }

      const redirectUri = String(configPayload?.redirectUri || window.location.origin).trim() || window.location.origin

      await loadGoogleIdentityScript()
      if (!window.google?.accounts?.oauth2) {
        throw new Error('Google Identity SDK is unavailable.')
      }

      const codeClient = window.google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: 'openid email profile',
        ux_mode: 'redirect',
        redirect_uri: redirectUri,
      })

      const query = new URLSearchParams(window.location.search)
      query.set('redirect_uri', redirectUri)
      const nextUrl = `${window.location.pathname}?${query.toString()}${window.location.hash}`
      window.history.replaceState({}, '', nextUrl)

      codeClient.requestCode()
    } catch (error) {
      setAuthError(String(error?.message || 'Google authentication failed.'))
      setIsGoogleLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#fefce8_40%,#fff7ed_100%)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 top-10 h-44 w-44 rounded-full bg-amber-200/45 blur-2xl" />
        <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-cyan-200/35 blur-2xl" />
      </div>

      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-xl items-center">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_18px_70px_-24px_rgba(15,23,42,0.35)] backdrop-blur-sm sm:p-8">
          <div className="mx-auto mb-7 inline-flex w-full rounded-2xl bg-slate-100 p-1.5">
            <button
              type="button"
              className={`w-1/2 rounded-xl px-4 py-2 text-sm font-semibold transition ${isSignIn ? tabStyles.active : tabStyles.idle}`}
              onClick={() => {
                setMode('signin')
                setAuthError('')
                setAuthSuccess('')
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`w-1/2 rounded-xl px-4 py-2 text-sm font-semibold transition ${!isSignIn ? tabStyles.active : tabStyles.idle}`}
              onClick={() => {
                setMode('signup')
                setAuthError('')
                setAuthSuccess('')
              }}
            >
              Sign Up
            </button>
          </div>

          <h2 className="text-3xl font-black text-slate-900">{isSignIn ? 'Welcome Back' : 'Create Your Account'}</h2>
          <p className="mt-2 text-sm text-slate-600">
            {isSignIn ? 'Sign in to continue your learning journey.' : 'Sign up in seconds and start learning with AI.'}
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {!isSignIn && (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="full-name">
                  Full Name
                </label>
                <input
                  id="full-name"
                  name="fullName"
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor={isSignIn ? 'username' : 'email'}>
                {isSignIn ? 'Username or Email' : 'Email'}
              </label>
              <input
                id={isSignIn ? 'username' : 'email'}
                name={isSignIn ? 'username' : 'email'}
                type={isSignIn ? 'text' : 'email'}
                value={isSignIn ? username : email}
                onChange={(event) => {
                  if (isSignIn) {
                    setUsername(event.target.value)
                  } else {
                    setEmail(event.target.value)
                  }
                }}
                placeholder={isSignIn ? 'nijanth' : 'you@example.com'}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
            </div>

            {!isSignIn && (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="confirm-password">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter password"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                />
              </div>
            )}

            {authError && <p className="text-sm font-medium text-rose-600">{authError}</p>}
            {authSuccess && <p className="text-sm font-medium text-emerald-700">{authSuccess}</p>}

            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {isSignIn ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
          >
            <FcGoogle className="h-5 w-5" />
            {isGoogleLoading ? 'Connecting to Google...' : 'Continue with Google'}
          </button>

          <p className="mt-6 text-center text-sm text-slate-600">
            {isSignIn ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              className="font-semibold text-amber-700 transition hover:text-amber-800"
              onClick={() => {
                setMode(isSignIn ? 'signup' : 'signin')
                setAuthError('')
                setAuthSuccess('')
              }}
            >
              {isSignIn ? 'Sign Up' : 'Sign In'}
            </button>
          </p>

        </div>
      </section>
    </main>
  )
}

export default AuthPage

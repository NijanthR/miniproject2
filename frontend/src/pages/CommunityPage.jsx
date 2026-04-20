import { useCallback, useEffect, useMemo, useState } from 'react'
import { FiSend, FiTrash2 } from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'
import { buildApiUrl } from '../config/api.js'

const MESSAGE_TTL_MS = 60 * 1000
const PROFILE_STORAGE_KEY = 'teaching-assistant-google-user'

function getStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return { name: 'Student', picture: '' }
    const parsed = JSON.parse(raw)
    return {
      name: String(parsed?.name || 'Student'),
      picture: String(parsed?.picture || ''),
    }
  } catch {
    return { name: 'Student', picture: '' }
  }
}

function Avatar({ name, imageUrl }) {
  const [hasError, setHasError] = useState(false)
  const initial = String(name || 'S').trim().charAt(0).toUpperCase() || 'S'
  const showImage = Boolean(imageUrl) && !hasError

  if (showImage) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
        onError={() => setHasError(true)}
      />
    )
  }

  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-200 text-xs font-semibold text-teal-900">
      {initial}
    </div>
  )
}

function CommunityPage() {
  const { theme, t } = useTheme()
  const isDark = theme === 'dark'
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('loading')
  const currentProfile = getStoredProfile()
  const currentName = currentProfile.name
  const currentPicture = currentProfile.picture

  const displayMessages = useMemo(() => {
    const now = Date.now()
    return messages.filter((msg) => now - msg.timestamp * 1000 < MESSAGE_TTL_MS)
  }, [messages])

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(buildApiUrl(`/api/community/messages/?name=${encodeURIComponent(currentName)}`))
      if (!response.ok) throw new Error('Failed to load messages.')
      const payload = await response.json()
      setMessages(Array.isArray(payload?.messages) ? payload.messages : [])
      setStatus('online')
    } catch {
      setStatus('offline')
    }
  }, [currentName])

  useEffect(() => {
    let isMounted = true

    const poll = async () => {
      if (!isMounted) return
      await fetchMessages()
    }

    poll()
    const interval = setInterval(poll, 3000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [fetchMessages])

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => prev.filter((msg) => now - msg.timestamp * 1000 < MESSAGE_TTL_MS))
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleSend = () => {
    const trimmed = draft.trim()
    if (!trimmed) return

    fetch(buildApiUrl('/api/community/messages/post/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentName,
        message: trimmed,
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to send message.')
        return response.json()
      })
      .then(() => {
        setDraft('')
        fetchMessages()
      })
      .catch(() => {
        setStatus('offline')
      })
  }

  const handleDelete = (messageId) => {
    fetch(buildApiUrl('/api/community/messages/delete/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        name: currentName,
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to delete message.')
        return response.json()
      })
      .then(() => {
        fetchMessages()
      })
      .catch(() => {
        setStatus('offline')
      })
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`flex h-full w-full flex-col overflow-y-auto ${t.pageBg}`}>
      <div className="flex w-full flex-1 flex-col px-6 py-6">
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className={`text-2xl font-bold ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>Community chat</h1>
              <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Public messages disappear after 1 minute.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                status === 'online'
                  ? isDark
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : 'bg-emerald-100 text-emerald-700'
                  : isDark
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {status}
            </span>
          </div>

          <div className={`mt-6 flex flex-1 flex-col rounded-2xl border ${isDark ? 'border-slate-700 bg-slate-800/60' : 'border-teal-100 bg-teal-50/70'}`}>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {displayMessages.length === 0 ? (
                <p className={`text-center text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  No messages yet. Say hi!
                </p>
              ) : (
                displayMessages.map((msg) => {
                  const isCurrentUser = msg.name === currentName
                  const avatarUrl = isCurrentUser ? currentPicture : ''
                  return (
                    <div key={msg.id} className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex max-w-[92%] items-start gap-3 ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
                        <Avatar name={msg.name} imageUrl={avatarUrl} />
                        <div
                          className={`flex-1 rounded-2xl border px-4 py-3 text-sm ${
                            isDark ? 'border-slate-700 bg-slate-900/70' : 'border-teal-200 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className={`text-xs font-semibold ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>
                              {msg.name}
                            </p>
                            {isCurrentUser ? (
                              <button
                                type="button"
                                onClick={() => handleDelete(msg.id)}
                                className={`rounded-lg p-1 text-xs transition ${
                                  isDark
                                    ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                                }`}
                                aria-label="Delete message"
                              >
                                <FiTrash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                          <p className={`mt-1 text-sm ${isDark ? 'text-slate-100' : 'text-slate-700'}`}>
                            {msg.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className={`border-t px-4 py-3 ${isDark ? 'border-slate-700' : 'border-teal-100'}`}>
              <div className="flex items-end gap-3">
                <textarea
                  rows={2}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Share with the community..."
                  className={`flex-1 resize-none rounded-2xl border px-3 py-2 text-sm outline-none transition ${
                    isDark
                      ? 'border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:border-teal-500'
                      : 'border-teal-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-teal-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
                    isDark
                      ? 'bg-teal-500/80 text-slate-900 hover:bg-teal-400'
                      : 'bg-teal-600 text-white hover:bg-teal-700'
                  }`}
                  aria-label="Send message"
                >
                  <FiSend className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommunityPage

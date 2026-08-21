import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiMessageSquare, FiSend, FiSmile, FiTrash2, FiUsers, FiZap } from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'
import { buildApiUrl, buildWsUrl } from '../config/api.js'

const MESSAGE_TTL_MS = 60 * 1000
const PROFILE_STORAGE_KEY = 'teaching-assistant-google-user'
const EMOJI_LIST = ['👍', '❤️', '🚀', '💡', '🔥']

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

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'just now'
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp * 1000) / 1000))
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  return `${Math.floor(diffSec / 60)}m ago`
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
        className="h-9 w-9 shrink-0 rounded-xl object-cover ring-2 ring-teal-500/20 shadow-xs"
        onError={() => setHasError(true)}
      />
    )
  }

  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-linear-to-tr from-teal-500 to-cyan-400 text-xs font-bold text-white shadow-xs">
      {initial}
    </div>
  )
}

function dedupeMessages(list) {
  if (!Array.isArray(list)) return []
  const seenIds = new Set()
  const seenSignatures = new Set()
  const result = []
  for (const msg of list) {
    if (!msg || !msg.message) continue
    const idKey = String(msg.id)
    const sigKey = `${msg.name}:::${msg.message}:::${Math.floor((msg.timestamp || 0) / 2)}`
    if (seenIds.has(idKey) || seenSignatures.has(sigKey)) continue
    seenIds.add(idKey)
    seenSignatures.add(sigKey)
    result.push(msg)
  }
  return result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

function CommunityPage() {
  const { theme, t } = useTheme()
  const isDark = theme === 'dark'
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('connecting')
  const [reactions, setReactions] = useState({})
  const chatBottomRef = useRef(null)
  const wsRef = useRef(null)
  const currentProfile = getStoredProfile()
  const currentName = currentProfile.name
  const currentPicture = currentProfile.picture

  const displayMessages = useMemo(() => {
    const now = Date.now()
    return dedupeMessages(messages.filter((msg) => now - msg.timestamp * 1000 < MESSAGE_TTL_MS))
  }, [messages])

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(buildApiUrl(`/api/community/messages/?name=${encodeURIComponent(currentName)}`))
      if (!response.ok) throw new Error('Failed to load messages.')
      const payload = await response.json()
      if (Array.isArray(payload?.messages)) {
        setMessages((prev) => dedupeMessages([...payload.messages, ...prev]))
      }
      setStatus('online')
    } catch {
      // Ignore if offline
    }
  }, [currentName])

  // WebSocket Connection
  useEffect(() => {
    let ws = null
    let reconnectTimeout = null
    let isMounted = true

    const connectWs = () => {
      try {
        const wsUrl = buildWsUrl('/ws/community/')
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (isMounted) setStatus('online')
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'snapshot' && Array.isArray(data.messages)) {
              setMessages(dedupeMessages(data.messages))
            } else if (data.type === 'message' && data.message) {
              setMessages((prev) => dedupeMessages([...prev, data.message]))
            } else if (data.type === 'delete' && data.id) {
              setMessages((prev) => prev.filter((m) => String(m.id) !== String(data.id)))
            }
          } catch {
            // Ignore parsing error
          }
        }

        ws.onclose = () => {
          if (isMounted) {
            reconnectTimeout = setTimeout(connectWs, 4000)
          }
        }

        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        // Fallback to polling if WebSocket fails
      }
    }

    connectWs()
    fetchMessages()

    const pollInterval = setInterval(() => {
      if (isMounted) fetchMessages()
    }, 4000)

    const pruneInterval = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => prev.filter((msg) => now - msg.timestamp * 1000 < MESSAGE_TTL_MS))
    }, 5000)

    return () => {
      isMounted = false
      clearTimeout(reconnectTimeout)
      clearInterval(pollInterval)
      clearInterval(pruneInterval)
      if (ws) ws.close()
    }
  }, [fetchMessages])

  const handleSend = () => {
    const trimmed = draft.trim()
    if (!trimmed) return

    setDraft('')

    // If WebSocket is actively open, send only via WebSocket to prevent duplicate posts
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            name: currentName,
            message: trimmed,
          })
        )
        return
      } catch {
        // If WebSocket send fails, fall through to REST
      }
    }

    // Fallback: Post via REST
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
      .then((savedMsg) => {
        if (savedMsg && savedMsg.id) {
          setMessages((prev) => dedupeMessages([...prev, savedMsg]))
        }
      })
      .catch(() => {
        // Ignore
      })
  }

  const handleDelete = (messageId) => {
    setMessages((prev) => prev.filter((m) => String(m.id) !== String(messageId)))

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            action: 'delete',
            id: messageId,
            name: currentName,
          })
        )
      } catch {
        // Fallback to REST
      }
    }

    fetch(buildApiUrl('/api/community/messages/delete/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: messageId,
        name: currentName,
      }),
    }).catch(() => {
      // Ignore
    })
  }

  const handleAddReaction = (messageId, emoji) => {
    setReactions((prev) => {
      const msgReactions = prev[messageId] || {}
      const currentCount = msgReactions[emoji] || 0
      return {
        ...prev,
        [messageId]: {
          ...msgReactions,
          [emoji]: currentCount + 1,
        },
      }
    })
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const quickStarters = [
    '👋 Hello everyone!',
    '📚 Who wants to practice Python code?',
    '💡 Any tips for dynamic programming?',
  ]

  return (
    <div className={`flex h-full w-full flex-col overflow-y-auto ${t.pageBg}`}>
      <div className="flex w-full flex-1 flex-col px-4 py-6 sm:px-8 max-w-5xl mx-auto">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-teal-500/20 bg-white/60 dark:bg-slate-900/40 p-5 shadow-xs backdrop-blur-md">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-500 text-white shadow-xs">
                  <FiUsers className="h-4 w-4" />
                </span>
                <h1 className={`text-2xl font-bold ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>
                  Community Study Lounge
                </h1>
              </div>
              <p className={`mt-1 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Collaborate with peers in real-time. Ephemeral messages disappear after 1 minute.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold ${
                  status === 'online'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{status === 'online' ? 'Live Connected' : 'Connecting...'}</span>
              </span>
            </div>
          </div>

          {/* Quick starter chips */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-400">Quick Say:</span>
            {quickStarters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => setDraft(starter)}
                className="rounded-xl border border-teal-500/20 bg-white/70 dark:bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 transition-all hover:scale-105 active:scale-95 hover:border-teal-400"
              >
                {starter}
              </button>
            ))}
          </div>

          {/* Chat box */}
          <div className={`mt-4 flex flex-1 flex-col rounded-3xl border shadow-sm ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-teal-50/50'}`}>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              {displayMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center p-8">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-100 text-teal-600 dark:bg-slate-800 dark:text-teal-400 mb-3">
                    <FiMessageSquare className="h-6 w-6" />
                  </div>
                  <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    No active messages right now.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Be the first to say hi to students studying right now!
                  </p>
                </div>
              ) : (
                displayMessages.map((msg) => {
                  const isCurrentUser = msg.name === currentName
                  const avatarUrl = isCurrentUser ? currentPicture : ''
                  const msgReactions = reactions[msg.id] || {}

                  return (
                    <div key={msg.id} className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'} animate-slide-up`}>
                      <div className={`flex max-w-[92%] sm:max-w-[80%] items-start gap-3 ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
                        <Avatar name={msg.name} imageUrl={avatarUrl} />
                        <div
                          className={`flex-1 rounded-3xl border p-4 text-sm shadow-xs transition-all ${
                            isCurrentUser
                              ? 'border-teal-500/30 bg-linear-to-br from-teal-500/10 to-teal-500/5 dark:bg-slate-800/90'
                              : isDark
                                ? 'border-slate-800 bg-slate-900/90'
                                : 'border-teal-200/80 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5 mb-2">
                            <div className="flex items-center gap-2">
                              <p className={`text-xs font-bold ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>
                                {msg.name}
                              </p>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {formatTimeAgo(msg.timestamp)}
                              </span>
                            </div>
                            {isCurrentUser ? (
                              <button
                                type="button"
                                onClick={() => handleDelete(msg.id)}
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400 transition"
                                title="Delete message"
                                aria-label="Delete message"
                              >
                                <FiTrash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                          <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                            {msg.message}
                          </p>

                          {/* Reaction bar */}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                            {EMOJI_LIST.map((emoji) => {
                              const count = msgReactions[emoji] || 0
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleAddReaction(msg.id, emoji)}
                                  className={`inline-flex items-center gap-1 rounded-xl px-2 py-0.5 text-xs transition-all hover:scale-110 active:scale-95 ${
                                    count > 0
                                      ? 'bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 font-bold border border-teal-500/30'
                                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600'
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  {count > 0 && <span>{count}</span>}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input bar */}
            <div className={`border-t p-4 ${isDark ? 'border-slate-800 bg-slate-900/80' : 'border-teal-200/80 bg-white/80'} backdrop-blur-md rounded-b-3xl`}>
              <div className="flex items-end gap-3">
                <div className="relative flex-1">
                  <textarea
                    rows={2}
                    value={draft}
                    maxLength={500}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Share an insight or question with the community..."
                    className={`w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none transition ${
                      isDark
                        ? 'border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:border-teal-500'
                        : 'border-teal-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-teal-500'
                    }`}
                  />
                  <div className="absolute bottom-2.5 right-3 text-[10px] font-semibold text-slate-400 select-none">
                    {draft.length}/500
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!draft.trim()}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all duration-200 ${
                    draft.trim()
                      ? 'bg-linear-to-tr from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/25 hover:scale-105 active:scale-95'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
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

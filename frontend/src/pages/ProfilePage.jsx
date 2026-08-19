import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiActivity, FiAward, FiBookOpen, FiCode, FiLogOut, FiMail, FiShield, FiUser, FiZap } from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'

const PROFILE_STORAGE_KEY = 'teaching-assistant-google-user'
const CHAT_CONVERSATION_ID_KEY = 'teaching-assistant-conversation-id'
const CHAT_MESSAGES_KEY = 'teaching-assistant-chat-messages'

function getStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function ProfilePage() {
  const { theme, t } = useTheme()
  const isDark = theme === 'dark'
  const profile = useMemo(() => getStoredProfile(), [])
  const navigate = useNavigate()
  const [imageError, setImageError] = useState(false)

  const name = String(profile?.name || 'Student')
  const email = String(profile?.email || 'student@local.dev')
  const picture = String(profile?.picture || '')
  const normalizedPicture = picture.startsWith('http:')
    ? picture.replace('http:', 'https:')
    : picture.startsWith('//')
      ? `https:${picture}`
      : picture
  const showPicture = Boolean(normalizedPicture) && !imageError
  const userId = String(profile?.sub || 'ID-8492048')
  const provider = profile?.email ? 'Google Cloud' : 'Local User'

  const handleSignOut = () => {
    const identity = String(profile?.sub || profile?.email || '').trim().toLowerCase()
    const profileConversationKey = identity
      ? `${CHAT_CONVERSATION_ID_KEY}:${identity}`
      : CHAT_CONVERSATION_ID_KEY
    const profileMessagesKey = identity
      ? `${CHAT_MESSAGES_KEY}:${identity}`
      : CHAT_MESSAGES_KEY

    localStorage.removeItem(CHAT_CONVERSATION_ID_KEY)
    localStorage.removeItem(profileConversationKey)
    localStorage.removeItem(CHAT_MESSAGES_KEY)
    localStorage.removeItem(profileMessagesKey)
    localStorage.removeItem(PROFILE_STORAGE_KEY)
    navigate('/', { replace: true })
  }

  const achievements = [
    { title: 'AI Scholar', icon: '🧠', desc: 'Explored multi-step concepts' },
    { title: 'Code Warrior', icon: '💻', desc: 'Ran Python Sandbox challenges' },
    { title: 'Quiz Master', icon: '🏆', desc: 'Completed customized MCQ tests' },
    { title: 'Fast Learner', icon: '⚡', desc: 'Active study session ongoing' },
  ]

  return (
    <div className={`flex h-full w-full flex-col overflow-y-auto ${t.pageBg}`}>
      <div className="mx-auto w-full max-w-4xl px-6 py-10 space-y-6">
        {/* Main profile banner */}
        <div className={`rounded-3xl border p-6 shadow-md backdrop-blur-md transition-all ${isDark ? 'border-slate-800 bg-slate-900/70' : 'border-teal-200/80 bg-white/80'}`}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-5">
              <div className="relative">
                {showPicture ? (
                  <img
                    src={normalizedPicture}
                    alt={name}
                    className="h-24 w-24 rounded-3xl object-cover ring-4 ring-teal-500/30 shadow-lg"
                    onError={() => setImageError(true)}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="grid h-24 w-24 place-items-center rounded-3xl bg-linear-to-br from-teal-400 via-teal-500 to-cyan-600 text-3xl font-extrabold text-white shadow-lg shadow-teal-500/25">
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-white dark:border-slate-900" />
                </span>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h1 className={`text-2xl font-bold ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>{name}</h1>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'bg-teal-950/60 text-teal-300 border border-teal-500/30' : 'bg-teal-100 text-teal-800'}`}>
                    {provider}
                  </span>
                </div>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{email}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 dark:text-teal-400">
                    <FiAward className="h-3.5 w-3.5" /> Pro Student Pass
                  </span>
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-50/60 dark:bg-rose-950/30 px-5 py-2.5 text-xs font-bold text-rose-600 dark:text-rose-300 transition-all hover:bg-rose-100 dark:hover:bg-rose-900/50 hover:scale-105 active:scale-95 shadow-xs"
              >
                <FiLogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* Learning Statistics */}
        <div>
          <h2 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-teal-400' : 'text-teal-700'}`}>
            Learning Stats &amp; Progress
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <StatCard icon={<FiZap className="h-4 w-4 text-amber-500" />} label="Streak" value="5 Days" isDark={isDark} />
            <StatCard icon={<FiBookOpen className="h-4 w-4 text-teal-500" />} label="MCQ Solved" value="45 Questions" isDark={isDark} />
            <StatCard icon={<FiCode className="h-4 w-4 text-indigo-500" />} label="Code Tests" value="12 Challenges" isDark={isDark} />
            <StatCard icon={<FiActivity className="h-4 w-4 text-emerald-500" />} label="Avg Score" value="92% Accuracy" isDark={isDark} />
          </div>
        </div>

        {/* Badges showcase */}
        <div>
          <h2 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-teal-400' : 'text-teal-700'}`}>
            Earned Badges
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            {achievements.map((item, i) => (
              <div
                key={i}
                className={`flex flex-col items-center justify-center rounded-3xl border p-4 text-center shadow-xs transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${
                  isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-white/70'
                }`}
              >
                <span className="text-3xl mb-1.5">{item.icon}</span>
                <p className={`text-xs font-bold ${isDark ? 'text-teal-200' : 'text-teal-900'}`}>{item.title}</p>
                <p className="mt-0.5 text-[11px] text-slate-400 line-clamp-1">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Account Details Cards */}
        <div>
          <h2 className={`text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-teal-400' : 'text-teal-700'}`}>
            Account Information
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileCard icon={<FiUser className="h-4 w-4" />} label="Full Name" value={name} isDark={isDark} />
            <ProfileCard icon={<FiMail className="h-4 w-4" />} label="Email Address" value={email} isDark={isDark} />
            <ProfileCard icon={<FiShield className="h-4 w-4" />} label="Authentication" value={provider} isDark={isDark} />
            <ProfileCard icon={<FiShield className="h-4 w-4" />} label="Account ID" value={userId} isDark={isDark} />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, isDark }) {
  return (
    <div className={`rounded-3xl border p-4 shadow-xs backdrop-blur-md ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-white/70'}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800">{icon}</span>
        <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      </div>
      <p className={`mt-2 text-base font-extrabold ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>{value}</p>
    </div>
  )
}

function ProfileCard({ icon, label, value, isDark }) {
  return (
    <div className={`flex items-center gap-3.5 rounded-3xl border p-4 shadow-xs backdrop-blur-md ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-teal-200/80 bg-white/70'}`}>
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl shadow-xs ${isDark ? 'bg-slate-800 text-teal-300' : 'bg-teal-100 text-teal-700'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`text-sm font-semibold truncate ${isDark ? 'text-teal-100' : 'text-teal-900'}`}>{value}</p>
      </div>
    </div>
  )
}

export default ProfilePage

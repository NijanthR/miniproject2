import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { FiActivity, FiChevronRight, FiHome, FiSettings, FiUsers } from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'
import hatLogo from '../assets/HAT.png'

const navItems = [
  { label: 'Dashboard', icon: 'dashboard', to: '/app', exact: true },
  { label: 'Test', icon: 'activity', to: '/app/test' },
  { label: 'Community', icon: 'users', to: '/app/community' },
]

const synexisLogoUrl = hatLogo
const PROFILE_STORAGE_KEY = 'teaching-assistant-google-user'

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

function SideNav() {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [failedImageUrl, setFailedImageUrl] = useState(null)
  const { t } = useTheme()
  const profile = getStoredProfile()
  const profileName = String(profile?.name || 'Student')
  const profileEmail = String(profile?.email || 'student@local')
  const profileImage = String(profile?.picture || '')
  const normalizedProfileImage = profileImage.startsWith('http:')
    ? profileImage.replace('http:', 'https:')
    : profileImage.startsWith('//')
      ? `https:${profileImage}`
      : profileImage
  const showProfileImage = Boolean(normalizedProfileImage) && failedImageUrl !== normalizedProfileImage

  return (
    <aside
      className={`relative flex h-full flex-col overflow-visible border-r px-3 pb-5 pt-6 transition-all duration-300 ease-out select-none ${t.sidebarBg} ${t.sidebarBorder} ${t.sidebarText} ${
        isCollapsed ? 'w-22' : 'w-72'
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="group relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-transparent transition-transform hover:scale-105">
            <img
              src={synexisLogoUrl}
              alt="Synexis logo"
              className="h-10 w-10 rounded-xl object-contain drop-shadow-sm"
            />
          </div>
          <span className={`overflow-hidden whitespace-nowrap text-lg font-bold tracking-tight transition-[opacity,max-width] duration-300 ease-out ${isCollapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'}`}>
            Straw Hat
          </span>
        </div>
        <button
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 ${t.sidebarChevron}`}
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <FiChevronRight className={`h-4 w-4 transition-transform duration-300 ${isCollapsed ? 'rotate-0' : 'rotate-180'}`} />
        </button>
      </div>

      <div className={`mt-6 h-px w-full bg-linear-to-r from-transparent ${t.sidebarDivider} to-transparent opacity-60`} />

      <nav className="mt-6 space-y-2 text-sm">
        {navItems.map((item) => (
          <SidebarItem key={item.label} {...item} collapsed={isCollapsed} />
        ))}
      </nav>

      <div className="mt-auto">
        <div className={`mt-6 h-px w-full bg-linear-to-r from-transparent ${t.sidebarDivider} to-transparent opacity-60`} />

        <div className="relative group/tooltip">
          <NavLink
            to="/app/settings"
            className={({ isActive }) =>
              `mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${
                isActive ? t.sidebarActive : t.sidebarSettingsHover
              }`
            }
          >
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg shadow-xs transition-transform duration-200 group-hover/tooltip:scale-105 ${t.sidebarIconBg} ${t.sidebarIconText}`}>
              <FiSettings className="h-5 w-5" />
            </span>
            <span className={`overflow-hidden whitespace-nowrap font-medium transition-[opacity,max-width] duration-300 ease-out ${isCollapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'}`}>Settings</span>
          </NavLink>
          {isCollapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg opacity-0 transition-opacity duration-200 group-hover/tooltip:opacity-100 z-50 whitespace-nowrap">
              Settings
            </div>
          )}
        </div>

        <div className="relative group/tooltip">
          <NavLink
            to="/app/profile"
            className={`mt-4 flex items-center gap-3 rounded-2xl p-2.5 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-teal-500/10 shadow-xs ${t.sidebarUserCard}`}
          >
            <div className="relative">
              {showProfileImage ? (
                <img
                  src={normalizedProfileImage}
                  alt={profileName}
                  className="h-10 w-10 shrink-0 rounded-xl object-cover ring-2 ring-teal-500/20"
                  onError={() => setFailedImageUrl(normalizedProfileImage)}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-radial-[at_top] from-white via-teal-300 to-teal-500 text-sm font-bold text-slate-800 shadow-inner">
                  {profileName.slice(0, 1).toUpperCase()}
                </div>
              )}
              {/* Online pulse beacon */}
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white dark:border-slate-800"></span>
              </span>
            </div>
            <div className={`overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-300 ease-out ${isCollapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'}`}>
              <p className={`text-sm font-semibold truncate ${t.sidebarUserName}`}>{profileName}</p>
              <p className={`text-[11px] truncate opacity-75 ${t.sidebarUserEmail}`}>{profileEmail}</p>
            </div>
          </NavLink>
          {isCollapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg opacity-0 transition-opacity duration-200 group-hover/tooltip:opacity-100 z-50 whitespace-nowrap">
              {profileName}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function SidebarItem({ label, icon, to, collapsed = false, exact = false }) {
  const hasIcon = Boolean(icon)
  const { t } = useTheme()

  return (
    <div className="relative group/tooltip">
      <NavLink
        to={to}
        end={exact}
        className={({ isActive }) =>
          `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${
            isActive ? `${t.sidebarActive} font-semibold shadow-xs` : `${t.sidebarHover} font-medium`
          }`
        }
      >
        {hasIcon && (
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg shadow-xs transition-transform duration-200 group-hover/tooltip:scale-105 ${t.sidebarIconBg} ${t.sidebarIconText}`}>
            <NavIcon type={icon} />
          </span>
        )}
        <span className={`overflow-hidden whitespace-nowrap text-sm transition-[opacity,max-width] duration-300 ease-out ${collapsed ? 'max-w-0 opacity-0' : 'max-w-xs opacity-100'}`}>
          {label}
        </span>
      </NavLink>
      {collapsed && (
        <div className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg opacity-0 transition-opacity duration-200 group-hover/tooltip:opacity-100 z-50 whitespace-nowrap">
          {label}
        </div>
      )}
    </div>
  )
}

function NavIcon({ type }) {
  switch (type) {
    case 'dashboard':
      return <FiHome className="h-5 w-5" />
    case 'activity':
      return <FiActivity className="h-5 w-5" />
    case 'users':
      return <FiUsers className="h-5 w-5" />
    default:
      return <FiHome className="h-5 w-5" />
  }
}

export default SideNav

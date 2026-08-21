const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')

export const API_BASE_URL = rawApiBaseUrl || window.location.origin

export function buildApiUrl(path = '') {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`
  return `${API_BASE_URL}${normalizedPath}`
}

const rawWsBaseUrl = String(import.meta.env.VITE_WS_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')

export function buildWsUrl(path = '') {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`
  if (rawWsBaseUrl) {
    return `${rawWsBaseUrl}${normalizedPath}`
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const host = isLocal ? `${window.location.hostname}:8000` : window.location.host
  return `${protocol}//${host}${normalizedPath}`
}

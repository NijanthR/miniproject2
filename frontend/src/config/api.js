const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')

export const API_BASE_URL = rawApiBaseUrl || window.location.origin

export function buildApiUrl(path = '') {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`
  return `${API_BASE_URL}${normalizedPath}`
}

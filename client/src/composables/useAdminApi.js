import { useAuthStore } from '../stores/auth.js'

export function useAdminApi() {
  const base = import.meta.env.VITE_API_BASE_URL || ''

  function headers() {
    const auth = useAuthStore()
    return {
      'Content-Type': 'application/json',
      'x-admin-token': auth.adminToken
    }
  }

  async function request(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const data = await res.json()
        msg = data.message || data.error || msg
      } catch (_) { /* ignore parse errors */ }
      throw new Error(msg)
    }
    if (res.status === 204) return null
    return res.json()
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path)
  }
}

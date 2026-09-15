import { useUserAuthStore } from '../stores/userAuth.js'
import router from '../router/index.js'

// useUserApi — mirrors useAdminApi.js line for line, except it reads the
// token from userAuth.js (the separate usuario identity space) and, on a
// 401, redirects to /user/login instead of /admin/login.
export function useUserApi() {
  const base = import.meta.env.VITE_API_BASE_URL || ''

  function headers() {
    const auth = useUserAuthStore()
    const h = { 'Content-Type': 'application/json' }
    // Bearer JWT — the server's requireUserAuth middleware reads this header
    // and expects a token with aud: 'usuario'.
    if (auth.token) h['Authorization'] = `Bearer ${auth.token}`
    return h
  }

  async function request(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined
    })

    // A 401 means the token is missing/expired/invalid — drop it and send
    // the usuario back to their own login screen so they can re-authenticate.
    if (res.status === 401) {
      useUserAuthStore().logout()
      router.push('/user/login')
      throw new Error('Tu sesión expiró. Iniciá sesión de nuevo.')
    }

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
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path)
  }
}

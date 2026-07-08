import { defineStore } from 'pinia'

// Persisted keys. The auth model is now a JWT (access token) plus the
// authenticated admin's public identity — no more single shared admin token.
const TOKEN_KEY = 'authToken'
const ADMIN_KEY = 'authAdmin'

function loadAdmin() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_KEY)) || null
  } catch {
    // Corrupt/legacy value — treat as logged out for the admin object.
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    admin: loadAdmin()
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    role: (state) => state.admin?.role ?? null,
    isSuperadmin: (state) => state.admin?.role === 'superadmin'
  },
  actions: {
    // login — store the signed JWT and the admin identity returned by
    // POST /api/auth/login ({ id, email }).
    login(token, admin) {
      this.token = token
      this.admin = admin ?? null
      localStorage.setItem(TOKEN_KEY, token)
      if (admin) localStorage.setItem(ADMIN_KEY, JSON.stringify(admin))
      else localStorage.removeItem(ADMIN_KEY)
    },
    // setAdmin — replace the cached identity (and re-persist) without touching
    // the token. Used when the current admin's own role/status changes so
    // getters like isSuperadmin don't go stale until the next reload.
    setAdmin(admin) {
      this.admin = admin ?? null
      if (admin) localStorage.setItem(ADMIN_KEY, JSON.stringify(admin))
      else localStorage.removeItem(ADMIN_KEY)
    },
    logout() {
      this.token = ''
      this.admin = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(ADMIN_KEY)
    }
  }
})

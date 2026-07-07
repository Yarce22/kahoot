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
    isLoggedIn: (state) => !!state.token
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
    logout() {
      this.token = ''
      this.admin = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(ADMIN_KEY)
    }
  }
})

import { defineStore } from 'pinia'

// Persisted keys — deliberately DISTINCT from auth.js's authToken/authAdmin
// so an admin session and a usuario session in the same browser never
// collide (design: usuario auth is a fully separate identity space, aud is
// 'usuario' not 'admin' server-side — see userAuth.js on the server).
const TOKEN_KEY = 'usuarioToken'
const USER_KEY = 'usuarioIdentity'

function loadUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null
  } catch {
    // Corrupt/legacy value — treat as logged out for the identity object.
    return null
  }
}

export const useUserAuthStore = defineStore('userAuth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: loadUser()
  }),
  getters: {
    isLoggedIn: (state) => !!state.token
  },
  actions: {
    // login — store the signed usuario-audience JWT and the identity
    // returned by POST /api/user/login ({ id, email, fullName, puntoDeVenta }).
    // No role/superadmin concept: usuarios have none.
    login(token, user) {
      this.token = token
      this.user = user ?? null
      localStorage.setItem(TOKEN_KEY, token)
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
      else localStorage.removeItem(USER_KEY)
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  }
})

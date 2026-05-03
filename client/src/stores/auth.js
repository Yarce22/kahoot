import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    adminToken: localStorage.getItem('adminToken') || ''
  }),
  getters: {
    isLoggedIn: (state) => !!state.adminToken
  },
  actions: {
    login(token) {
      this.adminToken = token
      localStorage.setItem('adminToken', token)
    },
    logout() {
      this.adminToken = ''
      localStorage.removeItem('adminToken')
    }
  }
})

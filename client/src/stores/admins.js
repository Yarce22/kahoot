import { defineStore } from 'pinia'
import { useAdminApi } from '../composables/useAdminApi.js'
import { useAuthStore } from './auth.js'

// admins store — superadmin-only admin management. Backs the Administradores
// view: list every admin, create new ones, and change role / active status.
export const useAdminsStore = defineStore('admins', {
  state: () => ({
    admins: [],
    loading: false,
    error: null
  }),
  actions: {
    async fetchAdmins() {
      this.loading = true
      this.error = null
      try {
        const api = useAdminApi()
        this.admins = await api.get('/api/admins')
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    async createAdmin({ email, password, role }) {
      const api = useAdminApi()
      const admin = await api.post('/api/admins', { email, password, role })
      this.admins.push({ ...admin, created_at: new Date().toISOString() })
      return admin
    },
    // updateAdmin — PATCH role and/or is_active. Replaces the local row with
    // the server's response so the list reflects the guards it enforced.
    async updateAdmin(id, changes) {
      const api = useAdminApi()
      const updated = await api.patch(`/api/admins/${id}`, changes)
      const idx = this.admins.findIndex(a => a.id === id)
      if (idx !== -1) this.admins[idx] = { ...this.admins[idx], ...updated }
      // If a superadmin just changed their OWN role/status, refresh the auth
      // identity so isSuperadmin (nav, route guard) reflects it immediately.
      const auth = useAuthStore()
      if (auth.admin?.id === id) auth.setAdmin({ ...auth.admin, ...updated })
      return updated
    }
  }
})

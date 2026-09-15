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
    // punto_de_venta is part of the payload, not optional: admins.punto_de_venta
    // is NOT NULL with no default (migration 010) and POST /api/admins rejects
    // a body without it (400). There is no safe store to fall back to, so the
    // caller must always supply one. name (migration 015) is optional — the
    // server accepts it missing or null, so it's just forwarded as-is.
    async createAdmin({ email, password, role, punto_de_venta, name }) {
      const api = useAdminApi()
      const admin = await api.post('/api/admins', { email, password, role, punto_de_venta, name })
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

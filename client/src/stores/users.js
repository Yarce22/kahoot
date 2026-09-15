import { defineStore } from 'pinia'
import { useAdminApi } from '../composables/useAdminApi.js'

// users store — store-scoped usuario management (the async-quiz-taking role,
// distinct from admins.js). Backs UsersView: create, paginated list, and
// activate/deactivate. Mirrors admins.js's shape (state + loading/error,
// thin actions over useAdminApi()).
export const useUsersStore = defineStore('users', {
  state: () => ({
    users: [],
    page: 1,
    pageSize: 25,
    total: 0,
    loading: false,
    error: null
  }),
  actions: {
    // fetchUsers — GET /api/users with page/page_size/q/is_active/
    // punto_de_venta as query params. `params` is built rather than passed
    // straight through so undefined values (an omitted filter) never render
    // as the literal string "undefined" in the URL.
    async fetchUsers({ page, page_size, q, is_active, punto_de_venta } = {}) {
      this.loading = true
      this.error = null
      try {
        const api = useAdminApi()
        const search = new URLSearchParams()
        if (page !== undefined) search.set('page', page)
        if (page_size !== undefined) search.set('page_size', page_size)
        if (q !== undefined && q !== '') search.set('q', q)
        if (is_active !== undefined) search.set('is_active', is_active)
        if (punto_de_venta !== undefined && punto_de_venta !== '') search.set('punto_de_venta', punto_de_venta)
        const qs = search.toString()
        const res = await api.get(`/api/users${qs ? `?${qs}` : ''}`)
        this.users = res.users ?? []
        this.page = res.page
        this.pageSize = res.page_size
        this.total = res.total
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    // createUser — punto_de_venta is optional: POST /api/users defaults it
    // server-side to the caller's own store when omitted (design decision:
    // a non-superadmin has no client-side way to know its own store, since
    // the login response never included it).
    async createUser({ full_name, email, password, punto_de_venta }) {
      const api = useAdminApi()
      const payload = { full_name, email, password }
      if (punto_de_venta !== undefined) payload.punto_de_venta = punto_de_venta
      const user = await api.post('/api/users', payload)
      this.users.unshift(user)
      return user
    },
    // updateUser — generic PATCH, any subset of { full_name, is_active,
    // punto_de_venta, password }. Used by the activate/deactivate button.
    async updateUser(id, changes) {
      const api = useAdminApi()
      const updated = await api.patch(`/api/users/${id}`, changes)
      const idx = this.users.findIndex(u => u.id === id)
      if (idx !== -1) this.users[idx] = { ...this.users[idx], ...updated }
      return updated
    }
  }
})

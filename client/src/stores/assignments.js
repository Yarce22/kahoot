import { defineStore } from 'pinia'
import { useAdminApi } from '../composables/useAdminApi.js'

// assignments store — thin API wrapper, same pattern as quiz.js's
// createSession/fetchSessionResults: no dedicated state, just an action
// that posts and hands the raw response back to the caller. Only
// createAssignments is needed for this pass (no assignments list/unassign).
export const useAssignmentsStore = defineStore('assignments', {
  actions: {
    // createAssignments — POST /api/assignments, returns { created, skipped }
    // verbatim so the caller (the Asignar popup) can render exactly what the
    // server reports, including per-user skip reasons.
    async createAssignments({ quiz_id, user_ids }) {
      const api = useAdminApi()
      return api.post('/api/assignments', { quiz_id, user_ids })
    },
    // fetchQuizAssignments — every assignment on one quiz, for the Reactivar
    // picker. Walks the server's 100-row pages until `total` is reached so a
    // quiz with more assignees than one page still lists all of them.
    async fetchQuizAssignments(quiz_id) {
      const api = useAdminApi()
      const all = []
      for (let page = 1; ; page++) {
        const search = new URLSearchParams({ quiz_id, page, page_size: 100 })
        const res = await api.get(`/api/assignments?${search}`)
        all.push(...res.assignments)
        if (!res.assignments.length || all.length >= res.total) return all
      }
    },
    // fetchProgress — GET /api/dashboard/progress, per-usuario aggregates.
    // The server forces a plain admin to their own store; superadmins may
    // pass punto_de_venta to narrow it.
    async fetchProgress({ punto_de_venta } = {}) {
      const api = useAdminApi()
      const qs = punto_de_venta ? `?${new URLSearchParams({ punto_de_venta })}` : ''
      return api.get(`/api/dashboard/progress${qs}`)
    },
    // reactivateAssignments — POST /api/assignments/reactivate, bumps the
    // assignment cycle for the given usuarios only, so they (completed,
    // expired, or still pending) can take the quiz again.
    async reactivateAssignments({ quiz_id, user_ids }) {
      const api = useAdminApi()
      return api.post('/api/assignments/reactivate', { quiz_id, user_ids })
    }
  }
})

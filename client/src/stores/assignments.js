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
    // reactivateAssignments — POST /api/assignments/reactivate, bumps the
    // quiz's assignment cycle so every usuario currently assigned to it
    // (completed, expired, or still pending) can take it again. user_ids is
    // left undefined here (not just this store's job to offer a picker) —
    // the server's own contract already treats an omitted user_ids as
    // "every assignment on the quiz".
    async reactivateAssignments({ quiz_id }) {
      const api = useAdminApi()
      return api.post('/api/assignments/reactivate', { quiz_id })
    }
  }
})

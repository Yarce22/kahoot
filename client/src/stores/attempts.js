import { defineStore } from 'pinia'
import { useAdminApi } from '../composables/useAdminApi.js'

// attempts store — admin-facing history of async (assigned) quiz attempts.
// Thin API wrapper, same "no unnecessary state" pattern as assignments.js:
// only QuizSessionsView needs this list, and that view owns its own local
// state, so nothing is cached here.
export const useAttemptsStore = defineStore('attempts', {
  actions: {
    // fetchAttempts — GET /api/attempts. Returns the raw paginated response
    // ({ attempts, page, page_size, total }) so the caller decides how to
    // render pagination, same convention as userQuizzes.js' fetchQuizzes.
    async fetchAttempts(params = {}) {
      const api = useAdminApi()
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') search.set(key, value)
      }
      const qs = search.toString()
      return api.get(`/api/attempts${qs ? `?${qs}` : ''}`)
    },
    // fetchAttempt — GET /api/attempts/:id, one attempt's full detail
    // including its answers AND the correct answer per question — admins
    // may see it (same contract as GET /api/sessions/:pin/results).
    async fetchAttempt(id) {
      const api = useAdminApi()
      return api.get(`/api/attempts/${id}`)
    }
  }
})

import { defineStore } from 'pinia'
import { useUserApi } from '../composables/useUserApi.js'

// userQuizzes store — thin wrappers over useUserApi(), mirroring the
// quiz.js/assignments.js "no unnecessary state" pattern except where the UI
// genuinely needs to hold data (the paginated list below). startAttempt/
// submitAnswer/submitAttempt/fetchResult all return the server response
// verbatim: this store does NOT hold "the current attempt" globally, since
// only UserAttemptView ever needs it — that view owns the local state.
export const useUserQuizzesStore = defineStore('userQuizzes', {
  state: () => ({
    quizzes: [],
    page: 1,
    pageSize: 25,
    total: 0,
    loading: false,
    error: null
  }),
  actions: {
    // fetchQuizzes — GET /api/user/quizzes, this usuario's own assignments
    // only (server-scoped by the JWT's sub, not a client-side filter).
    async fetchQuizzes({ page } = {}) {
      this.loading = true
      this.error = null
      try {
        const api = useUserApi()
        const search = new URLSearchParams()
        if (page !== undefined) search.set('page', page)
        const qs = search.toString()
        const res = await api.get(`/api/user/quizzes${qs ? `?${qs}` : ''}`)
        this.quizzes = res.quizzes ?? []
        this.page = res.page
        this.pageSize = res.page_size
        this.total = res.total
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    // startAttempt — POST /api/user/quizzes/:assignmentId/attempt. Starts a
    // new attempt (201) or idempotently resumes the in-progress one (200) —
    // same payload shape either way, so the caller doesn't need to branch on
    // status code, just on the body.
    async startAttempt(assignmentId) {
      const api = useUserApi()
      return api.post(`/api/user/quizzes/${assignmentId}/attempt`)
    },
    // submitAnswer — POST /api/user/attempts/:attemptId/answers. Upsert on
    // (attempt_id, question_id) server-side — safe to resend the same
    // question if the usuario changes their mind before submitting.
    async submitAnswer(attemptId, payload) {
      const api = useUserApi()
      return api.post(`/api/user/attempts/${attemptId}/answers`, payload)
    },
    // submitAttempt — POST /api/user/attempts/:attemptId/submit.
    async submitAttempt(attemptId) {
      const api = useUserApi()
      return api.post(`/api/user/attempts/${attemptId}/submit`)
    },
    // fetchResult — GET /api/user/attempts/:attemptId/result.
    async fetchResult(attemptId) {
      const api = useUserApi()
      return api.get(`/api/user/attempts/${attemptId}/result`)
    }
  }
})

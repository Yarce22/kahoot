import { defineStore } from 'pinia'
import { useAdminApi } from '../composables/useAdminApi.js'

export const useQuizStore = defineStore('quiz', {
  state: () => ({
    quizzes: [],
    activeQuiz: null,
    loading: false,
    error: null
  }),
  actions: {
    async fetchQuizzes() {
      this.loading = true
      this.error = null
      try {
        const api = useAdminApi()
        this.quizzes = await api.get('/api/quizzes')
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    async fetchQuiz(id) {
      this.loading = true
      this.error = null
      try {
        const api = useAdminApi()
        this.activeQuiz = await api.get(`/api/quizzes/${id}`)
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    async createQuiz(data) {
      const api = useAdminApi()
      const quiz = await api.post('/api/quizzes', data)
      this.quizzes.push(quiz)
      return quiz
    },
    async updateQuiz(id, data) {
      const api = useAdminApi()
      const quiz = await api.put(`/api/quizzes/${id}`, data)
      const idx = this.quizzes.findIndex(q => q.id === id)
      if (idx !== -1) this.quizzes[idx] = quiz
      if (this.activeQuiz?.id === id) Object.assign(this.activeQuiz, quiz)
      return quiz
    },
    async deleteQuiz(id) {
      const api = useAdminApi()
      await api.del(`/api/quizzes/${id}`)
      this.quizzes = this.quizzes.filter(q => q.id !== id)
    },
    async createQuestion(quizId, data) {
      const api = useAdminApi()
      const q = await api.post(`/api/quizzes/${quizId}/questions`, data)
      return { id: q.questionId, quiz_id: quizId, text: data.text, type: data.type, time_limit_seconds: data.time_limit_seconds, order_index: 0, options: [] }
    },
    async updateQuestion(id, data) {
      const api = useAdminApi()
      const q = await api.put(`/api/questions/${id}`, data)
      if (this.activeQuiz) {
        const idx = this.activeQuiz.questions.findIndex(x => x.id === id)
        if (idx !== -1) Object.assign(this.activeQuiz.questions[idx], q)
      }
      return q
    },
    async deleteQuestion(id) {
      const api = useAdminApi()
      await api.del(`/api/questions/${id}`)
      if (this.activeQuiz) {
        this.activeQuiz.questions = this.activeQuiz.questions.filter(q => q.id !== id)
      }
    },
    async createOption(questionId, data) {
      const api = useAdminApi()
      const opt = await api.post(`/api/questions/${questionId}/options`, data)
      if (this.activeQuiz) {
        const q = this.activeQuiz.questions.find(q => q.id === questionId)
        if (q) q.options = [...(q.options || []), opt]
      }
      return opt
    },
    async updateOption(id, questionId, data) {
      const api = useAdminApi()
      const opt = await api.put(`/api/options/${id}`, data)
      if (this.activeQuiz) {
        const q = this.activeQuiz.questions.find(q => q.id === questionId)
        if (q) {
          const idx = q.options.findIndex(o => o.id === id)
          if (idx !== -1) Object.assign(q.options[idx], opt)
        }
      }
      return opt
    },
    async deleteOption(id, questionId) {
      const api = useAdminApi()
      await api.del(`/api/options/${id}`)
      if (this.activeQuiz) {
        const q = this.activeQuiz.questions.find(q => q.id === questionId)
        if (q) q.options = q.options.filter(o => o.id !== id)
      }
    }
  }
})

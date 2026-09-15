import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const post = vi.hoisted(() => vi.fn())
const put = vi.hoisted(() => vi.fn())
const get = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
// Mutable route params so individual tests can simulate either the "new
// quiz" route (no :id) or an existing-quiz edit route (:id set) without
// re-declaring the vue-router mock per test.
const routeParams = vi.hoisted(() => ({}))

vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ post, put, get, del: vi.fn() })
}))

vi.mock('vue-router', async (orig) => ({
  ...(await orig()),
  useRoute: () => ({ params: routeParams }),
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() })
}))

import QuizEditorView from '../src/views/admin/QuizEditorView.vue'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(QuizEditorView, { global: { plugins: [pinia] } })
}

async function saveMeta(wrapper) {
  await wrapper.find('.quiz-meta-panel form').trigger('submit')
  await flushPromises()
}

describe('QuizEditorView — create then update', () => {
  beforeEach(() => {
    delete routeParams.id
    post.mockReset()
    put.mockReset()
    get.mockReset()
    replace.mockReset()
  })

  it('creates on first save and redirects to the new quiz', async () => {
    post.mockResolvedValue({ quizId: 'q1' })

    const wrapper = mountView()
    await wrapper.find('#quiz-title').setValue('My Quiz')
    await saveMeta(wrapper)

    expect(post).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/admin/quizzes/q1')
  })

  it('updates (not creates a duplicate) when saving again after creation', async () => {
    post.mockResolvedValue({ quizId: 'q1' })
    put.mockResolvedValue({ id: 'q1', title: 'My Quiz edited', description: '' })

    const wrapper = mountView()
    await wrapper.find('#quiz-title').setValue('My Quiz')
    await saveMeta(wrapper) // create

    await wrapper.find('#quiz-title').setValue('My Quiz edited')
    await saveMeta(wrapper) // must update, not create again

    expect(post).toHaveBeenCalledTimes(1) // a stale isNew would make this 2
    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('/api/quizzes/q1', expect.objectContaining({ title: 'My Quiz edited' }))
  })
})

describe('QuizEditorView — total_time_seconds (edited in minutes)', () => {
  beforeEach(() => {
    delete routeParams.id
    post.mockReset()
    put.mockReset()
    get.mockReset()
    replace.mockReset()
  })

  it('loads total_time_seconds from the fetched quiz as whole minutes on edit', async () => {
    routeParams.id = 'q1'
    get.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: 900, questions: [] })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('#quiz-total-time').element.value).toBe('15')
  })

  // A value set before this field existed (or via the API directly) need not
  // be an exact multiple of 60 — the field still shows a whole-minute number
  // rather than a fraction.
  it('rounds a total_time_seconds that is not an exact multiple of 60', async () => {
    routeParams.id = 'q1'
    get.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: 100, questions: [] })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('#quiz-total-time').element.value).toBe('2')
  })

  it('falls back to an empty field when the fetched quiz has no total_time_seconds', async () => {
    routeParams.id = 'q1'
    get.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: null, questions: [] })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('#quiz-total-time').element.value).toBe('')
  })

  // v-model.number on an EMPTIED number input yields '', which fails the
  // server's Number.isInteger check (400) if sent as-is — saveQuiz must
  // normalize it to null so "blank" means "no timer", not an error.
  it('normalizes an empty field to a null total_time_seconds on save', async () => {
    routeParams.id = 'q1'
    get.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: 900, questions: [] })
    put.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: null })

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('#quiz-total-time').setValue('')
    await saveMeta(wrapper)

    expect(put).toHaveBeenCalledWith('/api/quizzes/q1', expect.objectContaining({ total_time_seconds: null }))
    expect(put.mock.calls[0][1].total_time_minutes).toBeUndefined()
  })

  it('sends a filled field as minutes*60 seconds on save', async () => {
    routeParams.id = 'q1'
    get.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: null, questions: [] })
    put.mockResolvedValue({ id: 'q1', title: 'Existing', description: '', total_time_seconds: 600 })

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('#quiz-total-time').setValue('10')
    await saveMeta(wrapper)

    const payload = put.mock.calls[0][1]
    expect(payload.total_time_seconds).toBe(600)
    expect(typeof payload.total_time_seconds).toBe('number')
  })

  it('sends null on a brand-new quiz when the field is left blank', async () => {
    post.mockResolvedValue({ quizId: 'q1' })

    const wrapper = mountView()
    await wrapper.find('#quiz-title').setValue('New Quiz')
    await saveMeta(wrapper)

    expect(post).toHaveBeenCalledWith('/api/quizzes', expect.objectContaining({ total_time_seconds: null }))
  })
})

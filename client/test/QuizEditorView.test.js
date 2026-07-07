import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const post = vi.hoisted(() => vi.fn())
const put = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())

vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ post, put, get: vi.fn(), del: vi.fn() })
}))

// New-quiz route (no :id). Keep real createRouter for other imports.
vi.mock('vue-router', async (orig) => ({
  ...(await orig()),
  useRoute: () => ({ params: {} }),
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
    post.mockReset()
    put.mockReset()
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

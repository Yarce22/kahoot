import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const post = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ post, get: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

import { useAssignmentsStore } from '../src/stores/assignments.js'

describe('assignments store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    post.mockReset()
  })

  it('createAssignments posts quiz_id and user_ids', async () => {
    post.mockResolvedValue({ created: [], skipped: [] })
    const store = useAssignmentsStore()
    await store.createAssignments({ quiz_id: 'q1', user_ids: ['u1', 'u2'] })
    expect(post).toHaveBeenCalledWith('/api/assignments', { quiz_id: 'q1', user_ids: ['u1', 'u2'] })
  })

  it('returns the { created, skipped } response verbatim', async () => {
    const response = {
      created: [{ id: 'a1', userId: 'u1' }],
      skipped: [{ userId: 'u2', reason: 'already_assigned' }]
    }
    post.mockResolvedValue(response)
    const store = useAssignmentsStore()
    const res = await store.createAssignments({ quiz_id: 'q1', user_ids: ['u1', 'u2'] })
    expect(res).toBe(response)
  })
})

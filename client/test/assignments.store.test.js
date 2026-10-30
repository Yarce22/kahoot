import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const post = vi.hoisted(() => vi.fn())
const get = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ post, get, put: vi.fn(), patch: vi.fn(), del: vi.fn() })
}))

import { useAssignmentsStore } from '../src/stores/assignments.js'

describe('assignments store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    post.mockReset()
    get.mockReset()
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

  it('reactivateAssignments posts only the given user_ids', async () => {
    post.mockResolvedValue({ reactivated: 1, cycle: 2 })
    const store = useAssignmentsStore()
    await store.reactivateAssignments({ quiz_id: 'q1', user_ids: ['u1'] })
    expect(post).toHaveBeenCalledWith('/api/assignments/reactivate', { quiz_id: 'q1', user_ids: ['u1'] })
  })

  it('fetchQuizAssignments follows pages until total is reached', async () => {
    const a = (n) => ({ id: 'a' + n, user: { id: 'u' + n } })
    get
      .mockResolvedValueOnce({ assignments: [a(1), a(2)], page: 1, page_size: 2, total: 3 })
      .mockResolvedValueOnce({ assignments: [a(3)], page: 2, page_size: 2, total: 3 })
    const store = useAssignmentsStore()
    const res = await store.fetchQuizAssignments('q1')
    expect(get).toHaveBeenNthCalledWith(1, '/api/assignments?quiz_id=q1&page=1&page_size=100')
    expect(get).toHaveBeenNthCalledWith(2, '/api/assignments?quiz_id=q1&page=2&page_size=100')
    expect(res.map((x) => x.id)).toEqual(['a1', 'a2', 'a3'])
  })
})

describe('assignments store — fetchProgress', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    get.mockReset()
  })

  it('GETs /api/dashboard/progress and returns the response', async () => {
    get.mockResolvedValue({ users: [] })
    const res = await useAssignmentsStore().fetchProgress()
    expect(get).toHaveBeenCalledWith('/api/dashboard/progress')
    expect(res).toEqual({ users: [] })
  })

  it('passes punto_de_venta when filtering', async () => {
    get.mockResolvedValue({ users: [] })
    await useAssignmentsStore().fetchProgress({ punto_de_venta: 'Cerritos' })
    expect(get).toHaveBeenCalledWith('/api/dashboard/progress?punto_de_venta=Cerritos')
  })
})

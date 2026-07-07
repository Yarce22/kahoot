import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock the router singleton so the 401 redirect is observable without
// pulling in the real vue-router history. vi.hoisted keeps `push` available
// inside the hoisted vi.mock factory.
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('../src/router/index.js', () => ({ default: { push } }))

import { useAdminApi } from '../src/composables/useAdminApi.js'
import { useAuthStore } from '../src/stores/auth.js'

describe('useAdminApi', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    push.mockClear()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('attaches a Bearer Authorization header when a token is present', async () => {
    useAuthStore().login('jwt-xyz', { id: 'a1', email: 'a@x.com' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    await useAdminApi().get('/api/quizzes')

    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer jwt-xyz')
  })

  it('omits the Authorization header when logged out', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await useAdminApi().get('/api/quizzes')

    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('on 401 logs out, redirects to /admin/login, and throws', async () => {
    const auth = useAuthStore()
    auth.login('jwt-xyz', { id: 'a1', email: 'a@x.com' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))

    await expect(useAdminApi().get('/api/quizzes')).rejects.toThrow()
    expect(auth.isLoggedIn).toBe(false)
    expect(push).toHaveBeenCalledWith('/admin/login')
  })

  it('surfaces the server error message on a non-401 failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'No sos el dueño de este quiz' }) }))

    await expect(useAdminApi().get('/api/quizzes/1')).rejects.toThrow('No sos el dueño de este quiz')
    expect(push).not.toHaveBeenCalled()
  })

  it('returns null on 204 No Content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) }))
    expect(await useAdminApi().del('/api/quizzes/1')).toBeNull()
  })
})

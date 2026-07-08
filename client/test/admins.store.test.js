import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useAdminApi.js', () => ({
  useAdminApi: () => ({ get, post, patch, put: vi.fn(), del: vi.fn() })
}))

import { useAdminsStore } from '../src/stores/admins.js'

describe('admins store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    get.mockReset()
    post.mockReset()
    patch.mockReset()
  })

  it('fetchAdmins loads the list', async () => {
    get.mockResolvedValue([{ id: 'a1', email: 'a@x.com', role: 'admin', is_active: true }])
    const store = useAdminsStore()
    await store.fetchAdmins()
    expect(get).toHaveBeenCalledWith('/api/admins')
    expect(store.admins).toHaveLength(1)
  })

  it('createAdmin posts and appends the new admin', async () => {
    post.mockResolvedValue({ id: 'new', email: 'n@x.com', role: 'superadmin', is_active: true })
    const store = useAdminsStore()
    await store.createAdmin({ email: 'n@x.com', password: 'pw', role: 'superadmin' })
    expect(post).toHaveBeenCalledWith('/api/admins', { email: 'n@x.com', password: 'pw', role: 'superadmin' })
    expect(store.admins[0].email).toBe('n@x.com')
  })

  it('updateAdmin patches and merges the server response into the row', async () => {
    const store = useAdminsStore()
    store.admins = [{ id: 'a1', email: 'a@x.com', role: 'admin', is_active: true }]
    patch.mockResolvedValue({ id: 'a1', email: 'a@x.com', role: 'superadmin', is_active: true })
    await store.updateAdmin('a1', { role: 'superadmin' })
    expect(patch).toHaveBeenCalledWith('/api/admins/a1', { role: 'superadmin' })
    expect(store.admins[0].role).toBe('superadmin')
  })

  it('surfaces fetch errors into store.error', async () => {
    get.mockRejectedValue(new Error('boom'))
    const store = useAdminsStore()
    await store.fetchAdmins()
    expect(store.error).toBe('boom')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router from '../src/router/index.js'
import { useAuthStore } from '../src/stores/auth.js'

describe('admin route guard', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('redirects protected admin routes to /admin/login when logged out', async () => {
    await router.push('/admin/quizzes')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/login')
  })

  it('allows protected admin routes when logged in', async () => {
    useAuthStore().login('jwt', { id: 'a1', email: 'a@x.com' })
    await router.push('/admin/quizzes')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/quizzes')
  })
})

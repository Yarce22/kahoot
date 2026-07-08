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

  it('guards the session history route when logged out', async () => {
    await router.push('/admin/quizzes/quiz-1/sessions')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/login')
  })

  it('allows the session history route when logged in', async () => {
    useAuthStore().login('jwt', { id: 'a1', email: 'a@x.com' })
    await router.push('/admin/quizzes/quiz-1/sessions')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/quizzes/quiz-1/sessions')
  })

  it('redirects the admins route to login when logged out', async () => {
    await router.push('/admin/admins')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/login')
  })

  it('bounces a plain admin off the admins route to their quiz list', async () => {
    useAuthStore().login('jwt', { id: 'a1', email: 'a@x.com', role: 'admin' })
    await router.push('/admin/admins')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/quizzes')
  })

  it('allows a superadmin onto the admins route', async () => {
    useAuthStore().login('jwt', { id: 's1', email: 'boss@x.com', role: 'superadmin' })
    await router.push('/admin/admins')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/admin/admins')
  })
})

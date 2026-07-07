import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth.js'

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts logged out with empty state', () => {
    const auth = useAuthStore()
    expect(auth.token).toBe('')
    expect(auth.admin).toBeNull()
    expect(auth.isLoggedIn).toBe(false)
  })

  it('login stores token + admin in state and localStorage', () => {
    const auth = useAuthStore()
    const admin = { id: 'a1', email: 'admin@x.com' }
    auth.login('jwt-123', admin)
    expect(auth.token).toBe('jwt-123')
    expect(auth.admin).toEqual(admin)
    expect(auth.isLoggedIn).toBe(true)
    expect(localStorage.getItem('authToken')).toBe('jwt-123')
    expect(JSON.parse(localStorage.getItem('authAdmin'))).toEqual(admin)
  })

  it('logout clears state and localStorage', () => {
    const auth = useAuthStore()
    auth.login('jwt-123', { id: 'a1', email: 'admin@x.com' })
    auth.logout()
    expect(auth.token).toBe('')
    expect(auth.admin).toBeNull()
    expect(auth.isLoggedIn).toBe(false)
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(localStorage.getItem('authAdmin')).toBeNull()
  })

  it('hydrates token + admin from localStorage on init', () => {
    localStorage.setItem('authToken', 'persisted')
    localStorage.setItem('authAdmin', JSON.stringify({ id: 'a2', email: 'b@x.com' }))
    setActivePinia(createPinia())
    const auth = useAuthStore()
    expect(auth.token).toBe('persisted')
    expect(auth.admin).toEqual({ id: 'a2', email: 'b@x.com' })
    expect(auth.isLoggedIn).toBe(true)
  })

  it('tolerates corrupt admin json (admin stays null)', () => {
    localStorage.setItem('authToken', 'persisted')
    localStorage.setItem('authAdmin', '{not-valid-json')
    setActivePinia(createPinia())
    const auth = useAuthStore()
    expect(auth.admin).toBeNull()
    expect(auth.token).toBe('persisted')
  })
})

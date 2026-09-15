import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserAuthStore } from '../src/stores/userAuth.js'

describe('userAuth store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts logged out with empty state', () => {
    const auth = useUserAuthStore()
    expect(auth.token).toBe('')
    expect(auth.user).toBeNull()
    expect(auth.isLoggedIn).toBe(false)
  })

  it('login stores token + user in state and localStorage, under usuario-specific keys', () => {
    const auth = useUserAuthStore()
    const user = { id: 'u1', email: 'u@x.com', fullName: 'Usuario Uno', puntoDeVenta: 'Cerritos' }
    auth.login('jwt-123', user)
    expect(auth.token).toBe('jwt-123')
    expect(auth.user).toEqual(user)
    expect(auth.isLoggedIn).toBe(true)
    // Distinct keys from auth.js's authToken/authAdmin — an admin and a
    // usuario session in the same browser must never collide.
    expect(localStorage.getItem('usuarioToken')).toBe('jwt-123')
    expect(JSON.parse(localStorage.getItem('usuarioIdentity'))).toEqual(user)
    expect(localStorage.getItem('authToken')).toBeNull()
    expect(localStorage.getItem('authAdmin')).toBeNull()
  })

  it('logout clears state and localStorage', () => {
    const auth = useUserAuthStore()
    auth.login('jwt-123', { id: 'u1', email: 'u@x.com', fullName: 'Uno', puntoDeVenta: 'Cerritos' })
    auth.logout()
    expect(auth.token).toBe('')
    expect(auth.user).toBeNull()
    expect(auth.isLoggedIn).toBe(false)
    expect(localStorage.getItem('usuarioToken')).toBeNull()
    expect(localStorage.getItem('usuarioIdentity')).toBeNull()
  })

  it('hydrates token + user from localStorage on init', () => {
    localStorage.setItem('usuarioToken', 'persisted')
    localStorage.setItem('usuarioIdentity', JSON.stringify({ id: 'u2', email: 'b@x.com', fullName: 'B', puntoDeVenta: 'Laureles' }))
    setActivePinia(createPinia())
    const auth = useUserAuthStore()
    expect(auth.token).toBe('persisted')
    expect(auth.user).toEqual({ id: 'u2', email: 'b@x.com', fullName: 'B', puntoDeVenta: 'Laureles' })
    expect(auth.isLoggedIn).toBe(true)
  })

  it('tolerates corrupt user json (user stays null)', () => {
    localStorage.setItem('usuarioToken', 'persisted')
    localStorage.setItem('usuarioIdentity', '{not-valid-json')
    setActivePinia(createPinia())
    const auth = useUserAuthStore()
    expect(auth.user).toBeNull()
    expect(auth.token).toBe('persisted')
  })
})

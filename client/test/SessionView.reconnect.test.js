import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// A controllable fake socket shared between the mock and the assertions.
const socketState = vi.hoisted(() => {
  const handlers = {}
  const socket = {
    connected: false,
    on: (ev, cb) => { (handlers[ev] ||= []).push(cb) },
    off: (ev) => { delete handlers[ev] },
    emit: vi.fn(),
    // test helper — invoke every handler registered for an event
    fire: (ev, ...args) => (handlers[ev] || []).slice().forEach((cb) => cb(...args))
  }
  return { socket, handlers }
})

vi.mock('../src/composables/useSocket.js', () => ({
  useSocket: () => ({
    connect: () => socketState.socket,
    getSocket: () => socketState.socket,
    disconnect: vi.fn()
  })
}))

// Keep vue-router real (SessionView -> useAdminApi -> router/index.js needs
// createRouter) but stub useRoute so the view has a pin.
vi.mock('vue-router', async (orig) => ({
  ...(await orig()),
  useRoute: () => ({ params: { pin: '123456' } })
}))

import SessionView from '../src/views/admin/SessionView.vue'
import { useAuthStore } from '../src/stores/auth.js'

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().login('jwt-host', { id: 'a1', email: 'host@x.com' })
  return mount(SessionView, { global: { plugins: [pinia] } })
}

function joinCalls() {
  return socketState.socket.emit.mock.calls.filter((c) => c[0] === 'host:join-session')
}

describe('SessionView host socket (re)connect', () => {
  beforeEach(() => {
    localStorage.clear()
    socketState.socket.connected = false
    socketState.socket.emit.mockClear()
    for (const k of Object.keys(socketState.handlers)) delete socketState.handlers[k]
  })

  it('does not join until the socket connects', () => {
    mountView()
    expect(joinCalls()).toHaveLength(0)
  })

  it('emits host:join-session on the initial connect', () => {
    mountView()
    socketState.socket.fire('connect')
    expect(joinCalls()).toHaveLength(1)
    expect(joinCalls()[0][1]).toEqual({ pin: '123456' })
  })

  it('re-emits host:join-session on every reconnect', () => {
    mountView()
    socketState.socket.fire('connect') // initial
    socketState.socket.fire('connect') // reconnect #1
    socketState.socket.fire('connect') // reconnect #2
    expect(joinCalls()).toHaveLength(3)
  })

  it('joins immediately when the socket is already connected', () => {
    socketState.socket.connected = true
    mountView()
    expect(joinCalls()).toHaveLength(1)
  })
})

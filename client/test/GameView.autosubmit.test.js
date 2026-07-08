import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const submitAnswer = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/useGame.js', () => ({
  useGame: () => ({ submitAnswer })
}))
vi.mock('vue-router', async (orig) => ({
  ...(await orig()),
  useRoute: () => ({ params: { pin: '123456' } })
}))

import GameView from '../src/views/GameView.vue'
import { useGameStore } from '../src/stores/game.js'

const OPEN_Q = { index: 0, text: 'Q', type: 'open', timeLimitSeconds: 30 }

function setup(question) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useGameStore()
  store.currentQuestion = question
  store.secondsLeft = question.timeLimitSeconds
  store.myAnswer = null
  const wrapper = mount(GameView, { global: { plugins: [pinia] } })
  return { wrapper, store }
}

describe('GameView open-answer auto-submit', () => {
  beforeEach(() => submitAnswer.mockReset())

  it('auto-submits the typed draft when time is almost up', async () => {
    const { wrapper, store } = setup(OPEN_Q)
    await wrapper.find('#open-input').setValue('mi respuesta')

    store.secondsLeft = 1
    await flushPromises()

    expect(submitAnswer).toHaveBeenCalledWith({ questionIndex: 0, answerText: 'mi respuesta' })
    expect(store.myAnswer).toBe('mi respuesta')
  })

  it('auto-submits an empty answer (non-response) when nothing was typed', async () => {
    const { store } = setup(OPEN_Q)

    store.secondsLeft = 1
    await flushPromises()

    expect(submitAnswer).toHaveBeenCalledWith({ questionIndex: 0, answerText: '' })
    expect(store.myAnswer).toBe('(sin respuesta)') // truthy marker locks the UI
  })

  it('does not auto-submit if the player already answered', async () => {
    const { store } = setup(OPEN_Q)
    store.myAnswer = 'already'

    store.secondsLeft = 1
    await flushPromises()

    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('does not auto-submit closed questions', async () => {
    const { store } = setup({
      index: 0, text: 'Q', type: 'closed', timeLimitSeconds: 30,
      options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]
    })

    store.secondsLeft = 1
    await flushPromises()

    expect(submitAnswer).not.toHaveBeenCalled()
  })
})

import { io } from 'socket.io-client'
import { onUnmounted } from 'vue'

let socket = null

export function useSocket() {
  function connect(auth = {}) {
    if (!socket || !socket.connected) {
      socket = io(import.meta.env.VITE_API_BASE_URL || undefined, {
        auth,
        autoConnect: true,
        transports: ['websocket', 'polling']
      })
    }
    return socket
  }

  function disconnect() {
    socket?.disconnect()
    socket = null
  }

  function getSocket() {
    return socket
  }

  onUnmounted(() => {
    // Don't disconnect on every unmount — game socket is shared across views
    // Disconnect only on LeaderboardView (explicit call)
  })

  return { connect, disconnect, getSocket }
}

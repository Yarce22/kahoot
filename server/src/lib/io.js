import { Server } from 'socket.io'

/** @type {import('socket.io').Server|null} */
let _io = null

/**
 * Initialize the Socket.io server. Call once in index.js.
 * @param {import('http').Server} httpServer
 * @param {import('socket.io').ServerOptions} options
 * @returns {import('socket.io').Server}
 */
export function initIO(httpServer, options) {
  _io = new Server(httpServer, options)
  return _io
}

/**
 * Get the initialized Socket.io instance.
 * Throws if called before initIO.
 * @returns {import('socket.io').Server}
 */
export function getIO() {
  if (!_io) throw new Error('Socket.io not initialized — call initIO first')
  return _io
}

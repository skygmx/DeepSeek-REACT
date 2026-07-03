function getUpgradePath(request) {
  const baseUrl = `http://${request.headers.host ?? 'localhost'}`
  return new URL(request.url ?? '/', baseUrl).pathname
}

export function createWebSocketUpgradeHandler(routes) {
  return function handleWebSocketUpgrade(request, socket, head) {
    const socketServer = routes.get(getUpgradePath(request))

    if (!socketServer) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    socketServer.handleUpgrade(request, socket, head, (ws) => {
      socketServer.emit('connection', ws, request)
    })
  }
}

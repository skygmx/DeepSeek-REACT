export function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

export function parseClientMessage(data) {
  if (typeof data !== 'string') return null

  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}


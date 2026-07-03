export function resolveApiBaseUrl(value?: string) {
  return value?.trim() || '/api'
}

export function resolveWebSocketUrl(value: string | undefined, path: string) {
  const configured = value?.trim() || path
  if (!configured.startsWith('/')) return configured

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${configured}`
}

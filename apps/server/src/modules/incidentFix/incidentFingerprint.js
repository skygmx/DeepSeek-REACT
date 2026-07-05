import { createHash } from 'node:crypto'

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function createIncidentFingerprint(error) {
  if (error?.fingerprint) return String(error.fingerprint)
  if (error?.id) return String(error.id)

  const message = normalizeText(error?.message)
  const stack = normalizeText(error?.stackTrace ?? error?.stack)
  const service = normalizeText(error?.service)
  const env = normalizeText(error?.environment)

  return createHash('sha256')
    .update([service, env, message, stack.slice(0, 500)].join('|'))
    .digest('hex')
}

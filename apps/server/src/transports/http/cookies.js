export function parseCookies(cookieHeader) {
  if (!cookieHeader) return {}

  return cookieHeader.split(';').reduce((cookies, entry) => {
    const [rawName, ...rawValueParts] = entry.trim().split('=')
    if (!rawName || !rawValueParts.length) return cookies

    cookies[rawName] = decodeURIComponent(rawValueParts.join('='))
    return cookies
  }, {})
}

export function createCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options.secure) parts.push('Secure')

  return parts.join('; ')
}


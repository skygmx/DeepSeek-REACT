import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function resolveStaticPath(distDir, url) {
  const requestPath = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  const filePath = requestPath === '/' ? '/index.html' : requestPath
  const normalized = normalize(join(distDir, filePath))

  if (!normalized.startsWith(distDir)) return null
  if (existsSync(normalized)) return normalized

  return join(distDir, 'index.html')
}

export function createStaticHandler(distDir) {
  return async function handleHttpRequest(req, res) {
    if (!existsSync(distDir)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('WebSocket server is running. Run npm run build to serve the React app.')
      return
    }

    const filePath = resolveStaticPath(distDir, req.url ?? '/')
    if (!filePath) {
      res.writeHead(403)
      res.end()
      return
    }

    try {
      const fileInfo = await stat(filePath)
      if (!fileInfo.isFile()) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      res.writeHead(200, {
        'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      })
      createReadStream(filePath).pipe(res)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  }
}


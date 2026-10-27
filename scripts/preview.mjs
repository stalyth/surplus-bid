import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = resolve(repoRoot, 'dist')
const host = '127.0.0.1'
const port = parsePort(process.env.PORT ?? '4174')
const mimeTypes = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.v1', 'application/wasm'],
])

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`)
  const file = resolveFile(url.pathname)
  if (!file) {
    respond(response, 404, 'Not found')
    return
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file')
  } catch {
    respond(response, 404, 'Not found')
    return
  }
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypes.get(extname(file)) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(file).pipe(response)
})

server.listen(port, host, () => console.log(`SurplusBid public preview: http://${host}:${port}`))

function resolveFile(pathname) {
  let path = pathname
  if (path === '/') path = '/index.html'
  if (path === '/run' || path === '/run/') path = '/run/index.html'
  let decoded
  try { decoded = decodeURIComponent(path) } catch { return null }
  const resolved = resolve(distRoot, `.${decoded}`)
  return resolved === distRoot || !resolved.startsWith(`${distRoot}${sep}`) ? null : resolved
}

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

function parsePort(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('PORT 必须是 1 到 65535 的整数。')
  return parsed
}

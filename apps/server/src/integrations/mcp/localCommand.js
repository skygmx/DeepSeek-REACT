import { spawn } from 'node:child_process'

const WINDOWS_SCRIPT_COMMANDS = new Set(['npm', 'npx', 'pnpm'])

function resolveCommand(command) {
  if (process.platform !== 'win32') return command
  return WINDOWS_SCRIPT_COMMANDS.has(command) ? `${command}.cmd` : command
}

function appendOutput(current, chunk, maxCharacters) {
  if (current.length >= maxCharacters) return current

  const next = current + chunk.toString('utf8')
  return next.length > maxCharacters ? next.slice(0, maxCharacters) : next
}

function formatCommand(command, args) {
  return [command, ...args].join(' ')
}

export function truncateText(text, maxCharacters) {
  if (typeof text !== 'string' || text.length <= maxCharacters) return text
  return `${text.slice(0, maxCharacters)}\n...[truncated]`
}

export function runCommand(options) {
  const {
    allowedExitCodes = [0],
    args = [],
    command,
    cwd,
    input,
    maxOutputCharacters = 20_000,
    timeoutMs = 30_000,
  } = options

  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const settle = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk, maxOutputCharacters)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk, maxOutputCharacters)
    })
    child.on('error', (error) => {
      settle(reject, error)
    })
    child.on('close', (exitCode) => {
      const output = { exitCode, stderr, stdout }

      if (!timedOut && allowedExitCodes.includes(exitCode)) {
        settle(resolve, output)
        return
      }

      const error = new Error(
        timedOut
          ? `命令执行超时：${formatCommand(command, args)}`
          : `命令执行失败：${formatCommand(command, args)}`,
      )
      error.exitCode = exitCode
      error.stderr = stderr
      error.stdout = stdout
      settle(reject, error)
    })

    if (typeof input === 'string') {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

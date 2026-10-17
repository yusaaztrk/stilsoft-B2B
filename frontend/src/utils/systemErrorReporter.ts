import { API_BASE_URL } from '../config/api'

type ClientLogPayload = {
  level: string
  message: string
  stack?: string
  source?: string
  url: string
  userAgent: string
}

let installed = false
let sending = false
const recent = new Map<string, number>()

function serializeArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function getStack(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (arg instanceof Error && arg.stack) return arg.stack
  }
  return undefined
}

function shouldSend(payload: ClientLogPayload) {
  const key = `${payload.level}|${payload.message}|${payload.source ?? ''}`.slice(0, 500)
  const now = Date.now()
  const last = recent.get(key) ?? 0
  if (now - last < 3000) return false
  recent.set(key, now)
  return true
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = localStorage.getItem('accessToken') || localStorage.getItem('token') || localStorage.getItem('jwtToken') || localStorage.getItem('authToken')
  const tenantCode = localStorage.getItem('tenantCode')
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantCode) headers['X-Tenant-Code'] = tenantCode
  return headers
}

function sendClientLog(payload: ClientLogPayload) {
  if (sending) return
  if (!shouldSend(payload)) return

  sending = true
  window
    .fetch(`${API_BASE_URL}/api/system-error-logs/client`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
      keepalive: true,
    })
    .catch(() => {
      // Error reporting must never create another visible error.
    })
    .finally(() => {
      sending = false
    })
}

export function installSystemErrorReporter() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalConsoleError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args)
    sendClientLog({
      level: 'ConsoleError',
      message: args.map(serializeArg).join(' '),
      stack: getStack(args),
      source: 'console.error',
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
  }

  window.addEventListener('error', (event) => {
    sendClientLog({
      level: 'RuntimeError',
      message: event.message || 'Runtime error',
      stack: event.error?.stack,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'window.error',
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    sendClientLog({
      level: 'UnhandledPromiseRejection',
      message: serializeArg(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      source: 'unhandledrejection',
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
  })
}

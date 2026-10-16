import { AsyncLocalStorage } from 'node:async_hooks'

type Level = 'info' | 'warn' | 'error'
type LogContext = {
  component?: 'http' | 'graphql' | 'database' | 'payments' | 'email' | 'server'
  requestId?: string
  route?: string
  method?: string
  statusCode?: number
  durationMs?: number
  operationName?: string
  errorCode?: string
  orderId?: number
  operationKind?: 'CREATE_SESSION' | 'REFUND'
  notificationId?: string
  emailQueue?: 'AUTH' | 'ORDER'
  emailStatus?: string
  pendingAgeMs?: number
  heartbeatAgeMs?: number
  sendAttempts?: number
}
const requests = new AsyncLocalStorage<{ requestId: string }>()
export function withRequestContext<T>(requestId: string, action: () => T): T {
  return requests.run({ requestId }, action)
}

// Only application-owned categories and bounded context are serialized. In
// particular, exception objects/messages, payloads and headers are never accepted.
const stringRules: Record<string, RegExp> = {
  notificationId: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  emailQueue: /^(AUTH|ORDER)$/,
  emailStatus: /^(PENDING|ENQUEUED|SENDING|SUBMITTED|EXPIRED|SKIPPED|FAILED|UNCERTAIN)$/,
  requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  component: /^(http|graphql|database|payments|email|server)$/,
  route:
    /^(\/health|\/ready|\/graphql|\/api\/auth\/\*|\/api\/payments\/stripe\/webhook|unmatched)$/,
  method: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/,
  operationName: /^[_A-Za-z][_0-9A-Za-z]{0,79}$/,
  errorCode: /^[A-Z][A-Z_]{0,79}$/,
  operationKind: /^(CREATE_SESSION|REFUND)$/,
}
export function log(level: Level, event: string, context: LogContext = {}) {
  try {
    const environment = ['development', 'test', 'production'].includes(process.env.NODE_ENV ?? '')
      ? process.env.NODE_ENV
      : 'development'
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event,
      environment,
    }
    const fields = { ...requests.getStore(), ...context }
    for (const [key, rule] of Object.entries(stringRules)) {
      const value = fields[key as keyof typeof fields]
      if (typeof value === 'string' && rule.test(value)) record[key] = value
    }
    for (const key of [
      'statusCode',
      'durationMs',
      'orderId',
      'pendingAgeMs',
      'heartbeatAgeMs',
      'sendAttempts',
    ] as const) {
      const value = fields[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) record[key] = value
    }
    const line = JSON.stringify(record)
    if (level === 'info') console.log(line)
    else if (level === 'warn') console.warn(line)
    else console.error(line)
  } catch {
    // A failed logging sink must never change a request or durable operation.
  }
}

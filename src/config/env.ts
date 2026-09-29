export type AppConfig = {
  port: number
  databasePath: string
  frontendOrigin: string
  nodeEnv: 'development' | 'test' | 'production'
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const port = Number(env.PORT ?? 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535')
  }

  const databasePath = env.DATABASE_PATH ?? './data/book-store.sqlite'
  if (!databasePath.trim()) throw new Error('DATABASE_PATH must not be empty')

  const frontendOrigin = env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
  try {
    const parsed = new URL(frontendOrigin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== frontendOrigin) {
      throw new Error('Invalid origin')
    }
  } catch {
    throw new Error('FRONTEND_ORIGIN must be an HTTP origin such as http://localhost:5173')
  }

  const nodeEnv = env.NODE_ENV ?? 'development'
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production')
  }

  return { port, databasePath, frontendOrigin, nodeEnv }
}

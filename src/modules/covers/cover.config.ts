import { resolve } from 'node:path'
export function loadCoverConfig(env = process.env) {
  if ((env.COVER_STORAGE_DRIVER ?? 'local') !== 'local')
    throw new Error('COVER_STORAGE_DRIVER currently supports local only')
  const publicBaseUrl =
    env.COVER_PUBLIC_BASE_URL ??
    (env.NODE_ENV !== 'production' ? `http://localhost:${env.PORT ?? 4000}/media/` : '')
  const url = new URL(publicBaseUrl)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (env.NODE_ENV === 'production' && url.protocol !== 'https:')
  )
    throw new Error('COVER_PUBLIC_BASE_URL must be a public media base (HTTPS in production)')
  return { directory: resolve(env.COVER_UPLOAD_DIR ?? './data/uploads'), publicBaseUrl }
}

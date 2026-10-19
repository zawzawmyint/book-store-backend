import { access, mkdir, rename, unlink, writeFile, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { coverKeyPattern, type CoverStorage } from './cover.storage.js'

export async function createLocalCoverStorage(
  directory: string,
  publicBaseUrl: string,
): Promise<CoverStorage & { mediaDirectory: string }> {
  const root = resolve(directory)
  const base = new URL(publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('COVER_PUBLIC_BASE_URL must be a public HTTP(S) media base')
  const mediaDirectory = join(root, 'covers'),
    tempDirectory = join(root, '.tmp')
  await mkdir(mediaDirectory, { recursive: true })
  await mkdir(tempDirectory, { recursive: true })
  // Managed directories must not redirect writes through symlinks.
  for (const path of [root, mediaDirectory, tempDirectory]) {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error('Cover directories must not be symbolic links')
    await access(path, constants.W_OK)
  }
  function pathFor(key: string) {
    if (!coverKeyPattern.test(key)) throw new Error('Invalid managed cover key')
    return join(mediaDirectory, key.slice('covers/'.length))
  }
  return {
    mediaDirectory,
    async put(key, bytes) {
      const target = pathFor(key),
        temporary = join(tempDirectory, randomUUID())
      try {
        await writeFile(temporary, bytes, { flag: 'wx' })
        await rename(temporary, target)
      } catch (error) {
        await unlink(temporary).catch(() => {})
        throw error
      }
    },
    async remove(key) {
      await unlink(pathFor(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    },
    publicUrl(key) {
      pathFor(key)
      return new URL(key, base).href
    },
  }
}

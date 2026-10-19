import { readdir, lstat, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { coverKeyPattern } from './cover.storage.js'
export async function cleanupCovers(
  directory: string,
  referenced: Set<string>,
  apply = false,
  now = Date.now(),
) {
  const root = resolve(directory, 'covers'),
    selected: string[] = []
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('Invalid managed cover directory')
  for (const file of await readdir(root, { withFileTypes: true })) {
    const key = `covers/${file.name}`
    if (!file.isFile() || !coverKeyPattern.test(key) || referenced.has(key)) continue
    const path = join(root, file.name),
      info = await lstat(path)
    if (!info.isFile() || now - info.mtimeMs < 24 * 3600_000) continue
    selected.push(key)
    if (apply) await unlink(path)
  }
  return selected.sort()
}

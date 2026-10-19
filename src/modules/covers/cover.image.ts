import sharp from 'sharp'
import { CoverError, unavailable } from './cover.storage.js'
export const maxCoverBytes = 5 * 1024 * 1024
const formats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}
function isAnimatedPng(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Sharp's PNG loader exposes the first frame of APNG without page metadata.
  // Walk actual chunk boundaries; compressed pixels may contain the same text.
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset)
    if (length > data.length - offset - 12) throw new Error('Truncated PNG chunk')
    const type = data.toString('ascii', offset + 4, offset + 8)
    if (type === 'acTL') return true
    if (type === 'IEND') break
    offset += length + 12
  }
  return false
}
let decoding = 0
export async function normalizeCover(bytes: Uint8Array, contentType: string) {
  if (!formats[contentType])
    throw new CoverError(415, 'UNSUPPORTED_COVER_TYPE', 'Choose a JPEG, PNG or WebP image.')
  if (bytes.byteLength > maxCoverBytes)
    throw new CoverError(413, 'COVER_TOO_LARGE', 'Choose an image no larger than 5 MiB.')
  if (decoding >= 2) throw unavailable()
  decoding++
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' })
    const metadata = await image.metadata()
    if (
      !bytes.byteLength ||
      metadata.format !== formats[contentType] ||
      (metadata.format === 'png' && isAnimatedPng(bytes)) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 10_000 ||
      metadata.height > 10_000
    )
      throw new Error('Invalid cover')
    const { data, info } = await image
      .autoOrient()
      .resize({ width: 800, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true })
    return { bytes: data, width: info.width, height: info.height }
  } catch {
    throw new CoverError(
      422,
      'INVALID_COVER_IMAGE',
      'Choose a valid, still JPEG, PNG or WebP image within the dimension limits.',
    )
  } finally {
    decoding--
  }
}

export interface CoverStorage {
  put(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
  publicUrl(key: string): string
}
export const coverKeyPattern =
  /^covers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/
export type CoverMetadata = { key: string; width: number; height: number }
export class CoverError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export const unavailable = () =>
  new CoverError(503, 'COVER_UNAVAILABLE', 'Cover storage is unavailable. Please try again.')
export function coverView(
  row: { coverKey?: string | null; coverWidth?: number | null; coverHeight?: number | null },
  storage?: CoverStorage,
) {
  return row.coverKey && row.coverWidth && row.coverHeight && storage
    ? { url: storage.publicUrl(row.coverKey), width: row.coverWidth, height: row.coverHeight }
    : null
}

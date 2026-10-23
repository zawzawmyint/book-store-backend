import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { normalizeCover } from '../src/modules/covers/cover.image.js'
import { createDatabase } from '../src/database/connection.js'
import { seedBooks } from '../src/database/seed.js'
import { createCoverRepository } from '../src/modules/covers/cover.repository.js'
import { createCoverService } from '../src/modules/covers/cover.service.js'

afterEach(() => vi.restoreAllMocks())

async function image(format: 'png' | 'jpeg' | 'webp' = 'png') {
  return sharp({ create: { width: 120, height: 180, channels: 3, background: '#abc' } })
    [format]()
    .toBuffer()
}

it.each([
  ['allocation', new Error('Input buffer has corrupt header: std::bad_alloc')],
  ['resource code', Object.assign(new Error('decoder resource unavailable'), { code: 'ENOMEM' })],
  [
    'resource code within a corrupt-header wrapper',
    Object.assign(new Error('Input buffer has corrupt header:'), { code: 'ENOMEM' }),
  ],
  [
    'mixed input and allocation diagnostics',
    new Error(
      'Input buffer has corrupt header: VipsJpeg: premature end of JPEG image\nstd::bad_alloc',
    ),
  ],
  ['unknown internal', new Error('unexpected internal /private/decoder/path')],
  ['bare corrupt-header wrapper', new Error('Input buffer has corrupt header:')],
])(
  'returns safe unavailable for %s failures and releases decode admission',
  async (_label, error) => {
    const bytes = await image()
    const metadata = vi.spyOn(sharp.prototype, 'metadata')
    for (let attempt = 0; attempt < 3; attempt++) {
      metadata.mockRejectedValueOnce(error)
      const result = await normalizeCover(bytes, 'image/png').catch((failure: unknown) => failure)
      expect(result).toMatchObject({ status: 503, code: 'COVER_UNAVAILABLE' })
      expect((result as Error).message).not.toContain(error.message)
    }
    metadata.mockRestore()
    const recovered = await Promise.all([
      normalizeCover(bytes, 'image/png'),
      normalizeCover(bytes, 'image/png'),
    ])
    expect(recovered.map((result) => result.width)).toEqual([120, 120])
  },
)

it('returns unavailable for output failures after successful metadata validation', async () => {
  const bytes = await image()
  vi.spyOn(sharp.prototype, 'toBuffer').mockRejectedValueOnce(new Error('webpsave: out of memory'))
  await expect(normalizeCover(bytes, 'image/png')).rejects.toMatchObject({
    status: 503,
    code: 'COVER_UNAVAILABLE',
  })
})

it.each(['png', 'jpeg', 'webp'] as const)('keeps malformed %s input at 422', async (format) => {
  const bytes = await image(format)
  for (const length of [25, Math.floor(bytes.length / 2)]) {
    await expect(
      normalizeCover(bytes.subarray(0, length), `image/${format}`),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_COVER_IMAGE',
    })
  }
})

it('keeps the intentional decoder pixel limit at 422', async () => {
  const bytes = await sharp({
    create: { width: 5000, height: 4001, channels: 3, background: '#abc' },
  })
    .png()
    .toBuffer()
  await expect(normalizeCover(bytes, 'image/png')).rejects.toMatchObject({
    status: 422,
    code: 'INVALID_COVER_IMAGE',
  })
})

it('preserves an existing cover, revision, objects and activity when normalization is unavailable', async () => {
  const db = createDatabase(':memory:')
  try {
    seedBooks(db)
    db.exec(
      "INSERT INTO user(id,name,email,email_verified) VALUES('staff','Staff','staff@local.test',1); INSERT INTO user_roles(user_id,role) VALUES('staff','STAFF')",
    )
    const objects = new Map<string, Uint8Array>()
    const service = createCoverService(createCoverRepository(db), {
      put: async (key, bytes) => {
        objects.set(key, bytes)
      },
      remove: async (key) => {
        objects.delete(key)
      },
      publicUrl: (key) => `https://media.example.test/${key}`,
    })
    const actor = {
      source: 'HTTP' as const,
      userId: 'staff',
      name: 'Staff',
      role: 'STAFF' as const,
    }
    const bytes = await image()
    await service.upload(1, 0, bytes, 'image/png', actor)
    const before = db.prepare('SELECT * FROM books WHERE id = 1').get()
    const activity = db.prepare('SELECT * FROM activity_events').all()
    expect(activity).toHaveLength(1)
    const stored = new Map(objects)
    vi.spyOn(sharp.prototype, 'metadata').mockRejectedValueOnce(new Error('decoder unavailable'))
    await expect(service.upload(1, 1, bytes, 'image/png', actor)).rejects.toMatchObject({
      status: 503,
      code: 'COVER_UNAVAILABLE',
    })
    expect(db.prepare('SELECT * FROM books WHERE id = 1').get()).toEqual(before)
    expect(db.prepare('SELECT * FROM activity_events').all()).toEqual(activity)
    expect(objects).toEqual(stored)
  } finally {
    db.close()
  }
})

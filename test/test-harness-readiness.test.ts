import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { waitForHealth } from '../scripts/wait-for-health.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('allows a measured 18-second cold start within the startup deadline', async () => {
  vi.useFakeTimers()
  const started = performance.now()
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(null, { status: performance.now() - started >= 18_000 ? 200 : 503 }),
  )
  const result = waitForHealth('http://fixture/health', () => false)
  await vi.advanceTimersByTimeAsync(18_000)
  expect(await result).toBe('ready')
})

it('stops polling when the child exits', async () => {
  vi.useFakeTimers()
  let stopped = false
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
  const result = waitForHealth('http://fixture/health', () => stopped)
  await vi.advanceTimersByTimeAsync(250)
  stopped = true
  await vi.advanceTimersByTimeAsync(250)
  expect(await result).toBe('stopped')
})

it('aborts an unresponsive real health endpoint within the startup budget', async () => {
  const server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const started = performance.now()
  try {
    expect(
      await waitForHealth(`http://127.0.0.1:${address.port}/health`, () => false, {
        timeoutMs: 100,
      }),
    ).toBe('timed-out')
    expect(performance.now() - started).toBeLessThan(1000)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 2000)

import { afterEach, expect, it, vi } from 'vitest'
import { createReadinessProbe } from '../src/database/readiness.js'
import type { DatabaseHandle } from '../src/database/runtime.js'
import { Pool } from 'pg'
import { createServer, type Socket } from 'node:net'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('releases a blackholed PostgreSQL socket and can probe a recovered connection', async () => {
  // A minimal real PostgreSQL wire peer accepts startup, then drops query
  // responses. This tests the driver's timeout rather than a mocked timer.
  let blackholed = true
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.once('data', () => {
      socket.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]))
      socket.on('data', () => {
        if (!blackholed)
          socket.write(
            Buffer.concat([
              Buffer.from([67, 0, 0, 0, 13]),
              Buffer.from('SELECT 1\0'),
              Buffer.from([90, 0, 0, 0, 5, 73]),
            ]),
          )
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  const pool = new Pool({
    host: '127.0.0.1',
    port: address.port,
    user: 'fixture',
    database: 'fixture',
    ssl: false,
    connectionTimeoutMillis: 1000,
  })
  const ready = createReadinessProbe({ provider: 'postgresql', pool } as DatabaseHandle)
  try {
    expect(await ready()).toBe(false)
    blackholed = false
    // Allow the driver's read timeout to settle and release the first client.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await ready()).toBe(true)
  } finally {
    for (const socket of sockets) socket.destroy()
    await pool.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 10000)

it('bounds outage responses, shares in-flight work and observes recovery after late rejection', async () => {
  vi.useFakeTimers()
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((line) => lines.push(String(line)))
  vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)))
  let fail: (error: Error) => void = () => {}
  let healthy = false
  const queries: string[] = []
  const database = {
    provider: 'postgresql',
    pool: {
      query(config: { text: string }) {
        queries.push(config.text)
        return healthy
          ? Promise.resolve({ rows: [{ value: 1 }] })
          : new Promise((_, reject) => {
              fail = reject
            })
      },
    },
  } as unknown as DatabaseHandle
  const ready = createReadinessProbe(database)
  const first = ready(),
    second = ready()
  await vi.advanceTimersByTimeAsync(2000)
  expect(await first).toBe(false)
  expect(await second).toBe(false)
  const third = ready()
  await vi.advanceTimersByTimeAsync(2000)
  expect(await third).toBe(false)
  expect(queries).toEqual(['SELECT 1'])
  fail(new Error('postgresql://private-password-secret@host/customer-address'))
  await vi.advanceTimersByTimeAsync(0)
  healthy = true
  expect(await ready()).toBe(true)
  expect(lines.map((line) => JSON.parse(line).event)).toEqual([
    'readiness.unavailable',
    'readiness.recovered',
  ])
  expect(lines.join('')).not.toContain('private-password-secret')
})

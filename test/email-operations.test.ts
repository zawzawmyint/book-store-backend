import { expect, it } from 'vitest'
import { emailWorkerReady, drainEmailWork } from '../src/modules/email/email.worker.js'

it('fails readiness when Redis disconnects, progress stops, or shutdown begins', () => {
  expect(emailWorkerReady(1000, 2000, true, false)).toBe(true)
  expect(emailWorkerReady(1000, 31000, true, false)).toBe(false)
  expect(emailWorkerReady(1000, 2000, false, false)).toBe(false)
  expect(emailWorkerReady(1000, 2000, true, true)).toBe(false)
  expect(emailWorkerReady(1000, 2000, true, false, false)).toBe(false)
})
it('bounds drain time when an SMTP invocation never resolves', async () => {
  const start = Date.now()
  expect(await drainEmailWork([new Promise(() => {})], 10)).toBe(false)
  expect(Date.now() - start).toBeLessThan(500)
  expect(await drainEmailWork([Promise.resolve()], 10)).toBe(true)
})

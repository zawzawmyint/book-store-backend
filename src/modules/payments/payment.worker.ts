import type { PaymentService } from './payment.service.js'
export function startPaymentWorker(service: PaymentService) {
  let stopped = false
  let running: Promise<void> | null = null
  const tick = () => {
    if (stopped || running) return
    running = service
      .recover()
      .catch(() => {})
      .finally(() => {
        running = null
      })
  }
  tick()
  const timer = setInterval(tick, 60000)
  timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await running
  }
}

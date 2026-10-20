/** Test-only wait for a compiled API; application readiness checks remain separate. */
export async function waitForHealth(
  url: string,
  hasStopped: () => boolean,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<'ready' | 'stopped' | 'timed-out'> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (hasStopped()) return 'stopped'
    const remaining = deadline - performance.now()
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(1000, remaining)))),
      })
      // Repeated probes must release their connections, including non-200 bodies.
      await response.body?.cancel()
      if (hasStopped()) return 'stopped'
      if (response.ok) return 'ready'
    } catch {
      // The child may still be loading modules; every request is deadline-bounded.
    }
    const delay = Math.min(250, deadline - performance.now())
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  }
  return hasStopped() ? 'stopped' : 'timed-out'
}

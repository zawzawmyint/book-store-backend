# Compiled application test readiness

**Status:** Implemented

The PostgreSQL parity harness allows a cold compiled API to become healthy for up to 60 seconds, measured with a monotonic deadline. The former 40 polls at 250 ms rejected a measured 18-second cold start before database/browser verification began. Each health request is aborted within one second and within the remaining startup deadline; a child launch error or exit stops polling promptly. A successful startup still requires the existing structured startup log, `/ready` contract, and catalog GraphQL assertions. Failures retain sanitized diagnostics and clean up child processes and temporary storage. No application endpoints, environment contracts, database schemas, or production timeouts change.

Acceptance:

- [x] A child healthy after 18 seconds passes, rather than failing at 10 seconds.
- [x] An exited child is rejected without consuming the full deadline.
- [x] An unresponsive health endpoint cannot exceed the startup budget.
- [x] Full backend checks and disposable PostgreSQL browser parity pass.

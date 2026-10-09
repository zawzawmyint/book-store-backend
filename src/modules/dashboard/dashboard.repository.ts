import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { DashboardRange } from './dashboard.types.js'

export function createDashboardRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  return {
    workspace: () => store.dashboardWorkspace(),
    finance: (range: DashboardRange) => store.dashboardFinance(range),
  }
}

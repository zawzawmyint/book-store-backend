import { validated } from '../../shared/validation.js'
import type { createActivityRepository } from './activity.repository.js'
import { activityInputSchema } from './activity.validation.js'
export function createActivityService(repository: ReturnType<typeof createActivityRepository>) {
  return { list: (input: unknown) => repository.list(validated(activityInputSchema, input)) }
}

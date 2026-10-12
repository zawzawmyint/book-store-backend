import { validated } from '../../shared/validation.js'
import type { ActivityRepository } from './activity.repository.js'
import { activityInputSchema } from './activity.validation.js'
export function createActivityService(repository: ActivityRepository) {
  return { list: (input: unknown) => repository.list(validated(activityInputSchema, input)) }
}

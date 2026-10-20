import type { QueryResolvers, MutationResolvers } from '../../graphql/generated/resolvers.js'
import type { GraphQLContext } from '../../graphql/context.js'
import { requireUser } from '../../shared/authentication.js'
import type { NotificationRepository } from './notification.repository.js'
export function createNotificationResolvers(repository: NotificationRepository): {
  Query: Pick<QueryResolvers<GraphQLContext>, 'notifications' | 'notificationUnreadCount'>
  Mutation: Pick<
    MutationResolvers<GraphQLContext>,
    'markNotificationRead' | 'markAllNotificationsRead'
  >
} {
  return {
    Query: {
      notifications: (_, args, context) =>
        repository.list(requireUser(context.user).id, args.scope, args),
      notificationUnreadCount: (_, args, context) =>
        repository.unreadCount(requireUser(context.user).id, args.scope),
    },
    Mutation: {
      markNotificationRead: (_, args, context) =>
        repository.read(requireUser(context.user).id, args.scope, args.id),
      markAllNotificationsRead: (_, args, context) =>
        repository.readAll(requireUser(context.user).id, args.scope),
    },
  }
}

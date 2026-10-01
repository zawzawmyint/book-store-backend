export type AuthenticatedUser = { id: string; name: string; email: string }

export type GraphQLContext = { user: AuthenticatedUser | null }

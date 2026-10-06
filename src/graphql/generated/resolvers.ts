import type { GraphQLResolveInfo } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string | number; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Book = {
  __typename?: 'Book';
  id: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  author: Scalars['String']['output'];
  genre: Scalars['String']['output'];
  description: Scalars['String']['output'];
  priceCents: Scalars['Int']['output'];
  stock: Scalars['Int']['output'];
};

export type BookPage = {
  __typename?: 'BookPage';
  total: Scalars['Int']['output'];
  items: Array<Book>;
};

export enum AdminBookFilter {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  All = 'ALL'
}

export type AdminBook = {
  __typename?: 'AdminBook';
  id: Scalars['ID']['output'];
  title: Scalars['String']['output'];
  author: Scalars['String']['output'];
  genre: Scalars['String']['output'];
  description: Scalars['String']['output'];
  priceCents: Scalars['Int']['output'];
  stock: Scalars['Int']['output'];
  archived: Scalars['Boolean']['output'];
};

export type AdminBooksPage = {
  __typename?: 'AdminBooksPage';
  total: Scalars['Int']['output'];
  items: Array<AdminBook>;
};

export type AdminBookDetailsInput = {
  title: Scalars['String']['input'];
  author: Scalars['String']['input'];
  genre: Scalars['String']['input'];
  description: Scalars['String']['input'];
  priceCents: Scalars['Int']['input'];
};

export type CreateBookInput = {
  details: AdminBookDetailsInput;
  stock: Scalars['Int']['input'];
};

export type Query = {
  __typename?: 'Query';
  books: BookPage;
  genres: Array<Scalars['String']['output']>;
  book?: Maybe<Book>;
  adminBooks: AdminBooksPage;
  adminBook?: Maybe<AdminBook>;
  adminOrders: AdminOrdersPage;
  adminOrder?: Maybe<AdminOrder>;
  myOrders: MyOrdersPage;
  viewer?: Maybe<Viewer>;
  adminUsers: AdminUsersPage;
  adminUser: AdminUser;
  /** @deprecated Use adminUsers with AdminUserRoleFilter. */
  adminCustomers: AdminCustomersPage;
  /** @deprecated Use adminUser. */
  adminCustomer: AdminCustomer;
  adminActivity: ActivityPage;
};


export type QueryBooksArgs = {
  search?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryBookArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAdminBooksArgs = {
  search?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AdminBookFilter>;
  lowStockOnly?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAdminBookArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAdminOrdersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAdminOrderArgs = {
  id: Scalars['ID']['input'];
};


export type QueryMyOrdersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAdminUsersArgs = {
  search?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<AdminUserRoleFilter>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAdminUserArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAdminCustomersArgs = {
  search?: InputMaybe<Scalars['String']['input']>;
  role?: InputMaybe<AdminCustomerRoleFilter>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAdminCustomerArgs = {
  id: Scalars['ID']['input'];
};


export type QueryAdminActivityArgs = {
  actorUserId?: InputMaybe<Scalars['ID']['input']>;
  action?: InputMaybe<ActivityAction>;
  changedField?: InputMaybe<ActivityField>;
  targetType?: InputMaybe<ActivityTargetType>;
  targetId?: InputMaybe<Scalars['ID']['input']>;
  from?: InputMaybe<Scalars['String']['input']>;
  to?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};

export type OrderItem = {
  __typename?: 'OrderItem';
  title: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  unitPriceCents: Scalars['Int']['output'];
};

export type OrderReceipt = {
  __typename?: 'OrderReceipt';
  id: Scalars['ID']['output'];
  totalCents: Scalars['Int']['output'];
  items: Array<OrderItem>;
};

export type OrderHistoryEntry = {
  __typename?: 'OrderHistoryEntry';
  id: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  totalCents: Scalars['Int']['output'];
  items: Array<OrderItem>;
};

export type MyOrdersPage = {
  __typename?: 'MyOrdersPage';
  total: Scalars['Int']['output'];
  items: Array<OrderHistoryEntry>;
};

export type AdminOrder = {
  __typename?: 'AdminOrder';
  id: Scalars['ID']['output'];
  userId?: Maybe<Scalars['ID']['output']>;
  customerName: Scalars['String']['output'];
  email: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  totalCents: Scalars['Int']['output'];
  items: Array<OrderItem>;
};

export type AdminOrdersPage = {
  __typename?: 'AdminOrdersPage';
  total: Scalars['Int']['output'];
  items: Array<AdminOrder>;
};

export type OrderItemInput = {
  bookId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type PlaceOrderInput = {
  items: Array<OrderItemInput>;
};

export type Mutation = {
  __typename?: 'Mutation';
  placeOrder: OrderReceipt;
  createBook: AdminBook;
  updateBook: AdminBook;
  adjustBookStock: AdminBook;
  setBookArchived: AdminBook;
  setUserRole: AdminUser;
  /** @deprecated Use setUserRole. */
  setUserAdminAccess: AdminUser;
  resetUserPassword: AdminUser;
  /** @deprecated Use setUserRole (replaces setUserAdminAccess). */
  setCustomerAdminAccess: AdminCustomer;
  /** @deprecated Use resetUserPassword. */
  resetCustomerPassword: AdminCustomer;
};


export type MutationPlaceOrderArgs = {
  input: PlaceOrderInput;
};


export type MutationCreateBookArgs = {
  input: CreateBookInput;
};


export type MutationUpdateBookArgs = {
  id: Scalars['ID']['input'];
  input: AdminBookDetailsInput;
};


export type MutationAdjustBookStockArgs = {
  id: Scalars['ID']['input'];
  delta: Scalars['Int']['input'];
};


export type MutationSetBookArchivedArgs = {
  id: Scalars['ID']['input'];
  archived: Scalars['Boolean']['input'];
};


export type MutationSetUserRoleArgs = {
  userId: Scalars['ID']['input'];
  role: UserRole;
};


export type MutationSetUserAdminAccessArgs = {
  userId: Scalars['ID']['input'];
  enabled: Scalars['Boolean']['input'];
};


export type MutationResetUserPasswordArgs = {
  userId: Scalars['ID']['input'];
  newPassword: Scalars['String']['input'];
};


export type MutationSetCustomerAdminAccessArgs = {
  userId: Scalars['ID']['input'];
  enabled: Scalars['Boolean']['input'];
};


export type MutationResetCustomerPasswordArgs = {
  userId: Scalars['ID']['input'];
  newPassword: Scalars['String']['input'];
};

export enum UserRole {
  Customer = 'CUSTOMER',
  Staff = 'STAFF',
  Admin = 'ADMIN'
}

export type Viewer = {
  __typename?: 'Viewer';
  id: Scalars['ID']['output'];
  role: UserRole;
};

export enum AdminUserRoleFilter {
  All = 'ALL',
  Customer = 'CUSTOMER',
  Staff = 'STAFF',
  Admin = 'ADMIN'
}

export type AdminUser = {
  __typename?: 'AdminUser';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  email: Scalars['String']['output'];
  role: UserRole;
  createdAt: Scalars['String']['output'];
};

export type AdminUsersPage = {
  __typename?: 'AdminUsersPage';
  total: Scalars['Int']['output'];
  items: Array<AdminUser>;
};

export enum AdminCustomerRoleFilter {
  All = 'ALL',
  Customer = 'CUSTOMER',
  Staff = 'STAFF',
  Admin = 'ADMIN'
}

export type AdminCustomer = {
  __typename?: 'AdminCustomer';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  email: Scalars['String']['output'];
  role: UserRole;
  createdAt: Scalars['String']['output'];
};

export type AdminCustomersPage = {
  __typename?: 'AdminCustomersPage';
  total: Scalars['Int']['output'];
  items: Array<AdminCustomer>;
};

export enum ActivityAction {
  BookCreated = 'BOOK_CREATED',
  BookUpdated = 'BOOK_UPDATED',
  BookStockAdjusted = 'BOOK_STOCK_ADJUSTED',
  BookArchived = 'BOOK_ARCHIVED',
  BookRestored = 'BOOK_RESTORED',
  UserRoleChanged = 'USER_ROLE_CHANGED',
  UserPasswordReset = 'USER_PASSWORD_RESET'
}

export enum ActivityField {
  Title = 'TITLE',
  Author = 'AUTHOR',
  Genre = 'GENRE',
  Description = 'DESCRIPTION',
  PriceCents = 'PRICE_CENTS',
  Stock = 'STOCK',
  Archived = 'ARCHIVED',
  Role = 'ROLE'
}

export enum ActivityTargetType {
  Book = 'BOOK',
  User = 'USER'
}

export enum ActivitySource {
  Graphql = 'GRAPHQL',
  Operator = 'OPERATOR'
}

export type ActivityChange = {
  __typename?: 'ActivityChange';
  field: ActivityField;
  before?: Maybe<Scalars['String']['output']>;
  after?: Maybe<Scalars['String']['output']>;
};

export type ActivityEvent = {
  __typename?: 'ActivityEvent';
  id: Scalars['ID']['output'];
  actorUserId?: Maybe<Scalars['ID']['output']>;
  actorName: Scalars['String']['output'];
  actorRole?: Maybe<UserRole>;
  source: ActivitySource;
  action: ActivityAction;
  targetType: ActivityTargetType;
  targetId: Scalars['ID']['output'];
  targetName: Scalars['String']['output'];
  changes: Array<ActivityChange>;
  stockDelta?: Maybe<Scalars['Int']['output']>;
  createdAt: Scalars['String']['output'];
};

export type ActivityPage = {
  __typename?: 'ActivityPage';
  total: Scalars['Int']['output'];
  items: Array<ActivityEvent>;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Book: ResolverTypeWrapper<Book>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  BookPage: ResolverTypeWrapper<BookPage>;
  AdminBookFilter: AdminBookFilter;
  AdminBook: ResolverTypeWrapper<AdminBook>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  AdminBooksPage: ResolverTypeWrapper<AdminBooksPage>;
  AdminBookDetailsInput: AdminBookDetailsInput;
  CreateBookInput: CreateBookInput;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  OrderItem: ResolverTypeWrapper<OrderItem>;
  OrderReceipt: ResolverTypeWrapper<OrderReceipt>;
  OrderHistoryEntry: ResolverTypeWrapper<OrderHistoryEntry>;
  MyOrdersPage: ResolverTypeWrapper<MyOrdersPage>;
  AdminOrder: ResolverTypeWrapper<AdminOrder>;
  AdminOrdersPage: ResolverTypeWrapper<AdminOrdersPage>;
  OrderItemInput: OrderItemInput;
  PlaceOrderInput: PlaceOrderInput;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  UserRole: UserRole;
  Viewer: ResolverTypeWrapper<Viewer>;
  AdminUserRoleFilter: AdminUserRoleFilter;
  AdminUser: ResolverTypeWrapper<AdminUser>;
  AdminUsersPage: ResolverTypeWrapper<AdminUsersPage>;
  AdminCustomerRoleFilter: AdminCustomerRoleFilter;
  AdminCustomer: ResolverTypeWrapper<AdminCustomer>;
  AdminCustomersPage: ResolverTypeWrapper<AdminCustomersPage>;
  ActivityAction: ActivityAction;
  ActivityField: ActivityField;
  ActivityTargetType: ActivityTargetType;
  ActivitySource: ActivitySource;
  ActivityChange: ResolverTypeWrapper<ActivityChange>;
  ActivityEvent: ResolverTypeWrapper<ActivityEvent>;
  ActivityPage: ResolverTypeWrapper<ActivityPage>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Book: Book;
  ID: Scalars['ID']['output'];
  String: Scalars['String']['output'];
  Int: Scalars['Int']['output'];
  BookPage: BookPage;
  AdminBook: AdminBook;
  Boolean: Scalars['Boolean']['output'];
  AdminBooksPage: AdminBooksPage;
  AdminBookDetailsInput: AdminBookDetailsInput;
  CreateBookInput: CreateBookInput;
  Query: Record<PropertyKey, never>;
  OrderItem: OrderItem;
  OrderReceipt: OrderReceipt;
  OrderHistoryEntry: OrderHistoryEntry;
  MyOrdersPage: MyOrdersPage;
  AdminOrder: AdminOrder;
  AdminOrdersPage: AdminOrdersPage;
  OrderItemInput: OrderItemInput;
  PlaceOrderInput: PlaceOrderInput;
  Mutation: Record<PropertyKey, never>;
  Viewer: Viewer;
  AdminUser: AdminUser;
  AdminUsersPage: AdminUsersPage;
  AdminCustomer: AdminCustomer;
  AdminCustomersPage: AdminCustomersPage;
  ActivityChange: ActivityChange;
  ActivityEvent: ActivityEvent;
  ActivityPage: ActivityPage;
};

export type BookResolvers<ContextType = any, ParentType extends ResolversParentTypes['Book'] = ResolversParentTypes['Book']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  genre?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priceCents?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  stock?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type BookPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookPage'] = ResolversParentTypes['BookPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['Book']>, ParentType, ContextType>;
};

export type AdminBookResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminBook'] = ResolversParentTypes['AdminBook']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  genre?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priceCents?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  stock?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  archived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type AdminBooksPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminBooksPage'] = ResolversParentTypes['AdminBooksPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['AdminBook']>, ParentType, ContextType>;
};

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  books?: Resolver<ResolversTypes['BookPage'], ParentType, ContextType, RequireFields<QueryBooksArgs, 'limit' | 'offset'>>;
  genres?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  book?: Resolver<Maybe<ResolversTypes['Book']>, ParentType, ContextType, RequireFields<QueryBookArgs, 'id'>>;
  adminBooks?: Resolver<ResolversTypes['AdminBooksPage'], ParentType, ContextType, RequireFields<QueryAdminBooksArgs, 'filter' | 'lowStockOnly' | 'limit' | 'offset'>>;
  adminBook?: Resolver<Maybe<ResolversTypes['AdminBook']>, ParentType, ContextType, RequireFields<QueryAdminBookArgs, 'id'>>;
  adminOrders?: Resolver<ResolversTypes['AdminOrdersPage'], ParentType, ContextType, RequireFields<QueryAdminOrdersArgs, 'limit' | 'offset'>>;
  adminOrder?: Resolver<Maybe<ResolversTypes['AdminOrder']>, ParentType, ContextType, RequireFields<QueryAdminOrderArgs, 'id'>>;
  myOrders?: Resolver<ResolversTypes['MyOrdersPage'], ParentType, ContextType, RequireFields<QueryMyOrdersArgs, 'limit' | 'offset'>>;
  viewer?: Resolver<Maybe<ResolversTypes['Viewer']>, ParentType, ContextType>;
  adminUsers?: Resolver<ResolversTypes['AdminUsersPage'], ParentType, ContextType, RequireFields<QueryAdminUsersArgs, 'role' | 'limit' | 'offset'>>;
  adminUser?: Resolver<ResolversTypes['AdminUser'], ParentType, ContextType, RequireFields<QueryAdminUserArgs, 'id'>>;
  adminCustomers?: Resolver<ResolversTypes['AdminCustomersPage'], ParentType, ContextType, RequireFields<QueryAdminCustomersArgs, 'role' | 'limit' | 'offset'>>;
  adminCustomer?: Resolver<ResolversTypes['AdminCustomer'], ParentType, ContextType, RequireFields<QueryAdminCustomerArgs, 'id'>>;
  adminActivity?: Resolver<ResolversTypes['ActivityPage'], ParentType, ContextType, Partial<QueryAdminActivityArgs>>;
};

export type OrderItemResolvers<ContextType = any, ParentType extends ResolversParentTypes['OrderItem'] = ResolversParentTypes['OrderItem']> = {
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  unitPriceCents?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type OrderReceiptResolvers<ContextType = any, ParentType extends ResolversParentTypes['OrderReceipt'] = ResolversParentTypes['OrderReceipt']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  totalCents?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['OrderItem']>, ParentType, ContextType>;
};

export type OrderHistoryEntryResolvers<ContextType = any, ParentType extends ResolversParentTypes['OrderHistoryEntry'] = ResolversParentTypes['OrderHistoryEntry']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  totalCents?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['OrderItem']>, ParentType, ContextType>;
};

export type MyOrdersPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['MyOrdersPage'] = ResolversParentTypes['MyOrdersPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['OrderHistoryEntry']>, ParentType, ContextType>;
};

export type AdminOrderResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminOrder'] = ResolversParentTypes['AdminOrder']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  userId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  customerName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  totalCents?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['OrderItem']>, ParentType, ContextType>;
};

export type AdminOrdersPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminOrdersPage'] = ResolversParentTypes['AdminOrdersPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['AdminOrder']>, ParentType, ContextType>;
};

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  placeOrder?: Resolver<ResolversTypes['OrderReceipt'], ParentType, ContextType, RequireFields<MutationPlaceOrderArgs, 'input'>>;
  createBook?: Resolver<ResolversTypes['AdminBook'], ParentType, ContextType, RequireFields<MutationCreateBookArgs, 'input'>>;
  updateBook?: Resolver<ResolversTypes['AdminBook'], ParentType, ContextType, RequireFields<MutationUpdateBookArgs, 'id' | 'input'>>;
  adjustBookStock?: Resolver<ResolversTypes['AdminBook'], ParentType, ContextType, RequireFields<MutationAdjustBookStockArgs, 'id' | 'delta'>>;
  setBookArchived?: Resolver<ResolversTypes['AdminBook'], ParentType, ContextType, RequireFields<MutationSetBookArchivedArgs, 'id' | 'archived'>>;
  setUserRole?: Resolver<ResolversTypes['AdminUser'], ParentType, ContextType, RequireFields<MutationSetUserRoleArgs, 'userId' | 'role'>>;
  setUserAdminAccess?: Resolver<ResolversTypes['AdminUser'], ParentType, ContextType, RequireFields<MutationSetUserAdminAccessArgs, 'userId' | 'enabled'>>;
  resetUserPassword?: Resolver<ResolversTypes['AdminUser'], ParentType, ContextType, RequireFields<MutationResetUserPasswordArgs, 'userId' | 'newPassword'>>;
  setCustomerAdminAccess?: Resolver<ResolversTypes['AdminCustomer'], ParentType, ContextType, RequireFields<MutationSetCustomerAdminAccessArgs, 'userId' | 'enabled'>>;
  resetCustomerPassword?: Resolver<ResolversTypes['AdminCustomer'], ParentType, ContextType, RequireFields<MutationResetCustomerPasswordArgs, 'userId' | 'newPassword'>>;
};

export type ViewerResolvers<ContextType = any, ParentType extends ResolversParentTypes['Viewer'] = ResolversParentTypes['Viewer']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['UserRole'], ParentType, ContextType>;
};

export type AdminUserResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminUser'] = ResolversParentTypes['AdminUser']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['UserRole'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminUsersPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminUsersPage'] = ResolversParentTypes['AdminUsersPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['AdminUser']>, ParentType, ContextType>;
};

export type AdminCustomerResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminCustomer'] = ResolversParentTypes['AdminCustomer']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['UserRole'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminCustomersPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminCustomersPage'] = ResolversParentTypes['AdminCustomersPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['AdminCustomer']>, ParentType, ContextType>;
};

export type ActivityChangeResolvers<ContextType = any, ParentType extends ResolversParentTypes['ActivityChange'] = ResolversParentTypes['ActivityChange']> = {
  field?: Resolver<ResolversTypes['ActivityField'], ParentType, ContextType>;
  before?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  after?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type ActivityEventResolvers<ContextType = any, ParentType extends ResolversParentTypes['ActivityEvent'] = ResolversParentTypes['ActivityEvent']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  actorUserId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  actorName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  actorRole?: Resolver<Maybe<ResolversTypes['UserRole']>, ParentType, ContextType>;
  source?: Resolver<ResolversTypes['ActivitySource'], ParentType, ContextType>;
  action?: Resolver<ResolversTypes['ActivityAction'], ParentType, ContextType>;
  targetType?: Resolver<ResolversTypes['ActivityTargetType'], ParentType, ContextType>;
  targetId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  targetName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  changes?: Resolver<Array<ResolversTypes['ActivityChange']>, ParentType, ContextType>;
  stockDelta?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ActivityPageResolvers<ContextType = any, ParentType extends ResolversParentTypes['ActivityPage'] = ResolversParentTypes['ActivityPage']> = {
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  items?: Resolver<Array<ResolversTypes['ActivityEvent']>, ParentType, ContextType>;
};

export type Resolvers<ContextType = any> = {
  Book?: BookResolvers<ContextType>;
  BookPage?: BookPageResolvers<ContextType>;
  AdminBook?: AdminBookResolvers<ContextType>;
  AdminBooksPage?: AdminBooksPageResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  OrderItem?: OrderItemResolvers<ContextType>;
  OrderReceipt?: OrderReceiptResolvers<ContextType>;
  OrderHistoryEntry?: OrderHistoryEntryResolvers<ContextType>;
  MyOrdersPage?: MyOrdersPageResolvers<ContextType>;
  AdminOrder?: AdminOrderResolvers<ContextType>;
  AdminOrdersPage?: AdminOrdersPageResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
  AdminUser?: AdminUserResolvers<ContextType>;
  AdminUsersPage?: AdminUsersPageResolvers<ContextType>;
  AdminCustomer?: AdminCustomerResolvers<ContextType>;
  AdminCustomersPage?: AdminCustomersPageResolvers<ContextType>;
  ActivityChange?: ActivityChangeResolvers<ContextType>;
  ActivityEvent?: ActivityEventResolvers<ContextType>;
  ActivityPage?: ActivityPageResolvers<ContextType>;
};


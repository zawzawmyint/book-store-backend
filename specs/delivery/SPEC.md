# The Quiet Shelf API — delivery

> **Status:** Proposed. **Date:** 2026-10-08. No delivery behavior or migration is implemented by this specification.

## Goal and scope

Complete the paid book-order journey with delivery only:
**Address → Review total → Stripe test payment → Preparing → Shipped → Delivered**.
Coordinate with [the storefront specification](../../../frontend/specs/delivery/SPEC.md).

**Infrastructure prerequisite:** follow the separate [database-support specification](../database-support/SPEC.md)
for SQLite development and PostgreSQL production. Implement delivery on its shared
async repository boundary, with equivalent constraints and transactions on both
providers; SQLite references below describe local development, not production.

**Agreed simplification:** use one order/fulfillment status, separate from payment.
Replace the current order states with SUBMITTED, PREPARING, SHIPPED, DELIVERED and
CANCELLED. Do not add a second delivery status or keep ACCEPTED/COMPLETED.
The user authorizes discarding old local development data and starting fresh for
implementation; no historical-order compatibility or data backfill is required.

Include an immutable recipient/address snapshot, a server-owned flat delivery fee,
checkout price review, manual shipment/delivery confirmation, optional tracking
details, customer visibility, attributed history, and pre-shipment cancellation.
Reuse existing payment recovery, permissions, inventory and full refunds.

Exclude pickup, live payments, courier APIs, automatic delivery confirmation,
email/SMS/push notifications, saved address books, address edits after reservation,
partial shipments, shipping rate calculation, tax, returns, post-shipment refunds,
failed-delivery workflows, tracking edits after shipment, and estimated arrival promises.
Shipment input must be checked before confirmation; tracking corrections are deferred.

## Assumptions and configuration

- Remain a local learning project using Stripe test mode and USD; this feature
  does not authorize a production launch or change currency.
- **Proposed coverage:** whole countries from a configured allowlist, with one fee
  for every supported destination. No region/postcode exclusions in this slice.
  If actual coverage is narrower, revise this rule before enabling checkout.
- Proposed variables in `src/config/env.ts` and `.env.example`:
  `DELIVERY_ENABLED` defaults to false; `DELIVERY_COUNTRY_CODES` is a comma-separated
  nonempty list of uppercase ISO 3166-1 alpha-2 codes when enabled;
  `DELIVERY_FEE_CENTS` is a required integer from 0 to 2147483647 when enabled.
  Zero explicitly means free delivery. Do not silently select a country or fee.
- **Proposed demo value:** `DELIVERY_FEE_CENTS=500` ($5 USD per order, regardless
  of book quantity). Use this explicit value in local examples and test fixtures;
  it is configurable and is not a researched courier rate or production price.
  No hidden runtime fallback to 500 cents. For example, $20 of books plus $5
  delivery produces a $25 charge and a $25 pre-shipment cancellation refund.
- Invalid enabled configuration fails startup. With delivery disabled, new checkout
  and quotes return `PAYMENT_UNAVAILABLE`; existing payment recovery/resume,
  refunds and staff processing remain available. Never fall back to addressless
  placement. Actual countries and fee are business decisions still required.
- No new runtime dependency, service, queue or HTTP endpoint is necessary.

## Checkout contract and validation

Extend `src/modules/orders/order.schema.ts`; the following types/fields are proposed.
Existing item, UUID, authentication, origin and error rules remain in force.

```graphql
input DeliveryAddressInput {
  recipientName: String!
  phone: String!
  addressLine1: String!
  addressLine2: String
  city: String!
  region: String
  postalCode: String
  countryCode: String!
}
type DeliveryAddress {
  recipientName: String!
  phone: String!
  addressLine1: String!
  addressLine2: String
  city: String!
  region: String
  postalCode: String
  countryCode: String!
}
type DeliveryOptions { countryCodes: [String!]!, feeCents: Int!, currency: String! }
input QuoteCheckoutInput { items: [OrderItemInput!]!, deliveryAddress: DeliveryAddressInput! }
type CheckoutQuote { subtotalCents: Int!, deliveryFeeCents: Int!, totalCents: Int!, currency: String! }
extend type Query {
  deliveryOptions: DeliveryOptions!
  quoteCheckout(input: QuoteCheckoutInput!): CheckoutQuote!
}
```

- Both new queries require a session before validation. `deliveryOptions` returns
  enabled configuration only; `quoteCheckout` validates the destination and reads
  current prices, archive state and stock without reserving inventory or calling Stripe.
- **Breaking input change:** add required `deliveryAddress: DeliveryAddressInput!`,
  `expectedDeliveryFeeCents: Int!` and `expectedTotalCents: Int!` to `CreateCheckoutInput`.
  Expected amounts record the reviewed quote; they never determine charges.
- Preserve 1–20 distinct books, quantities 1–10, strict supported IDs and UUID
  request keys. Normalize addresses server-side with matching frontend validation:
  trim strings; blank optional fields become null; uppercase country codes;
  preserve internal address whitespace and Unicode. Reject control characters.
- Required trimmed lengths: recipient 1–120, addressLine1 1–200, city 1–100.
  Optional maxima: addressLine2 200, region 100, postalCode 32. Postal code and
  region are optional globally; do not impose one country's address format.
- Phone is trimmed text of 7–32 characters, containing only digits, spaces,
  `+`, `-`, `(` and `)` and at least seven digits. This is input validation,
  not a guarantee that the number or address is deliverable.
- Country must be in the configured allowlist for a new attempt. Invalid input
  or unavailable books/stock returns `BAD_USER_INPUT` without writes.
- Session identity/name/email remain server-owned; recipient name/phone may
  differ from the account holder. Never claim an order using delivery contact details.

## Pricing, reservation and payment

- Add `subtotalCents: Int!` and `deliveryFeeCents: Int!` to OrderReceipt,
  OrderHistoryEntry, MyOrder and AdminOrder. `totalCents` becomes the final charged
  amount: `subtotalCents + deliveryFeeCents`. Saved item prices exclude delivery.
- For new reservation, recalculate book subtotal and configured fee inside the
  existing stock/order transaction. Compare both expected amounts. Any mismatch
  returns `CONFLICT` before writes; customer must review a fresh quote and submit
  deliberately. A quote neither reserves stock nor guarantees availability.
- Validate integer arithmetic and final total 50–2147483647 cents before reserving.
  Do not bypass existing eligibility of book orders by using the fee to make a
  previously unsupported free/below-minimum book subtotal eligible; retain the
  existing subtotal minimum of 50 cents in this slice.
- Save address, subtotal, fee, final total and initial SUBMITTED order state together
  with order lines, stock reservation, initial workflow history, checkout mapping
  and durable payment operation. Any failure rolls back all of them.
- Use saved prices and a separate **Delivery** Stripe line item, quantity one,
  for a positive fee; omit that line for zero fee. Do not persist it as a book or
  count it as inventory. Stripe must charge exactly saved `totalCents`.
- Collect the address in our checkout only. Do not enable Stripe address collection
  or let the provider replace the saved destination. Do not put addresses/phones
  in Stripe metadata; retain existing order-reference metadata.
- Existing provider amount/currency checks, deadlines, signed webhook evidence,
  durable recovery and refund reconciliation must use the final saved total.
  Pre-shipment cancellation refunds books plus delivery fee in full; stock
  restoration remains once per saved book quantity.
- Extend the checkout request mapping with a required normalized delivery payload
  containing address and expected amounts. Check an existing `(userId, requestKey)`
  before reading current prices, coverage or fee: identical payload/lines reuses
  the saved order; different payload returns `CONFLICT`. Configuration changes
  cannot reprice or invalidate an already-reserved identical attempt.
- The fresh database has no historical checkout mappings or addressless orders.
  Every order created by the new flow has a destination. Resume uses its saved
  destination and amounts; never reprice a reserved order.
- Keep all Stripe network work outside SQLite transactions. Legacy `placeOrder`
  stays deprecated and disabled; no unpaid or addressless bypass.

## Single order status and staff contract

```graphql
enum OrderStatus { SUBMITTED PREPARING SHIPPED DELIVERED CANCELLED }
enum OrderStatusFilter { ALL SUBMITTED PREPARING SHIPPED DELIVERED CANCELLED }
enum PaymentStatus { PENDING PAID EXPIRED REFUND_PENDING REFUNDED REFUND_FAILED }
input ShipmentInput { carrier: String!, trackingNumber: String, trackingUrl: String }
type Shipment { carrier: String!, trackingNumber: String, trackingUrl: String }
type OrderDelivery {
  address: DeliveryAddress!
  shipment: Shipment
  shippedAt: String
  deliveredAt: String
}
input SetOrderStatusInput {
  id: ID!
  expectedStatus: OrderStatus!
  status: OrderStatus!
  cancellationReason: String
  shipment: ShipmentInput
}
```

- This block replaces the existing enum/input definitions; do not duplicate them.
  Extend the existing `setOrderStatus(input): AdminOrder!` mutation with optional
  shipment input. No `setOrderDeliveryStatus` mutation or delivery-status enum.
- Add non-null `delivery: OrderDelivery!` to receipt, history, customer and workspace
  order types. Delivery contains details only, with no independent status. Lists
  select existing order status without loading address/history. Reuse existing
  customer `history` and attributed workspace `history` types with the new enum.
- Keep the existing `adminOrders(status: OrderStatusFilter = ALL, limit, offset)`
  filter, count/pagination and newest-first ordering using the new status values.
  There is no second delivery filter.
- Creation records a real initial null→SUBMITTED event. Submitted + Pending payment
  is **Awaiting payment**; Submitted + Paid is **Awaiting acceptance**. Payment
  confirmation alone never advances the order to PREPARING.
- Staff/Admin with PROCESS_ORDERS may accept a Paid SUBMITTED order by changing it
  to PREPARING. Only Paid PREPARING → SHIPPED is allowed for dispatch; it writes
  shippedAt. Both transitions reject a pending cancellation intent.
- Shipment is optional for stores using their own delivery; if supplied, carrier
  trims to 1–100 characters, trackingNumber to 1–120, trackingUrl to at most 2048.
  A URL requires a tracking number; a tracking number requires the carrier.
  URL must be HTTPS with a hostname and no embedded credentials/control characters.
  Never fetch it server-side. Shipment fields are forbidden on other transitions.
- Only Paid SHIPPED → DELIVERED is allowed next.
  Staff confirms actual delivery; do not infer it from elapsed time or payment.
  In one transaction set deliveredAt and order DELIVERED; write existing order
  history and Activity together. No separate completion write or Completed state.
- Cancellation is allowed only from SUBMITTED or PREPARING, with the existing
  trimmed 1–500-character customer-visible reason. Reason is forbidden for other
  target states. DELIVERED/CANCELLED are terminal; reversal, skipping preparation
  or shipment, and reopening are invalid. Reject cancellation when SHIPPED/DELIVERED,
  without stock/refund writes. Pending-payment expiry/provider rejection cancels
  SUBMITTED orders using the existing system attribution and payment rules.
  Do not cancel merely because a request was recorded while provider truth is uncertain.
- Serialize shipping and cancellation: recheck payment, order state and
  cancellation intent in their write transaction. At most one path succeeds.
- Permission guard precedes private validation/lookup. Guests get UNAUTHENTICATED;
  Customers get FORBIDDEN; invalid input/missing staff targets get BAD_USER_INPUT;
  stale different transitions get CONFLICT with no writes. Invalid state
  transitions get BAD_USER_INPUT. Old ACCEPTED/COMPLETED enum inputs fail GraphQL validation.
- An exact already-applied target is a no-op before comparing expected states;
  for shipping its normalized shipment must also match. Different shipment under
  the same target conflicts, rather than overwriting saved tracking. No-op retries
  preserve timestamps and create no duplicate events, Activity, stock or refunds.

## Fresh data, persistence, history and privacy

- Proposed additions in `src/database/schema.ts`: `orders.subtotal_cents`,
  `orders.delivery_fee_cents`; one-to-one `order_deliveries` keyed by order ID
  containing normalized address fields, shipment fields and timestamps. There is
  no status column in that table and no order_delivery_events table. Replace
  orders.status constraints and order_status_events enum constraints with the
  new order states; reuse existing USER/SYSTEM attribution and history index.
- Constrain monetary amounts nonnegative, `total=subtotal+fee`, order enums and
  order timestamp/state consistency. Order status alone drives workspace filtering.
  Order events do not include address/phone; actor deletion must not erase
  historical attribution. History is oldest-first; at most four transitions per
  order under this workflow, so no separate paging subsystem is needed.
- Reuse Activity action `ORDER_STATUS_CHANGED` and field `ORDER_STATUS`.
  Preparation/shipping/delivery/cancellation records statuses and the existing order target only;
  keep address, phone and tracking URL out of general Activity and application logs.
- Owner reads use session user ID; non-owned `myOrder` remains null. Customer
  order history never exposes staff identity; attributed history is workspace-only.
  Staff/Admin need VIEW_ORDERS for address reads and PROCESS_ORDERS for writes.
- **User-approved local reset:** during implementation discard the old development
  database, including orders, payment mappings/operations, catalog, accounts,
  sessions and Activity; initialize a fresh database and explicitly reseed sample
  books/demo accounts. No migration of historical orders or legacy workflow UI.
- Keep committed migration history. Generate/review a new migration and metadata
  through `bun run db:generate`; the complete chain must build the final schema
  on a fresh database. Reject populated old orders rather than relabel them Delivered.
  Do not retain ACCEPTED/COMPLETED or LEGACY_UNPAID processing branches in the new
  application. Remove legacy payment enum/value handling through paired codegen;
  old migrations may still contain the historical values.
- New schema defaults must agree with the fresh payment-only flow: order status
  SUBMITTED, payment status PENDING and paymentRequired true; every checkout writes
  these values explicitly. Retaining the paymentRequired field for now does not
  permit an unpaid bypass. Update payment enum/check constraints and repository
  defaults alongside generated types; no LEGACY_UNPAID default may survive.
- Stop development writers and the Stripe listener before the deliberate local
  reset. Settle/close pending Stripe test checkout/refund operations first and
  account for already-issued test resources; deleting SQLite does not delete
  Stripe resources. Restart against the fresh database and avoid confusing old
  provider events with reused order IDs. No mass deletion of remote Stripe data.
- Reset only the resolved configured local development database and its related
  SQLite sidecars; verify absolute paths stay within the intended data directory.
  Do not reset automatically at startup, delete source files or reset production.
- Do not reset/seed persisted data or run migrations as part of drafting this spec.

## Compatibility and affected files

**Breaking changes:** replacement OrderStatus/OrderStatusFilter enums, removal of
legacy unpaid handling, required checkout fields and `totalCents` including delivery.
Deploy paired clients together on fresh local data; old clients/attempts do not
carry forward. Never accept an addressless checkout or relabel old orders Delivered.

During implementation update order schema/resolvers/repositories/validation under
`src/modules/orders/`, payment validation/service/repository/provider contract and
Stripe adapter under `src/modules/payments/`, database schema and generated `drizzle/`
migrations, config, Activity types/schema/writer, and generated resolver types.
Keep delivery behavior in focused units within the existing orders module when
needed; do not add a parallel order system. Update `SPEC.md`, README, relevant
workflow/checkout/auth/Activity specs and AGENTS delivery wording after verification.
Current implemented documents remain descriptions of the current system until then.

## Acceptance criteria

- [ ] Enabled coverage/fee are explicit; disabled/invalid configuration fails safely.
- [ ] Invalid address/unsupported country/authentication/stock causes no reservation.
- [ ] Quote has no writes; stale fee or price requires review before creating an order.
- [ ] Final saved, quoted, charged and fully refunded amounts include the same fee.
- [ ] Address and amounts are immutable; retries reuse only matching payloads.
- [ ] Configuration changes do not affect saved retries, resume or recovery.
- [ ] One order status governs Submitted → Preparing → Shipped → Delivered or Cancelled.
- [ ] Payment remains separate; only Paid orders prepare/ship/deliver.
- [ ] Cancellation and shipping cannot race; invalid transitions have no writes.
- [ ] Delivery confirmation sets Delivered atomically with timestamp/history/Activity.
- [ ] Pre-shipment cancel/expiry restocks/refunds exactly once.
- [ ] Shipped/delivered orders cannot cancel/refund through the existing workflow.
- [ ] Owner privacy, attributed staff history and Admin-only Activity are preserved.
- [ ] Fresh migration/seed succeeds; populated old data requires the deliberate local reset.
- [ ] No independent delivery status, Accepted/Completed UI or legacy processing remains.
- [ ] API tests, provider tests, migration tests, lint/build and paired browser tests pass.

## Validation and rollout

Extend `test/payments.test.ts`, `test/payments-api.test.ts`, `test/admin-orders.test.ts`,
`test/stripe-provider.test.ts`, `test/migration.test.ts` and Activity/config tests;
add focused delivery tests as needed. Cover price/fee drift, address-only key reuse,
country removal after reservation, exact/conflicting retries, uncertain provider
cancellation, stock invariants, owner/role loss and all allowed/forbidden single-status transitions.
Verify both payment evidence and refunds against the final total, including zero fee.

Generate backend resolver types, then frontend types against the paired API.
Run both repositories' test/lint/build commands and frontend `bun run test:e2e`.
Manually confirm address review, shipment and delivery using demo accounts.

Stop writers/listener, reconcile old Stripe test operations and perform the explicit
local reset/reseed described above; deploy coordinated clients/API. Enable delivery
only after coverage/fee are decided and criteria pass. Disabling delivery stops new
attempts while allowing saved orders to finish. Rollback in this disposable local
environment means returning to matching earlier app versions and recreating their
development database, after settling newer test payment operations. No production
reset or data-preserving upgrade/rollback is part of this specification.

## Open decisions

- Store owner must choose supported countries before enablement. The proposed local
  demo fee is $5 USD; choose an actual shipping price before any production rollout.
- Whole-country coverage and manual delivery confirmation are proposed defaults;
  confirm them before implementation if the store needs narrower coverage.
- Notifications, courier integration and returns are separate later specifications.

import type { DomainStore } from '../../database/store.types.js'
import type { OrderDelivery } from './delivery.validation.js'
export async function readDelivery(store: DomainStore, id: number): Promise<OrderDelivery> {
  const row = await store.delivery(id)
  if (!row) throw new Error('Order delivery snapshot is missing')
  const {
    recipientName,
    phone,
    addressLine1,
    addressLine2,
    city,
    region,
    postalCode,
    countryCode,
    carrier,
    trackingNumber,
    trackingUrl,
    shippedAt,
    deliveredAt,
  } = row
  return {
    address: {
      recipientName,
      phone,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      countryCode,
    },
    shipment: carrier ? { carrier, trackingNumber, trackingUrl } : null,
    shippedAt,
    deliveredAt,
  }
}

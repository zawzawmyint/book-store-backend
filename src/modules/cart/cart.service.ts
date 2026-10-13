import { validated } from '../../shared/validation.js'
import type { CartRepository } from './cart.repository.js'
import { setCartItemSchema, mergeGuestCartSchema } from './cart.validation.js'
export function createCartService(repository: CartRepository) {
  return {
    read: repository.read,
    set: (owner: string, input: unknown) =>
      repository.set(owner, validated(setCartItemSchema, input)),
    merge: (owner: string, input: unknown) =>
      repository.merge(owner, validated(mergeGuestCartSchema, input)),
  }
}

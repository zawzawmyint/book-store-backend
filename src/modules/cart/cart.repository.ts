import { randomUUID } from 'node:crypto'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import type { DomainStore } from '../../database/store.types.js'
import { CartConflictError, ValidationError } from '../../shared/errors.js'
import type { z } from 'zod'
import type { setCartItemSchema, mergeGuestCartSchema } from './cart.validation.js'

export type MergeNotice = {
  bookId: string
  reason: 'UNAVAILABLE' | 'QUANTITY_LIMIT' | 'LINE_LIMIT'
}
type SetInput = z.infer<typeof setCartItemSchema>
type MergeInput = z.infer<typeof mergeGuestCartSchema>
export function createCartRepository(input: DatabaseInput) {
  const store = normalizeStore(input)
  async function project(tx: DomainStore, owner: string, mergeNotices: MergeNotice[] = []) {
    const cart = await tx.cart(owner)
    if (!cart) return { revision: '0', items: [], mergeNotices }
    const items = []
    for (const line of await tx.cartItems(owner)) {
      // The owner lock stabilizes revision and lines. Catalog projection needs
      // committed metadata, without blocking unrelated stock/checkout writers.
      const book = (await tx.book(line.bookId, false))!
      items.push({
        bookId: String(line.bookId),
        quantity: line.quantity,
        lineVersion: line.lineVersion,
        title: book.title,
        author: book.author,
        genre: book.genre,
        priceCents: book.priceCents,
        stock: book.stock,
        available: !book.archived && book.stock >= line.quantity,
      })
    }
    return { revision: cart?.revision ?? '0', items, mergeNotices }
  }
  async function mutate(owner: string, input: SetInput | MergeInput, kind: 'set' | 'merge') {
    return store.transaction(async (tx) => {
      const cart = (await tx.cart(owner, true))!
      // Revision is concurrency metadata, not operation intent. A failed attempt
      // may be retried with a freshly reviewed revision and the same durable key.
      const guest =
        'items' in input ? [...input.items].sort((a, b) => Number(a.bookId) - Number(b.bookId)) : []
      const fingerprint = JSON.stringify(
        kind === 'set' && 'bookId' in input
          ? { kind, bookId: input.bookId, quantity: input.quantity }
          : { kind, items: guest },
      )
      const receipt = await tx.cartOperation(owner, input.requestKey)
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new ValidationError('Request key was already used with different cart input')
        return project(tx, owner, JSON.parse(receipt.noticesJson) as MergeNotice[])
      }
      if (cart.revision !== input.expectedRevision) throw new CartConflictError()
      const lines = await tx.cartItems(owner)
      const notices: MergeNotice[] = []
      let changed = false
      if ('bookId' in input) {
        const id = Number(input.bookId),
          prior = lines.find((l) => l.bookId === id)
        if (input.quantity > (prior?.quantity ?? 0)) {
          const book = await tx.book(id)
          if (!book || book.archived || book.stock < input.quantity)
            throw new ValidationError('This book is unavailable or has insufficient stock')
          if (!prior && lines.length >= 20)
            throw new ValidationError('Cart may contain at most 20 books')
        }
        if (input.quantity !== (prior?.quantity ?? 0)) {
          if (input.quantity === 0) await tx.deleteCartItem(owner, id)
          else
            await tx.putCartItem({
              userId: owner,
              bookId: id,
              quantity: input.quantity,
              lineVersion: randomUUID(),
            })
          changed = true
        }
      } else {
        let size = lines.length
        for (const line of guest) {
          const id = Number(line.bookId),
            prior = lines.find((l) => l.bookId === id),
            book = await tx.book(id)
          if (!book || book.archived || book.stock <= 0 || (prior && book.stock < prior.quantity)) {
            notices.push({ bookId: line.bookId, reason: 'UNAVAILABLE' })
            continue
          }
          if (!prior && size >= 20) {
            notices.push({ bookId: line.bookId, reason: 'LINE_LIMIT' })
            continue
          }
          const requested = (prior?.quantity ?? 0) + line.quantity
          const quantity = Math.min(requested, 10, book.stock)
          if (quantity < requested) notices.push({ bookId: line.bookId, reason: 'QUANTITY_LIMIT' })
          if (quantity !== (prior?.quantity ?? 0)) {
            await tx.putCartItem({ userId: owner, bookId: id, quantity, lineVersion: randomUUID() })
            changed = true
            if (!prior) size++
          }
        }
      }
      if (changed) await tx.setCartRevision(owner, String(BigInt(cart.revision) + 1n))
      await tx.insertCartOperation({
        userId: owner,
        requestKey: input.requestKey,
        fingerprint,
        noticesJson: JSON.stringify(notices),
      })
      return project(tx, owner, notices)
    })
  }
  return {
    read: (owner: string) => store.transaction((tx) => project(tx, owner)),
    set: (owner: string, input: SetInput) => mutate(owner, input, 'set'),
    merge: (owner: string, input: MergeInput) => mutate(owner, input, 'merge'),
  }
}
export type CartRepository = ReturnType<typeof createCartRepository>
export type AccountCartResult = Awaited<ReturnType<CartRepository['read']>>

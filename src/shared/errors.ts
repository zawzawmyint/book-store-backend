export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends Error {}
export class PaymentUnavailableError extends Error {
  constructor() {
    super('Payment service unavailable. Please try again shortly.')
  }
}

export class CartConflictError extends Error {
  constructor() {
    super('Your cart changed. Reload it and retry your edit.')
  }
}

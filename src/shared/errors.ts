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

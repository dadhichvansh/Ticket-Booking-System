const ERROR_STATUS = {
  validation_error: 400,
  invalid_credentials: 401,
  unauthorized: 401,
  token_expired: 401,
  not_found: 404,
  event_not_found: 404,
  email_taken: 409,
  rate_limited: 429,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

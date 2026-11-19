const ERROR_STATUS = {
  validation_error: 400,
  invalid_json: 400,
  body_too_large: 400,
  not_found: 404,
  charge_not_found: 404,
  amount_mismatch: 422,
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

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const unavailable = (msg: string) => new AppError(503, 'INTEGRATION_UNAVAILABLE', msg);

/** Error from a third-party integration, with whether retrying could help. */
export class IntegrationError extends Error {
  constructor(
    public integration: string,
    message: string,
    public retryable: boolean,
    public httpStatus?: number,
  ) {
    super(message);
  }
}

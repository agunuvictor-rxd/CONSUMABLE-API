export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static badRequest(message = 'Invalid request') {
    return new ApiError(400, ERROR_CODES.BAD_REQUEST, message);
  }

  static validation(message = 'Request body is invalid') {
    return new ApiError(422, ERROR_CODES.VALIDATION_ERROR, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, message);
  }

  static conflict(message = 'Resource conflict') {
    return new ApiError(409, ERROR_CODES.CONFLICT, message);
  }

  static rateLimited(message) {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, message);
  }

  static payloadTooLarge(message = 'Request payload too large') {
    return new ApiError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, message);
  }
}

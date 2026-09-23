import { ApiError, ERROR_CODES } from '../errors.js';

export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`));
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: ERROR_CODES.BAD_REQUEST, message: 'Request body is not valid JSON' },
    });
    return;
  }

  if (err && err.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: 'Request payload too large' },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
  });
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

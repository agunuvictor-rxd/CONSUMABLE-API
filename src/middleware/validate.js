import { ApiError } from '../errors.js';

export function assertBodyObject(req) {
  const body = req.body;
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }
  return body;
}

export function requireFields(body, fields) {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });
  if (missing.length > 0) {
    throw ApiError.validation(`Missing required field(s): ${missing.join(', ')}`);
  }
}

export function assertTypes(body, spec) {
  for (const [field, type] of Object.entries(spec)) {
    const value = body[field];
    if (value === undefined) continue;

    let ok = false;
    switch (type) {
      case 'string':
        ok = typeof value === 'string' && value.trim().length > 0;
        break;
      case 'text':
        ok = typeof value === 'string';
        break;
      case 'number':
        ok = typeof value === 'number' && Number.isFinite(value);
        break;
      case 'integer':
        ok = Number.isInteger(value);
        break;
      case 'boolean':
        ok = typeof value === 'boolean';
        break;
      case 'array':
        ok = Array.isArray(value);
        break;
      default:
        ok = true;
    }

    if (!ok) {
      throw ApiError.badRequest(`Field "${field}" must be ${type === 'text' ? 'a string' : `a ${type}`}`);
    }
  }
}

export function assertRanges(body, ranges) {
  for (const [field, { min, max }] of Object.entries(ranges)) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (min !== undefined && value < min) {
      throw ApiError.badRequest(`Field "${field}" must be >= ${min}`);
    }
    if (max !== undefined && value > max) {
      throw ApiError.badRequest(`Field "${field}" must be <= ${max}`);
    }
  }
}

export function assertEnum(body, field, values) {
  if (body[field] === undefined) return;
  if (!values.includes(body[field])) {
    throw ApiError.badRequest(`Field "${field}" must be one of: ${values.join(', ')}`);
  }
}

export function rejectUnknownFields(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw ApiError.badRequest(`Unknown field(s): ${unknown.join(', ')}`);
  }
}

export function requireAtLeastOneField(body, allowed) {
  const provided = allowed.filter((field) => body[field] !== undefined);
  if (provided.length === 0) {
    throw ApiError.validation(`Request body must include at least one of: ${allowed.join(', ')}`);
  }
}

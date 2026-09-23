import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { isUuid } from './ids.js';

const RESERVED_PARAMS = new Set(['limit', 'offset', 'sort', 'order']);

function parseBoolean(value, name) {
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return 1;
  if (['false', '0', 'no'].includes(normalized)) return 0;
  throw ApiError.badRequest(`Query parameter "${name}" must be a boolean (true/false)`);
}

function parseNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw ApiError.badRequest(`Query parameter "${name}" must be a number`);
  }
  return parsed;
}

function assertKnownParams(query, allowedFilters) {
  const known = new Set([...RESERVED_PARAMS, ...Object.keys(allowedFilters)]);
  const unknown = Object.keys(query).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw ApiError.badRequest(`Unknown query parameter(s): ${unknown.join(', ')}`);
  }
}

function buildWhere(query, filters) {
  const clauses = [];
  const params = [];

  for (const [name, spec] of Object.entries(filters)) {
    if (query[name] === undefined) continue;
    const raw = query[name];
    if (raw === '') {
      throw ApiError.badRequest(`Query parameter "${name}" must not be empty`);
    }

    let value;
    switch (spec.type) {
      case 'boolean':
        value = parseBoolean(raw, name);
        break;
      case 'integer': {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed)) {
          throw ApiError.badRequest(`Query parameter "${name}" must be an integer`);
        }
        value = parsed;
        break;
      }
      case 'number':
        value = parseNumber(raw, name);
        break;
      case 'enum':
        if (!spec.values.includes(raw)) {
          throw ApiError.badRequest(
            `Query parameter "${name}" must be one of: ${spec.values.join(', ')}`,
          );
        }
        value = raw;
        break;
      case 'uuid':
        if (!isUuid(raw)) {
          throw ApiError.badRequest(`Query parameter "${name}" must be a valid UUID`);
        }
        value = raw;
        break;
      default:
        value = raw;
    }

    if (spec.op === 'gte') {
      clauses.push(`${spec.column} >= ?`);
    } else if (spec.op === 'lte') {
      clauses.push(`${spec.column} <= ?`);
    } else if (spec.op === 'like') {
      clauses.push(`LOWER(${spec.column}) LIKE ?`);
      value = `%${String(value).toLowerCase()}%`;
    } else if (spec.caseInsensitive) {
      clauses.push(`LOWER(${spec.column}) = LOWER(?)`);
    } else {
      clauses.push(`${spec.column} = ?`);
    }
    params.push(value);
  }

  return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
}

/**
 * Parses list-query parameters (pagination, filtering, sorting) against
 * a resource definition. Throws ApiError(400) for invalid input.
 */
export function parseListQuery(query, { filters = {}, sortableColumns = [], defaultSort, defaultOrder = 'asc' }) {
  assertKnownParams(query, filters);

  const { defaultLimit, maxLimit, defaultOffset } = config.pagination;

  const rawLimit = query.limit ?? defaultLimit;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw ApiError.badRequest(
      `Query parameter "limit" must be an integer between 1 and ${maxLimit}`,
    );
  }

  const rawOffset = query.offset ?? defaultOffset;
  const offset = Number(rawOffset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw ApiError.badRequest('Query parameter "offset" must be a non-negative integer');
  }

  const sort = query.sort ?? defaultSort;
  if (!sortableColumns.includes(sort)) {
    throw ApiError.badRequest(
      `Query parameter "sort" must be one of: ${sortableColumns.join(', ')}`,
    );
  }

  const order = (query.order ?? defaultOrder).toLowerCase();
  if (!['asc', 'desc'].includes(order)) {
    throw ApiError.badRequest('Query parameter "order" must be "asc" or "desc"');
  }

  return { limit, offset, sort, order, where: buildWhere(query, filters) };
}

export function buildMeta({ total, limit, offset }) {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

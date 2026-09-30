import { Router } from 'express';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  assertBodyObject,
  assertTypes,
  assertRanges,
  rejectUnknownFields,
  requireFields,
  requireAtLeastOneField,
} from '../middleware/validate.js';
import { parseListQuery, buildMeta } from '../utils/query.js';
import { isUuid, randomUuid } from '../utils/ids.js';
import { fetchPage, applyUpdate, nowIso } from '../repositories/common.js';

const router = Router({ mergeParams: true });

const TABLE = 'menu_items';
const CREATE_FIELDS = ['restaurant_id', 'name', 'description', 'category', 'price', 'is_available'];
const UPDATE_FIELDS = ['name', 'description', 'category', 'price', 'is_available'];
const TYPE_SPEC = {
  restaurant_id: 'string',
  name: 'string',
  description: 'text',
  category: 'string',
  price: 'number',
  is_available: 'boolean',
};

const FILTERS = {
  restaurant_id: { column: 'restaurant_id', type: 'uuid' },
  category: { column: 'category', type: 'string', caseInsensitive: true },
  is_available: { column: 'is_available', type: 'boolean' },
  min_price: { column: 'price', type: 'number', op: 'gte' },
  max_price: { column: 'price', type: 'number', op: 'lte' },
  search: { column: 'name', type: 'string', op: 'like' },
};

const SORTABLE = ['name', 'category', 'price', 'created_at', 'updated_at'];

export function loadMenuItem(id) {
  if (!isUuid(id)) throw ApiError.badRequest('Path parameter "id" must be a valid UUID');
  const row = getDb().prepare(`SELECT * FROM menu_items WHERE id = ?`).get(id);
  if (!row) throw ApiError.notFound('Menu item not found');
  return row;
}

export function toMenuItemDto(row) {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.price,
    is_available: row.is_available === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function assertRestaurantExists(restaurantId) {
  if (!isUuid(restaurantId)) {
    throw ApiError.badRequest('Field "restaurant_id" must be a valid UUID');
  }
  const row = getDb().prepare(`SELECT id FROM restaurants WHERE id = ?`).get(restaurantId);
  if (!row) {
    throw ApiError.validation('Field "restaurant_id" does not reference an existing restaurant');
  }
}

export function insertMenuItem({ restaurantId, body }) {
  const db = getDb();
  const id = randomUuid();
  const timestamp = nowIso();
  const isAvailable = body.is_available === undefined ? 1 : body.is_available ? 1 : 0;

  db.prepare(
    `INSERT INTO menu_items (id, restaurant_id, name, description, category, price, is_available, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    restaurantId,
    body.name.trim(),
    body.description ?? '',
    (body.category ?? 'mains').trim(),
    body.price,
    isAvailable,
    timestamp,
    timestamp,
  );
  return db.prepare(`SELECT * FROM menu_items WHERE id = ?`).get(id);
}

router.get(
  '/',
  asyncHandler((req, res) => {
    const q = parseListQuery(req.query, {
      filters: FILTERS,
      sortableColumns: SORTABLE,
      defaultSort: 'name',
      defaultOrder: 'asc',
    });
    const { rows, total } = fetchPage(getDb(), {
      table: TABLE,
      whereSql: q.where.sql,
      whereParams: q.where.params,
      sort: q.sort,
      order: q.order,
      limit: q.limit,
      offset: q.offset,
    });
    res.json({
      data: rows.map(toMenuItemDto),
      meta: buildMeta({ total, limit: q.limit, offset: q.offset }),
    });
  }),
);

router.post(
  '/',
  asyncHandler((req, res) => {
    const body = assertBodyObject(req);
    requireFields(body, ['restaurant_id', 'name', 'price']);
    assertTypes(body, TYPE_SPEC);
    assertRanges(body, { price: { min: 0, max: config.limits.maxPrice } });
    rejectUnknownFields(body, CREATE_FIELDS);
    assertRestaurantExists(body.restaurant_id);
    res.status(201).json({ data: toMenuItemDto(insertMenuItem({ restaurantId: body.restaurant_id, body })) });
  }),
);

router.get(
  '/:id',
  asyncHandler((req, res) => {
    res.json({ data: toMenuItemDto(loadMenuItem(req.params.id)) });
  }),
);

router.patch(
  '/:id',
  asyncHandler((req, res) => {
    loadMenuItem(req.params.id);
    const body = assertBodyObject(req);
    rejectUnknownFields(body, UPDATE_FIELDS);
    requireAtLeastOneField(body, UPDATE_FIELDS);
    assertTypes(body, TYPE_SPEC);
    assertRanges(body, { price: { min: 0, max: config.limits.maxPrice } });

    const data = { ...body };
    if (typeof data.name === 'string') data.name = data.name.trim();
    if (typeof data.category === 'string') data.category = data.category.trim();
    if (data.is_available !== undefined) data.is_available = data.is_available ? 1 : 0;

    applyUpdate(getDb(), { table: TABLE, id: req.params.id, data, columns: UPDATE_FIELDS });
    res.json({ data: toMenuItemDto(loadMenuItem(req.params.id)) });
  }),
);

router.delete(
  '/:id',
  asyncHandler((req, res) => {
    loadMenuItem(req.params.id);
    const db = getDb();
    const orderRefCount = Number(
      db.prepare(`SELECT COUNT(*) AS c FROM order_items WHERE menu_item_id = ?`).get(req.params.id).c,
    );
    if (orderRefCount > 0) {
      throw ApiError.conflict(
        `Cannot delete menu item: ${orderRefCount} order line(s) reference it.`,
      );
    }
    db.prepare(`DELETE FROM menu_items WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  }),
);

export default router;
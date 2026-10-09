import { Router } from 'express';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { toMenuItemDto, insertMenuItem } from './menuItems.js';
import { createOrder, validateOrderCreateBody, toOrderDto } from './orders.js';
import {
  assertBodyObject,
  assertTypes,
  assertRanges,
  assertEnum,
  rejectUnknownFields,
  requireFields,
  requireAtLeastOneField,
} from '../middleware/validate.js';
import { parseListQuery, buildMeta } from '../utils/query.js';
import { isUuid, randomUuid } from '../utils/ids.js';
import { fetchPage, applyUpdate, nowIso } from '../repositories/common.js';

const router = Router();

const TABLE = 'restaurants';
const CREATE_FIELDS = ['name', 'cuisine', 'city', 'country', 'phone', 'rating', 'price_range', 'is_open'];
const UPDATE_FIELDS = CREATE_FIELDS;
const TYPE_SPEC = {
  name: 'string',
  cuisine: 'string',
  city: 'string',
  country: 'string',
  phone: 'text',
  rating: 'number',
  price_range: 'integer',
  is_open: 'boolean',
};

const FILTERS = {
  cuisine: { column: 'cuisine', type: 'string', caseInsensitive: true },
  city: { column: 'city', type: 'string', caseInsensitive: true },
  is_open: { column: 'is_open', type: 'boolean' },
  min_rating: { column: 'rating', type: 'number', op: 'gte' },
  search: { column: 'name', type: 'string', op: 'like' },
};

const SORTABLE = ['name', 'cuisine', 'city', 'rating', 'price_range', 'created_at', 'updated_at'];

export function loadRestaurant(id) {
  if (!isUuid(id)) throw ApiError.badRequest('Path parameter "id" must be a valid UUID');
  const row = getDb().prepare(`SELECT * FROM restaurants WHERE id = ?`).get(id);
  if (!row) throw ApiError.notFound('Restaurant not found');
  return row;
}

function toDto(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    cuisine: row.cuisine,
    city: row.city,
    country: row.country,
    phone: row.phone,
    rating: row.rating,
    price_range: row.price_range,
    is_open: row.is_open === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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
      data: rows.map(toDto),
      meta: buildMeta({ total, limit: q.limit, offset: q.offset }),
    });
  }),
);

router.post(
  '/',
  asyncHandler((req, res) => {
    const body = assertBodyObject(req);
    requireFields(body, ['name', 'cuisine', 'city', 'country']);
    assertTypes(body, TYPE_SPEC);
    assertRanges(body, { rating: { min: 0, max: 5 }, price_range: { min: 1, max: 4 } });
    rejectUnknownFields(body, CREATE_FIELDS);

    const db = getDb();
    const id = randomUuid();
    const timestamp = nowIso();
    const rating = body.rating ?? 4;
    const priceRange = body.price_range ?? 2;
    const isOpen = body.is_open === undefined ? 1 : body.is_open ? 1 : 0;
    const slug = `${slugify(body.name)}-${id.slice(0, 8)}`;

    db.prepare(
      `INSERT INTO restaurants (id, name, slug, cuisine, city, country, phone, rating, price_range, is_open, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.name.trim(),
      slug,
      body.cuisine.trim(),
      body.city.trim(),
      body.country.trim(),
      body.phone ?? null,
      rating,
      priceRange,
      isOpen,
      timestamp,
      timestamp,
    );

    res.status(201).json({ data: toDto(db.prepare(`SELECT * FROM restaurants WHERE id = ?`).get(id)) });
  }),
);

router.get(
  '/:id',
  asyncHandler((req, res) => {
    res.json({ data: toDto(loadRestaurant(req.params.id)) });
  }),
);

router.patch(
  '/:id',
  asyncHandler((req, res) => {
    loadRestaurant(req.params.id);
    const body = assertBodyObject(req);
    rejectUnknownFields(body, UPDATE_FIELDS);
    requireAtLeastOneField(body, UPDATE_FIELDS);
    assertTypes(body, TYPE_SPEC);
    assertRanges(body, { rating: { min: 0, max: 5 }, price_range: { min: 1, max: 4 } });

    const data = { ...body };
    if (typeof data.name === 'string') data.name = data.name.trim();
    if (typeof data.cuisine === 'string') data.cuisine = data.cuisine.trim();
    if (typeof data.city === 'string') data.city = data.city.trim();
    if (typeof data.country === 'string') data.country = data.country.trim();
    if (data.is_open !== undefined) data.is_open = data.is_open ? 1 : 0;

    applyUpdate(getDb(), { table: TABLE, id: req.params.id, data, columns: UPDATE_FIELDS });
    res.json({ data: toDto(loadRestaurant(req.params.id)) });
  }),
);

router.delete(
  '/:id',
  asyncHandler((req, res) => {
    loadRestaurant(req.params.id);
    const db = getDb();
    const orderCount = Number(
      db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE restaurant_id = ?`).get(req.params.id).c,
    );
    if (orderCount > 0) {
      throw ApiError.conflict(
        `Cannot delete restaurant: ${orderCount} order(s) reference it. Cancel or remove those orders first.`,
      );
    }
    db.prepare(`DELETE FROM restaurants WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  }),
);

const MENU_ITEM_FILTERS = {
  category: { column: 'category', type: 'string', caseInsensitive: true },
  is_available: { column: 'is_available', type: 'boolean' },
  min_price: { column: 'price', type: 'number', op: 'gte' },
  max_price: { column: 'price', type: 'number', op: 'lte' },
  search: { column: 'name', type: 'string', op: 'like' },
};

const MENU_ITEM_SORTABLE = ['name', 'category', 'price', 'created_at', 'updated_at'];

router.get(
  '/:id/menu-items',
  asyncHandler((req, res) => {
    const restaurant = loadRestaurant(req.params.id);
    const q = parseListQuery(req.query, {
      filters: MENU_ITEM_FILTERS,
      sortableColumns: MENU_ITEM_SORTABLE,
      defaultSort: 'name',
      defaultOrder: 'asc',
    });
    const restaurantClause = 'restaurant_id = ?';
    const whereSql =
      q.where.sql === '1 = 1' ? restaurantClause : `${restaurantClause} AND ${q.where.sql}`;
    const { rows, total } = fetchPage(getDb(), {
      table: 'menu_items',
      whereSql,
      whereParams: [restaurant.id, ...q.where.params],
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
  '/:id/menu-items',
  asyncHandler((req, res) => {
    loadRestaurant(req.params.id);
    const body = assertBodyObject(req);
    requireFields(body, ['name', 'price']);
    assertTypes(body, {
      name: 'string',
      description: 'text',
      category: 'string',
      price: 'number',
      is_available: 'boolean',
    });
    assertRanges(body, { price: { min: 0, max: config.limits.maxPrice } });
    rejectUnknownFields(body, ['name', 'description', 'category', 'price', 'is_available']);
    if (body.restaurant_id !== undefined) {
      throw ApiError.badRequest('Field "restaurant_id" must not be set on a nested create');
    }
    res
      .status(201)
      .json({ data: toMenuItemDto(insertMenuItem({ restaurantId: req.params.id, body })) });
  }),
);

const ORDER_FILTERS = {
  status: {
    column: 'status',
    type: 'enum',
    values: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
  },
  customer: { column: 'customer_name', type: 'string', op: 'like' },
};

const ORDER_SORTABLE = ['placed_at', 'subtotal', 'total', 'status', 'customer_name', 'created_at'];

router.get(
  '/:id/orders',
  asyncHandler((req, res) => {
    const restaurant = loadRestaurant(req.params.id);
    const q = parseListQuery(req.query, {
      filters: ORDER_FILTERS,
      sortableColumns: ORDER_SORTABLE,
      defaultSort: 'placed_at',
      defaultOrder: 'desc',
    });
    const restaurantClause = 'restaurant_id = ?';
    const whereSql =
      q.where.sql === '1 = 1' ? restaurantClause : `${restaurantClause} AND ${q.where.sql}`;
    const { rows, total } = fetchPage(getDb(), {
      table: 'orders',
      whereSql,
      whereParams: [restaurant.id, ...q.where.params],
      sort: q.sort,
      order: q.order,
      limit: q.limit,
      offset: q.offset,
    });
    res.json({
      data: rows.map(toOrderDto),
      meta: buildMeta({ total, limit: q.limit, offset: q.offset }),
    });
  }),
);

router.post(
  '/:id/orders',
  asyncHandler((req, res) => {
    const restaurant = loadRestaurant(req.params.id);
    const body = assertBodyObject(req);
    validateOrderCreateBody(body, { nested: true });
    res
      .status(201)
      .json({ data: toOrderDto(createOrder({ restaurantId: restaurant.id, body })) });
  }),
);

export default router;

import { Router } from 'express';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
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
import { round2 } from '../utils/money.js';
import { fetchPage, applyUpdate, nowIso } from '../repositories/common.js';

const router = Router({ mergeParams: true });

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

export const ORDER_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const ORDERS_FILTERS = {
  status: { column: 'status', type: 'enum', values: ORDER_STATUSES },
  restaurant_id: { column: 'restaurant_id', type: 'uuid' },
  customer: { column: 'customer_name', type: 'string', op: 'like' },
  placed_from: { column: 'placed_at', type: 'string', op: 'gte' },
  placed_to: { column: 'placed_at', type: 'string', op: 'lte' },
  min_total: { column: 'total', type: 'number', op: 'gte' },
};

const ORDERS_SORTABLE = ['placed_at', 'subtotal', 'total', 'status', 'customer_name', 'created_at', 'updated_at'];

const ORDER_CREATE_FIELDS = ['restaurant_id', 'customer_name', 'status', 'delivery_fee', 'notes', 'items'];
const NESTED_ORDER_CREATE_FIELDS = ORDER_CREATE_FIELDS.filter((field) => field !== 'restaurant_id');
const ORDER_UPDATE_FIELDS = ['status', 'customer_name', 'notes'];

const ITEMS_FILTERS = {
  menu_item_id: { column: 'menu_item_id', type: 'uuid' },
  item_name: { column: 'item_name', type: 'string', op: 'like' },
  min_quantity: { column: 'quantity', type: 'integer', op: 'gte' },
  min_line_total: { column: 'line_total', type: 'number', op: 'gte' },
};

const ITEMS_SORTABLE = ['item_name', 'quantity', 'unit_price', 'line_total', 'created_at'];

export function loadOrder(id) {
  if (!isUuid(id)) throw ApiError.badRequest('Path parameter "id" must be a valid UUID');
  const row = getDb().prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  if (!row) throw ApiError.notFound('Order not found');
  return row;
}

export function toOrderDto(row) {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    customer_name: row.customer_name,
    status: row.status,
    subtotal: row.subtotal,
    delivery_fee: row.delivery_fee,
    total: row.total,
    notes: row.notes,
    placed_at: row.placed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toOrderItemDto(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    menu_item_id: row.menu_item_id,
    item_name: row.item_name,
    quantity: row.quantity,
    unit_price: row.unit_price,
    line_total: row.line_total,
    created_at: row.created_at,
  };
}

function recalcOrderTotals(db, orderId, recomputeSubtotal = true) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  if (!order) return;
  const itemRow = db
    .prepare(`SELECT COALESCE(SUM(line_total), 0) AS s FROM order_items WHERE order_id = ?`)
    .get(orderId);
  const subtotal = recomputeSubtotal ? round2(itemRow.s) : order.subtotal;
  const total = round2(subtotal + order.delivery_fee);
  db.prepare(`UPDATE orders SET subtotal = ?, total = ?, updated_at = ? WHERE id = ?`).run(
    subtotal,
    total,
    nowIso(),
    orderId,
  );
}

function insertOrderItem(db, { orderId, body, allowPatch }) {
  const fields = ['menu_item_id', 'quantity'];
  if (allowPatch) fields.push('order_id');
  const id = randomUuid();
  const timestamp = nowIso();
  const item = db
    .prepare(`SELECT name, price FROM menu_items WHERE id = ?`)
    .get(body.menu_item_id);
  if (!item) {
    throw ApiError.validation('Field "menu_item_id" does not reference an existing menu item');
  }
  const lineTotal = round2(Number(body.quantity) * Number(item.price));
  db.prepare(
export function round2(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`round2 expected a finite number, received: ${String(value)}`);
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, body.order_id, body.menu_item_id, item.name, body.quantity, item.price, lineTotal, timestamp);
  return db.prepare(`SELECT * FROM order_items WHERE id = ?`).get(id);
}

function assertOrderItemBelongsToRestaurant(menuItemId, restaurantId) {
  const item = getDb().prepare(`SELECT restaurant_id FROM menu_items WHERE id = ?`).get(menuItemId);
  if (!item) {
    throw ApiError.validation('Field "menu_item_id" does not reference an existing menu item');
  }
  if (item.restaurant_id !== restaurantId) {
    throw ApiError.validation(
      'Field "menu_item_id" must reference a menu item that belongs to the order\'s restaurant',
    );
  }
}

function validateItemsArray(body) {
  if (body.items === undefined) return [];
  if (!Array.isArray(body.items)) {
    throw ApiError.badRequest('Field "items" must be an array');
  }
  for (const [index, entry] of body.items.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw ApiError.badRequest(`items[${index}] must be an object`);
    }
    requireFields(entry, ['menu_item_id', 'quantity']);
    assertTypes(entry, { menu_item_id: 'string', quantity: 'integer' });
    assertRanges(entry, { quantity: { min: 1, max: config.limits.maxItemQuantity } });
    rejectUnknownFields(entry, ['menu_item_id', 'quantity']);
  }
  return body.items;
}

function mergeDuplicateItems(items) {
  const merged = new Map();
  for (const entry of items) {
    const existing = merged.get(entry.menu_item_id);
    if (existing) {
      existing.quantity += entry.quantity;
    } else {
      merged.set(entry.menu_item_id, { ...entry });
    }
  }
  return [...merged.values()];
}

function assertStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  const allowed = ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.conflict(
      `Cannot change order status from "${currentStatus}" to "${nextStatus}". Allowed: ${
        allowed.length ? allowed.join(', ') : 'none (terminal status)'
      }`,
    );
  }
}

router.get(
  '/',
  asyncHandler((req, res) => {
    const q = parseListQuery(req.query, {
      filters: ORDERS_FILTERS,
      sortableColumns: ORDERS_SORTABLE,
      defaultSort: 'placed_at',
      defaultOrder: 'desc',
    });
    const { rows, total } = fetchPage(getDb(), {
      table: 'orders',
      whereSql: q.where.sql,
      whereParams: q.where.params,
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

export function validateOrderCreateBody(body, { nested }) {
  requireFields(body, nested ? ['customer_name'] : ['restaurant_id', 'customer_name']);
  assertTypes(body, {
    restaurant_id: 'string',
    customer_name: 'string',
    status: 'string',
    delivery_fee: 'number',
    notes: 'text',
    items: 'array',
  });
  assertEnum(body, 'status', ORDER_STATUSES);
  assertRanges(body, { delivery_fee: { min: 0, max: config.limits.maxDeliveryFee } });
  rejectUnknownFields(body, nested ? NESTED_ORDER_CREATE_FIELDS : ORDER_CREATE_FIELDS);
  if (!nested && !isUuid(body.restaurant_id)) {
    throw ApiError.badRequest('Field "restaurant_id" must be a valid UUID');
  }
}

export function createOrder({ restaurantId, body }) {
  const items = mergeDuplicateItems(validateItemsArray(body));
  const db = getDb();

  const restaurant = db.prepare(`SELECT id FROM restaurants WHERE id = ?`).get(restaurantId);
  if (!restaurant) {
    throw ApiError.validation('Field "restaurant_id" does not reference an existing restaurant');
  }
  for (const item of items) {
    assertOrderItemBelongsToRestaurant(item.menu_item_id, restaurant.id);
  }

  const id = randomUuid();
  const timestamp = nowIso();
  const deliveryFee = body.delivery_fee ?? 3.49;

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO orders (id, restaurant_id, customer_name, status, subtotal, delivery_fee, total, notes, placed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
    ).run(
      id,
      restaurantId,
      body.customer_name.trim(),
      body.status ?? 'pending',
      deliveryFee,
      body.notes ?? '',
      timestamp,
      timestamp,
      timestamp,
    );

    for (const item of items) {
      insertOrderItem(db, { orderId: id, body: { ...item, order_id: id }, allowPatch: true });
    }
    recalcOrderTotals(db, id, items.length > 0);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
}

router.post(
  '/',
  asyncHandler((req, res) => {
    const body = assertBodyObject(req);
    validateOrderCreateBody(body, { nested: false });
    res.status(201).json({ data: toOrderDto(createOrder({ restaurantId: body.restaurant_id, body })) });
  }),
);

router.get(
  '/:id',
  asyncHandler((req, res) => {
    res.json({ data: toOrderDto(loadOrder(req.params.id)) });
  }),
);

router.patch(
  '/:id',
  asyncHandler((req, res) => {
    const order = loadOrder(req.params.id);
    const body = assertBodyObject(req);
    rejectUnknownFields(body, ORDER_UPDATE_FIELDS);
    requireAtLeastOneField(body, ORDER_UPDATE_FIELDS);
    assertTypes(body, { status: 'string', customer_name: 'string', notes: 'text' });
    assertEnum(body, 'status', ORDER_STATUSES);
    if (body.status !== undefined) {
      assertStatusTransition(order.status, body.status);
    }

    const data = { ...body };
    if (typeof data.customer_name === 'string') data.customer_name = data.customer_name.trim();
    applyUpdate(getDb(), { table: 'orders', id: req.params.id, data, columns: ORDER_UPDATE_FIELDS });
    res.json({ data: toOrderDto(loadOrder(req.params.id)) });
  }),
);

router.delete(
  '/:id',
  asyncHandler((req, res) => {
    loadOrder(req.params.id);
    getDb().prepare(`DELETE FROM orders WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  }),
);

router.get(
  '/:orderId/items',
  asyncHandler((req, res) => {
    loadOrder(req.params.orderId);
    const q = parseListQuery(req.query, {
      filters: ITEMS_FILTERS,
      sortableColumns: ITEMS_SORTABLE,
      defaultSort: 'created_at',
      defaultOrder: 'asc',
    });
    const orderClause = 'order_id = ?';
    const whereSql = q.where.sql === '1 = 1' ? orderClause : `${orderClause} AND ${q.where.sql}`;
    const whereParams = [req.params.orderId, ...q.where.params];
    const { rows, total } = fetchPage(getDb(), {
      table: 'order_items',
      whereSql,
      whereParams,
      sort: q.sort,
      order: q.order,
      limit: q.limit,
      offset: q.offset,
    });
    res.json({
      data: rows.map(toOrderItemDto),
      meta: buildMeta({ total, limit: q.limit, offset: q.offset }),
    });
  }),
);

router.post(
  '/:orderId/items',
  asyncHandler((req, res) => {
    const order = loadOrder(req.params.orderId);
    const body = assertBodyObject(req);
    requireFields(body, ['menu_item_id', 'quantity']);
    assertTypes(body, { menu_item_id: 'string', quantity: 'integer' });
    assertRanges(body, { quantity: { min: 1, max: config.limits.maxItemQuantity } });
    rejectUnknownFields(body, ['menu_item_id', 'quantity']);
    assertOrderItemBelongsToRestaurant(body.menu_item_id, order.restaurant_id);

    const db = getDb();
    const duplicate = db
      .prepare(`SELECT id FROM order_items WHERE order_id = ? AND menu_item_id = ?`)
      .get(order.id, body.menu_item_id);
    if (duplicate) {
      throw ApiError.conflict(
        'Order already contains this menu item. Patch the existing line\'s quantity instead.',
      );
    }

    db.exec('BEGIN');
    try {
      const row = insertOrderItem(db, { orderId: order.id, body: { ...body, order_id: order.id }, allowPatch: true });
      recalcOrderTotals(db, order.id, true);
      db.exec('COMMIT');
      res.status(201).json({ data: toOrderItemDto(row) });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }),
);

router.get(
  '/:orderId/items/:itemId',
  asyncHandler((req, res) => {
    loadOrder(req.params.orderId);
    if (!isUuid(req.params.itemId)) {
      throw ApiError.badRequest('Path parameter "itemId" must be a valid UUID');
    }
    const row = getDb()
      .prepare(`SELECT * FROM order_items WHERE id = ? AND order_id = ?`)
      .get(req.params.itemId, req.params.orderId);
    if (!row) throw ApiError.notFound('Order item not found');
    res.json({ data: toOrderItemDto(row) });
  }),
);

router.patch(
  '/:orderId/items/:itemId',
  asyncHandler((req, res) => {
    loadOrder(req.params.orderId);
    if (!isUuid(req.params.itemId)) {
      throw ApiError.badRequest('Path parameter "itemId" must be a valid UUID');
    }
    const body = assertBodyObject(req);
    rejectUnknownFields(body, ['quantity']);
    requireAtLeastOneField(body, ['quantity']);
    assertTypes(body, { quantity: 'integer' });
    assertRanges(body, { quantity: { min: 1, max: config.limits.maxItemQuantity } });

    const db = getDb();
    const existing = db
      .prepare(`SELECT * FROM order_items WHERE id = ? AND order_id = ?`)
      .get(req.params.itemId, req.params.orderId);
    if (!existing) throw ApiError.notFound('Order item not found');

    const lineTotal = round2(Number(body.quantity) * Number(existing.unit_price));
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE order_items SET quantity = ?, line_total = ? WHERE id = ?`).run(
        body.quantity,
        lineTotal,
        existing.id,
      );
      recalcOrderTotals(db, req.params.orderId, true);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({
      data: toOrderItemDto(
        db.prepare(`SELECT * FROM order_items WHERE id = ?`).get(existing.id),
      ),
    });
  }),
);

router.delete(
  '/:orderId/items/:itemId',
  asyncHandler((req, res) => {
    loadOrder(req.params.orderId);
    if (!isUuid(req.params.itemId)) {
      throw ApiError.badRequest('Path parameter "itemId" must be a valid UUID');
    }
    const db = getDb();
    const existing = db
      .prepare(`SELECT * FROM order_items WHERE id = ? AND order_id = ?`)
      .get(req.params.itemId, req.params.orderId);
    if (!existing) throw ApiError.notFound('Order item not found');

    db.exec('BEGIN');
    try {
      db.prepare(`DELETE FROM order_items WHERE id = ?`).run(existing.id);
      recalcOrderTotals(db, req.params.orderId, true);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(204).end();
  }),
);

export default router;
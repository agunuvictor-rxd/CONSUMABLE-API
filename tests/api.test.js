import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consumable-api-test-'));

process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.API_BASE_URL = 'http://host.test';

const { createApp } = await import('../src/app.js');
const { resetRateLimiter } = await import('../src/middleware/rateLimiter.js');
const { getDb } = await import('../src/db.js');
const { runSeed } = await import('../scripts/seed.js');
const { round2 } = await import('../src/utils/money.js');

let server;
let baseUrl;

before(async () => {
  runSeed(getDb());
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

async function api(route, options = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  let body = null;
  if (res.status !== 204) body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

async function makeFixture(name, prices) {
  const restaurant = await api('/api/v1/restaurants', {
    method: 'POST',
    body: JSON.stringify({ name, cuisine: 'Test', city: 'Berlin', country: 'Germany' }),
  });
  const restaurantId = restaurant.body.data.id;
  const items = [];
  for (const [itemName, price] of prices) {
    const created = await api(`/api/v1/restaurants/${restaurantId}/menu-items`, {
      method: 'POST',
      body: JSON.stringify({ name: itemName, price, category: 'mains' }),
    });
    items.push(created.body.data);
  }
  return { restaurantId, items };
}

test('GET /api/v1/health returns success envelope', async () => {
  const { status, body } = await api('/api/v1/health');
  assert.equal(status, 200);
  assert.equal(body.data.status, 'ok');
});

test('collection pagination defaults + envelope', async () => {
  const { status, body } = await api('/api/v1/restaurants');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data));
  assert.equal(body.data.length, 20);
  assert.equal(body.meta.limit, 20);
  assert.equal(body.meta.offset, 0);
  assert.equal(body.meta.hasMore, true);
  assert.ok(body.meta.total >= 100);
});

test('limit/offset pagination works', async () => {
  const { body } = await api('/api/v1/restaurants?limit=5&offset=10');
  assert.equal(body.data.length, 5);
  assert.equal(body.meta.offset, 10);
  assert.equal(body.meta.hasMore, true);
});

test('invalid limit/offset return 400', async () => {
  assert.equal((await api('/api/v1/restaurants?limit=0')).status, 400);
  assert.equal((await api('/api/v1/restaurants?limit=200')).status, 400);
  assert.equal((await api('/api/v1/restaurants?limit=abc')).status, 400);
  assert.equal((await api('/api/v1/restaurants?offset=-1')).status, 400);
});

test('sorting works and invalid sort/order return 400', async () => {
  const { body } = await api('/api/v1/restaurants?sort=rating&order=desc&limit=100');
  const ratings = body.data.map((r) => r.rating);
  for (let i = 1; i < ratings.length; i += 1) {
    assert.ok(ratings[i - 1] >= ratings[i]);
  }
  assert.equal((await api('/api/v1/restaurants?sort=bogus')).status, 400);
  assert.equal((await api('/api/v1/restaurants?order=sideways')).status, 400);
});

test('filtering on multiple fields + 400 for unknown params', async () => {
  const { body } = await api('/api/v1/restaurants?cuisine=Italian&limit=100');
  assert.ok(body.data.length >= 0);
  for (const r of body.data) assert.equal(r.cuisine, 'Italian');
  assert.equal((await api('/api/v1/restaurants?frobnicate=1')).status, 400);
  assert.equal((await api('/api/v1/restaurants?is_open=maybe')).status, 400);
});

test('single restaurant by id + 404 for missing + 400 for malformed id', async () => {
  const list = await api('/api/v1/restaurants?limit=1');
  const id = list.body.data[0].id;
  const { status, body } = await api(`/api/v1/restaurants/${id}`);
  assert.equal(status, 200);
  assert.equal(body.data.id, id);
  assert.ok(/^[0-9a-f-]{36}$/i.test(id));

  const missing = await api('/api/v1/restaurants/00000000-0000-4000-8000-000000000000');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const malformed = await api('/api/v1/restaurants/not-a-uuid');
  assert.equal(malformed.status, 400);
});

test('POST restaurant: 201 create + envelopes', async () => {
  const { status, body } = await api('/api/v1/restaurants', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Kitchen',
      cuisine: 'Italian',
      city: 'Rome',
      country: 'Italy',
      rating: 4.5,
      is_open: true,
    }),
  });
  assert.equal(status, 201);
  assert.equal(body.data.name, 'Test Kitchen');
  assert.equal(body.data.is_open, true);
});

test('POST restaurant missing required fields returns 422', async () => {
  const { status, body } = await api('/api/v1/restaurants', {
    method: 'POST',
    body: JSON.stringify({ cuisine: 'Italian' }),
  });
  assert.equal(status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('PATCH restaurant: update + 422 empty + 400 unknown field', async () => {
  const { body } = await api('/api/v1/restaurants?limit=1');
  const id = body.data[0].id;
  const patched = await api(`/api/v1/restaurants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_open: false }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.is_open, false);

  const empty = await api(`/api/v1/restaurants/${id}`, { method: 'PATCH', body: JSON.stringify({}) });
  assert.equal(empty.status, 422);

  const unknown = await api(`/api/v1/restaurants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ hacker: true }),
  });
  assert.equal(unknown.status, 400);
});

test('nested menu-items collection + nested create', async () => {
  const { body } = await api('/api/v1/restaurants?limit=1');
  const restaurantId = body.data[0].id;

  const nested = await api(`/api/v1/restaurants/${restaurantId}/menu-items`);
  assert.equal(nested.status, 200);
  assert.ok(Array.isArray(nested.body.data));
  for (const item of nested.body.data) assert.equal(item.restaurant_id, restaurantId);

  const created = await api(`/api/v1/restaurants/${restaurantId}/menu-items`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Margherita Pizza', price: 12.5, category: 'mains' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.restaurant_id, restaurantId);

  const missingName = await api(`/api/v1/restaurants/${restaurantId}/menu-items`, {
    method: 'POST',
    body: JSON.stringify({ price: 12.5 }),
  });
  assert.equal(missingName.status, 422);
});

test('POST order computes totals + nested order items CRUD', async () => {
  const { body } = await api('/api/v1/restaurants?limit=1');
  const restaurantId = body.data[0].id;
  const menuList = await api(`/api/v1/restaurants/${restaurantId}/menu-items?is_available=true`);
  const item = menuList.body.data[0];

  const created = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Ada Lovelace',
      items: [{ menu_item_id: item.id, quantity: 2 }],
    }),
  });
  assert.equal(created.status, 201);
  const order = created.body.data;
  assert.equal(order.subtotal, Number((item.price * 2).toFixed(2)));
  assert.equal(order.total, Number((order.subtotal + order.delivery_fee).toFixed(2)));

  const lines = await api(`/api/v1/orders/${order.id}/items`);
  assert.equal(lines.status, 200);
  assert.ok(lines.body.meta.total >= 1);
  for (const line of lines.body.data) assert.equal(line.order_id, order.id);

  const patched = await api(`/api/v1/orders/${order.id}/items/${lines.body.data[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity: 3 }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.quantity, 3);

  const del = await api(`/api/v1/orders/${order.id}/items/${lines.body.data[0].id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
});

test('POST order missing required field returns 422', async () => {
  const { status, body } = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({ status: 'pending' }),
  });
  assert.equal(status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('DELETE restaurant with orders returns 409', async () => {
  const { body } = await api('/api/v1/orders?limit=1');
  const restaurantId = body.data[0].restaurant_id;
  const del = await api(`/api/v1/restaurants/${restaurantId}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  assert.equal(del.body.error.code, 'CONFLICT');
});

test('unknown route returns JSON 404 envelope', async () => {
  const { status, body } = await api('/api/v1/nope');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('malformed JSON body returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/v1/restaurants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'BAD_REQUEST');
});

test('seed is idempotent (no duplicates on second run)', async () => {
  const db = getDb();
  const snapshot = () =>
    ['restaurants', 'menu_items', 'orders', 'order_items'].map((t) =>
      Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c),
    );
  const beforeRun = snapshot();
  const result = runSeed(db);
  const afterRun = snapshot();
  assert.deepEqual(afterRun, beforeRun);
  assert.deepEqual(
    [result.restaurants, result.menuItems, result.orders, result.orderItems],
    beforeRun,
  );
});

test('order subtotal and total are rounded to 2 decimals', async () => {
  const { restaurantId, items } = await makeFixture('Rounding Cafe', [
    ['Tenth', 0.1],
    ['Fifth', 0.2],
  ]);

  const order = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Float Probe',
      items: [
        { menu_item_id: items[0].id, quantity: 1 },
        { menu_item_id: items[1].id, quantity: 1 },
      ],
    }),
  });

  assert.equal(order.status, 201);
  assert.equal(order.body.data.subtotal, 0.3);
  assert.equal(order.body.data.total, 3.79);
});

test('duplicate menu_item_id entries merge into one order line', async () => {
  const { restaurantId, items } = await makeFixture('Merge Cafe', [['Standard Plate', 10]]);

  const order = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Merge Probe',
      items: [
        { menu_item_id: items[0].id, quantity: 1 },
        { menu_item_id: items[0].id, quantity: 2 },
      ],
    }),
  });

  assert.equal(order.status, 201);
  assert.equal(order.body.data.subtotal, 30);

  const lines = await api(`/api/v1/orders/${order.body.data.id}/items`);
  assert.equal(lines.body.meta.total, 1);
  assert.equal(lines.body.data[0].quantity, 3);
  assert.equal(lines.body.data[0].line_total, 30);
});

test('POST order item returns 409 when the menu item is already on the order', async () => {
  const { restaurantId, items } = await makeFixture('Dup Line Cafe', [['Only Plate', 5]]);

  const order = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Dup Line Probe',
      items: [{ menu_item_id: items[0].id, quantity: 1 }],
    }),
  });
  assert.equal(order.status, 201);

  const duplicate = await api(`/api/v1/orders/${order.body.data.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ menu_item_id: items[0].id, quantity: 5 }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'CONFLICT');

  const lines = await api(`/api/v1/orders/${order.body.data.id}/items`);
  assert.equal(lines.body.meta.total, 1);
});

test('order status transitions are enforced', async () => {
  const { restaurantId, items } = await makeFixture('Transition Cafe', [['Soup', 4]]);

  const order = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Transition Probe',
      items: [{ menu_item_id: items[0].id, quantity: 1 }],
    }),
  });
  const orderId = order.body.data.id;
  assert.equal(order.body.data.status, 'pending');

  const confirmed = await api(`/api/v1/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(confirmed.status, 200);

  const sameStatus = await api(`/api/v1/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(sameStatus.status, 200);

  const skippingAhead = await api(`/api/v1/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'delivered' }),
  });
  assert.equal(skippingAhead.status, 409);
  assert.equal(skippingAhead.body.error.code, 'CONFLICT');

  const cancelled = await api(`/api/v1/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(cancelled.status, 200);

  const revived = await api(`/api/v1/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'out_for_delivery' }),
  });
  assert.equal(revived.status, 409);
  assert.equal(revived.body.data ?? revived.body.error.code, 'CONFLICT');
});

test('nested POST /restaurants/:id/orders creates an order', async () => {
  const { restaurantId, items } = await makeFixture('Nested Order Cafe', [['Nested Plate', 10]]);

  const created = await api(`/api/v1/restaurants/${restaurantId}/orders`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Nested Probe',
      items: [{ menu_item_id: items[0].id, quantity: 2 }],
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.restaurant_id, restaurantId);
  assert.equal(created.body.data.status, 'pending');
  assert.equal(created.body.data.subtotal, 20);
  assert.equal(created.body.data.total, 23.49);

  const rejectsRestaurantId = await api(`/api/v1/restaurants/${restaurantId}/orders`, {
    method: 'POST',
    body: JSON.stringify({ restaurant_id: restaurantId, customer_name: 'Nested Probe' }),
  });
  assert.equal(rejectsRestaurantId.status, 400);

  const missingName = await api(`/api/v1/restaurants/${restaurantId}/orders`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(missingName.status, 422);
});

test('round2 throws on non-finite input instead of returning 0', () => {
  assert.equal(round2(0), 0);
  assert.equal(round2(19.99), 19.99);
  assert.equal(round2(10 / 3), 3.33);
  assert.equal(round2(0.1 + 0.2), 0.3);

  assert.throws(() => round2(Infinity), TypeError);
  assert.throws(() => round2(-Infinity), TypeError);
  assert.throws(() => round2(NaN), TypeError);
  assert.throws(() => round2(undefined), TypeError);
  assert.throws(() => round2(null), TypeError);
  assert.throws(() => round2('12.5'), TypeError);
});

test('out-of-range money and quantity values are rejected with 400', async () => {
  const restaurant = await api('/api/v1/restaurants', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bounds Cafe', cuisine: 'Test', city: 'Berlin', country: 'Germany' }),
  });
  const restaurantId = restaurant.body.data.id;

  const hugePrice = await api(`/api/v1/restaurants/${restaurantId}/menu-items`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Overflow Plate', price: 1e308, category: 'mains' }),
  });
  assert.equal(hugePrice.status, 400);
  assert.equal(hugePrice.body.error.code, 'BAD_REQUEST');

  const item = await api(`/api/v1/restaurants/${restaurantId}/menu-items`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Bounded Plate', price: 12.5, category: 'mains' }),
  });
  assert.equal(item.status, 201);

  const hugeQuantity = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Bounds Probe',
      items: [{ menu_item_id: item.body.data.id, quantity: 1e308 }],
    }),
  });
  assert.equal(hugeQuantity.status, 400);
  assert.equal(hugeQuantity.body.error.code, 'BAD_REQUEST');

  const hugeFee = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Bounds Probe',
      delivery_fee: 1e308,
      items: [{ menu_item_id: item.body.data.id, quantity: 1 }],
    }),
  });
  assert.equal(hugeFee.status, 400);

  const accepted = await api('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      restaurant_id: restaurantId,
      customer_name: 'Bounds Probe',
      items: [{ menu_item_id: item.body.data.id, quantity: 2 }],
    }),
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.data.subtotal, 25);
});

test('rate limiting returns 429 with Retry-After', async () => {
  resetRateLimiter();
  for (let i = 0; i < 100; i += 1) {
    const { status } = await api('/api/v1/health');
    assert.notEqual(status, 429);
  }
  const { status, headers } = await api('/api/v1/health');
  assert.equal(status, 429);
  assert.ok(Number(headers.get('retry-after')) >= 1);
  assert.equal(headers.get('x-ratelimit-remaining'), '0');
});

test('error envelope is consistent', async () => {
  const { body } = await api('/api/v1/restaurants/00000000-0000-4000-8000-000000000000');
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
});
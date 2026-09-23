import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { faker } from '@faker-js/faker';
import { config } from '../src/config.js';
import { getDb } from '../src/db.js';
import { uuidFromKey } from '../src/utils/ids.js';
import { nowIso } from '../src/repositories/common.js';

export const CUISINES = [
  'Italian',
  'Japanese',
  'Mexican',
  'Thai',
  'Indian',
  'French',
  'Greek',
  'Chinese',
  'Korean',
  'American',
  'Spanish',
  'Vietnamese',
];

export const CITIES = [
  'San Francisco',
  'London',
  'Berlin',
  'Tokyo',
  'Madrid',
  'Bangkok',
  'Mumbai',
  'New York',
  'Paris',
  'Seoul',
  'Lisbon',
  'Chicago',
];

export const CATEGORIES = ['appetizers', 'mains', 'sides', 'desserts', 'drinks'];

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
];

function key(parts) {
  return parts.join(':');
}

function pastIso(maxDaysAgo) {
  return new Date(Date.now() - faker.number.int({ min: 1, max: maxDaysAgo }) * 86_400_000).toISOString();
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function runInTransaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Idempotent seed: every row gets a deterministic UUID derived from a
 * logical key, then is INSERTed with ON CONFLICT(id) DO UPDATE. Running the
 * script any number of times yields the exact same rows, never duplicates.
 */
export function runSeed(db = getDb()) {
  faker.seed(20260923);
  const counts = config.seed.counts;
  const now = nowIso();

  const restaurantIds = [];
  const menuItemIds = [];

  return runInTransaction(db, () => {
    for (let i = 0; i < counts.restaurants; i += 1) {
      const name = faker.company.name();
      const cuisine = faker.helpers.arrayElement(CUISINES);
      const city = faker.helpers.arrayElement(CITIES);
      const country = faker.location.country();
      const id = uuidFromKey(key(['restaurant', i]));
      const slug = `${slugify(name)}-${i}`;
      const rating = faker.number.float({ min: 2.5, max: 5, fractionDigits: 1 });
      const priceRange = faker.number.int({ min: 1, max: 4 });
      const isOpen = faker.datatype.boolean();

      db.prepare(
        `INSERT INTO restaurants (id, name, slug, cuisine, city, country, phone, rating, price_range, is_open, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           slug = excluded.slug,
           cuisine = excluded.cuisine,
           city = excluded.city,
           country = excluded.country,
           phone = excluded.phone,
           rating = excluded.rating,
           price_range = excluded.price_range,
           is_open = excluded.is_open,
           updated_at = excluded.updated_at`,
      ).run(
        id,
        name,
        slug,
        cuisine,
        city,
        country,
        faker.phone.number(),
        rating,
        priceRange,
        isOpen ? 1 : 0,
        pastIso(400),
        now,
      );
      restaurantIds.push(id);

      for (let j = 0; j < counts.menuItemsPerRestaurant; j += 1) {
        const itemName = faker.commerce.productName();
        const category = faker.helpers.arrayElement(CATEGORIES);
        const price = faker.number.float({ min: 4, max: 36, fractionDigits: 2 });
        const menuId = uuidFromKey(key(['menu', i, j]));

        db.prepare(
          `INSERT INTO menu_items (id, restaurant_id, name, description, category, price, is_available, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             restaurant_id = excluded.restaurant_id,
             name = excluded.name,
             description = excluded.description,
             category = excluded.category,
             price = excluded.price,
             is_available = excluded.is_available,
             updated_at = excluded.updated_at`,
        ).run(
          menuId,
          id,
          itemName,
          faker.lorem.sentence({ min: 3, max: 8 }),
          category,
          price,
          faker.datatype.boolean() ? 1 : 0,
          pastIso(400),
          now,
        );
        menuItemIds.push(menuId);
      }
    }

    for (let i = 0; i < counts.orders; i += 1) {
      const orderId = uuidFromKey(key(['order', i]));
      const restaurantId = faker.helpers.arrayElement(restaurantIds);
      const placedAt = pastIso(90);
      let subtotal = 0;

      db.prepare(
        `INSERT INTO orders (id, restaurant_id, customer_name, status, subtotal, delivery_fee, total, notes, placed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           restaurant_id = excluded.restaurant_id,
           customer_name = excluded.customer_name,
           status = excluded.status,
           delivery_fee = excluded.delivery_fee,
           notes = excluded.notes,
           placed_at = excluded.placed_at,
           updated_at = excluded.updated_at`,
      ).run(
        orderId,
        restaurantId,
        faker.person.fullName(),
        faker.helpers.arrayElement(ORDER_STATUSES),
        faker.number.float({ min: 2, max: 7, fractionDigits: 2 }),
        faker.lorem.sentence({ min: 2, max: 6 }),
        placedAt,
        pastIso(90),
        now,
      );

      const lineCount = faker.number.int({
        min: counts.orderItemsPerOrderMin,
        max: counts.orderItemsPerOrderMax,
      });

      for (let k = 0; k < lineCount; k += 1) {
        const menuItemId = faker.helpers.arrayElement(menuItemIds);
        const menuItem = db
          .prepare(`SELECT name, price FROM menu_items WHERE id = ?`)
          .get(menuItemId);
        const itemId = uuidFromKey(key(['order_item', i, k]));
        const quantity = faker.number.int({ min: 1, max: 5 });
        const lineTotal = Number((menuItem.price * quantity).toFixed(2));
        subtotal += lineTotal;

        db.prepare(
          `INSERT INTO order_items (id, order_id, menu_item_id, item_name, quantity, unit_price, line_total, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             order_id = excluded.order_id,
             menu_item_id = excluded.menu_item_id,
             item_name = excluded.item_name,
             quantity = excluded.quantity,
             unit_price = excluded.unit_price,
             line_total = excluded.line_total`,
        ).run(
          itemId,
          orderId,
          menuItemId,
          menuItem.name,
          quantity,
          menuItem.price,
          lineTotal,
          pastIso(90),
        );
      }

      const deliveryFee = Number(db.prepare(`SELECT delivery_fee FROM orders WHERE id = ?`).get(orderId).delivery_fee);
      db.prepare(`UPDATE orders SET subtotal = ?, total = ? WHERE id = ?`).run(
        Number(subtotal.toFixed(2)),
        Number((subtotal + deliveryFee).toFixed(2)),
        orderId,
      );
    }

    const totals = {
      restaurants: Number(db.prepare(`SELECT COUNT(*) AS c FROM restaurants`).get().c),
      menuItems: Number(db.prepare(`SELECT COUNT(*) AS c FROM menu_items`).get().c),
      orders: Number(db.prepare(`SELECT COUNT(*) AS c FROM orders`).get().c),
      orderItems: Number(db.prepare(`SELECT COUNT(*) AS c FROM order_items`).get().c),
    };

    return totals;
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = runSeed(getDb());
  console.log('Seed complete (upsert, safe to re-run):');
  console.log(result);
}
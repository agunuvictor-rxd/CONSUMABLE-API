export function fetchPage(db, { table, columns = '*', whereSql, whereParams = [], sort, order, limit, offset }) {
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${whereSql}`)
    .get(...whereParams);
  const total = Number(totalRow?.c ?? 0);
  const rows = db
    .prepare(
      `SELECT ${columns} FROM ${table} WHERE ${whereSql} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
    )
    .all(...whereParams, limit, offset);
  return { rows, total };
}

export function fetchCount(db, { table, whereSql, whereParams = [] }) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${whereSql}`).get(...whereParams);
  return Number(row?.c ?? 0);
}

export function applyUpdate(db, { table, id, data, columns, touchUpdated = true }) {
  const sets = [];
  const params = [];
  for (const column of columns) {
    if (data[column] === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(data[column]);
  }
  if (sets.length === 0) return 0;
  if (touchUpdated) {
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
  }
  params.push(id);
  const result = db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return Number(result.changes ?? 0);
}

export function nowIso() {
  return new Date().toISOString();
}

// Identifiers/order expressions are internal constants, never request input.
// An omitted selection reads nothing; true explicitly requests the collection.
export function readRows(db, table, ids, { column = "id", order = "" } = {}) {
  if (ids !== true && !ids?.length) return [];
  const where = ids === true ? "" : ` WHERE ${column} IN (SELECT value FROM json_each(?))`;
  const statement = db.prepare(`SELECT * FROM ${table}${where}${order ? ` ORDER BY ${order}` : ""}`);
  return ids === true ? statement.all() : statement.all(JSON.stringify([...new Set(ids)]));
}

export function mergeIds(...selections) {
  return selections.includes(true) ? true : [...new Set(selections.flat().filter(Boolean))];
}

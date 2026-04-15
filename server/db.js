// Database PostgreSQL (Neon) per persistenza dati tra riavvii del server.
// Usa pg (node-postgres) con Pool di connessioni.
// Strategia: write-through cache — i dati restano in memoria per velocità,
// ma ogni modifica viene scritta anche su DB per persistenza.

const { Pool } = require('pg');

// Rimuove sslmode dall'URL per evitare il warning di pg-connection-string.
// L'SSL è gestito esplicitamente tramite l'opzione ssl del Pool.
const dbUrl = new URL(process.env.DATABASE_URL || '');
dbUrl.searchParams.delete('sslmode');

const pool = new Pool({
  connectionString: dbUrl.toString(),
  ssl: { rejectUnauthorized: false }, // Neon usa SSL con certificato CA valido
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log degli errori di connessione inattese (quando il pool è idle)
pool.on('error', (err) => {
  console.error('[DB] Errore pool PostgreSQL:', err.message);
});

// =============================================
// CREAZIONE TABELLE (idempotente — IF NOT EXISTS)
// =============================================

async function createTables() {
  // Eseguiamo le CREATE TABLE separatamente per compatibilità con pg
  const queries = [
    `CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY,
      table_num      INTEGER NOT NULL,
      items          TEXT NOT NULL,
      subtotal       DOUBLE PRECISION NOT NULL DEFAULT 0,
      total          DOUBLE PRECISION NOT NULL DEFAULT 0,
      discount       DOUBLE PRECISION NOT NULL DEFAULT 0,
      discount_type  TEXT,
      discount_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      courtesy_type  TEXT,
      customer_name  TEXT,
      cassa          TEXT NOT NULL DEFAULT 'principale',
      coperti        INTEGER NOT NULL DEFAULT 0,
      asporto        INTEGER NOT NULL DEFAULT 0,
      payment        TEXT NOT NULL DEFAULT 'contanti',
      status         TEXT NOT NULL DEFAULT 'in_progress',
      created_at     BIGINT NOT NULL,
      completed_at   BIGINT,
      cancelled_at   BIGINT
    )`,

    `CREATE TABLE IF NOT EXISTS counters (
      item    TEXT PRIMARY KEY,
      pronto  INTEGER NOT NULL DEFAULT 0,
      vendute INTEGER NOT NULL DEFAULT 0,
      evasi   INTEGER NOT NULL DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS inventory (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      station         TEXT NOT NULL,
      price           DOUBLE PRECISION NOT NULL,
      category        TEXT NOT NULL,
      stock           INTEGER NOT NULL DEFAULT 999,
      initial_stock   INTEGER NOT NULL DEFAULT 999,
      alert_threshold INTEGER NOT NULL DEFAULT 20,
      status          TEXT NOT NULL DEFAULT 'available'
    )`,

    `CREATE TABLE IF NOT EXISTS archived_sessions (
      id        TEXT PRIMARY KEY,
      date      TEXT NOT NULL,
      closed_at BIGINT NOT NULL,
      recap     TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS inventory_presets (
      name     TEXT PRIMARY KEY,
      stocks   TEXT NOT NULL,
      saved_at BIGINT NOT NULL
    )`,

    // category e updated_at aggiunti rispetto alla versione SQLite
    `CREATE TABLE IF NOT EXISTS warehouse (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      quantity        INTEGER NOT NULL DEFAULT 0,
      total           INTEGER NOT NULL DEFAULT 0,
      alert_threshold INTEGER,
      category        TEXT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT
    )`,

    // sort_order SERIAL preserva l'ordine di inserimento (PostgreSQL non garantisce ordine senza ORDER BY)
    `CREATE TABLE IF NOT EXISTS menu_items (
      sort_order      SERIAL,
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      price           DOUBLE PRECISION NOT NULL,
      category        TEXT NOT NULL,
      station         TEXT NOT NULL,
      print_to        TEXT NOT NULL DEFAULT '["cibo"]',
      composition     TEXT,
      special         INTEGER NOT NULL DEFAULT 0,
      available_date  TEXT,
      initial_stock   INTEGER NOT NULL DEFAULT 100,
      alert_threshold INTEGER NOT NULL DEFAULT 10,
      available       INTEGER NOT NULL DEFAULT 1,
      casses          TEXT NOT NULL DEFAULT '["cassa_generale"]'
    )`,

    // Sessioni admin — persistono tra riavvii server/deploy
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token      TEXT PRIMARY KEY,
      role       TEXT NOT NULL,
      created    BIGINT NOT NULL,
      expires    BIGINT NOT NULL
    )`,
  ];

  for (const q of queries) {
    await pool.query(q);
  }
}

// =============================================
// FUNZIONI HELPER ESPORTATE (tutte async — restituiscono Promise)
// =============================================

// --- Meta / orderCounter ---

async function getOrderCounter() {
  const { rows } = await pool.query('SELECT value FROM meta WHERE key = $1', ['orderCounter']);
  return rows.length > 0 ? parseInt(rows[0].value, 10) : 0;
}

async function setOrderCounter(n) {
  await pool.query(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['orderCounter', String(n)]
  );
}

// --- Orders ---

// Converte una riga DB nel formato usato in memoria da api.js
function rowToOrder(row) {
  return {
    id: row.id,
    table: row.table_num,
    items: JSON.parse(row.items),
    subtotal: parseFloat(row.subtotal),
    total: parseFloat(row.total),
    discount: parseFloat(row.discount),
    discount_type: row.discount_type,
    discount_value: parseFloat(row.discount_value),
    courtesy_type: row.courtesy_type,
    customer_name: row.customer_name,
    cassa: row.cassa,
    coperti: row.coperti,
    asporto: !!row.asporto,
    payment: row.payment,
    status: row.status,
    created_at: parseInt(row.created_at),
    completed_at: row.completed_at ? parseInt(row.completed_at) : null,
    cancelled_at: row.cancelled_at ? parseInt(row.cancelled_at) : null,
  };
}

async function getAllOrders() {
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY id ASC');
  return rows.map(rowToOrder);
}

async function insertOrder(order) {
  await pool.query(
    `INSERT INTO orders (id, table_num, items, subtotal, total, discount, discount_type,
       discount_value, courtesy_type, customer_name, cassa, coperti, asporto, payment,
       status, created_at, completed_at, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      order.id, order.table, JSON.stringify(order.items),
      order.subtotal || 0, order.total, order.discount || 0,
      order.discount_type || null, order.discount_value || 0,
      order.courtesy_type || null, order.customer_name || null,
      order.cassa || 'principale', order.coperti || 0,
      order.asporto ? 1 : 0, order.payment || 'contanti',
      order.status || 'in_progress', order.created_at,
      order.completed_at || null, order.cancelled_at || null,
    ]
  );
}

async function updateOrderStatus(id, status, completedAt, cancelledAt) {
  await pool.query(
    'UPDATE orders SET status = $1, completed_at = $2, cancelled_at = $3 WHERE id = $4',
    [status, completedAt || null, cancelledAt || null, id]
  );
}

async function deleteAllOrders() {
  await pool.query('DELETE FROM orders');
}

// --- Counters ---

async function getCounters() {
  const { rows } = await pool.query('SELECT * FROM counters');
  const result = {};
  rows.forEach(row => {
    result[row.item] = { pronto: row.pronto, vendute: row.vendute, evasi: row.evasi };
  });
  return result;
}

async function saveCounter(item, data) {
  await pool.query(
    `INSERT INTO counters (item, pronto, vendute, evasi) VALUES ($1, $2, $3, $4)
     ON CONFLICT (item) DO UPDATE SET
       pronto = EXCLUDED.pronto, vendute = EXCLUDED.vendute, evasi = EXCLUDED.evasi`,
    [item, data.pronto, data.vendute, data.evasi]
  );
}

// Inizializza i contatori se non esistono ancora nel DB
async function seedCounters(monitorItems) {
  for (const item of monitorItems) {
    await pool.query(
      `INSERT INTO counters (item, pronto, vendute, evasi) VALUES ($1, 0, 0, 0)
       ON CONFLICT (item) DO NOTHING`,
      [item]
    );
  }
}

async function resetCounters() {
  await pool.query('UPDATE counters SET pronto = 0, vendute = 0, evasi = 0');
}

// --- Inventory (scorte piatti menu) ---

async function getInventory() {
  const { rows } = await pool.query('SELECT * FROM inventory');
  const result = {};
  rows.forEach(row => { result[row.id] = { ...row }; });
  return result;
}

async function saveInventoryItem(item) {
  await pool.query(
    `INSERT INTO inventory (id, name, station, price, category, stock, initial_stock, alert_threshold, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, station = EXCLUDED.station, price = EXCLUDED.price,
       category = EXCLUDED.category, stock = EXCLUDED.stock,
       initial_stock = EXCLUDED.initial_stock, alert_threshold = EXCLUDED.alert_threshold,
       status = EXCLUDED.status`,
    [
      item.id, item.name, item.station, item.price, item.category,
      item.stock, item.initial_stock, item.alert_threshold, item.status,
    ]
  );
}

async function updateInventoryStock(id, stock, status) {
  await pool.query(
    'UPDATE inventory SET stock = $1, status = $2 WHERE id = $3',
    [stock, status, id]
  );
}

async function deleteInventoryItem(id) {
  await pool.query('DELETE FROM inventory WHERE id = $1', [id]);
}

// Inizializza l'inventario dal menu di config.js se il DB è vuoto o ha piatti nuovi
async function seedInventory(menuItems) {
  for (const item of menuItems) {
    await pool.query(
      `INSERT INTO inventory (id, name, station, price, category, stock, initial_stock, alert_threshold, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        item.id, item.name, item.station, item.price, item.category,
        item.initial_stock || 999, item.initial_stock || 999,
        item.alert_threshold || 20, 'available',
      ]
    );
  }
}

// --- Archived Sessions ---

async function getArchivedSessions() {
  const { rows } = await pool.query('SELECT * FROM archived_sessions ORDER BY closed_at DESC');
  return rows.map(row => ({
    id: row.id,
    date: row.date,
    closed_at: parseInt(row.closed_at),
    recap: JSON.parse(row.recap),
  }));
}

async function getArchivedSessionByDate(date) {
  const { rows } = await pool.query('SELECT * FROM archived_sessions WHERE date = $1', [date]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    date: row.date,
    closed_at: parseInt(row.closed_at),
    recap: JSON.parse(row.recap),
  };
}

async function insertArchivedSession(session) {
  await pool.query(
    'INSERT INTO archived_sessions (id, date, closed_at, recap) VALUES ($1, $2, $3, $4)',
    [session.id, session.date, session.closed_at, JSON.stringify(session.recap)]
  );
}

async function deleteArchivedSession(id) {
  await pool.query('DELETE FROM archived_sessions WHERE id = $1', [id]);
}

async function updateArchivedSession(id, closedAt, recap) {
  await pool.query(
    'UPDATE archived_sessions SET closed_at = $1, recap = $2 WHERE id = $3',
    [closedAt, JSON.stringify(recap), id]
  );
}

// --- Inventory Presets ---

async function getPresets() {
  const { rows } = await pool.query('SELECT * FROM inventory_presets');
  const result = {};
  rows.forEach(row => {
    result[row.name] = { name: row.name, stocks: JSON.parse(row.stocks), saved_at: parseInt(row.saved_at) };
  });
  return result;
}

async function savePreset(name, stocks, savedAt) {
  await pool.query(
    `INSERT INTO inventory_presets (name, stocks, saved_at) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET stocks = EXCLUDED.stocks, saved_at = EXCLUDED.saved_at`,
    [name, JSON.stringify(stocks), savedAt]
  );
}

async function deletePreset(name) {
  await pool.query('DELETE FROM inventory_presets WHERE name = $1', [name]);
}

// --- Menu Items ---

// Converte una riga DB nel formato usato in memoria (JSON parse dei campi serializzati)
function dbRowToMenuItem(row) {
  const item = {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    category: row.category,
    station: row.station,
    print_to: JSON.parse(row.print_to),
    initial_stock: row.initial_stock,
    alert_threshold: row.alert_threshold,
    available: !!row.available,
    casses: JSON.parse(row.casses),
  };
  if (row.composition) item.composition = JSON.parse(row.composition);
  if (row.special) item.special = true;
  if (row.available_date) item.available_date = row.available_date;
  return item;
}

async function getMenuItems() {
  // sort_order SERIAL preserva l'ordine di inserimento originale
  const { rows } = await pool.query('SELECT * FROM menu_items ORDER BY sort_order ASC');
  return rows.map(dbRowToMenuItem);
}

async function saveMenuItem(item) {
  await pool.query(
    `INSERT INTO menu_items (id, name, price, category, station, print_to,
       composition, special, available_date, initial_stock, alert_threshold, available, casses)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, price = EXCLUDED.price, category = EXCLUDED.category,
       station = EXCLUDED.station, print_to = EXCLUDED.print_to,
       composition = EXCLUDED.composition, special = EXCLUDED.special,
       available_date = EXCLUDED.available_date, initial_stock = EXCLUDED.initial_stock,
       alert_threshold = EXCLUDED.alert_threshold, available = EXCLUDED.available,
       casses = EXCLUDED.casses`,
    [
      item.id, item.name, item.price, item.category, item.station,
      JSON.stringify(item.print_to || ['cibo']),
      item.composition ? JSON.stringify(item.composition) : null,
      item.special ? 1 : 0,
      item.available_date || null,
      item.initial_stock || 100,
      item.alert_threshold || 10,
      item.available !== false ? 1 : 0,
      JSON.stringify(item.casses || ['cassa_generale']),
    ]
  );
}

async function deleteMenuItem(id) {
  await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
}

// --- Warehouse (materiali e consumabili) ---

async function getWarehouse() {
  const { rows } = await pool.query('SELECT * FROM warehouse ORDER BY name ASC');
  const result = {};
  rows.forEach(row => {
    result[row.id] = {
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      total: row.total,
      alert_threshold: row.alert_threshold,
      category: row.category,
      created_at: parseInt(row.created_at),
      updated_at: row.updated_at ? parseInt(row.updated_at) : null,
    };
  });
  return result;
}

async function saveWarehouseItem(item) {
  await pool.query(
    `INSERT INTO warehouse (id, name, quantity, total, alert_threshold, category, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, quantity = EXCLUDED.quantity, total = EXCLUDED.total,
       alert_threshold = EXCLUDED.alert_threshold, category = EXCLUDED.category,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.name, item.quantity || 0, item.total || 0,
      item.alert_threshold || null, item.category || null,
      item.created_at, item.updated_at || null,
    ]
  );
}

async function updateWarehouseQty(id, quantity) {
  await pool.query(
    'UPDATE warehouse SET quantity = $1, updated_at = $2 WHERE id = $3',
    [quantity, Date.now(), id]
  );
}

async function deleteWarehouseItem(id) {
  await pool.query('DELETE FROM warehouse WHERE id = $1', [id]);
}

// --- Admin Sessions (persistenza tra riavvii) ---

async function insertAdminSession(token, role, created, expires) {
  await pool.query(
    `INSERT INTO admin_sessions (token, role, created, expires) VALUES ($1, $2, $3, $4)
     ON CONFLICT (token) DO NOTHING`,
    [token, role, created, expires]
  );
}

async function loadAdminSessions() {
  const { rows } = await pool.query(
    'SELECT token, role, created, expires FROM admin_sessions WHERE expires > $1',
    [Date.now()]
  );
  return rows;
}

async function deleteAdminSession(token) {
  await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
}

async function cleanExpiredAdminSessions() {
  await pool.query('DELETE FROM admin_sessions WHERE expires <= $1', [Date.now()]);
}

// =============================================
// EXPORT
// =============================================

module.exports = {
  createTables,
  // Meta
  getOrderCounter, setOrderCounter,
  // Orders
  getAllOrders, insertOrder, updateOrderStatus, deleteAllOrders,
  // Counters
  getCounters, saveCounter, seedCounters, resetCounters,
  // Inventory
  getInventory, saveInventoryItem, updateInventoryStock, deleteInventoryItem, seedInventory,
  // Archived Sessions
  getArchivedSessions, getArchivedSessionByDate, insertArchivedSession, updateArchivedSession, deleteArchivedSession,
  // Presets
  getPresets, savePreset, deletePreset,
  // Warehouse (materiali/consumabili)
  getWarehouse, saveWarehouseItem, updateWarehouseQty, deleteWarehouseItem,
  // Menu Items (persistenza menu piatti)
  getMenuItems, saveMenuItem, deleteMenuItem,
  // Admin Sessions (persistenza tra riavvii)
  insertAdminSession, loadAdminSessions, deleteAdminSession, cleanExpiredAdminSessions,
};

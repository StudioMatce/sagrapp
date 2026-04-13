// Database SQLite per persistenza dati tra riavvii del server.
// Usa better-sqlite3 (sincrono, veloce, perfetto per server singolo).
// Strategia: write-through cache — i dati restano in memoria per velocità,
// ma ogni modifica viene scritta anche su DB per persistenza.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Crea la cartella data/ se non esiste (es. primo deploy su Railway)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'sagrapp.db');
const db = new Database(DB_PATH);

// WAL mode: più veloce per letture concorrenti e crash-safe
db.pragma('journal_mode = WAL');

// =============================================
// CREAZIONE TABELLE
// =============================================

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY,
    table_num      INTEGER NOT NULL,
    items          TEXT NOT NULL,
    subtotal       REAL NOT NULL DEFAULT 0,
    total          REAL NOT NULL DEFAULT 0,
    discount       REAL NOT NULL DEFAULT 0,
    discount_type  TEXT,
    discount_value REAL NOT NULL DEFAULT 0,
    courtesy_type  TEXT,
    customer_name  TEXT,
    cassa          TEXT NOT NULL DEFAULT 'principale',
    coperti        INTEGER NOT NULL DEFAULT 0,
    asporto        INTEGER NOT NULL DEFAULT 0,
    payment        TEXT NOT NULL DEFAULT 'contanti',
    status         TEXT NOT NULL DEFAULT 'in_progress',
    created_at     INTEGER NOT NULL,
    completed_at   INTEGER,
    cancelled_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS counters (
    item     TEXT PRIMARY KEY,
    pronto   INTEGER NOT NULL DEFAULT 0,
    vendute  INTEGER NOT NULL DEFAULT 0,
    evasi    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    station         TEXT NOT NULL,
    price           REAL NOT NULL,
    category        TEXT NOT NULL,
    stock           INTEGER NOT NULL DEFAULT 999,
    initial_stock   INTEGER NOT NULL DEFAULT 999,
    alert_threshold INTEGER NOT NULL DEFAULT 20,
    status          TEXT NOT NULL DEFAULT 'available'
  );

  CREATE TABLE IF NOT EXISTS archived_sessions (
    id        TEXT PRIMARY KEY,
    date      TEXT NOT NULL,
    closed_at INTEGER NOT NULL,
    recap     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_presets (
    name     TEXT PRIMARY KEY,
    stocks   TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS warehouse (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    alert_threshold INTEGER,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    price           REAL NOT NULL,
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
  );
`);

// =============================================
// PREPARED STATEMENTS (riusati per performance)
// =============================================

// --- Meta ---
const stmtGetMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const stmtSetMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

// --- Orders ---
const stmtInsertOrder = db.prepare(`
  INSERT INTO orders (id, table_num, items, subtotal, total, discount, discount_type,
    discount_value, courtesy_type, customer_name, cassa, coperti, asporto, payment,
    status, created_at, completed_at, cancelled_at)
  VALUES (@id, @table_num, @items, @subtotal, @total, @discount, @discount_type,
    @discount_value, @courtesy_type, @customer_name, @cassa, @coperti, @asporto, @payment,
    @status, @created_at, @completed_at, @cancelled_at)
`);
const stmtGetAllOrders = db.prepare('SELECT * FROM orders ORDER BY id ASC');
const stmtUpdateOrderStatus = db.prepare('UPDATE orders SET status = ?, completed_at = ?, cancelled_at = ? WHERE id = ?');
const stmtDeleteAllOrders = db.prepare('DELETE FROM orders');

// --- Counters ---
const stmtGetCounters = db.prepare('SELECT * FROM counters');
const stmtUpsertCounter = db.prepare('INSERT OR REPLACE INTO counters (item, pronto, vendute, evasi) VALUES (?, ?, ?, ?)');
const stmtResetCounters = db.prepare('UPDATE counters SET pronto = 0, vendute = 0, evasi = 0');

// --- Inventory ---
const stmtGetInventory = db.prepare('SELECT * FROM inventory');
const stmtUpsertInventory = db.prepare(`
  INSERT OR REPLACE INTO inventory (id, name, station, price, category, stock, initial_stock, alert_threshold, status)
  VALUES (@id, @name, @station, @price, @category, @stock, @initial_stock, @alert_threshold, @status)
`);
const stmtUpdateInventoryStock = db.prepare('UPDATE inventory SET stock = ?, status = ? WHERE id = ?');
const stmtDeleteInventoryItem = db.prepare('DELETE FROM inventory WHERE id = ?');

// --- Archived Sessions ---
const stmtGetSessions = db.prepare('SELECT * FROM archived_sessions ORDER BY closed_at DESC');
const stmtGetSessionByDate = db.prepare('SELECT * FROM archived_sessions WHERE date = ?');
const stmtInsertSession = db.prepare('INSERT INTO archived_sessions (id, date, closed_at, recap) VALUES (?, ?, ?, ?)');
const stmtUpdateSession = db.prepare('UPDATE archived_sessions SET closed_at = ?, recap = ? WHERE id = ?');

// --- Inventory Presets ---
const stmtGetPresets = db.prepare('SELECT * FROM inventory_presets');
const stmtUpsertPreset = db.prepare('INSERT OR REPLACE INTO inventory_presets (name, stocks, saved_at) VALUES (?, ?, ?)');
const stmtDeletePreset = db.prepare('DELETE FROM inventory_presets WHERE name = ?');

// --- Menu Items (persistenza menu piatti) ---
const stmtGetMenuItems = db.prepare('SELECT * FROM menu_items ORDER BY rowid ASC');
const stmtUpsertMenuItem = db.prepare(`
  INSERT OR REPLACE INTO menu_items (id, name, price, category, station, print_to,
    composition, special, available_date, initial_stock, alert_threshold, available, casses)
  VALUES (@id, @name, @price, @category, @station, @print_to,
    @composition, @special, @available_date, @initial_stock, @alert_threshold, @available, @casses)
`);
const stmtDeleteMenuItem = db.prepare('DELETE FROM menu_items WHERE id = ?');

// --- Warehouse (materiali e consumabili) ---
const stmtGetWarehouse = db.prepare('SELECT * FROM warehouse ORDER BY name ASC');
const stmtUpsertWarehouse = db.prepare(`
  INSERT OR REPLACE INTO warehouse (id, name, quantity, total, alert_threshold, created_at)
  VALUES (@id, @name, @quantity, @total, @alert_threshold, @created_at)
`);
const stmtUpdateWarehouseQty = db.prepare('UPDATE warehouse SET quantity = ? WHERE id = ?');
const stmtDeleteWarehouse = db.prepare('DELETE FROM warehouse WHERE id = ?');

// =============================================
// FUNZIONI HELPER ESPORTATE
// =============================================

// --- Meta / orderCounter ---
function getOrderCounter() {
  const row = stmtGetMeta.get('orderCounter');
  return row ? parseInt(row.value, 10) : 0;
}

function setOrderCounter(n) {
  stmtSetMeta.run('orderCounter', String(n));
}

// --- Orders ---
// Converte una riga DB nel formato usato in memoria da api.js
function rowToOrder(row) {
  return {
    id: row.id,
    table: row.table_num,
    items: JSON.parse(row.items),
    subtotal: row.subtotal,
    total: row.total,
    discount: row.discount,
    discount_type: row.discount_type,
    discount_value: row.discount_value,
    courtesy_type: row.courtesy_type,
    customer_name: row.customer_name,
    cassa: row.cassa,
    coperti: row.coperti,
    asporto: !!row.asporto,
    payment: row.payment,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
  };
}

function getAllOrders() {
  return stmtGetAllOrders.all().map(rowToOrder);
}

function insertOrder(order) {
  stmtInsertOrder.run({
    id: order.id,
    table_num: order.table,
    items: JSON.stringify(order.items),
    subtotal: order.subtotal || 0,
    total: order.total,
    discount: order.discount || 0,
    discount_type: order.discount_type || null,
    discount_value: order.discount_value || 0,
    courtesy_type: order.courtesy_type || null,
    customer_name: order.customer_name || null,
    cassa: order.cassa || 'principale',
    coperti: order.coperti || 0,
    asporto: order.asporto ? 1 : 0,
    payment: order.payment || 'contanti',
    status: order.status || 'in_progress',
    created_at: order.created_at,
    completed_at: order.completed_at || null,
    cancelled_at: order.cancelled_at || null,
  });
}

function updateOrderStatus(id, status, completedAt, cancelledAt) {
  stmtUpdateOrderStatus.run(status, completedAt || null, cancelledAt || null, id);
}

function deleteAllOrders() {
  stmtDeleteAllOrders.run();
}

// --- Counters ---
function getCounters() {
  const result = {};
  stmtGetCounters.all().forEach(row => {
    result[row.item] = { pronto: row.pronto, vendute: row.vendute, evasi: row.evasi };
  });
  return result;
}

function saveCounter(item, data) {
  stmtUpsertCounter.run(item, data.pronto, data.vendute, data.evasi);
}

// Inizializza i contatori se non esistono ancora nel DB
function seedCounters(monitorItems) {
  const existing = getCounters();
  monitorItems.forEach(item => {
    if (!existing[item]) {
      stmtUpsertCounter.run(item, 0, 0, 0);
    }
  });
}

function resetCounters() {
  stmtResetCounters.run();
}

// --- Inventory ---
function getInventory() {
  const result = {};
  stmtGetInventory.all().forEach(row => {
    result[row.id] = { ...row };
  });
  return result;
}

function saveInventoryItem(item) {
  stmtUpsertInventory.run(item);
}

function updateInventoryStock(id, stock, status) {
  stmtUpdateInventoryStock.run(stock, status, id);
}

function deleteInventoryItem(id) {
  stmtDeleteInventoryItem.run(id);
}

// Inizializza l'inventario dal menu di config.js se il DB è vuoto o ha piatti nuovi
function seedInventory(menuItems) {
  const existing = getInventory();
  menuItems.forEach(item => {
    if (!existing[item.id]) {
      stmtUpsertInventory.run({
        id: item.id,
        name: item.name,
        station: item.station,
        price: item.price,
        category: item.category,
        stock: item.initial_stock || 999,
        initial_stock: item.initial_stock || 999,
        alert_threshold: item.alert_threshold || 20,
        status: 'available',
      });
    }
  });
}

// --- Archived Sessions ---
function getArchivedSessions() {
  return stmtGetSessions.all().map(row => ({
    id: row.id,
    date: row.date,
    closed_at: row.closed_at,
    recap: JSON.parse(row.recap),
  }));
}

function getArchivedSessionByDate(date) {
  const row = stmtGetSessionByDate.get(date);
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    closed_at: row.closed_at,
    recap: JSON.parse(row.recap),
  };
}

function insertArchivedSession(session) {
  stmtInsertSession.run(session.id, session.date, session.closed_at, JSON.stringify(session.recap));
}

function updateArchivedSession(id, closedAt, recap) {
  stmtUpdateSession.run(closedAt, JSON.stringify(recap), id);
}

// --- Inventory Presets ---
function getPresets() {
  const result = {};
  stmtGetPresets.all().forEach(row => {
    result[row.name] = { name: row.name, stocks: JSON.parse(row.stocks), saved_at: row.saved_at };
  });
  return result;
}

function savePreset(name, stocks, savedAt) {
  stmtUpsertPreset.run(name, JSON.stringify(stocks), savedAt);
}

function deletePreset(name) {
  stmtDeletePreset.run(name);
}

// --- Menu Items ---
// Converte una riga DB nel formato usato in memoria (JSON parse dei campi serializzati)
function dbRowToMenuItem(row) {
  const item = {
    id: row.id,
    name: row.name,
    price: row.price,
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

function getMenuItems() {
  return stmtGetMenuItems.all().map(dbRowToMenuItem);
}

function saveMenuItem(item) {
  stmtUpsertMenuItem.run({
    id: item.id,
    name: item.name,
    price: item.price,
    category: item.category,
    station: item.station,
    print_to: JSON.stringify(item.print_to || ['cibo']),
    composition: item.composition ? JSON.stringify(item.composition) : null,
    special: item.special ? 1 : 0,
    available_date: item.available_date || null,
    initial_stock: item.initial_stock || 100,
    alert_threshold: item.alert_threshold || 10,
    available: item.available !== false ? 1 : 0,
    casses: JSON.stringify(item.casses || ['cassa_generale']),
  });
}

function deleteMenuItem(id) {
  stmtDeleteMenuItem.run(id);
}

// --- Warehouse ---
function getWarehouse() {
  const result = {};
  stmtGetWarehouse.all().forEach(row => {
    result[row.id] = { ...row };
  });
  return result;
}

function saveWarehouseItem(item) {
  stmtUpsertWarehouse.run(item);
}

function updateWarehouseQty(id, quantity) {
  stmtUpdateWarehouseQty.run(quantity, id);
}

function deleteWarehouseItem(id) {
  stmtDeleteWarehouse.run(id);
}

// =============================================
// EXPORT
// =============================================

module.exports = {
  // Meta
  getOrderCounter, setOrderCounter,
  // Orders
  getAllOrders, insertOrder, updateOrderStatus, deleteAllOrders,
  // Counters
  getCounters, saveCounter, seedCounters, resetCounters,
  // Inventory
  getInventory, saveInventoryItem, updateInventoryStock, deleteInventoryItem, seedInventory,
  // Archived Sessions
  getArchivedSessions, getArchivedSessionByDate, insertArchivedSession, updateArchivedSession,
  // Presets
  getPresets, savePreset, deletePreset,
  // Warehouse (materiali/consumabili)
  getWarehouse, saveWarehouseItem, updateWarehouseQty, deleteWarehouseItem,
  // Menu Items (persistenza menu piatti)
  getMenuItems, saveMenuItem, deleteMenuItem,
};

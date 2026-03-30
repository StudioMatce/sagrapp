const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const printer = require('../services/printer');

const router = express.Router();

// --- Stato in-memory (per la piattaforma di test) ---
// In produzione verrà sostituito con SQLite

// Contatori passa-piatti / monitor
const counters = {};
config.TEST_ITEMS.forEach(item => {
  counters[item.id] = 0;
});

// Inventario / scorte
const inventory = {};
config.TEST_ITEMS.forEach(item => {
  inventory[item.id] = {
    id: item.id,
    name: item.name,
    station: item.station,
    price: item.price,
    category: item.category,
    stock: item.initial_stock,
    initial_stock: item.initial_stock,
    alert_threshold: item.alert_threshold,
    status: 'available', // available, low, exhausted
  };
});

// Ordini di test (per le dashboard admin)
const orders = [];
let orderCounter = 0;

// Sessioni admin attive
const adminSessions = new Map();

// Riferimento a io — verrà impostato dal server principale
let io = null;

function setIO(socketIO) {
  io = socketIO;
}

// --- Helper: verifica token admin ---
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Non autorizzato. Effettua il login.' });
  }
  next();
}

// --- Helper: aggiorna stato scorta ---
function updateInventoryStatus(itemId) {
  const item = inventory[itemId];
  if (!item) return;

  if (item.stock <= 0) {
    item.stock = 0;
    item.status = 'exhausted';
    // Notifica esaurimento a casse e admin
    if (io) {
      io.to('cassa').to('admin').emit('inventory_exhausted', {
        item_id: itemId,
        name: item.name,
      });
    }
  } else if (item.stock <= item.alert_threshold) {
    item.status = 'low';
    // Notifica scorta bassa
    if (io) {
      io.to('cassa').to('admin').emit('inventory_alert', {
        item_id: itemId,
        name: item.name,
        remaining: item.stock,
        threshold: item.alert_threshold,
      });
    }
  } else {
    item.status = 'available';
  }

  // Broadcast aggiornamento scorta a tutti
  if (io) {
    io.emit('inventory_updated', {
      item_id: itemId,
      stock: item.stock,
      status: item.status,
    });
  }
}

// =============================================
// ENDPOINT PUBBLICI
// =============================================

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Stato stampanti — il proxy reale fa il ping TCP,
// qui restituiamo la config con lo stato dal proxy
router.get('/printers/status', (req, res) => {
  const statuses = config.PRINTERS.map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    model: p.model,
    ip: p.ip || null,
    port: p.port || null,
    // Lo stato reale viene dal proxy via socket
    online: p._online || false,
    lastCheck: p._lastCheck || null,
  }));
  res.json(statuses);
});

// Stampa pagina di test su una stampante specifica
router.post('/printers/:id/test', (req, res) => {
  const printerId = parseInt(req.params.id);
  const printerConfig = config.PRINTERS.find(p => p.id === printerId);

  if (!printerConfig) {
    return res.status(404).json({ error: 'Stampante non trovata' });
  }

  if (!io) {
    return res.status(500).json({ error: 'Socket.IO non inizializzato' });
  }

  // Genera i dati ESC/POS
  const data = printer.buildTestPage(printerId);

  // Genera un ID univoco per il job di stampa
  const jobId = `test-${printerId}-${Date.now()}`;

  // Invia il comando al print proxy via Socket.IO
  io.to('proxy').emit('print', {
    printer_id: printerId,
    printer_ip: printerConfig.ip || null,
    printer_type: printerConfig.type,
    data: Array.from(data), // Converte Buffer in array per JSON
    job_id: jobId,
  });

  res.json({
    success: true,
    message: `Comando stampa inviato a ${printerConfig.name}`,
    job_id: jobId,
  });
});

// Stampa barcode di test (sulla stampante #2 vretti)
router.post('/barcode/test', (req, res) => {
  const code = req.body.code || `TEST-${Date.now().toString().slice(-6)}`;
  const data = printer.buildTestBarcodePage(code);
  const jobId = `barcode-${Date.now()}`;

  if (!io) {
    return res.status(500).json({ error: 'Socket.IO non inizializzato' });
  }

  const vretti = config.PRINTERS.find(p => p.id === 2);
  io.to('proxy').emit('print', {
    printer_id: 2,
    printer_ip: vretti.ip,
    printer_type: vretti.type,
    data: Array.from(data),
    job_id: jobId,
  });

  res.json({ success: true, code, job_id: jobId });
});

// =============================================
// ADMIN — LOGIN
// =============================================

router.post('/admin/login', (req, res) => {
  const { pin } = req.body;

  if (pin !== config.ADMIN_PIN) {
    return res.status(403).json({ error: 'PIN errato' });
  }

  // Genera token di sessione
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, {
    created: Date.now(),
    // Scade dopo 12 ore (una serata intera)
    expires: Date.now() + 12 * 60 * 60 * 1000,
  });

  res.json({ success: true, token });
});

// Verifica se il token è valido
router.get('/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !adminSessions.has(token)) {
    return res.json({ valid: false });
  }
  const session = adminSessions.get(token);
  if (Date.now() > session.expires) {
    adminSessions.delete(token);
    return res.json({ valid: false });
  }
  res.json({ valid: true });
});

// =============================================
// ADMIN — STATISTICHE LIVE
// =============================================

router.get('/admin/stats/live', requireAdmin, (req, res) => {
  // Calcola statistiche dagli ordini in memoria
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const incompleteOrders = orders.filter(o => o.status !== 'completed').length;

  // Ordini ultima mezz'ora
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const recentOrders = orders.filter(o => o.created_at > thirtyMinAgo);
  const recentCount = recentOrders.length;
  const recentRevenue = recentOrders.reduce((sum, o) => sum + o.total, 0);

  // Incasso per cassa
  const revenueByCassa = {};
  orders.forEach(o => {
    const key = o.cassa || 'principale';
    revenueByCassa[key] = (revenueByCassa[key] || 0) + o.total;
  });

  // Incasso per metodo pagamento
  const revenueByPayment = {};
  orders.forEach(o => {
    const key = o.payment || 'contanti';
    revenueByPayment[key] = (revenueByPayment[key] || 0) + o.total;
  });

  // Scorte sotto soglia
  const lowStockItems = Object.values(inventory).filter(
    i => i.status === 'low' || i.status === 'exhausted'
  );

  // Ultimi 10 ordini
  const lastOrders = orders.slice(-10).reverse();

  // Griglia sprechi (confronto contatori passa-piatti vs ordini)
  const grillaItems = config.TEST_ITEMS.filter(i => i.station === 'griglia');
  const grillaOrdered = {};
  const grillaProduced = {};
  grillaItems.forEach(item => {
    grillaOrdered[item.id] = 0;
    grillaProduced[item.id] = counters[item.id] || 0;
  });
  orders.forEach(o => {
    (o.items || []).forEach(oi => {
      if (grillaOrdered[oi.id] !== undefined) {
        grillaOrdered[oi.id] += oi.qty;
      }
    });
  });

  res.json({
    totalOrders,
    totalRevenue,
    incompleteOrders,
    recentCount,
    recentRevenue,
    revenueByCassa,
    revenueByPayment,
    lowStockItems,
    lastOrders,
    grilla: { ordered: grillaOrdered, produced: grillaProduced },
  });
});

// =============================================
// ADMIN — RECAP (post-serata)
// =============================================

router.get('/admin/stats/recap', requireAdmin, (req, res) => {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);

  // Classifica vendite per piatto
  const salesByItem = {};
  orders.forEach(o => {
    (o.items || []).forEach(oi => {
      if (!salesByItem[oi.id]) {
        salesByItem[oi.id] = { id: oi.id, name: oi.name, qty: 0, revenue: 0 };
      }
      salesByItem[oi.id].qty += oi.qty;
      salesByItem[oi.id].revenue += oi.qty * oi.price;
    });
  });
  const salesRanking = Object.values(salesByItem).sort((a, b) => b.qty - a.qty);

  // Distribuzione ordini per ora
  const ordersByHour = {};
  orders.forEach(o => {
    const hour = new Date(o.created_at).getHours();
    ordersByHour[hour] = (ordersByHour[hour] || 0) + 1;
  });

  // Tempo medio evasione (solo ordini completati)
  const completedOrders = orders.filter(o => o.status === 'completed' && o.completed_at);
  const avgTime = completedOrders.length > 0
    ? completedOrders.reduce((sum, o) => sum + (o.completed_at - o.created_at), 0) / completedOrders.length
    : 0;

  // Incasso per cassa e per pagamento
  const revenueByCassa = {};
  const revenueByPayment = {};
  orders.forEach(o => {
    const ck = o.cassa || 'principale';
    revenueByCassa[ck] = (revenueByCassa[ck] || 0) + o.total;
    const pk = o.payment || 'contanti';
    revenueByPayment[pk] = (revenueByPayment[pk] || 0) + o.total;
  });

  // Magazzino: scorta iniziale → venduto → rimanente
  const inventoryReport = Object.values(inventory).map(item => {
    const sold = salesByItem[item.id] ? salesByItem[item.id].qty : 0;
    return {
      id: item.id,
      name: item.name,
      initial_stock: item.initial_stock,
      sold,
      remaining: item.stock,
      status: item.status,
    };
  });

  // Ordini incompleti
  const incomplete = orders.filter(o => o.status !== 'completed');

  res.json({
    totalOrders,
    totalRevenue,
    salesRanking,
    ordersByHour,
    avgCompletionTime: Math.round(avgTime / 1000), // secondi
    revenueByCassa,
    revenueByPayment,
    inventoryReport,
    incompleteOrders: incomplete.length,
    incompleteDetails: incomplete,
  });
});

// =============================================
// INVENTARIO / MAGAZZINO
// =============================================

// Lista piatti con scorte
router.get('/inventory', (req, res) => {
  res.json(Object.values(inventory));
});

// Aggiorna scorta piatto
router.put('/inventory/:id', requireAdmin, (req, res) => {
  const item = inventory[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Piatto non trovato' });
  }

  const { stock, alert_threshold, status } = req.body;
  if (stock !== undefined) item.stock = Math.max(0, parseInt(stock));
  if (alert_threshold !== undefined) item.alert_threshold = Math.max(0, parseInt(alert_threshold));
  if (status !== undefined) item.status = status;

  updateInventoryStatus(item.id);

  res.json(item);
});

// Aggiustamento rapido scorta (+/- quantità)
router.post('/inventory/:id/adjust', requireAdmin, (req, res) => {
  const item = inventory[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Piatto non trovato' });
  }

  const { delta } = req.body;
  if (delta === undefined || isNaN(delta)) {
    return res.status(400).json({ error: 'Specificare delta numerico' });
  }

  item.stock = Math.max(0, item.stock + parseInt(delta));
  updateInventoryStatus(item.id);

  res.json(item);
});

// Reset scorte a valori iniziali
router.post('/inventory/reset', requireAdmin, (req, res) => {
  config.TEST_ITEMS.forEach(testItem => {
    const item = inventory[testItem.id];
    if (item) {
      item.stock = testItem.initial_stock;
      item.status = 'available';
    }
  });

  if (io) {
    io.emit('inventory_reset', Object.values(inventory));
  }

  res.json({ success: true, inventory: Object.values(inventory) });
});

// =============================================
// ORDINI DI TEST (per generare dati nelle dashboard admin)
// =============================================

// Genera un ordine di test casuale
router.post('/orders/test', (req, res) => {
  orderCounter++;
  const items = [];
  // Seleziona 1-3 piatti random
  const numItems = 1 + Math.floor(Math.random() * 3);
  const available = config.TEST_ITEMS.filter(i => inventory[i.id].status !== 'exhausted');
  for (let i = 0; i < numItems && available.length > 0; i++) {
    const item = available[Math.floor(Math.random() * available.length)];
    const qty = 1 + Math.floor(Math.random() * 3);
    items.push({ id: item.id, name: item.name, price: item.price, qty });

    // Scala le scorte
    inventory[item.id].stock = Math.max(0, inventory[item.id].stock - qty);
    updateInventoryStatus(item.id);
  }

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const casse = ['principale', 'bar'];
  const payments = ['contanti', 'pos'];
  const statuses = ['completed', 'completed', 'completed', 'in_progress']; // 75% completati

  const order = {
    id: orderCounter,
    table: 1 + Math.floor(Math.random() * 20),
    items,
    total,
    cassa: casse[Math.floor(Math.random() * casse.length)],
    payment: payments[Math.floor(Math.random() * payments.length)],
    status: statuses[Math.floor(Math.random() * statuses.length)],
    created_at: Date.now(),
    completed_at: null,
  };

  if (order.status === 'completed') {
    // Tempo evasione simulato: 3-15 minuti
    order.completed_at = order.created_at + (3 + Math.floor(Math.random() * 12)) * 60 * 1000;
  }

  orders.push(order);

  // Broadcast a tutti
  if (io) {
    io.emit('order_created', order);
    io.to('admin').emit('stats_update', { type: 'new_order', order });
  }

  res.json({ success: true, order });
});

// =============================================
// ESPORTAZIONI
// =============================================

module.exports = { router, setIO, counters, inventory, orders };

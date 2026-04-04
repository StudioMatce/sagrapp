const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const printer = require('../services/printer');

const router = express.Router();

// --- Stato in-memory (per la piattaforma di test) ---

// Contatori monitor cuochi — pezzi singoli dalla griglia/scaldavivande
// pronto = pezzi nello scaldavivande (dal tablet)
// vendute = totale pezzi calcolato dagli ordini (via composizione piatti)
// da_cucinare = vendute - pronto (calcolato lato client)
const counters = {};
config.MONITOR_ITEMS.forEach(item => {
  counters[item] = { pronto: 0, vendute: 0 };
});

// Inventario / scorte — un record per ogni piatto del menu
const inventory = {};
config.MENU.forEach(item => {
  inventory[item.id] = {
    id: item.id,
    name: item.name,
    station: item.station,
    price: item.price,
    category: item.category,
    stock: item.initial_stock || 999,
    initial_stock: item.initial_stock || 999,
    alert_threshold: item.alert_threshold || 20,
    status: 'available',
  };
});

// Ordini
const orders = [];
let orderCounter = 0;

// Sessioni admin attive
const adminSessions = new Map();

// Riferimento a io
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
    if (io) {
      io.to('cassa').to('admin').emit('inventory_exhausted', {
        item_id: itemId,
        name: item.name,
      });
    }
  } else if (item.stock <= item.alert_threshold) {
    item.status = 'low';
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

  if (io) {
    io.emit('inventory_updated', {
      item_id: itemId,
      stock: item.stock,
      status: item.status,
    });
  }
}

// --- Helper: trova piatto nel menu ---
function findMenuItem(id) {
  return config.MENU.find(i => i.id === id);
}

// =============================================
// ENDPOINT PUBBLICI
// =============================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Menu completo (usato dalla cassa per caricare i piatti)
router.get('/menu', (req, res) => {
  // Restituisce il menu con lo stato stock di ogni piatto
  const menuWithStock = config.MENU.map(item => ({
    ...item,
    stock: inventory[item.id] ? inventory[item.id].stock : 0,
    status: inventory[item.id] ? inventory[item.id].status : 'available',
  }));
  res.json(menuWithStock);
});

router.get('/printers/status', (req, res) => {
  const statuses = config.PRINTERS.map(p => ({
    id: p.id,
    name: p.name,
    model: p.model,
    ip: p.ip,
    port: p.port,
    online: p._online || false,
    lastCheck: p._lastCheck || null,
  }));
  res.json(statuses);
});

router.post('/printers/:id/test', (req, res) => {
  const printerId = parseInt(req.params.id);
  const printerConfig = config.PRINTERS.find(p => p.id === printerId);

  if (!printerConfig) {
    return res.status(404).json({ error: 'Stampante non trovata' });
  }

  if (!io) {
    return res.status(500).json({ error: 'Socket.IO non inizializzato' });
  }

  const data = printer.buildTestPage(printerId);
  const jobId = `test-${printerId}-${Date.now()}`;

  io.to('proxy').emit('print', {
    printer_id: printerId,
    printer_ip: printerConfig.ip,
    data: Array.from(data),
    job_id: jobId,
  });

  res.json({
    success: true,
    message: `Comando stampa inviato a ${printerConfig.name}`,
    job_id: jobId,
  });
});

// Evasione ordine (dal tablet zona controllo)
router.post('/orders/:id/fulfill', (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = orders.find(o => o.id === orderId);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Ordine non trovato' });
  }

  if (order.status === 'completed') {
    return res.json({ success: false, already_fulfilled: true, order_number: orderId, table: order.table });
  }

  order.status = 'completed';
  order.completed_at = Date.now();

  // Scala i pezzi "pronto" dal monitor cuochi — il cibo è stato consegnato al tavolo,
  // quindi non è più nello scaldavivande
  let countersChanged = false;
  order.items.forEach(item => {
    const menuItem = findMenuItem(item.id);
    if (menuItem && menuItem.composition) {
      for (const [piece, count] of Object.entries(menuItem.composition)) {
        if (counters[piece] !== undefined) {
          counters[piece].pronto = Math.max(0, counters[piece].pronto - count * item.qty);
          countersChanged = true;
        }
      }
    }
  });

  if (io) {
    io.emit('order_fulfilled_broadcast', { order_number: orderId, table: order.table });
    // Aggiorna il monitor cuochi se i contatori sono cambiati
    if (countersChanged) {
      io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters });
    }
  }

  res.json({ success: true, order_number: orderId, table: order.table });
});

// =============================================
// CREA ORDINE — con composizione pezzi, stampa multipla, e piatti speciali
// =============================================
router.post('/orders', (req, res) => {
  const { table, items: orderItems, payment, customer_name, discount, discount_type, discount_value, courtesy_type } = req.body;

  if (!table || !orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return res.status(400).json({ error: 'Specificare tavolo e piatti' });
  }

  orderCounter++;

  // Costruisce l'ordine con info dal menu
  const items = [];
  let hasFood = false;
  let hasDrinks = false;
  let hasSpecial = false;

  orderItems.forEach(({ id, qty }) => {
    const menuItem = findMenuItem(id);
    if (!menuItem || !qty || qty <= 0) return;
    const q = parseInt(qty);

    items.push({
      id: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      category: menuItem.category,
      station: menuItem.station,
      print_to: menuItem.print_to || [],
      special: menuItem.special || false,
      qty: q,
    });

    // Controlla tipo per decidere le stampe
    if (menuItem.print_to && menuItem.print_to.includes('cibo')) hasFood = true;
    if (menuItem.print_to && menuItem.print_to.includes('bevande')) hasDrinks = true;
    if (menuItem.special) hasSpecial = true;

    // Scomponi in pezzi singoli per i contatori del monitor cuochi
    // Esempio: "Costicine con polenta" → costicine +3, polenta +1
    if (menuItem.composition) {
      for (const [piece, count] of Object.entries(menuItem.composition)) {
        if (counters[piece] !== undefined) {
          counters[piece].vendute += count * q;
        }
      }
    }

    // Scala le scorte dal magazzino
    if (inventory[menuItem.id]) {
      inventory[menuItem.id].stock = Math.max(0, inventory[menuItem.id].stock - q);
      updateInventoryStatus(menuItem.id);
    }
  });

  if (items.length === 0) {
    orderCounter--;
    return res.status(400).json({ error: 'Nessun piatto valido' });
  }

  // Calcolo totale con sconto e omaggio
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  let appliedDiscount = 0;
  let total = subtotal;

  // Courtesy: ordine gratis ma registrato con valore reale
  const validCourtesy = ['sponsor', 'don_pierino', 'amici'];
  const orderCourtesy = validCourtesy.includes(courtesy_type) ? courtesy_type : null;

  if (orderCourtesy) {
    // Omaggio: totale pagato = 0, valore reale conservato
    total = 0;
  } else if (discount && discount > 0) {
    appliedDiscount = Math.min(parseFloat(discount), subtotal);
    total = Math.round((subtotal - appliedDiscount) * 100) / 100;
  }

  const order = {
    id: orderCounter,
    table: parseInt(table),
    items,
    subtotal,
    total,
    discount: appliedDiscount,
    discount_type: discount_type || null,
    discount_value: discount_value || 0,
    courtesy_type: orderCourtesy,
    customer_name: customer_name || null,
    cassa: 'principale',
    payment: payment || 'contanti',
    status: 'in_progress',
    created_at: Date.now(),
    completed_at: null,
  };

  orders.push(order);

  // Broadcast contatori aggiornati (vendute cambiate → da_cucinare cambia sul monitor)
  if (io) {
    io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters });
    io.emit('order_created', order);
    io.to('admin').emit('stats_update', { type: 'new_order', order });
  }

  // --- STAMPA ---
  const prints = { receipt: false, food: false, drinks: false, special: false };

  // 1. Ricevuta cassa generale → vretti .203 (printer #1)
  const receiptData = printer.buildReceipt(order);
  const receiptPrinter = config.PRINTERS.find(p => p.id === 1);
  if (io && receiptPrinter) {
    io.to('proxy').emit('print', {
      printer_id: 1,
      printer_ip: receiptPrinter.ip,
      data: Array.from(receiptData),
      job_id: `receipt-${order.id}-${Date.now()}`,
    });
    prints.receipt = true;
  }

  // 2. Comanda cibo → Fuhuihe .205 (printer #3)
  //    Include TUTTI i piatti con print_to 'cibo' (anche speciali)
  if (hasFood) {
    const foodData = printer.buildFoodOrder(order);
    const foodPrinter = config.PRINTERS.find(p => p.id === 3);
    if (io && foodData && foodPrinter) {
      io.to('proxy').emit('print', {
        printer_id: 3,
        printer_ip: foodPrinter.ip,
        data: Array.from(foodData),
        job_id: `food-${order.id}-${Date.now()}`,
      });
      prints.food = true;
    }
  }

  // 3. Comanda bevande → Fuhuihe .204 (printer #2)
  if (hasDrinks) {
    const drinkData = printer.buildDrinkOrder(order);
    const drinkPrinter = config.PRINTERS.find(p => p.id === 2);
    if (io && drinkData && drinkPrinter) {
      io.to('proxy').emit('print', {
        printer_id: 2,
        printer_ip: drinkPrinter.ip,
        data: Array.from(drinkData),
        job_id: `drink-${order.id}-${Date.now()}`,
      });
      prints.drinks = true;
    }
  }

  // 4. Piatti speciali → Fuhuihe .207 (printer #5)
  //    DOPPIA STAMPA: gli speciali vanno già sulla comanda cibo (.205),
  //    qui stampiamo SOLO i piatti speciali sulla stampante dedicata
  if (hasSpecial) {
    const specialData = printer.buildSpecialOrder(order);
    const specialPrinter = config.PRINTERS.find(p => p.id === 5);
    if (io && specialData && specialPrinter) {
      io.to('proxy').emit('print', {
        printer_id: 5,
        printer_ip: specialPrinter.ip,
        data: Array.from(specialData),
        job_id: `special-${order.id}-${Date.now()}`,
      });
      prints.special = true;
    }
  }

  res.json({
    success: true,
    order_number: order.id,
    table: order.table,
    total: order.total,
    subtotal: order.subtotal,
    courtesy_type: order.courtesy_type,
    discount: order.discount,
    prints,
  });
});

// =============================================
// ADMIN — LOGIN
// =============================================

router.post('/admin/login', (req, res) => {
  const { pin } = req.body;

  if (pin !== config.ADMIN_PIN) {
    return res.status(403).json({ error: 'PIN errato' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, {
    created: Date.now(),
    expires: Date.now() + 12 * 60 * 60 * 1000,
  });

  res.json({ success: true, token });
});

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
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const incompleteOrders = orders.filter(o => o.status !== 'completed').length;

  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const recentOrders = orders.filter(o => o.created_at > thirtyMinAgo);
  const recentCount = recentOrders.length;
  const recentRevenue = recentOrders.reduce((sum, o) => sum + o.total, 0);

  const revenueByCassa = {};
  orders.forEach(o => {
    const key = o.cassa || 'principale';
    revenueByCassa[key] = (revenueByCassa[key] || 0) + o.total;
  });

  const revenueByPayment = {};
  orders.forEach(o => {
    const key = o.payment || 'contanti';
    revenueByPayment[key] = (revenueByPayment[key] || 0) + o.total;
  });

  const lowStockItems = Object.values(inventory).filter(
    i => i.status === 'low' || i.status === 'exhausted'
  );

  const lastOrders = orders.slice(-10).reverse();

  // Griglia sprechi — confronta pezzi venduti vs prodotti (dallo scaldavivande)
  const grillaOrdered = {};
  const grillaProduced = {};
  config.MONITOR_ITEMS.forEach(item => {
    grillaOrdered[item] = counters[item] ? counters[item].vendute : 0;
    grillaProduced[item] = counters[item] ? counters[item].pronto : 0;
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

  const ordersByHour = {};
  orders.forEach(o => {
    const hour = new Date(o.created_at).getHours();
    ordersByHour[hour] = (ordersByHour[hour] || 0) + 1;
  });

  const completedOrders = orders.filter(o => o.status === 'completed' && o.completed_at);
  const avgTime = completedOrders.length > 0
    ? completedOrders.reduce((sum, o) => sum + (o.completed_at - o.created_at), 0) / completedOrders.length
    : 0;

  const revenueByCassa = {};
  const revenueByPayment = {};
  orders.forEach(o => {
    const ck = o.cassa || 'principale';
    revenueByCassa[ck] = (revenueByCassa[ck] || 0) + o.total;
    const pk = o.payment || 'contanti';
    revenueByPayment[pk] = (revenueByPayment[pk] || 0) + o.total;
  });

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

  const incomplete = orders.filter(o => o.status !== 'completed');

  // Omaggi per tipo (sponsor, don_pierino, amici)
  const courtesyTypes = ['sponsor', 'don_pierino', 'amici'];
  const courtesy = {};
  courtesyTypes.forEach(type => {
    const courtesyOrders = orders.filter(o => o.courtesy_type === type);
    courtesy[type] = {
      count: courtesyOrders.length,
      realValue: courtesyOrders.reduce((sum, o) => sum + (o.subtotal || 0), 0),
    };
  });
  courtesy.total = {
    count: courtesyTypes.reduce((sum, t) => sum + courtesy[t].count, 0),
    realValue: courtesyTypes.reduce((sum, t) => sum + courtesy[t].realValue, 0),
  };

  // Totale sconti applicati
  const discountTotal = orders.reduce((sum, o) => sum + (o.discount || 0), 0);

  res.json({
    totalOrders,
    totalRevenue,
    salesRanking,
    ordersByHour,
    avgCompletionTime: Math.round(avgTime / 1000),
    revenueByCassa,
    revenueByPayment,
    inventoryReport,
    incompleteOrders: incomplete.length,
    incompleteDetails: incomplete,
    courtesy,
    discountTotal,
  });
});

// =============================================
// INVENTARIO / MAGAZZINO
// =============================================

router.get('/inventory', (req, res) => {
  res.json(Object.values(inventory));
});

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

router.post('/inventory/reset', requireAdmin, (req, res) => {
  config.MENU.forEach(menuItem => {
    const item = inventory[menuItem.id];
    if (item) {
      item.stock = menuItem.initial_stock || 999;
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

router.post('/orders/test', (req, res) => {
  orderCounter++;

  // Seleziona 1-3 piatti random dal menu (escluse bevande e condimenti per semplicità)
  const foodMenu = config.MENU.filter(i =>
    ['primo', 'secondo', 'contorno'].includes(i.category) &&
    inventory[i.id] && inventory[i.id].status !== 'exhausted'
  );

  const items = [];
  const numItems = 1 + Math.floor(Math.random() * 3);

  for (let i = 0; i < numItems && foodMenu.length > 0; i++) {
    const item = foodMenu[Math.floor(Math.random() * foodMenu.length)];
    const qty = 1 + Math.floor(Math.random() * 3);
    items.push({
      id: item.id, name: item.name, price: item.price,
      category: item.category, station: item.station,
      print_to: item.print_to || [], special: item.special || false,
      qty,
    });

    // Scala scorte e aggiorna contatori monitor
    if (inventory[item.id]) {
      inventory[item.id].stock = Math.max(0, inventory[item.id].stock - qty);
      updateInventoryStatus(item.id);
    }
    if (item.composition) {
      for (const [piece, count] of Object.entries(item.composition)) {
        if (counters[piece] !== undefined) {
          counters[piece].vendute += count * qty;
        }
      }
    }
  }

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const casse = ['principale', 'bar'];
  const payments = ['contanti', 'pos'];
  const statuses = ['completed', 'completed', 'completed', 'in_progress'];

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
    order.completed_at = order.created_at + (3 + Math.floor(Math.random() * 12)) * 60 * 1000;
  }

  orders.push(order);

  if (io) {
    io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters });
    io.emit('order_created', order);
    io.to('admin').emit('stats_update', { type: 'new_order', order });
  }

  res.json({ success: true, order });
});

module.exports = { router, setIO, counters, inventory, orders };

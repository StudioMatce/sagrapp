const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const printer = require('../services/printer');
const db = require('../db');

const router = express.Router();

// --- Stato in-memory con persistenza SQLite (write-through cache) ---
// I dati restano in memoria per velocità. Ogni modifica viene scritta anche su DB.
// Al riavvio, i dati vengono caricati dal DB.

// Menu piatti — caricato da DB, seed da config.js se primo avvio
const dbMenu = db.getMenuItems();
if (dbMenu.length > 0) {
  // DB ha gia' il menu (con tutte le modifiche fatte via admin) — lo usa
  config.MENU.length = 0;
  dbMenu.forEach(item => config.MENU.push(item));
  console.log(`[Menu] Caricati ${dbMenu.length} piatti dal database`);
} else {
  // Primo avvio: seed da config.js → salva nel DB
  config.MENU.forEach(item => {
    if (item.available === undefined) item.available = true;
    if (!item.casses) {
      item.casses = item.category === 'bevanda' ? ['cassa_bar'] : ['cassa_generale'];
    }
    db.saveMenuItem(item);
  });
  console.log(`[Menu] Primo avvio — salvati ${config.MENU.length} piatti da config.js nel database`);
}

// Contatori monitor cuochi — caricati da DB, seed se primo avvio
db.seedCounters(config.MONITOR_ITEMS);
const counters = db.getCounters();
// Assicura che tutti gli item di config siano presenti in memoria
config.MONITOR_ITEMS.forEach(item => {
  if (!counters[item]) counters[item] = { pronto: 0, vendute: 0, evasi: 0 };
});

// Inventario / scorte — caricato da DB, seed piatti nuovi dal menu
db.seedInventory(config.MENU);
const inventory = db.getInventory();
// Assicura che tutti i piatti del menu siano in inventario
config.MENU.forEach(item => {
  if (!inventory[item.id]) {
    inventory[item.id] = {
      id: item.id, name: item.name, station: item.station, price: item.price,
      category: item.category, stock: item.initial_stock || 999,
      initial_stock: item.initial_stock || 999, alert_threshold: item.alert_threshold || 20,
      status: 'available',
    };
  }
});

// Ordini — caricati da DB
const orders = db.getAllOrders();
let orderCounter = db.getOrderCounter();

// Archivio serate chiuse — caricato da DB
const archivedSessions = db.getArchivedSessions();

// Sessioni admin attive
const adminSessions = new Map();

// Riferimento a io
let io = null;

// ID del proxy attivo — solo uno alla volta per evitare stampe duplicate
let activeProxyId = null;

// Coda stampa — se il proxy è offline, i job vengono accodati e inviati alla riconnessione
const printQueue = [];

function setIO(socketIO) {
  io = socketIO;
}

// Invia comando stampa a UN SOLO proxy (evita duplicati se più connessioni aperte)
// Se il proxy è offline, accoda il job e lo invia alla riconnessione
function emitToProxy(event, data) {
  if (!io || !activeProxyId) {
    // Proxy offline: accoda il job
    printQueue.push({ event, data, queued_at: Date.now() });
    console.log(`[Stampa] Proxy offline — job accodato (coda: ${printQueue.length})`);
    return false;
  }
  io.to(activeProxyId).emit(event, data);
  return true;
}

// Svuota la coda stampa quando il proxy si riconnette
function flushPrintQueue() {
  if (!io || !activeProxyId || printQueue.length === 0) return;
  console.log(`[Stampa] Proxy riconnesso — invio ${printQueue.length} job in coda`);
  while (printQueue.length > 0) {
    const job = printQueue.shift();
    io.to(activeProxyId).emit(job.event, job.data);
  }
}

// --- Helper: broadcast lista ordini aperti al tablet operatore ---
function broadcastOpenOrders() {
  if (!io) return;
  const openOrders = orders
    .filter(o => o.status === 'in_progress')
    .map(o => ({
      id: o.id,
      table: o.table,
      customer_name: o.customer_name,
      items_summary: o.items.map(i => `${i.qty}x ${i.name}`).join(', '),
      total: o.total,
      created_at: o.created_at,
    }));
  io.to('controllo').emit('open_orders_update', { orders: openOrders });
}

// --- Helper: calcola coperti totali della serata (ordini non annullati) ---
function computeTotalCoperti() {
  return orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.coperti || 0), 0);
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

  // Persiste su DB
  db.updateInventoryStock(itemId, item.stock, item.status);

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

// Modifica un piatto del menu (nome, prezzo, casse, composizione, ecc.)
router.put('/menu/:id', requireAdmin, (req, res) => {
  const menuItem = config.MENU.find(m => m.id === req.params.id);
  if (!menuItem) {
    return res.status(404).json({ error: 'Piatto non trovato' });
  }

  const { name, price, available, available_date, casses, composition, category, station, print_to } = req.body;
  if (name !== undefined) menuItem.name = String(name).trim();
  if (price !== undefined) menuItem.price = parseFloat(price);
  if (available !== undefined) menuItem.available = !!available;
  if (available_date !== undefined) menuItem.available_date = available_date;
  if (casses !== undefined && Array.isArray(casses)) menuItem.casses = casses;
  if (composition !== undefined) menuItem.composition = composition;
  if (category !== undefined) menuItem.category = category;
  if (station !== undefined) menuItem.station = station;
  if (print_to !== undefined && Array.isArray(print_to)) menuItem.print_to = print_to;

  // Aggiorna anche l'inventario se il nome e' cambiato
  if (name !== undefined && inventory[menuItem.id]) {
    inventory[menuItem.id].name = menuItem.name;
  }
  if (price !== undefined && inventory[menuItem.id]) {
    inventory[menuItem.id].price = menuItem.price;
  }

  // Aggiorna scorte e soglia se specificati
  const { initial_stock, alert_threshold } = req.body;
  if (initial_stock !== undefined) {
    menuItem.initial_stock = parseInt(initial_stock);
    if (inventory[menuItem.id]) {
      inventory[menuItem.id].initial_stock = menuItem.initial_stock;
      db.saveInventoryItem(inventory[menuItem.id]);
    }
  }
  if (alert_threshold !== undefined) {
    menuItem.alert_threshold = parseInt(alert_threshold);
    if (inventory[menuItem.id]) {
      inventory[menuItem.id].alert_threshold = menuItem.alert_threshold;
      updateInventoryStatus(menuItem.id);
    }
  }

  // Persisti su SQLite (write-through)
  db.saveMenuItem(menuItem);

  // Notifica le casse in tempo reale
  if (io) io.emit('menu_updated', { item: menuItem });

  res.json(menuItem);
});

// Aggiunge un nuovo piatto al menu
router.post('/menu', requireAdmin, (req, res) => {
  const { name, price, category, station, print_to, casses, composition, available_date, initial_stock, alert_threshold } = req.body;

  if (!name || price === undefined || !category || !station) {
    return res.status(400).json({ error: 'Campi obbligatori: name, price, category, station' });
  }

  // Genera ID dal nome (slug)
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (config.MENU.find(m => m.id === id)) {
    return res.status(409).json({ error: 'Esiste gia\' un piatto con questo ID: ' + id });
  }

  const newItem = {
    id,
    name: String(name).trim(),
    price: parseFloat(price),
    category,
    station,
    print_to: print_to || (category === 'bevanda' ? ['bevande'] : ['cibo']),
    casses: casses || (category === 'bevanda' ? ['cassa_bar'] : ['cassa_generale']),
    available: true,
    initial_stock: initial_stock || 100,
    alert_threshold: alert_threshold || 10,
  };

  if (composition) newItem.composition = composition;
  if (category === 'speciale') {
    newItem.special = true;
    newItem.print_to = ['cibo', 'speciali'];
    if (available_date) newItem.available_date = available_date;
  }

  // Aggiungi al menu, persisti su SQLite e aggiorna inventario
  config.MENU.push(newItem);
  db.saveMenuItem(newItem);
  inventory[id] = {
    id, name: newItem.name, station, price: newItem.price, category,
    stock: newItem.initial_stock, initial_stock: newItem.initial_stock,
    alert_threshold: newItem.alert_threshold, status: 'available',
  };

  if (io) io.emit('menu_updated', { item: newItem, action: 'added' });

  res.status(201).json(newItem);
});

// Elimina un piatto dal menu
router.delete('/menu/:id', requireAdmin, (req, res) => {
  const idx = config.MENU.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Piatto non trovato' });
  }

  const removed = config.MENU.splice(idx, 1)[0];
  db.deleteMenuItem(req.params.id);
  delete inventory[req.params.id];

  if (io) io.emit('menu_updated', { item: removed, action: 'deleted' });

  res.json({ success: true, id: req.params.id });
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

  emitToProxy('print', {
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

// Lista TUTTI gli ordini della serata (per tab ORDINI in cassa)
router.get('/orders/all', (req, res) => {
  const allOrders = orders.map(o => ({
    id: o.id,
    table: o.table,
    customer_name: o.customer_name,
    items_summary: o.items.map(i => `${i.qty}x ${i.name}`).join(', '),
    total: o.total,
    subtotal: o.subtotal,
    courtesy_type: o.courtesy_type,
    status: o.status,
    source: o.cassa,
    asporto: o.asporto || false,
    created_at: o.created_at,
  }));
  // Dal più recente al più vecchio
  allOrders.reverse();
  res.json(allOrders);
});

// Lista ordini aperti (per tablet operatore fisso)
router.get('/orders/open', (req, res) => {
  const openOrders = orders
    .filter(o => o.status === 'in_progress')
    .map(o => ({
      id: o.id,
      table: o.table,
      customer_name: o.customer_name,
      items_summary: o.items.map(i => `${i.qty}x ${i.name}`).join(', '),
      total: o.total,
      created_at: o.created_at,
    }));
  res.json(openOrders);
});

// Annullamento ordine (dal tablet operatore fisso)
router.post('/orders/:id/cancel', (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = orders.find(o => o.id === orderId);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Ordine non trovato' });
  }

  if (order.status === 'cancelled') {
    return res.json({ success: false, already_cancelled: true, order_number: orderId });
  }

  const wasFulfilled = order.status === 'completed';
  order.status = 'cancelled';
  order.cancelled_at = Date.now();
  db.updateOrderStatus(order.id, 'cancelled', null, order.cancelled_at);

  // Ripristina le scorte magazzino (come se l'ordine non fosse mai stato fatto)
  order.items.forEach(item => {
    if (inventory[item.id]) {
      inventory[item.id].stock += item.qty;
      updateInventoryStatus(item.id);
    }
  });

  // Ripristina i contatori monitor cuochi
  let countersChanged = false;
  order.items.forEach(item => {
    const menuItem = findMenuItem(item.id);
    if (menuItem && menuItem.composition) {
      for (const [piece, count] of Object.entries(menuItem.composition)) {
        if (counters[piece] !== undefined) {
          const qty = count * item.qty;
          // Scala le vendute (da cucinare scende)
          counters[piece].vendute = Math.max(0, counters[piece].vendute - qty);
          // Se era già evaso, ripristina anche i pezzi nello scaldavivande
          if (wasFulfilled) {
            counters[piece].evasi = Math.max(0, counters[piece].evasi - qty);
          }
          countersChanged = true;
        }
      }
    }
  });

  // Persiste contatori modificati su DB
  if (countersChanged) {
    config.MONITOR_ITEMS.forEach(item => { if (counters[item]) db.saveCounter(item, counters[item]); });
  }

  if (io) {
    if (countersChanged) {
      io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters, total_coperti: computeTotalCoperti() });
    }
    io.emit('order_cancelled', { order_number: orderId, table: order.table });
    broadcastOpenOrders();
  }

  res.json({ success: true, order_number: orderId, table: order.table });
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

  // Controlla che ci siano abbastanza pezzi NELLO SCALDAVIVANDE (pronto - evasi)
  // per tutti i piatti griglia dell'ordine.
  // Piatti senza composition (pasta, bevande, ecc.) passano senza controllo.
  // Patate escluse dal controllo: tracciate per il monitor ma non nello scaldavivande
  const SKIP_FULFILLMENT = ['patate'];
  const missingPieces = [];
  order.items.forEach(item => {
    const menuItem = findMenuItem(item.id);
    if (menuItem && menuItem.composition) {
      for (const [piece, count] of Object.entries(menuItem.composition)) {
        if (counters[piece] !== undefined && !SKIP_FULFILLMENT.includes(piece)) {
          const needed = count * item.qty;
          const nelloScaldavivande = Math.max(0, counters[piece].pronto - counters[piece].evasi);
          if (nelloScaldavivande < needed) {
            missingPieces.push({ piece, needed, available: nelloScaldavivande });
          }
        }
      }
    }
  });

  if (missingPieces.length > 0) {
    return res.json({
      success: false,
      not_ready: true,
      order_number: orderId,
      table: order.table,
      missing: missingPieces,
    });
  }

  order.status = 'completed';
  order.completed_at = Date.now();
  db.updateOrderStatus(order.id, 'completed', order.completed_at, null);

  // Incrementa "evasi" — i pezzi escono dallo scaldavivande
  // Questo fa scendere "nello scaldavivande" (pronto - evasi) sul monitor
  order.items.forEach(item => {
    const menuItem = findMenuItem(item.id);
    if (menuItem && menuItem.composition) {
      for (const [piece, count] of Object.entries(menuItem.composition)) {
        if (counters[piece] !== undefined) {
          counters[piece].evasi += count * item.qty;
          db.saveCounter(piece, counters[piece]);
        }
      }
    }
  });

  if (io) {
    io.emit('order_fulfilled_broadcast', { order_number: orderId, table: order.table });
    io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters, total_coperti: computeTotalCoperti() });
    broadcastOpenOrders();
  }

  res.json({ success: true, order_number: orderId, table: order.table });
});

// =============================================
// CREA ORDINE — con composizione pezzi, stampa multipla, e piatti speciali
// =============================================
router.post('/orders', (req, res) => {
  const { table, items: orderItems, payment, customer_name, discount, discount_type, discount_value, courtesy_type, source, coperti, asporto } = req.body;

  // Bar e casetta non hanno tavolo (inviano table: 0), la cassa generale lo richiede
  const needsTable = source !== 'bar' && source !== 'casetta' && !asporto;
  if ((needsTable && !table) || !orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
    return res.status(400).json({ error: 'Specificare tavolo e piatti' });
  }

  orderCounter++;
  db.setOrderCounter(orderCounter);

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
          db.saveCounter(piece, counters[piece]);
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
    cassa: source || 'principale',
    coperti: asporto ? 0 : (parseInt(coperti) || 0),
    asporto: !!asporto,
    payment: payment || 'contanti',
    status: 'in_progress',
    created_at: Date.now(),
    completed_at: null,
  };

  orders.push(order);
  db.insertOrder(order);

  // Broadcast contatori aggiornati (vendute cambiate → da_cucinare cambia sul monitor)
  if (io) {
    io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters, total_coperti: computeTotalCoperti() });
    io.emit('order_created', order);
    io.to('admin').emit('stats_update', { type: 'new_order', order });
    broadcastOpenOrders();
  }

  // --- STAMPA ---
  // Cassa bar → solo ricevuta su .206 (printer #4)
  // Cassa casetta → solo ricevuta su .208 (printer #6)
  // Cassa generale → ricevuta .203 + comanda cibo .205 + comanda bevande .204 + speciali .207
  const prints = { receipt: false, food: false, drinks: false, special: false };
  const cassa = order.cassa || 'principale';

  if (cassa === 'bar') {
    // Cassa bar: ricevuta solo su .206
    const receiptData = printer.buildReceipt(order);
    const barPrinter = config.PRINTERS.find(p => p.id === 4);
    if (io && barPrinter) {
      emitToProxy('print', {
        printer_id: 4,
        printer_ip: barPrinter.ip,
        data: Array.from(receiptData),
        job_id: `receipt-bar-${order.id}-${Date.now()}`,
      });
      prints.receipt = true;
    }
  } else if (cassa === 'casetta') {
    // Cassa casetta: ricevuta solo su .208
    const receiptData = printer.buildReceipt(order);
    const casettaPrinter = config.PRINTERS.find(p => p.id === 6);
    if (io && casettaPrinter) {
      emitToProxy('print', {
        printer_id: 6,
        printer_ip: casettaPrinter.ip,
        data: Array.from(receiptData),
        job_id: `receipt-casetta-${order.id}-${Date.now()}`,
      });
      prints.receipt = true;
    }
  } else {
    // Cassa generale: flusso completo

    // 1. Ricevuta → vretti .203 (printer #1)
    const receiptData = printer.buildReceipt(order);
    const receiptPrinter = config.PRINTERS.find(p => p.id === 1);
    if (io && receiptPrinter) {
      emitToProxy('print', {
        printer_id: 1,
        printer_ip: receiptPrinter.ip,
        data: Array.from(receiptData),
        job_id: `receipt-${order.id}-${Date.now()}`,
      });
      prints.receipt = true;
    }

    // 2. Comanda cibo → Fuhuihe .205 (printer #3)
    if (hasFood) {
      const foodData = printer.buildFoodOrder(order);
      const foodPrinter = config.PRINTERS.find(p => p.id === 3);
      if (io && foodData && foodPrinter) {
        emitToProxy('print', {
          printer_id: 3,
          printer_ip: foodPrinter.ip,
          data: Array.from(foodData),
          job_id: `food-${order.id}-${Date.now()}`,
        });
        prints.food = true;
      }
    }

    // 3. Comanda bevande → Fuhuihe .204 (printer #2)
    //    STAMPA SEMPRE — tranne per ordini ASPORTO
    if (!order.asporto) {
      const drinkData = printer.buildDrinkOrder(order);
      const drinkPrinter = config.PRINTERS.find(p => p.id === 2);
      if (io && drinkData && drinkPrinter) {
        emitToProxy('print', {
          printer_id: 2,
          printer_ip: drinkPrinter.ip,
          data: Array.from(drinkData),
          job_id: `drink-${order.id}-${Date.now()}`,
        });
        prints.drinks = true;
      }
    }

    // 4. Piatti speciali → Fuhuihe .207 (printer #5)
    if (hasSpecial) {
      const specialData = printer.buildSpecialOrder(order);
      const specialPrinter = config.PRINTERS.find(p => p.id === 5);
      if (io && specialData && specialPrinter) {
        emitToProxy('print', {
          printer_id: 5,
          printer_ip: specialPrinter.ip,
          data: Array.from(specialData),
          job_id: `special-${order.id}-${Date.now()}`,
        });
        prints.special = true;
      }
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
// LOGIN UNIFICATO — PIN per ruolo
// =============================================

router.post('/login', (req, res) => {
  const { pin } = req.body;
  const pinConfig = config.PINS[pin];

  if (!pinConfig) {
    return res.status(403).json({ error: 'PIN errato' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, {
    role: pinConfig.role,
    created: Date.now(),
    expires: Date.now() + 12 * 60 * 60 * 1000,
  });

  const response = {
    success: true,
    token,
    role: pinConfig.role,
    redirect: pinConfig.redirect,
    sidebar: pinConfig.sidebar,
  };

  // Per il ruolo operatore, invia anche le destinazioni possibili
  if (pinConfig.destinations) {
    response.destinations = pinConfig.destinations;
  }

  res.json(response);
});

// Mantieni compatibilità — vecchio endpoint admin/login usa stessi PIN
router.post('/admin/login', (req, res) => {
  const { pin } = req.body;
  const pinConfig = config.PINS[pin];

  if (!pinConfig || pinConfig.role !== 'admin') {
    return res.status(403).json({ error: 'PIN errato' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, {
    role: 'admin',
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

// Calcola il recap della serata corrente (usato dall'endpoint e dal salvataggio archivio)
function computeRecap() {
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

  const discountTotal = orders.reduce((sum, o) => sum + (o.discount || 0), 0);

  // Commissioni POS (0.2%)
  const posRevenue = revenueByPayment['pos'] || 0;
  const posCommissionRate = config.POS_COMMISSION_RATE || 0.002;
  const posCommission = Math.round(posRevenue * posCommissionRate * 100) / 100;

  // Coperti totali (esclusi annullati) e ordini asporto
  const validOrders = orders.filter(o => o.status !== 'cancelled');
  const totalCoperti = validOrders.reduce((sum, o) => sum + (o.coperti || 0), 0);
  const totalAsporto = validOrders.filter(o => o.asporto).length;

  return {
    totalOrders,
    totalRevenue,
    totalCoperti,
    totalAsporto,
    salesRanking,
    ordersByHour,
    avgCompletionTime: Math.round(avgTime / 1000),
    revenueByCassa,
    revenueByPayment,
    posCommission,
    posCommissionRate,
    inventoryReport,
    incompleteOrders: incomplete.length,
    incompleteDetails: incomplete,
    courtesy,
    discountTotal,
  };
}

// Unisce un nuovo recap dentro uno esistente (stessa giornata, piu' chiusure)
function mergeRecap(target, source) {
  target.totalOrders += source.totalOrders;
  target.totalRevenue += source.totalRevenue;
  target.totalCoperti = (target.totalCoperti || 0) + (source.totalCoperti || 0);
  target.totalAsporto = (target.totalAsporto || 0) + (source.totalAsporto || 0);
  target.discountTotal += source.discountTotal;
  target.incompleteOrders += source.incompleteOrders;
  target.incompleteDetails = (target.incompleteDetails || []).concat(source.incompleteDetails || []);

  // Tempo medio evasione: media pesata
  if (source.avgCompletionTime > 0) {
    if (target.avgCompletionTime > 0) {
      const tOld = target.totalOrders - source.totalOrders;
      target.avgCompletionTime = Math.round(
        (target.avgCompletionTime * tOld + source.avgCompletionTime * source.totalOrders) / target.totalOrders
      );
    } else {
      target.avgCompletionTime = source.avgCompletionTime;
    }
  }

  // Classifica vendite: somma quantita' e ricavi per piatto
  const salesMap = {};
  (target.salesRanking || []).forEach(i => { salesMap[i.id] = { ...i }; });
  (source.salesRanking || []).forEach(i => {
    if (salesMap[i.id]) {
      salesMap[i.id].qty += i.qty;
      salesMap[i.id].revenue += i.revenue;
    } else {
      salesMap[i.id] = { ...i };
    }
  });
  target.salesRanking = Object.values(salesMap).sort((a, b) => b.qty - a.qty);

  // Distribuzione oraria: somma ordini per ora
  Object.entries(source.ordersByHour || {}).forEach(([h, count]) => {
    target.ordersByHour[h] = (target.ordersByHour[h] || 0) + count;
  });

  // Incassi per cassa e per pagamento
  Object.entries(source.revenueByCassa || {}).forEach(([k, v]) => {
    target.revenueByCassa[k] = (target.revenueByCassa[k] || 0) + v;
  });
  Object.entries(source.revenueByPayment || {}).forEach(([k, v]) => {
    target.revenueByPayment[k] = (target.revenueByPayment[k] || 0) + v;
  });

  // Ricalcola commissioni POS dopo merge
  const posRev = target.revenueByPayment['pos'] || 0;
  const rate = config.POS_COMMISSION_RATE || 0.002;
  target.posCommission = Math.round(posRev * rate * 100) / 100;
  target.posCommissionRate = rate;

  // Magazzino: usa i dati piu' recenti (il source ha lo stato aggiornato)
  if (source.inventoryReport && source.inventoryReport.length > 0) {
    const invMap = {};
    (target.inventoryReport || []).forEach(i => { invMap[i.id] = { ...i }; });
    source.inventoryReport.forEach(i => {
      if (invMap[i.id]) {
        invMap[i.id].sold += i.sold;
        invMap[i.id].remaining = i.remaining;
        invMap[i.id].status = i.status;
      } else {
        invMap[i.id] = { ...i };
      }
    });
    target.inventoryReport = Object.values(invMap);
  }

  // Omaggi: somma per tipo
  const courtesyTypes = ['sponsor', 'don_pierino', 'amici'];
  courtesyTypes.forEach(type => {
    if (source.courtesy && source.courtesy[type]) {
      if (!target.courtesy[type]) target.courtesy[type] = { count: 0, realValue: 0 };
      target.courtesy[type].count += source.courtesy[type].count;
      target.courtesy[type].realValue += source.courtesy[type].realValue;
    }
  });
  if (target.courtesy) {
    target.courtesy.total = {
      count: courtesyTypes.reduce((sum, t) => sum + (target.courtesy[t] ? target.courtesy[t].count : 0), 0),
      realValue: courtesyTypes.reduce((sum, t) => sum + (target.courtesy[t] ? target.courtesy[t].realValue : 0), 0),
    };
  }
}

router.get('/admin/stats/recap', requireAdmin, (req, res) => {
  res.json(computeRecap());
});

// Lista serate archiviate (per il selettore nel recap)
router.get('/admin/sessions', requireAdmin, (req, res) => {
  const list = archivedSessions.map(s => ({
    id: s.id,
    date: s.date,
    closed_at: s.closed_at,
    totalOrders: s.recap.totalOrders,
    totalRevenue: s.recap.totalRevenue,
  }));
  // Ordina dalla piu' recente alla piu' vecchia
  list.sort((a, b) => b.closed_at - a.closed_at);
  res.json(list);
});

// Recap di una serata archiviata specifica
router.get('/admin/sessions/:id/recap', requireAdmin, (req, res) => {
  const session = archivedSessions.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Serata non trovata' });
  }
  res.json({ ...session.recap, _sessionDate: session.date });
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
// INVENTARIO — PRESET (salva/carica configurazioni scorte)
// =============================================

// Preset caricati da DB
const inventoryPresets = db.getPresets();

// Salva preset: snapshot delle scorte attuali con un nome
router.post('/inventory/presets', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Specificare un nome per il preset' });
  }

  const snapshot = {};
  Object.values(inventory).forEach(item => {
    snapshot[item.id] = item.stock;
  });

  const savedAt = Date.now();
  inventoryPresets[name] = { name, stocks: snapshot, saved_at: savedAt };
  db.savePreset(name, snapshot, savedAt);
  res.json({ success: true, preset: inventoryPresets[name] });
});

// Lista preset salvati
router.get('/inventory/presets', requireAdmin, (req, res) => {
  res.json(Object.values(inventoryPresets));
});

// Carica preset: ripristina le scorte dal preset salvato
router.post('/inventory/presets/:name/load', requireAdmin, (req, res) => {
  const preset = inventoryPresets[req.params.name];
  if (!preset) {
    return res.status(404).json({ error: 'Preset non trovato' });
  }

  Object.entries(preset.stocks).forEach(([id, stock]) => {
    if (inventory[id]) {
      inventory[id].stock = stock;
      updateInventoryStatus(id);
    }
  });

  if (io) {
    io.emit('inventory_reset', Object.values(inventory));
  }

  res.json({ success: true, inventory: Object.values(inventory) });
});

// Elimina preset
router.delete('/inventory/presets/:name', requireAdmin, (req, res) => {
  if (!inventoryPresets[req.params.name]) {
    return res.status(404).json({ error: 'Preset non trovato' });
  }
  delete inventoryPresets[req.params.name];
  db.deletePreset(req.params.name);
  res.json({ success: true });
});

// =============================================
// MAGAZZINO MATERIALI — Inventario consumabili (bicchieri, posate, ecc.)
// Nessun legame con menu o casse
// =============================================

const warehouse = db.getWarehouse();

router.get('/warehouse', requireAdmin, (req, res) => {
  res.json(Object.values(warehouse));
});

// Export CSV
router.get('/warehouse/export', requireAdmin, (req, res) => {
  const items = Object.values(warehouse);
  const header = 'nome,categoria,quantita,totale,soglia_allarme,ultimo_aggiornamento';
  const rows = items.map(i => {
    const updatedAt = i.updated_at ? new Date(i.updated_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : '';
    return [
      '"' + (i.name || '').replace(/"/g, '""') + '"',
      '"' + (i.category || '').replace(/"/g, '""') + '"',
      i.quantity || 0,
      i.total || 0,
      i.alert_threshold !== null && i.alert_threshold !== undefined ? i.alert_threshold : '',
      '"' + updatedAt + '"',
    ].join(',');
  });
  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="magazzino_' + new Date().toISOString().slice(0, 10) + '.csv"');
  res.send(csv);
});

// Import CSV
router.post('/warehouse/import', requireAdmin, (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Nessun dato da importare' });
  }
  let imported = 0;
  rows.forEach(row => {
    if (!row.nome || !row.nome.trim()) return;
    const id = row.nome.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const item = warehouse[id] || { id, created_at: Date.now() };
    item.name = row.nome.trim();
    item.category = row.categoria ? row.categoria.trim() : item.category || null;
    item.quantity = row.quantita !== undefined && row.quantita !== '' ? parseInt(row.quantita) : (item.quantity || 0);
    item.total = row.totale !== undefined && row.totale !== '' ? parseInt(row.totale) : (item.total || 0);
    item.alert_threshold = row.soglia_allarme !== undefined && row.soglia_allarme !== '' ? parseInt(row.soglia_allarme) : (item.alert_threshold || null);
    item.updated_at = Date.now();
    warehouse[id] = item;
    db.saveWarehouseItem(item);
    imported++;
  });
  if (io) io.emit('warehouse_updated', { action: 'bulk_import' });
  res.json({ success: true, imported });
});

router.post('/warehouse', requireAdmin, (req, res) => {
  const { name, quantity, total, alert_threshold } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Nome obbligatorio' });
  }

  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (warehouse[id]) {
    return res.status(409).json({ error: 'Articolo con questo nome esiste gia\'' });
  }

  const item = {
    id,
    name: name.trim(),
    quantity: parseInt(quantity) || 0,
    total: parseInt(total) || parseInt(quantity) || 0,
    alert_threshold: alert_threshold !== undefined && alert_threshold !== null && alert_threshold !== '' ? parseInt(alert_threshold) : null,
    category: req.body.category ? String(req.body.category).trim() : null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  warehouse[id] = item;
  db.saveWarehouseItem(item);

  if (io) io.emit('warehouse_updated', { action: 'added', item });
  res.status(201).json(item);
});

router.put('/warehouse/:id', requireAdmin, (req, res) => {
  const item = warehouse[req.params.id];
  if (!item) return res.status(404).json({ error: 'Articolo non trovato' });

  const { name, quantity, total, alert_threshold, category } = req.body;
  if (name !== undefined) item.name = String(name).trim();
  if (quantity !== undefined) item.quantity = Math.max(0, parseInt(quantity));
  if (total !== undefined) item.total = Math.max(0, parseInt(total));
  if (alert_threshold !== undefined) item.alert_threshold = alert_threshold !== null && alert_threshold !== '' ? parseInt(alert_threshold) : null;
  if (category !== undefined) item.category = category ? String(category).trim() : null;
  item.updated_at = Date.now();

  db.saveWarehouseItem(item);
  if (io) io.emit('warehouse_updated', { action: 'updated', item });
  res.json(item);
});

router.post('/warehouse/:id/adjust', requireAdmin, (req, res) => {
  const item = warehouse[req.params.id];
  if (!item) return res.status(404).json({ error: 'Articolo non trovato' });

  const { delta } = req.body;
  if (delta === undefined || isNaN(delta)) {
    return res.status(400).json({ error: 'Specificare delta numerico' });
  }

  item.quantity = Math.max(0, item.quantity + parseInt(delta));
  item.updated_at = Date.now();
  db.updateWarehouseQty(item.id, item.quantity);
  if (io) io.emit('warehouse_updated', { action: 'adjusted', item });
  res.json(item);
});

router.delete('/warehouse/:id', requireAdmin, (req, res) => {
  if (!warehouse[req.params.id]) {
    return res.status(404).json({ error: 'Articolo non trovato' });
  }
  const removed = warehouse[req.params.id];
  delete warehouse[req.params.id];
  db.deleteWarehouseItem(req.params.id);
  if (io) io.emit('warehouse_updated', { action: 'deleted', item: removed });
  res.json({ success: true });
});

// =============================================
// RESET COMPLETO (per test — azzera ordini, contatori e scorte)
// =============================================

router.post('/admin/reset', requireAdmin, (req, res) => {
  // Salva snapshot della serata corrente nell'archivio (solo se ci sono ordini)
  if (orders.length > 0) {
    const recap = computeRecap();
    const now = new Date();
    // Usa la data del primo ordine come data della serata (piu' accurato)
    const sessionDate = orders.length > 0
      ? new Date(orders[0].created_at).toISOString().slice(0, 10)
      : now.toISOString().slice(0, 10);

    // Se esiste gia' un archivio per la stessa data, unisci i dati
    const existing = archivedSessions.find(s => s.date === sessionDate);
    if (existing) {
      mergeRecap(existing.recap, recap);
      existing.closed_at = now.getTime();
      db.updateArchivedSession(existing.id, existing.closed_at, existing.recap);
      console.log(`[Admin] Serata ${sessionDate} aggiornata (${existing.recap.totalOrders} ordini totali, €${existing.recap.totalRevenue.toFixed(2)})`);
    } else {
      const session = {
        id: 'session_' + now.getTime(),
        date: sessionDate,
        closed_at: now.getTime(),
        recap,
      };
      archivedSessions.push(session);
      db.insertArchivedSession(session);
      console.log(`[Admin] Serata ${sessionDate} archiviata (${recap.totalOrders} ordini, €${recap.totalRevenue.toFixed(2)})`);
    }
  }

  // Azzera ordini
  orders.length = 0;
  orderCounter = 0;
  db.deleteAllOrders();
  db.setOrderCounter(0);

  // Azzera contatori monitor cuochi
  config.MONITOR_ITEMS.forEach(item => {
    counters[item].pronto = 0;
    counters[item].vendute = 0;
    counters[item].evasi = 0;
  });
  db.resetCounters();

  // Resetta scorte ai valori iniziali
  config.MENU.forEach(menuItem => {
    const item = inventory[menuItem.id];
    if (item) {
      item.stock = menuItem.initial_stock || 999;
      item.status = 'available';
      db.updateInventoryStock(menuItem.id, item.stock, item.status);
    }
  });

  if (io) {
    io.emit('counters_changed', { counters, total_coperti: computeTotalCoperti() });
    io.emit('inventory_reset', Object.values(inventory));
  }

  console.log('[Admin] Reset completo eseguito');
  res.json({ success: true });
});

// =============================================
// ORDINI DI TEST (per generare dati nelle dashboard admin)
// =============================================

router.post('/orders/test', (req, res) => {
  orderCounter++;
  db.setOrderCounter(orderCounter);

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
          db.saveCounter(piece, counters[piece]);
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
  db.insertOrder(order);

  if (io) {
    io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters, total_coperti: computeTotalCoperti() });
    io.emit('order_created', order);
    io.to('admin').emit('stats_update', { type: 'new_order', order });
  }

  res.json({ success: true, order });
});

// Funzione per persistere un contatore su DB (chiamata da index.js per lo scaldavivande)
function persistCounter(item) {
  if (counters[item]) db.saveCounter(item, counters[item]);
}

module.exports = {
  router, setIO, counters, inventory, orders,
  setActiveProxyId: (id) => { activeProxyId = id; },
  flushPrintQueue,
  computeTotalCoperti,
  persistCounter,
};

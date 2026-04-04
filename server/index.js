const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./config');
const { router: apiRouter, setIO, counters, inventory, setActiveProxyId } = require('./routes/api');

const app = express();
const server = http.createServer(app);

// Socket.IO con CORS aperto (per il test, in produzione restringere)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Passa il riferimento io al modulo API
setIO(io);

// --- Middleware ---
app.use(cors());
app.use(express.json());

// File statici dalla cartella public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', apiRouter);

// --- Route per le pagine HTML ---
// Express serve già i file statici, ma aggiungiamo route esplicite
// per URL puliti senza .html

app.get('/monitor', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'monitor.html'));
});

app.get('/scaldavivande', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'scaldavivande.html'));
});

// Mantieni compatibilità con il vecchio URL
app.get('/passapiatti', (req, res) => {
  res.redirect('/scaldavivande');
});

app.get('/controllo', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'controllo.html'));
});

app.get('/cassa', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cassa.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin/recap', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-recap.html'));
});

app.get('/admin/magazzino', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-magazzino.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html'));
});

// --- Socket.IO: gestione connessioni ---

// Tiene traccia dei dispositivi connessi per tipo
const connectedDevices = {
  dashboard: new Set(),
  monitor: new Set(),
  scaldavivande: new Set(),
  controllo: new Set(),
  proxy: new Set(),
  admin: new Set(),
  cassa: new Set(),
};

io.on('connection', (socket) => {
  console.log(`[Socket] Nuova connessione: ${socket.id}`);
  let deviceRole = null;

  // Registrazione del tipo di dispositivo
  socket.on('register', ({ role }) => {
    deviceRole = role;
    if (connectedDevices[role]) {
      connectedDevices[role].add(socket.id);
    }
    // Entra nella room corrispondente al ruolo
    socket.join(role);
    console.log(`[Socket] Dispositivo registrato: ${role} (${socket.id})`);

    // Invia lo stato aggiornato dei dispositivi a tutte le dashboard
    broadcastDeviceStatus();

    // Se è il proxy, registra come proxy attivo e invia config stampanti
    // Solo UN proxy alla volta riceve i comandi di stampa (evita duplicati)
    if (role === 'proxy') {
      setActiveProxyId(socket.id);
      console.log(`[Proxy] Proxy attivo impostato: ${socket.id}`);
      socket.emit('printer_config', config.PRINTERS);
    }

    // Invia i contatori attuali ai nuovi monitor/scaldavivande
    if (role === 'monitor' || role === 'scaldavivande') {
      socket.emit('counters_changed', { counters });
    }
  });

  // --- Scaldavivande: aggiornamento contatori (colonna "pronto") ---
  socket.on('counter_update', ({ item, delta }) => {
    if (counters[item] !== undefined) {
      counters[item].pronto = Math.max(0, counters[item].pronto + delta);
      // Broadcast a monitor e scaldavivande
      io.to('monitor').to('scaldavivande').to('dashboard').to('admin').emit('counters_changed', { counters });
    }
  });

  // --- Zona controllo: evasione ordine ---
  socket.on('order_fulfilled', ({ order_number }) => {
    console.log(`[Controllo] Evasione ordine: ${order_number}`);
    // Il risultato viene gestito via API REST, qui facciamo broadcast
    io.to('dashboard').to('admin').emit('order_fulfilled_broadcast', { order_number });
  });

  // --- Print proxy: risultato stampa ---
  socket.on('print_result', ({ job_id, success, error }) => {
    console.log(`[Stampa] Job ${job_id}: ${success ? 'OK' : 'ERRORE'} ${error || ''}`);
    // Notifica le dashboard
    io.to('dashboard').emit('print_result', { job_id, success, error });
  });

  // --- Print proxy: stato stampanti (risultato ping) ---
  socket.on('printer_status', (statuses) => {
    // Aggiorna lo stato delle stampanti nella config
    statuses.forEach(({ id, online }) => {
      const p = config.PRINTERS.find(pr => pr.id === id);
      if (p) {
        p._online = online;
        p._lastCheck = Date.now();
      }
    });
    // Notifica le dashboard
    io.to('dashboard').emit('printers_status_update', statuses);
  });

  // --- Richiesta ping stampanti (dalla dashboard al proxy) ---
  socket.on('request_printer_check', () => {
    io.to('proxy').emit('check_printers');
  });

  // --- Disconnessione ---
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnesso: ${socket.id} (${deviceRole || 'sconosciuto'})`);
    if (deviceRole && connectedDevices[deviceRole]) {
      connectedDevices[deviceRole].delete(socket.id);
    }
    // Se si disconnette il proxy attivo, prova a usarne un altro dalla room
    if (deviceRole === 'proxy') {
      const remaining = connectedDevices.proxy;
      if (remaining.size > 0) {
        const nextProxy = remaining.values().next().value;
        setActiveProxyId(nextProxy);
        console.log(`[Proxy] Proxy attivo cambiato a: ${nextProxy}`);
      } else {
        setActiveProxyId(null);
        console.log('[Proxy] Nessun proxy attivo');
      }
    }
    broadcastDeviceStatus();
  });
});

// Invia lo stato di tutti i dispositivi connessi alle dashboard
function broadcastDeviceStatus() {
  const devices = {};
  for (const [role, sockets] of Object.entries(connectedDevices)) {
    devices[role] = sockets.size;
  }
  io.to('dashboard').to('admin').emit('device_status', { devices });
}

// --- Avvio server ---
// 0.0.0.0 necessario per Railway/Render (non solo localhost)
server.listen(config.PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ==============================');
  console.log('  SagrApp — Test Hardware Server');
  console.log(`  Porta: ${config.PORT}`);
  console.log(`  http://localhost:${config.PORT}`);
  console.log('  ==============================');
  console.log('');
  console.log('  Pagine disponibili:');
  console.log(`    Dashboard test:   http://localhost:${config.PORT}/`);
  console.log(`    Monitor cuochi:   http://localhost:${config.PORT}/monitor`);
  console.log(`    Scaldavivande:    http://localhost:${config.PORT}/scaldavivande`);
  console.log(`    Zona controllo:   http://localhost:${config.PORT}/controllo`);
  console.log(`    Cassa test:       http://localhost:${config.PORT}/cassa`);
  console.log(`    Admin login:      http://localhost:${config.PORT}/admin/login`);
  console.log(`    Admin live:       http://localhost:${config.PORT}/admin`);
  console.log(`    Admin recap:      http://localhost:${config.PORT}/admin/recap`);
  console.log(`    Magazzino:        http://localhost:${config.PORT}/admin/magazzino`);
  console.log('');
});

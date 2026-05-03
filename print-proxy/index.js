// Print Proxy — gira sul PC all-in-one (cassa principale)
// Riceve comandi stampa dal server cloud via Socket.IO
// Li inoltra alle stampanti locali via TCP (LAN) porta 9100

const { io } = require('socket.io-client');
const net = require('net');
const os = require('os');
const config = require('./config');

console.log('');
console.log('  ================================');
console.log('  SagrApp — Print Proxy');
console.log(`  Modalità: ${config.MODE.toUpperCase()}`);
console.log(`  Server: ${config.SERVER_URL}`);
console.log(`  Sistema: ${os.platform()} (${os.hostname()})`);
console.log('  ================================');
console.log('  Uso: node index.js cloud|local');
console.log('');

// --- Connessione al server ---
const socket = io(config.SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

socket.on('connect', () => {
  console.log('[Proxy] Connesso al server');
  // Si registra come print proxy
  socket.emit('register', { role: 'proxy' });
});

socket.on('disconnect', (reason) => {
  console.log(`[Proxy] Disconnesso: ${reason}`);
});

socket.on('connect_error', (err) => {
  console.log(`[Proxy] Errore connessione: ${err.message}`);
});

// --- Configurazione stampanti ricevuta dal server ---
let printerConfig = [];

socket.on('printer_config', (printers) => {
  printerConfig = printers;
  console.log(`[Proxy] Configurazione stampanti ricevuta: ${printers.length} stampanti`);
  printers.forEach(p => {
    console.log(`  #${p.id} ${p.name} — ${p.ip}:${p.port}`);
  });
});

// --- Coda retry locale: job falliti vengono ritentati ---
const retryQueue = [];
const MAX_RETRIES = 5;
const RETRY_DELAY = 10000; // 10 secondi tra i tentativi

// Retry periodico dei job falliti
setInterval(() => {
  if (retryQueue.length === 0) return;
  const job = retryQueue.shift();
  console.log(`[Retry] Ritento job ${job.job_id} → ${job.printer_ip} (tentativo ${job.retries + 1}/${MAX_RETRIES})`);
  executePrint(job.printer_ip, job.data, job.job_id, job.retries + 1);
}, RETRY_DELAY);

// --- Comando stampa dal server (tutte LAN via TCP 9100) ---
socket.on('print', async ({ printer_ip, data, job_id }) => {
  console.log(`[Stampa] Job ${job_id} → ${printer_ip}`);
  executePrint(printer_ip, data, job_id, 0);
});

async function executePrint(printer_ip, data, job_id, retries) {
  try {
    const buffer = Buffer.from(data);
    await printToLAN(printer_ip, 9100, buffer);
    console.log(`[Stampa] Job ${job_id}: OK (${printer_ip})`);
    socket.emit('print_result', { job_id, success: true });
  } catch (err) {
    console.error(`[Stampa] Job ${job_id}: ERRORE — ${err.message}`);
    if (retries < MAX_RETRIES) {
      // Rimetti in coda per ritentare
      retryQueue.push({ printer_ip, data, job_id, retries });
      console.log(`[Stampa] Job ${job_id} rimesso in coda retry (${retryQueue.length} in coda)`);
    } else {
      console.error(`[Stampa] Job ${job_id}: ABBANDONATO dopo ${MAX_RETRIES} tentativi`);
      socket.emit('print_result', { job_id, success: false, error: err.message });
    }
  }
}

// --- Stampa via TCP (tutte le stampanti sono LAN) ---
function printToLAN(ip, port, data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(5000);

    client.connect(port, ip, () => {
      client.write(data, () => {
        client.end();
        resolve();
      });
    });

    client.on('error', (err) => {
      client.destroy();
      reject(new Error(`Errore TCP ${ip}:${port} — ${err.message}`));
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error(`Timeout connessione ${ip}:${port}`));
    });
  });
}

// --- TCP Ping: verifica se una stampante LAN è raggiungibile ---
// Restituisce { online, responseTime } — responseTime in ms (solo se online)
function tcpPing(ip, port, timeout = 2000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = new net.Socket();
    client.setTimeout(timeout);
    client.connect(port, ip, () => {
      const responseTime = Date.now() - start;
      client.destroy();
      resolve({ online: true, responseTime });
    });
    client.on('error', () => {
      client.destroy();
      resolve({ online: false, responseTime: null });
    });
    client.on('timeout', () => {
      client.destroy();
      resolve({ online: false, responseTime: null });
    });
  });
}

// --- Check periodico di tutte le stampanti ---
socket.on('check_printers', async () => {
  await checkAllPrinters();
});

async function checkAllPrinters() {
  const statuses = [];

  for (const printer of printerConfig) {
    const { online, responseTime } = await tcpPing(printer.ip, printer.port);
    statuses.push({
      id: printer.id,
      name: printer.name,
      ip: printer.ip,
      online,
      responseTime,  // ms se online, null se offline
    });
    const status = online ? `● Online (${responseTime}ms)` : '○ Offline';
    console.log(`[Check] #${printer.id} ${printer.name} (${printer.ip}:${printer.port}): ${status}`);
  }

  socket.emit('printer_status', statuses);
}

// Check periodico automatico
setInterval(() => {
  if (socket.connected && printerConfig.length > 0) {
    checkAllPrinters();
  }
}, config.CHECK_INTERVAL);

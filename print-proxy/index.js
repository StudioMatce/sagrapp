// Print Proxy — gira sul PC all-in-one (cassa principale)
// Riceve comandi stampa dal server cloud via Socket.IO
// Li inoltra alle stampanti locali via TCP (LAN) o USB

const { io } = require('socket.io-client');
const net = require('net');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
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
    const conn = p.type === 'usb' ? 'USB' : `${p.ip}:${p.port}`;
    console.log(`  #${p.id} ${p.name} — ${conn}`);
  });
});

// --- Comando stampa dal server ---
socket.on('print', async ({ printer_id, printer_ip, printer_type, data, job_id }) => {
  console.log(`[Stampa] Job ${job_id} → stampante #${printer_id} (${printer_type})`);

  try {
    const buffer = Buffer.from(data);

    if (printer_type === 'lan') {
      // Stampante LAN — connessione TCP diretta porta 9100
      await printToLAN(printer_ip, 9100, buffer);
      console.log(`[Stampa] Job ${job_id}: OK (LAN → ${printer_ip})`);
      socket.emit('print_result', { job_id, success: true });

    } else if (printer_type === 'usb') {
      // Stampante USB — scrittura diretta
      await printToUSB(buffer);
      console.log(`[Stampa] Job ${job_id}: OK (USB)`);
      socket.emit('print_result', { job_id, success: true });

    } else {
      throw new Error(`Tipo stampante non supportato: ${printer_type}`);
    }
  } catch (err) {
    console.error(`[Stampa] Job ${job_id}: ERRORE — ${err.message}`);
    socket.emit('print_result', { job_id, success: false, error: err.message });
  }
});

// --- Stampa via TCP (stampanti LAN) ---
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

// --- Stampa via USB (stampante Custom) ---
async function printToUSB(data) {
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: scrive un file temporaneo e lo copia sulla stampante condivisa
    const tmpDir = 'C:\\temp';
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const tmpFile = `${tmpDir}\\sagrapp_print_${Date.now()}.bin`;
    fs.writeFileSync(tmpFile, data);

    try {
      const shareName = config.USB_PRINTER.windows_share_name;
      execSync(`copy /b "${tmpFile}" "\\\\localhost\\${shareName}"`, { shell: true });
    } finally {
      // Pulizia file temporaneo
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  } else {
    // Linux/Mac: scrive direttamente al device USB
    const device = config.USB_PRINTER.unix_device;
    if (!fs.existsSync(device)) {
      throw new Error(`Device USB non trovato: ${device}`);
    }
    fs.writeFileSync(device, data);
  }
}

// --- TCP Ping: verifica se una stampante LAN è raggiungibile ---
function tcpPing(ip, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(timeout);
    client.connect(port, ip, () => {
      client.destroy();
      resolve(true);
    });
    client.on('error', () => {
      client.destroy();
      resolve(false);
    });
    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

// --- Check stampante USB ---
function checkUSBPrinter() {
  try {
    const platform = os.platform();
    if (platform === 'win32') {
      // Verifica che la stampante condivisa esista su Windows
      execSync('net view \\\\localhost', { shell: true, stdio: 'pipe' });
      return true;
    } else {
      return fs.existsSync(config.USB_PRINTER.unix_device);
    }
  } catch {
    return false;
  }
}

// --- Check periodico di tutte le stampanti ---
socket.on('check_printers', async () => {
  await checkAllPrinters();
});

async function checkAllPrinters() {
  const statuses = [];

  for (const printer of printerConfig) {
    let online = false;

    if (printer.type === 'lan') {
      online = await tcpPing(printer.ip, printer.port);
    } else if (printer.type === 'usb') {
      online = checkUSBPrinter();
    }

    statuses.push({ id: printer.id, online });
    const status = online ? '● Online' : '○ Offline';
    const conn = printer.type === 'usb' ? 'USB' : `${printer.ip}:${printer.port}`;
    console.log(`[Check] #${printer.id} ${printer.name} (${conn}): ${status}`);
  }

  socket.emit('printer_status', statuses);
}

// Check periodico automatico
setInterval(() => {
  if (socket.connected && printerConfig.length > 0) {
    checkAllPrinters();
  }
}, config.CHECK_INTERVAL);

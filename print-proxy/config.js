// ============================================
// SWITCH CLOUD / LOCALE
// ============================================
// Per cambiare server basta avviare il proxy con:
//
//   node index.js cloud     ← usa il server su Railway
//   node index.js local     ← usa il server locale (backup)
//   node index.js           ← default: cloud
//
// Oppure impostare la variabile d'ambiente:
//   SERVER_URL=http://localhost:3000 node index.js

const SERVERS = {
  // Inserisci qui l'URL di Railway dopo il deploy
  cloud: process.env.SERVER_URL || 'https://sagrapp.up.railway.app',
  local: 'http://localhost:3000',
};

// Legge il parametro dalla riga di comando: "cloud" o "local"
const mode = process.argv[2] || 'cloud';
const SERVER_URL = SERVERS[mode] || SERVERS.cloud;

module.exports = {
  SERVER_URL,
  MODE: mode,

  // Stampante USB — configurazione
  USB_PRINTER: {
    windows_share_name: 'CustomPOS',
    unix_device: '/dev/usb/lp0',
  },

  // Intervallo check stampanti (ms)
  CHECK_INTERVAL: 10000,
};

// Servizio di stampa ESC/POS — comandi raw via Buffer
// NON usiamo librerie esterne, tutto implementato direttamente

const ESC = 0x1B;
const GS = 0x1D;

// --- Comandi base ---
const INIT = Buffer.from([ESC, 0x40]);
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
const DOUBLE_BOTH = Buffer.from([GS, 0x21, 0x11]);
const NORMAL_SIZE = Buffer.from([GS, 0x21, 0x00]);
const CUT = Buffer.from([GS, 0x56, 0x00]);
const FEED = Buffer.from([ESC, 0x64, 0x05]);

// Separatore largo 32 caratteri (80mm standard)
const LINE = '================================';

// Barcode Code 128
function barcodeCmd(data) {
  return Buffer.from([
    GS, 0x68, 80,        // Altezza barcode: 80 dots
    GS, 0x77, 2,         // Larghezza barcode: 2
    GS, 0x48, 2,         // Testo HRI sotto il barcode
    GS, 0x6B, 73,        // Tipo: Code 128
    data.length,          // Lunghezza dati
    ...Buffer.from(data),
  ]);
}

// Converte una stringa in Buffer (encoding latin1 per caratteri speciali àèìòù €)
function text(str) {
  return Buffer.from(str + '\n', 'latin1');
}

// Concatena più Buffer in uno solo
function concat(...parts) {
  return Buffer.concat(parts);
}

// --- Pagine di stampa di test ---

// Stampa test per la stampante Custom (ricevuta cassa, USB)
function buildTestPageCassa() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    ALIGN_CENTER,
    BOLD_ON, DOUBLE_BOTH, text(LINE),
    NORMAL_SIZE, BOLD_ON, text('   ★ SAGRAPP — TEST STAMPA ★'),
    text(LINE),
    BOLD_OFF, NORMAL_SIZE,
    ALIGN_LEFT,
    text(''),
    text('Stampante: Custom (Ricevuta Cassa)'),
    text('Connessione: USB'),
    text(`Data: ${now}`),
    text(''),
    text('Questa stampante funziona'),
    text('correttamente!'),
    text(''),
    text('Test caratteri speciali:'),
    text('àèìòù ÀÈÌÒÙ €'),
    text(''),
    ALIGN_CENTER,
    text(LINE),
    text('    Larghezza: 80mm'),
    text('    |||||||||||||||||||||||||||'),
    text('    (barre allineamento)'),
    text(LINE),
    FEED, CUT,
  );
}

// Stampa test per vretti (comanda cibo, LAN) — include barcode
function buildTestPageCibo() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  COMANDA CIBO — TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text(`Stampante: vretti 80mm (LAN)`),
    text(`IP: 192.168.1.202`),
    text(`Data: ${now}`),
    text(`Ordine: TEST-001`),
    text(`Tavolo: 99`),
    text(''),
    text('1x Bistecca test'),
    text('1x Pasta test'),
    text('1x Birra test'),
    text(''),
    ALIGN_CENTER,
    barcodeCmd('TEST-001'),
    text(''),
    text(LINE),
    FEED, CUT,
  );
}

// Stampa test per Fuhuihe (comanda bevande, LAN)
function buildTestPageBevande() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  COMANDA BEVANDE — TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text(`Stampante: Fuhuihe POS (LAN)`),
    text(`IP: 192.168.1.204`),
    text(`Data: ${now}`),
    text(`Ordine: TEST-002`),
    text(''),
    text('2x Birra media test'),
    text('1x Coca Cola test'),
    text('1x Acqua test'),
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );
}

// Stampa barcode di test (sulla vretti, stampante #2)
function buildTestBarcodePage(code) {
  return concat(
    INIT,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  BARCODE TEST'),
    text(LINE),
    BOLD_OFF,
    text(''),
    text(`Codice: ${code}`),
    text(''),
    barcodeCmd(code),
    text(''),
    text(LINE),
    FEED, CUT,
  );
}

// Ritorna la pagina di test corretta per ogni stampante
function buildTestPage(printerId) {
  switch (printerId) {
    case 1: return buildTestPageCassa();
    case 2: return buildTestPageCibo();
    case 3: return buildTestPageBevande();
    default: return buildTestPageCassa();
  }
}

module.exports = {
  buildTestPage,
  buildTestBarcodePage,
};

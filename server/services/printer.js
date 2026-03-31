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
// Selezione code page — la Fuhuihe ne ha bisogno per stampare testo
const CODEPAGE_CP437 = Buffer.from([ESC, 0x74, 0x00]);

// Separatore largo 32 caratteri (80mm standard)
const LINE = '================================';

// Converte una stringa in Buffer (encoding latin1 per caratteri speciali)
function text(str) {
  return Buffer.from(str + '\n', 'latin1');
}

// Concatena più Buffer in uno solo
function concat(...parts) {
  return Buffer.concat(parts);
}

// --- Pagine di stampa di test per ogni stampante ---

// #1 vretti (Ricevuta cassa generale) — LAN .203
function buildTestPage1() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    ALIGN_CENTER,
    BOLD_ON, DOUBLE_BOTH, text(LINE),
    NORMAL_SIZE, BOLD_ON, text('   SAGRAPP - TEST STAMPA'),
    text(LINE),
    BOLD_OFF, NORMAL_SIZE,
    ALIGN_LEFT,
    text(''),
    text('Stampante: vretti (Ricevuta Cassa)'),
    text('Connessione: LAN (192.168.1.203)'),
    text(`Data: ${now}`),
    text(''),
    text('Questa stampante funziona'),
    text('correttamente!'),
    text(''),
    text('Test caratteri speciali:'),
    text('abcdefg ABCDEFG 12345'),
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

// #2 Fuhuihe (Comanda bevande) — LAN .204
function buildTestPage2() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  COMANDA BEVANDE - TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text('Stampante: Fuhuihe POS (LAN)'),
    text('IP: 192.168.1.204'),
    text(`Data: ${now}`),
    text('Ordine: TEST-002'),
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

// #3 Fuhuihe (Comanda cibo) — LAN .205
function buildTestPage3() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  COMANDA CIBO - TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text('Stampante: Fuhuihe POS (LAN)'),
    text('IP: 192.168.1.205'),
    text(`Data: ${now}`),
    text('Ordine: TEST-001'),
    text('Tavolo: 99'),
    text(''),
    text('1x Bistecca test'),
    text('1x Pasta test'),
    text('1x Birra test'),
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );
}

// #4 Fuhuihe (Ricevuta cassa bar) — LAN .206
function buildTestPage4() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  RICEVUTA CASSA BAR - TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text('Stampante: Fuhuihe POS (LAN)'),
    text('IP: 192.168.1.206'),
    text(`Data: ${now}`),
    text(''),
    text('2x Birra media       8.00'),
    text('1x Coca Cola         3.00'),
    text(''),
    text('TOTALE:             11.00'),
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );
}

// #5 Fuhuihe (Piatti speciali) — LAN .207
function buildTestPage5() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  PIATTI SPECIALI - TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text('Stampante: Fuhuihe POS (LAN)'),
    text('IP: 192.168.1.207'),
    text(`Data: ${now}`),
    text('Ordine: TEST-003'),
    text(''),
    text('1x Piatto speciale test'),
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );
}

// #6 Fuhuihe (Casetta aperitivi) — LAN .208
function buildTestPage6() {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  return concat(
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    text('  CASETTA APERITIVI - TEST'),
    text(LINE),
    BOLD_OFF,
    ALIGN_LEFT,
    text('Stampante: Fuhuihe POS (LAN)'),
    text('IP: 192.168.1.208'),
    text(`Data: ${now}`),
    text(''),
    text('1x Spritz test'),
    text('1x Aperol test'),
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );
}

// Ritorna la pagina di test corretta per ogni stampante
function buildTestPage(printerId) {
  switch (printerId) {
    case 1: return buildTestPage1();
    case 2: return buildTestPage2();
    case 3: return buildTestPage3();
    case 4: return buildTestPage4();
    case 5: return buildTestPage5();
    case 6: return buildTestPage6();
    default: return buildTestPage1();
  }
}

// --- Generazione stampe per ordini reali ---

// Allinea due stringhe ai bordi opposti su 32 caratteri (larghezza 80mm)
function padLine(left, right) {
  const space = 32 - left.length - right.length;
  return left + ' '.repeat(Math.max(1, space)) + right;
}

// Ricevuta cassa generale — vretti .203 (printer #1)
function buildReceipt(order) {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const parts = [
    INIT,
    ALIGN_CENTER,
    BOLD_ON, DOUBLE_BOTH, text('SAGRA'),
    NORMAL_SIZE, BOLD_OFF,
    text(LINE),
    BOLD_ON, text(`ORDINE #${order.id}`),
    BOLD_OFF,
    text(`Tavolo: ${order.table}`),
    text(now),
    text(LINE),
    ALIGN_LEFT,
    text(''),
  ];

  order.items.forEach(item => {
    const desc = `${item.qty}x ${item.name}`;
    const price = (item.price * item.qty).toFixed(2);
    parts.push(text(padLine(desc, price)));
  });

  parts.push(
    text(''),
    text(LINE),
    BOLD_ON,
    text(padLine('TOTALE', order.total.toFixed(2))),
    BOLD_OFF,
    text(LINE),
    ALIGN_CENTER,
    text(''),
    text('Grazie e buon appetito!'),
    text(''),
    FEED, CUT,
  );

  return Buffer.concat(parts);
}

// Comanda cibo — Fuhuihe .205 (printer #3)
// Testo in DOUBLE per leggibilità in cucina
function buildFoodOrder(order) {
  const foodItems = order.items.filter(i => i.category === 'cibo');
  if (foodItems.length === 0) return null;

  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const parts = [
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    DOUBLE_BOTH, text('COMANDA CIBO'),
    NORMAL_SIZE, BOLD_ON,
    text(LINE),
    BOLD_OFF,
    text(`Ordine #${order.id}  Tavolo ${order.table}`),
    text(now),
    text(LINE),
    ALIGN_LEFT,
    text(''),
  ];

  foodItems.forEach(item => {
    parts.push(BOLD_ON, DOUBLE_BOTH);
    parts.push(text(`  ${item.qty}x ${item.name}`));
    parts.push(NORMAL_SIZE, BOLD_OFF);
  });

  parts.push(
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );

  return Buffer.concat(parts);
}

// Comanda bevande — Fuhuihe .204 (printer #2)
// Ritorna null se non ci sono bevande nell'ordine
function buildDrinkOrder(order) {
  const drinkItems = order.items.filter(i => i.category === 'bevanda');
  if (drinkItems.length === 0) return null;

  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const parts = [
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    DOUBLE_BOTH, text('COMANDA BEVANDE'),
    NORMAL_SIZE, BOLD_ON,
    text(LINE),
    BOLD_OFF,
    text(`Ordine #${order.id}  Tavolo ${order.table}`),
    text(now),
    text(LINE),
    ALIGN_LEFT,
    text(''),
  ];

  drinkItems.forEach(item => {
    parts.push(BOLD_ON, DOUBLE_BOTH);
    parts.push(text(`  ${item.qty}x ${item.name}`));
    parts.push(NORMAL_SIZE, BOLD_OFF);
  });

  parts.push(
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );

  return Buffer.concat(parts);
}

module.exports = {
  buildTestPage,
  buildReceipt,
  buildFoodOrder,
  buildDrinkOrder,
};

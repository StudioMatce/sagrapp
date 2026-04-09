// Servizio di stampa ESC/POS — comandi raw via Buffer
// sharp usato solo per conversione loghi PNG → raster bitmap

const path = require('path');
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[Printer] sharp non disponibile — i loghi non verranno stampati');
}

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
// Riquadro in DOUBLE mode (16 chars = tutta la larghezza 80mm)
const BOX = '****************';
// Separatore tratteggiato (usato nella ricevuta per sotto-sezioni)
const DASH = '--------------------------------';

// Converte una stringa in Buffer con newline (encoding latin1)
function text(str) {
  return Buffer.from(str + '\n', 'latin1');
}

// Testo senza newline — per formattazione mista (bold/normal) sulla stessa riga
function textInline(str) {
  return Buffer.from(str, 'latin1');
}

// Concatena più Buffer in uno solo
function concat(...parts) {
  return Buffer.concat(parts);
}

// --- Loghi per ricevuta cassa (convertiti PNG → ESC/POS raster all'avvio) ---
let logoMdgBuffer = null;
let logoVendraminiBuffer = null;

// Converte un PNG in comando ESC/POS raster (GS v 0)
// Il printer interpreta i byte come bitmap: 1 bit = 1 dot, MSB a sinistra
async function pngToRaster(filePath, maxWidth) {
  if (!sharp) return null;
  const { data, info } = await sharp(filePath)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(maxWidth, null, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const bytesPerRow = Math.ceil(width / 8);

  // Converti grayscale → 1-bit (soglia 128: sotto = nero = dot stampato)
  const bitmap = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 128) {
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        bitmap[byteIdx] |= (1 << (7 - (x % 8)));
      }
    }
  }

  // GS v 0 m xL xH yL yH [data]
  const header = Buffer.from([
    0x1D, 0x76, 0x30, 0x00,
    bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF,
  ]);

  return Buffer.concat([header, bitmap]);
}

// Carica e converte i loghi all'avvio del server (chiamato da index.js)
async function loadLogos() {
  try {
    const root = path.join(__dirname, '..', '..');
    logoMdgBuffer = await pngToRaster(path.join(root, 'mdg_logo_thermal.png'), 300);
    logoVendraminiBuffer = await pngToRaster(path.join(root, 'vendramini_logo_thermal.png'), 300);
    if (logoMdgBuffer && logoVendraminiBuffer) {
      console.log('[Printer] Loghi caricati per ricevuta');
    }
  } catch (err) {
    console.error('[Printer] Errore caricamento loghi:', err.message);
  }
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

// Abbrevia i nomi dei piatti per la comanda cibo (stampante 80mm, testo DOUBLE)
function shortName(name) {
  return name
    .replace(/ con polenta$/i, '')
    .replace(/ con patate fritte$/i, '')
    .replace(/ con patate$/i, '')
    .replace(/ di pollo$/i, '')
    .replace(/ al ragù$/i, ' ragu')
    .replace(/ alla spina$/i, '')
    .replace(/ in bianco$/i, ' bianco')
    .replace(/ burro e salvia$/i, ' burro')
    .replace(/ mista$/i, '')
    .replace(/Formaggio cotto/, 'Form. cotto');
}

// Ricevuta cassa generale — vretti .203 (printer #1)
// Layout identico a Ricevuta_01.png: logo, sezioni separate, bold misto
function buildReceipt(order) {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const coperti = order.coperti || 0;
  const parts = [INIT];

  // --- Logo MDG centrato in alto ---
  if (logoMdgBuffer) {
    parts.push(ALIGN_CENTER, logoMdgBuffer, text(''));
  }

  // --- Intestazione ---
  parts.push(
    ALIGN_LEFT,
    BOLD_ON, DOUBLE_BOTH, text('Sagra M.D.G.'),
    NORMAL_SIZE, BOLD_OFF,
    text('54^ festa della comunita tra'),
    text('altare e tavola'),
    text(LINE),
  );

  // --- Sezione ordine ---
  parts.push(
    textInline('Ordine nr: '), BOLD_ON, text(`#${order.id}`), BOLD_OFF,
    text(`Giorno:    ${now}`),
    text(DASH),
  );

  // Nome cliente
  if (order.customer_name) {
    parts.push(textInline('Nome:      '), BOLD_ON, text(order.customer_name), BOLD_OFF);
  } else {
    parts.push(text('Nome:      -'));
  }

  // Tavolo e coperto (bold misto sulla stessa riga)
  parts.push(
    textInline('Tavolo:    '),
    BOLD_ON, textInline(String(order.table)), BOLD_OFF,
    textInline('    Coperto: '),
    BOLD_ON, text(String(coperti)), BOLD_OFF,
    text(LINE),
  );

  // --- Articoli ---
  parts.push(text(''), text('Ordine:'), text(''));

  order.items.forEach(item => {
    const qty = String(item.qty).padStart(2, ' ');
    const price = (item.price * item.qty).toFixed(2);
    const left = `${qty}  ${item.name}`;
    const space = 32 - left.length - price.length;
    parts.push(text(left + ' '.repeat(Math.max(1, space)) + price));
  });

  // --- Subtotale / Sconto / Omaggio ---
  const subtotal = order.subtotal !== undefined ? order.subtotal : order.total;
  parts.push(text(DASH), text(''));

  if (order.discount > 0 || order.courtesy_type) {
    parts.push(text(padLine('Subtotale', subtotal.toFixed(2))));
  }

  if (order.discount > 0) {
    const discountLabel = order.discount_type === 'percent'
      ? `Sconto (${order.discount_value}%)`
      : 'Sconto';
    parts.push(text(padLine(discountLabel, `-${order.discount.toFixed(2)}`)));
  }

  const courtesyLabels = {
    sponsor: 'OMAGGIO SPONSOR',
    don_pierino: 'OMAGGIO DON PIERINO',
    amici: 'OMAGGIO AMICI',
  };
  if (order.courtesy_type && courtesyLabels[order.courtesy_type]) {
    parts.push(ALIGN_CENTER, BOLD_ON);
    parts.push(text(courtesyLabels[order.courtesy_type]));
    parts.push(BOLD_OFF, ALIGN_LEFT);
  }

  // --- Totale ---
  parts.push(
    BOLD_ON,
    text(padLine('   Totale', order.total.toFixed(2))),
    BOLD_OFF,
    text(LINE),
  );

  // --- Footer ---
  parts.push(text(''), text('   Scontrino non fiscale'), text(''));

  // --- Logo Vendramini centrato in fondo ---
  if (logoVendraminiBuffer) {
    parts.push(ALIGN_CENTER, logoVendraminiBuffer, text(''));
  }

  parts.push(FEED, CUT);
  return Buffer.concat(parts);
}

// Comanda cibo — Fuhuihe .205 (printer #3)
// Filtra per print_to 'cibo', esclude contorni e condimenti (tutti sanno)
// Nomi abbreviati, testo DOUBLE per leggibilità in cucina
function buildFoodOrder(order) {
  const foodItems = order.items.filter(i =>
    i.print_to && i.print_to.includes('cibo') &&
    i.category !== 'contorno' && i.category !== 'condimento'
  );
  if (foodItems.length === 0) return null;

  const coperti = order.coperti || 0;
  const parts = [
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    DOUBLE_BOTH, text('COMANDA CIBO'),
    NORMAL_SIZE, BOLD_ON,
    text(LINE),
    BOLD_OFF,
  ];

  // Riquadro con ordine, tavolo, coperti e asporto
  parts.push(BOLD_ON, DOUBLE_BOTH);
  parts.push(text(BOX));
  parts.push(text(`#${order.id}  TAV.${order.table}`));
  if (coperti > 0) {
    parts.push(text(`COPERTI: ${coperti}`));
  }
  if (order.asporto) {
    parts.push(text('>>> ASPORTO <<<'));
  }
  parts.push(text(BOX));
  parts.push(NORMAL_SIZE, BOLD_OFF);

  parts.push(
    text(LINE),
    ALIGN_LEFT,
    text(''),
  );

  foodItems.forEach(item => {
    parts.push(BOLD_ON, DOUBLE_BOTH);
    const prefix = item.special ? '* ' : '  ';
    parts.push(text(`${prefix}${item.qty}x ${shortName(item.name)}`));
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
// Filtra per print_to che include 'bevande'
// Comanda bevande — STAMPA SEMPRE, anche senza bevande (per posate/coperti)
function buildDrinkOrder(order) {
  const drinkItems = order.items.filter(i =>
    i.print_to && i.print_to.includes('bevande')
  );

  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const coperti = order.coperti || 0;
  const parts = [
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    DOUBLE_BOTH, text('COMANDA BEVANDE'),
    NORMAL_SIZE, BOLD_ON,
    text(LINE),
    BOLD_OFF,
  ];

  // Riquadro con ordine, tavolo e coperti
  parts.push(BOLD_ON, DOUBLE_BOTH);
  parts.push(text(BOX));
  parts.push(text(`#${order.id}  TAV.${order.table}`));
  if (coperti > 0) {
    parts.push(text(`COPERTI: ${coperti}`));
  }
  parts.push(text(BOX));
  parts.push(NORMAL_SIZE, BOLD_OFF);

  parts.push(text(LINE), ALIGN_LEFT, text(''));

  if (drinkItems.length > 0) {
    drinkItems.forEach(item => {
      parts.push(BOLD_ON, DOUBLE_BOTH);
      parts.push(text(`  ${item.qty}x ${item.name}`));
      parts.push(NORMAL_SIZE, BOLD_OFF);
    });
  } else {
    // Nessuna bevanda — stampa solo per posate
    parts.push(text('  (nessuna bevanda)'));
  }

  parts.push(
    text(''),
    ALIGN_CENTER,
    text(LINE),
    FEED, CUT,
  );

  return Buffer.concat(parts);
}

// Comanda piatti speciali — Fuhuihe .207 (printer #5)
// DOPPIA STAMPA: questi piatti vanno GIA' sulla comanda cibo (.205),
// qui stampiamo SOLO i piatti speciali per la zona dedicata
function buildSpecialOrder(order) {
  const specialItems = order.items.filter(i => i.special);
  if (specialItems.length === 0) return null;

  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const parts = [
    INIT,
    CODEPAGE_CP437,
    ALIGN_CENTER,
    BOLD_ON, text(LINE),
    DOUBLE_BOTH, text('PIATTO SPECIALE'),
    NORMAL_SIZE, BOLD_ON,
    text(LINE),
    BOLD_OFF,
  ];

  // Riquadro con ordine e tavolo
  parts.push(BOLD_ON, DOUBLE_BOTH);
  parts.push(text(BOX));
  parts.push(text(`#${order.id}  TAV.${order.table}`));
  parts.push(text(BOX));
  parts.push(NORMAL_SIZE, BOLD_OFF);

  parts.push(
    text(LINE),
    ALIGN_LEFT,
    text(''),
  );

  specialItems.forEach(item => {
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
  loadLogos,
  buildTestPage,
  buildReceipt,
  buildFoodOrder,
  buildDrinkOrder,
  buildSpecialOrder,
};

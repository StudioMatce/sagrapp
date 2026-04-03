module.exports = {
  // Railway/Render impostano PORT automaticamente
  PORT: process.env.PORT || 3000,

  // PIN accesso admin — configurabile via env per non lasciarlo nel codice
  ADMIN_PIN: process.env.ADMIN_PIN || '1234',

  // Segreto per token sessioni admin
  ADMIN_TOKEN_SECRET: process.env.ADMIN_TOKEN_SECRET || 'sagrapp-test-2026',

  // Stampanti — tutte in rete LAN via Powerline (ESC/POS TCP porta 9100)
  PRINTERS: [
    { id: 1, name: 'vretti (Ricevuta cassa generale)', model: 'vretti 80mm',
      ip: '192.168.1.203', port: 9100 },
    { id: 2, name: 'Fuhuihe (Comanda bevande)', model: 'Fuhuihe POS',
      ip: '192.168.1.204', port: 9100 },
    { id: 3, name: 'Fuhuihe (Comanda cibo)', model: 'Fuhuihe POS',
      ip: '192.168.1.205', port: 9100 },
    { id: 4, name: 'Fuhuihe (Ricevuta cassa bar)', model: 'Fuhuihe POS',
      ip: '192.168.1.206', port: 9100 },
    { id: 5, name: 'Fuhuihe (Piatti speciali)', model: 'Fuhuihe POS',
      ip: '192.168.1.207', port: 9100 },
    { id: 6, name: 'Fuhuihe (Casetta aperitivi)', model: 'Fuhuihe POS',
      ip: '192.168.1.208', port: 9100 },
  ],

  // ===== MENU REALE — Sagra M.D.G. =====
  // category: 'primo' | 'secondo' | 'contorno' | 'condimento' | 'bevanda' | 'speciale'
  // station: 'cucina' | 'piastra' | 'griglia' | 'polenta' | 'bar' | 'speciali'
  // print_to: quali stampanti ricevono la comanda (oltre alla ricevuta)
  // composition: scomposizione in pezzi singoli per monitor cuochi e magazzino
  // special: true = doppia stampa (.205 + .207)
  // available_date: se presente, il piatto è disponibile solo in quella data

  MENU: [
    // PRIMI
    { id: 'gnocchi_ragu', name: 'Gnocchi al ragù', price: 5.50, category: 'primo', station: 'cucina', print_to: ['cibo'],
      initial_stock: 150, alert_threshold: 15 },
    { id: 'gnocchi_burro', name: 'Gnocchi burro e salvia', price: 5.50, category: 'primo', station: 'cucina', print_to: ['cibo'],
      initial_stock: 150, alert_threshold: 15 },
    { id: 'pasta_ragu', name: 'Pasta al ragù', price: 4.50, category: 'primo', station: 'cucina', print_to: ['cibo'],
      initial_stock: 150, alert_threshold: 15 },
    { id: 'pasta_bianco', name: 'Pasta in bianco', price: 4.50, category: 'primo', station: 'cucina', print_to: ['cibo'],
      initial_stock: 100, alert_threshold: 10 },

    // SECONDI — PIASTRA
    { id: 'formaggio_polenta', name: 'Formaggio cotto con polenta', price: 6.00, category: 'secondo', station: 'piastra', print_to: ['cibo'],
      composition: { polenta: 1 }, initial_stock: 150, alert_threshold: 15 },
    { id: 'wurstel_patate', name: 'Wurstel con patate fritte', price: 5.00, category: 'secondo', station: 'piastra', print_to: ['cibo'],
      composition: { patate: 1 }, initial_stock: 150, alert_threshold: 15 },

    // SECONDI — GRIGLIA (composizione in pezzi singoli per monitor cuochi)
    { id: 'pastin_patate', name: 'Pastin con patate fritte', price: 7.50, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { pastin: 2, patate: 1 }, initial_stock: 200, alert_threshold: 20 },
    { id: 'salsiccia_polenta', name: 'Salsiccia con polenta', price: 6.80, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { salsicce: 2, polenta: 1 }, initial_stock: 200, alert_threshold: 20 },
    { id: 'costicine_polenta', name: 'Costicine con polenta', price: 7.30, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { costicine: 3, polenta: 1 }, initial_stock: 200, alert_threshold: 20 },
    { id: 'sovracoscia_polenta', name: 'Sovracoscia di pollo con polenta', price: 7.30, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { sovracoscia: 1, polenta: 1 }, initial_stock: 200, alert_threshold: 20 },
    { id: 'grigliata_mista', name: 'Grigliata mista con polenta', price: 11.00, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { costicine: 2, salsicce: 1, sovracoscia: 0.5, polenta: 1 }, initial_stock: 150, alert_threshold: 15 },

    // PIATTI SPECIALI — doppia stampa: .205 (cibo) + .207 (speciali)
    { id: 'pesce_fritto', name: 'Pesce fritto', price: 13.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-10',
      initial_stock: 50, alert_threshold: 5 },
    { id: 'coniglio', name: 'Coniglio', price: 15.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-11',
      initial_stock: 50, alert_threshold: 5 },
    { id: 'costata', name: 'Costata', price: 24.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-16',
      initial_stock: 30, alert_threshold: 3 },
    { id: 'galletto_patate', name: 'Galletto con patate', price: 13.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-17',
      initial_stock: 50, alert_threshold: 5 },
    { id: 'trippa', name: 'Trippa', price: 7.50, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-18',
      initial_stock: 50, alert_threshold: 5 },
    { id: 'paella', name: 'Paella', price: 16.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-23',
      initial_stock: 50, alert_threshold: 5 },
    { id: 'spiedo', name: 'Spiedo', price: 12.80, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-24',
      initial_stock: 50, alert_threshold: 5 },
    { id: 'frico', name: 'Frico', price: 8.50, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-25',
      initial_stock: 50, alert_threshold: 5 },

    // CONTORNI
    { id: 'patate_fritte', name: 'Patate fritte', price: 2.90, category: 'contorno', station: 'cucina', print_to: ['cibo'],
      initial_stock: 200, alert_threshold: 20 },
    { id: 'fagioli', name: 'Fagioli', price: 2.50, category: 'contorno', station: 'cucina', print_to: ['cibo'],
      initial_stock: 150, alert_threshold: 15 },
    { id: 'fagioli_cipolla', name: 'Fagioli con cipolla', price: 2.50, category: 'contorno', station: 'cucina', print_to: ['cibo'],
      initial_stock: 150, alert_threshold: 15 },
    { id: 'cappuccio', name: 'Cappuccio', price: 2.00, category: 'contorno', station: 'cucina', print_to: ['cibo'],
      initial_stock: 200, alert_threshold: 20 },
    { id: 'funghi', name: 'Funghi misto bosco', price: 3.20, category: 'contorno', station: 'cucina', print_to: ['cibo'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'maionese', name: 'Maionese', price: 0.30, category: 'condimento', station: 'cucina', print_to: ['cibo'],
      initial_stock: 500, alert_threshold: 50 },
    { id: 'ketchup', name: 'Ketchup', price: 0.30, category: 'condimento', station: 'cucina', print_to: ['cibo'],
      initial_stock: 500, alert_threshold: 50 },

    // BEVANDE (tutte vanno alla stampante comanda bevande .204)
    { id: 'birra_spina', name: 'Birra alla spina', price: 3.50, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 500, alert_threshold: 50 },
    { id: 'vino_bianco_ombra', name: 'Vino ombra bianco', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 300, alert_threshold: 30 },
    { id: 'vino_rosso_ombra', name: 'Vino ombra rosso', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 300, alert_threshold: 30 },
    { id: 'vino_bianco_mezzo', name: 'Vino bianco sfuso 1/2L', price: 3.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'vino_rosso_mezzo', name: 'Vino rosso sfuso 1/2L', price: 3.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'vino_bianco_trequarti', name: 'Vino bianco sfuso 3/4L', price: 4.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 80, alert_threshold: 8 },
    { id: 'vino_rosso_trequarti', name: 'Vino rosso sfuso 3/4L', price: 4.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 80, alert_threshold: 8 },
    { id: 'prosecco', name: 'Prosecco Superiore DOCG', price: 9.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 30, alert_threshold: 5 },
    { id: 'cabernet', name: 'Bottiglia Cabernet', price: 7.50, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 30, alert_threshold: 5 },
    { id: 'acqua_naturale', name: 'Acqua naturale 1/2L', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 300, alert_threshold: 30 },
    { id: 'acqua_frizzante', name: 'Acqua frizzante 1/2L', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 300, alert_threshold: 30 },
    { id: 'the_pesca', name: 'The alla pesca', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'the_limone', name: 'The al limone', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'coca_cola', name: 'Coca Cola', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'coca_zero', name: 'Coca Cola Zero', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
    { id: 'fanta', name: 'Fanta', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'],
      initial_stock: 100, alert_threshold: 10 },
  ],

  // Mappa stampanti per tipo di comanda
  PRINT_ROUTES: {
    'ricevuta_cassa': '192.168.1.203',
    'ricevuta_bar': '192.168.1.206',
    'ricevuta_casetta': '192.168.1.208',
    'cibo': '192.168.1.205',
    'bevande': '192.168.1.204',
    'speciali': '192.168.1.207',
  },

  // Articoli tracciati sul monitor cuochi (pezzi singoli dalla griglia/scaldavivande)
  MONITOR_ITEMS: ['costicine', 'salsicce', 'sovracoscia', 'pastin', 'polenta', 'patate'],
};

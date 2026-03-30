module.exports = {
  // Railway/Render impostano PORT automaticamente
  PORT: process.env.PORT || 3000,

  // PIN accesso admin — configurabile via env per non lasciarlo nel codice
  ADMIN_PIN: process.env.ADMIN_PIN || '1234',

  // Segreto per token sessioni admin
  ADMIN_TOKEN_SECRET: process.env.ADMIN_TOKEN_SECRET || 'sagrapp-test-2026',

  // Stampanti — configurazione hardware reale
  // type: 'lan' = stampante di rete (TCP porta 9100)
  // type: 'usb' = stampante USB collegata al PC dove gira il print proxy
  PRINTERS: [
    {
      id: 1,
      name: 'Custom (Ricevuta cassa)',
      type: 'usb',
      model: 'Custom',
      usb_name: 'CustomPOS',       // Nome condivisione Windows
      usb_device: '/dev/usb/lp0',  // Device Linux/Mac
    },
    {
      id: 2,
      name: 'vretti (Comanda cibo)',
      type: 'lan',
      model: 'vretti 80mm',
      ip: '192.168.1.202',
      port: 9100,
    },
    {
      id: 3,
      name: 'Fuhuihe (Comanda bevande)',
      type: 'lan',
      model: 'Fuhuihe POS',
      ip: '192.168.1.204',
      port: 9100,
    },
    // Predisposta per il futuro — 4a stampante (ricevuta bar)
    // { id: 4, name: 'Ricevuta bar', type: 'lan', ip: '192.168.1.203', port: 9100 },
  ],

  // Piatti di test per monitor, passa-piatti e magazzino
  TEST_ITEMS: [
    { id: 'bistecca', name: 'Bistecca', station: 'griglia', price: 12.00, category: 'cibo',
      initial_stock: 200, alert_threshold: 20 },
    { id: 'costine', name: 'Costine', station: 'griglia', price: 10.00, category: 'cibo',
      initial_stock: 200, alert_threshold: 20 },
    { id: 'salsiccia', name: 'Salsiccia', station: 'griglia', price: 8.00, category: 'cibo',
      initial_stock: 300, alert_threshold: 30 },
    { id: 'spiedini', name: 'Spiedini', station: 'griglia', price: 9.00, category: 'cibo',
      initial_stock: 150, alert_threshold: 15 },
    { id: 'pasta_ragu', name: 'Pasta al ragù', station: 'primi', price: 7.00, category: 'cibo',
      initial_stock: 150, alert_threshold: 15 },
    { id: 'birra_media', name: 'Birra media', station: 'bar', price: 4.00, category: 'bevanda',
      initial_stock: 500, alert_threshold: 50 },
  ],
};

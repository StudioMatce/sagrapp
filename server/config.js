module.exports = {
  // Railway/Render impostano PORT automaticamente
  PORT: process.env.PORT || 3000,

  // PIN accesso admin — configurabile via env per non lasciarlo nel codice
  ADMIN_PIN: process.env.ADMIN_PIN || '1234',

  // Segreto per token sessioni admin
  ADMIN_TOKEN_SECRET: process.env.ADMIN_TOKEN_SECRET || 'sagrapp-test-2026',

  // Stampanti — tutte in rete LAN via Powerline (ESC/POS TCP porta 9100)
  // Nessuna stampante USB
  PRINTERS: [
    {
      id: 1,
      name: 'vretti (Ricevuta cassa generale)',
      model: 'vretti 80mm',
      ip: '192.168.1.203',
      port: 9100,
    },
    {
      id: 2,
      name: 'Fuhuihe (Comanda bevande)',
      model: 'Fuhuihe POS',
      ip: '192.168.1.204',
      port: 9100,
    },
    {
      id: 3,
      name: 'Fuhuihe (Comanda cibo)',
      model: 'Fuhuihe POS',
      ip: '192.168.1.205',
      port: 9100,
    },
    {
      id: 4,
      name: 'Fuhuihe (Ricevuta cassa bar)',
      model: 'Fuhuihe POS',
      ip: '192.168.1.206',
      port: 9100,
    },
    {
      id: 5,
      name: 'Fuhuihe (Piatti speciali)',
      model: 'Fuhuihe POS',
      ip: '192.168.1.207',
      port: 9100,
    },
    {
      id: 6,
      name: 'Fuhuihe (Casetta aperitivi)',
      model: 'Fuhuihe POS',
      ip: '192.168.1.208',
      port: 9100,
    },
  ],

  // Piatti di test per monitor, scaldavivande e magazzino
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

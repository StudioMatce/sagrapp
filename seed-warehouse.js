// Script per caricare i prodotti magazzino dal PDF "Lista magazzino Programma"
// Esegui: node seed-warehouse.js
// Richiede che il server sia in esecuzione su localhost:3000

const TOKEN = '0000'; // Admin PIN — verrà usato per autenticarsi

async function getAdminToken() {
  const res = await fetch('http://localhost:3000/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '0000' }),
  });
  const data = await res.json();
  return data.token;
}

// Tutti i prodotti estratti dal PDF, organizzati per fornitore
const products = [
  // =============================================
  // FORNITORE: Roma
  // =============================================
  { name: 'Pomodoro Polpa', quantity: 12, total: 12, category: 'Alimentari', supplier: 'Roma' },
  { name: 'Pomodoro Passata', quantity: 12, total: 12, category: 'Alimentari', supplier: 'Roma' },
  { name: 'Fagioli', quantity: 81, total: 81, category: 'Alimentari', supplier: 'Roma' },
  { name: 'Olio 10L girasole altoleico', quantity: 24, total: 24, category: 'Alimentari', supplier: 'Roma' },
  { name: 'Patate 9/9 kg', quantity: 1800, total: 1800, category: 'Alimentari', supplier: 'Roma' },

  // =============================================
  // FORNITORE: Tosano (pagina 1)
  // =============================================
  { name: 'Martini Rosso 1L', quantity: 6, total: 6, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Amaro Montenegro 1.5L', quantity: 8, total: 8, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Aperol Barbieri 1L', quantity: 24, total: 24, category: 'Bevande', supplier: 'Tosano' },
  { name: 'S.B.Tè Limone Lat', quantity: 96, total: 96, category: 'Bevande', supplier: 'Tosano' },
  { name: 'S.B.Tè Pesca Lat', quantity: 96, total: 96, category: 'Bevande', supplier: 'Tosano' },
  { name: 'CocaCola Lat', quantity: 720, total: 720, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Fanta Zero Lat', quantity: 96, total: 96, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Campari Bitter 1L', quantity: 24, total: 24, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Vodka Keglevic 1L', quantity: 9, total: 9, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Acqua Naturale Goccia 500x6', quantity: 252, total: 252, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Acqua Gas Goccia 500x6', quantity: 252, total: 252, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Sambuca Ramazzotti', quantity: 6, total: 6, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Aceto di Alcol Ponti 1L', quantity: 12, total: 12, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Amaro Averna 700ml', quantity: 4, total: 4, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Pepsi Cola Lt.1.5x4', quantity: 14, total: 14, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Amaro Del Capo', quantity: 3, total: 3, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Tonica Schweppes Limone', quantity: 12, total: 12, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Tonica Schweppes', quantity: 40, total: 40, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Salamoia bolognese', quantity: 4, total: 4, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Ghiaccio', quantity: 24, total: 24, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Ice ghiaccio (ottimo)', quantity: 36, total: 36, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Gin Gordon', quantity: 15, total: 15, category: 'Bevande', supplier: 'Tosano' },

  // =============================================
  // FORNITORE: Tosano (pagina 2 — alimentari)
  // =============================================
  { name: 'Barilla 70 Mezze Penne 1Kg', quantity: 50, total: 50, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Mutti Passata Kg. 2.5', quantity: 9, total: 9, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Olio Evo De Cecco', quantity: 16, total: 16, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Mutti Polpa di Pomodoro kg. 4', quantity: 6, total: 6, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Formaggio Gratt. Grana 1kg.', quantity: 10, total: 10, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Ghiaccio Aliment Cubetto Kg. 2', quantity: 36, total: 36, category: 'Bevande', supplier: 'Tosano' },
  { name: 'Wurstel Suino Kg. 1', quantity: 71, total: 71, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Bibanesi Classici 400g', quantity: 8, total: 8, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Sale Marino Grosso 1Kg', quantity: 12, total: 12, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Pasta Lasagne Uovo 2Kg 10pz', quantity: 4, total: 4, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Zuccato Olive Giganti 1700ml', quantity: 5, total: 5, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Amica Patatine 500g', quantity: 15, total: 15, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Soffritto 150g', quantity: 23, total: 23, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Burro Albiero 1 kg.', quantity: 3, total: 3, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Farina Bianca Barilla 1kg.', quantity: 2, total: 2, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Pinguin misto soffritto', quantity: 3, total: 3, category: 'Alimentari', supplier: 'Tosano' },

  // =============================================
  // FORNITORE: Tosano (pagina 2 — consumabili/pulizia)
  // =============================================
  { name: 'Ace Candeggina 5L', quantity: 2, total: 2, category: 'Pulizia', supplier: 'Tosano' },
  { name: 'Stuzzicadenti Sayonara 1000', quantity: 12, total: 12, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Top Food Maio 12x100', quantity: 6, total: 6, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Liotti Aceto Mele 5x100', quantity: 1, total: 1, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Liotti Sale e Pepe 1000', quantity: 1, total: 1, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Palette Gelato Legno 100', quantity: 48, total: 48, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Stuzzicadenti Lunghi 25x1000', quantity: 0, total: 0, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Domopack Pellicola 200m', quantity: 2, total: 2, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Kuoko Carta 50m', quantity: 3, total: 3, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Kuoko Alluminio 150m', quantity: 3, total: 3, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Ketchup 100x15', quantity: 4, total: 4, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Top Food Olio 10x100', quantity: 6, total: 6, category: 'Alimentari', supplier: 'Tosano' },
  { name: 'Baleno Stoviglie 100Tabs', quantity: 1, total: 1, category: 'Pulizia', supplier: 'Tosano' },
  { name: 'Pro line Asciugamano 210 2V', quantity: 15, total: 15, category: 'Consumabili', supplier: 'Tosano' },
  { name: 'Top Food Ketchup', quantity: 2, total: 2, category: 'Alimentari', supplier: 'Tosano' },

  // =============================================
  // FORNITORE: Basso
  // =============================================
  { name: 'Vaschette R1-01', quantity: 300, total: 300, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Vaschette R1-11', quantity: 200, total: 200, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Vaschette R1-49', quantity: 200, total: 200, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Vaschette A8 patate', quantity: 5000, total: 5000, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Scodelle', quantity: 2000, total: 2000, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Kit Posate tris plastica', quantity: 500, total: 500, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Kit Posate tris', quantity: 6250, total: 6250, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Forchette Dolce', quantity: 500, total: 500, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Piatti Dolce', quantity: 500, total: 500, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Cucchiaini', quantity: 500, total: 500, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Berretto Carta', quantity: 300, total: 300, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Carta Paglia 7.5 Kg', quantity: 8, total: 8, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Cuffia', quantity: 300, total: 300, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Synergy 5L', quantity: 1, total: 1, category: 'Pulizia', supplier: 'Basso' },
  { name: 'Gnocchi 124 kg', quantity: 124, total: 124, category: 'Alimentari', supplier: 'Basso' },
  { name: 'Polenta', quantity: 600, total: 600, category: 'Alimentari', supplier: 'Basso' },
  { name: 'Rotoli Puliunto', quantity: 20, total: 20, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Sacchi Trasparenti 15kg', quantity: 15, total: 15, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Sacchi Bio 50x60', quantity: 5, total: 5, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Borsette grandi', quantity: 1000, total: 1000, category: 'Consumabili', supplier: 'Basso' },
  { name: 'Bicchieri 100', quantity: 1500, total: 1500, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Bicchieri 166', quantity: 6900, total: 6900, category: 'Stoviglie', supplier: 'Basso' },
  { name: 'Bicchieri 350', quantity: 3000, total: 3000, category: 'Stoviglie', supplier: 'Basso' },
];

async function main() {
  console.log('Autenticazione...');
  const token = await getAdminToken();
  if (!token) {
    console.error('Errore: impossibile ottenere il token admin');
    process.exit(1);
  }
  console.log('Token ottenuto:', token.substring(0, 8) + '...');

  const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': token };
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const p of products) {
    try {
      // Prova a creare (POST)
      const res = await fetch('http://localhost:3000/api/warehouse', {
        method: 'POST',
        headers,
        body: JSON.stringify(p),
      });

      if (res.status === 201) {
        created++;
        console.log('  + ' + p.name + ' (' + p.supplier + ')');
      } else if (res.status === 409) {
        // Esiste già — aggiorna con PUT
        const id = p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const res2 = await fetch('http://localhost:3000/api/warehouse/' + encodeURIComponent(id), {
          method: 'PUT',
          headers,
          body: JSON.stringify(p),
        });
        if (res2.ok) {
          updated++;
          console.log('  ~ ' + p.name + ' (aggiornato)');
        } else {
          errors++;
          console.error('  ! Errore PUT ' + p.name + ':', await res2.text());
        }
      } else {
        errors++;
        const err = await res.text();
        console.error('  ! Errore ' + p.name + ':', err);
      }
    } catch (e) {
      errors++;
      console.error('  ! Errore rete ' + p.name + ':', e.message);
    }
  }

  console.log('\n--- Risultato ---');
  console.log('Creati:     ' + created);
  console.log('Aggiornati: ' + updated);
  console.log('Errori:     ' + errors);
  console.log('Totale:     ' + products.length + ' prodotti');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });

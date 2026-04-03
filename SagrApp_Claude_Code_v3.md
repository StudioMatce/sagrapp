# SagrApp — Documento Tecnico per Claude Code
## Piattaforma Completa — Sagra M.D.G.

> **PREREQUISITO:** Prima di iniziare, installare la skill frontend-design:
> ```bash
> npx skills add anthropics/claude-code --skill frontend-design
> ```
> Usare `/frontend-design` per costruire tutte le pagine HTML del progetto.

---

## 1. Contesto del Progetto

SagrApp è un sistema di gestione ordini per una sagra di paese (500-1000 coperti). Il software è una web app cloud-based accessibile da browser.

Questo documento descrive la **piattaforma di test hardware**: una web app diagnostica che permette di verificare che tutti i dispositivi hardware (stampanti, TV, tablet scaldavivande, tablet zona controllo) siano correttamente configurati e funzionanti PRIMA di costruire la piattaforma completa.

Il codice prodotto in questa fase **non è usa e getta**: il server, la connessione alle stampanti, il tablet zona controllo, e il real-time verso i dispositivi verranno riutilizzati nella piattaforma finale.

### Hardware disponibile

| Dispositivo | Modello | Connessione | Ruolo |
|---|---|---|---|
| **PC all-in-one** | — | Wi-Fi | Cassa generale + Print Proxy |
| **Mini-PC** | — | LAN + HDMI | Collegato a TV per monitor cuochi |
| **Stampante 1** | **vretti 80mm** | **LAN** | Ricevuta cassa generale — IP 192.168.1.203 |
| **Stampante 2** | **Fuhuihe POS** | **LAN** | Comanda bevande — IP 192.168.1.204 (già testata ✅) |
| **Stampante 3** | **Fuhuihe POS** | **LAN** | Comanda cibo — IP 192.168.1.205 |
| **Stampante 4** | **Fuhuihe POS** | **LAN** | Ricevuta cassa bar — IP 192.168.1.206 |
| **Stampante 5** | **Fuhuihe POS** | **LAN** | Piatti speciali — IP 192.168.1.207 |
| **Stampante 6** | **Fuhuihe POS** | **LAN** | Casetta aperitivi — IP 192.168.1.208 |
| **Tablet 1** | Android | Wi-Fi | Scaldavivande: registra pezzi a decine (+10/+20/+30/+40/+50 e −) |
| **Tablet 2** | Android | Wi-Fi | Zona controllo: tastierino numerico evasione ordini |
| **PC/Tablet** | — | Wi-Fi | Casetta aperitivi (cassa indipendente) |
| **Router 4G/5G** | — | Wi-Fi + LAN | Rete locale + internet |
| **Kit Powerline** | — | Via corrente | Collegamento stampanti LAN + mini-PC |

**Tutte le stampanti sono in rete LAN via Powerline. Nessuna stampante USB. Nessun lettore barcode (sostituito da tablet zona controllo).**

---

## 2. Architettura Tecnica

### Stack tecnologico

| Componente | Tecnologia | Motivazione |
|---|---|---|
| **Runtime** | Node.js | Leggero, ottimo per I/O async, WebSocket nativo |
| **Framework backend** | Express.js | Semplice, ampiamente supportato |
| **Real-time** | Socket.IO | WebSocket con fallback, rooms, broadcast |
| **Database** | SQLite (via better-sqlite3) | Zero configurazione, file singolo, perfetto per sagra |
| **Frontend** | HTML/CSS/JS vanilla + Socket.IO client | Nessun framework frontend necessario, deve girare su qualsiasi browser |
| **Stampa** | escpos + node-thermal-printer via rete TCP | Stampa diretta ESC/POS su stampanti LAN |
| **Deploy** | VPS (Hetzner/DigitalOcean) con Node.js + PM2 | Processo persistente, auto-restart |

### Architettura di rete

```
                    ☁️ VPS Cloud
                   ┌─────────────────┐
                   │  Node.js Server  │
                   │  Express + Socket.IO │
                   │  SQLite DB       │
                   │  Porta: 3000     │
                   └────────┬────────┘
                            │ HTTPS
                            │
                    📡 Router 4G/5G
                   ┌────────┴────────┐
                   │ Wi-Fi    │ Powerline
                   │          │
            ┌──────┼────┐   ┌─┴──────────────┐
            │      │    │   │    │    │   │   │
          🖥️PC  🖥️PC  📱  🖨️  🖨️  🖨️  🖨️  📺TV
         Cassa  Bar  Tablet .201 .202 .203 .204 +miniPC
          princ.           ↑                    ↑
            │              └── LAN TCP ─────────┘
         📱 Tablet    📱 Tablet
```

### Flusso di stampa (CRITICO)

Le stampanti termiche LAN con protocollo ESC/POS ascoltano sulla **porta TCP 9100** (standard RAW printing). Il server Node.js invia comandi ESC/POS direttamente via TCP socket all'IP della stampante.

**IMPORTANTE**: Il server cloud NON può raggiungere direttamente le stampanti perché sono su una rete locale privata (dietro il router 4G). Ci sono due approcci:

**Approccio A — Print Proxy locale (CONSIGLIATO)**
Un piccolo servizio Node.js gira su uno dei PC locali (es. PC cassa principale). Questo servizio:
- Riceve comandi di stampa dal server cloud via WebSocket (Socket.IO)
- Li inoltra alle stampanti sulla rete locale via TCP porta 9100
- Risponde con lo stato (ok/errore)

Questo approccio è preferibile perché:
- Le stampanti restano sulla rete locale (sicurezza)
- Non serve aprire porte sul router
- Il print proxy è un piccolo script Node.js che parte all'avvio

**Approccio B — VPN/tunnel**
Troppo complesso per il contesto sagra. Scartato.

### Schema stampa dettagliato

```
Browser (PC cassa)                 Server Cloud              Print Proxy (PC locale)        Stampante
       │                               │                            │                          │
       │ ── POST /api/orders ────────> │                            │                          │
       │                               │                            │                          │
       │                               │ ── socket.emit('print', {  │                          │
       │                               │      printer_id: 2,        │                          │
       │                               │      printer_type: 'lan',  │                          │
       │                               │      printer_ip: '192.168.1.202',                     │
       │                               │      data: <ESC/POS bytes> │                          │
       │                               │    }) ──────────────────> │                          │
       │                               │                            │                          │
       │                               │                            │ ── TCP:9100 ──────────> │
       │                               │                            │    (ESC/POS raw data)    │
       │                               │                            │                          │ 🖨️ STAMPA
       │                               │                            │ <── TCP response ────── │
       │                               │                            │                          │
       │                               │ <── socket.emit('print_result', {                     │
       │                               │       success: true        │                          │
       │                               │     }) ────────────────── │                          │
       │                               │                            │                          │
       │ <── socket.emit('order_created') │                         │                          │
       │     (aggiorna UI)              │                            │                          │
```

---

## 3. Mappa Indirizzi IP

| Dispositivo | IP | Porta | Tipo connessione |
|---|---|---|---|
| Router | 192.168.1.1 | — | Gateway |
| vretti (ricevuta cassa generale) | 192.168.1.203 | 9100 | LAN via Powerline |
| Fuhuihe (comanda bevande) | 192.168.1.204 | 9100 | LAN via Powerline |
| Fuhuihe (comanda cibo) | 192.168.1.205 | 9100 | LAN via Powerline |
| Fuhuihe (ricevuta cassa bar) | 192.168.1.206 | 9100 | LAN via Powerline |
| Fuhuihe (piatti speciali) | 192.168.1.207 | 9100 | LAN via Powerline |
| Fuhuihe (casetta aperitivi) | 192.168.1.208 | 9100 | LAN via Powerline |
| PC Cassa generale | DHCP (.100-.199) | — | Wi-Fi |
| PC Cassa bar | DHCP (.100-.199) | — | Wi-Fi |
| PC/Tablet casetta aperitivi | DHCP (.100-.199) | — | Wi-Fi |
| Mini-PC (TV griglia) | DHCP (.100-.199) | — | Powerline + LAN |
| Tablet scaldavivande | DHCP (.100-.199) | — | Wi-Fi |
| Tablet zona controllo | DHCP (.100-.199) | — | Wi-Fi |

**Tutte le stampanti sono in rete LAN via Powerline. Nessuna stampante USB. Protocollo ESC/POS via TCP porta 9100.**

---

## 4. Menu Reale — Sagra M.D.G.

### 4.1 — Postazioni di Preparazione

| Postazione | Piatti preparati |
|---|---|
| **Cucina** | Gnocchi al ragù, Gnocchi burro e salvia, Pasta al ragù, Pasta in bianco, Funghi misto bosco, Cappuccio, Patate fritte |
| **Piastra** | Wurstel, Formaggio cotto |
| **Griglia → Scaldavivande** | Costicine, Salsicce, Sovracoscia di pollo, Pastin |
| **Polenta** | Polenta (porzioni) |
| **Bar** | Tutte le bevande |
| **Piatti speciali** (zona dedicata) | Pesce fritto, Coniglio, Costata, Galletto, Trippa, Paella, Spiedo, Frico |

### 4.2 — Menu Completo con Prezzi

**PRIMI**

| Piatto | Prezzo | Postazione | Composizione magazzino |
|---|---|---|---|
| Gnocchi al ragù | €5,50 | Cucina | 1 porzione gnocchi |
| Gnocchi burro e salvia | €5,50 | Cucina | 1 porzione gnocchi |
| Pasta al ragù | €4,50 | Cucina | 1 porzione pasta |
| Pasta in bianco | €4,50 | Cucina | 1 porzione pasta |

**SECONDI / PIATTI GRIGLIA** (piatti con * includono 1 porzione di polenta)

| Piatto | Prezzo | Postazione | Composizione in PEZZI singoli |
|---|---|---|---|
| Formaggio cotto con polenta* | €6,00 | Piastra | 1 formaggio cotto + 1 polenta |
| Wurstel con patate fritte | €5,00 | Piastra | 1 wurstel + 1 porzione patate |
| Pastin con patate fritte | €7,50 | Griglia→Scaldavivande | **2 pastin** + 1 porzione patate |
| Salsiccia con polenta* | €6,80 | Griglia→Scaldavivande | **2 salsicce** + 1 polenta |
| Costicine con polenta* | €7,30 | Griglia→Scaldavivande | **3 costicine** + 1 polenta |
| Sovracoscia di pollo con polenta* | €7,30 | Griglia→Scaldavivande | **1 sovracoscia** + 1 polenta |
| Grigliata mista con polenta* | €11,00 | Griglia→Scaldavivande | **2 costicine + 1 salsiccia + 0.5 sovracoscia** + 1 polenta |

**PIATTI SPECIALI** (uno per serata, su prenotazione o ad esaurimento)
**→ Doppia stampa: stampante comanda cibo (.205) + stampante piatti speciali (.207)**

| Piatto | Prezzo | Data | Note |
|---|---|---|---|
| Pesce fritto | €13,00 | Sabato 10.05 | Ad esaurimento |
| Coniglio | €15,00 | Domenica 11.05 | Su prenotazione o esaurimento |
| Costata | €24,00 | Venerdì 16.05 | Su prenotazione o esaurimento |
| Galletto con patate | €13,00 | Sabato 17.05 | Ad esaurimento |
| Trippa | €7,50 | Domenica 18.05 | Su prenotazione o esaurimento |
| Paella | €16,00 | Venerdì 23.05 | Su prenotazione o esaurimento |
| Spiedo | €12,80 | Sabato 24.05 | Ad esaurimento |
| Frico | €8,50 | Domenica 25.05 | Su prenotazione o esaurimento |

**CONTORNI**

| Piatto | Prezzo | Postazione |
|---|---|---|
| Patate fritte | €2,90 | Cucina |
| Fagioli | €2,50 | Cucina |
| Fagioli con cipolla | €2,50 | Cucina |
| Cappuccio | €2,00 | Cucina |
| Funghi misto bosco | €3,20 | Cucina |
| Maionese | €0,30 | — (condimento) |
| Ketchup | €0,30 | — (condimento) |

**BEVANDE** (tutte vanno alla stampante comanda bevande .204)

| Bevanda | Prezzo |
|---|---|
| Birra alla spina | €3,50 |
| Vino ombra bianco | €1,00 |
| Vino ombra rosso | €1,00 |
| Vino bianco sfuso 1/2 litro | €3,00 |
| Vino rosso sfuso 1/2 litro | €3,00 |
| Vino bianco sfuso 3/4 litro | €4,00 |
| Vino rosso sfuso 3/4 litro | €4,00 |
| Bottiglia Prosecco Superiore DOCG | €9,00 |
| Bottiglia Cabernet | €7,50 |
| Acqua minerale naturale 1/2 litro | €1,00 |
| Acqua minerale frizzante 1/2 litro | €1,00 |
| Lattina the alla pesca | €2,30 |
| Lattina the al limone | €2,30 |
| Lattina Coca Cola | €2,30 |
| Lattina Coca Cola Zero | €2,30 |
| Lattina Fanta | €2,30 |

### 4.3 — Composizione Piatti in Pezzi Singoli (per monitor cuochi e magazzino)

Quando un piatto viene ordinato, il sistema lo scompone automaticamente in pezzi singoli per il monitor cuochi e per lo scarico magazzino.

| Piatto ordinato | Costicine | Salsicce | Sovracoscia | Pastin | Polenta | Patate |
|---|---|---|---|---|---|---|
| Costicine con polenta | **3** | — | — | — | **1** | — |
| Salsiccia con polenta | — | **2** | — | — | **1** | — |
| Sovracoscia con polenta | — | — | **1** | — | **1** | — |
| Pastin con patate fritte | — | — | — | **2** | — | **1** |
| Grigliata mista con polenta | **2** | **1** | **0.5** | — | **1** | — |

**Esempio pratico:**
Un ordine con: 2x Costicine con polenta + 1x Grigliata mista
→ Il monitor cuochi aggiorna "vendute": costicine +8, salsicce +1, sovracoscia +0.5, polenta +3

### 4.4 — Monitor TV Cuochi — Articoli Visualizzati

Il monitor TV mostra SOLO i prodotti della griglia/scaldavivande + polenta + patate:

| Riga sul monitor | Unità | Chi lo aggiorna |
|---|---|---|
| **Costicine** | pezzi singoli | Scaldavivande: +10/+20/+30/+40/+50, − |
| **Salsicce** | pezzi singoli | Scaldavivande: +10/+20/+30/+40/+50, − |
| **Sovracoscia** | pezzi interi (il cuoco li cuoce interi, la mezza per la grigliata la taglia poi) | Scaldavivande: +10/+20/+30/+40/+50, − |
| **Pastin** | pezzi singoli | Scaldavivande: +10/+20/+30/+40/+50, − |
| **Polenta** | porzioni | Scaldavivande: +10/+20/+30/+40/+50, − |
| **Patate fritte** | porzioni | Scaldavivande: +10/+20/+30/+40/+50, − |

3 colonne per ogni riga: **Da cucinare** (= vendute − pronto) | **Pronto** | **Vendute**

### 4.5 — Logica di Stampa per Tipo di Ordine

Quando viene creato un ordine, il sistema stampa automaticamente su stampanti diverse in base al contenuto:

| Contenuto ordine | Stampante ricevuta | Stampante comanda cibo | Stampante bevande | Stampante speciali |
|---|---|---|---|---|
| Solo cibo | vretti .203 | Fuhuihe .205 | — | — |
| Solo bevande | vretti .203 | — | Fuhuihe .204 | — |
| Cibo + bevande | vretti .203 | Fuhuihe .205 | Fuhuihe .204 | — |
| Cibo + piatto speciale | vretti .203 | Fuhuihe .205 (con speciale) | — | Fuhuihe .207 (solo speciale) |
| Tutto | vretti .203 | Fuhuihe .205 | Fuhuihe .204 | Fuhuihe .207 (solo speciale) |

**I piatti speciali vengono stampati DUE VOLTE:** una sulla comanda cibo generale (.205) insieme agli altri piatti, e una SOLO il piatto speciale sulla stampante dedicata (.207). Questo perché vengono preparati in una zona separata.

### 4.6 — Configurabilità Menu da Admin

Il menu è **completamente configurabile** dalla dashboard admin senza toccare il codice:

- **Aggiungere/rimuovere piatti** (con nome, prezzo, categoria, postazione, composizione)
- **Modificare prezzi** in tempo reale
- **Attivare/disattivare piatti speciali** per serata (il piatto speciale del giorno è diverso ogni sera)
- **Modificare la composizione** di un piatto (es. cambiare da 3 a 2 costicine per porzione)
- **Salvare il menu come preset** riutilizzabile tra le serate

---

## 5. Specifiche della Piattaforma

### 5.1 — Struttura del progetto

```
sagrapp/
├── server/
│   ├── index.js              # Server Express + Socket.IO principale
│   ├── config.js             # Configurazione (IP stampanti, porta server)
│   ├── routes/
│   │   └── api.js            # API REST endpoints
│   └── services/
│       └── printer.js        # Servizio di stampa ESC/POS via TCP
│
├── print-proxy/
│   ├── index.js              # Print proxy che gira sul PC locale
│   └── config.js             # Configurazione proxy (server URL, stampanti)
│
├── public/
│   ├── index.html            # Landing page — selezione ruolo dispositivo
│   ├── test.html             # Dashboard test hardware
│   ├── setup.html            # Wizard setup inizio turno
│   ├── cassa.html            # Interfaccia cassa generale (layout come foglio cartaceo)
│   ├── cassa-bar.html        # Interfaccia cassa bar (solo bevande)
│   ├── cassa-casetta.html    # Interfaccia cassa casetta aperitivi
│   ├── monitor.html          # Monitor cuochi — 3 colonne (da cucinare / pronto / vendute)
│   ├── scaldavivande.html    # Tablet scaldavivande — pulsanti +10/+20/+30/+40/+50 e −
│   ├── controllo.html        # Tablet zona controllo — tastierino numerico evasione ordini
│   ├── admin.html            # Dashboard admin LIVE (monitoraggio durante servizio)
│   ├── admin-recap.html      # Dashboard admin RECAP (report post servizio)
│   ├── admin-magazzino.html  # Gestione magazzino / scorte
│   ├── admin-hardware.html   # Pannello controllo hardware in tempo reale
│   ├── admin-chiusura.html   # Procedura chiusura turno guidata
│   ├── admin-login.html      # Pagina login admin (PIN numerico)
│   ├── css/
│   │   └── style.css         # Stili
│   └── js/
│       ├── dashboard.js      # Logica dashboard test
│       ├── cassa.js          # Logica interfaccia cassa (ordini, stampa, flag)
│       ├── monitor.js        # Logica monitor cuochi (3 colonne)
│       ├── scaldavivande.js  # Logica scaldavivande (pulsanti decine)
│       ├── controllo.js      # Logica zona controllo (tastierino numerico)
│       ├── admin.js          # Logica dashboard admin live
│       ├── admin-recap.js    # Logica dashboard recap
│       ├── admin-magazzino.js # Logica gestione magazzino
│       ├── admin-hardware.js  # Logica controllo hardware
│       ├── admin-chiusura.js  # Logica chiusura turno
│       ├── alerts.js          # Sistema alert sonori/visivi + emergenza stampante
│       └── socket-client.js  # Socket.IO client wrapper
│
├── package.json
└── README.md                 # Istruzioni di setup e deploy
```

### 5.2 — Componente: Server Principale (server/index.js)

**Responsabilità:**
- Express server sulla porta 3000
- Serve le pagine statiche dalla cartella `public/`
- Socket.IO server per comunicazione real-time
- API REST per operazioni CRUD

**Endpoint API:**

| Metodo | Path | Descrizione |
|---|---|---|
| GET | / | Landing page — selezione ruolo |
| GET | /cassa | Interfaccia cassa generale |
| GET | /cassa-bar | Interfaccia cassa bar |
| GET | /cassa-casetta | Interfaccia cassa casetta aperitivi |
| GET | /monitor | Monitor cuochi (3 colonne, per TV) |
| GET | /scaldavivande | Tablet scaldavivande |
| GET | /controllo | Tablet zona controllo (tastierino numerico) |
| GET | /test | Dashboard test hardware |
| GET | /admin | Dashboard admin LIVE (richiede PIN) |
| GET | /admin/recap | Dashboard admin RECAP (richiede PIN) |
| GET | /admin/magazzino | Gestione magazzino (richiede PIN) |
| GET | /admin/hardware | Pannello controllo hardware (richiede PIN) |
| GET | /admin/login | Pagina login PIN |
| GET | /setup | Wizard setup inizio turno |
| GET | /api/health | Health check del server |
| GET | /api/menu | Menu completo (piatti, prezzi, disponibilità) |
| POST | /api/orders | **Crea un nuovo ordine** (piatti, tavolo, coperti, nome, sconto, flag gratis) |
| GET | /api/orders/:id | Dettaglio ordine |
| POST | /api/orders/:id/fulfill | Segna ordine come evaso (tablet zona controllo) |
| GET | /api/printers/status | Stato di tutte le stampanti (ping TCP) |
| POST | /api/printers/:id/test | Stampa pagina di test |
| POST | /api/admin/login | Verifica PIN → restituisce token sessione |
| GET | /api/admin/stats/live | Dati live: ordini, incasso, stati (richiede auth) |
| GET | /api/admin/stats/recap | Dati recap serata con omaggi e sconti (richiede auth) |
| GET | /api/inventory | Lista piatti con scorte attuali |
| PUT | /api/inventory/:id | Aggiorna scorta piatto (quantità, soglia, stato) |
| POST | /api/inventory/:id/adjust | Aggiustamento rapido scorta (+/- quantità) |
| POST | /api/inventory/reset | Reset scorte a valori iniziali (inizio serata) |
| PUT | /api/menu/:id | Modifica piatto (prezzo, disponibilità, composizione) |

**Eventi Socket.IO:**

| Evento | Direzione | Payload | Descrizione |
|---|---|---|---|
| `connect` | Client → Server | — | Nuovo dispositivo connesso |
| `register` | Client → Server | `{ role: 'dashboard' \| 'monitor' \| 'scaldavivande' \| 'controllo' \| 'proxy' \| 'admin' \| 'cassa' }` | Registra il tipo di dispositivo |
| `print` | Server → Proxy | `{ printer_ip, data, job_id }` | Comando stampa al proxy (tutte LAN) |
| `print_result` | Proxy → Server | `{ job_id, success, error? }` | Risultato stampa |
| `order_created` | Server → All | `{ order_id, table, items, total, flag_gratis? }` | Nuovo ordine creato — aggiorna monitor vendute |
| `counter_update` | Scaldavivande → Server | `{ item, delta }` | Scaldavivande aggiorna un contatore (+10, +20, ecc. o -1) |
| `counters_changed` | Server → Monitor | `{ counters: { item: { pronto, vendute } } }` | Broadcast nuovi contatori al monitor cuochi (3 colonne) |
| `order_fulfilled` | Controllo → Server | `{ order_number }` | Tablet zona controllo segna ordine come evaso |
| `order_fulfilled_result` | Server → Controllo | `{ success, order_number, table? }` | Risultato evasione ordine |
| `device_status` | Server → Dashboard | `{ devices: [...] }` | Aggiornamento dispositivi connessi |
| `inventory_updated` | Server → All | `{ item_id, stock, status }` | Scorta aggiornata, broadcast a casse e admin |
| `inventory_alert` | Server → Casse + Admin | `{ item_id, name, remaining, threshold }` | Piatto sotto soglia alert |
| `inventory_exhausted` | Server → Casse + Admin | `{ item_id, name }` | Piatto esaurito (scorta = 0) |
| `stats_update` | Server → Admin | `{ orders, revenue, statuses }` | Aggiornamento live statistiche |

### 5.3 — Componente: Print Proxy (print-proxy/index.js)

**Responsabilità:**
- Gira su un PC locale alla sagra (qualsiasi PC collegato alla stessa rete)
- Si connette al server cloud via Socket.IO come client con ruolo `proxy`
- Riceve comandi di stampa dal server
- Li inoltra alle stampanti sulla rete locale via **TCP porta 9100**
- Restituisce il risultato al server

**NOTA:** Tutte le stampanti sono in rete LAN. Non ci sono stampanti USB. Il print proxy usa un solo metodo di stampa (TCP) per tutte le stampanti.

**Funzionamento:**

```javascript
// Pseudo-codice del print proxy
const socket = io('https://sagrapp.server.com');
const net = require('net');

socket.emit('register', { role: 'proxy' });

socket.on('print', async ({ printer_ip, data, job_id }) => {
  try {
    const client = new net.Socket();
    client.connect(9100, printer_ip, () => {
      client.write(Buffer.from(data));
      client.end();
    });
    socket.emit('print_result', { job_id, success: true });
  } catch (err) {
    socket.emit('print_result', { job_id, success: false, error: err.message });
  }
});
```

**Verifica connettività stampanti (TCP ping):**

```javascript
function tcpPing(ip, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(timeout);
    client.connect(port, ip, () => { client.destroy(); resolve(true); });
    client.on('error', () => { client.destroy(); resolve(false); });
    client.on('timeout', () => { client.destroy(); resolve(false); });
  });
}

socket.on('check_printer', async ({ printer_ip }) => {
  const reachable = await tcpPing(printer_ip, 9100, 2000);
  socket.emit('printer_status', { printer_ip, reachable });
});
```

### 5.4 — Componente: Dashboard Test Hardware (public/index.html)

Questa è la pagina principale che si apre su qualsiasi browser. Mostra lo stato di tutti i dispositivi con un'interfaccia chiara e immediata.

**Layout:**

```
╔══════════════════════════════════════════════════════════╗
║  🔧 SagrApp — Test Hardware                            ║
║  Stato connessione server: ● Connesso (32ms)           ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  📡 RETE                                                ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Server cloud:    ● Online  (ping: 45ms)          │   ║
║  │ Print proxy:     ● Connesso                       │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  🖨️ STAMPANTI                                           ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ #1 vretti (ricevuta cassa)      .203  ● Online   │   ║
║  │                              [Stampa Test]        │   ║
║  │ #2 Fuhuihe (comanda bevande)    .204  ● Online   │   ║
║  │                              [Stampa Test]        │   ║
║  │ #3 Fuhuihe (comanda cibo)       .205  ● Online   │   ║
║  │                              [Stampa Test]        │   ║
║  │ #4 Fuhuihe (ricevuta bar)       .206  ● Online   │   ║
║  │                              [Stampa Test]        │   ║
║  │ #5 Fuhuihe (piatti speciali)    .207  ● Online   │   ║
║  │                              [Stampa Test]        │   ║
║  │ #6 Fuhuihe (casetta aperitivi)  .208  ● Online   │   ║
║  │                              [Stampa Test]        │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📺 MONITOR CUOCHI (TV)                                 ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Stato: ● Connesso                                │   ║
║  │ Mostra: 3 colonne (da cucinare / pronto / vendute)│   ║
║  │ [Apri pagina monitor]  [Invia dato test]         │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📱 TABLET SCALDAVIVANDE                                ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Stato: ● Connesso                                │   ║
║  │ Pulsanti: +10, +20, +30, +40, +50, −            │   ║
║  │ [Apri scaldavivande]                              │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📱 TABLET ZONA CONTROLLO                               ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Stato: ● Connesso                                │   ║
║  │ Tastierino numerico per evasione ordini          │   ║
║  │ [Apri zona controllo]                             │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  [▶ ESEGUI TEST COMPLETO]                               ║
║  Esegue tutti i test in sequenza e mostra il report     ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- All'apertura, la dashboard si connette al server via Socket.IO
- Ogni 5 secondi chiede lo stato delle stampanti (via proxy → TCP ping)
- I dispositivi connessi (monitor, passa-piatti, proxy) appaiono automaticamente quando si collegano
- Il pulsante "Stampa Test" invia un comando di stampa alla stampante specifica via server → proxy → stampante
- La sezione zona controllo mostra lo stato del tablet e gli ultimi ordini evasi
- Il pulsante "Test Completo" esegue tutti i test in sequenza e produce un report verde/rosso

### 5.5 — Componente: Monitor Cuochi (public/monitor.html)

Questa pagina viene aperta sulla TV della griglia (via mini-PC). Mostra **3 colonne** per ogni piatto.

**Layout (font molto grandi, alto contrasto) — usa /frontend-design:**

```
╔════════════════════════════════════════════════════════╗
║   GRIGLIA            Da cucinare   Pronto   Vendute   ║
║                                                        ║
║   Bistecca               15          30        45      ║
║   Costine                 8          22        30      ║
║   Salsiccia               3          47        50      ║
║   Spiedini               12          18        30      ║
║                                                        ║
║   ● Connesso                                          ║
╚════════════════════════════════════════════════════════╝
```

**Significato colonne:**
- **Vendute** = totale ordinato alle casse (incrementa automaticamente a ogni ordine)
- **Pronto** = pezzi nello scalda vivande (dal tablet scaldavivande, a decine)
- **Da cucinare** = vendute − pronto (calcolato, quello che i cuochi devono ancora produrre)

**Comportamento:**
- Si connette via Socket.IO con ruolo `monitor`
- "Vendute" si aggiorna in tempo reale quando arriva un ordine dalla cassa
- "Pronto" si aggiorna quando il tablet scaldavivande registra pezzi
- "Da cucinare" si ricalcola automaticamente
- **Colore "da cucinare":** verde se 0, giallo se 1-10, rosso se > 10
- Font molto grandi (leggibili da 2-3 metri), sfondo scuro, numeri contrastanti
- Flash visivo quando un numero cambia (200ms)
- Schermo intero automatico
- Se la connessione cade: overlay rosso "CONNESSIONE PERSA"

### 5.6 — Componente: Tablet Scaldavivande (public/scaldavivande.html)

Questa pagina viene aperta sul tablet allo scalda vivande della griglia. L'addetto registra i pezzi cucinati a **decine**.

**Layout (pulsanti grandi, touch-friendly) — usa /frontend-design:**

```
╔════════════════════════════════════════════════════════════╗
║  SCALDAVIVANDE                          ● Connesso        ║
║                                                            ║
║  Bistecca     [−]   30   [+10] [+20] [+30] [+40] [+50]  ║
║  Costine      [−]   22   [+10] [+20] [+30] [+40] [+50]  ║
║  Salsiccia    [−]   47   [+10] [+20] [+30] [+40] [+50]  ║
║  Spiedini     [−]   18   [+10] [+20] [+30] [+40] [+50]  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Si connette via Socket.IO con ruolo `scaldavivande`
- Per ogni piatto: pulsanti **+10, +20, +30, +40, +50** per aggiungere velocemente i pezzi cucinati
- Pulsante **−** per correggere errori (toglie 1 alla volta, o tenendo premuto apre input numerico per togliere N pezzi)
- Il contatore al centro mostra il totale "pronto" per quel piatto
- Ogni tap invia `counter_update` al server con il delta
- Il server fa broadcast → la colonna "pronto" del monitor cuochi si aggiorna in tempo reale
- Feedback visivo immediato al tap (pulsante lampeggia per 200ms)
- Pulsanti enormi touch-friendly (minimo 80x80px)
- Spazio tra le righe generoso per evitare tap accidentali
- Se la connessione cade: disabilitare i pulsanti e mostrare avviso

**Eventi Socket.IO:**

| Evento | Direzione | Payload |
|---|---|---|
| `counter_update` | Scaldavivande → Server | `{ item: 'bistecca', delta: 10 }` |
| `counters_changed` | Server → Monitor | `{ counters: { bistecca: { pronto: 30, vendute: 45 } } }` |

### 5.7 — Componente: Tablet Zona Controllo (public/controllo.html)

Tablet fisso alla zona uscita. L'addetto digita il numero ordine per segnarlo come evaso. **Sostituisce il lettore barcode.**

**Layout — usa /frontend-design:**

```
╔════════════════════════════════════════╗
║  ZONA CONTROLLO           ● Connesso  ║
║                                        ║
║  Digita il numero ordine:             ║
║                                        ║
║  ┌────────────────────────┐           ║
║  │        385             │           ║
║  └────────────────────────┘           ║
║                                        ║
║  [1] [2] [3]                          ║
║  [4] [5] [6]                          ║
║  [7] [8] [9]                          ║
║  [C] [0] [EVADI ✓]                   ║
║                                        ║
║  Ultimo evaso: #384 — Tav.7 ✓        ║
║                                        ║
╚════════════════════════════════════════╝
```

**Comportamento:**
- Si connette via Socket.IO con ruolo `controllo`
- Tastierino numerico grande (touch-friendly, pulsanti 80x80px)
- L'addetto digita il numero ordine e preme "EVADI ✓"
- Il sistema cerca l'ordine → se trovato: schermata verde "Ordine #XXX evaso — Tav.Y" per 3 secondi
- Se non trovato: schermata rossa "Ordine non trovato" per 3 secondi
- Se ordine già evaso: schermata gialla "Ordine #XXX già evaso" per 3 secondi
- Il campo si svuota automaticamente dopo ogni operazione (pronto per il prossimo)
- Mostra l'ultimo ordine evaso in basso come riferimento
- Pulsante [C] cancella l'input corrente

**Eventi Socket.IO:**

| Evento | Direzione | Payload |
|---|---|---|
| `order_fulfilled` | Controllo → Server | `{ order_number: 385 }` |
| `order_fulfilled_result` | Server → Controllo | `{ success: true, order_number: 385, table: 7 }` |

### 5.8 — Contenuto stampa di test

Quando l'utente preme "Stampa Test" su una stampante, il sistema stampa una pagina con:

```
================================
    ★ SAGRAPP — TEST STAMPA ★
================================

Stampante: vretti (Ricevuta Cassa Generale)
Connessione: LAN (192.168.1.203)
Data: 16/03/2026 15:30:22

Questa stampante funziona
correttamente!

Test caratteri speciali:
àèìòù ÀÈÌÒÙ €

================================
    Larghezza: 80mm
    |||||||||||||||||||||||||||
    (barre allineamento)
================================
```

Per la stampante Fuhuihe (comanda cibo .205):

```
================================
  COMANDA CIBO — TEST
================================
Stampante: Fuhuihe POS (LAN)
IP: 192.168.1.205
Ordine: TEST-001
Tavolo: 99

1x Bistecca test
1x Pasta test
1x Birra test

================================
================================
```

Per la stampante Fuhuihe (comanda bevande):

```
================================
  COMANDA BEVANDE — TEST
================================
Stampante: Fuhuihe POS (LAN)
IP: 192.168.1.204
Ordine: TEST-002

2x Birra media test
1x Coca Cola test
1x Acqua test

================================
```

---

### 5.9 — Componente: Interfaccia Cassa (public/cassa.html)

Pagina principale per il cassiere. La disposizione dei piatti **replica esattamente il foglio cartaceo** della comanda (file `2025_sagra_COMANDA.pdf`) così il cassiere segue lo stesso ordine visivo.

**Layout a due colonne — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════════════╗
║  CASSA GENERALE         Ordine #247         ● Connesso          ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Nome: [_______________]  Tavolo: [__]  Coperti: [__]           ║
║                                                                  ║
║  ☐ Sponsor (gratis)  ☐ Don Pierino (gratis)  ☐ Amici (gratis)  ║
║  Sconto: [___] €                                                 ║
║                                                                  ║
║  COLONNA SINISTRA              │  COLONNA DESTRA                ║
║  (come foglio cartaceo)        │  (come foglio cartaceo)        ║
║                                │                                 ║
║  PRIMI                         │  CONTORNI                      ║
║  [Gnocchi ragù    €5,50  −0+] │  [Patate fritte  €2,90  −0+]  ║
║  [Gnocchi burro   €5,50  −0+] │  [Fagioli        €2,50  −0+]  ║
║  [Pasta ragù      €4,50  −0+] │  [Fagioli cip.   €2,50  −0+]  ║
║  [Pasta bianco    €4,50  −0+] │  [Cappuccio       €2,00  −0+]  ║
║                                │  [Funghi          €3,20  −0+]  ║
║  SECONDI                       │                                 ║
║  [Form. cotto*    €6,00  −0+] │  BEVANDE                       ║
║  [Wurstel patate  €5,00  −0+] │  [Birra spina    €3,50  −0+]  ║
║  [Pastin patate   €7,50  −0+] │  [Vino ombra B   €1,00  −0+]  ║
║  [Salsiccia*      €6,80  −0+] │  [Vino ombra R   €1,00  −0+]  ║
║  [Costicine*      €7,30  −0+] │  [Vino B 1/2     €3,00  −0+]  ║
║  [Sovracoscia*    €7,30  −0+] │  [Vino R 1/2     €3,00  −0+]  ║
║  [Grigliata m.*  €11,00  −0+] │  [Vino B 3/4     €4,00  −0+]  ║
║                                │  [Vino R 3/4     €4,00  −0+]  ║
║  SPECIALE DEL GIORNO           │  [Prosecco       €9,00  −0+]  ║
║  [Pesce fritto   €13,00  −0+] │  [Cabernet       €7,50  −0+]  ║
║                                │  [Acqua nat.     €1,00  −0+]  ║
║  CONDIMENTI                    │  [Acqua frizz.   €1,00  −0+]  ║
║  [Maionese        €0,30  −0+] │  [The pesca      €2,30  −0+]  ║
║  [Ketchup         €0,30  −0+] │  [The limone     €2,30  −0+]  ║
║                                │  [Coca Cola      €2,30  −0+]  ║
║                                │  [Coca Zero      €2,30  −0+]  ║
║                                │  [Fanta          €2,30  −0+]  ║
║                                │                                 ║
║  ══════════════════════════════════════════════════════════════  ║
║                                                                  ║
║  RIEPILOGO:  12 articoli              TOTALE: € 45,80           ║
║                                       Sconto: − € 0,00          ║
║                                       DA PAGARE: € 45,80        ║
║                                                                  ║
║              [ORDINA E STAMPA]                                   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

**Campi dell'ordine:**

| Campo | Tipo | Obbligatorio | Note |
|---|---|---|---|
| Nome cliente | Testo | No | Per identificare l'ordine |
| Numero tavolo | Numerico | **Sì** | Stampato su tutte le comande |
| Numero coperti | Numerico | **Sì** | Stampato sulla comanda bevande (per le posate) |
| Sconto | Numerico (€) | No | Sottratto dal totale |
| Flag Sponsor | Toggle | No | Se attivo → ordine gratis (totale €0) |
| Flag Don Pierino | Toggle | No | Se attivo → ordine gratis (totale €0) |
| Flag Amici | Toggle | No | Se attivo → ordine gratis (totale €0) |

**Logica Flag Gratis (Sponsor / Don Pierino / Amici):**
- Quando un flag è attivo, il totale diventa **€0,00**
- L'ordine viene comunque registrato con tutti i piatti e stampato normalmente
- Il magazzino scala le scorte come un ordine normale
- Il monitor cuochi si aggiorna normalmente
- Il tipo di omaggio viene salvato nel database per i report
- Solo un flag alla volta può essere attivo

**Logica stampa:**
- Pulsante "ORDINA E STAMPA" → crea l'ordine e stampa su tutte le stampanti necessarie
- **Ricevuta cliente** → vretti .203 (con nome, tavolo, piatti, totale, eventuale flag gratis)
- **Comanda cibo** → Fuhuihe .205 (con tavolo, piatti cibo, numero ordine)
- **Comanda bevande** → Fuhuihe .204 (con tavolo, **COPERTI**, bevande) — **i coperti vanno stampati qui**
- **Piatti speciali** → Fuhuihe .207 (solo se presenti nell'ordine, doppia stampa)
- Se l'ordine non ha bevande ma ha cibo: i coperti vengono stampati sulla comanda cibo come fallback
- Dopo la stampa: conferma a schermo con numero ordine, poi svuota il carrello

**Piatto speciale del giorno:**
- Il sistema mostra automaticamente solo il piatto speciale disponibile per la data corrente
- Se nessun piatto speciale è previsto per oggi, la sezione non appare
- L'admin può attivare/disattivare il piatto speciale dalla dashboard

**Comportamento pulsanti piatto:**
- Ogni piatto ha un contatore con [−] [numero] [+]
- Tap su [+] → incrementa quantità, aggiorna totale in tempo reale
- Tap su [−] → decrementa (minimo 0)
- I piatti con quantità > 0 sono evidenziati visivamente
- I piatti esauriti (scorta magazzino = 0) sono disabilitati con badge rosso "ESAURITO"
- I piatti sotto soglia magazzino hanno badge arancione con porzioni rimanenti

### 5.10 — Componente: Login Admin (public/admin-login.html)

Pagina semplice con un campo PIN numerico. Protegge l'accesso a tutte le pagine admin.

**Layout:**
- Campo PIN centrato nello schermo con tastierino numerico grande (touch-friendly)
- Pulsanti 0-9 grandi (stile calcolatrice), pulsante "Entra", pulsante "Cancella"
- Se PIN errato: shake animation + messaggio errore
- Se PIN corretto: redirect alla dashboard admin live
- Il PIN è configurabile in `config.js` (default: `1234`)

**Implementazione:**
- POST `/api/admin/login` con il PIN
- Se corretto, il server restituisce un token (salvato in `sessionStorage`)
- Tutte le pagine admin verificano il token prima di caricare

### 5.11 — Componente: Dashboard Admin LIVE (public/admin.html)

Dashboard in tempo reale per il responsabile durante il servizio.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  📊 SagrApp Admin — LIVE                    [Magazzino] ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       ║
║  │  ORDINI     │ │  INCASSO    │ │  INCOMPLETI │       ║
║  │    142      │ │  €4.850     │ │     3       │       ║
║  │  +12 ultima │ │  +€340 ult. │ │  ⚠ attenz.  │       ║
║  │  mezz'ora   │ │  mezz'ora   │ │             │       ║
║  └─────────────┘ └─────────────┘ └─────────────┘       ║
║                                                          ║
║  INCASSO PER CASSA              INCASSO PER PAGAMENTO   ║
║  ┌──────────────────────┐      ┌──────────────────────┐ ║
║  │ Cassa princ.  €3.200 │      │ Contanti     €2.900  │ ║
║  │ Cassa bar     €1.650 │      │ POS          €1.950  │ ║
║  └──────────────────────┘      └──────────────────────┘ ║
║                                                          ║
║  ⚠ SCORTE IN ESAURIMENTO                               ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ 🟡 Bistecca      18 rimaste / 200    [+10] [+50]│   ║
║  │ 🔴 Salsiccia     ESAURITO            [Riattiva] │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  ULTIMI ORDINI                                          ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ #142  Tav.7   €32.50  ● Completato   14:32:05  │   ║
║  │ #141  Tav.12  €28.00  ● In corso     14:31:22  │   ║
║  │ #140  Tav.3   €15.00  ● Completato   14:30:45  │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  GRIGLIA — SPRECHI                                      ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Ordinato: 85  │ Prodotto: 92  │ Delta: +7 ⚠     │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  [Dashboard RECAP]  [Magazzino]  [Test Hardware]        ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Si connette via Socket.IO con ruolo `admin`
- Tutti i dati si aggiornano in tempo reale (ordini, incasso, scorte)
- La sezione "Scorte in esaurimento" mostra SOLO i piatti sotto soglia o esauriti (non tutti)
- I pulsanti [+10] [+50] permettono di aggiornare le scorte rapidamente senza uscire dalla dashboard
- Il pulsante [Riattiva] su un piatto esaurito chiede la nuova quantità e lo rimette disponibile
- Ogni contatore ha un'animazione sottile quando il valore cambia (flash 200ms)

### 5.12 — Componente: Dashboard Admin RECAP (public/admin-recap.html)

Report completo post-servizio. Dati statici (non real-time), calcolati alla chiusura della serata.

**Sezioni:**
1. **Riepilogo incassi** — Totale, per cassa, per metodo pagamento
2. **Classifica vendite** — Piatti ordinati dal più al meno venduto, con quantità e incasso
3. **Performance** — Tempo medio evasione, distribuzione ordini nel tempo (grafico orario)
4. **Magazzino** — Per ogni piatto: scorta iniziale → venduto → rimanente. Piatti esauriti con timestamp
5. **Omaggi** — Totale omaggi suddiviso per tipo (Sponsor, Don Pierino, Amici), con valore economico reale di ciò che è stato regalato, numero ordini per tipo, dettaglio piatti omaggiati
6. **Sconti** — Totale sconti applicati, numero ordini con sconto
7. **Anomalie** — Ordini incompleti, sprechi griglia (prodotto vs venduto)
8. **Pulsante esportazione** — CSV per importazione in Excel

**Layout:** usa /frontend-design — stile report, card per ogni sezione, numeri grandi per i KPI principali

### 5.13 — Componente: Gestione Magazzino (public/admin-magazzino.html)

Pagina dedicata alla gestione completa delle scorte. L'admin ci va prima dell'apertura per impostare le quantità, e durante il servizio per aggiornamenti rapidi.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  📦 Magazzino — Gestione Scorte              [← Admin]  ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  [Reset scorte inizio serata]  [Salva preset]           ║
║                                                          ║
║  🔍 Filtra: [Tutti ▼] [Solo in esaurimento] [Esauriti] ║
║                                                          ║
║  ┌────────────────────────────────────────────────────┐ ║
║  │ PIATTO          SCORTA     SOGLIA    STATO   AZIONI│ ║
║  ├────────────────────────────────────────────────────┤ ║
║  │ Bistecca        ████░░  82/200   20    🟢    [-][+]│ ║
║  │                                        [+10][+50]  │ ║
║  │                                        [Imposta: __]│ ║
║  ├────────────────────────────────────────────────────┤ ║
║  │ Costine         █████░  145/200  20    🟢    [-][+]│ ║
║  ├────────────────────────────────────────────────────┤ ║
║  │ Salsiccia       ░░░░░░  0/300    30    🔴    [Riat]│ ║
║  ├────────────────────────────────────────────────────┤ ║
║  │ Pasta ragù      ██░░░░  18/150   15    🟡    [-][+]│ ║
║  │                                        [+10][+50]  │ ║
║  ├────────────────────────────────────────────────────┤ ║
║  │ Birra media     ███████ 340/500  50    🟢    [-][+]│ ║
║  └────────────────────────────────────────────────────┘ ║
║                                                          ║
║  Legenda: 🟢 Disponibile  🟡 In esaurimento  🔴 Esaurito║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Lista completa di tutti i piatti del menu con scorte
- **Barra di progresso visiva** per ogni piatto (verde → giallo sotto soglia → rosso a zero)
- **Pulsanti rapidi** per aggiornare: [−1] [+1] [+10] [+50] e campo libero [Imposta: ___]
- **Soglia alert configurabile** per ogni piatto (campo editabile)
- **Filtri rapidi**: tutti, solo in esaurimento, solo esauriti
- Pulsante **"Reset scorte inizio serata"** → ripristina tutte le scorte ai valori iniziali (con conferma)
- Pulsante **"Salva preset"** → salva la configurazione corrente come template riutilizzabile per le serate successive
- Aggiornamento in tempo reale: se un ordine arriva e scala la scorta, il numero si aggiorna live
- Pulsante **"Riattiva"** per piatti esauriti: chiede nuova quantità, rimette il piatto disponibile alle casse

**Interazione scorte (UX critica):**
L'aggiornamento scorte deve essere velocissimo. L'admin in mezzo al caos della sagra non ha tempo per form complessi.

Per aggiungere scorte: tap su [+10] o [+50] → la scorta si aggiorna istantaneamente, nessuna conferma richiesta.
Per impostare un valore esatto: tap sul campo [Imposta: ___] → appare tastierino numerico → inserisci numero → conferma.
Per segnare esaurito manualmente: swipe a sinistra sulla riga → pulsante "Esaurisci" (o pulsante dedicato).

### 5.14 — Componente: Selezione Ruolo (public/index.html — Landing Page)

Un singolo URL per tutti i dispositivi. All'apertura, l'utente sceglie il ruolo del dispositivo.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║                     🎪 SagrApp                           ║
║              Seleziona il tuo dispositivo                ║
║                                                          ║
║   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ ║
║   │  🖥️ CASSA    │  │  🖥️ CASSA    │  │  🖥️ CASSA    │ ║
║   │  PRINCIPALE  │  │    BAR       │  │    EXTRA     │ ║
║   └──────────────┘  └──────────────┘  └──────────────┘ ║
║                                                          ║
║   ┌──────────────┐  ┌──────────────┐                    ║
║   │  📺 MONITOR  │  │  📱 TABLET   │                    ║
║   │   CUOCHI     │  │ PASSA-PIATTI │                    ║
║   └──────────────┘  └──────────────┘                    ║
║                                                          ║
║   ┌──────────────┐  ┌──────────────┐                    ║
║   │  📊 DASHBOARD│  │  🔧 CONTROLLO│                    ║
║   │    ADMIN     │  │   HARDWARE   │                    ║
║   └──────────────┘  └──────────────┘                    ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Card grandi, touch-friendly, con icona e nome ruolo
- Tap su un ruolo → redirect alla pagina corrispondente
- I ruoli admin richiedono il PIN prima di accedere
- Il ruolo scelto viene salvato in `localStorage`: al prossimo avvio, il dispositivo va direttamente alla pagina del ruolo salvato senza passare dalla selezione
- Pulsante piccolo "Cambia ruolo" sempre visibile in ogni pagina per tornare alla selezione

### 5.15 — Componente: Setup Inizio Turno (public/setup.html)

Wizard guidato che verifica tutto l'hardware prima di iniziare il servizio. Accessibile solo dall'admin.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  🚀 Setup Inizio Turno                                  ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  ✅ Server cloud              Online (32ms)              ║
║  ✅ Print proxy               Connesso                   ║
║  ✅ vretti (ricevuta cassa)   .203 OK                    ║
║  ✅ vretti (comanda cibo)     192.168.1.202 OK           ║
║  ⏳ Fuhuihe (comanda bev.)   Test in corso...            ║
║  ⬜ Monitor cuochi            In attesa                   ║
║  ⬜ Tablet passa-piatti       In attesa                   ║
║  ⬜ Tablet zona controllo     In attesa                   ║
║                                                          ║
║  ████████████░░░░░░░░░  62% completato                  ║
║                                                          ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ ⚠ Fuhuihe: timeout connessione.                 │   ║
║  │ Suggerimento: verifica che sia accesa e          │   ║
║  │ collegata al Powerline con cavo LAN.             │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  [▶ AVVIA SERVIZIO]  (attivo solo quando tutto ✅)      ║
║  [⚠ Avvia con limitazioni]  (se dispositivi non critici)║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- I check partono automaticamente uno dopo l'altro con animazione
- Per ogni stampante: TCP ping (LAN) o device check (USB) + stampa di test opzionale
- Per monitor e tablet: verifica che siano connessi via Socket.IO
- Per tablet zona controllo: verifica connessione Socket.IO
- Se un check fallisce: mostra il problema specifico e un suggerimento per risolverlo
- Pulsante "Riprova" per ritentare un check fallito singolarmente
- "Avvia Servizio" abilitato solo quando tutti i check critici (server, proxy, almeno 1 stampante) sono verdi
- "Avvia con limitazioni" se mancano dispositivi non critici (monitor, scaldavivande, zona controllo)

### 5.16 — Componente: Pannello Controllo Hardware (public/admin-hardware.html)

Monitoraggio continuo di tutti i dispositivi durante il servizio.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  🔧 Controllo Hardware              Ultimo check: 3s fa ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  DISPOSITIVI                                             ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ ● Server cloud          Online    32ms   da 18:00│   ║
║  │ ● Print proxy           Connesso        da 18:00│   ║
║  │ ● vretti (.203)         Online    8ms   da 18:01│   ║
║  │ ● vretti (.202)         Online    8ms   da 18:01│   ║
║  │ ● Fuhuihe (.204)        Online    12ms  da 18:01│   ║
║  │ ● Monitor cuochi        Connesso        da 18:02│   ║
║  │ ● Tablet passa-piatti   Connesso        da 18:03│   ║
║  │ ○ Tablet zona controllo In attesa              │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  LOG EVENTI                                              ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ 21:15  ⚠ vretti (.202) disconnessa              │   ║
║  │ 21:16  ✅ vretti (.202) riconnessa               │   ║
║  │ 20:30  ℹ Tablet passa-piatti connesso            │   ║
║  │ 18:00  ℹ Setup completato — servizio avviato     │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Check automatico ogni 5 secondi su tutti i dispositivi
- Indicatore colorato: verde = online, rosso = offline, giallo = latenza alta, grigio = mai connesso
- Per ogni dispositivo: tempo di connessione ("da 18:00"), latenza (per LAN)
- Log cronologico degli eventi hardware della serata (scrollabile)
- Se un dispositivo va offline: riga diventa rossa con animazione pulsante

### 5.17 — Alert Sonori/Visivi e Modalità Emergenza Stampante

Queste non sono pagine separate ma comportamenti integrati nelle pagine cassa e admin.

**Alert alle casse (integrato nella pagina cassa):**
Quando una stampante si disconnette:
- Popup overlay semitrasparente a centro schermo: "⚠ STAMPANTE [nome] OFFLINE"
- Suono di alert (beep) ripetuto 3 volte
- Il popup ha due pulsanti: "OK, ho capito" (chiude il popup) e "Dettagli" (apre pannello HW)
- Il cassiere può continuare a lavorare dopo aver chiuso il popup

**Modalità emergenza stampante (integrata nella logica di stampa):**
Se una stampante è offline al momento di stampare:
- La comanda/ricevuta viene messa in **coda di stampa** (salvata nel DB)
- La comanda viene mostrata a schermo in formato grande e leggibile (popup con contenuto della comanda)
- Banner giallo fisso in alto nella cassa: "⚠ EMERGENZA — [nome stampante] offline — comande a schermo"
- Opzione admin: "Redirect stampe su stampante [altra]" per deviare temporaneamente
- Quando la stampante torna online: le comande in coda vengono stampate automaticamente con notifica "Coda stampa esaurita"

**Eventi Socket.IO aggiuntivi:**

| Evento | Direzione | Payload | Descrizione |
|---|---|---|---|
| `hw_alert` | Server → Casse + Admin | `{ device, status, message }` | Dispositivo cambiato stato |
| `print_queued` | Server → Cassa | `{ job_id, content_preview }` | Stampa messa in coda (stampante offline) |
| `print_queue_flushed` | Server → Cassa + Admin | `{ printer_id, jobs_printed }` | Coda svuotata, stampante tornata online |
| `service_started` | Server → All | `{ timestamp }` | Setup completato, servizio avviato |
| `service_closed` | Server → All | `{ timestamp, summary }` | Servizio chiuso dal responsabile |

### 5.18 — Componente: Chiusura Turno (public/admin-chiusura.html)

Procedura guidata per chiudere il servizio a fine serata.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  🔒 Chiusura Servizio                                   ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  STEP 1 — Verifica ordini aperti                        ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ ⚠ 3 ordini ancora incompleti:                   │   ║
║  │   #389 Tav.12 — creato 15 min fa                │   ║
║  │   #391 Tav.5  — creato 8 min fa                 │   ║
║  │   #394 Tav.22 — creato 3 min fa                 │   ║
║  │                                                   │   ║
║  │ [Chiudi tutti forzatamente]  [Aspetta]           │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  STEP 2 — Riepilogo flash                               ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Incasso totale:      €8.450                      │   ║
║  │ Ordini totali:       342                          │   ║
║  │ Piatti esauriti:     2 (Salsiccia, Costine)      │   ║
║  │ Tempo medio ordine:  4:32 min                    │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  STEP 3 — Conferma [PIN richiesto]                      ║
║  [🔒 CHIUDI SERVIZIO]                                   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Step 1: mostra ordini incompleti. L'admin può chiuderli forzatamente o aspettare
- Step 2: riepilogo numeri chiave della serata (non il report completo, quello è nella RECAP)
- Step 3: richiede il PIN admin e conferma definitiva
- Dopo la chiusura: tutte le casse mostrano "Servizio chiuso" e non accettano più ordini
- Il report completo è disponibile nella dashboard RECAP

---

## 6. Stampa ESC/POS — Riferimento Tecnico

### Comandi ESC/POS essenziali

```javascript
const ESC = 0x1B;
const GS = 0x1D;

// Inizializzazione
const INIT = Buffer.from([ESC, 0x40]); // Reset stampante

// Allineamento
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const ALIGN_RIGHT = Buffer.from([ESC, 0x61, 0x02]);

// Stile testo
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
const DOUBLE_HEIGHT = Buffer.from([GS, 0x21, 0x01]);  // Testo doppia altezza
const DOUBLE_WIDTH = Buffer.from([GS, 0x21, 0x10]);   // Testo doppia larghezza
const DOUBLE_BOTH = Buffer.from([GS, 0x21, 0x11]);    // Doppia altezza + larghezza
const NORMAL_SIZE = Buffer.from([GS, 0x21, 0x00]);    // Testo normale

// Barcode Code 128
// GS k m d1...dk NUL
function printBarcode128(data) {
  const barcodeCmd = Buffer.from([
    GS, 0x68, 80,        // Altezza barcode: 80 dots
    GS, 0x77, 2,         // Larghezza barcode: 2
    GS, 0x48, 2,         // Posizione testo HRI: sotto il barcode
    GS, 0x6B, 73,        // Tipo: Code 128
    data.length,          // Lunghezza dati
    ...Buffer.from(data), // Dati
  ]);
  return barcodeCmd;
}

// Taglio carta
const CUT = Buffer.from([GS, 0x56, 0x00]); // Taglio completo
const PARTIAL_CUT = Buffer.from([GS, 0x56, 0x01]); // Taglio parziale

// Avanzamento carta
const FEED = Buffer.from([ESC, 0x64, 0x05]); // Avanza 5 righe
```

### Invio alla stampante via TCP

```javascript
const net = require('net');

function printToLAN(ip, port, data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(5000);

    client.connect(port, ip, () => {
      client.write(data, () => {
        client.end();
        resolve({ success: true });
      });
    });

    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error('Timeout connessione stampante'));
    });
  });
}
```

### TCP Ping (verifica raggiungibilità)

```javascript
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
```

---

## 7. Setup e Deploy

### 6.1 — Server Cloud (VPS)

```bash
# Su un VPS Hetzner/DigitalOcean con Ubuntu 22+
# Installare Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clonare il progetto
git clone <repo> /opt/sagrapp
cd /opt/sagrapp

# Installare dipendenze
npm install

# Avviare con PM2 (processo persistente)
npm install -g pm2
pm2 start server/index.js --name sagrapp
pm2 save
pm2 startup
```

### 6.2 — Print Proxy (qualsiasi PC alla sagra)

```bash
# Su un PC collegato alla stessa rete Wi-Fi del router
# Richiede Node.js installato (scaricare da https://nodejs.org)

cd print-proxy
npm install

# Configurare il server URL in config.js
# SERVER_URL = 'https://sagrapp.server.com'

# Avviare il print proxy
node index.js
```
```

### 6.3 — Dispositivi

Ogni dispositivo apre semplicemente il browser e naviga a:

| Dispositivo | URL |
|---|---|
| Tutti (landing page) | `https://sagrapp.server.com/` |
| Dashboard test HW | `https://sagrapp.server.com/test` |
| Monitor cuochi (TV) | `https://sagrapp.server.com/monitor` |
| Tablet scaldavivande | `https://sagrapp.server.com/scaldavivande` |
| Tablet zona controllo | `https://sagrapp.server.com/controllo` |
| Admin | `https://sagrapp.server.com/admin` |

---

## 8. Configurazione (config.js)

```javascript
module.exports = {
  PORT: 3000,

  // PIN accesso admin (4-6 cifre)
  ADMIN_PIN: '1234',

  // Stampanti — tutte in rete LAN via Powerline (ESC/POS TCP porta 9100)
  // Nessuna stampante USB
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
  // Il menu è configurabile dalla dashboard admin.
  // Questa è la configurazione iniziale di default.
  // category: 'primo' | 'secondo' | 'contorno' | 'condimento' | 'bevanda' | 'speciale'
  // station: 'cucina' | 'piastra' | 'griglia' | 'polenta' | 'bar' | 'speciali'
  // print_to: quali stampanti ricevono la comanda (oltre alla ricevuta)
  // composition: scomposizione in pezzi singoli per monitor cuochi e magazzino
  // special: true = doppia stampa (.205 + .207)
  // available_date: se presente, il piatto è disponibile solo in quella data

  MENU: [
    // PRIMI
    { id: 'gnocchi_ragu', name: 'Gnocchi al ragù', price: 5.50, category: 'primo', station: 'cucina', print_to: ['cibo'] },
    { id: 'gnocchi_burro', name: 'Gnocchi burro e salvia', price: 5.50, category: 'primo', station: 'cucina', print_to: ['cibo'] },
    { id: 'pasta_ragu', name: 'Pasta al ragù', price: 4.50, category: 'primo', station: 'cucina', print_to: ['cibo'] },
    { id: 'pasta_bianco', name: 'Pasta in bianco', price: 4.50, category: 'primo', station: 'cucina', print_to: ['cibo'] },

    // SECONDI — PIASTRA
    { id: 'formaggio_polenta', name: 'Formaggio cotto con polenta', price: 6.00, category: 'secondo', station: 'piastra', print_to: ['cibo'],
      composition: { polenta: 1 } },
    { id: 'wurstel_patate', name: 'Wurstel con patate fritte', price: 5.00, category: 'secondo', station: 'piastra', print_to: ['cibo'],
      composition: { patate: 1 } },

    // SECONDI — GRIGLIA (vanno allo scaldavivande, composizione in pezzi singoli)
    { id: 'pastin_patate', name: 'Pastin con patate fritte', price: 7.50, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { pastin: 2, patate: 1 } },
    { id: 'salsiccia_polenta', name: 'Salsiccia con polenta', price: 6.80, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { salsicce: 2, polenta: 1 } },
    { id: 'costicine_polenta', name: 'Costicine con polenta', price: 7.30, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { costicine: 3, polenta: 1 } },
    { id: 'sovracoscia_polenta', name: 'Sovracoscia di pollo con polenta', price: 7.30, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { sovracoscia: 1, polenta: 1 } },
    { id: 'grigliata_mista', name: 'Grigliata mista con polenta', price: 11.00, category: 'secondo', station: 'griglia', print_to: ['cibo'],
      composition: { costicine: 2, salsicce: 1, sovracoscia: 0.5, polenta: 1 } },

    // PIATTI SPECIALI — doppia stampa: .205 (cibo) + .207 (speciali)
    { id: 'pesce_fritto', name: 'Pesce fritto', price: 13.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-10' },
    { id: 'coniglio', name: 'Coniglio', price: 15.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-11' },
    { id: 'costata', name: 'Costata', price: 24.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-16' },
    { id: 'galletto_patate', name: 'Galletto con patate', price: 13.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-17' },
    { id: 'trippa', name: 'Trippa', price: 7.50, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-18' },
    { id: 'paella', name: 'Paella', price: 16.00, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-23' },
    { id: 'spiedo', name: 'Spiedo', price: 12.80, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-24' },
    { id: 'frico', name: 'Frico', price: 8.50, category: 'speciale', station: 'speciali', print_to: ['cibo', 'speciali'], special: true, available_date: '2025-05-25' },

    // CONTORNI
    { id: 'patate_fritte', name: 'Patate fritte', price: 2.90, category: 'contorno', station: 'cucina', print_to: ['cibo'] },
    { id: 'fagioli', name: 'Fagioli', price: 2.50, category: 'contorno', station: 'cucina', print_to: ['cibo'] },
    { id: 'fagioli_cipolla', name: 'Fagioli con cipolla', price: 2.50, category: 'contorno', station: 'cucina', print_to: ['cibo'] },
    { id: 'cappuccio', name: 'Cappuccio', price: 2.00, category: 'contorno', station: 'cucina', print_to: ['cibo'] },
    { id: 'funghi', name: 'Funghi misto bosco', price: 3.20, category: 'contorno', station: 'cucina', print_to: ['cibo'] },
    { id: 'maionese', name: 'Maionese', price: 0.30, category: 'condimento', station: 'cucina', print_to: ['cibo'] },
    { id: 'ketchup', name: 'Ketchup', price: 0.30, category: 'condimento', station: 'cucina', print_to: ['cibo'] },

    // BEVANDE (tutte vanno alla stampante comanda bevande .204)
    { id: 'birra_spina', name: 'Birra alla spina', price: 3.50, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'vino_bianco_ombra', name: 'Vino ombra bianco', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'vino_rosso_ombra', name: 'Vino ombra rosso', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'vino_bianco_mezzo', name: 'Vino bianco sfuso 1/2 litro', price: 3.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'vino_rosso_mezzo', name: 'Vino rosso sfuso 1/2 litro', price: 3.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'vino_bianco_trequarti', name: 'Vino bianco sfuso 3/4 litro', price: 4.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'vino_rosso_trequarti', name: 'Vino rosso sfuso 3/4 litro', price: 4.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'prosecco', name: 'Bottiglia Prosecco Superiore DOCG', price: 9.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'cabernet', name: 'Bottiglia Cabernet', price: 7.50, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'acqua_naturale', name: 'Acqua minerale naturale 1/2 litro', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'acqua_frizzante', name: 'Acqua minerale frizzante 1/2 litro', price: 1.00, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'the_pesca', name: 'Lattina the alla pesca', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'the_limone', name: 'Lattina the al limone', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'coca_cola', name: 'Lattina Coca Cola', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'coca_zero', name: 'Lattina Coca Cola Zero', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
    { id: 'fanta', name: 'Lattina Fanta', price: 2.30, category: 'bevanda', station: 'bar', print_to: ['bevande'] },
  ],

  // Mappa stampanti per tipo di comanda
  PRINT_ROUTES: {
    'ricevuta_cassa': '192.168.1.203',    // vretti — ricevuta cassa generale
    'ricevuta_bar': '192.168.1.206',      // Fuhuihe — ricevuta cassa bar
    'ricevuta_casetta': '192.168.1.208',  // Fuhuihe — ricevuta casetta aperitivi
    'cibo': '192.168.1.205',              // Fuhuihe — comanda cibo
    'bevande': '192.168.1.204',           // Fuhuihe — comanda bevande
    'speciali': '192.168.1.207',          // Fuhuihe — piatti speciali (doppia stampa)
  },

  // Articoli tracciati sul monitor cuochi (pezzi singoli)
  MONITOR_ITEMS: ['costicine', 'salsicce', 'sovracoscia', 'pastin', 'polenta', 'patate'],
};
```

---

## 9. Requisiti Non Funzionali

### Performance
- Il sistema deve reggere aggiornamenti real-time con latenza < 500ms
- Le stampe devono completarsi entro 3 secondi dal comando

### Resilienza
- Se il proxy si disconnette, la dashboard lo mostra chiaramente
- Se una stampante non risponde, il test la segna come offline senza bloccare gli altri
- Riconnessione automatica Socket.IO con retry esponenziale

### UX
- La dashboard deve essere comprensibile da un volontario non tecnico
- Il monitor TV deve avere font leggibili da 3 metri
- Il passa-piatti deve avere pulsanti touch-friendly (minimo 60x60px)
- Colori: verde = funziona, rosso = errore, grigio = non testato
- NO animazioni elaborate, NO framework CSS pesanti — semplicità

### Sicurezza
- Per questa fase di test non serve autenticazione
- In produzione (piattaforma finale) si aggiungerà un PIN di accesso

---

## 10. Checklist di Accettazione

Il test è superato quando:

- [ ] Il server si avvia e risponde su porta 3000
- [ ] La dashboard mostra lo stato connessione al server
- [ ] Il print proxy si connette al server e appare come "online" sulla dashboard
- [ ] Ogni stampante viene testata con TCP ping e mostra online/offline
- [ ] Il pulsante "Stampa Test" stampa effettivamente sulla stampante corretta
- [ ] Tutte e 6 le stampanti LAN rispondono ai rispettivi IP (.203-.208)
- [ ] La pagina monitor cuochi mostra 3 colonne: da cucinare / pronto / vendute
- [ ] La pagina scaldavivande ha pulsanti +10, +20, +30, +40, +50 e − per ogni piatto
- [ ] Un tap sullo scaldavivande aggiorna la colonna "pronto" del monitor in tempo reale (< 1 secondo)
- [ ] Un ordine dalla cassa aggiorna la colonna "vendute" del monitor in tempo reale
- [ ] La colonna "da cucinare" si ricalcola automaticamente (vendute − pronto)
- [ ] Il tablet zona controllo mostra tastierino numerico
- [ ] Digitare un numero ordine e premere "Evadi" segna l'ordine come evaso
- [ ] Ordine non trovato → feedback rosso, ordine già evaso → feedback giallo
- [ ] Il pulsante "Test Completo" esegue tutti i test in sequenza
- [ ] Se una stampante è offline, il sistema lo segnala senza bloccarsi
- [ ] Se il proxy si disconnette, la dashboard lo mostra chiaramente
- [ ] Il monitor cuochi ha numeri leggibili da 3 metri (font 120px+)
- [ ] I pulsanti passa-piatti sono touch-friendly (80px+ area di tap)
- [ ] Il design è professionale e non generico (skill frontend-design applicata)
- [ ] Contrasto WCAG AA su tutte le pagine, AAA sul monitor cuochi
- [ ] **Login admin con PIN funziona (PIN errato → errore, PIN corretto → accesso)**
- [ ] **Dashboard admin LIVE mostra ordini, incasso, scorte in tempo reale**
- [ ] **Dashboard admin RECAP mostra report completo post-serata**
- [ ] **Magazzino: scorte configurabili con scorta iniziale e soglia alert**
- [ ] **Magazzino: pulsanti rapidi (+10, +50, custom) funzionanti**
- [ ] **Quando un piatto scende sotto soglia → alert visibile in dashboard e alle casse**
- [ ] **Quando un piatto arriva a zero → segnato esaurito, non ordinabile**
- [ ] **Admin può riattivare un piatto esaurito con nuova scorta**
- [ ] **Esportazione report RECAP in CSV funzionante**
- [ ] **Landing page con selezione ruolo funzionante**
- [ ] **Ruolo salvato in localStorage: al riavvio va diretto alla pagina giusta**
- [ ] **Setup inizio turno: wizard con check automatici su tutti i dispositivi**
- [ ] **Setup: pulsante "Avvia Servizio" attivo solo quando tutti i check critici sono verdi**
- [ ] **Pannello controllo HW: stato real-time tutti i dispositivi + log eventi**
- [ ] **Alert sonoro/visivo alle casse quando una stampante va offline**
- [ ] **Modalità emergenza: se stampante offline, comanda mostrata a schermo + coda di stampa**
- [ ] **Coda di stampa: quando la stampante torna online, le comande in coda vengono stampate**
- [ ] **Chiusura turno: verifica ordini aperti, riepilogo flash, conferma con PIN**
- [ ] **Dopo chiusura: casse mostrano "Servizio chiuso" e non accettano ordini**

---

## 11. Note per Claude Code

### Priorità di sviluppo
1. Server Express + Socket.IO (scheletro) + SQLite con schema inventario
2. Print proxy con TCP verso stampanti LAN + USB
3. **Landing page selezione ruolo** — **usa /frontend-design**
4. Dashboard test hardware con stato stampanti e pulsanti test — **usa /frontend-design**
5. Pagine monitor e passa-piatti con real-time — **usa /frontend-design**
6. Tablet zona controllo con tastierino numerico
7. Login admin con PIN
8. **Setup inizio turno (wizard)** — **usa /frontend-design**
9. **Pannello controllo hardware real-time** — **usa /frontend-design**
10. Gestione magazzino / scorte con pulsanti rapidi — **usa /frontend-design**
11. Dashboard admin LIVE con statistiche real-time — **usa /frontend-design**
12. Dashboard admin RECAP con report e esportazione CSV — **usa /frontend-design**
13. Alert scorte alle casse (WebSocket push)
14. **Alert sonori/visivi per problemi HW + modalità emergenza stampante**
15. **Chiusura turno guidata** — **usa /frontend-design**
16. Test completo automatizzato
17. Polish finale e verifica contrasto/leggibilità

### Librerie npm da usare
```json
{
  "dependencies": {
    "express": "^4.18",
    "socket.io": "^4.7",
    "cors": "^2.8"
  }
}
```

Per il print proxy:
```json
{
  "dependencies": {
    "socket.io-client": "^4.7"
  }
}
```

NON usare librerie per ESC/POS (node-thermal-printer, escpos, ecc.) — implementare i comandi ESC/POS direttamente con Buffer come mostrato nella sezione 5. È più affidabile e non introduce dipendenze pesanti.

### Skill frontend-design (OBBLIGATORIA)

Questo progetto utilizza la skill **frontend-design** di Anthropic per garantire interfacce professionali e usabili. La skill deve essere installata prima di iniziare lo sviluppo:

```bash
npx skills add anthropics/claude-code --skill frontend-design
```

Usa la skill `/frontend-design` per costruire TUTTE le pagine HTML del progetto (dashboard, monitor, passa-piatti). Non scrivere CSS generico — invoca la skill e lascia che guidi il design.

### Direttive di Design per la Skill frontend-design

Quando invochi la skill per questo progetto, comunica queste direttive:

**Contesto:** Interfaccia operativa per una sagra di paese. Usata da volontari non tecnici in condizioni di stress (calore, rumore, fretta). Deve essere leggibile, immediata, a prova di errore.

**Tono visivo:** Industrial/utilitarian — niente decorazioni inutili, tutto deve comunicare STATO (funziona / non funziona / in attesa). Pensare a un cruscotto di una centrale operativa, non a un sito web.

**Vincoli critici per ogni pagina:**

**Dashboard test hardware (index.html):**
- Sfondo scuro, card per ogni sezione (rete, stampanti, monitor, tablet, barcode)
- Indicatori di stato: cerchio verde = online, rosso = offline, grigio = non testato, giallo = in test
- Pulsanti "Stampa Test" grandi e chiari, con feedback visivo al click (cambio colore 500ms)
- Il pulsante "Test Completo" deve essere prominente e distinto dagli altri
- Mostrare timestamp dell'ultimo check per ogni dispositivo
- Layout responsive ma ottimizzato primariamente per schermi da 13"+ (PC cassa)

**Monitor cuochi (monitor.html):**
- MASSIMA LEGGIBILITÀ — numeri visibili da 3 metri di distanza
- Sfondo molto scuro (quasi nero), numeri in bianco o colore ad alto contrasto
- Font size dei numeri: almeno 120px su schermo 32"
- Nomi piatti: almeno 48px
- Layout a lista verticale, un piatto per riga, tutto lo schermo
- Nessun header, nessun footer, nessun menu — solo i dati
- Indicatore di connessione minimo (piccolo dot in un angolo)
- Se la connessione cade: overlay rosso semitrasparente con "CONNESSIONE PERSA" a tutto schermo
- Parametro URL `?mode=fullscreen` per nascondere qualsiasi chrome del browser
- Aggiornamento visivo quando un numero cambia: flash breve sul numero (200ms)

**Passa-piatti (passapiatti.html):**
- Pulsanti ENORMI e touch-friendly — minimo 80x80px, meglio 100x100px
- I pulsanti + e − devono avere un'area di tap generosa (non solo il testo)
- Feedback tattile al tap: il pulsante cambia colore per 200ms, il contatore si aggiorna istantaneamente
- Sfondo scuro per visibilità in ambiente luminoso (cucina)
- Un piatto per riga, layout semplice: nome — [−] numero [+]
- Il pulsante − deve essere visivamente diverso dal + (colore diverso, es. rosso vs verde)
- Spazio tra le righe generoso per evitare tap accidentali sulla riga sbagliata
- Nessun scroll se possibile (4-6 piatti devono stare tutti nello schermo)
- Se la connessione cade: disabilitare i pulsanti e mostrare avviso chiaro

### Regole CSS specifiche (da rispettare anche con la skill)

Anche con la skill frontend-design, queste regole devono essere rispettate:

- **NO framework CSS** (no Bootstrap, no Tailwind in file separato) — CSS vanilla o Tailwind-like inline
- **Tutto in un singolo file HTML per pagina** — CSS inline nel `<style>`, JS inline nel `<script>`, nessun build step
- **Font:** usare Google Fonts con un font display bold/impattante per i numeri (es. "Inter", "DM Sans", o "Space Grotesk") e un font mono per IP e dati tecnici
- **Responsive:** deve funzionare su PC (dashboard), TV 32" (monitor), tablet 8-10" (passa-piatti)
- **Colori di stato universali:** verde `#4ecca3` = ok, rosso `#e94560` = errore, giallo `#ffd93d` = warning, grigio `#6c7a89` = non testato
- **Animazioni:** solo per feedback (tap, aggiornamento stato). Nessuna animazione decorativa. `transition: 200ms ease` come standard
- **Contrasto:** WCAG AA minimo su tutte le pagine, AAA sul monitor cuochi


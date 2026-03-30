# SagrApp — Documento Tecnico per Claude Code
## Piattaforma di Test Hardware (Step 2)

> **PREREQUISITO:** Prima di iniziare, installare la skill frontend-design:
> ```bash
> npx skills add anthropics/claude-code --skill frontend-design
> ```
> Usare `/frontend-design` per costruire tutte le pagine HTML del progetto.

---

## 1. Contesto del Progetto

SagrApp è un sistema di gestione ordini per una sagra di paese (500-1000 coperti). Il software è una web app cloud-based accessibile da browser.

Questo documento descrive la **piattaforma di test hardware**: una web app diagnostica che permette di verificare che tutti i dispositivi hardware (stampanti, TV, tablet, lettore barcode) siano correttamente configurati e funzionanti PRIMA di costruire la piattaforma completa.

Il codice prodotto in questa fase **non è usa e getta**: il server, la connessione alle stampanti, il protocollo barcode, e il real-time verso i dispositivi verranno riutilizzati nella piattaforma finale.

### Hardware disponibile per il test

| Dispositivo | Modello | Connessioni | Ruolo nel test |
|---|---|---|---|
| **PC all-in-one** | — | Wi-Fi | Cassa principale + Print Proxy |
| **Mini-PC** | — | LAN + HDMI | Collegato a TV per monitor cuochi |
| **Stampante 1** | **Custom** (vecchia) | **Solo USB** | Ricevuta cassa — collegata via USB al PC all-in-one |
| **Stampante 2** | **vretti 80mm** | **USB + LAN + Seriale** | Comanda cibo (barcode) — LAN via Powerline, IP 192.168.1.202 |
| **Stampante 3** | **Fuhuihe POS** | **USB + LAN** | Comanda bevande — LAN via Powerline, IP 192.168.1.204 |
| **Tablet** | Android (generico) | Wi-Fi | Test passa-piatti |
| **Router 4G/5G** | — | Wi-Fi + LAN | Rete locale + internet |
| **Kit Powerline** | — | Via corrente | Collegamento stampanti LAN + mini-PC |

**NOTA IMPORTANTE:** La stampante Custom ha solo porta USB. Il Print Proxy deve gestire sia stampanti LAN (via TCP porta 9100) sia la stampante USB (via scrittura diretta al device USB). Questo è un caso misto che il sistema deve supportare.

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
| **Barcode generation** | JsBarcode (client-side per anteprima) + escpos (per stampa) | Code 128, 1D |
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
         📟 Barcode BT         (porta 9100)
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
| Stampante Custom (ricevuta cassa) | — | USB | **USB diretta al PC all-in-one** (no rete) |
| Stampante vretti (comanda cibo) | 192.168.1.202 | 9100 | LAN via Powerline, ESC/POS TCP |
| Stampante Fuhuihe (comanda bevande) | 192.168.1.204 | 9100 | LAN via Powerline, ESC/POS TCP |
| PC all-in-one (cassa) | DHCP (.100-.199) | — | Wi-Fi |
| Mini-PC (TV griglia) | DHCP (.100-.199) | — | Powerline + LAN |
| Tablet (passa-piatti) | DHCP (.100-.199) | — | Wi-Fi |

**Nota:** Per il test attuale abbiamo 3 stampanti (di cui 4 previste nel progetto finale). La 4ᵃ (ricevuta bar) non è presente nel test ma la struttura è predisposta per aggiungerla.

---

## 4. Specifiche della Piattaforma di Test

### 4.1 — Struttura del progetto

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
│   ├── index.html            # Dashboard test hardware (pagina principale)
│   ├── monitor.html          # Pagina test monitor cuochi (per la TV)
│   ├── passapiatti.html      # Pagina test passa-piatti (per il tablet)
│   ├── admin.html            # Dashboard admin LIVE (monitoraggio durante servizio)
│   ├── admin-recap.html      # Dashboard admin RECAP (report post servizio)
│   ├── admin-magazzino.html  # Gestione magazzino / scorte
│   ├── admin-login.html      # Pagina login admin (PIN numerico)
│   ├── css/
│   │   └── style.css         # Stili
│   └── js/
│       ├── dashboard.js      # Logica dashboard test
│       ├── monitor.js        # Logica pagina monitor TV
│       ├── passapiatti.js    # Logica pagina passa-piatti
│       ├── admin.js          # Logica dashboard admin live
│       ├── admin-recap.js    # Logica dashboard recap
│       ├── admin-magazzino.js # Logica gestione magazzino
│       └── socket-client.js  # Socket.IO client wrapper
│
├── package.json
└── README.md                 # Istruzioni di setup e deploy
```

### 4.2 — Componente: Server Principale (server/index.js)

**Responsabilità:**
- Express server sulla porta 3000
- Serve le pagine statiche dalla cartella `public/`
- Socket.IO server per comunicazione real-time
- API REST per operazioni CRUD

**Endpoint API:**

| Metodo | Path | Descrizione |
|---|---|---|
| GET | / | Dashboard test hardware |
| GET | /monitor | Pagina monitor cuochi (per TV) |
| GET | /passapiatti | Pagina passa-piatti (per tablet) |
| GET | /admin | Dashboard admin LIVE (richiede PIN) |
| GET | /admin/recap | Dashboard admin RECAP (richiede PIN) |
| GET | /admin/magazzino | Gestione magazzino (richiede PIN) |
| GET | /admin/login | Pagina login PIN |
| GET | /api/health | Health check del server |
| GET | /api/printers/status | Stato di tutte le stampanti (ping TCP) |
| POST | /api/printers/:id/test | Stampa pagina di test sulla stampante specificata |
| POST | /api/barcode/test | Genera e stampa un barcode di test |
| POST | /api/admin/login | Verifica PIN → restituisce token sessione |
| GET | /api/admin/stats/live | Dati live: ordini, incasso, stati (richiede auth) |
| GET | /api/admin/stats/recap | Dati recap serata: report completo (richiede auth) |
| GET | /api/inventory | Lista piatti con scorte attuali |
| PUT | /api/inventory/:id | Aggiorna scorta piatto (quantità, soglia, stato) |
| POST | /api/inventory/:id/adjust | Aggiustamento rapido scorta (+/- quantità) |
| POST | /api/inventory/reset | Reset scorte a valori iniziali (inizio serata) |

**Eventi Socket.IO:**

| Evento | Direzione | Payload | Descrizione |
|---|---|---|---|
| `connect` | Client → Server | — | Nuovo dispositivo connesso |
| `register` | Client → Server | `{ role: 'dashboard' \| 'monitor' \| 'passapiatti' \| 'proxy' \| 'admin' \| 'cassa' }` | Registra il tipo di dispositivo |
| `print` | Server → Proxy | `{ printer_id, printer_ip, printer_type, data, job_id }` | Comando stampa al proxy (type: 'lan' o 'usb') |
| `print_result` | Proxy → Server | `{ job_id, success, error? }` | Risultato stampa |
| `counter_update` | Client → Server | `{ item, delta }` | Passa-piatti aggiorna un contatore (+1/-1) |
| `counters_changed` | Server → All | `{ counters: {...} }` | Broadcast nuovi contatori a tutti (monitor TV si aggiorna) |
| `barcode_scanned` | Client → Server | `{ code }` | Lettore barcode ha scansionato un codice |
| `barcode_received` | Server → Dashboard | `{ code, timestamp }` | Notifica ricezione barcode sulla dashboard |
| `device_status` | Server → Dashboard | `{ devices: [...] }` | Aggiornamento dispositivi connessi |
| `inventory_updated` | Server → All | `{ item_id, stock, status }` | Scorta aggiornata, broadcast a casse e admin |
| `inventory_alert` | Server → Casse + Admin | `{ item_id, name, remaining, threshold }` | Piatto sotto soglia alert |
| `inventory_exhausted` | Server → Casse + Admin | `{ item_id, name }` | Piatto esaurito (scorta = 0) |
| `stats_update` | Server → Admin | `{ orders, revenue, statuses }` | Aggiornamento live statistiche |

### 4.3 — Componente: Print Proxy (print-proxy/index.js)

**Responsabilità:**
- Gira sul **PC all-in-one** (cassa principale)
- Si connette al server cloud via Socket.IO come client con ruolo `proxy`
- Riceve comandi di stampa dal server
- Li inoltra alle stampanti: **via TCP per stampanti LAN** oppure **via USB per la stampante Custom**
- Restituisce il risultato al server

**IMPORTANTE — Gestione mista USB + LAN:**
La stampante Custom è collegata via USB al PC all-in-one. Le stampanti vretti e Fuhuihe sono sulla rete LAN. Il print proxy deve distinguere il tipo di connessione e usare il metodo corretto.

**Funzionamento:**

```javascript
// Pseudo-codice del print proxy
const socket = io('https://sagrapp.server.com');
const net = require('net');

socket.emit('register', { role: 'proxy' });

socket.on('print', async ({ printer_id, printer_ip, printer_type, data, job_id }) => {
  try {
    if (printer_type === 'lan') {
      // Stampante LAN (vretti, Fuhuihe) — connessione TCP diretta
      const client = new net.Socket();
      client.connect(9100, printer_ip, () => {
        client.write(Buffer.from(data));
        client.end();
      });
      socket.emit('print_result', { job_id, success: true });
    } else if (printer_type === 'usb') {
      // Stampante USB (Custom) — scrittura al device USB
      // Su Windows: usa il nome della stampante condivisa o la porta raw
      // Su Linux: scrive su /dev/usb/lp0
      await printToUSB(data);
      socket.emit('print_result', { job_id, success: true });
    }
  } catch (err) {
    socket.emit('print_result', { job_id, success: false, error: err.message });
  }
});
```

**Stampa USB — Implementazione cross-platform:**

```javascript
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

async function printToUSB(data) {
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: scrive su un file temporaneo e lo invia alla stampante
    // La stampante Custom deve essere installata come stampante Windows
    // e condivisa con un nome (es. "CustomPOS")
    const tmpFile = 'C:\\temp\\print_job.bin';
    fs.writeFileSync(tmpFile, Buffer.from(data));
    // Invia raw data alla stampante Windows
    execSync(`copy /b "${tmpFile}" "\\\\localhost\\CustomPOS"`, { shell: true });
    // Alternativa: se la stampante è su una porta COM o USB raw
    // execSync(`copy /b "${tmpFile}" USB001:`, { shell: true });
  } else {
    // Linux/Mac: scrive direttamente al device
    fs.writeFileSync('/dev/usb/lp0', Buffer.from(data));
  }
}
```

**Setup stampante Custom su Windows (prerequisito):**
1. Collegare la stampante Custom via USB al PC all-in-one
2. Installare il driver (dal CD o scaricandolo)
3. Nelle impostazioni stampante di Windows, condividere la stampante con nome "CustomPOS"
4. Verificare che funzioni: `echo test > \\localhost\CustomPOS`

**Verifica connettività stampanti LAN:**

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

// Per la stampante USB: verificare che il device esista
function checkUSBPrinter() {
  try {
    if (os.platform() === 'win32') {
      // Verifica che la stampante condivisa esista
      execSync('net view \\\\localhost', { shell: true });
      return true;
    } else {
      return fs.existsSync('/dev/usb/lp0');
    }
  } catch { return false; }
}
```

### 4.4 — Componente: Dashboard Test Hardware (public/index.html)

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
║  │ #1 Custom (ricevuta cassa)  USB     ● Online     │   ║
║  │                              [Stampa Test]        │   ║
║  │ #2 vretti (comanda cibo)   .202     ● Online     │   ║
║  │                              [Stampa Test]        │   ║
║  │ #3 Fuhuihe (comanda bev.)  .204     ● Online     │   ║
║  │                              [Stampa Test]        │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📺 MONITOR CUOCHI (TV)                                 ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Stato: ● Connesso                                │   ║
║  │ [Apri pagina monitor]  [Invia dato test]         │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📱 TABLET PASSA-PIATTI                                 ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ Stato: ● Connesso                                │   ║
║  │ [Apri pagina passa-piatti]                        │   ║
║  │ Ultimo tap: Bistecca +1 (2 sec fa)               │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📟 LETTORE BARCODE                                     ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ [Stampa barcode test]                             │   ║
║  │ Ultimo barcode ricevuto: TEST-001 (5 sec fa)     │   ║
║  │ Stato: ● Funzionante                             │   ║
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
- La sezione barcode ascolta l'input: quando il lettore BT scansiona un codice, il browser lo intercetta (il lettore BT funziona come tastiera) e mostra il codice ricevuto
- Il pulsante "Test Completo" esegue tutti i test in sequenza e produce un report verde/rosso

### 4.5 — Componente: Pagina Monitor Cuochi (public/monitor.html)

Questa pagina viene aperta sulla TV della griglia (via mini-PC).

**Layout (font molto grandi, alto contrasto):**

```
╔══════════════════════════════╗
║   GRIGLIA — Test Monitor     ║
║                              ║
║   Bistecca       12          ║
║   Costine         8          ║
║   Salsiccia      15          ║
║   Spiedini        6          ║
║                              ║
║   ● Connesso al server      ║
╚══════════════════════════════╝
```

**Comportamento:**
- Si connette via Socket.IO con ruolo `monitor`
- Mostra una lista di piatti di test con contatori
- Si aggiorna in tempo reale quando il passa-piatti modifica un contatore
- Font molto grandi (leggibili da 2-3 metri), sfondo scuro, numeri in colore contrastante
- Schermo intero automatico

### 4.6 — Componente: Pagina Passa-Piatti (public/passapiatti.html)

Questa pagina viene aperta sul tablet allo scalda vivande.

**Layout (pulsanti grandi, touch-friendly):**

```
╔══════════════════════════════╗
║  SCALDA VIVANDE — Test       ║
║                              ║
║  Bistecca    [−]  12  [+]   ║
║  Costine     [−]   8  [+]   ║
║  Salsiccia   [−]  15  [+]   ║
║  Spiedini    [−]   6  [+]   ║
║                              ║
║  ● Connesso al server       ║
╚══════════════════════════════╝
```

**Comportamento:**
- Si connette via Socket.IO con ruolo `passapiatti`
- Mostra piatti di test con pulsanti + e − molto grandi (touch-friendly)
- Ogni tap invia `counter_update` al server
- Il server fa broadcast a tutti → il monitor TV si aggiorna
- Feedback visivo immediato al tap (colore del pulsante cambia per 200ms)

### 4.7 — Componente: Gestione Barcode

Il lettore barcode Bluetooth collegato al PC cassa funziona come una **tastiera esterna**. Quando scansiona un codice, il PC riceve i caratteri come se fossero digitati sulla tastiera, seguiti da un INVIO.

**Implementazione lato dashboard (browser):**

```javascript
// Il barcode scanner invia caratteri come una tastiera
// Accumula i caratteri e quando riceve ENTER, processa il codice
let barcodeBuffer = '';
let barcodeTimeout = null;

document.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    if (barcodeBuffer.length > 0) {
      processBarcodeScanned(barcodeBuffer);
      barcodeBuffer = '';
    }
  } else {
    barcodeBuffer += e.key;
    // Reset timeout: se non arriva ENTER entro 100ms, svuota il buffer
    clearTimeout(barcodeTimeout);
    barcodeTimeout = setTimeout(() => { barcodeBuffer = ''; }, 100);
  }
});

function processBarcodeScanned(code) {
  socket.emit('barcode_scanned', { code });
  // Aggiorna UI per mostrare il codice ricevuto
}
```

### 4.8 — Contenuto stampa di test

Quando l'utente preme "Stampa Test" su una stampante, il sistema stampa una pagina con:

```
================================
    ★ SAGRAPP — TEST STAMPA ★
================================

Stampante: Custom (Ricevuta Cassa)
Connessione: USB
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

Per la stampante vretti (comanda cibo), la stampa di test include anche un **barcode 1D di prova**:

```
================================
  COMANDA CIBO — TEST
================================
Stampante: vretti 80mm (LAN)
IP: 192.168.1.202
Ordine: TEST-001
Tavolo: 99

1x Bistecca test
1x Pasta test
1x Birra test

|||||||||||||||||||||||||||||||
    TEST-001
(barcode Code 128)
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

### 4.9 — Componente: Login Admin (public/admin-login.html)

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

### 4.10 — Componente: Dashboard Admin LIVE (public/admin.html)

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

### 4.11 — Componente: Dashboard Admin RECAP (public/admin-recap.html)

Report completo post-servizio. Dati statici (non real-time), calcolati alla chiusura della serata.

**Sezioni:**
1. **Riepilogo incassi** — Totale, per cassa, per metodo pagamento
2. **Classifica vendite** — Piatti ordinati dal più al meno venduto, con quantità e incasso
3. **Performance** — Tempo medio evasione, distribuzione ordini nel tempo (grafico orario)
4. **Magazzino** — Per ogni piatto: scorta iniziale → venduto → rimanente. Piatti esauriti con timestamp
5. **Anomalie** — Ordini incompleti, sprechi griglia (prodotto vs venduto)
6. **Pulsante esportazione** — CSV per importazione in Excel

**Layout:** usa /frontend-design — stile report, card per ogni sezione, numeri grandi per i KPI principali

### 4.12 — Componente: Gestione Magazzino (public/admin-magazzino.html)

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

---

## 5. Stampa ESC/POS — Riferimento Tecnico

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

## 6. Setup e Deploy

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

### 6.2 — Print Proxy (PC all-in-one alla sagra)

```bash
# Sul PC all-in-one (cassa principale) — Windows
# Richiede Node.js installato (scaricare da https://nodejs.org)

# Scaricare la cartella print-proxy/
cd print-proxy
npm install

# Configurare il server URL in config.js
# SERVER_URL = 'https://sagrapp.server.com'

# SETUP STAMPANTE USB (Custom) — FARE UNA SOLA VOLTA:
# 1. Collegare la stampante Custom via USB
# 2. Installare il driver (dal CD o scaricandolo dal sito Custom)
# 3. In Impostazioni Windows > Stampanti: condividere la stampante con nome "CustomPOS"
# 4. Verificare: aprire Prompt comandi e digitare:
#    echo test > \\localhost\CustomPOS
#    (deve stampare "test" sulla Custom)

# Avviare il print proxy
node index.js

# Per avvio automatico su Windows, creare un file start-proxy.bat:
# @echo off
# cd C:\sagrapp\print-proxy
# node index.js
# (e metterlo nella cartella Startup di Windows)
```
```

### 6.3 — Dispositivi

Ogni dispositivo apre semplicemente il browser e naviga a:

| Dispositivo | URL |
|---|---|
| PC Cassa (dashboard) | `https://sagrapp.server.com/` |
| TV Monitor cuochi | `https://sagrapp.server.com/monitor` |
| Tablet passa-piatti | `https://sagrapp.server.com/passapiatti` |

---

## 7. Configurazione (config.js)

```javascript
module.exports = {
  PORT: 3000,

  // PIN accesso admin (4-6 cifre)
  ADMIN_PIN: '1234',

  // Stampanti reali — configurazione per il test
  // type: 'lan' = stampante di rete (TCP porta 9100)
  // type: 'usb' = stampante USB collegata al PC dove gira il print proxy
  PRINTERS: [
    { id: 1, name: 'Custom (Ricevuta cassa)', type: 'usb', model: 'Custom',
      usb_name: 'CustomPOS',       // Nome condivisione Windows
      usb_device: '/dev/usb/lp0'   // Device Linux/Mac
    },
    { id: 2, name: 'vretti (Comanda cibo)', type: 'lan', model: 'vretti 80mm',
      ip: '192.168.1.202', port: 9100
    },
    { id: 3, name: 'Fuhuihe (Comanda bevande)', type: 'lan', model: 'Fuhuihe POS',
      ip: '192.168.1.204', port: 9100
    },
    // Predisposta per il futuro — 4a stampante (ricevuta bar)
    // { id: 4, name: 'Ricevuta bar', type: 'lan', ip: '192.168.1.203', port: 9100 },
  ],

  // Piatti di test per il monitor, passa-piatti, e magazzino
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
```

---

## 8. Requisiti Non Funzionali

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

## 9. Checklist di Accettazione

Il test è superato quando:

- [ ] Il server si avvia e risponde su porta 3000
- [ ] La dashboard mostra lo stato connessione al server
- [ ] Il print proxy si connette al server e appare come "online" sulla dashboard
- [ ] Ogni stampante viene testata e mostra online/offline (TCP ping per LAN, device check per USB)
- [ ] Il pulsante "Stampa Test" stampa effettivamente sulla stampante corretta
- [ ] La stampante Custom (USB) stampa la pagina di test con caratteri speciali (àèìòù €)
- [ ] La stampante vretti (LAN .202) stampa la comanda cibo con barcode Code 128 leggibile
- [ ] La stampante Fuhuihe (LAN .204) stampa la comanda bevande
- [ ] La pagina monitor (TV) si apre e mostra i contatori
- [ ] La pagina passa-piatti si apre e mostra i pulsanti +/−
- [ ] Un tap sul passa-piatti aggiorna il monitor TV in tempo reale (< 1 secondo)
- [ ] Il lettore barcode BT scansiona un codice e la dashboard lo mostra
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

---

## 10. Note per Claude Code

### Priorità di sviluppo
1. Server Express + Socket.IO (scheletro) + SQLite con schema inventario
2. Print proxy con TCP verso stampanti
3. Dashboard test hardware con stato stampanti e pulsanti test — **usa /frontend-design**
4. Pagine monitor e passa-piatti con real-time — **usa /frontend-design**
5. Gestione barcode input
6. Login admin con PIN
7. Gestione magazzino / scorte con pulsanti rapidi — **usa /frontend-design**
8. Dashboard admin LIVE con statistiche real-time — **usa /frontend-design**
9. Dashboard admin RECAP con report e esportazione CSV — **usa /frontend-design**
10. Alert scorte alle casse (WebSocket push)
11. Test completo automatizzato
12. Polish finale e verifica contrasto/leggibilità

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


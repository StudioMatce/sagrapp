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
| **Tablet 1** | Android | Wi-Fi | Scaldavivande: registra pezzi (−10/−5/+5/+10) |
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
| **Database** | PostgreSQL su Neon (cloud) via `pg` (node-postgres) | Persistenza cloud, connection string in `DATABASE_URL` |
| **Frontend** | HTML/CSS/JS vanilla + Socket.IO client | Nessun framework frontend necessario, deve girare su qualsiasi browser |
| **Stampa** | escpos + node-thermal-printer via rete TCP | Stampa diretta ESC/POS su stampanti LAN |
| **Deploy** | Railway (con variabile `DATABASE_URL`) | Deploy automatico da GitHub, auto-restart |

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

Il monitor TV mostra SOLO i prodotti della griglia/scaldavivande + polenta + patate, con **2 colonne**:

| Riga sul monitor | Unità | Da cucinare | Nello scaldavivande |
|---|---|---|---|
| **Costicine** | pezzi singoli | = vendute − pronto | = pronto − evasi |
| **Salsicce** | pezzi singoli | = vendute − pronto | = pronto − evasi |
| **Sovracoscia** | pezzi interi | = vendute − pronto | = pronto − evasi |
| **Pastin** | pezzi singoli | = vendute − pronto | = pronto − evasi |
| **Polenta** | porzioni | = vendute − pronto | = pronto − evasi |
| **Patate fritte** | porzioni | = vendute − pronto | = pronto − evasi |

**2 colonne visibili sulla TV:**
- **Da cucinare** = vendute (ordini cassa) − pronto (depositati cuoco) → quello che il cuoco deve ancora cuocere
- **Nello scaldavivande** = pronto (depositati cuoco) − evasi (scalati alla chiusura ordini) → pezzi fisicamente presenti ORA

**Dati NON visibili sulla TV (solo nei report admin RECAP):**
- "Vendute" = totale ordinato alle casse nella serata
- "Pronto totale" = totale depositato dal cuoco nella serata
- "Evasi totale" = totale scalato dalla chiusura ordini

**Aggiornamento dei numeri:**
- "Da cucinare" SALE quando arriva un ordine dalla cassa, SCENDE quando il cuoco deposita pezzi
- "Nello scaldavivande" SALE quando il cuoco deposita pezzi, SCENDE quando l'operatore chiude un ordine

### 4.5 — Regole di Evasione Ordini

Quando l'operatore fisso chiude un ordine dal suo tablet, il sistema applica queste regole:

**Controllo pezzi griglia (BLOCCO se insufficienti):**
Prima di chiudere, il sistema controlla se nello scaldavivande ci sono abbastanza pezzi PER I SOLI ARTICOLI GRIGLIA (costicine, salsicce, sovracoscia, pastin, polenta, patate). I piatti non tracciati nello scaldavivande (pasta, gnocchi, wurstel, formaggio cotto, contorni, bevande) vengono ignorati nel controllo.

```
Operatore chiude ordine #247 (1x Costicine polenta + 1x Pasta ragù):
  → Costicine: servono 3, nello scaldavivande 5 → ✅
  → Polenta: serve 1, nello scaldavivande 8 → ✅
  → Pasta ragù: non tracciata → ✅ ignora
  → RISULTATO: ordine chiuso, scaldavivande: costicine -3, polenta -1

Operatore chiude ordine #248 (2x Costicine polenta):
  → Costicine: servono 6, nello scaldavivande 2 → ❌ BLOCCO
  → RISULTATO: "Non abbastanza costicine (servono 6, disponibili 2)"
  → L'ordine resta aperto, l'operatore deve attendere
```

**Regole complete:**

| Situazione | Comportamento |
|---|---|
| Pezzi griglia sufficienti | ✅ Chiude ordine, scala pezzi dallo scaldavivande |
| Pezzi griglia insufficienti | ❌ Blocca chiusura, mostra messaggio con dettaglio mancanti |
| Ordine già evaso | ⚠ Feedback giallo: "Ordine #XXX già evaso" |
| Ordine inesistente | ❌ Feedback rosso: "Ordine non trovato" |
| Chiusura parziale | ❌ Non permessa. L'ordine si chiude tutto o niente |
| Ordine solo bevande/pasta (nessun pezzo griglia) | ✅ Chiude senza controllare lo scaldavivande |

**Annullamento ordini:**
L'operatore fisso può annullare un ordine dal suo tablet (pulsante "Annulla" con conferma). Quando un ordine viene annullato:
- Scorte magazzino **ripristinate** (come se l'ordine non fosse mai stato fatto)
- "Vendute" sul monitor cuochi **scala** (da cucinare scende)
- Se l'ordine era già evaso: pezzi scaldavivande **ripristinati**
- L'ordine viene marcato come "ANNULLATO" (visibile nei report)

### 4.6 — Logica di Stampa per Tipo di Ordine

Quando viene creato un ordine, il sistema stampa automaticamente su stampanti diverse in base al contenuto:

| Contenuto ordine | Stampante ricevuta | Stampante comanda cibo | Stampante bevande | Stampante speciali |
|---|---|---|---|---|
| Solo cibo | vretti .203 | Fuhuihe .205 | — | — |
| Solo bevande | vretti .203 | — | Fuhuihe .204 | — |
| Cibo + bevande | vretti .203 | Fuhuihe .205 | Fuhuihe .204 | — |
| Cibo + piatto speciale | vretti .203 | Fuhuihe .205 (con speciale) | — | Fuhuihe .207 (solo speciale) |
| Tutto | vretti .203 | Fuhuihe .205 | Fuhuihe .204 | Fuhuihe .207 (solo speciale) |

**I piatti speciali vengono stampati DUE VOLTE:** una sulla comanda cibo generale (.205) insieme agli altri piatti, e una SOLO il piatto speciale sulla stampante dedicata (.207). Questo perché vengono preparati in una zona separata.

### 4.7 — Configurabilità Menu da Admin

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
│   ├── setup.html            # Wizard setup inizio turno (legacy — pre-flight check ora in admin-hardware)
│   ├── cassa.html            # Interfaccia cassa generale (layout come foglio cartaceo)
│   ├── cassa-bar.html        # Interfaccia cassa bar (solo bevande)
│   ├── cassa-casetta.html    # Interfaccia cassa casetta aperitivi
│   ├── monitor.html          # Monitor cuochi — 2 colonne (da cucinare / nello scaldavivande)
│   ├── scaldavivande.html    # Tablet scaldavivande — pulsanti −10/−5/+5/+10
│   ├── controllo.html        # Tablet operatore fisso — lista ordini + tastierino evasione
│   ├── admin.html            # Dashboard admin LIVE (monitoraggio durante servizio)
│   ├── admin-recap.html      # Dashboard admin RECAP (report post servizio)
│   ├── admin-magazzino.html  # Magazzino materiali e consumabili (bicchieri, posate, ecc.)
│   ├── admin-menu.html       # Gestione menu + scorte inline (piatti, prezzi, casse, stock)
│   ├── admin-hardware.html   # Pannello controllo hardware + pre-flight check integrato
│   ├── admin-chiusura.html   # Procedura chiusura turno guidata (con selettore pranzo/cena)
│   ├── admin-serate.html     # Storico serate: tabella, badge turno, recap weekend/totale
│   ├── css/
│   │   └── style.css         # Stili
│   └── js/
│       ├── cassa.js          # Logica interfaccia cassa (ordini, stampa, flag)
│       ├── monitor.js        # Logica monitor cuochi (2 colonne)
│       ├── scaldavivande.js  # Logica scaldavivande (pulsanti decine)
│       ├── controllo.js      # Logica operatore fisso (lista ordini + evasione + annullamento)
│       ├── admin.js          # Logica dashboard admin live
│       ├── admin-recap.js    # Logica dashboard recap
│       ├── admin-magazzino.js # Logica gestione magazzino
│       ├── admin-menu.js     # Logica gestione menu (piatti, prezzi, casse)
│       ├── admin-hardware.js  # Logica controllo hardware
│       ├── admin-chiusura.js  # Logica chiusura turno
│       ├── alerts.js          # Sistema alert sonori/visivi + emergenza stampante
│       ├── sidebar.js         # Sidebar navigazione globale (usata da tutte le pagine)
│       └── socket-client.js  # Socket.IO client wrapper
│
├── package.json
└── README.md                 # Istruzioni di setup e deploy
```

### 5.2 — Sidebar Navigazione Globale (public/js/sidebar.js)

La sidebar è visibile **solo per l'utente Admin**. Gli altri ruoli vanno direttamente alla loro pagina senza navigazione laterale.

**Layout sidebar ADMIN — usa /frontend-design:**

```
╔═══════════╦══════════════════════════════════════════╗
║ SAGRAPP   ║                                          ║
║           ║  (contenuto della pagina attiva)         ║
║ OPERATIVITÁ                                          ║
║ 🛒 Cassa Gen.                                       ║
║ 🍺 Cassa Bar ║                                       ║
║ 🏠 Casetta   ║                                       ║
║           ║                                          ║
║ CUCINA    ║                                          ║
║ 📺 Monitor║                                          ║
║ 🔥 Scaldav.                                         ║
║           ║                                          ║
║ SERVIZIO  ║                                          ║
║ 📋 Operatore                                        ║
║           ║                                          ║
║ ADMIN     ║                                          ║
║ 📊 Live   ║                                          ║
║ 📈 Recap  ║                                          ║
║ 📦 Magazzino                                        ║
║ 📋 Menu   ║                                          ║
║ 🔧 Hardware║                                         ║
║ ⚙️ Setup  ║                                          ║
║ 🔒 Chiusura                                         ║
║           ║                                          ║
╚═══════════╩══════════════════════════════════════════╝
```

**Struttura gruppi (solo admin):**

| Gruppo | Voci | URL |
|---|---|---|
| **OPERATIVITÀ** | Cassa Generale | /cassa |
| | Cassa Bar | /cassa-bar |
| | Cassa Casetta | /cassa-casetta |
| **CUCINA** | Monitor Cuochi | /monitor |
| | Scaldavivande | /scaldavivande |
| **SERVIZIO** | Operatore Fisso | /controllo |
| **ADMIN** | Dashboard Live | /admin |
| | Dashboard Recap | /admin/recap |
| | Magazzino Materiali | /admin/magazzino |
| | Menu e Scorte | /admin/menu |
| | Controllo Hardware | /admin/hardware |
| | Chiusura Turno | /admin/chiusura |

**Comportamento sidebar (solo admin):**
- La voce della pagina attiva è **evidenziata**
- La sidebar è **comprimibile** (hamburger ☰)
- L'admin può navigare a TUTTE le pagine del sistema (casse, monitor, scaldavivande, controllo, admin)
- Tema scuro coerente con il resto della piattaforma
- **PJAX**: la sidebar usa soft navigation per pagine admin (carica HTML senza refresh completo). Gli script vengono wrappati in IIFE — tutte le funzioni usate in attributi `onclick` HTML **devono** essere esportate su `window` (es. `window.myFunc = myFunc;`)

**Sistema di Accesso — Login con PIN:**

Tutti i dispositivi aprono lo stesso URL → pagina login con tastierino PIN numerico.

```
╔════════════════════════════════════════╗
║           🎪 SagrApp                   ║
║                                        ║
║     Inserisci il PIN di accesso       ║
║                                        ║
║     ┌────────────────────┐            ║
║     │       ● ● ● ●     │            ║
║     └────────────────────┘            ║
║                                        ║
║     [1] [2] [3]                       ║
║     [4] [5] [6]                       ║
║     [7] [8] [9]                       ║
║     [C] [0] [ENTRA]                  ║
║                                        ║
╚════════════════════════════════════════╝
```

**Utenze e PIN:**

| PIN | Ruolo | Destinazione | Sidebar |
|---|---|---|---|
| 0000 | **Admin** | Dashboard Live + sidebar completa | ✅ Sì |
| 0001 | **Cassa Generale** | Pagina cassa direttamente | ❌ No |
| 0002 | **Operatore** | Scelta ruolo: Cassa Bar / Casetta / Scaldavivande / Zona Controllo | ❌ No |
| (nessuno) | **TV Monitor Cuochi** | URL diretto `/monitor` senza login | ❌ No |

**Flusso PIN 0002 — Scelta ruolo:**
Dopo aver inserito il PIN 0002, appare una schermata semplice con 4 pulsanti grandi:
```
╔════════════════════════════════════════╗
║     Seleziona il tuo ruolo            ║
║                                        ║
║  [🍺 Cassa Bar]    [🏠 Casetta]      ║
║                                        ║
║  [🔥 Scaldavivande] [📋 Zona Ctrl]   ║
║                                        ║
╚════════════════════════════════════════╝
```
Dopo la scelta → va diretto alla pagina, niente sidebar.

**Persistenza ruolo:**
- Il ruolo scelto viene salvato in `localStorage`
- Al prossimo avvio, il dispositivo va diretto alla pagina giusta senza rifare login
- Ogni pagina non-admin ha un piccolo pulsante **"Esci"** (angolo in alto) per tornare al login

**Monitor cuochi (TV):**
- Si apre con URL diretto `/monitor` senza nessun login
- Nessun pulsante "Esci" — è un display fisso

**Implementazione:**
- File `sidebar.js` caricato SOLO dalle pagine admin
- Le pagine non-admin includono solo un pulsante "Esci" per tornare al login
- I PIN sono configurabili in `config.js`
- Il server valida il PIN e restituisce il ruolo associato

### 5.3 — Componente: Server Principale (server/index.js)

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
| GET | /monitor | Monitor cuochi (2 colonne, per TV) |
| GET | /scaldavivande | Tablet scaldavivande |
| GET | /controllo | Tablet operatore fisso (lista ordini + evasione) |
| GET | /admin | Dashboard admin LIVE (richiede PIN) |
| GET | /admin/recap | Dashboard admin RECAP (richiede PIN) |
| GET | /admin/magazzino | Gestione magazzino (richiede PIN) |
| GET | /admin/menu | Gestione menu — piatti, prezzi, casse (richiede PIN) |
| GET | /admin/hardware | Pannello controllo hardware (richiede PIN) |
| GET | / | Login unificato (PIN → redirect al ruolo) |
| GET | /setup | Wizard setup inizio turno |
| GET | /api/health | Health check del server |
| GET | /api/menu | Menu completo (piatti, prezzi, disponibilità) |
| POST | /api/orders | **Crea un nuovo ordine** (piatti, tavolo, coperti, nome, sconto, flag gratis, asporto) |
| GET | /api/orders/all | Lista tutti gli ordini della serata (per tab ORDINI cassa) |
| GET | /api/orders/:id | Dettaglio ordine |
| POST | /api/orders/:id/fulfill | Evadi ordine (controlla pezzi griglia, scala scaldavivande) |
| POST | /api/orders/:id/cancel | Annulla ordine (ripristina scorte magazzino e vendute) |
| GET | /api/printers/status | Stato di tutte le stampanti (ping TCP) |
| POST | /api/printers/:id/test | Stampa pagina di test |
| POST | /api/login | Verifica PIN → restituisce ruolo, token e destinazioni |
| GET | /api/admin/stats/live | Dati live: ordini, incasso, stati (richiede auth) |
| GET | /api/admin/stats/recap | Dati recap serata corrente con omaggi e sconti (richiede auth) |
| GET | /api/admin/sessions | Lista serate archiviate (id, data, turno, ordini, incasso) (richiede auth) |
| GET | /api/admin/sessions/:id/recap | Recap completo di una serata archiviata (richiede auth) |
| GET | /api/admin/recap/aggregate | Recap aggregato: `?mode=total` (totale sagra) o `?ids=id1,id2` (sessioni specifiche) |
| GET | /api/inventory | Lista piatti con scorte attuali |
| PUT | /api/inventory/:id | Aggiorna scorta piatto (quantità, soglia, stato) |
| POST | /api/inventory/:id/adjust | Aggiustamento rapido scorta (+/- quantità) |
| POST | /api/inventory/reset | Reset scorte a valori iniziali (inizio serata) |
| PUT | /api/menu/:id | Modifica piatto (prezzo, nome, disponibilità, composizione, casse, scorta iniziale, soglia) |
| POST | /api/menu | Aggiunge un nuovo piatto al menu |
| DELETE | /api/menu/:id | Rimuove un piatto dal menu |
| PUT | /api/menu/:id/toggle | Attiva/disattiva un piatto |
| PUT | /api/menu/:id/casse | Aggiorna disponibilità casse per un piatto |
| GET | /api/warehouse | Lista articoli magazzino materiali (richiede auth) |
| POST | /api/warehouse | Aggiunge articolo al magazzino materiali (richiede auth) |
| PUT | /api/warehouse/:id | Aggiorna articolo magazzino (nome, quantità, totale, soglia) |
| POST | /api/warehouse/:id/adjust | Aggiustamento rapido quantità magazzino (+/- delta) |
| DELETE | /api/warehouse/:id | Elimina articolo dal magazzino materiali |

**Eventi Socket.IO:**

| Evento | Direzione | Payload | Descrizione |
|---|---|---|---|
| `connect` | Client → Server | — | Nuovo dispositivo connesso |
| `register` | Client → Server | `{ role: 'dashboard' \| 'monitor' \| 'scaldavivande' \| 'controllo' \| 'proxy' \| 'admin' \| 'cassa' }` | Registra il tipo di dispositivo |
| `print` | Server → Proxy | `{ printer_ip, data, job_id }` | Comando stampa al proxy (tutte LAN) |
| `print_result` | Proxy → Server | `{ job_id, success, error? }` | Risultato stampa |
| `order_created` | Server → All | `{ order_id, table, items, total, flag_gratis? }` | Nuovo ordine creato — aggiorna monitor "da cucinare" |
| `counter_update` | Scaldavivande → Server | `{ item, delta }` | Scaldavivande aggiorna un contatore (−10, −5, +5, +10) |
| `counters_changed` | Server → Monitor | `{ counters: { item: { da_cucinare, nello_scaldavivande } } }` | Broadcast contatori aggiornati (2 colonne) |
| `order_fulfilled` | Controllo → Server | `{ order_number }` | Operatore fisso evade ordine → scala pezzi scaldavivande |
| `order_fulfilled_result` | Server → Controllo | `{ success, order_number, table?, reason?, details? }` | Risultato evasione (successo o blocco con dettaglio pezzi mancanti) |
| `order_cancelled` | Controllo → Server | `{ order_number }` | Operatore fisso annulla ordine |
| `order_cancelled_result` | Server → Controllo | `{ success, order_number }` | Conferma annullamento (scorte ripristinate) |
| `open_orders_update` | Server → Controllo | `{ orders: [...] }` | Lista ordini aperti aggiornata |
| `device_status` | Server → Dashboard | `{ devices: [...] }` | Aggiornamento dispositivi connessi |
| `inventory_updated` | Server → All | `{ item_id, stock, status }` | Scorta aggiornata, broadcast a casse e admin |
| `inventory_alert` | Server → Casse + Admin | `{ item_id, name, remaining, threshold }` | Piatto sotto soglia alert |
| `inventory_exhausted` | Server → Casse + Admin | `{ item_id, name }` | Piatto esaurito (scorta = 0) |
| `menu_updated` | Server → Casse | `{ action, item }` | Piatto aggiunto/modificato/rimosso/attivato/disattivato — casse si aggiornano in tempo reale |
| `warehouse_updated` | Server → Admin | `{ action, item }` | Articolo magazzino materiali aggiunto/modificato/eliminato |
| `stats_update` | Server → Admin | `{ orders, revenue, statuses }` | Aggiornamento live statistiche |

### 5.4 — Componente: Print Proxy (print-proxy/index.js)

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

### 5.5 — Componente: Monitor Cuochi (public/monitor.html)

Questa pagina viene aperta sulla TV della griglia (via mini-PC). Mostra **2 colonne** per ogni piatto.

**Layout (font molto grandi, alto contrasto) — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║   GRIGLIA              Da cucinare    Nello scaldavivande║
║                                                          ║
║   Costicine                 5              12            ║
║   Salsicce                  3               8            ║
║   Sovracoscia               2               4            ║
║   Pastin                    0               6            ║
║   Polenta                   8              15            ║
║   Patate                    3              10            ║
║                                                          ║
║   ● Connesso                                            ║
╚══════════════════════════════════════════════════════════╝
```

**Significato colonne:**
- **Da cucinare** = vendute (ordini cassa) − pronto (depositati cuoco) → quello che i cuochi devono ancora cuocere
- **Nello scaldavivande** = pronto (depositati cuoco) − evasi (scalati alla chiusura ordini) → pezzi fisicamente presenti ORA

**Comportamento:**
- Si connette via Socket.IO con ruolo `monitor`
- "Da cucinare" SALE quando arriva un ordine dalla cassa, SCENDE quando il cuoco deposita pezzi
- "Nello scaldavivande" SALE quando il cuoco deposita pezzi, SCENDE quando l'operatore chiude un ordine
- **Colore "da cucinare":** verde se 0, giallo se 1-10, rosso se > 10 (i cuochi devono sbrigarsi)
- **Colore "nello scaldavivande":** verde se > 10, giallo se 1-10, rosso se 0 (scorta bassa)
- Font molto grandi (leggibili da 2-3 metri), sfondo scuro, numeri contrastanti
- Flash visivo quando un numero cambia (200ms)
- Schermo intero automatico
- Se la connessione cade: overlay rosso "CONNESSIONE PERSA"

### 5.6 — Componente: Tablet Scaldavivande (public/scaldavivande.html)

Questa pagina viene aperta sul tablet allo scalda vivande della griglia. L'addetto registra i pezzi cucinati.

**Layout (pulsanti grandi, touch-friendly) — usa /frontend-design:**

```
╔════════════════════════════════════════════════════════════╗
║  SCALDAVIVANDE                          ● Connesso        ║
║                                                            ║
║  Costicine     [−10] [−5]   30   [+5] [+10]              ║
║  Salsicce      [−10] [−5]   22   [+5] [+10]              ║
║  Sovracoscia   [−10] [−5]   47   [+5] [+10]              ║
║  Pastin        [−10] [−5]   18   [+5] [+10]              ║
║  Polenta       [−10] [−5]   35   [+5] [+10]              ║
║  Patate        [−10] [−5]   12   [+5] [+10]              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Si connette via Socket.IO con ruolo `scaldavivande`
- Per ogni piatto: 4 pulsanti simmetrici **−10, −5, +5, +10**
- Il contatore al centro mostra il totale "pronto - evasi" (pezzi fisicamente presenti)
- Ogni tap invia `counter_update` al server con il delta
- Il server fa broadcast → la colonna "pronto" del monitor cuochi si aggiorna in tempo reale
- Feedback visivo immediato al tap (pulsante lampeggia per 200ms)
- Pulsanti enormi touch-friendly (minimo 80x80px)
- Spazio tra le righe generoso per evitare tap accidentali
- Se la connessione cade: disabilitare i pulsanti e mostrare avviso

**Eventi Socket.IO:**

| Evento | Direzione | Payload |
|---|---|---|
| `counter_update` | Scaldavivande → Server | `{ item: 'costicine', delta: 10 }` |
| `counters_changed` | Server → Monitor | `{ counters: { costicine: { da_cucinare: 5, nello_scaldavivande: 12 } } }` |

### 5.7 — Componente: Tablet Operatore Fisso (public/controllo.html)

Tablet fisso dell'operatore alla linea cibo. È il perno del flusso: riceve le comande, le dà ai camerieri, controlla che tutto ci sia, e chiude gli ordini. Ha due sezioni: **lista ordini aperti** in alto e **tastierino evasione** in basso.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  OPERATORE LINEA CIBO                      ● Connesso   ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  ORDINI APERTI (scrollabile)                             ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ #389  Tav.12  3x Costicine, 1x Pasta     [Annul]│   ║
║  │ #391  Tav.5   1x Grigliata, 2x Birra     [Annul]│   ║
║  │ #394  Tav.22  2x Salsiccia, 1x Patate    [Annul]│   ║
║  │ #395  Tav.8   1x Sovracoscia, 1x Funghi  [Annul]│   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  ─────────────────────────────────────────────────────  ║
║                                                          ║
║  EVADI ORDINE:                                          ║
║  ┌────────────────────────┐                             ║
║  │        389             │                             ║
║  └────────────────────────┘                             ║
║                                                          ║
║  [1] [2] [3]                                            ║
║  [4] [5] [6]                                            ║
║  [7] [8] [9]                                            ║
║  [C] [0] [EVADI ✓]                                     ║
║                                                          ║
║  Ultimo evaso: #388 — Tav.3 ✓                          ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento — Lista ordini aperti (parte alta):**
- Mostra tutti gli ordini con stato "aperto" (non ancora evasi)
- Per ogni ordine: numero, tavolo, riepilogo piatti
- Ordinati dal più vecchio al più recente (il primo in lista è quello da mandare fuori prima)
- Si aggiorna in tempo reale (nuovi ordini appaiono, evasi spariscono)
- Pulsante **"Annulla"** su ogni ordine → chiede conferma → annulla l'ordine:
  - Scorte magazzino ripristinate
  - "Vendute" sul monitor cuochi scalate
  - Ordine marcato come ANNULLATO

**Comportamento — Tastierino evasione (parte bassa):**
- Tastierino numerico grande (touch-friendly, pulsanti 80x80px)
- L'addetto digita il numero ordine e preme "EVADI ✓"
- **Prima di evadere, il sistema controlla i pezzi griglia nello scaldavivande:**
  - Se sufficienti → schermata verde "Ordine #XXX evaso — Tav.Y" per 3 secondi → scala pezzi dallo scaldavivande
  - Se insufficienti → schermata rossa "Non abbastanza [pezzo] (servono X, disponibili Y)" → ordine resta aperto
  - Se ordine solo pasta/bevande (nessun pezzo griglia) → evade direttamente senza controllare scaldavivande
- Se ordine non trovato: schermata rossa "Ordine non trovato" per 3 secondi
- Se ordine già evaso: schermata gialla "Ordine #XXX già evaso" per 3 secondi
- Il campo si svuota automaticamente dopo ogni operazione
- Mostra l'ultimo ordine evaso in basso come riferimento
- Pulsante [C] cancella l'input corrente

**Eventi Socket.IO:**

| Evento | Direzione | Payload |
|---|---|---|
| `order_fulfilled` | Controllo → Server | `{ order_number: 389 }` |
| `order_fulfilled_result` | Server → Controllo | `{ success: true, order_number: 389, table: 12 }` o `{ success: false, reason: 'insufficient_stock', details: { costicine: { needed: 6, available: 2 } } }` |
| `order_cancelled` | Controllo → Server | `{ order_number: 391 }` |
| `order_cancelled_result` | Server → Controllo | `{ success: true, order_number: 391 }` |
| `open_orders_update` | Server → Controllo | `{ orders: [...] }` |

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

Pagina principale per il cassiere. La disposizione dei piatti dentro ogni tab **replica l'ordine del foglio cartaceo** (file `2025_sagra_COMANDA.pdf`). Include la sidebar navigazione (sezione 5.2).

**Layout: 70% area piatti (sinistra) + 30% colonna ordine (destra) — usa /frontend-design:**

```
╔═══╦══════════════════════════════════════╦══════════════════╗
║   ║ [🍽️ CIBO ✓]  [🍺 BEVANDE (2)]      ║  ORDINE #248     ║
║ S ║                                      ║                  ║
║ I ║  PRIMI                               ║  Nome: [______]  ║
║ D ║  [Gnocchi ragù    €5,50  −0+]      ║  Tavolo: [__]    ║
║ E ║  [Gnocchi burro   €5,50  −0+]      ║  Coperti: [__]   ║
║ B ║  [Pasta ragù      €4,50  −0+]      ║                  ║
║ A ║  [Pasta bianco    €4,50  −0+]      ║  ☐ Sponsor       ║
║ R ║                                      ║  ☐ Don Pierino   ║
║   ║  SECONDI                             ║  ☐ Amici         ║
║   ║  [Form. cotto*    €6,00  −0+]      ║                  ║
║   ║  [Wurstel patate  €5,00  −0+]      ║  Sconto: [__] €  ║
║   ║  [Pastin patate   €7,50  −0+]      ║                  ║
║   ║  [Salsiccia*      €6,80  −0+]      ║  ── Riepilogo ── ║
║   ║  [Costicine*      €7,30  −0+]      ║  2x Costicine  X ║
║   ║  [Sovracoscia*    €7,30  −0+]      ║     €14,60       ║
║   ║  [Grigliata m.*  €11,00  −0+]      ║  1x Pasta ragù X ║
║   ║                                      ║     €4,50        ║
║   ║  SPECIALE DEL GIORNO                ║  2x Birra      X ║
║   ║  [Pesce fritto   €13,00  −0+]      ║     €7,00        ║
║   ║                                      ║                  ║
║   ║  CONTORNI                            ║  ────────────    ║
║   ║  [Patate fritte  €2,90  −0+]       ║  Totale: €26,10  ║
║   ║  [Fagioli        €2,50  −0+]       ║  Sconto:  −€0,00 ║
║   ║  [Fagioli cip.   €2,50  −0+]       ║                  ║
║   ║  [Cappuccio       €2,00  −0+]       ║  DA PAGARE:      ║
║   ║  [Funghi          €3,20  −0+]       ║  € 26,10         ║
║   ║                                      ║                  ║
║   ║  CONDIMENTI                          ║  [   ORDINA   ]  ║
║   ║  [Maionese  €0,30  −0+]            ║                  ║
║   ║  [Ketchup   €0,30  −0+]            ║                  ║
╚═══╩══════════════════════════════════════╩══════════════════╝
```

**Area sinistra (70%) — Tab piatti:**

- **Tab CIBO** (attivo di default): contiene primi, secondi, speciale del giorno, contorni, condimenti. Con **separatori visivi colorati** tra le categorie e titolo di sezione. L'ordine dei piatti segue il foglio cartaceo.
- **Tab BEVANDE**: contiene tutte le bevande. Il tab mostra un **badge contatore** con il numero di bevande selezionate (es. "BEVANDE (3)") così il cassiere sa se ha già aggiunto bevande senza dover cambiare tab.
- Il tab attivo occupa tutta l'area sinistra con pulsanti grandi e leggibili.
- Ogni piatto ha un contatore con [−] [numero] [+].
- I piatti con quantità > 0 sono **evidenziati visivamente**.
- I piatti esauriti (scorta magazzino = 0) sono disabilitati con badge rosso "ESAURITO".
- I piatti sotto soglia magazzino hanno badge arancione con porzioni rimanenti.

**Area destra (30%) — Colonna ordine fissa (sempre visibile anche cambiando tab):**

In alto — Dati ordine:
- Numero ordine progressivo (automatico, non modificabile)
- Nome cliente (campo testo, opzionale)
- Numero tavolo (campo numerico, **obbligatorio**)
- Numero coperti (campo numerico, **obbligatorio**)

Poi — Flag e sconto:
- Flag gratis: Sponsor / Don Pierino / Amici (toggle, solo uno alla volta attivo)
- Campo sconto in euro

Al centro — Riepilogo ordine:
- Lista scrollabile dei piatti selezionati
- Per ogni riga: quantità × nome piatto, prezzo unitario, subtotale, e **pulsante X** per rimuovere il piatto
- Il riepilogo si aggiorna **in tempo reale** quando il cassiere tocca + e − nei tab a sinistra
- Cliccando la X su una riga si rimuove il piatto e si aggiorna il contatore nel tab corrispondente

In basso (fisso) — Totale e conferma:
- Riga totale
- Riga sconto (se presente)
- Riga **TOTALE DA PAGARE** in grande
- Pulsante **ORDINA** (disabilitato se mancano tavolo o coperti)

**Campi dell'ordine:**

| Campo | Tipo | Obbligatorio | Note |
|---|---|---|---|
| Nome cliente | Testo | No | Per identificare l'ordine |
| Numero tavolo | Numerico | **Sì** | Stampato su tutte le comande |
| Numero coperti | Numerico | **Sì** | Per le posate — stampato sulla comanda bevande |
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
- Pulsante "ORDINA" → crea l'ordine e stampa su tutte le stampanti necessarie
- **Ricevuta cliente** → vretti .203 (con nome, tavolo, piatti, totale, eventuale flag gratis)
- **Comanda cibo** → Fuhuihe .205 (con tavolo, piatti cibo, numero ordine)
- **Comanda bevande** → Fuhuihe .204 — **STAMPA SEMPRE**, anche senza bevande. Se ci sono bevande: stampa tavolo + coperti + bevande. Se non ci sono bevande: stampa comunque un foglio con solo tavolo + coperti (per le posate del cameriere).
- **Piatti speciali** → Fuhuihe .207 (solo se presenti nell'ordine, doppia stampa)
- Dopo la stampa: conferma a schermo con numero ordine, poi svuota il carrello

**Piatto speciale del giorno:**
- Il sistema mostra automaticamente solo il piatto speciale disponibile per la data corrente
- Se nessun piatto speciale è previsto per oggi, la sezione non appare
- L'admin può attivare/disattivare il piatto speciale dalla dashboard

### 5.10 — Componente: Login Unificato (public/index.html)

Pagina di accesso unica per tutti i dispositivi. Il layout e il flusso sono descritti in dettaglio nella sezione 5.2 (Sistema di Accesso).

**Implementazione:**
- POST `/api/login` con il PIN
- Il server restituisce `{ role, token, destinations? }`
- PIN 0000 → `{ role: 'admin', token: '...' }` → redirect a `/admin` con sidebar
- PIN 0001 → `{ role: 'cassa', token: '...' }` → redirect a `/cassa`
- PIN 0002 → `{ role: 'operatore', token: '...', destinations: ['cassa-bar', 'cassa-casetta', 'scaldavivande', 'controllo'] }` → mostra scelta ruolo
- PIN errato → shake animation + messaggio errore
- Il token viene salvato in `sessionStorage`, il ruolo in `localStorage`
- Al prossimo avvio: se `localStorage` ha un ruolo, va diretto alla pagina senza login
- Pulsante "Esci" su ogni pagina non-admin → cancella `localStorage` e `sessionStorage` → torna al login

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
║  [Dashboard RECAP]  [Magazzino]  [Controllo HW]        ║
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
1. **Riepilogo incassi** — Totale, per cassa, per metodo pagamento (con lordo/commissioni/netto POS)
2. **KPI principali** — Ordini totali, incasso, tempo medio evasione, coperti totali, ordini asporto, costo materie, netto
3. **Classifica vendite** — **Raggruppata per categoria** (Primi, Secondi, Speciali, Contorni, Condimenti, Bevande), **ordine alfabetico** dentro ogni categoria, **tutti i piatti visibili** anche con venduto 0 (opacità ridotta)
4. **Performance** — Tempo medio evasione, distribuzione ordini nel tempo (grafico orario)
5. **Magazzino** — Per ogni piatto: scorta iniziale → venduto → rimanente
6. **Omaggi** — Totale omaggi suddiviso per tipo (Sponsor, Don Pierino, Amici), con valore economico reale
7. **Sconti** — Totale sconti applicati
8. **Anomalie** — Ordini incompleti
9. **Pulsante esportazione** — CSV unificato (sep=`;`, BOM UTF-8, piatti per categoria)

**Recap aggregati:** Supporta URL params `?mode=total` (recap totale sagra) e `?ids=id1,id2` (sessioni specifiche, es. recap weekend). I dati vengono uniti server-side tramite `mergeRecap()`.

**Layout:** usa /frontend-design — stile report, card per ogni sezione, numeri grandi per i KPI principali

### 5.13 — Componente: Magazzino Materiali (public/admin-magazzino.html)

Inventario per **materiali e consumabili** della sagra (bicchieri, posate, rotoli carta, detersivi, ecc.). **Nessun legame con il menu o le casse** — gli articoli qui sono completamente indipendenti dal sistema ordini.

**Funzionalità:**
- **Tab categorie** in alto (flex-wrap, tutti visibili senza scroll): "Tutti" + un tab per ogni categoria presente (auto-generati dagli articoli)
  - Tab visibili solo se ci sono 2+ categorie diverse
  - In vista "Tutti": articoli raggruppati per categoria con header di sezione (nome verde + linea separatrice + conteggio)
  - Articoli senza categoria finiscono in "Altro" (sempre in fondo)
- **Dropdown fornitore** sotto i tab categorie: filtra per fornitore (Roma, Tosano, Basso, ecc.)
  - Nascosto se c'è un solo fornitore
  - Filtro combinabile con la categoria
  - Ogni articolo mostra il fornitore in ciano nei metadati della riga
- Lista articoli con quantità attuale/totale e indicatore colorato (verde/giallo/rosso)
- Pulsanti rapidi −5/−1/+1/+5/+10 per aggiornamento veloce
- Click sulla quantità per impostare valore esatto
- Pulsante "+ Nuovo" per aggiungere un articolo
- Modale per nuovo/modifica: nome, **categoria** (datalist con esistenti + creazione nuova), **fornitore** (datalist con esistenti), quantità attuale, quantità totale, soglia allarme (opzionale)
- **CSV Export/Import**: esportazione CSV completa (con colonna FORNITORE), importazione con merge per nome
- Eliminazione articolo con conferma
- Aggiornamento real-time via Socket.IO (`warehouse_updated`)

**API dedicate:**
- `GET /api/warehouse` — Lista articoli
- `POST /api/warehouse` — Nuovo articolo (accetta `supplier`)
- `PUT /api/warehouse/:id` — Modifica articolo (accetta `supplier`)
- `POST /api/warehouse/:id/adjust` — Aggiustamento rapido (+/- delta)
- `DELETE /api/warehouse/:id` — Elimina articolo
- `GET /api/warehouse/export` — Export CSV (con colonna FORNITORE)
- `POST /api/warehouse/import` — Import CSV (campo `fornitore` mappato)

**Database:** Tabella `warehouse` separata (id, name, quantity, total, alert_threshold, category, **supplier**, created_at, updated_at).

### 5.14 — Componente: Gestione Menu e Scorte (public/admin-menu.html)

Pagina admin per configurare il menu della sagra: piatti, prezzi, disponibilità per cassa, **e gestione scorte inline**. Le modifiche si applicano in tempo reale — le casse vedono subito i cambiamenti.

**Funzionalità per ogni piatto:**

| Azione | Descrizione |
|---|---|
| **Modifica prezzo** | Tap sul prezzo → editabile inline → salva automaticamente |
| **Scorte inline** | Ogni piatto mostra stock attuale/iniziale con indicatore colorato + pulsanti +/− |
| **Click su scorta** | Apre input per impostare valore esatto |
| **Reset scorte** | Pulsante nell'header → ripristina tutte le scorte ai valori iniziali |
| **Modifica nome** | Tap su ✏️ → apre form di modifica (include scorta iniziale e soglia allarme) |
| **Disponibilità casse** | Checkbox: Cassa Generale / Cassa Bar / Cassa Casetta |
| **Attiva/Disattiva** | Toggle — se disattivato il piatto non appare in nessuna cassa |
| **Data piatto speciale** | Per i piatti speciali: selettore data di disponibilità |
| **Composizione pezzi** | Per i piatti griglia: scomposizione in pezzi singoli |
| **Elimina** | Pulsante con conferma — rimuove il piatto dal menu |

**Scorte inline (aggiornamento real-time):**
- Indicatore colorato: verde (OK), giallo (sotto soglia), rosso (esaurito)
- I pulsanti −/+ aggiornano lo stock via `/api/inventory/:id/adjust`
- Gli ordini scalano automaticamente le scorte → la pagina si aggiorna live via Socket.IO (`inventory_updated`)
- Il pulsante "Reset scorte" nell'header chiama `/api/inventory/reset`
- Scorta iniziale e soglia allarme configurabili dal modale modifica piatto

**Comportamento:**
- Tab per categoria in alto per filtrare velocemente
- Le modifiche al prezzo, scorte e disponibilità si salvano in tempo reale (nessun pulsante "Salva" globale)
- Quando un piatto viene disattivato o aggiunto, le casse si aggiornano in tempo reale via Socket.IO
- I piatti griglia mostrano la composizione in pezzi sotto il nome
- I piatti speciali mostrano la data di disponibilità con icona calendario
- Accessibile dalla sidebar admin

### 5.15 — Pre-flight Check (integrato in admin-hardware.html)

Il pre-flight check è **integrato nel Pannello Hardware** come sezione "Setup Turno" in cima alla pagina. Non è più una pagina separata nella sidebar (setup.html resta accessibile via URL diretto come legacy).

**Comportamento:**
- Pulsante "Avvia Pre-flight Check" mostra il pannello con 5 check sequenziali:
  1. Server HTTP connesso (fetch `/api/menu`)
  2. Socket.IO connesso (riusa il socket della pagina hardware)
  3. Print proxy online (via `device_status`)
  4. Stampanti raggiungibili (ping via `request_printer_check`)
  5. Dispositivi connessi — non critico (monitor, scaldavivande, controllo)
- Progress bar animata con percentuale
- Check critici: server, socket, proxy, stampanti. Dispositivi = warning
- Risultato: "Tutto OK", "Dispositivi non critici mancanti" o "Problemi critici rilevati"
- Pulsante diventa "Riavvia Pre-flight Check" dopo il primo run

### 5.16 — Componente: Controllo Hardware (public/admin-hardware.html)

Pagina unificata per **test e monitoraggio** di tutti i dispositivi hardware. Usata sia per verificare che tutto funzioni prima del servizio, sia per monitorare durante il servizio.

**Layout — usa /frontend-design:**

```
╔══════════════════════════════════════════════════════════╗
║  🔧 Controllo Hardware              Ultimo check: 3s fa ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  📡 RETE                                                ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ ● Server cloud          Online    32ms   da 18:00│   ║
║  │ ● Print proxy (Pi)      Connesso        da 18:00│   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  🖨️ STAMPANTI                                           ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ ● vretti (.203) ricevuta cassa   Online   8ms    │   ║
║  │   da 18:01                    [Stampa Test]       │   ║
║  │ ● Fuhuihe (.204) comanda bev. Online   12ms      │   ║
║  │   da 18:01                    [Stampa Test]       │   ║
║  │ ● Fuhuihe (.205) comanda cibo Online   10ms      │   ║
║  │   da 18:01                    [Stampa Test]       │   ║
║  │ ● Fuhuihe (.206) ricevuta bar Online   11ms      │   ║
║  │   da 18:01                    [Stampa Test]       │   ║
║  │ ● Fuhuihe (.207) speciali     Online    9ms      │   ║
║  │   da 18:01                    [Stampa Test]       │   ║
║  │ ● Fuhuihe (.208) casetta      Online   15ms      │   ║
║  │   da 18:01                    [Stampa Test]       │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  📱 DISPOSITIVI                                         ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ ● Monitor cuochi        Connesso        da 18:02│   ║
║  │ ● Tablet scaldavivande  Connesso        da 18:03│   ║
║  │ ● Tablet operatore      Connesso        da 18:03│   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
║  [▶ TEST COMPLETO]  Testa tutto in sequenza             ║
║                                                          ║
║  📋 LOG EVENTI                                          ║
║  ┌──────────────────────────────────────────────────┐   ║
║  │ 21:15  ⚠ vretti (.203) disconnessa              │   ║
║  │ 21:16  ✅ vretti (.203) riconnessa               │   ║
║  │ 20:30  ℹ Tablet scaldavivande connesso           │   ║
║  │ 18:00  ℹ Setup completato — servizio avviato     │   ║
║  └──────────────────────────────────────────────────┘   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Comportamento:**
- Check automatico ogni 5 secondi su tutti i dispositivi
- Per ogni stampante: stato (online/offline), latenza, tempo connessione, **pulsante "Stampa Test"**
- Per ogni dispositivo Socket.IO (monitor, tablet): stato connessione
- Indicatore colorato: verde = online, rosso = offline, giallo = latenza alta, grigio = mai connesso
- **Pulsante "Test Completo"**: esegue tutti i test in sequenza (ping + stampa test su ogni stampante) e produce un report verde/rosso
- Log cronologico degli eventi hardware della serata (scrollabile)
- Se un dispositivo va offline: riga diventa rossa con animazione pulsante
- Accessibile dalla sidebar sotto ADMIN (richiede PIN)

### 5.17 — Alert Sonori/Visivi e Modalità Emergenza Stampante

Queste non sono pagine separate ma comportamenti integrati nelle pagine cassa e admin.

**Alert alle casse (integrato nella pagina cassa):**
Quando una stampante si disconnette:
- **Banner giallo** in alto nella cassa con nome stampante offline + **beep audio** (Web Audio API)
- Il cassiere può continuare a lavorare

**Feedback "STAMPA IN CODA" (tutte le casse):**
Se il proxy è offline al momento della creazione ordine:
- L'ordine viene creato e la risposta include `prints: { receipt: false, ... }`
- Le casse mostrano **"⚠ STAMPA IN CODA"** in rosso + beep nel feedback ordine
- Il feedback resta visibile 6 secondi (invece dei normali 3)
- I job di stampa vengono accodati in memoria sul server e inviati automaticamente alla riconnessione del proxy (`flushPrintQueue`)

**Modalità emergenza stampante (integrata nella logica di stampa):**
Se una stampante è offline al momento di stampare:
- La comanda/ricevuta viene messa in **coda di stampa** (accodata in memoria sul server)
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

**Comportamento (5 step):**
- Step 1: mostra ordini incompleti. L'admin può procedere comunque o aspettare
- Step 2: riepilogo flash (incasso, ordini, piatti esauriti) + download CSV + **selettore turno PRANZO/CENA** (auto-detect: prima delle 16:00 = pranzo, dopo = cena)
- Step 3: scorte finali (lista piatti con stock rimanente)
- Step 4: conferma password + pulsante reset. Il turno selezionato viene inviato al server `POST /admin/reset { turno: "pranzo"|"cena" }`
- Step 5: conferma "Turno chiuso con successo"
- Dopo la chiusura: broadcast `service_closed` a tutti i client
- Pranzo e cena dello stesso giorno vengono salvati come **sessioni separate**
- Il report completo è disponibile nella dashboard RECAP

### 5.19 — Componente: Storico Serate (public/admin-serate.html)

Tabella comparativa di tutte le serate archiviate con possibilità di download report, rinomina e eliminazione.

**Funzionalità:**
- Tabella con colonne: #, Serata (nome + badge turno pranzo/cena), Incasso (con barra proporzionale), Ordini, Coperti, Top Piatto, Azioni (scarica CSV + elimina)
- **Badge turno**: ogni sessione mostra "pranzo" (giallo) o "cena" (viola) accanto alla data
- **Rinomina inline**: click sull'icona matita → input inline con salva/annulla
- **Download report**: scarica CSV con formato unificato (sep=`;`, per categoria)
- **Elimina serata**: con conferma, rimuove sessione dall'archivio
- **Recap aggregati** (barra in alto):
  - Pulsante "Recap Totale Sagra" → apre `/admin/recap?mode=total`
  - Pulsanti "Weekend [date]" automatici per ogni coppia Sab-Dom → apre `/admin/recap?ids=id1,id2,...`

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
| Monitor cuochi (TV) | `https://sagrapp.server.com/monitor` |
| Tablet scaldavivande | `https://sagrapp.server.com/scaldavivande` |
| Tablet zona controllo | `https://sagrapp.server.com/controllo` |
| Admin | `https://sagrapp.server.com/admin` |

---

## 8. Configurazione (config.js)

```javascript
module.exports = {
  PORT: 3000,

  // PIN di accesso per ruolo
  // Ogni PIN corrisponde a un ruolo specifico
  PINS: {
    '0000': { role: 'admin', redirect: '/admin', sidebar: true },
    '0001': { role: 'cassa_generale', redirect: '/cassa', sidebar: false },
    '0002': { role: 'operatore', redirect: null, sidebar: false,
              destinations: [
                { id: 'cassa-bar', name: 'Cassa Bar', icon: '🍺', url: '/cassa-bar' },
                { id: 'cassa-casetta', name: 'Cassa Casetta', icon: '🏠', url: '/cassa-casetta' },
                { id: 'scaldavivande', name: 'Scaldavivande', icon: '🔥', url: '/scaldavivande' },
                { id: 'controllo', name: 'Zona Controllo', icon: '📋', url: '/controllo' },
              ]
            },
  },
  // Il monitor cuochi (/monitor) non richiede PIN — accesso diretto via URL

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
- Lo scaldavivande deve avere pulsanti touch-friendly (minimo 60x60px)
- Colori: verde = funziona, rosso = errore, grigio = non testato
- NO animazioni elaborate, NO framework CSS pesanti — semplicità

### Sicurezza
- **CORS** ristretto: accetta solo Railway deploy, localhost e LAN 192.168.x.x
- **Rate limiting**: max 60 ordini/minuto per IP (endpoint `POST /api/orders`)
- **Token sessione**: generato con `crypto.randomBytes(32)` in dev, env var `TOKEN_SECRET` su Railway
- **Concorrenza ordini**: mutex (promise chain) serializza la creazione ordini per evitare race condition sul contatore con 3 casse simultanee
- **DB pool**: 20 connessioni PostgreSQL, `await` su `insertOrder` (scrittura critica)

---

## 10. Checklist di Accettazione

Il test è superato quando:

- [ ] Il server si avvia e risponde su porta 3000
- [ ] La dashboard mostra lo stato connessione al server
- [ ] Il print proxy si connette al server e appare come "online" sulla dashboard
- [ ] Ogni stampante viene testata con TCP ping e mostra online/offline
- [ ] Il pulsante "Stampa Test" stampa effettivamente sulla stampante corretta
- [ ] Tutte e 6 le stampanti LAN rispondono ai rispettivi IP (.203-.208)
- [ ] La pagina monitor cuochi mostra 2 colonne: da cucinare / nello scaldavivande
- [ ] La pagina scaldavivande ha pulsanti +10, +20, +30, +40, +50 e − per ogni piatto
- [ ] Un tap sullo scaldavivande aggiorna "nello scaldavivande" del monitor in tempo reale (< 1 secondo)
- [ ] Un ordine dalla cassa aggiorna "da cucinare" del monitor in tempo reale
- [ ] "Da cucinare" si ricalcola automaticamente (vendute − pronto)
- [ ] "Nello scaldavivande" si ricalcola automaticamente (pronto − evasi)
- [ ] **Evasione ordine scala pezzi griglia dallo scaldavivande**
- [ ] **Evasione bloccata se pezzi griglia insufficienti nello scaldavivande**
- [ ] **Ordine solo pasta/bevande si evade senza controllare scaldavivande**
- [ ] Il tablet operatore fisso mostra lista ordini aperti + tastierino evasione
- [ ] Digitare un numero ordine e premere "Evadi" segna l'ordine come evaso
- [ ] Ordine non trovato → feedback rosso, ordine già evaso → feedback giallo
- [ ] **Pulsante "Annulla" sull'ordine: ripristina scorte magazzino e vendute monitor**
- [ ] Il pulsante "Test Completo" esegue tutti i test in sequenza
- [ ] Se una stampante è offline, il sistema lo segnala senza bloccarsi
- [ ] Se il proxy si disconnette, la dashboard lo mostra chiaramente
- [ ] Il monitor cuochi ha numeri leggibili da 3 metri (font 120px+)
- [ ] I pulsanti scaldavivande sono touch-friendly (80px+ area di tap)
- [ ] Il design è professionale e non generico (skill frontend-design applicata)
- [ ] Contrasto WCAG AA su tutte le pagine, AAA sul monitor cuochi
- [ ] **Interfaccia cassa con layout a due colonne come foglio cartaceo**
- [ ] **Cassa: campi nome, tavolo, coperti, sconto, flag gratis (Sponsor/Don Pierino/Amici)**
- [ ] **Cassa: coperti stampati sulla comanda bevande (fallback su comanda cibo)**
- [ ] **Cassa: flag gratis → totale €0 ma ordine registrato e stampato normalmente**
- [ ] **Login admin con PIN funziona (PIN errato → errore, PIN corretto → accesso)**
- [ ] **Dashboard admin LIVE mostra ordini, incasso, scorte in tempo reale**
- [ ] **Dashboard admin RECAP mostra report completo con omaggi e sconti**
- [ ] **Menu e Scorte: scorte visibili inline con indicatore colorato e pulsanti +/−**
- [ ] **Menu e Scorte: click su scorta per impostare valore esatto**
- [ ] **Menu e Scorte: pulsante "Reset scorte" riporta tutte le scorte ai valori iniziali**
- [ ] **Quando un piatto scende sotto soglia → alert visibile in dashboard e alle casse**
- [ ] **Quando un piatto arriva a zero → segnato esaurito, non ordinabile**
- [ ] **Admin può riattivare un piatto esaurito con nuova scorta**
- [ ] **Magazzino Materiali: lista articoli con quantità, +/− rapidi, soglia opzionale**
- [ ] **Magazzino Materiali: aggiungere, modificare ed eliminare articoli consumabili**
- [ ] **Esportazione report RECAP in CSV funzionante**
- [ ] **Gestione Menu: pagina admin per modificare piatti, prezzi, disponibilità casse**
- [ ] **Gestione Menu: aggiungere e rimuovere piatti dal menu**
- [ ] **Gestione Menu: attivare/disattivare piatti — le casse si aggiornano in tempo reale**
- [ ] **Gestione Menu: scegliere in quali casse è disponibile ogni piatto**
- [ ] **Gestione Menu: modificare composizione pezzi per piatti griglia**
- [ ] **Gestione Menu: impostare data disponibilità per piatti speciali**
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
1. Server Express + Socket.IO (scheletro) + SQLite con schema ordini/inventario/scaldavivande
2. Print proxy con TCP verso stampanti LAN (gira su Raspberry Pi con PM2)
3. **Landing page selezione ruolo** — **usa /frontend-design**
4. **Interfaccia cassa con layout foglio cartaceo** — **usa /frontend-design**
5. Dashboard test hardware con stato stampanti e pulsanti test — **usa /frontend-design**
6. **Monitor cuochi con 2 colonne (da cucinare / nello scaldavivande)** — **usa /frontend-design**
7. **Tablet scaldavivande con pulsanti +10/+20/+30/+40/+50 e −** — **usa /frontend-design**
8. **Tablet operatore fisso (lista ordini + evasione + annullamento)** — **usa /frontend-design**
9. **Logica evasione: controllo pezzi griglia + blocco se insufficienti + scala scaldavivande**
10. Login admin con PIN
11. **Setup inizio turno (wizard)** — **usa /frontend-design**
12. **Pannello controllo hardware real-time** — **usa /frontend-design**
13. Scorte inline nel menu + magazzino materiali consumabili — **usa /frontend-design**
14. **Gestione menu admin (piatti, prezzi, disponibilità casse)** — **usa /frontend-design**
15. Dashboard admin LIVE con statistiche real-time — **usa /frontend-design**
16. Dashboard admin RECAP con report, omaggi, sconti e esportazione CSV — **usa /frontend-design**
17. Alert scorte alle casse (WebSocket push)
18. **Alert sonori/visivi per problemi HW + modalità emergenza stampante**
19. **Chiusura turno guidata** — **usa /frontend-design**
20. Test completo automatizzato
21. Polish finale e verifica contrasto/leggibilità

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

Usa la skill `/frontend-design` per costruire TUTTE le pagine HTML del progetto (dashboard, monitor, scaldavivande, operatore). Non scrivere CSS generico — invoca la skill e lascia che guidi il design.

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
- **Responsive:** deve funzionare su PC (dashboard), TV 32" (monitor), tablet 8-10" (scaldavivande)
- **Colori di stato universali:** verde `#4ecca3` = ok, rosso `#e94560` = errore, giallo `#ffd93d` = warning, grigio `#6c7a89` = non testato
- **Animazioni:** solo per feedback (tap, aggiornamento stato). Nessuna animazione decorativa. `transition: 200ms ease` come standard
- **Contrasto:** WCAG AA minimo su tutte le pagine, AAA sul monitor cuochi


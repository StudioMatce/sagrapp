# SagrApp — Gestione Ordini Sagra M.D.G.

## Cosa fa
Sistema di gestione ordini per una sagra di paese (500-1000 coperti). Web app cloud-based con stampa termica, monitor cuochi in tempo reale, e tablet per scaldavivande e zona controllo.

## Stack
- **Backend:** Node.js + Express + Socket.IO
- **Database:** In-memory (SQLite previsto per produzione)
- **Frontend:** HTML/CSS/JS vanilla + Socket.IO client (no framework)
- **Stampa:** ESC/POS raw via TCP porta 9100 su stampanti LAN
- **Accesso:** Login unificato con PIN (config.js → PINS). Sidebar solo per admin
- **Navigazione:** Sidebar (js/sidebar.js) solo pagine admin. Pulsante "Esci" su pagine non-admin
- **Deploy:** VPS con PM2 (attualmente test su localhost:3000)

## Struttura file
```
server/
  index.js          # Express + Socket.IO server
  config.js         # Menu (42 piatti), stampanti, configurazione
  routes/api.js     # API REST + logica ordini/stampa/inventario/omaggi/sconti
  services/printer.js  # Generazione comandi ESC/POS (ricevuta, comande, speciali)

print-proxy/
  index.js          # Proxy locale che inoltra stampe alle stampanti LAN

public/
  index.html        # Login unificato con PIN (tastierino + scelta ruolo per operatore)
  cassa.html        # Cassa ordini — 70/30 layout con tab CIBO/BEVANDE
  cassa-bar.html    # Cassa bar — layout 70/30 come generale (solo bevande, source: 'bar')
  cassa-casetta.html # Cassa casetta — layout 70/30, tab CONTORNI/BEVANDE (source: 'casetta')
  monitor.html      # Monitor TV cuochi (accesso diretto senza PIN)
  scaldavivande.html # Tablet scaldavivande (+10/+20/+30/+40/+50)
  controllo.html    # Tablet operatore fisso (lista ordini + tastierino evasione)
  admin.html        # Dashboard admin LIVE (con sidebar)
  admin-recap.html  # Report post-serata (con omaggi e sconti)
  admin-magazzino.html # Gestione scorte
  admin-hardware.html  # Pannello controllo hardware (dispositivi + test completo)
  admin-chiusura.html  # Procedura chiusura turno (flash summary + PIN re-entry)
  admin-menu.html   # Gestione menu: piatti, prezzi, casse, composizione pezzi
  setup.html        # Wizard setup inizio turno (progress bar + device checks)
  js/sidebar.js     # Sidebar navigazione (solo pagine admin)
```

## Stampanti (tutte LAN via Powerline, TCP porta 9100)
| # | IP | Ruolo |
|---|---|---|
| 1 | 192.168.1.203 | vretti — Ricevuta cassa generale |
| 2 | 192.168.1.204 | Fuhuihe — Comanda bevande |
| 3 | 192.168.1.205 | Fuhuihe — Comanda cibo |
| 4 | 192.168.1.206 | Fuhuihe — Ricevuta cassa bar |
| 5 | 192.168.1.207 | Fuhuihe — Piatti speciali |
| 6 | 192.168.1.208 | Fuhuihe — Casetta aperitivi |

## Flusso di stampa
Il server cloud NON raggiunge le stampanti direttamente. Un **print-proxy** gira su un **Raspberry Pi** dedicato alla sagra (avvio automatico via PM2), si connette al server via Socket.IO, e inoltra i comandi ESC/POS alle stampanti via TCP.

### Coda stampa
Se il proxy è offline al momento dell'ordine, i job vengono **accodati in memoria** sul server. Quando il proxy si riconnette, la coda viene svuotata automaticamente (`flushPrintQueue`).

### Alert stampante offline (cassa)
La cassa riceve via Socket.IO lo stato delle stampanti. Se una stampante risulta offline, appare un **banner giallo** + **beep audio** per avvisare il cassiere.

## Menu e composizione piatti
- Il menu reale è in `config.js` → `MENU` (42 piatti), modificabile a runtime via admin
- Categorie: primo, secondo, speciale, contorno, condimento, bevanda
- Postazioni: cucina, piastra, griglia, polenta, bar, speciali
- Ogni piatto ha `casses` (array): in quali casse è disponibile (`cassa_generale`, `cassa_bar`, `cassa_casetta`)
- Ogni piatto ha `available` (boolean): se disattivato non appare in nessuna cassa
- I piatti griglia hanno `composition` che li scompone in pezzi singoli per il monitor cuochi
- Esempio: "Costicine con polenta" → costicine: 3 pezzi + polenta: 1 porzione
- I piatti speciali (`special: true`) hanno **doppia stampa**: comanda cibo (.205) + stampante dedicata (.207)
- I piatti speciali hanno `available_date` — uno diverso per ogni serata della sagra

## Gestione Menu (admin-menu.html)
- Pagina admin per CRUD piatti: nome, prezzo, categoria, postazione, casse
- Tab per categoria in alto (filtro rapido)
- Prezzo editabile inline (click → input → blur salva)
- Toggle attiva/disattiva per ogni piatto
- Checkbox per disponibilità nelle 3 casse (Gen/Bar/Cas)
- Composizione pezzi per piatti griglia
- Data disponibilità per piatti speciali
- Form modale per nuovo piatto o modifica completa
- API: `GET /api/menu`, `PUT /api/menu/:id`, `POST /api/menu`, `DELETE /api/menu/:id`
- Socket.IO event `menu_updated` per aggiornare le casse in tempo reale

## Interfaccia cassa (cassa.html)
- **Layout 70/30**: area piatti a sinistra (70%) con tab CIBO/BEVANDE, colonna ordine a destra (30%)
- Tab CIBO: primi → secondi → speciale del giorno → contorni → condimenti
- Tab BEVANDE: bevande raggruppate con badge contatore
- Campi ordine:
  - **Nome cliente** (opzionale, testo)
  - **Tavolo** (obbligatorio, numerico)
  - **Coperti** (obbligatorio, numerico) — stampati sulla comanda bevande (per le posate)
  - **Sconto** (opzionale, € o %)
  - **Flag gratis** (toggle, uno solo alla volta): Sponsor | Don Pierino | Amici
- Quando un flag gratis è attivo: totale = €0, ma ordine registrato, stampato, scorte scalate normalmente
- Il piatto speciale del giorno è visibile solo se `available_date` corrisponde alla data corrente

## Monitor cuochi (2 colonne)
Traccia 6 articoli in pezzi singoli: costicine, salsicce, sovracoscia, pastin, polenta, patate.
2 colonne visibili sulla TV:
- **Da cucinare** = vendute − pronto (cosa il cuoco deve ancora cucinare)
- **Nello scaldavivande** = pronto − evasi (pezzi fisicamente presenti ora)

Dati NON visibili su TV (solo admin RECAP): vendute totali, pronto totale, evasi totale.
- "Da cucinare" SALE con nuovi ordini, SCENDE quando il cuoco deposita pezzi
- "Nello scaldavivande" SALE quando il cuoco deposita, SCENDE quando l'operatore evade

### Codifica colori monitor
- **Da cucinare**: verde (0), giallo (1-10), rosso (>10)
- **Nello scaldavivande**: verde (>10), giallo (1-10), rosso (0)
- Font ≥120px per leggibilità a 3 metri

### Scaldavivande
- Pulsanti +10/+20/+30/+40/+50 e -1 per ogni articolo
- **Long press** sul pulsante meno (600ms) apre input numerico per impostare valore esatto

## Evasione ordini (regole)
L'operatore fisso chiude gli ordini dal suo tablet. Prima di evadere, il sistema controlla i pezzi griglia nello scaldavivande:

| Situazione | Comportamento |
|---|---|
| Pezzi griglia sufficienti | Evade, scala pezzi dallo scaldavivande |
| Pezzi griglia insufficienti | BLOCCA, mostra dettaglio mancanze |
| Ordine già evaso | Feedback giallo "Già evaso" |
| Ordine non trovato | Feedback rosso "Non trovato" |
| Solo bevande/pasta (no griglia) | Evade senza controllo scaldavivande |
| Evasione parziale | NON permessa — tutto o niente |

## Annullamento ordini
L'operatore può annullare un ordine aperto (con conferma):
- Scorte magazzino **ripristinate** (come se l'ordine non fosse mai stato fatto)
- "Vendute" sul monitor scala (da cucinare scende)
- Se già evaso: pezzi scaldavivande **ripristinati**
- Ordine marcato "ANNULLATO" (visibile nei report)

## Logica stampa ordini
| Contenuto | Ricevuta (.203) | Cibo (.205) | Bevande (.204) | Speciali (.207) |
|---|---|---|---|---|
| Solo cibo | si | si | si* | — |
| Solo bevande | si | — | si | — |
| Cibo + bevande | si | si | si | — |
| Con piatto speciale | si | si (con speciale) | si | si (solo speciale) |

*La comanda bevande stampa SEMPRE (anche senza bevande) per il conteggio coperti/posate.
- **Coperti** stampati sulla comanda bevande (sempre)
- **Ricevuta** mostra: subtotale, sconto, omaggio, totale, nome cliente

## Admin RECAP
Il report post-serata (`GET /api/admin/stats/recap`) include:
- Totale ordini e incasso
- Classifica vendite per piatto
- Distribuzione ordini per ora
- Incasso per cassa e per metodo pagamento
- Report magazzino (iniziale → venduto → rimanente)
- **Omaggi**: conteggio e valore economico reale per tipo (sponsor, don_pierino, amici)
- **Sconti**: totale sconti applicati
- Ordini incompleti

### Archivio serate
- **Selettore serate** nell'header del recap per visualizzare lo storico
- Alla chiusura turno (`POST /admin/reset`), lo snapshot viene salvato in `archivedSessions`
- Se si chiude più volte nella stessa giornata, i dati vengono **aggregati** in un'unica sessione (merge di ordini, vendite, omaggi, scorte)
- API: `GET /api/admin/sessions` (lista serate), `GET /api/admin/sessions/:id/recap` (recap archiviato)

## Layout casse
Tutte e tre le casse usano il **layout a due pannelli 70/30**:
- **70% sinistra**: area menu con piatti/bevande e stepper quantità
- **30% destra**: colonna ordine con form, riepilogo, totale e bottone ORDINA
- Responsive: sotto 700px si impila verticalmente

| Cassa | Tab | Campi ordine | Source |
|---|---|---|---|
| Generale | CIBO / BEVANDE | Nome, Tavolo, Coperti, Omaggi, Sconto | `principale` |
| Bar | — (solo bevande) | Nome, Tavolo | `bar` |
| Casetta | CONTORNI / BEVANDE | Tavolo (opzionale) | `casetta` |

## Convenzioni codice
- Tutti i file frontend sono HTML vanilla con JS inline (no build step)
- Il design usa font Outfit + JetBrains Mono, sfondo scuro (#060a12), accento verde (#4ecca3)
- Usare `/frontend-design` per qualsiasi nuova pagina o modifica UI
- I commenti nel codice sono in italiano per le parti complesse
- Ogni ordine include `source` (principale/bar/casetta) e `coperti` (numero posate)
- Il documento tecnico completo è in `SagrApp_Claude_Code_v4.3.md`

## Comandi
```bash
node server/index.js    # Avvia il server (porta 3000)
node print-proxy/index.js  # Avvia il print proxy locale
```

## Sistema di accesso (PIN)
| PIN | Ruolo | Destinazione |
|---|---|---|
| 0000 | Admin | `/admin` + sidebar completa |
| 0001 | Cassa Generale | `/cassa` direttamente |
| 0002 | Operatore | Scelta: Cassa Bar / Casetta / Scaldavivande / Zona Controllo |
| (nessuno) | Monitor Cuochi | `/monitor` — accesso diretto via URL, nessun PIN |

- I PIN sono in `config.js` → `PINS`
- Il token viene salvato in `sessionStorage`, il ruolo in `localStorage`
- Auto-redirect al ruolo salvato in localStorage (con countdown 3s annullabile)
- Pagine non-admin hanno pulsante "Esci" (top-left) → torna al login
- Monitor non ha né login né pulsante Esci (display fisso)

## Pagine disponibili
- `/` — Login unificato (tastierino PIN)
- `/cassa` — Cassa ordini (PIN 0001)
- `/cassa-bar` — Cassa bar (PIN 0002 → scelta ruolo)
- `/cassa-casetta` — Cassa casetta aperitivi (PIN 0002 → scelta ruolo)
- `/monitor` — Monitor cuochi TV (accesso diretto, no PIN)
- `/scaldavivande` — Tablet scaldavivande (PIN 0002 → scelta ruolo)
- `/controllo` — Tablet operatore fisso (PIN 0002 → scelta ruolo)
- `/setup` — Wizard setup inizio turno (admin)
- `/admin` — Dashboard admin LIVE (PIN 0000)
- `/admin/recap` — Report post-serata (admin)
- `/admin/magazzino` — Gestione scorte (admin)
- `/admin/hardware` — Pannello controllo hardware (admin)
- `/admin/menu` — Gestione menu (admin) — piatti, prezzi, disponibilità casse, composizione
- `/admin/chiusura` — Procedura chiusura turno (admin)

# SagrApp — Gestione Ordini Sagra M.D.G.

## Cosa fa
Sistema di gestione ordini per una sagra di paese (500-1000 coperti). Web app cloud-based con stampa termica, monitor cuochi in tempo reale, e tablet per scaldavivande e zona controllo.

## Stack
- **Backend:** Node.js + Express + Socket.IO
- **Database:** PostgreSQL su Neon (cloud) via libreria `pg` (node-postgres). Connection string in `DATABASE_URL` (`.env` in locale, variabile Railway in produzione)
- **Frontend:** HTML/CSS/JS vanilla + Socket.IO client (no framework)
- **Stampa:** ESC/POS raw via TCP porta 9100 su stampanti LAN
- **Accesso:** Login unificato con PIN (config.js → PINS). Sidebar solo per admin
- **Navigazione:** Sidebar (js/sidebar.js) visibile su tutte le pagine quando loggato come admin (incluse monitor, scaldavivande, controllo). Pulsante "Esci" su pagine non-admin. Soft navigation PJAX per pagine admin — funzioni onclick devono essere esportate su `window` per compatibilità
- **Sicurezza:** CORS ristretto (Railway + localhost + LAN 192.168.x.x), rate limiting ordini (60/min per IP), token sessione con crypto random
- **Deploy:** Railway (con variabili d'ambiente DATABASE_URL e TOKEN_SECRET)

## Struttura file
```
server/
  index.js          # Express + Socket.IO server
  config.js         # Menu (53 piatti), stampanti, configurazione
  routes/api.js     # API REST + logica ordini/stampa/inventario/omaggi/sconti
  services/printer.js  # Generazione comandi ESC/POS (ricevuta, comande, speciali)
  db.js               # Layer database PostgreSQL (Neon) — tutte le funzioni sono async

print-proxy/
  index.js          # Proxy locale che inoltra stampe alle stampanti LAN

public/
  index.html        # Login unificato con PIN (tastierino + scelta ruolo per operatore)
  cassa.html        # Cassa ordini — 70/30 layout con tab CIBO/BEVANDE
  cassa-bar.html    # Cassa bar — layout 70/30 come generale (solo bevande, source: 'bar')
  cassa-casetta.html # Cassa casetta — layout 70/30, tab CONTORNI/BEVANDE (source: 'casetta')
  monitor.html      # Monitor TV cuochi griglia (accesso diretto senza PIN) — costicine, salsicce, sovracoscia, pastin, polenta
  monitor-cucina.html # Monitor TV cucina/friggitrice (accesso diretto senza PIN) — patate fritte (gnocchi/funghi previsti)
  scaldavivande.html # Tablet scaldavivande (−10/−5/+5/+10)
  controllo.html    # Tablet operatore fisso (lista ordini + tastierino evasione)
  admin.html        # Dashboard admin LIVE (con sidebar)
  admin-recap.html  # Report post-serata (con omaggi e sconti)
  admin-magazzino.html # Magazzino materiali e consumabili (bicchieri, posate, ecc.)
  admin-hardware.html  # Pannello controllo hardware (dispositivi + test completo + pre-flight check integrato)
  admin-chiusura.html  # Procedura chiusura turno (selettore pranzo/cena + flash summary + scarica report + PIN re-entry)
  admin-menu.html   # Gestione menu: piatti, prezzi, casse, composizione pezzi, scorte inline
  admin-serate.html # Storico serate: tabella comparativa con download report, badge turno, recap weekend/totale
  setup.html        # Wizard setup inizio turno (legacy — pre-flight check ora integrato in admin-hardware)
  js/sidebar.js     # Sidebar navigazione (pagine admin + monitor + scaldavivande + controllo)
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
Inoltre, se al momento della creazione ordine il proxy è offline, tutte le casse mostrano **"STAMPA IN CODA"** in rosso + beep (il job è accodato e partirà alla riconnessione del proxy).

## Menu e composizione piatti
- Il menu reale è in `config.js` → `MENU` (53 piatti), modificabile a runtime via admin
- Categorie: primo, secondo, speciale, contorno, condimento, bevanda
- Postazioni: cucina, piastra, griglia, polenta, bar, speciali
- Ogni piatto ha `casses` (array): in quali casse è disponibile (`cassa_generale`, `cassa_bar`, `cassa_casetta`)
- Ogni piatto ha `available` (boolean): se disattivato non appare in nessuna cassa
- I piatti griglia hanno `composition` che li scompone in pezzi singoli per il monitor cuochi
- Esempio: "Costicine con polenta" → costicine: 3 pezzi + polenta: 1 porzione
- I piatti speciali (`special: true`) hanno **doppia stampa**: comanda cibo (.205) + stampante dedicata (.207)
- I piatti speciali hanno `available_date` — uno diverso per ogni serata della sagra

## Gestione Menu e Scorte (admin-menu.html)
- Pagina admin per CRUD piatti: nome, prezzo, categoria, postazione, casse
- Tab per categoria in alto (filtro rapido)
- Prezzo editabile inline (click → input → blur salva)
- **Scorte inline**: ogni piatto mostra stock attuale/iniziale con indicatore colorato (verde/giallo/rosso)
  - Click sul contatore per impostare valore esatto
  - Pulsanti +/− per aggiustamento rapido
  - Pulsante "Reset scorte" nell'header per riportare tutte le scorte ai valori iniziali
  - Soglia allarme e scorta iniziale modificabili dal modale modifica piatto
  - Aggiornamento real-time via Socket.IO (`inventory_updated`, `inventory_reset`)
- Toggle attiva/disattiva per ogni piatto
- Checkbox per disponibilità nelle 3 casse (Gen/Bar/Cas)
- Composizione pezzi per piatti griglia
- Data disponibilità per piatti speciali
- Form modale per nuovo piatto o modifica completa
- API: `GET /api/menu`, `PUT /api/menu/:id`, `POST /api/menu`, `DELETE /api/menu/:id`
- Socket.IO event `menu_updated` per aggiornare le casse in tempo reale

## Magazzino Materiali (admin-magazzino.html)
- Inventario per **materiali e consumabili** (bicchieri, posate, rotoli carta, detersivi, ecc.)
- **Nessun legame** con il menu o le casse — articoli indipendenti
- **Tab categorie** in alto (con flex-wrap, visibili tutti senza scroll): "Tutti" + un tab per ogni categoria
  - Tab visibili solo se ci sono 2+ categorie
  - In vista "Tutti": articoli raggruppati per categoria con header di sezione (nome verde + linea + conteggio)
  - Articoli senza categoria finiscono in "Altro"
- **Dropdown fornitore** sotto i tab categorie: filtra per fornitore (Roma, Tosano, Basso, ecc.)
  - Ogni articolo ha un campo `supplier` (fornitore) mostrato in ciano nei metadati
  - Filtro combinabile con la categoria
- Lista articoli con quantità attuale/totale e indicatore colorato
- Pulsanti rapidi −5/−1/+1/+5/+10 per aggiornamento veloce
- Click sulla quantità per impostare valore esatto
- Pulsante "+ Nuovo" per aggiungere un articolo
- Modale per nuovo/modifica: nome, categoria, **fornitore** (datalist con esistenti), quantità attuale, quantità totale, soglia allarme (opzionale)
- Eliminazione articolo con conferma
- Aggiornamento real-time via Socket.IO (`warehouse_updated`)
- API: `GET /api/warehouse`, `POST /api/warehouse`, `PUT /api/warehouse/:id`, `POST /api/warehouse/:id/adjust`, `DELETE /api/warehouse/:id`
- DB: tabella `warehouse` con colonne id, name, quantity, total, alert_threshold, category, **supplier**, created_at, updated_at

## Interfaccia cassa (cassa.html)
- **Layout 70/30**: area piatti a sinistra (70%) con tab CIBO/BEVANDE/ORDINI, colonna ordine a destra (30%)
- Tab CIBO: primi → secondi → speciale del giorno → contorni → condimenti
- Tab BEVANDE: bevande raggruppate con badge contatore
- Tab ORDINI: storico completo ordini della serata (numero, tavolo, piatti, totale, stato) con pulsante annulla
- Campi ordine:
  - **Nome cliente** (opzionale, testo)
  - **Tavolo** (obbligatorio, numerico)
  - **Coperti** (obbligatorio, numerico) — stampati sulla comanda bevande (per le posate)
  - **Toggle Asporto**: quando attivo, coperti = 0 e disabilitato, tab bevande disabilitata, niente stampa comanda bevande, "ASPORTO" stampato sulla comanda cibo
  - **Toggle POS**: pagamento con carta (giallo, default: contanti). Commissione 0.2% tracciata nel recap
  - **Sconto** (opzionale, € o %)
  - **Tag omaggio** (toggle, uno solo alla volta): Sponsor | Don Pierino | Amici — solo tag statistico, NON azzera il totale
- I tag omaggio servono per le statistiche recap (conteggio per tipo), lo sconto va applicato manualmente nel campo Sconto
- Il piatto speciale del giorno è visibile solo se `available_date` corrisponde alla data corrente
- Il box "Speciale del giorno" appare solo se ci sono piatti speciali disponibili

## Monitor cuochi
**Header**: Coperti (sinistra) + Ordini (rosso) + Evasi (verde) a destra

Traccia 6 articoli in pezzi singoli: costicine, salsicce, sovracoscia, pastin, polenta, patate.
4 colonne visibili sulla TV:
- **Venduto** = vendute totali (grigio, informativo)
- **Da evadere** = vendute − evasi (rosso — pezzi venduti ma non ancora serviti)
- **Nello scaldavivande** = pronto − evasi (piccolo, secondario)
- **Da cucinare** = vendute − pronto (GRANDE, protagonista — il cuoco guarda solo questo)

- "Da cucinare" SALE con nuovi ordini, SCENDE quando il cuoco deposita pezzi
- "Nello scaldavivande" SALE quando il cuoco deposita, SCENDE quando l'operatore evade

### Codifica colori monitor
- **Da cucinare**: verde (0), giallo (1-10), rosso (>10)
- **Nello scaldavivande**: verde (>10), giallo (1-10), rosso (0)

### Scaldavivande
- Mostra `pronto - evasi` = pezzi fisicamente presenti (scende con evasioni)
- Pulsanti −10, −5, −1, +1, +5, +10 per ogni articolo (6 pulsanti)

## Evasione ordini (regole)
L'operatore fisso chiude gli ordini dal suo tablet (layout orizzontale: lista ordini a sinistra, collassabile; tastierino a destra). La zona controllo mostra **solo ordini cassa generale** (bar e casetta esclusi). Prima di evadere, il sistema controlla i pezzi griglia nello scaldavivande:

| Situazione | Comportamento |
|---|---|
| Pezzi griglia sufficienti | Evade, scala pezzi dallo scaldavivande |
| Pezzi griglia insufficienti | BLOCCA, mostra dettaglio mancanze |
| Polenta/patate insufficienti | Evade comunque (SKIP_FULFILLMENT) |
| Ordine già evaso | Feedback giallo "Già evaso" |
| Ordine non trovato | Feedback rosso "Non trovato" |
| Solo bevande/pasta (no griglia) | Evade senza controllo scaldavivande |
| Evasione parziale | NON permessa — tutto o niente |

### Logica evasione contatori
- All'evasione, `evasi` viene incrementato per tutti i pezzi composition
- **Patate** (non sullo scaldavivande): auto-incrementa anche `pronto` → "Da cucinare" scende automaticamente
- **Polenta** (sullo scaldavivande): solo `evasi` incrementato → il cuoco gestisce `pronto` manualmente
- `SKIP_FULFILLMENT = ['patate', 'polenta']` — non bloccano l'evasione se mancano
- `AUTO_PRONTO = ['patate']` — auto-incremento pronto solo per articoli non sullo scaldavivande

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

*La comanda bevande stampa SEMPRE (anche senza bevande) per il conteggio coperti/posate — tranne ordini **asporto**.
- **Coperti** stampati sulla comanda bevande (sempre)
- **Ricevuta** mostra: subtotale, sconto, omaggio, totale, nome cliente
- **Asporto**: niente comanda bevande, ">>> ASPORTO <<<" sulla comanda cibo, coperti = 0

## Admin RECAP
Il report post-serata (`GET /api/admin/stats/recap`) include:
- Totale ordini e incasso
- Classifica vendite per piatto **raggruppata per categoria** (primo, secondo, speciale, contorno, condimento, bevanda) in **ordine alfabetico**, tutti i piatti visibili anche con venduto 0
- Distribuzione ordini per ora
- Incasso per cassa e per metodo pagamento
- Report magazzino (iniziale → venduto → rimanente)
- **Omaggi**: conteggio e valore economico reale per tipo (sponsor, don_pierino, amici)
- **Sconti**: totale sconti applicati
- **Coperti totali** della serata (esclusi annullati)
- **Ordini asporto** totali
- Ordini incompleti
- Supporta URL params: `?mode=total` (recap totale sagra), `?ids=id1,id2` (recap aggregato sessioni specifiche)

### Turni pranzo/cena
- La chiusura turno (`POST /admin/reset`) accetta `{ turno: "pranzo" | "cena" }` nel body
- Auto-detect: 05:00-15:59 = pranzo, 16:00-04:59 = cena (gestisce chiusure dopo mezzanotte)
- Pranzo e cena dello stesso giorno sono **sessioni separate** (con badge colorato nello storico)
- Chiudere lo stesso turno due volte nella stessa giornata **mergia** i dati come prima
- DB: colonna `turno` in `archived_sessions` (nullable, retrocompatibile con serate vecchie)

### Auto-chiusura turno
Lo scheduler `startAutoCloseScheduler` (avviato dopo `initApi()`) controlla periodicamente se il turno aperto ha superato l'orario di chiusura previsto. Utile quando la cassa generale chiude prima di bar/casetta e non viene fatta la chiusura manuale.
- **Pranzo** → chiusura automatica alle `AUTO_CLOSE_PRANZO_HOUR` (default 16:00) dello stesso giorno
- **Cena**   → chiusura automatica alle `AUTO_CLOSE_CENA_HOUR` (default 07:00) del giorno dopo
- Il turno è determinato dall'ora del **primo ordine** (più affidabile dell'orario attuale)
- Check periodico ogni `AUTO_CLOSE_CHECK_INTERVAL_MS` ms (default 5 minuti) + check immediato all'avvio (gestisce restart Railway dopo l'orario di chiusura)
- Ordini ancora aperti alle 7:00 → chiusi comunque e marcati come "incompleti" nel recap
- Evento Socket.IO `service_closed` con `{ autoClosed: true, turno }` broadcastato a tutti i client per notificare le casse aperte
- Tutta la logica riusa `executeReset(turno, { autoClosed: true })` — stesso identico flusso di archiviazione/snapshot della chiusura manuale

### Archivio serate
- **Selettore serate** nell'header del recap per visualizzare lo storico
- Alla chiusura turno, lo snapshot viene salvato in `archivedSessions` con il turno (pranzo/cena)
- API: `GET /api/admin/sessions` (lista serate con turno), `GET /api/admin/sessions/:id/recap` (recap archiviato)
- **Recap aggregati**: `GET /api/admin/recap/aggregate?mode=total` (totale sagra), `?ids=id1,id2` (sessioni specifiche)
- **Merge sessioni**: `POST /api/admin/sessions/merge-by-date` `{ date: "YYYY-MM-DD" }` — unisce sessioni duplicate della stessa data
- Nello storico serate: pulsante "Recap Totale Sagra" + pulsanti "Recap Weekend" automatici per ogni coppia Sab-Dom
- All'avvio, `initial_stock` da config.js viene sincronizzato al DB (se diverso)

### Export CSV
- Formato unificato in tutte le pagine (recap, serate, chiusura): separatore `;`, BOM UTF-8, `sep=;` per Excel
- Classifica vendite raggruppata per categoria con header sezione, ordine alfabetico, piatti a venduto 0 inclusi
- Sezioni: RIEPILOGO, INCASSO PER CASSA, METODO PAGAMENTO (lordo/commissioni/netto), OMAGGI DETTAGLIO, CLASSIFICA VENDITE

### Riconciliazione POS (import CSV SumUp)
Permette di correggere a posteriori gli ordini erroneamente segnati come contanti, importando il CSV transazioni di SumUp. Pensato per essere fatto **con calma il lunedì dopo il weekend** (un solo CSV può coprire tutto il weekend).
- **UI**: pulsante "Riconcilia POS" nell'header di `/admin/serate` → modal con upload CSV (drag&drop o paste) + preview match + apply
- **Parser CSV**: auto-detect del separatore (`,` `;` `\t`), auto-detect colonne (supporta export EN e IT), gestisce importi formato europeo (1.234,56) e US (1,234.56), filtra rimborsi e transazioni fallite
- **Matching**: per ogni transazione SumUp, cerca ordini con stesso importo (tolleranza 1 cent) entro ±5 min dall'orario SumUp
  - **Certain**: 1 solo candidato → spunta auto
  - **Ambiguous**: più candidati → utente sceglie dal dropdown (default: ordine più vicino temporalmente)
  - **None**: nessun candidato → orfano (ignorato)
- **Apply**: aggiorna lo snapshot `_orders` dentro `archived_sessions.recap`, ricalcola `revenueByPayment` e `posCommission`, salva nel DB. Marca la sessione con `_reconciledAt`
- **Prerequisito**: lo snapshot ordini (`recap._orders`) deve esistere nell'archivio. Sessioni chiuse PRIMA di questa feature non hanno lo snapshot — l'apply ritorna errore con messaggio chiaro
- **API**:
  - `POST /api/admin/reconcile-pos/preview` `{ csv, windowMinutes? }` → ritorna `{ transactions, sessions: [{ proposals: [...] }], orphans }`
  - `POST /api/admin/reconcile-pos/apply` `{ confirmations: [{ sessionId, orderId, transactionId }] }` → ritorna `{ updatedOrders, updatedSessions, errors }`
- **DB**: colonna `sumup_transaction_id` su `orders` (per ordini live) + campo `sumup_transaction_id` dentro ogni elemento di `recap._orders` (per snapshot archiviati)

## Layout casse
Tutte e tre le casse usano il **layout a due pannelli**:
- **Sinistra**: area menu con piatti/bevande e stepper quantità
- **Destra**: colonna ordine con form, riepilogo, totale e bottone ORDINA
- Responsive: sotto 700px si impila verticalmente
- **Bar**: colonne verticali per sotto-gruppo bevande (Vini / Birra & Bottiglie / Acqua & Bibite / Caffè & Dolci)
- **Casetta**: righe orizzontali per macro-categoria (Cibo / Bevande), colonna ordine 280px, ottimizzata iPad landscape
- **Bar e Casetta**: niente note prodotto nel riepilogo ordine, niente alert sonoro stampanti
- **Wake Lock**: tutte le pagine operative impediscono il blocco schermo (wakelock.js)

| Cassa | Layout menu | Campi ordine | Source |
|---|---|---|---|
| Generale | CIBO / BEVANDE / ORDINI (tab) | Nome, Tavolo, Coperti, Asporto, POS, Omaggi, Sconto | `principale` |
| Bar | Colonne verticali per sotto-gruppo | Nome, POS | `bar` |
| Casetta | Righe orizzontali (Cibo / Bevande) | Nome, POS | `casetta` |

## Rilevamento offline
- Socket.IO configurato con `pingInterval: 3000, pingTimeout: 5000` — disconnessione rilevata in ~5 secondi
- Tutte le pagine operative (casse, monitor, scaldavivande, controllo) mostrano banner rosso "CONNESSIONE PERSA"
- Il monitor TV mostra overlay a tutto schermo quando disconnesso
- Tastierini e pulsanti disabilitati durante la disconnessione

## Zona Controllo (controllo.html)
- **Layout orizzontale** ottimizzato per tablet in landscape
- **Sinistra**: lista ordini aperti (scrollabile, collassabile con pulsante toggle)
- **Destra**: tastierino numerico per evasione ordini
- Pulsante toggle per nascondere la lista ordini e dare più spazio al tastierino

## Convenzioni codice
- Tutti i file frontend sono HTML vanilla con JS inline (no build step)
- Il design usa font Outfit + JetBrains Mono, sfondo scuro (#060a12), accento verde (#4ecca3)
- Usare `/frontend-design` per qualsiasi nuova pagina o modifica UI
- I commenti nel codice sono in italiano per le parti complesse
- Ogni ordine include `source` (principale/bar/casetta) e `coperti` (numero posate)
- **PJAX**: la sidebar wrappa gli script delle pagine admin in IIFE. Le funzioni usate in attributi HTML `onclick` **devono** essere esportate su `window` (es. `window.myFunc = myFunc;`) — altrimenti non funzionano dopo navigazione via sidebar
- **Concorrenza ordini**: la creazione ordini è serializzata con un mutex (promise chain) per evitare race condition sul contatore con 3 casse simultanee
- **DB**: pool PostgreSQL a 20 connessioni, scrittura ordini con `await` (dato critico), resto fire-and-forget
- Il documento tecnico completo è in `SagrApp_Claude_Code_v4.5.md` (aggiornato al 30/04/2026)

## Comandi
```bash
node server/index.js    # Avvia il server (porta 3000)
node print-proxy/index.js  # Avvia il print proxy locale
```

## Sistema di accesso (PIN)
| PIN | Ruolo | Destinazione |
|---|---|---|
| 1959 | Admin | `/admin` + sidebar completa |
| 1102 | Cassa Generale | `/cassa` direttamente |
| 0002 | Operatore | Scelta: Cassa Bar / Casetta / Scaldavivande / Zona Controllo / Monitor Cuochi |
| (nessuno) | Monitor Cuochi | `/monitor` — accesso anche diretto via URL, nessun PIN |

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
- `/monitor` — Monitor cuochi griglia TV (accesso diretto, no PIN)
- `/monitor-cucina` — Monitor cucina/friggitrice TV (accesso diretto, no PIN) — solo patate fritte (gnocchi/funghi previsti)
- `/scaldavivande` — Tablet scaldavivande (PIN 0002 → scelta ruolo)
- `/controllo` — Tablet operatore fisso (PIN 0002 → scelta ruolo)
- `/setup` — Wizard setup inizio turno (legacy, pre-flight check ora in `/admin/hardware`)
- `/admin` — Dashboard admin LIVE (PIN 0000)
- `/admin/recap` — Report post-serata (admin)
- `/admin/magazzino` — Magazzino materiali e consumabili (admin)
- `/admin/hardware` — Pannello controllo hardware (admin)
- `/admin/menu` — Gestione menu e scorte (admin) — piatti, prezzi, scorte, disponibilità casse, composizione
- `/admin/serate` — Storico serate archiviate con confronto dati e download report (admin)
- `/admin/chiusura` — Procedura chiusura turno con download report + reset dati (admin)

# SagrApp — Gestione Ordini Sagra M.D.G.

## Cosa fa
Sistema di gestione ordini per una sagra di paese (500-1000 coperti). Web app cloud-based con stampa termica, monitor cuochi in tempo reale, e tablet per scaldavivande e zona controllo.

## Stack
- **Backend:** Node.js + Express + Socket.IO
- **Database:** In-memory (SQLite previsto per produzione)
- **Frontend:** HTML/CSS/JS vanilla + Socket.IO client (no framework)
- **Stampa:** ESC/POS raw via TCP porta 9100 su stampanti LAN
- **Deploy:** Railway (auto-deploy da GitHub `main`)
- **URL produzione:** https://web-production-4fa18.up.railway.app
- **Dev locale:** `node server/index.js` → http://localhost:3000

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
  index.html        # Landing page selezione ruolo
  cassa.html        # Cassa ordini — layout 2 colonne come foglio cartaceo
  cassa-bar.html    # Cassa bar (solo bevande)
  cassa-casetta.html # Cassa casetta aperitivi
  monitor.html      # Monitor TV cuochi (3 colonne: da cucinare/pronto/vendute)
  scaldavivande.html # Tablet scaldavivande (+10/+20/+30/+40/+50)
  controllo.html    # Tablet zona controllo (tastierino evasione ordini)
  admin.html        # Dashboard admin LIVE
  admin-login.html  # Login admin PIN
  admin-recap.html  # Report post-serata (con omaggi e sconti)
  admin-magazzino.html # Gestione scorte
  admin-hardware.html  # Pannello controllo hardware
  admin-chiusura.html  # Procedura chiusura turno
  setup.html        # Wizard setup inizio turno
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

## Menu e composizione piatti
- Il menu reale è in `config.js` → `MENU` (42 piatti)
- Categorie: primo, secondo, speciale, contorno, condimento, bevanda
- Postazioni: cucina, piastra, griglia, polenta, bar, speciali
- I piatti griglia hanno `composition` che li scompone in pezzi singoli per il monitor cuochi
- Esempio: "Costicine con polenta" → costicine: 3 pezzi + polenta: 1 porzione
- I piatti speciali (`special: true`) hanno **doppia stampa**: comanda cibo (.205) + stampante dedicata (.207)
- I piatti speciali hanno `available_date` — uno diverso per ogni serata della sagra

## Interfaccia cassa (cassa.html)
- **Layout a due colonne** che replica il foglio cartaceo `2025_sagra_COMANDA.pdf`
- Colonna SX: primi → secondi → speciale del giorno → condimenti
- Colonna DX: contorni → bevande (raggruppate)
- Separatori `---` tra gruppi
- Campi ordine:
  - **Nome cliente** (opzionale, testo)
  - **Tavolo** (obbligatorio, numerico)
  - **Coperti** (obbligatorio, numerico) — stampati sulla comanda bevande (per le posate)
  - **Sconto** (opzionale, € o %)
  - **Flag gratis** (toggle, uno solo alla volta): Sponsor | Don Pierino | Amici
- Quando un flag gratis è attivo: totale = €0, ma ordine registrato, stampato, scorte scalate normalmente
- Il piatto speciale del giorno è visibile solo se `available_date` corrisponde alla data corrente

## Monitor cuochi
Traccia 6 articoli in pezzi singoli: costicine, salsicce, sovracoscia, pastin, polenta, patate.
3 colonne: **Da cucinare** (vendute − pronto) | **Pronto** (dallo scaldavivande) | **Vendute** (dagli ordini).

## Logica stampa ordini
| Contenuto | Ricevuta (.203) | Cibo (.205) | Bevande (.204) | Speciali (.207) |
|---|---|---|---|---|
| Solo cibo | si | si | — | — |
| Solo bevande | si | — | si | — |
| Cibo + bevande | si | si | si | — |
| Con piatto speciale | si | si (con speciale) | se bevande | si (solo speciale) |

- **Coperti** stampati sulla comanda bevande; se non ci sono bevande, sulla comanda cibo
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

## Convenzioni codice
- Tutti i file frontend sono HTML vanilla con JS inline (no build step)
- Il design usa font Outfit + JetBrains Mono, sfondo scuro (#060a12), accento verde (#4ecca3)
- Usare `/frontend-design` per qualsiasi nuova pagina o modifica UI
- I commenti nel codice sono in italiano per le parti complesse
- Il documento tecnico completo è in `SagrApp_Claude_Code_v3.md`

## Comandi
```bash
node server/index.js    # Avvia il server (porta 3000)
node print-proxy/index.js  # Avvia il print proxy locale
```

## Pagine disponibili
- `/` — Selezione ruolo
- `/cassa` — Cassa ordini (layout 2 colonne)
- `/cassa-bar` — Cassa bar (solo bevande)
- `/cassa-casetta` — Cassa casetta aperitivi
- `/monitor` — Monitor cuochi (TV)
- `/scaldavivande` — Tablet scaldavivande
- `/controllo` — Zona controllo evasione ordini
- `/test` — Dashboard test hardware
- `/setup` — Wizard setup inizio turno
- `/admin/login` — Login admin (PIN: 1234)
- `/admin` — Dashboard admin LIVE
- `/admin/recap` — Report post-serata
- `/admin/magazzino` — Gestione scorte
- `/admin/hardware` — Pannello controllo hardware
- `/admin/chiusura` — Procedura chiusura turno

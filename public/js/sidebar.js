/**
 * SagrApp — Sidebar navigazione globale
 * Incluso in tutte le pagine. Genera il DOM della sidebar, evidenzia la voce attiva,
 * gestisce apertura/chiusura (salvata in localStorage), e controlla accesso admin via PIN.
 */
(function () {
  'use strict';

  // Gruppi e voci della sidebar
  const NAV_GROUPS = [
    {
      label: 'Operatività',
      items: [
        { name: 'Cassa Generale', url: '/cassa', icon: '🛒' },
        { name: 'Cassa Bar', url: '/cassa-bar', icon: '🍺' },
        { name: 'Cassa Casetta', url: '/cassa-casetta', icon: '🏠' },
      ],
    },
    {
      label: 'Cucina',
      items: [
        { name: 'Monitor Cuochi', url: '/monitor', icon: '📺' },
        { name: 'Scaldavivande', url: '/scaldavivande', icon: '🔥' },
      ],
    },
    {
      label: 'Servizio',
      items: [
        { name: 'Operatore Fisso', url: '/controllo', icon: '📋' },
      ],
    },
    {
      label: 'Admin',
      locked: true,
      items: [
        { name: 'Dashboard Live', url: '/admin', icon: '📊' },
        { name: 'Dashboard Recap', url: '/admin/recap', icon: '📈' },
        { name: 'Magazzino', url: '/admin/magazzino', icon: '📦' },
        { name: 'Controllo Hardware', url: '/admin/hardware', icon: '🔧' },
        { name: 'Setup Turno', url: '/setup', icon: '⚙️' },
        { name: 'Chiusura Turno', url: '/admin/chiusura', icon: '🔒' },
      ],
    },
  ];

  // Pagine dove la sidebar è nascosta di default (schermo pieno per dati)
  const HIDDEN_BY_DEFAULT = ['/monitor', '/scaldavivande'];

  const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

  // Controlla se la pagina attuale è tra quelle dove la sidebar è nascosta
  const isHiddenPage = HIDDEN_BY_DEFAULT.some(p => currentPath === p);

  // Stato sidebar: leggi da localStorage, default aperto (tranne per pagine nascoste)
  const STORAGE_KEY = 'sagrapp_sidebar_open';
  let sidebarOpen = isHiddenPage ? false : (localStorage.getItem(STORAGE_KEY) !== 'false');

  // Controlla se l'utente è admin (ha token in sessionStorage)
  function isAdminLogged() {
    return !!sessionStorage.getItem('admin_token');
  }

  // Inietta CSS per la sidebar
  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'sagrapp-sidebar-css';
    style.textContent = `
      /* ===== SIDEBAR ===== */
      .sa-sidebar {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: 220px;
        background: #0a0e17;
        border-right: 1px solid rgba(255,255,255,0.06);
        z-index: 500;
        display: flex;
        flex-direction: column;
        transform: translateX(0);
        transition: transform 250ms ease, width 250ms ease;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
      }

      .sa-sidebar.collapsed {
        transform: translateX(-220px);
      }

      /* Sposta il contenuto principale quando la sidebar è aperta */
      .sa-page-content {
        margin-left: 220px;
        transition: margin-left 250ms ease;
        min-height: 100vh;
      }

      .sa-page-content.sidebar-collapsed {
        margin-left: 0;
      }

      /* ===== HEADER SIDEBAR ===== */
      .sa-sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        flex-shrink: 0;
      }

      .sa-sidebar-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
      }

      .sa-sidebar-brand-icon {
        width: 28px;
        height: 28px;
        background: #4ecca3;
        color: #060a12;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 14px;
        font-family: 'Outfit', sans-serif;
      }

      .sa-sidebar-brand-text {
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: 16px;
        color: #e2e8f0;
        letter-spacing: -0.02em;
      }

      /* ===== TOGGLE BUTTON (hamburger) ===== */
      .sa-sidebar-toggle {
        position: fixed;
        top: 10px;
        left: 10px;
        z-index: 510;
        width: 36px;
        height: 36px;
        background: rgba(10, 14, 23, 0.9);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        color: #94a3b8;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 200ms ease;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        backdrop-filter: blur(8px);
      }

      .sa-sidebar-toggle:hover {
        background: rgba(10, 14, 23, 1);
        color: #e2e8f0;
        border-color: rgba(255,255,255,0.2);
      }

      .sa-sidebar-toggle.open {
        left: 226px;
      }

      /* ===== NAV GROUPS ===== */
      .sa-nav {
        flex: 1;
        padding: 8px 0;
      }

      .sa-nav-group {
        margin-bottom: 4px;
      }

      .sa-nav-group-label {
        padding: 10px 16px 4px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #64748b;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .sa-nav-group-label .lock-icon {
        font-size: 10px;
        opacity: 0.6;
      }

      .sa-nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        color: #94a3b8;
        text-decoration: none;
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        font-weight: 500;
        border-left: 3px solid transparent;
        transition: all 150ms ease;
        cursor: pointer;
        min-height: 44px;
        -webkit-tap-highlight-color: transparent;
      }

      .sa-nav-item:hover {
        background: rgba(255,255,255,0.03);
        color: #e2e8f0;
      }

      .sa-nav-item.active {
        background: rgba(78, 204, 163, 0.06);
        color: #4ecca3;
        border-left-color: #4ecca3;
        font-weight: 600;
      }

      .sa-nav-item-icon {
        font-size: 15px;
        width: 22px;
        text-align: center;
        flex-shrink: 0;
      }

      /* ===== FOOTER: cambia ruolo ===== */
      .sa-sidebar-footer {
        padding: 12px 16px;
        border-top: 1px solid rgba(255,255,255,0.06);
        flex-shrink: 0;
      }

      .sa-change-role {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 6px;
        color: #64748b;
        font-family: 'Outfit', sans-serif;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 150ms ease;
        width: 100%;
        text-decoration: none;
        text-align: left;
      }

      .sa-change-role:hover {
        background: rgba(255,255,255,0.06);
        color: #94a3b8;
      }

      /* ===== RESPONSIVE: su schermi piccoli la sidebar va sopra ===== */
      @media (max-width: 768px) {
        .sa-sidebar {
          width: 260px;
        }
        .sa-page-content {
          margin-left: 0 !important;
        }
        .sa-sidebar:not(.collapsed) ~ .sa-page-content {
          /* Overlay scuro dietro la sidebar su mobile */
        }
        .sa-sidebar-toggle.open {
          left: 266px;
        }
        /* Overlay quando sidebar aperta su mobile */
        .sa-sidebar-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 490;
          opacity: 0;
          pointer-events: none;
          transition: opacity 250ms ease;
        }
        .sa-sidebar-overlay.visible {
          opacity: 1;
          pointer-events: auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Costruisce il DOM della sidebar
  function buildSidebar() {
    // Overlay mobile
    const overlay = document.createElement('div');
    overlay.className = 'sa-sidebar-overlay';
    overlay.id = 'saSidebarOverlay';
    overlay.addEventListener('click', toggleSidebar);
    document.body.appendChild(overlay);

    // Sidebar container
    const sidebar = document.createElement('nav');
    sidebar.className = 'sa-sidebar' + (sidebarOpen ? '' : ' collapsed');
    sidebar.id = 'saSidebar';

    // Header con logo
    sidebar.innerHTML = `
      <div class="sa-sidebar-header">
        <a href="/" class="sa-sidebar-brand">
          <span class="sa-sidebar-brand-icon">S</span>
          <span class="sa-sidebar-brand-text">SagrApp</span>
        </a>
      </div>
      <div class="sa-nav" id="saNav"></div>
      <div class="sa-sidebar-footer">
        <a href="/" class="sa-change-role" onclick="localStorage.removeItem('sagrapp_role')">
          ↩ Cambia ruolo
        </a>
      </div>
    `;

    document.body.insertBefore(sidebar, document.body.firstChild);

    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'sa-sidebar-toggle' + (sidebarOpen ? ' open' : '');
    toggleBtn.id = 'saSidebarToggle';
    toggleBtn.innerHTML = '☰';
    toggleBtn.addEventListener('click', toggleSidebar);
    document.body.appendChild(toggleBtn);

    // Popola le voci di navigazione
    const nav = document.getElementById('saNav');
    NAV_GROUPS.forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'sa-nav-group';

      const labelEl = document.createElement('div');
      labelEl.className = 'sa-nav-group-label';
      labelEl.innerHTML = group.label + (group.locked ? ' <span class="lock-icon">🔒</span>' : '');
      groupEl.appendChild(labelEl);

      group.items.forEach(item => {
        const link = document.createElement('a');
        link.className = 'sa-nav-item';
        // Evidenzia voce attiva
        const itemPath = item.url.replace(/\/$/, '') || '/';
        if (currentPath === itemPath) {
          link.classList.add('active');
        }
        link.innerHTML = `<span class="sa-nav-item-icon">${item.icon}</span> ${item.name}`;

        // Gestione click: se admin e non loggato → redirect login
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (group.locked && !isAdminLogged()) {
            // Salva la destinazione per redirect post-login
            sessionStorage.setItem('admin_redirect', item.url);
            window.location.href = '/admin/login';
          } else {
            window.location.href = item.url;
          }
        });

        groupEl.appendChild(link);
      });

      nav.appendChild(groupEl);
    });

    // Wrappa il contenuto esistente in .sa-page-content
    wrapPageContent();

    // Aggiorna overlay mobile
    updateOverlay();
  }

  // Wrappa tutto il contenuto della pagina (tranne sidebar e toggle) in un div
  function wrapPageContent() {
    const wrapper = document.createElement('div');
    wrapper.className = 'sa-page-content' + (sidebarOpen ? '' : ' sidebar-collapsed');
    wrapper.id = 'saPageContent';

    // Sposta tutti i children del body (tranne sidebar, toggle, overlay) nel wrapper
    const sidebar = document.getElementById('saSidebar');
    const toggle = document.getElementById('saSidebarToggle');
    const overlayEl = document.getElementById('saSidebarOverlay');

    const children = Array.from(document.body.childNodes);
    children.forEach(child => {
      if (child !== sidebar && child !== toggle && child !== overlayEl && child.id !== 'sagrapp-sidebar-css') {
        wrapper.appendChild(child);
      }
    });

    document.body.appendChild(wrapper);
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    localStorage.setItem(STORAGE_KEY, sidebarOpen);

    const sidebar = document.getElementById('saSidebar');
    const toggle = document.getElementById('saSidebarToggle');
    const content = document.getElementById('saPageContent');

    sidebar.classList.toggle('collapsed', !sidebarOpen);
    toggle.classList.toggle('open', sidebarOpen);
    content.classList.toggle('sidebar-collapsed', !sidebarOpen);

    updateOverlay();
  }

  function updateOverlay() {
    const overlay = document.getElementById('saSidebarOverlay');
    if (!overlay) return;
    // Solo su mobile
    if (window.innerWidth <= 768 && sidebarOpen) {
      overlay.classList.add('visible');
    } else {
      overlay.classList.remove('visible');
    }
  }

  // Resize handler per overlay
  window.addEventListener('resize', updateOverlay);

  // Init quando DOM pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    injectStyles();
    buildSidebar();
  }
})();

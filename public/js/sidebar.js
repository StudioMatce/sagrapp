/**
 * SagrApp — Sidebar navigazione globale (SOLO ADMIN)
 * Incluso solo nelle pagine admin. L'admin ha gia' fatto login con PIN 0000.
 * Genera il DOM della sidebar, evidenzia la voce attiva, gestisce apertura/chiusura.
 */
(function () {
  'use strict';

  // Gruppi e voci della sidebar
  var NAV_GROUPS = [
    {
      label: 'Operativit\u00e0',
      items: [
        { name: 'Cassa Generale', url: '/cassa', icon: '\uD83D\uDED2' },
        { name: 'Cassa Bar', url: '/cassa-bar', icon: '\uD83C\uDF7A' },
        { name: 'Cassa Casetta', url: '/cassa-casetta', icon: '\uD83C\uDFE0' },
      ],
    },
    {
      label: 'Cucina',
      items: [
        { name: 'Monitor Cuochi', url: '/monitor', icon: '\uD83D\uDCFA' },
        { name: 'Scaldavivande', url: '/scaldavivande', icon: '\uD83D\uDD25' },
      ],
    },
    {
      label: 'Servizio',
      items: [
        { name: 'Operatore Fisso', url: '/controllo', icon: '\uD83D\uDCCB' },
      ],
    },
    {
      label: 'Admin',
      items: [
        { name: 'Dashboard Live', url: '/admin', icon: '\uD83D\uDCCA' },
        { name: 'Dashboard Recap', url: '/admin/recap', icon: '\uD83D\uDCC8' },
        { name: 'Gestione Menu', url: '/admin/menu', icon: '\uD83D\uDCCB' },
        { name: 'Magazzino', url: '/admin/magazzino', icon: '\uD83D\uDCE6' },
        { name: 'Controllo Hardware', url: '/admin/hardware', icon: '\uD83D\uDD27' },
        { name: 'Setup Turno', url: '/setup', icon: '\u2699\uFE0F' },
        { name: 'Chiusura Turno', url: '/admin/chiusura', icon: '\uD83D\uDD12' },
      ],
    },
  ];

  var currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  var STORAGE_KEY = 'sagrapp_sidebar_open';
  var sidebarOpen = localStorage.getItem(STORAGE_KEY) !== 'false';

  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'sagrapp-sidebar-css';
    style.textContent = '\
      .sa-sidebar {\
        position: fixed; top: 0; left: 0; bottom: 0; width: 220px;\
        background: #0a0e17; border-right: 1px solid rgba(255,255,255,0.06);\
        z-index: 500; display: flex; flex-direction: column;\
        transform: translateX(0); transition: transform 250ms ease;\
        overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch;\
      }\
      .sa-sidebar.collapsed { transform: translateX(-220px); }\
      .sa-page-content {\
        margin-left: 220px; transition: margin-left 250ms ease; min-height: 100vh;\
      }\
      .sa-page-content.sidebar-collapsed { margin-left: 0; padding-left: 52px; }\
      .sa-sidebar-header {\
        display: flex; align-items: center; justify-content: space-between;\
        padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;\
      }\
      .sa-sidebar-brand {\
        display: flex; align-items: center; gap: 8px; text-decoration: none;\
      }\
      .sa-sidebar-brand-icon {\
        width: 28px; height: 28px; background: #4ecca3; color: #060a12;\
        border-radius: 5px; display: flex; align-items: center; justify-content: center;\
        font-weight: 800; font-size: 14px; font-family: "Outfit", sans-serif;\
      }\
      .sa-sidebar-brand-text {\
        font-family: "Outfit", sans-serif; font-weight: 700; font-size: 16px;\
        color: #e2e8f0; letter-spacing: -0.02em;\
      }\
      .sa-sidebar-toggle {\
        position: fixed; top: 10px; left: 10px; z-index: 510;\
        width: 36px; height: 36px; background: rgba(10,14,23,0.9);\
        border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;\
        color: #94a3b8; font-size: 18px; cursor: pointer;\
        display: flex; align-items: center; justify-content: center;\
        transition: all 200ms ease; touch-action: manipulation;\
        -webkit-tap-highlight-color: transparent; backdrop-filter: blur(8px);\
      }\
      .sa-sidebar-toggle:hover {\
        background: rgba(10,14,23,1); color: #e2e8f0; border-color: rgba(255,255,255,0.2);\
      }\
      .sa-sidebar-toggle.open { left: 226px; }\
      .sa-nav { flex: 1; padding: 8px 0; }\
      .sa-nav-group { margin-bottom: 4px; }\
      .sa-nav-group-label {\
        padding: 10px 16px 4px; font-family: "JetBrains Mono", monospace;\
        font-size: 10px; font-weight: 700; text-transform: uppercase;\
        letter-spacing: 0.1em; color: #64748b;\
      }\
      .sa-nav-item {\
        display: flex; align-items: center; gap: 10px; padding: 10px 16px;\
        color: #94a3b8; text-decoration: none; font-family: "Outfit", sans-serif;\
        font-size: 13px; font-weight: 500; border-left: 3px solid transparent;\
        transition: all 150ms ease; cursor: pointer; min-height: 44px;\
        -webkit-tap-highlight-color: transparent;\
      }\
      .sa-nav-item:hover { background: rgba(255,255,255,0.03); color: #e2e8f0; }\
      .sa-nav-item.active {\
        background: rgba(78,204,163,0.06); color: #4ecca3;\
        border-left-color: #4ecca3; font-weight: 600;\
      }\
      .sa-nav-item-icon { font-size: 15px; width: 22px; text-align: center; flex-shrink: 0; }\
      .sa-sidebar-footer {\
        padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;\
      }\
      .sa-change-role {\
        display: flex; align-items: center; gap: 8px; padding: 8px 12px;\
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);\
        border-radius: 6px; color: #64748b; font-family: "Outfit", sans-serif;\
        font-size: 12px; font-weight: 500; cursor: pointer; transition: all 150ms ease;\
        width: 100%; text-decoration: none; text-align: left;\
      }\
      .sa-change-role:hover { background: rgba(255,255,255,0.06); color: #94a3b8; }\
      @media (max-width: 768px) {\
        .sa-sidebar { width: 260px; }\
        .sa-page-content { margin-left: 0 !important; }\
        .sa-sidebar-toggle.open { left: 266px; }\
        .sa-sidebar-overlay {\
          position: fixed; inset: 0; background: rgba(0,0,0,0.5);\
          z-index: 490; opacity: 0; pointer-events: none; transition: opacity 250ms ease;\
        }\
        .sa-sidebar-overlay.visible { opacity: 1; pointer-events: auto; }\
      }\
    ';
    document.head.appendChild(style);
  }

  function buildSidebar() {
    // Overlay mobile
    var overlay = document.createElement('div');
    overlay.className = 'sa-sidebar-overlay';
    overlay.id = 'saSidebarOverlay';
    overlay.addEventListener('click', toggleSidebar);
    document.body.appendChild(overlay);

    // Sidebar container
    var sidebar = document.createElement('nav');
    sidebar.className = 'sa-sidebar' + (sidebarOpen ? '' : ' collapsed');
    sidebar.id = 'saSidebar';

    sidebar.innerHTML =
      '<div class="sa-sidebar-header">' +
        '<a href="/admin" class="sa-sidebar-brand">' +
          '<span class="sa-sidebar-brand-icon">S</span>' +
          '<span class="sa-sidebar-brand-text">SagrApp</span>' +
        '</a>' +
      '</div>' +
      '<div class="sa-nav" id="saNav"></div>' +
      '<div class="sa-sidebar-footer">' +
        '<a href="/" class="sa-change-role" id="saLogout">\u21A9 Esci</a>' +
      '</div>';

    document.body.insertBefore(sidebar, document.body.firstChild);

    // Logout: cancella tutto e torna al login
    document.getElementById('saLogout').addEventListener('click', function(e) {
      e.preventDefault();
      localStorage.removeItem('sagrapp_role');
      sessionStorage.removeItem('sagrapp_token');
      sessionStorage.removeItem('admin_token');
      window.location.href = '/';
    });

    // Toggle button
    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'sa-sidebar-toggle' + (sidebarOpen ? ' open' : '');
    toggleBtn.id = 'saSidebarToggle';
    toggleBtn.innerHTML = '\u2630';
    toggleBtn.addEventListener('click', toggleSidebar);
    document.body.appendChild(toggleBtn);

    // Popola le voci di navigazione
    var nav = document.getElementById('saNav');
    NAV_GROUPS.forEach(function(group) {
      var groupEl = document.createElement('div');
      groupEl.className = 'sa-nav-group';

      var labelEl = document.createElement('div');
      labelEl.className = 'sa-nav-group-label';
      labelEl.textContent = group.label;
      groupEl.appendChild(labelEl);

      group.items.forEach(function(item) {
        var link = document.createElement('a');
        link.className = 'sa-nav-item';
        link.href = item.url;
        var itemPath = item.url.replace(/\/$/, '') || '/';
        if (currentPath === itemPath) {
          link.classList.add('active');
        }
        link.innerHTML = '<span class="sa-nav-item-icon">' + item.icon + '</span> ' + item.name;
        groupEl.appendChild(link);
      });

      nav.appendChild(groupEl);
    });

    // Wrappa il contenuto esistente
    wrapPageContent();
    updateOverlay();
  }

  function wrapPageContent() {
    var wrapper = document.createElement('div');
    wrapper.className = 'sa-page-content' + (sidebarOpen ? '' : ' sidebar-collapsed');
    wrapper.id = 'saPageContent';

    var sidebar = document.getElementById('saSidebar');
    var toggle = document.getElementById('saSidebarToggle');
    var overlayEl = document.getElementById('saSidebarOverlay');

    var children = Array.from(document.body.childNodes);
    children.forEach(function(child) {
      if (child !== sidebar && child !== toggle && child !== overlayEl && child.id !== 'sagrapp-sidebar-css') {
        wrapper.appendChild(child);
      }
    });

    document.body.appendChild(wrapper);
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    localStorage.setItem(STORAGE_KEY, sidebarOpen);

    document.getElementById('saSidebar').classList.toggle('collapsed', !sidebarOpen);
    document.getElementById('saSidebarToggle').classList.toggle('open', sidebarOpen);
    document.getElementById('saPageContent').classList.toggle('sidebar-collapsed', !sidebarOpen);
    updateOverlay();
  }

  function updateOverlay() {
    var overlay = document.getElementById('saSidebarOverlay');
    if (!overlay) return;
    if (window.innerWidth <= 768 && sidebarOpen) {
      overlay.classList.add('visible');
    } else {
      overlay.classList.remove('visible');
    }
  }

  window.addEventListener('resize', updateOverlay);

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

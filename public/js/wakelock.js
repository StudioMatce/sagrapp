// Impedisce il blocco schermo sui tablet usando la Wake Lock API
// Supportato su Safari iOS 16.4+, Chrome, Edge
// NOTA: alcune piattaforme negano il wake lock se richiesto prima di
// un'interazione utente. Ritentiamo anche su touch/click per gestire
// quel caso, e su visibilitychange per riacquisirlo dopo un blocco.
(function() {
  var wakeLock = null;
  var requesting = false;

  async function requestWakeLock() {
    if (wakeLock || requesting) return;
    if (!('wakeLock' in navigator)) {
      console.warn('[WakeLock] API non supportata su questo browser');
      return;
    }
    requesting = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[WakeLock] attivo');
      wakeLock.addEventListener('release', function() {
        wakeLock = null;
        console.log('[WakeLock] rilasciato');
      });
    } catch (e) {
      console.warn('[WakeLock] richiesta negata:', e.message);
    } finally {
      requesting = false;
    }
  }

  // Tentativo immediato al caricamento (può fallire se senza user gesture)
  requestWakeLock();

  // Ritenta al primo touch/click (gesto utente garantito)
  ['touchstart', 'click'].forEach(function(evt) {
    document.addEventListener(evt, requestWakeLock, { passive: true });
  });

  // Riacquisisci quando la pagina torna visibile (dopo blocco o tab switch)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
})();

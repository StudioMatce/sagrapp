// Impedisce il blocco schermo sui tablet usando la Wake Lock API
// Supportato su Safari iOS 16.4+, Chrome, Edge
(function() {
  var wakeLock = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', function() { wakeLock = null; });
      }
    } catch (e) { /* Wake Lock non disponibile o negato */ }
  }

  // Richiedi al caricamento
  requestWakeLock();

  // Riacquisisci quando la pagina torna visibile (dopo tab switch o blocco manuale)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
})();

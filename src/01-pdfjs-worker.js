  /* ============================================================
     1. PDF.js Worker 初始化
     ============================================================ */
  if (typeof pdfjsLib !== 'undefined') {
    const embeddedWorkerEl = document.getElementById('pdfWorkerCode');
    if (embeddedWorkerEl && embeddedWorkerEl.textContent.trim()) {
      try {
        const workerBlob = new Blob([embeddedWorkerEl.textContent], { type: 'application/javascript' });
        pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
      } catch (e) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
      }
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
    }
  }


// Draws one page of an uploaded PDF (or an uploaded picture) as a JPEG, with its white margins cut off.
// Loaded once; the PDF library itself is only fetched the first time a lecture really uses a figure.
(function () {
  const docs = new Map();
  async function pdf(bytes) {
    const base = new URL('pdfjs/', document.baseURI).href;
    const lib = await import(base + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    const id = bytes.length + ':' + bytes[0] + ':' + bytes[bytes.length - 1];
    if (!docs.has(id)) docs.set(id, await lib.getDocument({ data: bytes.slice() }).promise);
    return docs.get(id);
  }
  function trim(c) {
    const g = c.getContext('2d'), w = c.width, h = c.height, d = g.getImageData(0, 0, w, h).data;
    let l = w, r = 0, t = h, b = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) {
        if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
      }
    }
    if (r - l < 40 || b - t < 40) return c;
    const pad = 12;
    l = Math.max(0, l - pad); t = Math.max(0, t - pad); r = Math.min(w, r + pad); b = Math.min(h, b + pad);
    const o = document.createElement('canvas');
    o.width = r - l; o.height = b - t;
    o.getContext('2d').drawImage(c, l, t, r - l, b - t, 0, 0, r - l, b - t);
    return o;
  }
  window.zakerFigure = async function (bytes, mime, page) {
    try {
      const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
      if (mime === 'application/pdf') {
        const d = await pdf(bytes);
        if (page < 1 || page > d.numPages) return null;
        const p = await d.getPage(page), v1 = p.getViewport({ scale: 1 });
        const v = p.getViewport({ scale: Math.min(3, 1300 / Math.max(v1.width, v1.height)) });
        c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: g, viewport: v }).promise;
      } else {
        const b = await createImageBitmap(new Blob([bytes], { type: mime }));
        const s = Math.min(1, 1300 / Math.max(b.width, b.height));
        c.width = Math.ceil(b.width * s); c.height = Math.ceil(b.height * s);
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(b, 0, 0, c.width, c.height);
      }
      return trim(c).toDataURL('image/jpeg', 0.8).split(',')[1];
    } catch (e) {
      console.warn('figure failed');
      return null;
    }
  };
})();

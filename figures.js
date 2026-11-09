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
  let recorder = null, chunks = [], stream = null, player = null;
  window.zakerRecStart = async function () {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      recorder.start();
      return true;
    } catch (e) { return false; }
  };
  window.zakerRecStop = function () {
    return new Promise(function (done) {
      if (!recorder) return done(null);
      recorder.onstop = async function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        const type = (recorder.mimeType || 'audio/webm').split(';')[0];
        const b = new Uint8Array(await new Blob(chunks, { type: type }).arrayBuffer());
        let bin = '';
        for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
        recorder = null;
        done(type + '|' + btoa(bin));
      };
      recorder.stop();
    });
  };
  window.zakerPlay = function (b64, mime) {
    if (player) { player.pause(); player = null; return; }
    player = new Audio('data:' + mime + ';base64,' + b64);
    player.onended = function () { player = null; };
    player.play();
  };
  window.zakerPages = async function (bytes, mime) {
    if (mime !== 'application/pdf') return 1;
    return (await pdf(bytes)).numPages;
  };
  // An AI drawing as a PNG, drawn by the browser so Arabic and every symbol show, on any phone.
  window.zakerSvg = async function (svg) {
    try {
      const fonts = "Cairo, 'Segoe UI', Tahoma, Roboto, 'Noto Sans Arabic', Arial, sans-serif";
      let s = svg.replace(/font-family\s*=\s*"[^"]*"/g, 'font-family="' + fonts + '"').replace(/font-family\s*:[^;"']*/g, 'font-family:' + fonts);
      const vb = /viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
      const w = vb ? +vb[1] : 360, h = vb ? +vb[2] : 220;
      s = s.replace(/<svg\b/, '<svg width="' + w + '" height="' + h + '" font-family="' + fonts + '"');
      const img = new Image();
      await new Promise(function (ok, no) { img.onload = ok; img.onerror = no; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); });
      const k = Math.min(3, 1400 / w), c = document.createElement('canvas');
      c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    } catch (e) { return null; }
  };
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

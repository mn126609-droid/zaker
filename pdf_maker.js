// Turns the app's printable page (HTML) into a real PDF file and downloads it, with no print window.
// The browser lays the page out itself (so Arabic, English and every picture look exactly as on screen),
// then each A4 page is drawn as a picture and the pages are written into a small PDF made here.
(function () {
  const PAGE_W = 794, PAGE_H = 1123, SCALE = 1.6; // A4 at 96 dpi, drawn twice as sharp

  function frame(html) {
    return new Promise(function (done) {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + PAGE_W + 'px;height:' + PAGE_H + 'px;border:0;visibility:hidden';
      f.onload = function () { done(f); };
      f.srcdoc = html.replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace('</head>', '<style>main{column-count:1!important}html,body{width:' + PAGE_W + 'px;max-width:' + PAGE_W +
          'px;margin:0;box-sizing:border-box;overflow:hidden}img{max-width:100%}</style></head>');
      document.body.appendChild(f);
    });
  }

  // Where a page may end: the top of a block, so no line of text is cut in half.
  function breaks(doc) {
    const tops = new Set([0]);
    forced = [];
    doc.body.querySelectorAll('h1[style*="break-before"]').forEach(function (e) {
      forced.push(Math.floor(e.getBoundingClientRect().top + doc.defaultView.scrollY));
    });
    doc.body.querySelectorAll('section,p,li,h1,h2,h3,img,pre,tr,header').forEach(function (e) {
      tops.add(Math.floor(e.getBoundingClientRect().top + doc.defaultView.scrollY));
    });
    return Array.from(tops).sort(function (a, b) { return a - b; });
  }

  let forced = [];

  // Each lecture starts on a new page.
  function slices(tops, total) {
    const out = [];
    let start = 0;
    while (start < total - 4) {
      let end = start + PAGE_H;
      const chapter = forced.filter(function (t) { return t > start + 8 && t <= end; });
      if (chapter.length) end = chapter[0];
      else if (end < total) {
        const fit = tops.filter(function (t) { return t > start + PAGE_H * 0.4 && t <= end; });
        if (fit.length) end = fit[fit.length - 1];
      }
      out.push([start, Math.min(end, total)]);
      start = end;
    }
    return out;
  }

  async function picture(doc, total) {
    const body = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + PAGE_W + '" height="' + total + '">' +
      '<foreignObject width="100%" height="100%">' + body + '</foreignObject></svg>';
    const img = new Image();
    await new Promise(function (ok, no) {
      img.onload = ok; img.onerror = no;
      // A data address, not a blob one: a blob picture of a web page locks the canvas against reading it back.
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    return img;
  }

  function bytes(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // A PDF with one JPEG per page.
  function pdfOf(pages) {
    const enc = new TextEncoder(), parts = [], offsets = [];
    let size = 0;
    const put = function (x) { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
    const obj = function (n, head, stream) {
      offsets[n] = size;
      put(n + ' 0 obj\n' + head + '\n');
      if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
      put('endobj\n');
    };
    put('%PDF-1.4\n');
    const n = pages.length, kids = [];
    for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
    pages.forEach(function (p, i) {
      const page = 3 + i * 3, content = page + 1, image = page + 2;
      const draw = enc.encode('q 595 0 0 842 0 0 cm /Im Do Q');
      obj(page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im ' + image + ' 0 R >> >> /Contents ' + content + ' 0 R >>');
      obj(content, '<< /Length ' + draw.length + ' >>', draw);
      obj(image, '<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpg.length + ' >>', p.jpg);
    });
    const xref = size, last = 2 + n * 3;
    let table = 'xref\n0 ' + (last + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= last; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    put(table + 'trailer\n<< /Size ' + (last + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }

  window.zakerPdf = async function (html, name) {
    let f = null;
    try {
      f = await frame(html);
      const doc = f.contentDocument;
      await new Promise(function (r) { setTimeout(r, 120); });
      await Promise.all(Array.from(doc.images).map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; }));
      const total = Math.ceil(doc.documentElement.scrollHeight);
      const img = await picture(doc, total);
      const c = document.createElement('canvas');
      c.width = PAGE_W * SCALE; c.height = PAGE_H * SCALE;
      const g = c.getContext('2d'), pages = [];
      for (const [a, b] of slices(breaks(doc), total)) {
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, a, PAGE_W, b - a, 0, 0, PAGE_W * SCALE, (b - a) * SCALE);
        pages.push({ w: c.width, h: c.height, jpg: bytes(c.toDataURL('image/jpeg', 0.8).split(',')[1]) });
      }
      const a = document.createElement('a');
      const file = pdfOf(pages);
      window.zakerLastPdf = file;
      a.href = URL.createObjectURL(file);
      a.download = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); }, 1000);
      return true;
    } catch (e) {
      console.warn('pdf failed');
      return false;
    } finally {
      if (f) f.remove();
    }
  };
})();

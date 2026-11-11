(function () {
  'use strict';
  var ES = window.I18N_ES || {};
  var LANG = 'en';
  try { if (localStorage.getItem('work-lang') === 'es') LANG = 'es'; } catch (e) { /* storage blocked */ }
  function tr(s) { return LANG === 'es' && ES[s] ? ES[s] : s; }
  var ORIG = new WeakMap();
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, PRE: 1, TEXTAREA: 1 };
  function translateText(n) {
    if (!ORIG.has(n)) ORIG.set(n, n.nodeValue);
    var o = ORIG.get(n), key = o.replace(/\s+/g, ' ').trim();
    if (!key) return;
    var lead = o.match(/^\s*/)[0], trail = o.match(/\s*$/)[0];
    var v = LANG === 'es' && ES[key] ? lead + ES[key] + trail : o;
    if (n.nodeValue !== v) n.nodeValue = v;
  }
  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1) return;
    ['alt', 'title', 'aria-label', 'placeholder'].forEach(function (at) {  // also on a textarea: only its content is left alone
      if (!root.hasAttribute(at)) return;
      var k = 'data-en-' + at;
      if (!root.hasAttribute(k)) root.setAttribute(k, root.getAttribute(at));
      var en = root.getAttribute(k);
      root.setAttribute(at, LANG === 'es' && ES[en] ? ES[en] : en);
    });
    if (SKIP_TAGS[root.tagName]) return;
    for (var c = root.firstChild; c; c = c.nextSibling) translateTree(c);
  }
  new MutationObserver(function (ms) {
    if (LANG !== 'es') return;
    ms.forEach(function (m) { m.addedNodes.forEach(translateTree); });
  }).observe(document.body, { childList: true, subtree: true });
  var onLang = [];
  function setLang(l) {
    LANG = l;
    try { localStorage.setItem('work-lang', l); } catch (e) { /* storage blocked */ }
    document.documentElement.lang = l;
    document.querySelectorAll('[data-setlang]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-setlang') === l); b.setAttribute('aria-pressed', String(b.getAttribute('data-setlang') === l)); });
    translateTree(document.body);
    onLang.forEach(function (f) { f(); });
  }
  document.querySelectorAll('[data-setlang]').forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-setlang')); }); });

  // ---------- Try it on: pick a garment, add a logo, see it on you (camera or photo) ----------
  // Body tracking runs on the device (MediaPipe pose model, loaded only when the visitor asks for it).
  (function () {
    var canvas = document.getElementById('toCanvas'); if (!canvas) return;
    var ctx = canvas.getContext('2d'), video = document.getElementById('toVideo'), msg = document.getElementById('toMsg');
    var VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    var MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
    var COLORS = ['#F5F5F2', '#1E3A8A'];  // white and blue: both are real photos on the models (no colour painted over)
    // Garments drawn in a 200 × 220 box; the shoulder line sits at y = 24, between x = 35 and x = 165.
    var SHAPES = {
      tee: { body: 'M70 12 Q100 30 130 12 L165 24 L198 64 L172 86 L158 74 L158 212 Q100 220 42 212 L42 74 L28 86 L2 64 L35 24 Z', chest: [52, 50, 96, 120] },
      sweat: { body: 'M70 12 Q100 30 130 12 L165 24 L186 110 L194 200 L168 204 L158 112 L158 212 Q100 220 42 212 L42 112 L32 204 L6 200 L14 110 L35 24 Z', chest: [52, 50, 96, 110],
        lines: 'M72 14 Q100 34 128 14 M44 200 Q100 208 156 200 M8 188 L32 192 M192 188 L168 192' },
      hoodie: { body: 'M70 12 Q100 30 130 12 L165 24 L186 110 L194 200 L168 204 L158 112 L158 212 Q100 220 42 212 L42 112 L32 204 L6 200 L14 110 L35 24 Z', chest: [52, 46, 96, 92],
        hood: 'M64 16 Q100 -16 136 16 Q122 36 100 38 Q78 36 64 16 Z', lines: 'M60 150 L140 150 L148 198 L52 198 Z M92 30 L90 70 M108 30 L110 70' }
    };
    // Several logos, each on the front or the back. st.logo / st.text / st.size / st.pos / st.side are the logo being
    // edited (st.active); eachLayer() draws every logo on one side through the same code.
    var st = { type: 'tee', color: COLORS[0], mode: 'design', photo: null, pose: null, active: 0,
      layers: [{ logo: null, text: '', size: 0.36, pos: { x: 0.5, y: 0.34 }, side: 'front', font: 'Archivo', tcolor: 'auto' }] };
    ['logo', 'text', 'size', 'pos', 'side', 'font', 'tcolor'].forEach(function (k) { Object.defineProperty(st, k, { get: function () { return st.layers[st.active][k]; }, set: function (v) { st.layers[st.active][k] = v; }, enumerable: true }); });
    function eachLayer(side, fn) { var keep = st.active; st.layers.forEach(function (L, i) { if (L.side === side) { st.active = i; fn(L, i); } }); st.active = keep; }
    var paths = {}; Object.keys(SHAPES).forEach(function (k) { var sh = SHAPES[k]; paths[k] = { body: new Path2D(sh.body), hood: sh.hood && new Path2D(sh.hood), lines: sh.lines && new Path2D(sh.lines) }; });
    function light(hex) { var n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 150; }

    // Sample logos, drawn here as SVG so nothing has to be downloaded
    var SAMPLES = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="88" fill="none" stroke="#F2963F" stroke-width="12"/><path d="M40 130 L80 70 L105 105 L125 80 L160 130 Z" fill="#4E7BF0"/><text x="100" y="166" font-family="Arial Black,Arial" font-size="26" text-anchor="middle" fill="#F2963F">PEAK</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 120"><rect x="6" y="6" width="248" height="108" rx="20" fill="#8B5CF0"/><text x="130" y="80" font-family="Arial Black,Arial" font-size="54" text-anchor="middle" fill="#fff">MIAMI</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><polygon points="100,10 190,60 190,140 100,190 10,140 10,60" fill="#111827" stroke="#FFC078" stroke-width="8"/><text x="100" y="120" font-family="Arial Black,Arial" font-size="64" text-anchor="middle" fill="#FFC078">GR</text></svg>'
    ];
    function svgImage(svg) { var im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); return im; }
    // Typefaces for the lettering (Google Fonts, loaded when the tool starts) and colours for it
    var FONTS = [['Archivo', "900 120px Archivo, 'Arial Black', Arial"], ['Bebas Neue', "400 132px 'Bebas Neue', Impact, sans-serif"], ['Oswald', "700 116px Oswald, Impact, sans-serif"],
      ['Playfair Display', "900 112px 'Playfair Display', Georgia, serif"], ['Pacifico', "400 104px Pacifico, cursive"], ['Permanent Marker', "400 108px 'Permanent Marker', cursive"], ['Courier Prime', "700 104px 'Courier Prime', 'Courier New', monospace"]];
    var TCOLORS = [['auto', ''], ['white', '#FFFFFF'], ['black', '#111111'], ['orange', '#F2963F'], ['royal', '#2F5BEA'], ['red', '#D62828'], ['gold', '#E8B931'], ['green', '#1F8A4C']];
    (function () {
      var l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@700&family=Playfair+Display:wght@900&family=Pacifico&family=Permanent+Marker&family=Courier+Prime:wght@700&display=swap';
      document.head.appendChild(l);
    })();
    function textImage(text, color, font) {
      // the canvas is cut to the lettering, so the text fills the logo's width (short words come out as big as long ones)
      var c = document.createElement('canvas'), x = c.getContext('2d'), f = (FONTS.filter(function (q) { return q[0] === font; })[0] || FONTS[0])[1];
      x.font = f; var w = Math.min(1180, Math.ceil(x.measureText(text).width));
      c.width = Math.max(120, w + 40); c.height = 200; x.font = f;
      x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, c.width / 2, 104, c.width - 20); c.dataset.w = w; return c;
    }
    var textCache = {};  // each typed text is drawn once, not on every camera frame
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { textCache = {}; });  // redrawn once the font has loaded
    function currentLogo() {
      if (!st.text) return st.logo;
      var tc = (TCOLORS.filter(function (c) { return c[0] === st.tcolor; })[0] || TCOLORS[0])[1], color = tc || (light(st.color) ? '#111111' : '#FFFFFF'), font = st.font || 'Archivo', key = st.text + '|' + color + '|' + font;
      if (!textCache[key]) {
        textCache[key] = textImage(st.text, color, font);
        if (document.fonts && document.fonts.load) document.fonts.load((FONTS.filter(function (f) { return f[0] === font; })[0] || FONTS[0])[1].replace(/\d+px/, '40px'), st.text).then(function (ok) { if (ok && ok.length && !textCache[key].fresh) { textCache[key] = textImage(st.text, color, font); textCache[key].fresh = true; redraw(); } }, function () {});  // once the typeface has arrived, the lettering is drawn again with it
      }
      return textCache[key];
    }

    // The logo on the chest, in the garment's 200 × 220 box
    function drawLogo(g) {
      var logo = currentLogo(); if (!logo || !(logo.width || logo.naturalWidth)) return;
      var lw = logo.naturalWidth || logo.width, lh = logo.naturalHeight || logo.height, c = SHAPES[st.type].chest;
      var w = 200 * st.size, h = w * lh / lw, cx = c[0] + c[2] * st.pos.x, cy = c[1] + c[3] * st.pos.y;
      g.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
      st.logoBox = [cx - w / 2, cy - h / 2, w, h];
    }
    // One piece on the flat garment. Without the 360° photos a drawing is painted over the whole 200 × 220 box (that is
    // the frame the brush uses then, see draw360Flat); with them it keeps the placement it always had.
    function drawFlat(g, L) { if (L.kind === 'paint' && !has360()) g.drawImage(L.logo, 0, 0, 200, 220); else drawLogo(g); }
    // The garment with its logo, in the 200 × 220 box (the caller sets the transform); the front unless side says 'back'
    function drawGarment(g, withShadows, side) {
      var p = paths[st.type], sh = SHAPES[st.type];
      g.save();
      if (p.hood) { g.fillStyle = st.color; g.fill(p.hood); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1.2; g.stroke(p.hood); }
      g.fillStyle = st.color; g.fill(p.body);
      g.save(); g.clip(p.body);
      eachLayer(side || 'front', function (L) { drawFlat(g, L); });
      if (withShadows) { // soft folds so a flat colour reads as fabric
        var gr = g.createLinearGradient(0, 0, 200, 0);
        gr.addColorStop(0, 'rgba(0,0,0,.22)'); gr.addColorStop(.25, 'rgba(0,0,0,0)'); gr.addColorStop(.75, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.22)');
        g.fillStyle = gr; g.fillRect(0, 0, 200, 220);
        var gv = g.createLinearGradient(0, 0, 0, 220); gv.addColorStop(0, 'rgba(255,255,255,.10)'); gv.addColorStop(1, 'rgba(0,0,0,.18)');
        g.fillStyle = gv; g.fillRect(0, 0, 200, 220);
      }
      if (p.lines) { g.strokeStyle = light(st.color) ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.14)'; g.lineWidth = 1.4; g.stroke(p.lines); }
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke(p.body);
      g.restore();
    }

    // Design view: the garment alone, centred
    var view = { s: 1, ox: 0, oy: 0 }, hideLogo = false;
    function size(w, h) { var r = window.devicePixelRatio || 1; canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); canvas.style.height = h + 'px'; ctx.setTransform(r, 0, 0, r, 0, 0); return r; }
    var stageFix = { w: 0, h: 0 };
    function stageHeight(w) {  // fits one screen below the tabs; fixed per width, so the page never jumps when a phone's toolbar hides
      if (stageFix.w === w) return stageFix.h;
      var vh = Math.min(window.innerHeight || 900, (window.screen && screen.height) || 900);
      stageFix = { w: w, h: Math.round(Math.max(340, Math.min(700, w * 1.1, vh - 205))) }; return stageFix.h;
    }
    function drawDesign(side) {
      var w = canvas.parentNode.clientWidth, h = stageHeight(w); size(w, h);
      var bg = ctx.createRadialGradient(w / 2, h * .4, 10, w / 2, h / 2, h * .7); bg.addColorStop(0, '#1b2740'); bg.addColorStop(1, '#0b111c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      var s = Math.min(w * .82 / 200, h * .86 / 220); view = { s: s, ox: (w - 200 * s) / 2, oy: (h - 220 * s) / 2 + 6 };
      ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(s, s);
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
      drawGarment(ctx, true, side); ctx.restore();
    }

    // Try-on, live or on a photo. Two on-device models: one finds the body (shoulders, hips) and the other
    // finds the clothes the person is wearing. The clothes are recoloured, keeping their real folds and light,
    // and the logo is laid on the chest following the body. Without a clothes mask it falls back to drawing
    // the garment over the body. Canvases are created once and reused: new ones on every frame crash phones.
    var SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';
    var CLOTHES = 4;  // category of the multiclass selfie model: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others
    var vision = null, landmarker = null, segmenter = null, loading = null, smooth = [], raf = 0, stream = null, facing = 'user';
    var lastDetect = 0, lastVideoTime = -1, lastPoses = [], frames = 0;
    var frameCv = document.createElement('canvas'), offCv = document.createElement('canvas'), shadeCv = document.createElement('canvas'), maskCv = document.createElement('canvas'), areaCv = document.createElement('canvas'), colCv = document.createElement('canvas'), tinyCv = document.createElement('canvas'), lumCv = document.createElement('canvas');
    var fctx = frameCv.getContext('2d'), octx = offCv.getContext('2d'), sctx = shadeCv.getContext('2d'), mctx = maskCv.getContext('2d'), actx = areaCv.getContext('2d'), cctx = colCv.getContext('2d', { willReadFrequently: true }), tctx = tinyCv.getContext('2d'), tinyData = null, tinyOk = false, lctx = lumCv.getContext('2d', { willReadFrequently: true });
    var hasFilter = 'filter' in sctx, maskData = null, hasMask = false, shirtLum = 128; lumCv.width = lumCv.height = 48;
    function fit(cv, W, H) { if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; } }
    function say(t) { msg.textContent = t; msg.hidden = !t; }
    function loadVision() {
      if (!vision) { vision = import(VISION + '/vision_bundle.mjs').then(function (v) { return v.FilesetResolver.forVisionTasks(VISION + '/wasm').then(function (files) { return { v: v, files: files }; }); }); vision.catch(function () { vision = null; }); }
      return vision;
    }
    function loadModel(mode) {
      if (!loading) {
        say(tr('Loading the body-tracking model…'));
        loading = loadVision().then(function (x) {
          var pose = x.v.PoseLandmarker.createFromOptions(x.files, { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: mode, numPoses: 3 });  // several may be in view: only the main one (the closest) is dressed
          var seg = x.v.ImageSegmenter.createFromOptions(x.files, { baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'GPU' }, runningMode: mode, outputCategoryMask: true, outputConfidenceMasks: false })
            .catch(function () { return null; });  // without it, the garment is drawn over the body instead
          return Promise.all([pose, seg]);
        }).then(function (r) { landmarker = r[0]; segmenter = r[1]; if (msg.textContent === tr('Loading the body-tracking model…')) say(''); return landmarker; });  // another message (e.g. the camera was refused) stays
        loading.catch(function () { loading = null; });
      }
      return loading.then(function (l) {
        var ps = [l.setOptions({ runningMode: mode })]; if (segmenter) ps.push(segmenter.setOptions({ runningMode: mode }));
        return Promise.all(ps).then(function () { return l; });
      });
    }
    // The clothes mask from the segmenter, as a canvas whose opaque pixels are the clothes
    var skinLayer = document.createElement('canvas'), slctx = skinLayer.getContext('2d');
    function takeMask(res) {
      var m = res && res.categoryMask; hasMask = false; if (!m) return;
      var w = m.width, h = m.height, cats = m.getAsUint8Array(), n = 0;
      if (maskCv.width !== w || maskCv.height !== h || !maskData) { maskCv.width = w; maskCv.height = h; maskData = mctx.createImageData(w, h); }
      var d = maskData.data;
      for (var q = 0; q < cats.length; q++) { var on = cats[q] === CLOTHES; d[q * 4 + 3] = on ? 255 : 0; if (on) n++; }
      mctx.putImageData(maskData, 0, 0);
      hasMask = n > cats.length * .02;
      if (res.close) res.close();
    }
    // How light the real clothes are, so a dark shirt and a white one both give the chosen colour its own tone
    function measureLum() {
      lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, 48, 48); lctx.drawImage(frameCv, 0, 0, 48, 48);
      lctx.globalCompositeOperation = 'destination-in'; lctx.drawImage(maskCv, 0, 0, 48, 48);
      var d = lctx.getImageData(0, 0, 48, 48).data, sum = 0, n = 0;
      for (var q = 0; q < d.length; q += 4) if (d[q + 3] > 128) { sum += d[q] * .299 + d[q + 1] * .587 + d[q + 2] * .114; n++; }
      if (n > 20) shirtLum = shirtLum * .5 + (sum / n) * .5;
    }
    // Below the hips trousers are "clothes" too. A long shirt still goes on down there, so below the hips
    // only what has the colour of the shirt at the chest stays in the mask, down to a limit (g.end).
    function refineMask(g, W, H) {
      if (!maskData) return;
      var w = maskCv.width, h = maskCv.height, kx = w / W, ky = h / H;
      fit(colCv, w, h); cctx.drawImage(frameCv, 0, 0, w, h);
      var px = cctx.getImageData(0, 0, w, h).data, d = maskData.data, r = 0, gr = 0, b = 0, n = 0;
      var x0 = Math.max(0, (g.mx - g.sw * .3) * kx | 0), x1 = Math.min(w, (g.mx + g.sw * .3) * kx | 0), y0 = Math.max(0, (g.my + g.sw * .25) * ky | 0), y1 = Math.min(h, (g.my + g.sw * .7) * ky | 0);
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var q = (y * w + x) * 4; if (d[q + 3]) { r += px[q]; gr += px[q + 1]; b += px[q + 2]; n++; } }
      if (n < 10) return; r /= n; gr /= n; b /= n;
      // The shading, relative to the shirt's own tone and capped: folds and shadows stay, but a print
      // much lighter (or darker) than the fabric cannot show through the new colour.
      if (!tinyData || tinyData.width !== w || tinyData.height !== h) { tinyCv.width = w; tinyCv.height = h; tinyData = tctx.createImageData(w, h); }
      var tz = tinyData.data, base = Math.max(14, r * .299 + gr * .587 + b * .114);
      for (var t = 0; t < tz.length; t += 4) {
        var v = Math.max(.5, Math.min(1.12, (px[t] * .299 + px[t + 1] * .587 + px[t + 2] * .114) / base));
        tz[t] = tz[t + 1] = tz[t + 2] = Math.max(0, Math.min(255, 128 + (v - 1) * 200)); tz[t + 3] = 255;
      }
      tctx.putImageData(tinyData, 0, 0); tinyOk = true;
      var top = Math.max(0, g.hem * ky | 0), bottom = Math.min(h, Math.ceil(g.end * ky));
      for (y = top; y < bottom; y++) for (x = 0; x < w; x++) {
        q = (y * w + x) * 4; if (!d[q + 3]) continue;
        var dr = px[q] - r, dg = px[q + 1] - gr, db = px[q + 2] - b;
        if (dr * dr + dg * dg + db * db > 75 * 75) d[q + 3] = 0;
      }
      mctx.putImageData(maskData, 0, 0);
    }
    // Where the garment sits on the body, from the pose landmarks (smoothed between frames)
    function geom(lm, W, H, k) {
      k = k || 0;
      if (!lm) return null;
      function P(i) { return { x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility == null ? 1 : lm[i].visibility }; }
      var a = P(11), b = P(12), hl = P(23), hr = P(24);
      if (a.v < .35 || b.v < .35) return null;
      var L = a.x < b.x ? a : b, R = a.x < b.x ? b : a;
      var cur = { lx: L.x, ly: L.y, rx: R.x, ry: R.y, hy: (hl.v > .35 && hr.v > .35) ? (hl.y + hr.y) / 2 : null }, prev = smooth[k];
      if (prev) Object.keys(cur).forEach(function (q) { if (cur[q] != null && prev[q] != null) cur[q] = prev[q] * .5 + cur[q] * .5; });
      smooth[k] = cur;
      var sw = Math.hypot(cur.rx - cur.lx, cur.ry - cur.ly), ang = Math.atan2(cur.ry - cur.ly, cur.rx - cur.lx);
      if (sw < 12) return null;
      // The model marks the centre of the shoulder joint: the garment starts a little higher and wider than that.
      var cx = (cur.lx + cur.rx) / 2 + Math.sin(ang) * sw * .2, cy = (cur.ly + cur.ry) / 2 - Math.cos(ang) * sw * .2;
      var sx = sw * 1.34 / 130, sy = sx;
      if (cur.hy != null) sy = Math.max(sx * .85, Math.min(sx * 1.45, (cur.hy - cy) * 1.25 / 170));
      var my = (cur.ly + cur.ry) / 2, mx = (cur.lx + cur.rx) / 2;
      // Hem: a little below the hips; when the hips are out of view, estimated from the shoulders
      var hem = cur.hy != null ? cur.hy - (cur.hy - my) * .015 : my + sw * 1.45;  // the hip joint sits a little below a t-shirt's hem
      return { cx: cx, cy: cy, ang: ang, sx: sx, sy: sy, hem: hem, end: hem + sw * .6, mx: mx, my: my, sw: sw };
    }
    function place(o, g) { o.setTransform(1, 0, 0, 1, 0, 0); o.translate(g.cx, g.cy); o.rotate(g.ang); o.scale(g.sx, g.sy); o.translate(-100, -24); }
    // The light and dark of the real frame, blurred: the folds stay, a print on the real shirt does not
    function shade(W, H, k) {
      if (tinyOk) { sctx.imageSmoothingEnabled = true; if (hasFilter) sctx.filter = 'blur(' + Math.max(1, W / 320).toFixed(1) + 'px)'; sctx.drawImage(tinyCv, 0, 0, W, H); sctx.filter = 'none'; return; }
      if (hasFilter) { sctx.filter = 'grayscale(1) blur(' + Math.max(1.5, W / 220).toFixed(1) + 'px) brightness(' + k.toFixed(2) + ') contrast(1.9)'; sctx.drawImage(frameCv, 0, 0); sctx.filter = 'none'; }
      else sctx.drawImage(frameCv, 0, 0);
    }
    // Recolour the real clothes and lay the logo on them
    function dressClothes(W, H, gs) {
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
      octx.fillStyle = st.color; octx.fillRect(0, 0, W, H);
      shade(W, H, Math.max(.6, Math.min(3, 128 / Math.max(18, shirtLum))));
      octx.globalCompositeOperation = 'soft-light'; octx.globalAlpha = hasFilter ? .9 : .55; octx.drawImage(shadeCv, 0, 0);
      octx.globalCompositeOperation = 'multiply'; octx.globalAlpha = .1; octx.drawImage(shadeCv, 0, 0);
      // The logo goes on after the shading, so whatever is printed on the real shirt does not show through it;
      // then a light pass of the same shading gives it the folds of the fabric.
      octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
      if (!hideLogo) eachLayer('front', function () { var logo = currentLogo();
      gs.forEach(function (g) {  // the logo on each chest: about half a shoulder-width below the shoulders, turning with them
        if (logo && (logo.width || logo.naturalWidth)) {
          var lw = logo.naturalWidth || logo.width, lh = logo.naturalHeight || logo.height, w = st.layers[st.active].kind === 'paint' ? g.sw * 1.15 : g.sw * st.size * 2.05, h = w * lh / lw;
          octx.translate(g.mx, g.my); octx.rotate(g.ang);
          if (st.layers[st.active].kind === 'paint') { octx.drawImage(logo, -.95 * g.sw, -.42 * g.sw, 1.9 * g.sw, 2 * g.sw); octx.setTransform(1, 0, 0, 1, 0, 0); return; }
          octx.drawImage(logo, (st.pos.x - .5) * g.sw * 1.2 - w / 2, g.sw * (st.layers[st.active].kind === 'paint' ? .8 + (st.pos.y - .96) * 1.4 : .36 + (st.pos.y - .34) * 1.4) - h / 2, w, h);  // centred on the chest (a drawing, on the torso)
          octx.setTransform(1, 0, 0, 1, 0, 0);
        }
      });
      });
      octx.globalCompositeOperation = 'soft-light'; octx.globalAlpha = .35; octx.drawImage(shadeCv, 0, 0);
      octx.globalCompositeOperation = 'destination-in'; octx.globalAlpha = 1; octx.imageSmoothingEnabled = true;
      if (hasFilter) octx.filter = 'blur(' + Math.max(1, W / 420).toFixed(1) + 'px)';  // soft edges: the mask comes from a 256-pixel model
      octx.drawImage(maskCv, 0, 0, W, H); octx.filter = 'none';
      // Only each person's top: trousers are "clothes" too, and so is anyone the model is not following,
      // so the colour stays inside the torso and arms of each tracked person, down to their own hips.
      if (gs.length) {
        fit(areaCv, W, H); actx.setTransform(1, 0, 0, 1, 0, 0); actx.clearRect(0, 0, W, H); actx.fillStyle = '#000';
        gs.forEach(function (g) {
          var down = (g.end - g.my) / Math.max(.5, Math.cos(g.ang));
          actx.setTransform(Math.cos(g.ang), Math.sin(g.ang), -Math.sin(g.ang), Math.cos(g.ang), g.mx, g.my);
          actx.fillRect(-g.sw * 1.7, -g.sw * 1.1, g.sw * 3.4, g.sw * 1.1 + down);
        });
        actx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = 'destination-in'; if (hasFilter) octx.filter = 'blur(3px)'; octx.drawImage(areaCv, 0, 0); octx.filter = 'none';
      }
      octx.globalCompositeOperation = 'source-over';
      ctx.drawImage(offCv, 0, 0, W, H);
    }
    // Fallback: the drawn garment over the body
    function dressOver(W, H, g) {
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1; octx.clearRect(0, 0, W, H);
      place(octx, g); drawGarment(octx, false); octx.setTransform(1, 0, 0, 1, 0, 0);
      shade(W, H, 1);
      octx.globalCompositeOperation = 'soft-light'; octx.globalAlpha = .6; octx.drawImage(shadeCv, 0, 0);
      octx.globalCompositeOperation = 'destination-in'; octx.globalAlpha = 1; place(octx, g); octx.fill(paths[st.type].body); if (paths[st.type].hood) octx.fill(paths[st.type].hood);
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalCompositeOperation = 'source-over';
      ctx.drawImage(offCv, 0, 0, W, H);
    }
    // The frame at working size (mirrored for the front camera); the models read this same frame
    function grab(src, W, H, mirror) {
      fit(frameCv, W, H); fit(offCv, W, H); fit(shadeCv, W, H);
      fctx.setTransform(1, 0, 0, 1, 0, 0); if (mirror) { fctx.translate(W, 0); fctx.scale(-1, 1); }
      fctx.drawImage(src, 0, 0, W, H); fctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    function compose(W, H) {
      ctx.drawImage(frameCv, 0, 0, W, H);
      // The main person: the widest shoulders, i.e. the one closest to the camera. Anyone else is left as they are.
      var main = lastPoses.slice().sort(function (a, b) { return Math.abs(b[11].x - b[12].x) - Math.abs(a[11].x - a[12].x); })[0];
      var gs = [geom(main, W, H, 0)].filter(Boolean);
      if (!gs.length) return false;
      if (hasMask) { tinyOk = false; refineMask(gs[0], W, H); if (frames++ % 6 === 0) measureLum(); dressClothes(W, H, gs); return true; }
      gs.forEach(function (g) { dressOver(W, H, g); });
      return true;
    }
    function showTry(on) {
      cancelTimer(); var timer = document.getElementById('toTimer'); timer.hidden = !(on && st.mode === 'camera'); timerLabel();  // the camera and the upload live in step 4
      document.getElementById('toSave').hidden = false; updateTabs();
      var ai = document.getElementById('toAi'); ai.hidden = !on || st.mode === 'model' || st.mode === 'avatar' || st.mode === '3d';
      ai.textContent = tr(st.mode === 'camera' ? '✨ Take a photo and create it with AI' : '✨ Create a realistic photo with AI');
      var flip = document.getElementById('toFlip'); flip.hidden = true;
      if (on && st.mode === 'camera' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (d) { flip.hidden = d.filter(function (x) { return x.kind === 'videoinput'; }).length < 2 || st.mode !== 'camera'; });
    }
    var camTicket = 0;
    function stopCamera() { cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; video.srcObject = null; }
    function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say(tr('This browser cannot open the camera. Try uploading a photo.'));
      // The computer's webcam on a laptop, the front camera on a phone; "Switch camera" goes to the back one.
      st.mode = 'camera'; smooth = []; lastPoses = []; hasMask = false; lastVideoTime = -1;
      var ticket = ++camTicket, failed = false, opened = null;  // a second tap while the camera is still opening wins; the first one is closed
      // The camera and the tracking model load side by side. If either fails, a camera that did open (before or after
      // the failure) is closed again, so its light never stays on behind an error message.
      var cam = navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        .then(function (s) { opened = s; if (failed) dropStream(s); return s; });
      var pose = loadModel('VIDEO').catch(function () { throw { model: true }; });
      Promise.all([cam, pose]).then(function (r) {
        if (st.mode !== 'camera' || ticket !== camTicket) { dropStream(r[0]); return; }
        stopCamera(); stream = r[0]; video.srcObject = stream; showTry(true); return video.play().then(function () { loop(r[1]); });
      }).catch(function (e) {
        failed = true;
        if (opened && opened === stream) stopCamera(); else dropStream(opened);
        if (st.mode !== 'camera' || ticket !== camTicket) return;  // the visitor has moved on, or tapped again: nothing to say
        say(e && e.model ? tr('The body-tracking model could not load. Check your connection.')
          : /denied|NotAllowed/i.test(String(e && e.name || e)) ? tr('Camera permission was denied. You can upload a photo instead.')
          : tr('The camera could not start. You can upload a photo instead.'));
      });
    }
    function dropStream(s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); }
    function loop(l) {
      if (st.mode !== 'camera') return;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (vw && video.readyState >= 2) {
        var w = Math.round(canvas.parentNode.clientWidth), h = Math.round(Math.min(640, w * vh / vw)), r = window.devicePixelRatio || 1;
        if (canvas.style.height !== h + 'px' || canvas.width !== Math.round(w * r)) size(w, h);
        // Only when the camera has a new frame; the mask is made from the same frame that is shown, so the
        // colour never lags behind when you move (a slow phone just shows fewer frames, still in step).
        if (video.currentTime !== lastVideoTime || canvas.width !== Math.round(w * r)) {
          lastVideoTime = video.currentTime;
          grab(video, w, h, facing === 'user');  // a mirror for the front camera only
          var now = performance.now();
          if (now - lastDetect > 40) { lastDetect = now; lastPoses = l.detectForVideo(frameCv, now).landmarks || []; }   // ~25 a second
          if (segmenter) takeMask(segmenter.segmentForVideo(frameCv, now + .5));
          say(compose(w, h) ? '' : tr('Step back so your shoulders and waist are in view.'));
        }
      }
      raf = requestAnimationFrame(function () { loop(l); });
    }
    function drawPhoto() {
      var img = st.photo, w = Math.round(canvas.parentNode.clientWidth), h = Math.round(Math.min(680, w * img.naturalHeight / img.naturalWidth)); size(w, h);
      grab(img, w, h, false); smooth = []; frames = 0;
      lastPoses = landmarker.detect(frameCv).landmarks || [];
      if (segmenter) takeMask(segmenter.segment(frameCv)); else hasMask = false;
      if (hasMask) measureLum();
      return compose(w, h);
    }
    function tryPhoto(file) {
      var img = new Image(); img.onload = function () {
        if (url) URL.revokeObjectURL(url);
        st.mode = 'photo'; st.photo = img; camTicket++; stopCamera(); setAiResult(null); showTry(true);
        loadModel('IMAGE').then(function () { if (st.mode !== 'photo' || st.photo !== img) return; say(drawPhoto() ? '' : tr('I could not find a person in this photo. Try one where the shoulders are visible.')); })
          .catch(function () { say(tr('The body-tracking model could not load. Check your connection.')); });
      };
      img.onerror = function () { if (url) URL.revokeObjectURL(url); say(tr('This photo could not be opened. Try a JPG or PNG.')); };  // e.g. HEIC outside Safari
      var url = typeof file === 'string' ? null : URL.createObjectURL(file);
      img.src = url || file;
    }
    tryPhoto.redo = function () { if (landmarker && st.photo) loadModel('IMAGE').then(function () { if (st.mode === 'photo') drawPhoto(); }).catch(function () {}); };
    function back() { meOpen = false; st.mode = 'design'; stopCamera(); showTry(false); setAiResult(null); say(''); drawDesign(); }
    document.addEventListener('visibilitychange', function () { if (document.hidden && st.mode === 'camera') back(); });

    // Realistic photo with AI: the visitor's photo and the designed garment go to /api/tryon,
    // a small server function that asks an image model to dress the person. The key never reaches the browser.
    var aiBox = document.getElementById('toAiResult');
    function setAiResult(url, caption) {
      if (!aiBox) return; aiBox.hidden = !url; canvas.hidden = !!url; st.aiUrl = url || null;
      if (url) { aiBox.querySelector('img').src = url; aiBox.querySelector('p').textContent = caption || tr('Created by AI from your photo and your design.'); }
    }
    // Image models put a side logo on the wearer's left chest (the photo's right) whatever they are told. For a logo on
    // the photo's left, everything goes to the AI mirrored (photo, garment and logo) and the answer is flipped back, so
    // the AI always paints the side it gets right and the logo reads the right way round.
    function frontLayer() { for (var i = 0; i < st.layers.length; i++) if (st.layers[i].side === 'front') return st.layers[i]; return null; }  // the AI photos show the front: the first front logo leads
    function aiFlip() { var L = frontLayer(); return !!L && L.pos.x < 0.4; }
    function flipped(url) {
      return new Promise(function (ok) { var im = new Image(); im.onload = function () { var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; var g = c.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(im, 0, 0); ok(c.toDataURL('image/jpeg', .92)); }; im.onerror = function () { ok(url); }; im.src = url; });
    }
    function aiPos(flip) { var L = frontLayer() || { pos: { x: .5, y: .34 }, size: .36 }; return { logoX: flip ? 1 - L.pos.x : L.pos.x, logoY: L.pos.y, logoSize: L.size, mirrored: flip }; }
    function garmentPng(noLogo, flip) {
      var keepLayers = st.layers, keepActive = st.active; if (noLogo) { st.layers = [{ logo: null, text: '', size: .36, pos: { x: .5, y: .34 }, side: 'none' }]; st.active = 0; }  // the plain garment, for a model without the logo
      var c = document.createElement('canvas'); c.width = 600; c.height = 660; var g = c.getContext('2d');
      g.fillStyle = '#8A8F98'; g.fillRect(0, 0, 600, 660); if (flip) { g.translate(600, 0); g.scale(-1, 1); } g.scale(3, 3); drawGarment(g, false);  // mid grey: a white or a black garment both stand out
      var url = c.toDataURL('image/png'); st.layers = keepLayers; st.active = keepActive;
      return url;
    }
    function photoJpeg(flip) {
      var img = st.photo, k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); var g = c.getContext('2d'); if (flip) { g.translate(c.width, 0); g.scale(-1, 1); } g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', .88);
    }
    // One AI request with its answer read: resolves with the image (a data URL) or rejects with why it failed.
    // An answer without an image that is not a safety refusal is asked again once: the model sometimes replies with text only.
    var AI_SAFETY = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/;
    function askAi(body, again) {
      return fetch('/api/tryon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j || {} }; }); },
              function () { throw { why: 'network' }; })
        .then(function (x) {
          var c = x.j.candidates && x.j.candidates[0], parts = (c && c.content && c.content.parts) || [];
          // the model may send draft images while it thinks (marked "thought"): the last real one is the answer
          var img = parts.filter(function (p) { return (p.inlineData || p.inline_data) && !p.thought; }).pop(), d = img && (img.inlineData || img.inline_data);
          if (x.ok && d) return 'data:' + (d.mimeType || d.mime_type || 'image/png') + ';base64,' + d.data;
          var finish = (c && c.finishReason) || (x.j.promptFeedback && x.j.promptFeedback.blockReason) || '';
          var why = x.j.error === 'rate-limited' ? 'rate' : x.j.error === 'not-configured' ? 'off' : x.status === 413 ? 'large'
            : x.j.reason === 'RESOURCE_EXHAUSTED' ? 'quota' : AI_SAFETY.test(finish) ? 'safety' : x.ok ? 'noimage' : 'upstream';
          if (window.console) console.warn('AI request failed:', why, x.status, finish || x.j.reason || x.j.error || '');
          if (why === 'noimage' && again !== false) return askAi(body, false);
          throw { why: why };
        });
    }
    function aiWhy(e, photo) {
      var w = e && e.why;
      return w === 'rate' ? tr('You reached the limit of AI photos for this hour. Try again later.')
        : w === 'off' ? tr('The AI photo is not switched on yet on this site.')
        : w === 'safety' ? tr('The AI declined this photo under its safety rules. Try another one: one adult, facing the camera, with the upper body visible.')
        : w === 'quota' ? tr('The AI service is busy right now. Try again in a few minutes.')
        : w === 'large' ? tr('The photo is too large. Try a smaller one.')
        : photo ? tr('The AI could not create the photo this time. Try again or use another photo.') : tr('The AI could not create the photo this time. Try again.');
    }
    function aiPhoto() {
      if (!st.photo) return;
      var b = document.getElementById('toAi'); b.disabled = true; say(tr('Creating a realistic photo with AI… this takes a few seconds.'));
      var names = { tee: 't-shirt', sweat: 'crewneck sweatshirt', hoodie: 'hoodie' }, flip = aiFlip();
      askAi(Object.assign({ person: photoJpeg(flip), garment: garmentPng(false, flip), garmentType: names[st.type], color: st.color }, aiPos(flip)))
        .then(function (u) { return (flip ? flipped(u) : Promise.resolve(u)).then(function (v) { setAiResult(v); say(''); }); })
        .catch(function (e) { say(aiWhy(e, true)); })
        .then(function () { b.disabled = false; });
    }

    // ---------- See it on a model: who, age, height, weight and skin tone; the page works out build and size ----------
    // from white to black, lightest to darkest
    var SKINS = [['very-light', '#F7E1D3'], ['light', '#E9BC97'], ['medium', '#C99268'], ['olive', '#A9784C'], ['brown', '#7B4B2A'], ['deep', '#4B2C18'], ['black', '#2A170D']];
    var model = { who: 'woman', skin: 'natural' }, CHILD = { girl: 1, boy: 1 }, modelBusy = false;  // one model photo at a time
    var skinsEl = document.getElementById('toSkin');
    SKINS.forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button'; b.style.setProperty('--c', s[1]); b.dataset.skin = s[0]; b.setAttribute('aria-label', s[0]); if (s[0] === model.skin) b.className = 'on';
      b.onclick = function () { if (b.disabled) return; model.skin = s[0] === model.natural ? 'natural' : s[0]; markSkins(); drawAvatar(); };
      skinsEl.appendChild(b);
    });
    // The skin is never painted: each model shows the skin it was photographed with (its swatch is marked). The other
    // tones stay in view, struck through as "not available yet", until a real photo of that model exists in them
    // (named …-<tone>.webp on the media site).
    function tonesFor(name) { return SKINS.map(function (s) { return s[0]; }).filter(function (t) { return name && (MODEL_PHOTOS || []).indexOf(name + '-' + t) >= 0; }); }
    // Without a photo of the model (the repository on its own has none) the drawn figure is shown instead, and it can
    // take any tone: then every swatch is available, medium by default.
    function markSkins() {
      var z = sizing(), name = z.err || !MODEL_PHOTOS ? null : baseName(z), have = tonesFor(name);  // MODEL_PHOTOS is set further down: nothing to show before
      var drawn = !!MODEL_PHOTOS && (z.err ? !MODEL_PHOTOS.length : !name), nat = drawn ? 'medium' : model.natural;
      if (drawn) have = SKINS.map(function (s) { return s[0]; });
      if (have.indexOf(model.skin) < 0) model.skin = 'natural';
      if (drawn && model.skin === 'natural') model.skin = nat;  // the figure is drawn in this tone, and the AI photo is asked for it too
      skinsEl.querySelectorAll('button').forEach(function (b) {
        var t = b.dataset.skin, ok = t === nat || have.indexOf(t) >= 0;
        b.disabled = !ok; b.classList.toggle('na', !ok); b.title = ok ? '' : tr('Not available yet');
        b.classList.toggle('on', model.skin === 'natural' ? t === nat : t === model.skin);
      });
      var note = document.querySelector('.to-skin-note'); if (note) note.hidden = drawn;  // "the model's own skin tone" is about the photos
    }
    var ageEl = document.getElementById('toAge'), hEl = document.getElementById('toHeight'), wEl = document.getElementById('toWeight'), hU = document.getElementById('toHUnit'), wU = document.getElementById('toWUnit');
    var DEFAULTS = { woman: [30, 165, 62], man: [32, 177, 78], girl: [8, 128, 26], boy: [8, 130, 27] };  // age, cm, kg
    function setVal(el, v) { el.value = String(Math.round(v)); }
    function heightCm() { var v = +hEl.value; return hU.value === 'in' ? v * 2.54 : v; }
    function weightKg() { var v = +wEl.value; return wU.value === 'lb' ? v * .4536 : v; }
    document.querySelectorAll('#toWho [data-who]').forEach(function (b) {
      b.onclick = function () {
        model.who = b.getAttribute('data-who'); document.querySelectorAll('#toWho button').forEach(function (x) { x.classList.toggle('on', x === b); });
        var d = DEFAULTS[model.who]; ageEl.value = d[0]; setVal(hEl, hU.value === 'in' ? d[1] / 2.54 : d[1]); setVal(wEl, wU.value === 'lb' ? d[2] / .4536 : d[2]); calc();
      };
    });
    hU.onchange = function () { setVal(hEl, hU.value === 'in' ? +hEl.value / 2.54 : +hEl.value * 2.54); calc(); };
    wU.onchange = function () { setVal(wEl, wU.value === 'lb' ? +wEl.value / .4536 : +wEl.value * .4536); calc(); };
    [ageEl, hEl, wEl].forEach(function (el) { el.oninput = calc; });
    // Build from the body mass index (with thresholds that move with age for children) and the size from a standard chart
    function sizing() {
      var age = Math.round(+ageEl.value), cm = heightCm(), kg = weightKg(), child = !!CHILD[model.who], woman = model.who === 'woman' || model.who === 'girl';
      var err = null;
      if (!(age >= 2 && age <= 90)) err = 'Age must be between 2 and 90.';
      else if (child && age > 17) err = 'For 18 and over, choose Woman or Man.';
      else if (!child && age < 18) err = 'For under 18, choose Girl or Boy.';
      else if (!(cm >= 80 && cm <= 220)) err = 'Height must be between 80 and 220 cm (31–87 in).';
      else if (!(kg >= 10 && kg <= 220)) err = 'Weight must be between 10 and 220 kg (22–485 lb).';
      if (err) return { err: err };
      var bmi = kg / Math.pow(cm / 100, 2), build, size, i;
      if (child) {
        var lo = 13.6 + .3 * Math.max(0, age - 6), hi = Math.min(25, 18.5 + .5 * Math.max(0, age - 6));
        build = bmi < lo ? 'slim' : bmi > hi + 4 ? 'plus' : bmi > hi ? 'broad' : 'average';
        var KIDS = [[92, '2T'], [99, '3T'], [106, '4T'], [116, 'Youth XS'], [132, 'Youth S'], [147, 'Youth M'], [160, 'Youth L'], [172, 'Youth XL']];
        for (i = 0; i < KIDS.length && cm >= KIDS[i][0]; i++);
        if (bmi > hi && i < KIDS.length) i++;  // a fuller body goes up one size
        size = i < KIDS.length ? KIDS[i][1] : (woman ? 'S' : 'M');
      } else {
        build = bmi < 18.5 ? 'slim' : bmi < 25 ? 'average' : bmi < 30 ? (woman ? 'curvy' : 'broad') : 'plus';
        var ADULT = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], CUT = woman ? [48, 57, 66, 77, 88, 102] : [54, 66, 77, 88, 100, 113];
        for (i = 0; i < CUT.length && kg >= CUT[i]; i++);
        if (cm > (woman ? 178 : 188) && i < 3) i++;  // tall: one size up for the length
        size = ADULT[i];
      }
      return { age: age, cm: cm, kg: kg, bmi: bmi, build: build, size: size, child: child };
    }
    var BUILD_TXT = { slim: 'slim', average: 'average', broad: 'sturdy', curvy: 'curvy', plus: 'plus-size' };
    var calcEl = document.getElementById('toCalc');
    function calc() {
      var s = sizing(); calcEl.classList.toggle('warn', !!s.err);
      calcEl.textContent = s.err ? tr(s.err) : tr('Build') + ': ' + tr(BUILD_TXT[s.build]) + ' · ' + tr('BMI') + ' ' + s.bmi.toFixed(1) + ' · ' + tr('Suggested size') + ': ' + s.size;
      document.getElementById('toModelBtn').disabled = !!s.err || modelBusy;
      if (window.__toBuy) window.__toBuy();
      if (typeof markSkins === 'function' && typeof baseName === 'function') markSkins();
      return s;
    }
    onLang.push(calc); calc();

    // ---------- The drawn model: a figure wearing the garment, redrawn as each choice changes ----------
    // Shown when there is no photo of the model (see drawAvatar).
    // Proportions follow the age (a child's head is bigger), the height (the figure stands against a 2 m scale)
    // and the weight (width from the body mass index); the garment, its colour and the logo are the current design.
    function drawAvatarDrawn() {
      var w = canvas.parentNode.clientWidth, h = stageHeight(w); size(w, h);
      var bg = ctx.createRadialGradient(w / 2, h * .4, 10, w / 2, h / 2, h * .75); bg.addColorStop(0, '#1b2740'); bg.addColorStop(1, '#0b111c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      var z = sizing(); if (z.err) { z = { age: 30, cm: 170, kg: 65, bmi: 22.5, child: false, size: 'M' }; }
      var woman = model.who === 'woman' || model.who === 'girl', skin = (SKINS.filter(function (x) { return x[0] === model.skin; })[0] || SKINS[2])[1];
      var withLogo = document.getElementById('toWithLogo').checked;
      // the 2 m scale: 200 cm fills the picture height (with a margin)
      var top = h * .05, floor = h * .95, H = (floor - top) * Math.min(1, z.cm / 200), cx = w * .54, y0 = floor - H;
      var wf = Math.max(.82, Math.min(1.7, Math.sqrt(z.bmi / 22)));
      var headH = H * (z.age >= 16 ? .13 : .13 + (16 - z.age) * .0068), headW = headH * .8;
      var shY = y0 + headH + H * .035, SW = H * (z.child ? .24 : woman ? .235 : .265) * Math.min(wf, 1.45);
      var hipY = shY + H * .30, hemY = hipY + H * .07, hipW = SW * (woman ? .96 : .86) * (wf > 1.15 ? wf / 1.1 : 1), waistW = Math.max(hipW * .86, SW * .78 * wf / 1.05);
      var armLen = H * .36, armT = H * .052 * Math.min(wf, 1.5), legW = hipW * .46, ang = .1 + (wf - 1) * .12;
      ctx.save();
      // height scale on the left
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.font = '600 12px "Instrument Sans",sans-serif';
      var rx = Math.max(18, cx - SW * 1.6); ctx.beginPath(); ctx.moveTo(rx, floor); ctx.lineTo(rx, y0); ctx.moveTo(rx - 6, y0); ctx.lineTo(rx + 6, y0); ctx.moveTo(rx - 6, floor); ctx.lineTo(rx + 6, floor); ctx.stroke();
      var hl = document.getElementById('toHUnit').value === 'in' ? Math.floor(Math.round(z.cm / 2.54) / 12) + ' ft ' + Math.round(z.cm / 2.54) % 12 + ' in' : Math.round(z.cm) + ' cm';
      ctx.save(); ctx.translate(rx - 8, (y0 + floor) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(hl, 0, 0); ctx.restore();
      // floor shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(cx, floor, hipW * .9, H * .015, 0, 0, Math.PI * 2); ctx.fill();
      // legs (jeans) and shoes
      var lx = [cx - hipW * .25, cx + hipW * .25];
      lx.forEach(function (x, k) {
        ctx.fillStyle = '#2E4A72'; roundRect(x - legW / 2, hipY - H * .02, legW, floor - hipY - H * .02, legW * .35); ctx.fill();
        ctx.fillStyle = '#1d1f24'; ctx.beginPath(); ctx.ellipse(x + (k ? 1 : -1) * legW * .12, floor - H * .012, legW * .62, H * .022, 0, 0, Math.PI * 2); ctx.fill();
      });
      // arms, hanging a little away from the body
      var sh = [[cx - SW / 2, shY + H * .012, -1], [cx + SW / 2, shY + H * .012, 1]], hands = [];
      ctx.lineCap = 'round';
      sh.forEach(function (a) {
        var ex = a[0] + a[2] * Math.sin(ang) * armLen, ey = a[1] + Math.cos(ang) * armLen; hands.push([ex, ey, a]);
        ctx.strokeStyle = skin; ctx.lineWidth = armT; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(ex, ey + armT * .3, armT * .62, 0, Math.PI * 2); ctx.fill();
      });
      // long hair goes behind the head and shoulders
      var hair = model.skin === 'very-light' ? '#6b4a2b' : '#2a1b12', headCy = y0 + headH / 2;
      if (woman) { ctx.fillStyle = hair; roundRect(cx - headW * .62, headCy - headH * .45, headW * 1.24, headH * (z.child ? 1.15 : 1.45), headW * .5); ctx.fill(); }
      // neck
      ctx.fillStyle = skin; roundRect(cx - headW * .2, headCy + headH * .3, headW * .4, shY - headCy - headH * .2, headW * .12); ctx.fill();
      // the garment: torso, sleeves (short for a t-shirt, to the wrist otherwise) and a hood
      var longSleeve = st.type !== 'tee', sleeveLen = longSleeve ? armLen * .97 : armLen * .36, tw = Math.max(waistW, hipW) * 1.08;
      var path = new Path2D();
      path.moveTo(cx - headW * .32, shY - H * .006);
      path.quadraticCurveTo(cx, shY + H * .03, cx + headW * .32, shY - H * .006);
      path.lineTo(cx + SW / 2, shY + H * .008);
      function sleeve(a, side) {
        var dx = Math.sin(ang) * side, dy = Math.cos(ang), px = dy * side, py = -Math.sin(ang);  // along the arm, and across it (outwards)
        var wdt = armT * (longSleeve ? 1.32 : 1.55), ex = a[0] + dx * sleeveLen, ey = a[1] + dy * sleeveLen;
        return [[a[0] + px * wdt * .5, a[1] + py * wdt * .5 - armT * .15], [ex + px * wdt * .5, ey + py * wdt * .5], [ex - px * wdt * .5, ey - py * wdt * .5]];
      }
      var sr = sleeve(sh[1], 1), sl = sleeve(sh[0], -1);
      path.lineTo(sr[0][0], sr[0][1]); path.lineTo(sr[1][0], sr[1][1]); path.lineTo(sr[2][0], sr[2][1]);
      path.lineTo(cx + SW * .44, shY + H * .1);
      path.quadraticCurveTo(cx + waistW * .52, (shY + hemY) / 2, cx + tw / 2, hemY);
      path.quadraticCurveTo(cx, hemY + H * .012, cx - tw / 2, hemY);
      path.quadraticCurveTo(cx - waistW * .52, (shY + hemY) / 2, cx - SW * .44, shY + H * .1);
      path.lineTo(sl[2][0], sl[2][1]); path.lineTo(sl[1][0], sl[1][1]); path.lineTo(sl[0][0], sl[0][1]);
      path.lineTo(cx - SW / 2, shY + H * .008); path.closePath();
      if (st.type === 'hoodie') { ctx.fillStyle = st.color; ctx.beginPath(); ctx.ellipse(cx, shY - H * .005, headW * .78, headH * .32, 0, Math.PI, 0); ctx.fill(); }
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
      ctx.fillStyle = st.color; ctx.fill(path); ctx.shadowColor = 'transparent';
      ctx.save(); ctx.clip(path);
      if (withLogo) {  // the logo in the same place as on the design: the design's 200 × 220 box mapped onto this torso
        ctx.save(); var kx = tw / 116, ky = (hemY - shY) / 188; ctx.translate(cx, shY); ctx.scale(kx, ky); ctx.translate(-100, -24);
        var keepBox = st.logoBox; eachLayer('front', function (L) { drawFlat(ctx, L); }); st.logoBox = keepBox; ctx.restore();  // every front piece
      }
      var gr = ctx.createLinearGradient(cx - SW, 0, cx + SW, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(.3, 'rgba(0,0,0,0)'); gr.addColorStop(.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      var gv = ctx.createLinearGradient(0, shY, 0, hemY); gv.addColorStop(0, 'rgba(255,255,255,.1)'); gv.addColorStop(1, 'rgba(0,0,0,.22)');
      ctx.fillStyle = gv; ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke(path);
      if (st.type === 'hoodie') { ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1.2, H * .004); ctx.beginPath(); ctx.moveTo(cx - headW * .12, shY + H * .01); ctx.lineTo(cx - headW * .14, shY + H * .07); ctx.moveTo(cx + headW * .12, shY + H * .01); ctx.lineTo(cx + headW * .14, shY + H * .07); ctx.stroke(); }
      // hands over long sleeves
      if (longSleeve) hands.forEach(function (e) { ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(e[0], e[1] + armT * .3, armT * .62, 0, Math.PI * 2); ctx.fill(); });
      // head, hair and a quiet face
      ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(cx, headCy, headW / 2, headH / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hair; ctx.beginPath(); ctx.ellipse(cx, headCy - headH * .2, headW * .53, headH * .34, 0, Math.PI, 0); ctx.fill();
      if (!woman) { ctx.beginPath(); ctx.ellipse(cx, headCy - headH * .22, headW * .52, headH * .2, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(20,12,8,.75)';
      [-1, 1].forEach(function (k) { ctx.beginPath(); ctx.arc(cx + k * headW * .18, headCy + headH * .02, Math.max(1.2, headH * .035), 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = 'rgba(20,12,8,.55)'; ctx.lineWidth = Math.max(1, headH * .025); ctx.beginPath(); ctx.arc(cx, headCy + headH * .14, headW * .13, .2 * Math.PI, .8 * Math.PI); ctx.stroke();
      // size tag
      var tag = tr('Size:') + ' ' + z.size; ctx.font = '700 14px "Instrument Sans",sans-serif'; var tw2 = ctx.measureText(tag).width + 20;
      ctx.fillStyle = 'rgba(6,9,15,.78)'; roundRect(w - tw2 - 14, 14, tw2, 28, 14); ctx.fill(); ctx.strokeStyle = 'rgba(242,150,63,.8)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tag, w - tw2 / 2 - 14, 28); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      ctx.restore();
      function roundRect(x, y, ww, hh, r) { r = Math.min(r, ww / 2, hh / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); }
    }

    // The virtual model: real photos made once with AI — each model in the white shirt and, the same person in the same
    // pose, in the blue shirt — so the garment is never painted over. Only the logo goes on, taking the fabric's folds and
    // light from the photo itself; the skin tone shifts with a skin mask. The photos live on the media site at high
    // quality (gilberthroca-media.pages.dev, prepared with tools/make-media.html).
    var MEDIA = 'https://gilberthroca-media.pages.dev/models/', MODEL_PHOTOS = window.MODEL_PHOTOS || [], models = {}, modelOrder = [], avatarToken = 0;
    function baseName(z) {
      var who = model.who, child = !!CHILD[who], band = child ? (z.age < 10 ? 'young' : 'teen') : 'adult', b = z.build;
      if (child) b = b === 'slim' || b === 'average' ? b : 'broad';
      else if (b === 'broad' || b === 'curvy') b = who === 'woman' ? 'curvy' : 'broad';
      var order = [b].concat(['average', 'slim', 'broad', 'curvy', 'plus'].filter(function (x) { return x !== b; }));
      for (var i = 0; i < order.length; i++) { var n = who + '-' + band + '-' + order[i] + '-' + st.type; if (MODEL_PHOTOS.indexOf(n) >= 0) return n; }
      return null;
    }
    function loadImg(src) { return new Promise(function (ok, no) { var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function () { ok(im); }; im.onerror = no; im.src = src; }); }
    function loadModel2(stem) {
      if (!models[stem]) models[stem] = Promise.all([loadImg(MEDIA + stem + '.webp'), loadImg(MEDIA + stem + '.skin.png'), fetch(MEDIA + stem + '.json').then(function (r) { return r.json(); })])
        .then(function (r) { return prepPhoto(r[0], r[1], r[2]); });
      models[stem].catch(function () { delete models[stem]; });
      // keep only the last few models in memory (an iPhone's canvas memory is limited); older ones are released
      modelOrder = modelOrder.filter(function (n) { return n !== stem; }).concat(stem);
      while (modelOrder.length > 4) {
        var old = modelOrder.shift(), pm = models[old]; delete models[old];
        if (pm) pm.then(function (m) { ['mul', 'hi', 'garm'].forEach(function (k) { if (m[k]) m[k].width = m[k].height = 0; }); if (m.tones) Object.keys(m.tones).forEach(function (t) { m.tones[t].width = 0; }); }, function () {});
      }
      return models[stem];
    }
    // the fabric's light, from the photo: luminance over the chest's average (for the logo's folds and shine)
    function prepPhoto(photo, skin, meta) {
      var W = photo.naturalWidth, H = photo.naturalHeight, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(photo, 0, 0); var d = x.getImageData(0, 0, W, H).data;
      var cx = Math.round(meta.mx), cy = Math.round(meta.my + meta.sw * .5), r = Math.round(meta.sw * .25), sum = 0, n = 0;
      for (var yy = Math.max(0, cy - r); yy < Math.min(H, cy + r); yy++) for (var xx = Math.max(0, cx - r); xx < Math.min(W, cx + r); xx++) { var q = (yy * W + xx) * 4; sum += d[q] * .299 + d[q + 1] * .587 + d[q + 2] * .114; n++; }
      var mean = Math.max(10, sum / Math.max(1, n));
      function layer(fn) { var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var g = cv.getContext('2d'), id = g.createImageData(W, H), o = id.data; for (var i = 0; i < d.length; i += 4) { var L = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / mean; fn(o, i, L); } g.putImageData(id, 0, 0); return cv; }
      // which swatch the photo's own skin is closest to (by lightness), to mark it as this model's tone
      var sc = document.createElement('canvas'); sc.width = W; sc.height = H; var sx2 = sc.getContext('2d', { willReadFrequently: true }); sx2.drawImage(skin, 0, 0, W, H);
      var sd = sx2.getImageData(0, 0, W, H).data, sl = 0, sn = 0;
      for (var q = 0; q < sd.length; q += 16) if (sd[q + 3] > 220) { sl += d[q] * .299 + d[q + 1] * .587 + d[q + 2] * .114; sn++; }
      // the middle of the chest is under the centre of the neck (where the collar opens), not between the shoulders:
      // with a model standing a little turned, the shoulders' midpoint drifts to one side
      var nx = 0, nn = 0, y0n = Math.max(0, Math.round(meta.my - meta.sw * .22)), y1n = Math.round(meta.my - meta.sw * .04), xr = meta.sw * .28;
      for (var yy2 = y0n; yy2 < y1n; yy2++) for (var xx2 = Math.max(0, Math.round(meta.mx - xr)); xx2 < Math.min(W, Math.round(meta.mx + xr)); xx2++) if (sd[(yy2 * W + xx2) * 4 + 3] > 160) { nx += xx2; nn++; }
      var neckX = nn > meta.sw * 2 ? nx / nn : meta.mx;
      var avgL = sn ? sl / sn : 160, tone = SKINS.reduce(function (best, s) { return Math.abs(hexLum(s[1]) - avgL) < Math.abs(hexLum(best[1]) - avgL) ? s : best; }, SKINS[2])[0];
      // where a drawing may go on the model: the torso from the collar to the hips (a rounded box around the shoulders'
      // line), minus the skin, so it never lands on the face, the hands or the background
      var gcx = neckX, gtop = meta.my - meta.sw * .32, gbot = (meta.hipY || meta.my + meta.sw * 1.6) + meta.sw * .06, ghw = meta.sw * .66, grad = meta.sw * .22;
      var gm = document.createElement('canvas'); gm.width = W >> 1; gm.height = H >> 1; var gx = gm.getContext('2d'), gid = gx.createImageData(gm.width, gm.height), go = gid.data;
      for (var y3 = 0; y3 < gm.height; y3++) for (var x3 = 0; x3 < gm.width; x3++) {
        var X3 = x3 * 2, Y3 = y3 * 2; if (Y3 < gtop || Y3 > gbot) continue;
        var ddx = Math.max(0, Math.abs(X3 - gcx) - (ghw - grad)), ddy = Math.max(0, gtop + grad - Y3); if (ddx * ddx + ddy * ddy > grad * grad) continue;
        if (sd[(Y3 * W + X3) * 4 + 3] > 90) continue;
        var o3 = (y3 * gm.width + x3) * 4; go[o3 + 3] = 255;
      }
      gx.putImageData(gid, 0, 0);
      c.width = c.height = 0; sc.width = sc.height = 0;  // work canvases released at once (iPhone canvas memory)
      return {
        photo: photo, skin: skin, meta: meta, W: W, H: H, tone: tone, neckX: neckX, garm: gm,
        mul: layer(function (o, i, L) { o[i] = o[i + 1] = o[i + 2] = Math.round(Math.max(0, Math.min(1, .25 + .75 * L)) * 255); o[i + 3] = 255; }),
        hi: layer(function (o, i, L) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = Math.round(Math.max(0, Math.min(1, (L - 1.06) * 2.2)) * 255); })
      };
    }
    function skinTone(m, name) {
      m.tones = m.tones || {};
      if (m.tones[name]) return m.tones[name];
      var W = m.W, H = m.H, c = document.createElement('canvas'); c.width = W; c.height = H;
      var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(m.photo, 0, 0); var px = g.getImageData(0, 0, W, H), d = px.data;
      // the mask comes at half size: read it there, widen it by 2 px (= 4 px of the photo), then sample it per pixel
      var sk = m.skin, mw = sk.naturalWidth || sk.width, mh = sk.naturalHeight || sk.height, mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
      var mg = mc.getContext('2d', { willReadFrequently: true }); mg.drawImage(sk, 0, 0); var md = mg.getImageData(0, 0, mw, mh).data, a0 = new Uint8Array(mw * mh), a1 = new Uint8Array(mw * mh);
      for (var i = 0; i < mw * mh; i++) a0[i] = md[i * 4 + 3];
      for (var y = 0; y < mh; y++) for (var x = 0; x < mw; x++) { var v = 0; for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) { var yy = y + dy, xx = x + dx; if (yy >= 0 && yy < mh && xx >= 0 && xx < mw && a0[yy * mw + xx] > v) v = a0[yy * mw + xx]; } a1[y * mw + x] = v; }
      var sum = 0, n = 0, fx = mw / W, fy = mh / H;
      for (var q = 0, j = 0; q < d.length; q += 4, j++) { var mi = Math.min(mh - 1, (j / W | 0) * fy | 0) * mw + Math.min(mw - 1, (j % W) * fx | 0); if (a0[mi] > 200) { sum += d[q] * .299 + d[q + 1] * .587 + d[q + 2] * .114; n++; } }
      var mean = Math.max(20, sum / Math.max(1, n)), t = (SKINS.filter(function (s) { return s[0] === name; })[0] || SKINS[2])[1], tc = [1, 3, 5].map(function (k) { return parseInt(t.substr(k, 2), 16); });
      var dark = (tc[0] + tc[1] + tc[2]) / 3 < 110, headEnd = Math.round(m.meta.my - m.meta.sw * .1) * W;  // above the shoulders
      for (var q2 = 0, j2 = 0; q2 < d.length; q2 += 4, j2++) {
        var a = a1[Math.min(mh - 1, (j2 / W | 0) * fy | 0) * mw + Math.min(mw - 1, (j2 % W) * fx | 0)];
        if (!a && dark && j2 < headEnd) {  // dark grey hair next to a very dark face reads as grey: hair goes darker with the skin
          var hl = d[q2] * .299 + d[q2 + 1] * .587 + d[q2 + 2] * .114, sat = Math.max(d[q2], d[q2 + 1], d[q2 + 2]) - Math.min(d[q2], d[q2 + 1], d[q2 + 2]), hk = Math.max(0, Math.min(1, (100 - hl) / 35)) * (sat < 40 ? 1 : 0);
          if (hk) { for (var c2 = 0; c2 < 3; c2++) d[q2 + c2] = Math.round(d[q2 + c2] * (1 - .5 * hk)); d[q2 + 3] = 255; continue; }
        }
        if (!a) { d[q2 + 3] = 0; continue; }
        var rel = (d[q2] * .299 + d[q2 + 1] * .587 + d[q2 + 2] * .114) / mean, a00 = a0[Math.min(mh - 1, (j2 / W | 0) * fy | 0) * mw + Math.min(mw - 1, (j2 % W) * fx | 0)];
        if (a00 < 250) a = Math.round(a * Math.max(0, Math.min(1, (1.32 - rel) * 4)));  // the mask's edge (and its widened rim) only over hair and shadow, never the light background
        if (!a) { d[q2 + 3] = 0; continue; }
        var shine = dark ? Math.max(0, rel - 1.12) * 70 : 0;
        for (var ch = 0; ch < 3; ch++) { var want = tc[ch] * .9 * Math.pow(rel, dark ? 1.15 : .8) + shine; d[q2 + ch] = Math.max(0, Math.min(255, dark ? want : d[q2 + ch] + (want - d[q2 + ch]) * .85)); }  // light tones keep a little of the photo's own warmth
        d[q2 + 3] = a;
      }
      g.putImageData(px, 0, 0);
      return (m.tones[name] = c);
    }
    function drawAvatar() {
      var z = sizing(); if (z.err) return;
      var name = baseName(z);
      if (!name) { avatarToken++; say(''); return drawAvatarDrawn(); }  // no photo of this model (e.g. the repository on its own): the drawn figure
      if (model.skin !== 'natural' && MODEL_PHOTOS.indexOf(name + '-' + model.skin) >= 0) name += '-' + model.skin;
      var stem = st.color === '#1E3A8A' && MODEL_PHOTOS.indexOf(name + '-blue') >= 0 ? name + '-blue' : name, token = ++avatarToken;
      if (!models[stem]) say(tr('Loading the model…'));
      loadModel2(stem).then(function (m) {
        if (token !== avatarToken || (st.mode !== 'avatar' && st.mode !== 'model')) return;
        say(''); if (model.skin === 'natural') { model.natural = m.tone; markSkins(); } drawModel(m, sizing());
      }).catch(function () { if (token === avatarToken) say(tr('The model could not load. Check your connection.')); });
    }
    var logoLayer = document.createElement('canvas'), llctx = logoLayer.getContext('2d'), logoCut = document.createElement('canvas'), lcctx = logoCut.getContext('2d');
    function drawModel(m, z) {
      var w = Math.round(canvas.parentNode.clientWidth), h = stageHeight(w); size(w, h);
      var dpr = Math.min(3, window.devicePixelRatio || 1), k = Math.max(w / m.W, h / m.H), sw = w / k, sh = h / k, sx = (m.W - sw) / 2;  // cover the stage, head in view
      ctx.imageSmoothingQuality = 'high';
      function put(g, img, ww, hh) { g.drawImage(img, sx * (img.width / m.W || 1), 0, sw * (img.width / m.W || 1), sh * (img.height / m.H || 1), 0, 0, ww, hh); }
      put(ctx, m.photo, w, h);
      // skin tone: the photo's own shading (luminance over the skin's average) times the chosen tone, inside a slightly
      // widened skin mask, so pores, shadows and shine stay real and no light rim is left at the hairline
      // the logo on the chest, printed: it takes the photo's folds (multiply) and a touch of its shine, inside its own shape
      if (document.getElementById('toWithLogo').checked) eachLayer('front', function () { var logo = currentLogo(); if (!logo || !(logo.width || logo.naturalWidth)) return;
        var W3 = Math.round(w * dpr), H3 = Math.round(h * dpr), kk = k * dpr, me = m.meta, msw = me.sw * kk, lw = logo.naturalWidth || logo.width, lh = logo.naturalHeight || logo.height, lwid = st.layers[st.active].kind === 'paint' ? msw * 1.15 : msw * st.size * 2.05, lhei = lwid * lh / lw, tor = ((me.hipY || me.my + me.sw * 1.5) - me.my) * kk;  // the logo's height is measured on the torso (shoulders to hips): centre of the chest, a little lower on a hoodie (below the drawstrings' knot) when it is centred
        function place(g) { g.setTransform(1, 0, 0, 1, 0, 0); g.translate(((m.neckX || me.mx) - sx) * kk, me.my * kk); g.rotate(me.ang); if (st.layers[st.active].kind === 'paint') { g.drawImage(logo, -.95 * msw, -.42 * msw, 1.9 * msw, .42 * msw + tor * 1.08); g.setTransform(1, 0, 0, 1, 0, 0); return; } g.drawImage(logo, (st.pos.x - .5) * msw * 1.2 - lwid / 2, (st.layers[st.active].kind === 'paint' ? tor * (.5 + (st.pos.y - .96) * .9) : tor * ((st.type === 'hoodie' && Math.abs(st.pos.x - .5) < .1 ? .37 : .32) + (st.pos.y - .34) * .9)) - lhei / 2, lwid, lhei); g.setTransform(1, 0, 0, 1, 0, 0); }
        fit(logoLayer, W3, H3); llctx.globalAlpha = 1; llctx.globalCompositeOperation = 'source-over'; llctx.clearRect(0, 0, W3, H3); place(llctx);
        llctx.globalCompositeOperation = 'multiply'; llctx.globalAlpha = .85; put(llctx, m.mul, W3, H3);
        llctx.globalCompositeOperation = 'screen'; llctx.globalAlpha = .35; put(llctx, m.hi, W3, H3); llctx.globalAlpha = 1;
        fit(logoCut, W3, H3); lcctx.clearRect(0, 0, W3, H3); place(lcctx);
        llctx.globalCompositeOperation = 'destination-in'; llctx.drawImage(logoCut, 0, 0);
        if (st.layers[st.active].kind === 'paint' && m.garm) { llctx.imageSmoothingEnabled = true; put(llctx, m.garm, W3, H3); }  // a drawing stays on the garment
        llctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(logoLayer, 0, 0, w, h);
      });
      var tin = Math.round(z.cm / 2.54), cmTxt = document.getElementById('toHUnit').value === 'in' ? Math.floor(tin / 12) + ' ft ' + (tin % 12) + ' in' : Math.round(z.cm) + ' cm';  // US first: feet and inches
      var kgTxt = document.getElementById('toWUnit').value === 'lb' ? Math.round(z.kg / .4536) + ' lb' : Math.round(z.kg) + ' kg';
      chip(tr('Size:') + ' ' + z.size, w - 14, 14, 'right', true); chip(cmTxt + ' · ' + kgTxt, 14, h - 42, 'left', false);
    }
    function hexLum(hx) { var n = parseInt(hx.slice(1), 16); return (n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114; }
    function chip(text, x, y, align, accent) {
      ctx.save(); ctx.font = '700 14px "Instrument Sans",sans-serif'; var tw = ctx.measureText(text).width + 22, x0 = align === 'right' ? x - tw : x;
      ctx.fillStyle = 'rgba(6,9,15,.78)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y, tw, 28, 14); else ctx.rect(x0, y, tw, 28); ctx.fill();
      if (accent) { ctx.strokeStyle = 'rgba(242,150,63,.85)'; ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, x0 + 11, y + 14); ctx.restore();
    }
    // Any change in step 5 shows the virtual model (until the AI photo is asked for)
    function showAvatar() { if (st.mode === '3d') { show3d(false); st.mode = 'avatar'; showTry(true); } if (st.mode === 'design' || st.mode === 'avatar') { meOpen = false; if (st.mode !== 'avatar') { st.mode = 'avatar'; setAiResult(null); showTry(true); } drawAvatar(); } }
    document.getElementById('toModel').addEventListener('input', function () { setTimeout(showAvatar, 0); });
    document.getElementById('toModel').addEventListener('click', function (e) { if (e.target.closest('button:not(#toModelBtn)')) setTimeout(showAvatar, 0); });
    document.getElementById('toModelBtn').onclick = function () {
      var s = calc(); if (s.err || modelBusy) return;
      var b = this; modelBusy = true; b.disabled = true; camTicket++; stopCamera(); cancelTimer();
      st.mode = 'model'; showTry(true); setAiResult(null); drawAvatar();
      say(tr('Creating the model photo with AI… this takes a few seconds.'));
      var names = { tee: 't-shirt', sweat: 'crewneck sweatshirt', hoodie: 'hoodie' }, withLogo = document.getElementById('toWithLogo').checked && !!frontLayer(), flip = withLogo && aiFlip();
      askAi({
        mode: 'model', garment: garmentPng(!withLogo, flip), garmentType: names[st.type], color: st.color, withLogo: withLogo, logoX: aiPos(flip).logoX, logoY: aiPos(flip).logoY, logoSize: aiPos(flip).logoSize, mirrored: flip,
        who: model.who, age: s.age, heightCm: Math.round(s.cm), weightKg: Math.round(s.kg), skin: model.skin, build: s.build, size: s.size })
        .then(function (u) { if (st.mode !== 'model') return; return (flip ? flipped(u) : Promise.resolve(u)).then(function (v) { if (st.mode !== 'model') return; setAiResult(v, tr('Created by AI: a model wearing your design, size') + ' ' + s.size + '.'); say(''); }); })
        .catch(function (e) { if (st.mode === 'model') say(aiWhy(e, false)); })
        .then(function () { modelBusy = false; calc(); });
    };
    // Optional timer for the camera photo: off, 3 or 10 seconds, with a countdown on the picture
    var TIMERS = [0, 3, 10], timerAt = 0, countdown = 0;
    function timerLabel() { var s = TIMERS[timerAt]; document.getElementById('toTimer').textContent = s ? tr('⏱ Timer: ' + s + ' s') : tr('⏱ Timer: off'); }
    onLang.push(timerLabel);
    function cancelTimer() { if (countdown) { clearInterval(countdown); countdown = 0; } var c = document.getElementById('toCount'); if (c) c.hidden = true; }
    document.getElementById('toTimer').onclick = function () { timerAt = (timerAt + 1) % TIMERS.length; timerLabel(); };
    document.getElementById('toAi').onclick = function () {
      if (st.mode !== 'camera') return aiPhoto();
      if (countdown) return cancelTimer();  // a second tap during the countdown stops it
      var secs = TIMERS[timerAt];
      if (!secs) return takeShot();
      var c = document.getElementById('toCount'); c.textContent = secs; c.hidden = false;
      countdown = setInterval(function () {
        if (st.mode !== 'camera') return cancelTimer();
        secs--; if (secs > 0) { c.textContent = secs; return; }
        cancelTimer(); takeShot();
      }, 1000);
    };
    function takeShot() {
      if (!video.videoWidth || !frameCv.width) return say(tr('The camera is still starting. Try again in a second.'));
      // From the camera: freeze the current frame as the photo, then ask the AI
      var shot = frameCv.toDataURL('image/jpeg', .92), img = new Image();
      img.onload = function () { st.mode = 'photo'; st.photo = img; camTicket++; stopCamera(); showTry(true); loadModel('IMAGE').then(function () { if (st.mode !== 'photo' || st.photo !== img) return; drawPhoto(); aiPhoto(); })
        .catch(function () { say(tr('The body-tracking model could not load. Check your connection.')); }); };
      img.src = shot;
    }

    // Controls
    var colors = document.getElementById('toColors');
    COLORS.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.style.setProperty('--c', c); b.setAttribute('aria-label', c); if (c === st.color) b.className = 'on'; b.onclick = function () { st.color = c; colors.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); redraw(); }; colors.appendChild(b); });
    var logos = document.getElementById('toLogos'), sampleImgs = [];
    SAMPLES.forEach(function (svg, k) {
      var im = svgImage(svg), b = document.createElement('button'); b.type = 'button'; b._img = im; b.setAttribute('aria-label', 'Sample logo ' + (k + 1)); b.appendChild(svgImage(svg)); sampleImgs.push(im);
      b.onclick = function () { if (isText(st.layers[st.active]) && st.layers.length < 6) newLayer('logo'); st.logo = im; st.text = ''; syncLogoUI(); im.decode ? im.decode().then(redraw, redraw) : redraw(); };
      logos.appendChild(b); if (!k) { st.logo = im; b.className = 'on'; im.onload = redraw; }
    });
    // A logo and a text are separate pieces: typing never replaces the chosen logo (the text becomes its own piece,
    // under the logo on the same side), and choosing a logo while editing a text adds a new logo piece.
    function newLayer(kind) {
      var cur = st.layers[st.active], under = kind === 'text';
      st.layers.push({ font: 'Archivo', tcolor: kind === 'text' && st.picked ? 'picked' : 'auto', logo: null, text: '', side: cur ? cur.side : 'front',  // a colour taken with the picker goes to the next text
        size: under ? .3 : .36, pos: under ? { x: cur ? cur.pos.x : .5, y: Math.min(.95, (cur ? cur.pos.y : .34) + (cur ? cur.size : .36) * 1.2) } : { x: .5, y: .34 } });
      st.active = st.layers.length - 1;
    }
    function isText(L) { return !!(L && !L.logo && (L.text || L.kind === 'text')); }
    // Removes a piece; the selection stays on the piece that was selected (or moves to the next one when that one goes)
    // (an empty piece is left when the last one goes: "Clear drawing" can remove the only piece)
    function removeLayer(i) {
      st.layers.splice(i, 1); if (i < st.active) st.active--;
      if (!st.layers.length) st.layers.push({ logo: null, text: '', size: .36, pos: { x: .5, y: .34 }, side: 'front', font: 'Archivo', tcolor: 'auto' });
      st.active = Math.max(0, Math.min(st.active, st.layers.length - 1));
    }
    // Your logos: each one on the front or the back, up to six; the controls below edit the one that is selected
    var layersEl = document.getElementById('toLayers'), sideEl = document.getElementById('toSide');
    function syncLogoUI() {
      logos.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', !st.text && st.logo === b._img); });
      document.getElementById('toText').value = st.text; document.getElementById('toSize').value = st.size;
      markPlace(Object.keys(PLACES).filter(function (k) { return Math.abs(PLACES[k].x - st.pos.x) < .001 && Math.abs(PLACES[k].y - st.pos.y) < .001; })[0]);
      sideEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-side') === st.side); });
      syncType(); renderLayers(); sizeLabels();
    }
    // the size and position controls say what they move (a logo or a text); a drawing has neither (it is drawn in place)
    function sizeLabels() {
      var L = st.layers[st.active], what = isText(L) ? 'Text' : 'Logo', paint = L && L.kind === 'paint';
      var sz = document.querySelector('.to-size'), pl = document.querySelector('.to-place');
      if (sz) { sz.hidden = paint; sz.querySelector('span').textContent = tr(what + ' size'); }
      if (pl) { pl.hidden = paint; pl.querySelector('span').textContent = tr(what + ' position'); }
    }
    onLang.push(sizeLabels);
    function renderLayers() {
      layersEl.innerHTML = '';
      st.layers.forEach(function (L, i) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'to-layer' + (i === st.active ? ' on' : '');
        var label = document.createElement('span'); label.textContent = (L.kind === 'paint' ? tr('Drawing') : isText(L) ? tr('Text') + (L.text ? ' «' + (L.text.length > 10 ? L.text.slice(0, 10) + '…' : L.text) + '»' : '') : tr('Logo') + ' ' + (i + 1)) + ' · ' + tr(L.side === 'back' ? 'Back' : 'Front'); b.appendChild(label);
        b.onclick = function () { st.active = i; syncLogoUI(); showSide(); };
        if (st.layers.length > 1) {
          var x = document.createElement('span'); x.className = 'to-layer-x'; x.textContent = '×'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', tr('Remove'));
          x.onclick = function (e) { e.stopPropagation(); removeLayer(i); syncLogoUI(); redraw(); };
          b.appendChild(x);
        }
        layersEl.appendChild(b);
      });
      if (st.layers.length < 6) {
        var a = document.createElement('button'); a.type = 'button'; a.className = 'to-layer to-layer-add'; a.textContent = '+ ' + tr('Add another logo');
        a.onclick = function () {
          // the second logo goes on the back; a further one goes small on the front, by the hem, clear of a chest logo
          var back = st.layers.some(function (L) { return L.side === 'back'; }), n = st.layers.filter(function (L) { return L.side === 'front'; }).length;
          st.layers.push({ font: 'Archivo', tcolor: 'auto', logo: sampleImgs[st.layers.length % sampleImgs.length], text: '', size: back ? .16 : .36, pos: back ? { x: n > 1 ? .7 : .3, y: .95 } : { x: .5, y: .34 }, side: back ? 'front' : 'back' });
          st.active = st.layers.length - 1; syncLogoUI(); showSide(); redraw();
        };
        layersEl.appendChild(a);
      }
    }
    // the view turns to the side of the logo being edited; the model and camera views show the front
    function showSide() {
      if (st.mode === '3d') { spin.auto = false; spin.target = st.side === 'back' ? 180 : 0; views.querySelectorAll('button').forEach(function (x, k) { x.classList.toggle('on', k === (st.side === 'back' ? 2 : 0)); }); kick(); }
      else say(st.side === 'back' ? tr('The back logo shows in the 360° view.') : '');
    }
    var typeEl = document.getElementById('toType2'), fontsEl = document.getElementById('toFonts'), tcolEl = document.getElementById('toTColors');
    FONTS.forEach(function (f) { var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Aa'; b.style.fontFamily = "'" + f[0] + "'"; b.title = f[0]; b.setAttribute('aria-label', f[0]); b.onclick = function () { st.font = f[0]; syncType(); redraw(); }; fontsEl.appendChild(b); });
    TCOLORS.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; if (c[0] === 'auto') { b.className = 'auto'; b.title = tr('Automatic'); } else b.style.setProperty('--c', c[1]); b.setAttribute('aria-label', c[0] === 'auto' ? tr('Automatic') : c[0]); b.dataset.c = c[0]; b.onclick = function () { st.tcolor = c[0]; syncType(); redraw(); }; tcolEl.appendChild(b); });
    function syncType() {
      typeEl.hidden = !isText(st.layers[st.active]);
      fontsEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.title === (st.font || 'Archivo')); });
      tcolEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.c === (st.tcolor || 'auto')); });
    }
    syncType();
    sideEl.onclick = function (e) { var b = e.target.closest('[data-side]'); if (!b) return; var to = b.getAttribute('data-side'); if (to !== st.side && Math.abs(st.pos.x - .5) > .1) st.pos = { x: .5, y: st.pos.y };  /* a chest-pocket piece moved to the other side starts centred */ st.side = to; syncLogoUI(); showSide(); redraw(); };
    onLang.push(renderLayers); renderLayers();
    document.querySelectorAll('#toType [data-type]').forEach(function (b) { b.onclick = function () { st.type = b.getAttribute('data-type'); document.querySelectorAll('#toType button').forEach(function (x) { x.classList.toggle('on', x === b); }); markSkins(); redraw(); }; });
    document.getElementById('toLogo').onchange = function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;  // cleared, so the same file can be chosen again
      var im = new Image(), u = URL.createObjectURL(f);
      im.onload = function () {
        URL.revokeObjectURL(u);  // the loaded picture stays drawable
        if (isText(st.layers[st.active]) && st.layers.length < 6) newLayer('logo');  // a new piece only once the file has opened
        var L = st.layers[st.active]; L.logo = im; L.text = ''; syncLogoUI(); redraw();
      };
      im.onerror = function () { URL.revokeObjectURL(u); say(tr('This image could not be opened. Try a PNG, JPG or SVG.')); };
      im.src = u;
    };

    // ---------- "Create a logo with AI": a description becomes a logo, kept in this visitor's browser ----------
    // The AI is asked for a flat logo on plain white; the white that touches the edges is then made transparent, so the
    // logo sits on a white or a blue shirt with no white box around it. Until the real call is switched on (AI_LOGO_LIVE),
    // a free preview logo is drawn here instead, so the design can be approved without spending AI credit.
    var AI_LOGO_LIVE = true, LOGO_PX = 2048, MY_MAX = 6, myLogos = [];
    var aiBtn = document.getElementById('toAiLogo'), logoBox = document.getElementById('toAiBox'), aiDesc = document.getElementById('toAiDesc'),
      aiGo = document.getElementById('toAiGo'), aiMsg = document.getElementById('toAiMsg');
    function aiSay(t) { aiMsg.textContent = t; }
    aiBtn.onclick = function () { var open = logoBox.hidden; logoBox.hidden = !open; aiBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) aiDesc.focus(); };
    // the white around the logo becomes transparent: only white connected to the edges (a white letter inside a dark
    // badge stays), with a soft, un-whitened rim so the edge does not show a pale halo on a blue shirt
    function cutWhite(c) {
      var W = c.width, H = c.height, x = c.getContext('2d', { willReadFrequently: true }), id = x.getImageData(0, 0, W, H), p = id.data, N = W * H;
      var bg = new Uint8Array(N), stack = new Int32Array(N), sp = 0, i, k;
      function whiteish(i) { var r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2], lo = Math.min(r, g, b); return lo > 226 && Math.max(r, g, b) - lo < 24; }
      function push(i) { if (!bg[i] && whiteish(i)) { bg[i] = 1; stack[sp++] = i; } }
      for (k = 0; k < W; k++) { push(k); push((H - 1) * W + k); } for (k = 0; k < H; k++) { push(k * W); push(k * W + W - 1); }
      while (sp) { i = stack[--sp]; var cx = i % W; if (cx > 0) push(i - 1); if (cx < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < N - W) push(i + W); }
      for (i = 0; i < N; i++) {
        if (bg[i]) { p[i * 4 + 3] = 0; continue; }
        var cx2 = i % W, edge = (cx2 > 0 && bg[i - 1]) || (cx2 < W - 1 && bg[i + 1]) || (i >= W && bg[i - W]) || (i < N - W && bg[i + W]);
        if (!edge) continue;
        var lo2 = Math.min(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]), a = Math.max(.15, Math.min(1, (255 - lo2) / 90));
        for (k = 0; k < 3; k++) p[i * 4 + k] = Math.max(0, Math.min(255, (p[i * 4 + k] - 255 * (1 - a)) / a));
        p[i * 4 + 3] = Math.round(a * 255);
      }
      x.putImageData(id, 0, 0); return c;
    }
    // cropped to the logo with a small margin, then drawn at LOGO_PX on its longest side
    function trimTo(c) {
      var W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data, x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return null;
      var pad = Math.round(Math.max(x1 - x0, y1 - y0) * .04); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      var w = x1 - x0 + 1, h = y1 - y0 + 1, s = LOGO_PX / Math.max(w, h), o = document.createElement('canvas'); o.width = Math.round(w * s); o.height = Math.round(h * s);
      var ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height); return o;
    }
    // the free preview: a badge with the name and colours taken from the description (no AI involved)
    function previewLogo(desc) {
      var words = desc.replace(/[“”"«»]/g, '').split(/[,.;:\n]/)[0].trim(), caps = desc.match(/\b[A-ZÁÉÍÓÚÑ0-9]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9]{2,})*/);
      var name = (caps ? caps[0] : words.split(/\s+/).slice(0, 2).join(' ')).toUpperCase().slice(0, 22) || 'MY BRAND';
      var PAL = { orange: '#F2963F', naranja: '#F2963F', black: '#111111', negro: '#111111', blue: '#2F5BEA', azul: '#2F5BEA', red: '#D62828', rojo: '#D62828', green: '#1F8A4C', verde: '#1F8A4C', gold: '#E8B931', dorado: '#E8B931', yellow: '#F2C230', amarillo: '#F2C230', purple: '#8B5CF0', morado: '#8B5CF0', pink: '#E8559A', rosa: '#E8559A' };
      var found = (desc.toLowerCase().match(new RegExp('\\b(' + Object.keys(PAL).join('|') + ')\\b', 'g')) || []).map(function (w) { return PAL[w]; });
      var c1 = found[0] || '#F2963F', c2 = found.find(function (v) { return v !== c1; }) || '#111111';
      var c = document.createElement('canvas'); c.width = c.height = 1024; var x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024);
      x.beginPath(); x.arc(512, 512, 430, 0, Math.PI * 2); x.fillStyle = c2; x.fill(); x.lineWidth = 34; x.strokeStyle = c1; x.stroke();
      x.fillStyle = c1; x.beginPath(); x.arc(512, 400, 120, 0, Math.PI * 2); x.fill();  // a sun
      for (var r = 0; r < 12; r++) { var t = r * Math.PI / 6; x.save(); x.translate(512, 400); x.rotate(t); x.fillRect(150, -14, 70, 28); x.restore(); }
      x.fillStyle = '#fff'; var fs = 150; do { x.font = '900 ' + fs + 'px Archivo, "Arial Black", Arial'; fs -= 6; } while (x.measureText(name).width > 680 && fs > 50);
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name, 512, 690);
      return Promise.resolve(c);
    }
    // the real one: the server asks the image model for a flat logo on white (only when AI_LOGO_LIVE is on)
    function aiLogo(desc) {
      return fetch('/api/tryon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'logo', prompt: desc }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          var parts = (x.j && x.j.candidates && x.j.candidates[0] && x.j.candidates[0].content && x.j.candidates[0].content.parts) || [];
          var img = parts.filter(function (p) { return (p.inlineData || p.inline_data) && !p.thought; }).pop(), d = img && (img.inlineData || img.inline_data);
          if (!x.ok || !d) throw new Error(x.j && x.j.error === 'rate-limited' ? 'rate' : 'ai');
          return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); ok(c); }; im.onerror = no; im.src = 'data:' + (d.mimeType || d.mime_type || 'image/png') + ';base64,' + d.data; });
        });
    }
    // this visitor's logos live in their own browser (IndexedDB), so they are still there after a reload and nobody else sees them
    function idb() { return new Promise(function (ok, no) { if (!window.indexedDB) return no(); var r = indexedDB.open('tryon-logos', 1); r.onupgradeneeded = function () { r.result.createObjectStore('logos', { keyPath: 'id' }); }; r.onsuccess = function () { ok(r.result); }; r.onerror = no; }); }
    function idbDo(mode, fn) { return idb().then(function (db) { return new Promise(function (ok, no) { var t = db.transaction('logos', mode), s = t.objectStore('logos'), q = fn(s); t.oncomplete = function () { ok(q && q.result); }; t.onerror = no; }); }); }
    function addMine(rec, select) {
      var im = new Image(), b = document.createElement('button'); b.type = 'button'; b.className = 'mine'; b.title = rec.desc; b.setAttribute('aria-label', tr('Your logo') + ': ' + rec.desc);
      im.src = b._url = URL.createObjectURL(rec.blob); var thumb = new Image(); thumb.src = im.src; b.appendChild(thumb); b._img = im;  // the URL is released with the button (dropMine)
      var x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', tr('Remove'));
      x.onclick = function (e) { e.stopPropagation(); dropMine(b); myLogos = myLogos.filter(function (m) { return m.id !== rec.id; }); idbDo('readwrite', function (s) { s.delete(rec.id); }).catch(function () {}); st.layers.forEach(function (L) { if (L.logo === im) L.logo = sampleImgs[0]; }); syncLogoUI(); redraw(); };
      b.appendChild(x);
      b.onclick = function () { if (isText(st.layers[st.active]) && st.layers.length < 6) newLayer('logo'); st.logo = im; st.text = ''; syncLogoUI(); im.decode ? im.decode().then(redraw, redraw) : redraw(); };
      logos.appendChild(b); myLogos.push(rec);
      if (select) { im.onload = function () { b.onclick(); }; }
    }
    function dropMine(b) { b.remove(); if (b._url) URL.revokeObjectURL(b._url); }  // a logo already on the garment stays drawn: it is loaded
    idbDo('readonly', function (s) { return s.getAll(); }).then(function (all) { (all || []).sort(function (a, b) { return a.id - b.id; }).forEach(function (r) { addMine(r, false); }); }).catch(function () {});
    aiGo.onclick = function () {
      var desc = aiDesc.value.trim(); if (desc.length < 3) { aiSay(tr('Write a few words: the name, the style and the colors.')); aiDesc.focus(); return; }
      aiGo.disabled = true; aiSay(tr('Creating your logo… this takes a few seconds.'));
      (AI_LOGO_LIVE ? aiLogo(desc) : previewLogo(desc)).then(function (c) {
        var t = trimTo(cutWhite(c)); if (!t) throw new Error('ai');
        return new Promise(function (ok) { t.toBlob(ok, 'image/png'); });
      }).then(function (blob) {
        var rec = { id: Date.now(), desc: desc, blob: blob };
        if (myLogos.length >= MY_MAX) { var old = myLogos[0], ob = logos.querySelector('button.mine'); if (ob) dropMine(ob); myLogos.shift(); idbDo('readwrite', function (s) { s.delete(old.id); }).catch(function () {}); }
        addMine(rec, true); idbDo('readwrite', function (s) { s.put(rec); }).catch(function () {});
        var stage = canvas.getBoundingClientRect(); if (stage.bottom < 60 || stage.top > innerHeight - 60) canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });  // on a phone the shirt is above the box: show it
        aiSay(AI_LOGO_LIVE ? tr('Done: your logo is on the shirt. Choose front or back, size and position.') : tr('Preview logo (the AI is not switched on yet): this is how yours will appear.'));
      }).catch(function (e) { aiSay(e && e.message === 'rate' ? tr('You reached the limit of AI logos for this hour. Try again later.') : tr('The AI could not create the logo this time. Try again with other words.')); })
        .then(function () { aiGo.disabled = false; });
    };
    document.getElementById('toText').oninput = function (e) {
      var v = e.target.value.trim(), L = st.layers[st.active];
      if (v && L && L.logo) {  // a logo is selected: the text goes on as a new piece, the logo stays
        if (st.layers.length >= 6) return;
        newLayer('text'); st.layers[st.active].kind = 'text';
      }
      if (st.layers[st.active].logo && !v) return;
      st.text = v; st.layers[st.active].kind = 'text'; syncType(); renderLayers(); sizeLabels(); redraw();
    };
    document.getElementById('toSize').oninput = function (e) { st.size = +e.target.value; redraw(); };
    // where the logo goes: centred on the chest by default, a small logo on the left or right chest, or nudged by hand.
    // "Left chest" is the wearer's left, which the viewer sees on the right (as print shops name it).
    var PLACES = { center: { x: .5, y: .34, size: .36 }, left: { x: .73, y: .25, size: .19 }, right: { x: .27, y: .25, size: .19 } }, placeEl = document.getElementById('toPlace');
    function markPlace(k) { placeEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-place') === k); }); }
    placeEl.onclick = function (e) {
      var b = e.target.closest('[data-place]'); if (!b) return;
      var p = PLACES[b.getAttribute('data-place')]; st.pos = { x: p.x, y: p.y }; st.size = p.size; document.getElementById('toSize').value = p.size;
      markPlace(b.getAttribute('data-place')); redraw();
    };
    document.getElementById('toNudge').onclick = function (e) {
      var b = e.target.closest('[data-nudge]'); if (!b) return;
      var d = { up: [0, -.04], down: [0, .04], left: [-.04, 0], right: [.04, 0] }[b.getAttribute('data-nudge')];
      st.pos = { x: Math.max(.2, Math.min(.8, st.pos.x + d[0])), y: Math.max(.14, Math.min(.74, st.pos.y + d[1])) };
      markPlace(Object.keys(PLACES).filter(function (k) { return Math.abs(PLACES[k].x - st.pos.x) < .001 && Math.abs(PLACES[k].y - st.pos.y) < .001; })[0]); redraw();
    };
    // The same two actions in step 4 of the panel, where people look for them
    document.querySelectorAll('[data-to]').forEach(function (b) { b.onclick = function () {
      meOpen = false; show3d(false);
      if (b.getAttribute('data-to') === 'cam') { stopCamera(); setAiResult(null); st.mode = 'camera'; showTry(true); startCamera(); }
      else document.getElementById('toPhoto').click();
    }; });
    document.getElementById('toFlip').onclick = function () { facing = facing === 'user' ? 'environment' : 'user'; stopCamera(); startCamera(); };
    document.getElementById('toPhoto').onchange = function (e) { if (e.target.files[0]) tryPhoto(e.target.files[0]); e.target.value = ''; };
    document.getElementById('toSave').onclick = function () {
      function save(href, ext) { var a = document.createElement('a'); a.href = href; a.download = 'try-it-on.' + ext; document.body.appendChild(a); a.click(); a.remove(); }
      if (st.aiUrl) { var m = /^data:image\/(\w+)/.exec(st.aiUrl); return save(st.aiUrl, !m ? 'png' : m[1] === 'jpeg' ? 'jpg' : m[1]); }  // the AI photo when there is one (a JPEG when it was flipped back), otherwise the instant preview
      if (st.mode === 'model') return;  // the model photo is still being made
      canvas.toBlob(function (b) { if (!b) return; var u = URL.createObjectURL(b); save(u, 'png'); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }, 'image/png');
    };
    function redraw() { if (st.mode === '3d') update3d(); else if (st.mode === 'design') drawDesign(); else if (st.mode === 'avatar') drawAvatar(); else if (st.mode === 'photo' && st.photo) tryPhoto.redo(); }
    // Drag the logo in the design view
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      if (st.mode !== 'design' || !st.logoBox) return;
      var r = canvas.getBoundingClientRect(), x = (e.clientX - r.left - view.ox) / view.s, y = (e.clientY - r.top - view.oy) / view.s, b = st.logoBox;
      if (x >= b[0] - 6 && x <= b[0] + b[2] + 6 && y >= b[1] - 6 && y <= b[1] + b[3] + 6) { drag = { x: x, y: y, px: st.pos.x, py: st.pos.y }; canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return; var r = canvas.getBoundingClientRect(), c = SHAPES[st.type].chest;
      var x = (e.clientX - r.left - view.ox) / view.s, y = (e.clientY - r.top - view.oy) / view.s;
      st.pos.x = Math.max(0, Math.min(1, drag.px + (x - drag.x) / c[2])); st.pos.y = Math.max(0, Math.min(1, drag.py + (y - drag.y) / c[3])); drawDesign();
    });
    canvas.addEventListener('pointerup', function () { drag = null; });
    canvas.addEventListener('pointercancel', function () { drag = null; });  // e.g. the browser took the touch for a scroll
    window.addEventListener('resize', function () { if (st.mode === 'design') drawDesign(); else if (st.mode === 'avatar') drawAvatar(); else if (st.mode === '3d') draw360(); });


    // ---------- 360°: real photos of the garment on an invisible mannequin (front, three-quarter, side, back), made once
    // with AI on a flat grey background and prepared like the models (fabric light, garment mask). Turning blends from
    // one angle to the next; the other half of the turn uses the same photos mirrored. Colour and logo are painted on,
    // and the garment is drawn at its real size for the chosen size (M is the reference).
    var PRODUCT_PHOTOS = window.PRODUCT_PHOTOS || [], products = {}, AV = window.ASSET_V ? '?v=' + window.ASSET_V : '';  // a version per build: a phone never mixes old cached files with new ones
    // The site that hosts the photos lists them in window.PRODUCT_PHOTOS. Without them (the repository on its own) the
    // view shows the drawn garment instead, front or back (draw360Flat).
    function has360(type) { var t = type || st.type; return ['front', 'threequarter', 'side', 'back'].every(function (a) { return (PRODUCT_PHOTOS || []).indexOf('product-' + t + '-' + a) >= 0; }); }
    var FRAMES = [[0, 'front', false], [45, 'threequarter', false], [90, 'side', false], [180, 'back', false], [270, 'side', true], [315, 'threequarter', true]];
    var DIMS = { '2T': [11, 14], '3T': [12, 15], '4T': [13, 16], 'Youth XS': [14, 19], 'Youth S': [15.5, 20.5], 'Youth M': [17, 22], 'Youth L': [18.5, 24], 'Youth XL': [20, 26],
      XS: [16.5, 27], S: [18, 28], M: [20, 29], L: [22, 30], XL: [24, 31], '2XL': [26, 32], '3XL': [28, 33] };
    function sizeDims() { var sz = document.getElementById('toOrderSize').value || 'M', d = DIMS[sz] || DIMS.M, extra = st.type === 'tee' ? 0 : 1; return { size: sz, chest: d[0] + extra, length: d[1] + extra / 2 }; }
    var dimsEl = document.getElementById('toDims'), views = document.getElementById('toViews');
    function showDims() {
      var d = sizeDims(), es = LANG === 'es', cm = function (v) { return Math.round(v * 2.54); };
      dimsEl.textContent = d.size + ' · ' + (es ? 'pecho ' : 'chest ') + d.chest + ' in (' + cm(d.chest) + ' cm) · ' + (es ? 'largo ' : 'length ') + d.length + ' in (' + cm(d.length) + ' cm)';
    }
    // the 360° photos' prepared maps: R = fabric light (204 = average), G = garment mask
    // An iPhone gives a page a limited amount of canvas memory, and past it Safari draws the canvases in pieces or not at
    // all. So each layer keeps only the garment's box (no empty background), the work canvas is released at once, and
    // only the garment on screen stays loaded (see start3d).
    function prepMap(photo, mapImg, meta) {
      var b = meta.box, W = b[2], H = b[3], c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(mapImg, -b[0], -b[1]); var d = x.getImageData(0, 0, W, H).data;
      c.width = c.height = 0;
      var shirtA = new Uint8ClampedArray(W * H), tmp = new Uint8ClampedArray(W * H), R2 = 2, x0, y0, v, q;
      for (y0 = 0; y0 < H; y0++) for (x0 = 0; x0 < W; x0++) { v = 0; for (q = -R2; q <= R2; q++) { var xx = x0 + q; if (xx >= 0 && xx < W) v = Math.max(v, d[(y0 * W + xx) * 4 + 1]); } tmp[y0 * W + x0] = v; }
      for (x0 = 0; x0 < W; x0++) for (y0 = 0; y0 < H; y0++) { v = 0; for (q = -R2; q <= R2; q++) { var yy = y0 + q; if (yy >= 0 && yy < H) v = Math.max(v, tmp[yy * W + x0]); } var t = Math.min(1, Math.max(0, (v / 255 - .2) / .5)); shirtA[y0 * W + x0] = Math.round(t * t * (3 - 2 * t) * 255); }
      function layer(fn) { var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var g = cv.getContext('2d'), id = g.createImageData(W, H), o = id.data; for (var i = 0; i < d.length; i += 4) fn(o, i, d[i], d[i + 1], d[i + 2]); g.putImageData(id, 0, 0); return cv; }
      return {
        W: W, H: H, meta: meta, lbox: [0, 0, W, H],
        // on the outline (g below 235) the light is never darker than the fabric's: the lossy WebP mixes the red and green channels there, which left dark dots along the shoulders
        mul: layer(function (o, i, r, g) { var t = g / 255; if (g < 235) r = Math.max(r, 192); o[i] = o[i + 1] = o[i + 2] = Math.min(255, r * 1.25) * t + 255 * (1 - t); o[i + 3] = 255; }),
        hi: layer(function (o, i, r, g) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = Math.max(0, r - 204) * 5 * (g / 255) * (g / 255); }),
        shirt: layer(function (o, i) { o[i] = o[i + 1] = o[i + 2] = 0; o[i + 3] = shirtA[i >> 2]; })
      };
    }
    function loadImgLocal(src) { return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = src; }); }
    // only the map is needed to draw (the photo itself is not); a file that fails is asked for again, twice
    function retry(fn, n) { return fn().catch(function (e) { if (n <= 0) throw e; return new Promise(function (ok) { setTimeout(ok, 700 * (3 - n)); }).then(function () { return retry(fn, n - 1); }); }); }
    function loadProduct(name) {
      if (!products[name]) products[name] = Promise.all([retry(function () { return loadImgLocal('work-assets/products/' + name + '.map.webp' + AV); }, 2), retry(function () { return fetch('work-assets/products/' + name + '.json' + AV).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }, 2)])
        .then(function (r) { return prepMap(null, r[0], r[1]); });
      products[name].catch(function () { delete products[name]; });
      return products[name];
    }
    var spin = { yaw: 0, target: null, auto: false, drag: null, raf: 0, on: false, frames: null, type: null };  // it stays still: the shopper turns it (drag, or Front / Side / Back)
    function show3d(on) {
      views.hidden = !on; dimsEl.hidden = !on; spin.on = on;
      if (on) showDims(); else cancelAnimationFrame(spin.raf);
    }
    function start3d() {
      var type = st.type, names = ['front', 'threequarter', 'side', 'back'].map(function (a) { return 'product-' + type + '-' + a; });
      var sideBtn = views.querySelector('[data-view="1"]'); if (sideBtn) sideBtn.hidden = !has360(type);  // the drawn garment has no side view
      if (!has360(type)) { spin.frames = null; spin.type = null; draw360(); return; }
      if (spin.type !== type) {
        spin.frames = null; spin.type = type; say(tr('Loading the 360° view…'));
        Object.keys(products).forEach(function (n) {  // free the other garments' layers: only one garment's views fit in an iPhone's canvas memory
          if (names.indexOf(n) >= 0) return;
          products[n].then(function (m) { ['mul', 'hi', 'shirt'].forEach(function (k) { m[k].width = m[k].height = 0; }); }, function () {});
          delete products[n];
        });
      }
      spin.loading = true; draw360();
      Promise.all(names.map(loadProduct)).then(function (fr) {
        spin.loading = false;
        if (st.mode !== '3d' || st.type !== type) return;
        say(''); spin.frames = { front: fr[0], threequarter: fr[1], side: fr[2], back: fr[3] };
        cancelAnimationFrame(spin.raf); tick();
      }).catch(function () { spin.loading = false; spin.type = null; say(tr('The 360° view could not load. Check your connection.')); });
    }
    function update3d() { if (st.mode !== '3d') return; showDims(); if (spin.type !== st.type) start3d(); else draw360(); }
    // drawn frame by frame only while it moves (turning to a view, or dragged); still, it is drawn once and rests
    function tick() {
      spin.raf = 0;
      if (!spin.on || st.mode !== '3d') return;
      if (spin.auto) spin.yaw = (spin.yaw + .35) % 360;
      else if (spin.target != null) { var dy = ((spin.target - spin.yaw + 540) % 360) - 180; spin.yaw = (spin.yaw + dy * .14 + 360) % 360; if (Math.abs(dy) < .3) { spin.yaw = spin.target; spin.target = null; } }
      draw360();
      if (spin.auto || spin.target != null || spin.drag) spin.raf = requestAnimationFrame(tick);
    }
    function kick() { if (!spin.raf) tick(); }
    canvas.addEventListener('pointerdown', function (e) { if (picking || (brush.on && st.mode === '3d')) return; if (st.mode !== '3d') return; spin.drag = { x: e.clientX, yaw: spin.yaw }; spin.auto = false; spin.target = null; canvas.setPointerCapture(e.pointerId); kick(); });
    canvas.addEventListener('pointermove', function (e) { if (brush.on) return; if (st.mode === '3d' && spin.drag) spin.yaw = ((spin.drag.yaw - (e.clientX - spin.drag.x) * .6) % 360 + 360) % 360; });
    canvas.addEventListener('pointerup', function () { spin.drag = null; }); canvas.addEventListener('pointercancel', function () { spin.drag = null; });
    views.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { spin.auto = false; spin.target = [0, 90, 180][+b.getAttribute('data-view')]; views.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); kick(); }; });
    // ---------- Brush: a free drawing on the front or the back, printed like a logo (it takes the folds) ----------
    var brush = { on: false, size: 12, color: '#111111', last: null }, picking = false;
    var brushBtn = document.getElementById('toBrush'), brushBar = document.getElementById('toBrushbar'), bcolEl = document.getElementById('toBColors');
    var PAINT_W = 1000, PAINT_H = 1100;
    function paintLayer(side, make) {
      for (var i = 0; i < st.layers.length; i++) if (st.layers[i].kind === 'paint' && st.layers[i].side === side) return i;
      if (!make || st.layers.length >= 6) return -1;
      var c = document.createElement('canvas'); c.width = PAINT_W; c.height = PAINT_H;
      st.layers.push({ kind: 'paint', logo: c, text: '', font: 'Archivo', tcolor: 'auto', side: side, size: .84, pos: { x: .5, y: .96 } });
      return st.layers.length - 1;
    }
    function viewSide() { return Math.abs(((spin.yaw % 360) + 360) % 360 - 180) < 30 ? 'back' : 'front'; }
    function setBrush(on) {
      brush.on = on; brushBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); brushBar.hidden = !on; canvas.classList.toggle('brushing', on);
      if (on) {
        if (st.mode !== '3d') { var t3 = document.querySelector('.to-tabs [data-pv="360"]'); if (t3) t3.click(); }
        spin.auto = false; spin.target = viewSide() === 'back' ? 180 : 0; kick();
      }
    }
    brushBtn.onclick = function () { setBrush(!brush.on); };
    function brushColors() {
      bcolEl.innerHTML = '';
      var list = TCOLORS.filter(function (c) { return c[0] !== 'auto' && c[1]; });
      list.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.style.setProperty('--c', c[1]); b.setAttribute('aria-label', c[0]); b.classList.toggle('on', c[1].toLowerCase() === brush.color.toLowerCase()); b.onclick = function () { brush.color = c[1]; brushColors(); }; bcolEl.appendChild(b); });
    }
    brushColors();
    document.getElementById('toBSizes').onclick = function (e) { var b = e.target.closest('[data-b]'); if (!b) return; brush.size = +b.getAttribute('data-b'); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
    document.getElementById('toClearDraw').onclick = function () { var i = paintLayer(viewSide(), false); if (i >= 0) { removeLayer(i); syncLogoUI(); redraw(); } };
    // from a point on the stage to a point of the drawing, through the same placement the 360° view uses for logos
    function toPaint(e, L) {
      var g = spin.geo; if (!g) return null;
      var r = canvas.getBoundingClientRect(), fx = (e.clientX - r.left - g.ox) * g.dpr, fy = (e.clientY - r.top - g.oy) * g.dpr;
      if (g.mirror) fx = g.gw - fx;
      return { x: fx / g.gw * PAINT_W, y: fy / g.gh * PAINT_H, k: PAINT_W / g.gw * g.dpr };  // the drawing covers the whole garment frame
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (!brush.on || st.mode !== '3d' || picking) return;
      var side = viewSide(), v = spin.geo && spin.geo.view;
      if (spin.target != null || !((side === 'front' && v === 'front') || (side === 'back' && v === 'back'))) { spin.target = side === 'back' ? 180 : 0; kick(); return; }  // turns to the front or back first
      var i = paintLayer(side, true); if (i < 0) return; st.active = i; syncLogoUI();
      var p = toPaint(e, st.layers[i]); if (!p) return;
      brush.last = p; canvas.setPointerCapture(e.pointerId); dot(st.layers[i].logo, p); draw360(); e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!brush.on || !brush.last) return;
      var L = st.layers[st.active]; if (!L || L.kind !== 'paint') return;
      var p = toPaint(e, L); if (!p) return;
      var g = L.logo.getContext('2d'); g.strokeStyle = brush.color; g.lineWidth = brush.size * p.k; g.lineCap = g.lineJoin = 'round';
      g.beginPath(); g.moveTo(brush.last.x, brush.last.y); g.lineTo(p.x, p.y); g.stroke(); brush.last = p; draw360();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) { canvas.addEventListener(ev, function () { if (brush.last) { brush.last = null; renderLayers(); } }); });
    function dot(c, p) { var g = c.getContext('2d'); g.fillStyle = brush.color; g.beginPath(); g.arc(p.x, p.y, brush.size * p.k / 2, 0, Math.PI * 2); g.fill(); }

    // ---------- Colour picker: any colour on the screen (Chrome, Edge), or any point of the shirt or a logo ----------
    var pickBtn = document.getElementById('toPick'), pickedEl = document.getElementById('toPicked');
    function hex2(n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }
    function setPicked(hex) {
      hex = hex.toUpperCase(); st.picked = hex;
      var entry = TCOLORS.filter(function (c) { return c[0] === 'picked'; })[0];
      if (entry) entry[1] = hex; else { TCOLORS.push(['picked', hex]); var b = document.createElement('button'); b.type = 'button'; b.dataset.c = 'picked'; b.setAttribute('aria-label', tr('Picked color')); b.onclick = function () { st.tcolor = 'picked'; syncType(); textCache = {}; redraw(); }; tcolEl.appendChild(b); }
      tcolEl.querySelector('[data-c="picked"]').style.setProperty('--c', hex);
      pickedEl.hidden = false; pickedEl.style.setProperty('--c', hex);
      brush.color = hex; brushColors();
      if (isText(st.layers[st.active])) { st.tcolor = 'picked'; syncType(); }
      textCache = {}; redraw();
    }
    function stopPicking() { picking = false; canvas.classList.remove('picking'); document.body.classList.remove('to-picking'); pickBtn.setAttribute('aria-pressed', 'false'); }
    pickBtn.onclick = function () {
      if (window.EyeDropper) { new window.EyeDropper().open().then(function (r) { setPicked(r.sRGBHex); }, function () {}); return; }
      picking = !picking; canvas.classList.toggle('picking', picking); document.body.classList.toggle('to-picking', picking); pickBtn.setAttribute('aria-pressed', picking ? 'true' : 'false');
      if (picking) say(tr('Tap any point of the shirt or a logo to take its color.'));
    };
    document.addEventListener('click', function (e) {  // while picking: the stage, a logo, or any coloured element of the page
      if (!picking || e.target === pickBtn) return;
      e.preventDefault(); e.stopPropagation();
      var t = e.target, hex = null;
      try {
        if (t === canvas) { var r = canvas.getBoundingClientRect(), k = canvas.width / r.width, d = ctx.getImageData(Math.round((e.clientX - r.left) * k), Math.round((e.clientY - r.top) * k), 1, 1).data; hex = '#' + hex2(d[0]) + hex2(d[1]) + hex2(d[2]); }
        else if (t.tagName === 'IMG' || t.closest('#toLogos button')) {
          var im = t.tagName === 'IMG' ? t : t.closest('button').querySelector('img'), b = im.getBoundingClientRect(), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(b.width)); c.height = Math.max(1, Math.round(b.height));
          var g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height); var dd = g.getImageData(Math.round(e.clientX - b.left), Math.round(e.clientY - b.top), 1, 1).data;
          if (dd[3] > 20) hex = '#' + hex2(dd[0]) + hex2(dd[1]) + hex2(dd[2]);
        }
        if (!hex) { var cs = getComputedStyle(t), m = (cs.backgroundColor + ' ' + cs.color).match(/rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?\)/); if (m) hex = '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]); }
      } catch (err) { /* a picture from another site cannot be read: nothing is taken */ }
      stopPicking(); say('');
      if (hex) setPicked(hex);
    }, true);
    var frameCv2 = document.createElement('canvas'), f2 = frameCv2.getContext('2d');
    // No 360° photos: the drawn garment, the front or the back depending on where the view is turned. The brush paints in
    // its 200 × 220 box, so spin.geo describes that box on screen (drawFlat lays a drawing over the same box).
    function draw360Flat() {
      var side = viewSide(), r = window.devicePixelRatio || 1;
      drawDesign(side); spin.drawn = Date.now();
      spin.geo = { ox: view.ox, oy: view.oy, gw: 200 * view.s * r, gh: 220 * view.s * r, dpr: r, view: side, mirror: false };
    }
    function draw360() {
      if (st.mode !== '3d') return;
      if (!has360()) return draw360Flat();
      var w = Math.round(canvas.parentNode.clientWidth), h = stageHeight(w), dpr = Math.min(3, window.devicePixelRatio || 1); if (canvas.width !== Math.round(w * dpr) || canvas.style.height !== h + 'px') size(w, h);
      var bg = ctx.createRadialGradient(w / 2, h * .42, 10, w / 2, h / 2, h * .8); bg.addColorStop(0, '#f3f4f6'); bg.addColorStop(1, '#d9dce1');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      if (!spin.frames) {  // still loading: the stage says so, never an empty box
        ctx.fillStyle = 'rgba(17,24,39,.55)'; ctx.font = '600 15px "Instrument Sans",sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(tr('Loading the 360° view…'), w / 2, h / 2); ctx.textAlign = 'start';
        return;
      }
      spin.drawn = Date.now();
      // the two photos either side of the current angle, blended
      var yaw = spin.yaw, i = 0; for (var k = 0; k < FRAMES.length; k++) if (FRAMES[k][0] <= yaw) i = k;
      var A = FRAMES[i], B = FRAMES[(i + 1) % FRAMES.length], span = ((B[0] - A[0]) + 360) % 360 || 360, t = (yaw - A[0]) / span;
      t = Math.min(1, Math.max(0, (t - .9) / .1)); t = t * t * (3 - 2 * t);  // each angle stays sharp; the change to the next takes a fifth of a second, so two logos never show at once
      if (t < .98) drawFrame(A, 1, w, h); if (t > .02) drawFrame(B, t < .98 ? t : 1, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.beginPath(); ctx.ellipse(w / 2, h * .93, w * .2, h * .018, 0, 0, Math.PI * 2); ctx.fill();
    }
    function drawFrame(F, alpha, w, h) {
      var m = spin.frames[F[1]], mirror = F[2], box = m.meta.box, d = sizeDims();
      // real size: M fills ~70% of the stage height; other sizes in proportion to their measurements
      var k = (h * .7 / box[3]) * (d.length / 29), cw = box[2] * k * (d.chest / 20) / (d.length / 29);
      var kx = cw / box[2], ky = k, gw = Math.ceil(box[2] * kx), gh = Math.ceil(box[3] * ky), ox = Math.round((w - gw) / 2), oy = Math.round(h * .5 - gh * .48);
      var dpr = Math.min(3, window.devicePixelRatio || 1); gw = Math.ceil(gw * dpr); gh = Math.ceil(gh * dpr);  // the garment is drawn at the screen's real pixels, so it stays sharp on retina screens
      if (alpha === 1) spin.geo = { ox: ox, oy: oy, gw: gw, gh: gh, dpr: dpr, view: F[1], mirror: mirror };  // where the garment sits on screen, for the brush
      fit(frameCv2, gw, gh); f2.setTransform(1, 0, 0, 1, 0, 0); f2.imageSmoothingEnabled = true; f2.imageSmoothingQuality = 'high'; f2.globalAlpha = 1; f2.globalCompositeOperation = 'source-over'; f2.clearRect(0, 0, gw, gh);
      if (mirror) { f2.translate(gw, 0); f2.scale(-1, 1); }
      function put(img) { f2.drawImage(img, 0, 0, m.W, m.H, 0, 0, gw, gh); }
      f2.fillStyle = st.color; f2.fillRect(0, 0, gw, gh);
      f2.globalCompositeOperation = 'multiply'; put(m.mul);
      var dk = 1 - hexLum(st.color) / 255; if (dk > .35) { f2.globalCompositeOperation = 'screen'; f2.globalAlpha = .11 * dk * dk; put(m.mul); f2.globalAlpha = 1; }
      f2.setTransform(1, 0, 0, 1, 0, 0);
      // the logos: front ones on the front and three-quarter views (narrower there, as the chest turns away), back
      // ones on the back view; then one pass of the fabric's folds over them all
      var side = F[1] === 'back' ? 'back' : F[1] === 'side' ? null : 'front', drew = false;
      if (side) eachLayer(side, function () {
        var logo = currentLogo(); if (!logo || !(logo.width || logo.naturalWidth)) return;
        if (st.layers[st.active].kind === 'paint') {  // a drawing spans the whole garment; on a three-quarter view it narrows like the chest
          f2.setTransform(1, 0, 0, 1, 0, 0); f2.save(); f2.globalCompositeOperation = 'source-over';
          if (F[1] === 'threequarter') { f2.translate(gw * .5, 0); f2.scale(.74, 1); f2.translate(-gw * .5, 0); }
          f2.drawImage(logo, 0, 0, gw, gh); f2.restore(); drew = true; return;
        }
        var lw = logo.naturalWidth || logo.width, lh = logo.naturalHeight || logo.height, lwid = gw * .32 * (st.size / .36), lhei = lwid * lh / lw;
        var tq = F[1] === 'threequarter', cx = gw * (tq ? .42 : .5) + (st.pos.x - .5) * gw * .62, cy = gh * ({ tee: .27, sweat: .3, hoodie: .36 }[st.type] + (side === 'back' ? .04 : 0)) + (st.pos.y - .34) * gh * .4;
        if (mirror) cx = gw - cx;
        f2.setTransform(1, 0, 0, 1, 0, 0); f2.save(); f2.translate(cx, cy); f2.scale(tq ? .74 : 1, 1); f2.globalCompositeOperation = 'source-over'; f2.drawImage(logo, -lwid / 2, -lhei / 2, lwid, lhei); f2.restore();
        drew = true;
      });
      if (drew) {
        f2.setTransform(1, 0, 0, 1, 0, 0); if (mirror) { f2.translate(gw, 0); f2.scale(-1, 1); }
        f2.globalCompositeOperation = 'multiply'; f2.globalAlpha = .5; put(m.mul); f2.globalAlpha = 1; f2.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (mirror) { f2.translate(gw, 0); f2.scale(-1, 1); }
      f2.globalCompositeOperation = 'screen'; f2.globalAlpha = light(st.color) ? .22 : .3 + .3 * dk; put(m.hi); f2.globalAlpha = 1;
      f2.globalCompositeOperation = 'destination-in'; put(m.shirt);
      f2.setTransform(1, 0, 0, 1, 0, 0); f2.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(frameCv2, ox, oy, gw / dpr, gh / dpr); ctx.globalAlpha = 1;
    }
    // ---------- Preview tabs: on a model (the default: it opens already finished), on you, flat design ----------
    var meOpen = false;
    function tabOf() { return st.mode === '3d' ? '360' : st.mode === 'avatar' || st.mode === 'model' ? 'model' : 'me'; }
    function updateTabs() {
      var t = tabOf();
      document.querySelectorAll('.to-tabs [data-pv]').forEach(function (b) { var on = b.getAttribute('data-pv') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      var me = document.getElementById('toMe'); if (me) me.hidden = !(st.mode === 'design' && meOpen);
    }
    document.querySelectorAll('.to-tabs [data-pv]').forEach(function (b) {
      b.onclick = function () {
        var t = b.getAttribute('data-pv');
        camTicket++; stopCamera(); cancelTimer(); setAiResult(null); say('');
        show3d(t === '360'); spin.auto = false;
        if (t === 'model') { meOpen = false; st.mode = 'avatar'; showTry(true); drawAvatar(); }
        else if (t === '360') { meOpen = false; st.mode = '3d'; showTry(true); start3d(); }
        else { meOpen = true; st.mode = 'design'; showTry(false); drawDesign(); updateTabs(); }
      };
    });

    // ---------- Order summary: price, size (with the suggestion), quantity, volume price, delivery date ----------
    // Prices modelled on public US custom-print prices (per piece, front print, 16-oct-2026): the same quantity
    // steps (1 / 10 / 25 / 50 / 100 / 500), adult and youth tables, free shipping from $29 and no minimum.
    var TIERS = [1, 10, 25, 50, 100, 500], userSize = null;
    var PRICES = { tee: [33.59, 25.50, 17.16, 13.99, 12.08, 10.32], sweat: [42.35, 32.27, 24.35, 21.60, 19.74, 19.74], hoodie: [41.46, 32.86, 32.86, 29.93, 28.17, 28.17] };
    var YOUTH = { tee: [33.76, 25.62, 17.24, 14.04, 12.13, 10.37], sweat: [41.44, 31.57, 23.83, 21.15, 19.30, 19.30], hoodie: [47.71, 39.26, 31.14, 28.34, 26.68, 26.68] };
    var KIDS_SIZES = ['2T', '3T', '4T', 'Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL'];
    var SIZE_GROUPS = [['Kids', ['2T', '3T', '4T', 'Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL']], ['Adults', ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']]];
    var sizeSel = document.getElementById('toOrderSize'), qtyEl = document.getElementById('toQty');
    function fillSizes() {
      var keep = sizeSel.value; sizeSel.innerHTML = '';
      SIZE_GROUPS.forEach(function (g) { var og = document.createElement('optgroup'); og.label = tr(g[0]); g[1].forEach(function (v) { var o = document.createElement('option'); o.value = o.textContent = v; og.appendChild(o); }); sizeSel.appendChild(og); });
      sizeSel.value = keep || 'M';
    }
    fillSizes();
    function money(v) { return '$' + v.toFixed(2); }
    function arrival() { var d = new Date(Date.now() + 7 * 864e5); return d.toLocaleDateString(LANG === 'es' ? 'es' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
    function order() {
      var z = sizing(), sug = z.err ? null : z.size;
      if (!userSize && sug) sizeSel.value = sug;
      var size = sizeSel.value, q = Math.max(1, Math.min(999, Math.round(+qtyEl.value) || 1));
      var table = (KIDS_SIZES.indexOf(size) >= 0 ? YOUTH : PRICES)[st.type], ti = 0; for (var i = 0; i < TIERS.length; i++) if (q >= TIERS[i]) ti = i;
      var extra = size === '2XL' ? 2 : size === '3XL' ? 3 : 0, each = table[ti] + extra, unit = table[0] + extra, total = each * q;
      var next = null; for (var j = ti + 1; j < TIERS.length; j++) if (table[j] < table[ti]) { next = { qty: TIERS[j], each: table[j] + extra }; break; }
      return { z: z, sug: sug, size: size, q: q, unit: unit, off: each < unit, each: each, total: total, next: next };
    }
    function updateBuy() {
      var o = order(), es = LANG === 'es';
      document.getElementById('toPrice').textContent = money(o.each);
      document.getElementById('toEach').textContent = o.off ? (es ? 'c/u · antes ' : 'each · was ') + money(o.unit) : (es ? 'c/u' : 'each');
      document.getElementById('toSuggest').textContent = o.sug ? (es ? 'Te sugerimos ' + o.sug + ' para el modelo que elegiste' : 'We suggest ' + o.sug + ' for the model you set') + (o.size !== o.sug ? (es ? ' (tú escogiste ' + o.size + ')' : ' (you picked ' + o.size + ')') : '') : '';
      var saved = o.off ? Math.round((1 - o.each / o.unit) * 100) : 0;
      document.getElementById('toDeal').textContent = (saved ? (es ? 'Ahorras ' + saved + '% · ' : 'You save ' + saved + '% · ') : '') + (o.next ? (es ? 'Pide ' + (o.next.qty - o.q) + ' más y pagas ' + money(o.next.each) + ' c/u' : 'Order ' + (o.next.qty - o.q) + ' more and pay ' + money(o.next.each) + ' each') : (es ? 'Tienes el mejor precio' : 'You have the best price'));
      var cart = (es ? 'Agregar al carrito — ' : 'Add to cart — ') + money(o.total);
      document.getElementById('toCart').textContent = cart;
      document.getElementById('toShip').textContent = (o.total >= 29 ? (es ? 'Envío gratis' : 'Free shipping') : (es ? 'Envío $11.95 · gratis desde $29' : 'Shipping $11.95 · free from $29')) + ' · ' + (es ? 'llega aprox. el ' : 'arrives by ') + arrival();
      document.getElementById('toMPrice').textContent = money(o.total); document.getElementById('toMSize').textContent = ' · ' + o.size + (o.q > 1 ? ' × ' + o.q : '');
      document.getElementById('toMCart').textContent = es ? 'Agregar al carrito' : 'Add to cart';
    }
    window.__toBuy = updateBuy;
    sizeSel.onchange = function () { userSize = sizeSel.value; updateBuy(); if (st.mode === '3d') update3d(); };
    qtyEl.oninput = updateBuy;
    document.getElementById('toMinus').onclick = function () { qtyEl.value = Math.max(1, (+qtyEl.value || 1) - 1); updateBuy(); };
    document.getElementById('toPlus').onclick = function () { qtyEl.value = Math.min(999, (+qtyEl.value || 1) + 1); updateBuy(); };
    document.querySelectorAll('#toType [data-type]').forEach(function (b) { b.addEventListener('click', updateBuy); });
    document.querySelectorAll('#toWho [data-who]').forEach(function (b) { b.addEventListener('click', function () { userSize = null; }); });
    var toast = document.getElementById('toToast'), toastT = 0;
    function addToCart() {
      var o = order(), es = LANG === 'es';
      toast.textContent = (es ? '¡Añadido al carrito, gracias! ' : 'Added to cart, thank you! ') + o.q + ' × ' + o.size + ' · ' + money(o.total);
      toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toast.hidden = true; }, 4500);
    }
    document.getElementById('toCart').onclick = addToCart; document.getElementById('toMCart').onclick = addToCart;
    onLang.push(function () { fillSizes(); updateBuy(); });
    updateBuy();
    // Phones: price and the button stay at the bottom, within reach of the thumb, while the tool is on screen
    var mbar = document.getElementById('toMbar'), toBox = document.querySelector('.to');
    if ('IntersectionObserver' in window && toBox) {
      new IntersectionObserver(function (e) { mbar.hidden = !(e[0].isIntersecting && window.innerWidth <= 900); }, { threshold: .05 }).observe(toBox);
    }
    st.mode = '3d'; show3d(true); spin.auto = false; showTry(true); start3d();  // opens on the garment alone, from the front
    // When the tool comes into view (or the page comes back from the browser's cache), the 360° must be turning:
    // if it never loaded, it loads again; if its animation stopped, it starts again.
    function ensure3d() {
      if (st.mode !== '3d' || !spin.on) return;
      if (!spin.frames) { if (!spin.loading) start3d(); return; }
      if (!spin.drawn) { cancelAnimationFrame(spin.raf); spin.raf = 0; tick(); }  // still is fine now; only a view that was never drawn is drawn
    }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { if (e[0].isIntersecting) ensure3d(); }, { threshold: .1 }).observe(canvas);
    window.addEventListener('pageshow', function (e) { if (e.persisted) { spin.drawn = 0; ensure3d(); } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ensure3d(); });
    // direct links: gilberthroca.com/work/#tryon-360 opens the 3D view
    if (location.hash === '#tryon-360') { var t360 = document.querySelector('.to-tabs [data-pv="360"]'); if (t360) setTimeout(function () { document.getElementById('tryon').scrollIntoView(); t360.click(); }, 300); }
    // gilberthroca.com/work/#design opens straight on the editor; the page grows while fonts and images arrive,
    // so the jump is repeated until it is settled, unless the visitor has already scrolled
    if (location.hash === '#design') {
      var dz = document.getElementById('design'), moved = false, until = Date.now() + 4000;
      var stop = function () { moved = true; };
      ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) { window.addEventListener(ev, stop, { once: true, passive: true }); });
      (function again() { if (moved || !dz) return; dz.scrollIntoView({ block: 'start' }); if (Date.now() < until) setTimeout(again, 250); })();
      window.addEventListener('load', function () { if (!moved && dz) dz.scrollIntoView({ block: 'start' }); });
    }
    window.TRYON = { garmentPng: function (noLogo) { return garmentPng(noLogo); },  st: st, spin: spin, tryPhoto: tryPhoto, back: back };  // used by the page test
  })();

  setLang(LANG);
})();

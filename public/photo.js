/* Profil / kapak fotoğrafı: seçenek menüsü (yükle, çek, yeniden konumlandır, kaldır) + konumlandırma düzenleyicisi.
   Kullanım: Photo.menu('avatar'|'cover', { current: () => dataURL|'', save: async (dataURL) => {}, remove: async () => {} }) */
(function (root) {
  'use strict';
  const KIND = {
    avatar: { title: 'Profil Fotoğrafı', w: 256, h: 256, ratio: 1, round: true, cam: 'user', q: 0.82 },
    photo: { title: 'Grup Fotoğrafı', w: 256, h: 256, ratio: 1, round: false, cam: 'environment', q: 0.82 },
    cover: { title: 'Kapak Fotoğrafı', w: 800, h: 300, ratio: 800 / 300, round: false, cam: 'environment', q: 0.8 }
  };
  const $ = id => document.getElementById(id);
  let menuEl, edEl, fileEl, camEl, cfg, kind, ed;

  function css() {
    if ($('photoCss')) return;
    const s = document.createElement('style'); s.id = 'photoCss';
    s.textContent = '.ph-sheet{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center}.ph-sheet[hidden]{display:none}'
      + '.ph-bg{position:absolute;inset:0;background:rgb(0 0 0 / .62)}'
      + '.ph-panel{position:relative;width:100%;max-width:28rem;max-height:90dvh;overflow:auto;padding:1rem 1rem calc(1rem + env(safe-area-inset-bottom));border-radius:1.25rem 1.25rem 0 0;background:#031420;box-shadow:inset 0 0 0 1px rgb(255 255 255 / .1)}'
      + '.ph-opt{display:flex;align-items:center;gap:.75rem;width:100%;min-height:52px;padding:.5rem .9rem;border:0;border-radius:.9rem;background:rgb(255 255 255 / .07);color:#fff;font-size:1rem;text-align:left}'
      + '.ph-opt:disabled{opacity:.4}.ph-opt[data-danger]{color:#fda4af}.ph-opt span:first-child{width:1.6rem;text-align:center;font-size:1.25rem}'
      + '.ph-frame{position:relative;margin:.75rem auto;overflow:hidden;touch-action:none;background:#000;border-radius:1rem;box-shadow:0 0 0 2px #EA8621}'
      + '.ph-frame canvas{display:block;width:100%;height:100%}.ph-frame.round{border-radius:9999px}';
    document.head.appendChild(s);
  }

  function build() {
    if (menuEl) return; css();
    menuEl = document.createElement('div'); menuEl.className = 'ph-sheet'; menuEl.hidden = true; menuEl.id = 'photoMenu';
    menuEl.innerHTML = '<div class="ph-bg" data-x></div><div class="ph-panel" role="dialog" aria-modal="true" aria-labelledby="phTitle"><div class="mb-3 flex items-center justify-between"><h2 id="phTitle" class="road text-xl font-semibold"></h2><button type="button" data-x aria-label="Kapat" class="bike-sheet-x">✕</button></div><div class="flex flex-col gap-2">'
      + '<button type="button" class="ph-opt" data-a="upload"><span>🖼️</span>Fotoğraf Yükle</button>'
      + '<button type="button" class="ph-opt" data-a="camera"><span>📷</span>Fotoğraf Çek</button>'
      + '<button type="button" class="ph-opt" data-a="reposition"><span>✥</span>Yeniden Konumlandır</button>'
      + '<button type="button" class="ph-opt" data-a="remove" data-danger><span>🗑️</span>Fotoğrafı Kaldır</button></div><p id="phMsg" class="mt-2 min-h-5 text-sm text-rose-300" role="status"></p></div>';
    edEl = document.createElement('div'); edEl.className = 'ph-sheet'; edEl.hidden = true; edEl.id = 'photoEd';
    edEl.innerHTML = '<div class="ph-bg"></div><div class="ph-panel" role="dialog" aria-modal="true" aria-labelledby="phEdTitle"><h2 id="phEdTitle" class="road text-xl font-semibold"></h2><p class="text-xs text-zinc-400">Sürükleyerek konumlandır, kaydırıcıyla yakınlaştır.</p>'
      + '<div class="ph-frame" id="phFrame"><canvas id="phCanvas"></canvas></div><input id="phZoom" type="range" min="1" max="4" step="0.01" value="1" class="w-full" aria-label="Yakınlaştır">'
      + '<div class="mt-3 grid grid-cols-2 gap-3"><button type="button" class="btn-sec min-h-[48px]" data-ed="cancel">Vazgeç</button><button type="button" class="btn btn-accent min-h-[48px]" data-ed="ok">Kaydet</button></div></div>';
    fileEl = document.createElement('input'); fileEl.type = 'file'; fileEl.accept = 'image/*'; fileEl.className = 'hidden'; fileEl.id = 'photoFile';
    camEl = document.createElement('input'); camEl.type = 'file'; camEl.accept = 'image/*'; camEl.setAttribute('capture', 'user'); camEl.className = 'hidden'; camEl.id = 'photoCam';
    document.body.append(menuEl, edEl, fileEl, camEl);
    menuEl.addEventListener('click', e => { if (e.target.closest('[data-x]')) return close(); const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!edEl.hidden) edClose(); else if (!menuEl.hidden) close(); } });
    [fileEl, camEl].forEach(inp => inp.addEventListener('change', async () => { const f = inp.files[0]; inp.value = ''; if (f) fromFile(f); }));
    edEl.addEventListener('click', e => { const b = e.target.closest('[data-ed]'); if (!b) return; if (b.dataset.ed === 'cancel') edClose(); else edSave(b); });
    $('phZoom').addEventListener('input', () => { if (ed) { ed.z = +$('phZoom').value; clamp(); draw(); } });
    const fr = $('phFrame'); let drag = null;
    fr.addEventListener('pointerdown', e => { if (!ed) return; drag = { x: e.clientX, y: e.clientY, ox: ed.x, oy: ed.y }; fr.setPointerCapture(e.pointerId); });
    fr.addEventListener('pointermove', e => { if (!drag || !ed) return; const k = ed.W / fr.clientWidth; ed.x = drag.ox + (e.clientX - drag.x) * k; ed.y = drag.oy + (e.clientY - drag.y) * k; clamp(); draw(); });
    ['pointerup', 'pointercancel'].forEach(t => fr.addEventListener(t, () => { drag = null; }));
  }

  const msg = t => { const m = $('phMsg'); if (m) m.textContent = t || ''; };
  function close() { menuEl.hidden = true; }
  function menu(k, c) {
    build(); kind = k; cfg = c; const K = KIND[k], has = !!(c.current && c.current());
    $('phTitle').textContent = K.title; msg('');
    menuEl.querySelector('[data-a=reposition]').disabled = !has; menuEl.querySelector('[data-a=remove]').disabled = !has;
    camEl.setAttribute('capture', K.cam); menuEl.hidden = false;
    menuEl.querySelector('[data-a=upload]').focus();
  }
  function act(a) {
    if (a === 'upload') fileEl.click();
    else if (a === 'camera') camEl.click();
    else if (a === 'reposition') loadSrc(cfg.current());
    else if (a === 'remove') (async () => { try { await cfg.remove(); close(); } catch (e) { msg(e.message || 'Kaldırılamadı.'); } })();
  }
  async function fromFile(f) {
    if (!/^image\//.test(f.type)) return msg('Lütfen bir fotoğraf seç.');
    if (f.size > 25 * 1024 * 1024) return msg('Fotoğraf çok büyük (en çok 25 MB).');
    try { loadSrc(URL.createObjectURL(f), true); } catch { msg('Fotoğraf açılamadı.'); }
  }
  function loadSrc(src, revoke) {
    const im = new Image();
    im.onload = () => { if (revoke) URL.revokeObjectURL(src); openEd(im); };
    im.onerror = () => msg('Fotoğraf açılamadı.');
    im.src = src;
  }
  function openEd(im) {
    const K = KIND[kind], fr = $('phFrame'), cv = $('phCanvas');
    const maxW = Math.min(360, Math.floor(innerWidth - 64)), w = K.ratio >= 1 && !K.round ? maxW : Math.min(maxW, 280);
    fr.style.width = w + 'px'; fr.style.height = Math.round(w / K.ratio) + 'px'; fr.classList.toggle('round', K.round);
    cv.width = K.w; cv.height = K.h;
    ed = { im, W: K.w, H: K.h, z: 1, x: 0, y: 0 }; ed.base = Math.max(K.w / im.naturalWidth, K.h / im.naturalHeight);
    $('phZoom').value = 1; $('phEdTitle').textContent = K.title + ' — Konumlandır'; edEl.hidden = false; clamp(); draw();
  }
  function clamp() {   // x,y: görselin merkezinin çerçeve merkezine göre kayması
    const s = ed.base * ed.z, mx = Math.max(0, (ed.im.naturalWidth * s - ed.W) / 2), my = Math.max(0, (ed.im.naturalHeight * s - ed.H) / 2);
    ed.x = Math.max(-mx, Math.min(mx, ed.x)); ed.y = Math.max(-my, Math.min(my, ed.y));
  }
  function draw() {
    const g = $('phCanvas').getContext('2d'), s = ed.base * ed.z, w = ed.im.naturalWidth * s, h = ed.im.naturalHeight * s;
    g.fillStyle = '#000'; g.fillRect(0, 0, ed.W, ed.H); g.drawImage(ed.im, ed.W / 2 + ed.x - w / 2, ed.H / 2 + ed.y - h / 2, w, h);
  }
  function edClose() { edEl.hidden = true; ed = null; }
  async function edSave(b) {
    if (!ed) return; b.disabled = true;
    try { await cfg.save($('phCanvas').toDataURL('image/jpeg', KIND[kind].q)); edClose(); close(); }
    catch (e) { edClose(); msg(e.message || 'Kaydedilemedi.'); } finally { b.disabled = false; }
  }
  root.Photo = { menu, KIND };
})(window);

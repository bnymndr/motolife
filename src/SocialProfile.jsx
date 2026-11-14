import React, { useCallback, useEffect, useRef, useState } from 'react';

/* =====================================================================
   SocialProfile: profil + gönderi akışı + arkadaşlık + canlı mesajlaşma
   Props: { me, socket, theme: 'dark' | 'light' | 'auto', onUnread(n) }
   Sunucu: /api/social/* (REST) ve Socket.IO olayları (dm:*, social:*)
   ===================================================================== */

/* ---------- Yardımcılar ---------- */
const cx = (...a) => a.filter(Boolean).join(' ');

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path.startsWith('/api/') ? path : '/api/social' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'İstek başarısız.');
  return j;
}

// Görsel (JPEG data URL) → ham gövde olarak PUT; boş = kaldır. Kapak/grup fotoğrafı uçları octet-stream kullanır (genel JSON sınırı küçük).
async function putPic(path, dataUrl) {
  const body = dataUrl ? await (await fetch(dataUrl)).blob() : new Blob([]);
  const r = await fetch(path, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Fotoğraf kaydedilemedi.');
  return j;
}
const ROLE_TR = { leader: 'Lider', admin: 'Yönetici', member: 'Üye' };
const isStaff = g => g.role === 'leader' || g.role === 'admin';

const ago = ts => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'az önce';
  if (s < 3600) return Math.round(s / 60) + ' dk önce';
  if (s < 86400) return Math.floor(s / 3600) + ' sa önce';
  if (s < 604800) return Math.floor(s / 86400) + ' gün önce';
  return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
};
const hhmm = ts => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const sortByLast = list => [...list].sort((a, b) => ((b.last && b.last.at) || 0) - ((a.last && a.last.at) || 0));
const totalUnread = list => list.reduce((n, x) => n + x.unread, 0);

const MOODS = {
  mutlu: ['😊', 'Mutlu'], heyecanli: ['🤩', 'Heyecanlı'], havali: ['😎', 'Havalı'], huzurlu: ['😌', 'Huzurlu'],
  asik: ['😍', 'Aşık'], ozgur: ['🏍️', 'Özgür'], enerjik: ['🔥', 'Enerjik'], eglenceli: ['😂', 'Eğleniyor'],
  minnettar: ['🙏', 'Minnettar'], yorgun: ['😴', 'Yorgun'], uzgun: ['😔', 'Üzgün'], kizgin: ['😤', 'Kızgın']
};
const moodText = k => (MOODS[k] ? MOODS[k][0] + ' ' + MOODS[k][1] : '');
const EMOJIS = ('😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😎 🤗 🤔 😏 😴 🥱 😮 😢 😭 😤 😡 🥳 🤯 👍 👎 👏 🙌 🙏 💪 🤝 ✌️ 👋 ' +
  '❤️ 🧡 💛 💚 💙 💜 🖤 🔥 ✨ 🎉 💯 ⚡ 🌟 ☀️ 🌧️ 🌈 🏍️ 🛵 🏁 🛣️ ⛽ 🔧 🧰 🪖 🧤 ⛰️ 🌲 🌊 🍕 ☕ 🍔 🍺').split(' ');

// İmleç konumuna metin ekler (emoji seçici için)
function insertAt(el, value, text, set, max) {
  const a = el && el.selectionStart != null ? el.selectionStart : value.length;
  const b = el && el.selectionEnd != null ? el.selectionEnd : a;
  const next = (value.slice(0, a) + text + value.slice(b)).slice(0, max);
  set(next);
  const pos = Math.min(a + text.length, next.length);
  requestAnimationFrame(() => { if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* bazı tarayıcılarda desteklenmez */ } } });
}

// Fotoğrafı telefonda küçültür: en uzun kenar ≤ 1280 px, JPEG ~380 KB hedefi (net görünür, dosya küçük kalır)
async function compressImage(file, maxSide = 1280, targetBytes = 380 * 1024) {
  if (!/^image\//.test(file.type)) throw new Error('Yalnızca fotoğraf seçebilirsin.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error('Fotoğraf okunamadı. Başka bir fotoğraf dene.'));
      i.src = url;
    });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);          // saydam PNG'lerde siyah zemin olmasın
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.84, blob = null;
    for (let n = 0; n < 5; n++) {
      blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= targetBytes) break;
      q -= 0.1;
    }
    if (!blob || blob.size > 650 * 1024) throw new Error('Fotoğraf çok büyük, daha küçük bir fotoğraf seç.');
    return { blob, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}
async function uploadPhoto(blob) {
  const r = await fetch('/api/social/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Fotoğraf yüklenemedi.');
  return j.image;
}

// Mesaj listesi: aynı id'li mesajı atla, geçici (cid) mesajı sunucudaki kaydıyla değiştir
const upsertThread = (t, name, m) => {
  const cur = t[name] || { list: [], more: false, loaded: false };
  if (cur.list.some(x => x.id === m.id)) return t;
  const i = m.cid ? cur.list.findIndex(x => x.id === m.cid) : -1;
  const list = i >= 0 ? cur.list.map((x, k) => (k === i ? m : x)) : [...cur.list, m];
  return { ...t, [name]: { ...cur, list } };
};
const failThread = (t, name, cid, error) => {
  const cur = t[name];
  if (!cur) return t;
  return { ...t, [name]: { ...cur, list: cur.list.map(x => (x.id === cid ? { ...x, pending: false, failed: true, error } : x)) } };
};

/* ---------- Tasarım sabitleri (açık / koyu tema) ---------- */
const CARD = 'rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm dark:bg-white/[.055] dark:ring-white/10 dark:shadow-none';
const MUTED = 'text-slate-500 dark:text-[#93A4B2]';
const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = BTN + ' bg-amber-400 text-[#031420] hover:bg-amber-300';
const GHOST = BTN + ' bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-white/10 dark:text-[#F4EFE6] dark:hover:bg-white/15';
const DANGER = BTN + ' bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-400/15 dark:text-rose-300 dark:hover:bg-rose-400/25';
const FIELD = 'w-full rounded-xl bg-slate-100 px-3.5 py-2.5 text-[15px] text-slate-900 outline-none ring-1 ring-transparent placeholder:text-slate-400 focus:ring-amber-400 dark:bg-white/[.07] dark:text-[#F4EFE6] dark:placeholder:text-[#667A8A]';

const ICONS = {
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  comment: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.7-.8L3 21l1.9-5.1A8.4 8.4 0 1 1 21 11.5z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  back: 'M15 18l-6-6 6-6',
  down: 'M6 9l6 6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  chat: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.7-.8L3 21l1.9-5.1A8.4 8.4 0 1 1 21 11.5z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  group: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01'
};
function Icon({ name, className = 'h-5 w-5', fill = false }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- Küçük bileşenler ---------- */
function Avatar({ user, size = 40, online }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [user && user.av]);
  const letter = ((user && (user.name || user.username)) || '?').trim().charAt(0).toLocaleUpperCase('tr');
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {user && user.av && !bad ? (
        <img src={`/api/social/avatar/${encodeURIComponent(user.username)}?v=${user.av}`} alt="" onError={() => setBad(true)}
             className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-amber-400 font-bold text-[#031420]"
              style={{ fontSize: size * 0.42 }}>{letter}</span>
      )}
      {online !== undefined && (
        <span className={cx('absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#052437]',
                            online ? 'bg-emerald-400' : 'bg-slate-400')} />
      )}
    </span>
  );
}

function Badge({ n }) {
  if (!n) return null;
  return <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold leading-5 text-white">{n > 99 ? '99+' : n}</span>;
}

// İki adımlı onay: ilk dokunuş "Emin misin?" gösterir, ikinci dokunuş işlemi yapar
function ConfirmButton({ onConfirm, confirmLabel = 'Emin Misin?', className = DANGER, children }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={className} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirmLabel : children}
    </button>
  );
}

function EmojiPanel({ onPick }) {
  return (
    <div className={cx(CARD, 'grid max-h-40 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-0.5 overflow-y-auto p-2')} aria-label="Emoji Seç">
      {EMOJIS.map(e => (
        <button key={e} type="button" onMouseDown={ev => ev.preventDefault()} onClick={() => onPick(e)}
                className="rounded-lg py-1 text-xl leading-none hover:bg-slate-100 dark:hover:bg-white/10">{e}</button>
      ))}
    </div>
  );
}

// Duygu durumu: TEK seçimli liste. inline: kartın içinde hep açık; aksi halde açılır liste (seçince kapanır)
function MoodChips({ value, onChange, inline }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open || inline) return undefined;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open, inline]);
  const pick = k => { onChange(k); setOpen(false); };
  const opt = (on, onClick, children, extra) => (
    <li role="option" aria-selected={on} className={extra}>
      <button type="button" onClick={onClick}
              className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition',
                            on ? 'bg-amber-400 text-[#031420]' : 'text-slate-800 hover:bg-slate-100 dark:text-[#F4EFE6] dark:hover:bg-white/10')}>
        {children}{on && <Icon name="check" className="ml-auto h-4 w-4" />}
      </button>
    </li>
  );
  const list = (
    <ul role="listbox" aria-label="Duygu Durumu" className="grid grid-cols-2 gap-1 p-1.5">
      {opt(!value, () => pick(''), <span>Duygu Durumu Yok</span>, 'col-span-2')}
      {Object.entries(MOODS).map(([k, [emoji, label]]) => opt(value === k, () => pick(k), <><span className="text-lg leading-none">{emoji}</span><span className="truncate">{label}</span></>, ''))}
    </ul>
  );
  const SOLID = 'rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-[#0B2B3D] dark:ring-white/10';
  if (inline) return <div className={SOLID}>{list}</div>;
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)} className={cx(FIELD, 'flex items-center justify-between gap-2 text-left')}>
        <span className={value ? '' : 'text-slate-400 dark:text-[#667A8A]'}>{value ? moodText(value) : 'Duygu Durumu Seç'}</span>
        <Icon name="down" className={cx('h-4 w-4 shrink-0 transition', open && 'rotate-180')} />
      </button>
      {open && <div className={cx(SOLID, 'absolute inset-x-0 z-20 mt-1 max-h-72 overflow-y-auto shadow-xl')}>{list}</div>}
    </div>
  );
}

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div role="dialog" aria-label="Fotoğraf" onClick={onClose} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-3">
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      <button type="button" aria-label="Kapat" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white"><Icon name="x" /></button>
    </div>
  );
}

function Empty({ icon = 'chat', title, text }) {
  return (
    <div className={cx(CARD, 'flex flex-col items-center gap-2 px-6 py-10 text-center')}>
      <Icon name={icon} className={cx('h-9 w-9', MUTED)} />
      <p className="font-semibold">{title}</p>
      {text && <p className={cx('text-sm', MUTED)}>{text}</p>}
    </div>
  );
}

function UserRow({ user, sub, right, online, onClick }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <button type="button" onClick={onClick} className="flex min-w-[9.5rem] flex-1 items-center gap-3 text-left">
        <Avatar user={user} size={44} online={online} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{user.name}</span>
          <span className={cx('block truncate text-xs', MUTED)}>{sub || '@' + user.username}</span>
        </span>
      </button>
      {right && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{right}</div>}
    </div>
  );
}

/* ---------- Gönderiler ---------- */
function usePosts(path, enabled = true, base = '') {      // base: grup gönderileri için '/api/rgroups/<id>'
  const [s, setS] = useState({ posts: [], more: false, loading: enabled, locked: false, error: '' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async before => {
    try {
      const j = await api(path + (before ? (path.includes('?') ? '&' : '?') + 'before=' + before : ''));
      if (!alive.current) return;
      setS(p => ({
        posts: before ? [...p.posts, ...j.posts.filter(x => !p.posts.some(y => y.id === x.id))] : j.posts,
        more: !!j.more, loading: false, locked: !!j.locked, error: ''
      }));
    } catch (e) {
      if (alive.current) setS(p => ({ ...p, loading: false, error: e.message }));
    }
  }, [path]);
  const reload = useCallback(() => { setS(p => ({ ...p, loading: true })); return load(); }, [load]);
  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  const patch = (id, fn) => setS(p => ({ ...p, posts: p.posts.map(x => (x.id === id ? fn(x) : x)) }));
  const flip = x => ({ ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) });
  return {
    ...s, reload,
    loadMore: () => (s.posts.length ? load(s.posts[s.posts.length - 1].at) : undefined),
    prepend: post => setS(p => ({ ...p, posts: [post, ...p.posts] })),
    like: async id => {                                      // iyimser güncelleme, hata olursa geri al
      patch(id, flip);
      try { const j = await api(`${base}/posts/${id}/like`, { method: 'POST' }); patch(id, x => ({ ...x, liked: j.liked, likes: j.likes })); }
      catch { patch(id, flip); }
    },
    comment: async (id, text) => {
      const j = await api(`${base}/posts/${id}/comments`, { method: 'POST', body: { text } });
      patch(id, x => ({ ...x, comments: [...x.comments, j.comment], commentCount: j.commentCount }));
    },
    remove: async id => {
      await api(base + '/posts/' + id, { method: 'DELETE' });
      setS(p => ({ ...p, posts: p.posts.filter(x => x.id !== id) }));
    },
    removeComment: async (id, cid) => {
      await api(`${base}/posts/${id}/comments/${cid}`, { method: 'DELETE' });
      patch(id, x => ({ ...x, comments: x.comments.filter(c => c.id !== cid), commentCount: Math.max(0, x.commentCount - 1) }));
    }
  };
}

function Composer({ self, onPost, postPath = '/posts', placeholder = 'Neler oluyor? Yoldan bir şeyler paylaş…' }) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);                    // { blob, url }
  const [mood, setMood] = useState('');
  const [panel, setPanel] = useState('');                      // '' | 'emoji' | 'mood'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const area = useRef(null);
  const file = useRef(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const choose = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setErr('');
    try { const { blob } = await compressImage(f); setPhoto({ blob, url: URL.createObjectURL(blob) }); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const submit = async e => {
    e.preventDefault();
    const t = text.trim();
    if ((!t && !photo) || busy) return;
    setBusy(true); setErr('');
    try {
      const image = photo ? await uploadPhoto(photo.blob) : '';
      const j = await api(postPath, { method: 'POST', body: { text: t, image, mood } });
      setText(''); setPhoto(null); setMood(''); setPanel(''); onPost(j.post);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const tool = on => cx(GHOST, '!px-3 !py-1.5', on && '!bg-amber-400/25');

  return (
    <form onSubmit={submit} className={cx(CARD, 'space-y-2 p-3')}>
      <div className="flex gap-3">
        <Avatar user={self} size={40} />
        <textarea ref={area} value={text} onChange={e => setText(e.target.value.slice(0, 500))} rows={2}
                  placeholder={placeholder} className={cx(FIELD, 'resize-none')} />
      </div>
      {photo && (
        <div className="relative inline-block">
          <img src={photo.url} alt="Seçilen Fotoğraf" className="max-h-48 rounded-xl object-cover" />
          <button type="button" aria-label="Fotoğrafı Kaldır" onClick={() => setPhoto(null)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white"><Icon name="x" className="h-4 w-4" /></button>
        </div>
      )}
      {mood && (
        <p className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-sm text-amber-700 dark:text-amber-300">
          {moodText(mood)}
          <button type="button" aria-label="Duygu Durumunu Kaldır" onClick={() => setMood('')}><Icon name="x" className="h-3.5 w-3.5" /></button>
        </p>
      )}
      {panel === 'emoji' && <EmojiPanel onPick={em => insertAt(area.current, text, em, setText, 500)} />}
      {panel === 'mood' && <MoodChips inline value={mood} onChange={m => { setMood(m); setPanel(''); }} />}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={choose} />
        <button type="button" disabled={busy} className={tool(!!photo)} aria-label="Fotoğraf Ekle" onClick={() => file.current && file.current.click()}><Icon name="camera" className="h-5 w-5" /></button>
        <button type="button" className={tool(panel === 'mood' || !!mood)} aria-label="Duygu Durumu Ekle" onClick={() => setPanel(p => (p === 'mood' ? '' : 'mood'))}><Icon name="smile" className="h-5 w-5" /></button>
        <button type="button" className={tool(panel === 'emoji')} aria-label="Emoji Ekle" onClick={() => setPanel(p => (p === 'emoji' ? '' : 'emoji'))}><span className="text-lg leading-none">😀</span></button>
        <span className={cx('ml-auto text-xs', text.length > 450 ? 'text-rose-500' : MUTED)}>{text.length}/500</span>
        <button type="submit" disabled={busy || (!text.trim() && !photo)} className={PRIMARY}><Icon name="send" className="h-4 w-4" />{busy ? 'Gönderiliyor…' : 'Paylaş'}</button>
      </div>
      {err && <p className="text-sm text-rose-500">{err}</p>}
    </form>
  );
}

function PostCard({ post, feed, onOpenUser }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(false);
  const send = async e => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr('');
    try { await feed.comment(post.id, t); setText(''); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <article className={cx(CARD, 'p-4')}>
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenUser(post.author.username)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar user={post.author} size={40} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{post.author.name}</span>
            <span className={cx('block truncate text-xs', MUTED)}>@{post.author.username} · {ago(post.at)}</span>
            {post.mood && <span className="mt-0.5 block truncate text-xs font-medium text-amber-700 dark:text-amber-300">{moodText(post.mood)}</span>}
          </span>
        </button>
        {(post.mine || post.canDelete) && (
          <ConfirmButton onConfirm={() => feed.remove(post.id)} confirmLabel="Sil?" className={cx(DANGER, '!px-2.5 !py-1.5')}>
            <Icon name="trash" className="h-4 w-4" />
          </ConfirmButton>
        )}
      </header>
      {post.text && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{post.text}</p>}
      {post.image && (
        <button type="button" onClick={() => setZoom(true)} aria-label="Fotoğrafı Büyüt" className="mt-3 block w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-white/[.06]">
          <img src={post.image} alt="Gönderi Fotoğrafı" loading="lazy" decoding="async" className="max-h-[26rem] w-full object-cover" />
        </button>
      )}
      {zoom && <Lightbox src={post.image} onClose={() => setZoom(false)} />}
      <footer className="mt-3 flex items-center gap-5 text-sm">
        <button type="button" onClick={() => feed.like(post.id)} aria-pressed={post.liked}
                className={cx('inline-flex items-center gap-1.5 font-medium transition', post.liked ? 'text-rose-500' : MUTED)}>
          <Icon name="heart" className="h-5 w-5" fill={post.liked} />{post.likes}
        </button>
        <button type="button" onClick={() => setOpen(o => !o)} className={cx('inline-flex items-center gap-1.5 font-medium', MUTED)}>
          <Icon name="comment" className="h-5 w-5" />{post.commentCount}
        </button>
      </footer>
      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-white/10">
          {post.comments.map(c => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar user={c.author} size={28} />
              <div className="min-w-0 flex-1 rounded-2xl bg-slate-100 px-3 py-2 dark:bg-white/[.07]">
                <p className="text-xs font-semibold">{c.author.name} <span className={cx('font-normal', MUTED)}>· {ago(c.at)}</span></p>
                <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{c.text}</p>
              </div>
              {c.canDelete && feed.removeComment && (
                <ConfirmButton onConfirm={() => feed.removeComment(post.id, c.id).catch(x => setErr(x.message))} confirmLabel="Sil?" className={cx(DANGER, '!self-start !px-2 !py-1')}>
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </ConfirmButton>
              )}
            </div>
          ))}
          <form onSubmit={send} className="flex gap-2">
            <input value={text} onChange={e => setText(e.target.value.slice(0, 300))} placeholder="Yorum Yaz…" className={FIELD} />
            <button type="submit" disabled={busy || !text.trim()} className={PRIMARY} aria-label="Yorum Gönder"><Icon name="send" className="h-4 w-4" /></button>
          </form>
          {err && <p className="text-sm text-rose-500">{err}</p>}
        </div>
      )}
    </article>
  );
}

function PostList({ feed, onOpenUser, emptyTitle, emptyText }) {
  if (feed.loading && !feed.posts.length) return <p className={cx('py-8 text-center text-sm', MUTED)}>Yükleniyor…</p>;
  if (feed.error && !feed.posts.length) return <Empty icon="x" title="Yüklenemedi" text={feed.error} />;
  if (!feed.posts.length) return <Empty title={emptyTitle} text={emptyText} />;
  return (
    <div className="space-y-3">
      {feed.posts.map(p => <PostCard key={p.id} post={p} feed={feed} onOpenUser={onOpenUser} />)}
      {feed.more && <button type="button" onClick={feed.loadMore} className={cx(GHOST, 'w-full')}>Daha Fazla Göster</button>}
    </div>
  );
}

/* ---------- Arkadaşlık düğmeleri ---------- */
function FriendActionsInner({ rel, requestId, username, onDone, onChat }) {
  const [busy, setBusy] = useState(false);
  const act = async fn => {
    setBusy(true);
    try { await fn(); onDone(); } catch (e) { onDone(e.message); }
    setBusy(false);
  };
  if (rel === 'self') return null;
  if (rel === 'friend') {
    return (
      <button type="button" className={PRIMARY} onClick={() => onChat(username)}><Icon name="chat" className="h-4 w-4" />Mesaj Gönder</button>
    );
  }
  if (rel === 'incoming') {
    return (
      <>
        <button type="button" disabled={busy} className={PRIMARY} onClick={() => act(() => api(`/requests/${requestId}/accept`, { method: 'POST' }))}><Icon name="check" className="h-4 w-4" />Kabul Et</button>
        <button type="button" disabled={busy} className={GHOST} onClick={() => act(() => api('/requests/' + requestId, { method: 'DELETE' }))}>Reddet</button>
      </>
    );
  }
  if (rel === 'outgoing') {
    return <button type="button" disabled={busy} className={GHOST} onClick={() => act(() => api('/requests/' + requestId, { method: 'DELETE' }))}>İstek Gönderildi · İptal Et</button>;
  }
  return <button type="button" disabled={busy} className={PRIMARY} onClick={() => act(() => api('/requests', { method: 'POST', body: { username } }))}>Arkadaş Ekle</button>;
}

function FriendActions({ canBlock, ...props }) {
  const { rel, username, onDone } = props;
  const act = fn => async () => { try { await fn(); onDone(); } catch (e) { onDone(e.message); } };
  if (rel === 'blocked') {
    return <button type="button" className={PRIMARY} onClick={act(() => api('/blocks/' + encodeURIComponent(username), { method: 'DELETE' }))}>Engeli Kaldır</button>;
  }
  return (
    <>
      <FriendActionsInner {...props} />
      {canBlock && rel !== 'self' && <ConfirmButton className={DANGER} confirmLabel="Engellensin Mi?" onConfirm={act(() => api('/blocks', { method: 'POST', body: { username } }))}>Engelle</ConfirmButton>}
    </>
  );
}

/* ---------- Profil ---------- */
function EditProfile({ profile, onSaved, toast }) {
  const [bio, setBio] = useState(profile.bio || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api('/profile', { method: 'PUT', body: { bio } }); toast('Biyografi güncellendi'); onSaved(); }
    catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <div className="mt-3 space-y-2">
      <textarea value={bio} onChange={e => setBio(e.target.value.slice(0, 160))} rows={2} placeholder="Kendinden kısaca bahset (160 karakter)" className={cx(FIELD, 'resize-none')} />
      <div className="flex items-center justify-between">
        <span className={cx('text-xs', MUTED)}>{bio.length}/160</span>
        <button type="button" disabled={busy} className={PRIMARY} onClick={save}>Kaydet</button>
      </div>
    </div>
  );
}

function StatusBox({ profile, onSaved, toast }) {
  const [status, setStatus] = useState(profile.status || '');
  const [mood, setMood] = useState(profile.mood || '');
  const [busy, setBusy] = useState(false);
  const save = async e => {
    e.preventDefault();
    setBusy(true);
    try { await api('/profile', { method: 'PUT', body: { status, mood } }); toast(status.trim() || mood ? 'Durum güncellendi' : 'Durum temizlendi'); onSaved(); }
    catch (x) { toast(x.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={save} className={cx(CARD, 'space-y-2 p-3')}>
      <label className={cx('block text-xs font-semibold tracking-wide', MUTED)}>Durum ve Duygu Durumu</label>
      <div className="flex gap-2">
        <input value={status} onChange={e => setStatus(e.target.value.slice(0, 80))} placeholder="Şu an ne yapıyorsun? (ör. sahile sürüş)" className={FIELD} />
        <button type="submit" disabled={busy} className={PRIMARY}>Güncelle</button>
      </div>
      <MoodChips value={mood} onChange={setMood} />
    </form>
  );
}

function ProfileView({ username, self, version, onOpenUser, onChat, onRefresh, onBack, toast }) {
  const isSelf = username === self.username;
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try { setInfo(await api('/users/' + encodeURIComponent(username))); setErr(''); } catch (e) { setErr(e.message); }
  }, [username]);
  useEffect(() => { setInfo(null); setEditing(false); }, [username]);
  useEffect(() => { load(); }, [load, version]);
  const feed = usePosts(`/users/${encodeURIComponent(username)}/posts`, !!info && !info.locked);

  if (err) return <Empty icon="x" title="Profil Açılamadı" text={err} />;
  if (!info) return <p className={cx('py-8 text-center text-sm', MUTED)}>Yükleniyor…</p>;
  const p = info.profile;
  const onDone = msg => { if (msg) toast(msg); onRefresh(); load(); };
  const editCover = () => window.Photo && window.Photo.menu('cover', {
    current: () => (p.cv ? `/api/social/cover/${encodeURIComponent(p.username)}?v=${p.cv}` : ''),
    save: async d => { await putPic('/api/social/cover', d); onDone('Kapak fotoğrafı güncellendi.'); },
    remove: async () => { await putPic('/api/social/cover', ''); onDone('Kapak fotoğrafı kaldırıldı.'); }
  });

  return (
    <div className="space-y-3">
      {!isSelf && onBack && <button type="button" onClick={onBack} className={cx(GHOST, '!px-3')}><Icon name="back" className="h-4 w-4" />Profilim</button>}
      <section className={cx(CARD, 'overflow-hidden')}>
        <div className="relative aspect-[8/3] w-full bg-gradient-to-r from-amber-400 via-[#073049] to-[#031a29]">
          {p.cv && <img src={`/api/social/cover/${encodeURIComponent(p.username)}?v=${p.cv}`} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {isSelf && <button type="button" aria-label="Kapak Fotoğrafını Değiştir" onClick={editCover} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-[#031420]/60 text-lg text-white">📷</button>}
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-10 flex items-end justify-between gap-2">
            <span className="rounded-full ring-4 ring-white dark:ring-[#052437]"><Avatar user={p} size={80} /></span>
            <div className="flex flex-wrap justify-end gap-2">
              {isSelf
                ? <button type="button" className={GHOST} onClick={() => setEditing(e => !e)}>{editing ? 'Vazgeç' : 'Profili Düzenle'}</button>
                : <FriendActions canBlock rel={info.rel} requestId={info.requestId} username={p.username} onDone={onDone} onChat={onChat} />}
            </div>
          </div>
          <h2 className="mt-2 truncate text-xl font-bold">{p.name}</h2>
          <p className={cx('truncate text-sm', MUTED)}>@{p.username}{p.bike ? ' · ' + p.bike : ''}</p>
          {p.bio && !editing && <p className="mt-2 whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{p.bio}</p>}
          {(p.status || p.mood) && !editing && (
            <p className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-sm text-amber-700 dark:text-amber-300">
              {p.mood && <span className="shrink-0">{moodText(p.mood)}</span>}
              {p.status && <span className="truncate">{p.status}</span>}
              <span className="shrink-0 text-xs opacity-70">{ago(p.statusAt)}</span>
            </p>
          )}
          {editing && <EditProfile profile={p} toast={toast} onSaved={() => { setEditing(false); onDone(); }} />}
          <dl className="mt-4 grid grid-cols-3 divide-x divide-slate-200 rounded-xl bg-slate-100 py-2 text-center dark:divide-white/10 dark:bg-white/[.06]">
            {[['Gönderi', p.stats.posts], ['Arkadaş', p.stats.friends], ['Beğeni', p.stats.likes]].map(([k, v]) => (
              <div key={k}><dd className="text-lg font-bold">{v}</dd><dt className={cx('text-xs', MUTED)}>{k}</dt></div>
            ))}
          </dl>
        </div>
      </section>
      {isSelf && <StatusBox profile={p} toast={toast} onSaved={() => onDone()} />}
      {info.locked
        ? <Empty icon="lock" title="Gönderiler Gizli" text="Gönderileri görmek için arkadaş olmanız gerekir." />
        : <PostList feed={feed} onOpenUser={onOpenUser} emptyTitle="Henüz Gönderi Yok" emptyText={isSelf ? 'İlk gönderini Akış sekmesinden paylaş.' : 'Bu kullanıcı henüz bir şey paylaşmadı.'} />}
    </div>
  );
}

/* ---------- Arkadaşlar ---------- */
function FriendsView({ data, version, onOpenUser, onChat, onRefresh, toast }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResults(null); setBusy(false); return undefined; }
    setBusy(true);
    const h = setTimeout(async () => {
      try { setResults((await api('/search?q=' + encodeURIComponent(t))).users); } catch (e) { toast(e.message); }
      setBusy(false);
    }, 300);
    return () => clearTimeout(h);
  }, [q, tick, version, toast]);
  const onDone = msg => { if (msg) toast(msg); onRefresh(); setTick(n => n + 1); };
  const act = fn => async () => { try { await fn(); onDone(); } catch (e) { onDone(e.message); } };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Icon name="search" className={cx('pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2', MUTED)} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Kullanıcı adı ya da isimle ara" className={cx(FIELD, '!pl-10')} />
      </div>

      {results && (
        <section className={cx(CARD, 'divide-y divide-slate-200 px-4 py-2 dark:divide-white/10')}>
          {busy && <p className={cx('py-2 text-sm', MUTED)}>Aranıyor…</p>}
          {!busy && !results.length && <p className={cx('py-3 text-sm', MUTED)}>Sonuç bulunamadı.</p>}
          {results.map(u => (
            <UserRow key={u.username} user={u} onClick={() => onOpenUser(u.username)}
                     right={<FriendActions rel={u.rel} requestId={u.requestId} username={u.username} onDone={onDone} onChat={onChat} />} />
          ))}
        </section>
      )}

      {data.incoming.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-sm font-semibold">Gelen İstekler <Badge n={data.incoming.length} /></h3>
          <div className={cx(CARD, 'divide-y divide-slate-200 px-4 py-1 dark:divide-white/10')}>
            {data.incoming.map(r => (
              <UserRow key={r.id} user={r.user} sub={ago(r.at)} onClick={() => onOpenUser(r.user.username)} right={
                <>
                  <button type="button" className={PRIMARY} aria-label="Kabul Et" onClick={act(() => api(`/requests/${r.id}/accept`, { method: 'POST' }))}><Icon name="check" className="h-4 w-4" />Kabul</button>
                  <button type="button" className={GHOST} aria-label="Reddet" onClick={act(() => api('/requests/' + r.id, { method: 'DELETE' }))}><Icon name="x" className="h-4 w-4" /></button>
                </>
              } />
            ))}
          </div>
        </section>
      )}

      {data.outgoing.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-sm font-semibold">Gönderilen İstekler</h3>
          <div className={cx(CARD, 'divide-y divide-slate-200 px-4 py-1 dark:divide-white/10')}>
            {data.outgoing.map(r => (
              <UserRow key={r.id} user={r.user} sub={'Bekliyor · ' + ago(r.at)} onClick={() => onOpenUser(r.user.username)} right={
                <button type="button" className={GHOST} onClick={act(() => api('/requests/' + r.id, { method: 'DELETE' }))}>İptal Et</button>
              } />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 px-1 text-sm font-semibold">Arkadaşlarım ({data.friends.length})</h3>
        {data.friends.length === 0
          ? <Empty icon="chat" title="Henüz Arkadaşın Yok" text="Yukarıdan kullanıcı arayıp arkadaş ekleyebilirsin." />
          : (
            <div className={cx(CARD, 'divide-y divide-slate-200 px-4 py-1 dark:divide-white/10')}>
              {data.friends.map(f => (
                <UserRow key={f.username} user={f} online={f.online} sub={f.status || (f.online ? 'Çevrimiçi' : '@' + f.username)}
                         onClick={() => onOpenUser(f.username)} right={
                  <>
                    <button type="button" className={PRIMARY} aria-label="Mesaj Gönder" onClick={() => onChat(f.username)}><Icon name="chat" className="h-4 w-4" /></button>
                    <ConfirmButton className={cx(DANGER, '!px-3')} confirmLabel="Emin Misin?" onConfirm={act(() => api('/friends/' + encodeURIComponent(f.username), { method: 'DELETE' }))}>Çıkar</ConfirmButton>
                  </>
                } />
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

/* ---------- Canlı sohbet: solda arkadaş listesi, sağda mesajlaşma ---------- */
function Thread({ friend, state, typing, self, onBack, onSend, onTyping, onOlder, onOpenUser }) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const box = useRef(null);
  const field = useRef(null);
  const list = state ? state.list : [];
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [list.length, friend.username, typing]);
  const submit = e => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(friend.username, t);
    setText(''); setEmoji(false);
  };
  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 px-3 py-2.5 dark:border-white/10">
        <button type="button" onClick={onBack} className={cx(GHOST, '!px-2.5')} aria-label="Geri"><Icon name="back" className="h-4 w-4" /></button>
        <button type="button" onClick={() => onOpenUser(friend.username)} className="flex min-w-0 items-center gap-3 text-left">
          <Avatar user={friend} size={38} online={friend.online} />
          <span className="min-w-0">
            <span className="block truncate font-semibold leading-tight">{friend.name}</span>
            <span className={cx('block text-xs', typing ? 'text-amber-600 dark:text-amber-300' : MUTED)}>{typing ? 'yazıyor…' : friend.online ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
          </span>
        </button>
      </header>
      <div ref={box} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {state && state.more && <button type="button" onClick={() => onOlder(friend.username)} className={cx(GHOST, 'mx-auto !py-1.5 text-xs')}>Daha Eski Mesajlar</button>}
        {!state || !state.loaded ? <p className={cx('py-6 text-center text-sm', MUTED)}>Yükleniyor…</p> : null}
        {state && state.loaded && !list.length && <p className={cx('py-6 text-center text-sm', MUTED)}>İlk mesajı sen gönder.</p>}
        {list.map(m => {
          const mine = m.from === self.username;
          return (
            <div key={m.id} className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
              <div className={cx('max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[15px] [overflow-wrap:anywhere]',
                mine ? 'rounded-br-md bg-amber-400 text-[#031420]' : 'rounded-bl-md bg-slate-200 dark:bg-white/10',
                m.pending && 'opacity-60')}>{m.text}</div>
              <span className={cx('mt-0.5 px-1 text-[11px]', m.failed ? 'text-rose-500' : MUTED)}>
                {m.failed
                  ? <>Gönderilemedi · <button type="button" className="underline" onClick={() => onSend(friend.username, m.text, m.id)}>Tekrar Dene</button></>
                  : m.pending ? 'Gönderiliyor…' : hhmm(m.at) + (mine && m.read ? ' · Okundu' : '')}
              </span>
            </div>
          );
        })}
      </div>
      {emoji && <div className="border-t border-slate-200 p-2 dark:border-white/10"><EmojiPanel onPick={em => { insertAt(field.current, text, em, setText, 1000); onTyping(friend.username); }} /></div>}
      <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 p-3 dark:border-white/10">
        <button type="button" onClick={() => setEmoji(v => !v)} aria-label="Emoji Ekle" aria-pressed={emoji}
                className={cx(GHOST, '!px-3', emoji && '!bg-amber-400/25')}><span className="text-lg leading-none">😀</span></button>
        <input ref={field} value={text} onChange={e => { setText(e.target.value.slice(0, 1000)); onTyping(friend.username); }} placeholder="Mesaj Yaz…" className={FIELD} autoComplete="off" />
        <button type="submit" disabled={!text.trim()} className={PRIMARY} aria-label="Gönder"><Icon name="send" className="h-4 w-4" /></button>
      </form>
    </>
  );
}

function ChatView({ self, friends, threads, active, typing, onPick, onSend, onTyping, onOlder, onOpenUser }) {
  const current = friends.find(f => f.username === active);
  return (
    <div className={cx(CARD, 'flex h-full min-h-0 overflow-hidden')}>
      <aside className={cx('min-h-0 w-full flex-col overflow-y-auto', current ? 'hidden' : 'flex')}>
        {friends.length === 0 && <p className={cx('p-6 text-center text-sm', MUTED)}>Mesajlaşmak için önce arkadaş eklemelisin.</p>}
        {friends.map(f => (
          <button key={f.username} type="button" onClick={() => onPick(f.username)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/[.05]">
            <Avatar user={f} size={44} online={f.online} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{f.name}</span>
                {f.last && <span className={cx('shrink-0 text-[11px]', MUTED)}>{hhmm(f.last.at)}</span>}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className={cx('truncate text-sm', f.unread ? 'font-semibold' : MUTED)}>
                  {typing[f.username] ? 'yazıyor…' : f.last ? (f.last.mine ? 'Sen: ' : '') + f.last.text : f.status || '@' + f.username}
                </span>
                <Badge n={f.unread} />
              </span>
            </span>
          </button>
        ))}
      </aside>
      <section className={cx('min-h-0 min-w-0 flex-1 flex-col', current ? 'flex' : 'hidden')}>
        {current
          ? <Thread friend={current} state={threads[current.username]} typing={!!typing[current.username]} self={self}
                    onBack={() => onPick(null)} onSend={onSend} onTyping={onTyping} onOlder={onOlder} onOpenUser={onOpenUser} />
          : null}
      </section>
    </div>
  );
}

/* ---------- Kök bileşen ---------- */
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="p-6 text-center">
        <p className="font-semibold">Sosyal Bölüm Açılamadı</p>
        <p className="mt-1 text-sm opacity-70">{String(this.state.err.message || this.state.err)}</p>
        <button type="button" className={cx(PRIMARY, 'mt-4')} onClick={() => this.setState({ err: null })}>Tekrar Dene</button>
      </div>
    );
  }
}

/* ---------- Gruplarım ---------- */
// Aynı grup varlığı haritadaki «Grup» sayfasıyla ortaktır (/api/rgroups…): burada açılan grup haritada da görünür.
const fmtDate = ts => new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

function GroupCreate({ onDone, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    if (name.trim().length < 2 || busy) return;
    setBusy(true); setErr('');
    try { const j = await api('/api/rgroups', { method: 'POST', body: { name: name.trim(), desc: desc.trim() } }); onDone(j.group); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={cx(CARD, 'space-y-3 p-4')}>
      <p className="font-semibold">Yeni Grup Oluştur</p>
      <input value={name} onChange={e => setName(e.target.value.slice(0, 40))} placeholder="Grup Adı" aria-label="Grup Adı" className={FIELD} />
      <textarea value={desc} onChange={e => setDesc(e.target.value.slice(0, 200))} rows={3} placeholder="Grubun Açıklaması (İsteğe Bağlı)" aria-label="Grup Açıklaması" className={cx(FIELD, 'resize-none')} />
      {err && <p className="text-sm text-rose-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || name.trim().length < 2} className={cx(PRIMARY, 'flex-1')}>{busy ? 'Oluşturuluyor…' : 'Oluştur'}</button>
        <button type="button" onClick={onCancel} className={GHOST}>Vazgeç</button>
      </div>
    </form>
  );
}

function GroupsView({ self, version, openGid, onOpened, onOpenUser, toast }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('');                        // '' | 'create' | 'join'
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [gid, setGid] = useState(null);
  const load = useCallback(() => api('/api/rgroups').then(j => { setList(j.groups); setErr(''); }).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load, version]);
  useEffect(() => { if (openGid) { setGid(openGid); if (onOpened) onOpened(); } }, [openGid, onOpened]);

  const join = async e => {
    e.preventDefault();
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    try { const j = await api('/api/rgroups/join', { method: 'POST', body: { code: code.trim() } }); setCode(''); setMode(''); await load(); setGid(j.group.id); }
    catch (x) { toast(x.message); }
    setBusy(false);
  };

  if (gid) return <GroupPage self={self} gid={gid} version={version} onBack={() => { setGid(null); load(); }} onOpenUser={onOpenUser} toast={toast} />;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode(m => (m === 'create' ? '' : 'create'))} className={cx(PRIMARY, 'flex-1')}><Icon name="group" className="h-4 w-4" />Grup Oluştur</button>
        <button type="button" onClick={() => setMode(m => (m === 'join' ? '' : 'join'))} className={cx(GHOST, 'flex-1')}>Koda Katıl</button>
      </div>
      {mode === 'create' && <GroupCreate onCancel={() => setMode('')} onDone={g => { setMode(''); load(); setGid(g.id); }} />}
      {mode === 'join' && (
        <form onSubmit={join} className={cx(CARD, 'flex gap-2 p-3')}>
          <input value={code} onChange={e => setCode(e.target.value.toLocaleUpperCase('en').slice(0, 12))} placeholder="Davet Kodu" aria-label="Davet Kodu" autoCapitalize="characters" className={cx(FIELD, 'tracking-widest')} />
          <button type="submit" disabled={busy || code.trim().length < 6} className={PRIMARY}>Katıl</button>
        </form>
      )}
      {!list && !err && <p className={cx('py-8 text-center text-sm', MUTED)}>Yükleniyor…</p>}
      {err && !list && <Empty icon="x" title="Yüklenemedi" text={err} />}
      {list && !list.length && <Empty icon="group" title="Henüz Bir Grubun Yok" text="Bir grup oluştur ya da arkadaşının davet koduyla katıl. Gruplar haritadaki grup sürüşüyle de ortaktır." />}
      {list && list.map(g => (
        <button key={g.id} type="button" onClick={() => setGid(g.id)} className={cx(CARD, 'flex w-full items-center gap-3 p-3 text-left transition hover:ring-amber-400/60')}>
          <GroupPhoto g={g} size={48} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2"><span className="truncate font-semibold">{g.name}</span>
              {g.active && <span className="shrink-0 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">Sürüşte</span>}</span>
            <span className={cx('block truncate text-xs', MUTED)}>{g.count} üye · {g.role === 'leader' ? 'Lider Sensin' : (g.role === 'admin' ? 'Yöneticisin · ' : '') + 'Lider: @' + g.leader}{g.posts ? ' · ' + g.posts + ' gönderi' : ''}</span>
            {g.desc && <span className={cx('mt-0.5 block truncate text-xs', MUTED)}>{g.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function GroupPhoto({ g, size = 48, className = '' }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [g.photo]);
  return g.photo && !bad
    ? <img src={g.photo} alt="" onError={() => setBad(true)} style={{ width: size, height: size }} className={cx('shrink-0 rounded-2xl object-cover', className)} />
    : <span style={{ width: size, height: size, fontSize: size * 0.4 }} className={cx('flex shrink-0 items-center justify-center rounded-2xl bg-amber-400 font-bold text-[#031420]', className)}>{g.name.trim().charAt(0).toLocaleUpperCase('tr')}</span>;
}

function GroupMembers({ g, onOpenUser, act }) {
  const leader = g.role === 'leader', staff = isStaff(g);
  return (
    <div className={cx(CARD, 'divide-y divide-slate-200 px-3 dark:divide-white/10')}>
      {g.members.map(m => (
        <UserRow key={m.username} user={m} onClick={() => onOpenUser(m.username)}
                 sub={[ROLE_TR[m.role] || 'Üye', m.bike, m.sharing ? 'Konumu açık' : ''].filter(Boolean).join(' · ')}
                 right={m.role !== 'leader' && (leader || (staff && m.role === 'member')) && (
                   <>
                     {leader && <ConfirmButton onConfirm={() => act('/role', { username: m.username, role: m.role === 'admin' ? 'member' : 'admin' })} confirmLabel={m.role === 'admin' ? 'Üye Yap?' : 'Yönetici Yap?'} className={cx(GHOST, '!px-2.5 !py-1.5 !text-xs')}>{m.role === 'admin' ? 'Yöneticiliği Al' : 'Yönetici Yap'}</ConfirmButton>}
                     {leader && <ConfirmButton onConfirm={() => act('/leader', { username: m.username })} confirmLabel="Lider Yap?" className={cx(GHOST, '!px-2.5 !py-1.5 !text-xs')}>Lider Yap</ConfirmButton>}
                     <ConfirmButton onConfirm={() => act('/kick', { username: m.username })} confirmLabel="Çıkar?" className={cx(DANGER, '!px-2.5 !py-1.5 !text-xs')}>Çıkar</ConfirmButton>
                   </>
                 )} />
      ))}
    </div>
  );
}

const ROLE_INFO = [
  ['Lider', 'Grubun sahibi. Her şeyi yapar: yönetici atar/alır, lideri devreder, grubu siler; ayrıca yönetici yetkilerinin hepsine sahiptir.'],
  ['Yönetici', 'Grup adı, açıklama, fotoğraf ve kapağı düzenler; davet kodunu yeniler; üyeleri çıkarır (lideri ve diğer yöneticileri çıkaramaz); sürüşü başlatıp bitirir; ana güzergâhı belirler; herkesin gönderi ve yorumunu siler.'],
  ['Üye', 'Gönderi paylaşır, beğenir, yorum yapar, konumunu ve sesini sürüşte paylaşır; istediği zaman ayrılır.']
];
function GroupInfo({ g, act, patch, onLeft, toast }) {
  const leader = g.role === 'leader', staff = isStaff(g);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(g.name);
  const [desc, setDesc] = useState(g.desc || '');
  const link = g.code ? location.origin + '/?grup=' + g.code : '';
  const copy = async txt => { try { await navigator.clipboard.writeText(txt); toast('Kopyalandı'); } catch { toast(txt); } };
  const share = async () => {
    const data = { title: g.name, text: g.name + ' grubuna katıl — Davet kodu: ' + g.code, url: link };
    if (navigator.share) { try { await navigator.share(data); } catch {} } else copy(link);
  };
  const row = (k, v) => <div className="flex items-baseline justify-between gap-3 py-2"><dt className={cx('text-sm', MUTED)}>{k}</dt><dd className="min-w-0 truncate text-right text-sm font-semibold">{v}</dd></div>;
  return (
    <div className="space-y-3">
      <div className={cx(CARD, 'p-4')}>
        {edit ? (
          <form className="space-y-2" onSubmit={e => { e.preventDefault(); patch({ name: name.trim(), desc: desc.trim() }).then(() => setEdit(false)).catch(x => toast(x.message)); }}>
            <input value={name} onChange={e => setName(e.target.value.slice(0, 40))} aria-label="Grup Adı" className={FIELD} />
            <textarea value={desc} onChange={e => setDesc(e.target.value.slice(0, 200))} rows={3} aria-label="Grup Açıklaması" placeholder="Grubun Açıklaması" className={cx(FIELD, 'resize-none')} />
            <div className="flex gap-2"><button type="submit" disabled={name.trim().length < 2} className={cx(PRIMARY, 'flex-1')}>Kaydet</button><button type="button" onClick={() => setEdit(false)} className={GHOST}>Vazgeç</button></div>
          </form>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{g.desc || <span className={MUTED}>Bu grubun henüz bir açıklaması yok.</span>}</p>
            {staff && <button type="button" onClick={() => { setName(g.name); setDesc(g.desc || ''); setEdit(true); }} className={cx(GHOST, 'mt-3')}>Adı ve Açıklamayı Düzenle</button>}
          </>
        )}
      </div>
      <dl className={cx(CARD, 'divide-y divide-slate-200 px-4 dark:divide-white/10')}>
        {row('Lider', '@' + g.leader)}
        {row('Yöneticiler', g.members.filter(m => m.role === 'admin').map(m => '@' + m.username).join(', ') || 'Yok')}
        {row('Rolün', ROLE_TR[g.role] || 'Üye')}
        {row('Kuruluş', fmtDate(g.createdAt))}
        {row('Üye Sayısı', g.members.length)}
        {row('Gönderi Sayısı', g.postCount)}
        {row('Sürüş Durumu', g.ride ? 'Sürüş Devam Ediyor' : 'Sürüş Yok')}
        {row('Ana Güzergâh', g.route ? (g.route.name || 'Belirlendi') + ' · ' + (g.route.len / 1000).toFixed(1).replace('.', ',') + ' km' : 'Belirlenmedi')}
      </dl>
      {staff && g.code && (
        <div className={cx(CARD, 'space-y-2 p-4')}>
          <p className="font-semibold">Davet</p>
          <p className="select-all text-center font-mono text-2xl font-bold tracking-[.3em] text-amber-600 dark:text-amber-300">{g.code}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => copy(g.code)} className={cx(GHOST, 'flex-1')}>Kodu Kopyala</button>
            <button type="button" onClick={share} className={cx(PRIMARY, 'flex-1')}>Bağlantıyı Paylaş</button>
            <ConfirmButton onConfirm={() => act('/code').catch(x => toast(x.message))} confirmLabel="Eski Kod İptal Olur" className={cx(GHOST, 'w-full')}>Kodu Yenile</ConfirmButton>
          </div>
        </div>
      )}
      <details className={cx(CARD, 'p-4')}>
        <summary className="cursor-pointer font-semibold">Roller ve Yetkiler</summary>
        <dl className="mt-2 space-y-2">{ROLE_INFO.map(([k, v]) => <div key={k}><dt className="text-sm font-semibold text-amber-600 dark:text-amber-300">{k}</dt><dd className={cx('text-sm', MUTED)}>{v}</dd></div>)}</dl>
      </details>
      <button type="button" onClick={() => { if (window.openMap) window.openMap(); }} className={cx(GHOST, 'w-full')}>Haritada Grup Sürüşünü Aç</button>
      <div className="flex gap-2">
        <ConfirmButton onConfirm={() => act('/leave').then(onLeft).catch(x => toast(x.message))} confirmLabel="Ayrıl?" className={cx(DANGER, 'flex-1')}>Gruptan Ayrıl</ConfirmButton>
        {leader && <ConfirmButton onConfirm={() => api('/api/rgroups/' + g.id, { method: 'DELETE' }).then(onLeft).catch(x => toast(x.message))} confirmLabel="Grup Silinir!" className={cx(DANGER, 'flex-1')}>Grubu Sil</ConfirmButton>}
      </div>
    </div>
  );
}

/* ---------- Grup etkinlikleri (plan): başlangıç, mola noktaları, varış. Etkinlik oluşturma YALNIZ burada (Sosyal › Gruplarım › grup › Etkinlik).
   «Navigasyonla Başla» haritayı açar ve noktaları sırayla normal yol tarifine bağlar (window.openEventNav, index.html → map.js startEvent). ---------- */
const EV_MAX_STOPS = 8;
const evWhen = ms => (ms ? new Date(ms).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Tarih belirlenmedi');
const evInput = ms => { if (!ms) return ''; const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };

function PointPicker({ label, value, onChange, toast, children }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const search = async () => {
    if (q.trim().length < 3) return toast('En az 3 karakter yaz.');
    setRes('wait');
    try { const j = await api('/api/geocode?q=' + encodeURIComponent(q.trim())); setRes(j.results || []); } catch (x) { setRes(null); toast(x.message); }
  };
  const here = () => {
    if (!navigator.geolocation) return toast('Bu cihazda konum yok.');
    navigator.geolocation.getCurrentPosition(p => onChange({ name: 'Konumum', lat: p.coords.latitude, lon: p.coords.longitude }), () => toast('Konum alınamadı. Tarayıcıda konum izni ver.'), { enableHighAccuracy: true, timeout: 10000 });
  };
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-white/[.04] dark:ring-white/10">
      <div className="flex items-baseline justify-between gap-3"><span className={cx('text-xs', MUTED)}>{label}</span><b className="min-w-0 truncate text-sm" data-ev-val>{value ? value.name : <i className={cx('font-normal', MUTED)}>Seçilmedi</i>}</b></div>
      <div className="flex gap-2">
        <button type="button" onClick={here} className={cx(GHOST, 'flex-1')}>Konumum</button>
        <button type="button" onClick={() => { setOpen(o => !o); setRes(null); }} className={cx(GHOST, 'flex-1')}>{open ? 'Kapat' : 'Ara'}</button>
      </div>
      {children}
      {open && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={q} onChange={e => setQ(e.target.value.slice(0, 120))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} placeholder="Yer ara (ör. Şile)" aria-label={label + ' ara'} className={FIELD} />
            <button type="button" onClick={search} className={PRIMARY}>Ara</button>
          </div>
          {res === 'wait' && <p className={cx('text-sm', MUTED)}>Aranıyor…</p>}
          {Array.isArray(res) && !res.length && <p className={cx('text-sm', MUTED)}>Sonuç bulunamadı.</p>}
          {Array.isArray(res) && res.map((x, i) => (
            <button key={i} type="button" onClick={() => { onChange({ name: String(x.title || '').slice(0, 60), lat: x.lat, lon: x.lon }); setOpen(false); setRes(null); }}
                    className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/10"><b className="block truncate">{x.title}</b><span className={cx('block truncate text-xs', MUTED)}>{x.subtitle}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventForm({ gid, ev, onDone, onCancel, toast }) {
  const [title, setTitle] = useState(ev ? ev.title : '');
  const [at, setAt] = useState(ev ? evInput(ev.at) : '');
  const [note, setNote] = useState(ev ? ev.note || '' : '');
  const [start, setStart] = useState(ev ? ev.start : null);
  const [dest, setDest] = useState(ev ? ev.dest : null);
  const kid = useRef(0);
  const [stops, setStops] = useState(() => (ev ? ev.stops : []).map(x => ({ name: x.name, lat: x.lat, lon: x.lon, _k: ++kid.current })));
  const [drag, setDrag] = useState(null);                 // sürüklenen molanın _k'si
  const lp = useRef(null);
  const gripDown = (e, k) => {
    if (e.button > 0) return; const el = e.currentTarget, pid = e.pointerId; clearTimeout(lp.current);
    const mv = ev2 => {
      const t = document.elementFromPoint(ev2.clientX, ev2.clientY); const row = t && t.closest && t.closest('[data-stop]');
      if (!row) return; const to = row.getAttribute('data-stop');
      setStops(a => { const from = a.findIndex(x => x._k === k), ti = a.findIndex(x => String(x._k) === to); if (from < 0 || ti < 0 || from === ti) return a; const b = a.slice(); b.splice(ti, 0, b.splice(from, 1)[0]); return b; });
    };
    const end = () => { clearTimeout(lp.current); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); setDrag(null); };
    lp.current = setTimeout(() => { try { el.setPointerCapture(pid); } catch (_) {} setDrag(k); if (navigator.vibrate) try { navigator.vibrate(20); } catch (_) {} window.addEventListener('pointermove', mv); }, 350);
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  };
  const [busy, setBusy] = useState(false);
  const setStop = (i, patch) => setStops(a => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const save = async e => {
    e.preventDefault(); if (busy) return;
    const ts = at ? new Date(at).getTime() : null;
    if (title.trim().length < 2) return toast('Etkinlik adı en az 2 karakter olmalı.');
    if (at && !isFinite(ts)) return toast('Tarih geçersiz.');
    if (!start) return toast('Başlangıç yeri seçilmeli.');
    if (!dest) return toast('Varış noktası seçilmeli.');
    if (stops.some(x => !x.name)) return toast('Konumu seçilmemiş bir mola var; seçin ya da kaldırın.');
    setBusy(true);
    try {
      const body = { title: title.trim(), at: ts, note: note.trim(), start, dest, stops: stops.map(({ name, lat, lon }) => ({ name, lat, lon, kind: 'mola' })) };
      const j = await api(`/api/rgroups/${gid}/events${ev ? '/' + ev.id : ''}`, { method: ev ? 'PUT' : 'POST', body });
      toast('Etkinlik kaydedildi.'); if (j.event) window.dispatchEvent(new CustomEvent('ml:event-changed', { detail: { event: j.event } })); onDone(j.events || []);
    } catch (x) { toast(x.message); setBusy(false); }
  };
  return (
    <form onSubmit={save} className={cx(CARD, 'space-y-3 p-4')}>
      <p className="font-semibold">{ev ? 'Etkinliği Düzenle' : 'Yeni Etkinlik'}</p>
      <input value={title} onChange={e => setTitle(e.target.value.slice(0, 60))} placeholder="Etkinlik adı (ör. Şile Turu)" aria-label="Etkinlik adı" className={FIELD} />
      <label className={cx('block text-xs', MUTED)}>Tarih ve saat (isteğe bağlı)<input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} aria-label="Tarih ve saat" className={cx(FIELD, 'mt-1')} /></label>
      <PointPicker label="Başlangıç yeri" value={start} onChange={setStart} toast={toast} />
      {stops.map((x, i) => (
        <div key={x._k} data-stop={x._k} className={cx('rounded-2xl', drag === x._k && 'opacity-70 ring-2 ring-orange-400')}>
          {stops.length > 1 && <div data-grip onPointerDown={e => gripDown(e, x._k)} onContextMenu={e => e.preventDefault()} style={{ touchAction: 'none' }} className={cx('mb-1 flex cursor-grab select-none items-center gap-2 rounded-lg px-2 py-1 text-xs', MUTED)}><span aria-hidden="true">☰</span>Sırayı değiştirmek için basılı tutup sürükleyin</div>}
          <PointPicker label={'Mola ' + (i + 1)} value={x.name ? x : null} onChange={p => setStop(i, p)} toast={toast}>
            <div className="flex gap-2"><button type="button" onClick={() => setStops(a => a.filter((_, k) => k !== i))} className={DANGER}>Kaldır</button></div>
          </PointPicker>
        </div>
      ))}
      {stops.length < EV_MAX_STOPS && <button type="button" onClick={() => setStops(a => [...a, { name: '', lat: 0, lon: 0, _k: ++kid.current }])} className={cx(GHOST, 'w-full')}>+ Mola Noktası Ekle</button>}
      <PointPicker label="Varış noktası" value={dest} onChange={setDest} toast={toast} />
      <input value={note} onChange={e => setNote(e.target.value.slice(0, 200))} placeholder="Not (isteğe bağlı)" aria-label="Not" className={FIELD} />
      <div className="flex gap-2"><button type="submit" disabled={busy} className={cx(PRIMARY, 'flex-1')}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button><button type="button" onClick={onCancel} className={GHOST}>Vazgeç</button></div>
    </form>
  );
}

function GroupEvents({ g, gid, version, toast }) {
  const [list, setList] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState(null);                 // null: liste · {} : yeni · etkinlik: düzenle
  const [err, setErr] = useState('');
  const load = useCallback(() => api(`/api/rgroups/${gid}/events`).then(j => { setList(j.events || []); setCanEdit(!!j.canEdit); setErr(''); }).catch(x => setErr(x.message)), [gid]);
  useEffect(() => { load(); }, [load, version]);
  if (err && !list) return <Empty icon="x" title="Etkinlikler Açılamadı" text={err} />;
  if (!list) return <p className={cx('py-8 text-center text-sm', MUTED)}>Yükleniyor…</p>;
  if (form) return <EventForm gid={gid} ev={form.id ? form : null} toast={toast} onCancel={() => setForm(null)} onDone={l => { setList(l); setForm(null); }} />;
  const go = ev => { if (window.openEventNav) window.openEventNav(ev); else toast('Harita açılamadı.'); };
  return (
    <div className="space-y-3">
      {canEdit && <button type="button" onClick={() => setForm({})} className={cx(PRIMARY, 'w-full')}>+ Yeni Etkinlik</button>}
      {!list.length && <Empty icon="chat" title="Henüz Etkinlik Yok" text={canEdit ? 'Başlangıç, mola ve varış noktalarıyla bir tur planla; üyeler burada görür ve navigasyonla başlar.' : 'Grup lideri ya da yöneticisi etkinlik ekleyebilir.'} />}
      {list.map(ev => (
        <section key={ev.id} className={cx(CARD, 'space-y-2 p-4')} data-ev-card>
          <div><h3 className="text-base font-bold">{ev.title}</h3><p className={cx('text-xs', MUTED)}>{evWhen(ev.at)} · @{ev.by}</p></div>
          <p className="text-sm font-semibold">{ev.start.name} → {ev.dest.name}</p>
          {ev.stops.length > 0 && <ol className="space-y-1 text-sm">{ev.stops.map((x, i) => <li key={i}><span className="mr-1.5 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">Mola</span>{x.name}</li>)}</ol>}
          {ev.note && <p className={cx('text-sm [overflow-wrap:anywhere]', MUTED)}>{ev.note}</p>}
          <button type="button" onClick={() => go(ev)} className={cx(PRIMARY, 'w-full')}>Navigasyonla Başla</button>
          {canEdit && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm(ev)} className={cx(GHOST, 'flex-1')}>Düzenle</button>
              <ConfirmButton className={cx(DANGER, 'flex-1')} confirmLabel="Silinsin mi?" onConfirm={() => api(`/api/rgroups/${gid}/events/${ev.id}`, { method: 'DELETE' }).then(j => setList(j.events || [])).catch(x => toast(x.message))}>Sil</ConfirmButton>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function GroupPage({ self, gid, version, onBack, onOpenUser, toast }) {
  const [g, setG] = useState(null);
  const [err, setErr] = useState('');
  const [sub, setSub] = useState('posts');
  const feed = usePosts(`/api/rgroups/${gid}/posts`, true, `/api/rgroups/${gid}`);
  const reloadFeed = feed.reload;
  const loadG = useCallback(() => api('/api/rgroups/' + gid).then(j => { setG(j.group); setErr(''); }).catch(e => setErr(e.message)), [gid]);
  useEffect(() => { loadG(); }, [loadG, version]);
  useEffect(() => { if (version) reloadFeed(); }, [version, reloadFeed]);     // soket «grp:changed» (yeni gönderi/üye) → yenile
  const act = useCallback(async (path, body) => { const j = await api(`/api/rgroups/${gid}${path}`, { method: 'POST', body: body || {} }); loadG(); return j; }, [gid, loadG]);
  const patch = useCallback(async body => { const j = await api('/api/rgroups/' + gid, { method: 'PATCH', body }); setG(j.group); return j; }, [gid]);

  const editPic = kind => window.Photo && window.Photo.menu(kind, {
    current: () => (g && g[kind]) || '',
    save: async d => { const j = await putPic(`/api/rgroups/${gid}/pic/${kind}`, d); setG(j.group); toast(kind === 'photo' ? 'Grup fotoğrafı güncellendi.' : 'Grup kapağı güncellendi.'); },
    remove: async () => { const j = await putPic(`/api/rgroups/${gid}/pic/${kind}`, ''); setG(j.group); toast('Fotoğraf kaldırıldı.'); }
  });
  if (err && !g) return <div className="space-y-3"><button type="button" onClick={onBack} className={GHOST}><Icon name="back" className="h-4 w-4" />Gruplarım</button><Empty icon="x" title="Grup Açılamadı" text={err} /></div>;
  if (!g) return <p className={cx('py-8 text-center text-sm', MUTED)}>Yükleniyor…</p>;
  const subs = [['posts', 'Gönderiler'], ['members', 'Üyeler (' + g.members.length + ')'], ['events', 'Etkinlik'], ['info', 'Bilgi']];
  return (
    <div className="space-y-3">
      <section className={cx(CARD, 'overflow-hidden')}>
        <div className="relative aspect-[8/3] w-full bg-gradient-to-r from-amber-400 via-[#073049] to-[#031a29]">
          {g.cover && <img src={g.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <button type="button" onClick={onBack} aria-label="Gruplarım" className="absolute left-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-[#031420]/60 text-white"><Icon name="back" className="h-5 w-5" /></button>
          {isStaff(g) && <button type="button" aria-label="Grup Kapağını Değiştir" onClick={() => editPic('cover')} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-[#031420]/60 text-lg text-white">📷</button>}
        </div>
        <div className="flex items-end gap-3 px-4 pb-3">
          <span className="relative -mt-8 rounded-2xl ring-4 ring-white dark:ring-[#052437]">
            <GroupPhoto g={g} size={72} />
            {isStaff(g) && <button type="button" aria-label="Grup Fotoğrafını Değiştir" onClick={() => editPic('photo')} className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-sm text-[#031420]">📷</button>}
          </span>
          <div className="min-w-0 flex-1 pt-2">
            <h2 className="truncate text-lg font-bold">{g.name}</h2>
            <p className={cx('truncate text-xs', MUTED)}>{g.members.length} üye · Lider: @{g.leader}{g.ride ? ' · Sürüşte' : ''}</p>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-white/[.07]" role="tablist">
        {subs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} onClick={() => setSub(id)}
                  className={cx('rounded-lg px-1 py-2 text-xs font-semibold min-[380px]:text-sm', sub === id ? 'bg-amber-400 text-[#031420]' : 'text-slate-600 dark:text-[#C9D0D6]')}>{label}</button>
        ))}
      </div>
      {sub === 'posts' && (
        <div className="space-y-3">
          <Composer self={self} onPost={feed.prepend} postPath={`/api/rgroups/${gid}/posts`} placeholder="Gruba bir şey paylaş…" />
          <PostList feed={feed} onOpenUser={onOpenUser} emptyTitle="Henüz Gönderi Yok" emptyText="Gruba ilk gönderiyi sen paylaş. Gönderileri yalnızca grup üyeleri görür." />
        </div>
      )}
      {sub === 'members' && <GroupMembers g={g} onOpenUser={onOpenUser} act={(p, b) => act(p, b).catch(x => toast(x.message))} />}
      {sub === 'events' && <GroupEvents g={g} gid={gid} version={version} toast={toast} />}
      {sub === 'info' && <GroupInfo g={g} act={act} patch={patch} onLeft={onBack} toast={toast} />}
    </div>
  );
}

function Social({ me, socket, theme = 'dark', onUnread }) {
  const meName = me && me.username;
  const meSig = me ? [me.username, me.firstName, me.lastName, me.avatar ? me.avatar.length : 0].join('|') : '';
  const [self, setSelf] = useState({ username: meName, name: meName, av: '', bio: '', status: '', stats: { posts: 0, friends: 0, likes: 0 } });
  const [tab, setTab] = useState('feed');
  const [profSub, setProfSub] = useState('me');
  const [profileOf, setProfileOf] = useState(null);           // null: kendi profilim
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [], unreadTotal: 0 });
  const [version, setVersion] = useState(0);                  // arkadaşlık değişince profilleri yenilemek için
  const [threads, setThreads] = useState({});
  const [active, setActive] = useState(null);
  const [typing, setTyping] = useState({});
  const [newPosts, setNewPosts] = useState(false);
  const [grpVer, setGrpVer] = useState(0);                    // soket: grup değişti/yeni gönderi → liste ve sayfa yenilenir
  const [openGid, setOpenGid] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [sysDark, setSysDark] = useState(() => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
  const feed = usePosts('/feed');
  const toastTimer = useRef(null);
  const typeTimers = useRef({});
  const typingOut = useRef({ at: 0, timer: null });
  const live = useRef({});
  live.current = { tab, active, meName, friends: data.friends };

  useEffect(() => {
    if (theme !== 'auto' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = e => setSysDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [theme]);
  const dark = theme === 'dark' || (theme === 'auto' && sysDark);

  const toast = useCallback(m => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3200);
  }, []);
  useEffect(() => () => { clearTimeout(toastTimer.current); Object.values(typeTimers.current).forEach(clearTimeout); }, []);

  const loadSelf = useCallback(() => api('/me').then(j => setSelf(j.me)).catch(() => {}), []);
  const loadFriends = useCallback(() => api('/friends').then(setData).catch(() => {}), []);
  const refresh = useCallback(() => { loadFriends(); loadSelf(); setVersion(v => v + 1); }, [loadFriends, loadSelf]);
  useEffect(() => { loadSelf(); }, [loadSelf, meSig]);
  useEffect(() => { loadFriends(); }, [loadFriends]);
  useEffect(() => { if (onUnread) onUnread(data.unreadTotal + data.incoming.length); }, [data.unreadTotal, data.incoming.length, onUnread]);

  const clearUnread = useCallback(name => setData(d => {
    const friends = d.friends.map(x => (x.username === name ? { ...x, unread: 0 } : x));
    return { ...d, friends, unreadTotal: totalUnread(friends) };
  }), []);

  /* --- Canlı olaylar --- */
  useEffect(() => {
    if (!socket) return undefined;
    const onNew = m => {
      const L = live.current, mine = m.from === L.meName, other = mine ? m.to : m.from;
      const viewing = L.tab === 'chat' && L.active === other;
      setThreads(t => upsertThread(t, other, m));
      setTyping(t => ({ ...t, [other]: false }));
      setData(d => {
        const friends = sortByLast(d.friends.map(x => (x.username !== other ? x : {
          ...x, last: { text: m.text, at: m.at, mine }, unread: !mine && !viewing ? x.unread + 1 : x.unread
        })));
        return { ...d, friends, unreadTotal: totalUnread(friends) };
      });
      if (!mine) {
        if (viewing) socket.emit('dm:read', { with: other });
        else { const f = L.friends.find(x => x.username === other); toast((f ? f.name : '@' + other) + ': ' + m.text.slice(0, 40)); }
      }
    };
    const onRead = ({ by }) => setThreads(t => (t[by] ? { ...t, [by]: { ...t[by], list: t[by].list.map(x => (x.from === live.current.meName ? { ...x, read: true } : x)) } } : t));
    const onTypingEv = ({ from, typing: on }) => {
      setTyping(t => ({ ...t, [from]: !!on }));
      clearTimeout(typeTimers.current[from]);
      if (on) typeTimers.current[from] = setTimeout(() => setTyping(t => ({ ...t, [from]: false })), 4000);
    };
    const onPresence = ({ username, online }) => setData(d => ({ ...d, friends: d.friends.map(x => (x.username === username ? { ...x, online } : x)) }));
    const onStatus = ({ username, status }) => setData(d => ({ ...d, friends: d.friends.map(x => (x.username === username ? { ...x, status } : x)) }));
    const onRequest = ({ from }) => { loadFriends(); setVersion(v => v + 1); toast(from.name + ' sana arkadaşlık isteği gönderdi'); };
    const onFriends = () => { loadFriends(); setVersion(v => v + 1); };
    const onPost = () => setNewPosts(true);
    const onNotify = n => { if (n.type === 'comment') toast('@' + n.by + ' gönderine yorum yaptı'); };
    const onGrp = e => { setGrpVer(v => v + 1); if (e && e.kind === 'post' && live.current.tab !== 'groups') toast('@' + e.u + ' grupta paylaşım yaptı'); };
    const onConnect = () => loadFriends();                      // bağlantı yenilenince kaçırılanları topla
    const ev = { 'dm:new': onNew, 'dm:read': onRead, 'dm:typing': onTypingEv, 'social:presence': onPresence, 'social:status': onStatus,
                 'social:request': onRequest, 'social:friends': onFriends, 'social:post': onPost, 'social:notify': onNotify, 'grp:changed': onGrp, connect: onConnect };
    Object.entries(ev).forEach(([k, fn]) => socket.on(k, fn));
    return () => Object.entries(ev).forEach(([k, fn]) => socket.off(k, fn));
  }, [socket, loadFriends, toast]);

  /* --- Eylemler --- */
  const openUser = useCallback(name => { setProfileOf(name === live.current.meName ? null : name); setTab('profile'); }, []);

  const openChat = useCallback(async name => {
    setActive(name);
    if (!name) return;
    setTab('chat');
    clearUnread(name);
    try {
      const j = await api('/messages/' + encodeURIComponent(name));       // sunucu okundu işaretler
      setThreads(t => {
        const local = (t[name] && t[name].list) || [], ids = new Set(j.messages.map(x => x.id));
        const lastAt = j.messages.length ? j.messages[j.messages.length - 1].at : 0;
        return { ...t, [name]: { list: [...j.messages, ...local.filter(x => !ids.has(x.id) && x.at > lastAt)], more: j.more, loaded: true } };
      });
    } catch (e) { toast(e.message); }
  }, [toast, clearUnread]);

  const olderMsgs = useCallback(async name => {
    const first = threads[name] && threads[name].list.find(x => !x.pending && !x.failed);
    if (!first) return;
    try {
      const j = await api(`/messages/${encodeURIComponent(name)}?before=${first.at}`);
      setThreads(t => ({ ...t, [name]: { ...t[name], list: [...j.messages, ...t[name].list], more: j.more } }));
    } catch (e) { toast(e.message); }
  }, [threads, toast]);

  const sendMsg = useCallback((to, text, retryId) => {
    const cid = retryId || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    clearTimeout(typingOut.current.timer); typingOut.current.at = 0;      // mesaj gidince "yazıyor" sayacı sıfırlanır; sonraki tuşta yeniden bildirilir
    const draft = { id: cid, cid, from: live.current.meName, to, text, at: Date.now(), pending: true };
    setThreads(t => {
      const cur = t[to] || { list: [], more: false, loaded: true };
      return { ...t, [to]: { ...cur, list: [...cur.list.filter(x => x.id !== cid), draft] } };
    });
    const done = res => setThreads(t => (res && res.error ? failThread(t, to, cid, res.error) : upsertThread(t, to, res.message)));
    if (socket && socket.connected) {
      socket.timeout(8000).emit('dm:send', { to, text, cid }, (err, res) => done(err ? { error: 'Sunucu yanıt vermedi.' } : res));
    } else {
      api('/messages/' + encodeURIComponent(to), { method: 'POST', body: { text, cid } }).then(done).catch(e => done({ error: e.message }));
    }
  }, [socket]);

  const emitTyping = useCallback(to => {                       // "yazıyor…" bilgisini seyrek gönder
    if (!socket || !socket.connected) return;
    const t = typingOut.current, now = Date.now();
    if (now - t.at > 2000) { socket.emit('dm:typing', { to, typing: true }); t.at = now; }
    clearTimeout(t.timer);
    t.timer = setTimeout(() => { socket.emit('dm:typing', { to, typing: false }); t.at = 0; }, 3000);
  }, [socket]);

  const reloadFeed = () => { setNewPosts(false); feed.reload(); };
  const tabs = [
    { id: 'feed', label: 'Akış' }, { id: 'profile', label: 'Profil', badge: data.incoming.length },
    { id: 'groups', label: 'Gruplarım' }, { id: 'chat', label: 'Mesajlar', badge: data.unreadTotal }
  ];
  const pickTab = id => { if (id === 'profile') { setProfileOf(null); setProfSub('me'); } setTab(id); };
  useEffect(() => {                                           // dışarıdan (harita Grup düğmesi, davet bağlantısı) sekme/grup açma
    const go = d => { if (!d) return; if (d.tab) { if (d.tab === 'friends') { setProfileOf(null); setProfSub('friends'); setTab('profile'); } else setTab(d.tab); } if (d.gid) setOpenGid(d.gid); };
    go(window.__socialGoto); window.__socialGoto = null;
    const fn = e => { go(e.detail); window.__socialGoto = null; };
    window.addEventListener('ml:social-goto', fn);
    return () => window.removeEventListener('ml:social-goto', fn);
  }, []);

  if (!me) return null;
  return (
    <div className={dark ? 'dark' : ''} style={{ height: '100%' }}>
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden text-slate-900 dark:text-[#F4EFE6]">
        <nav className="shrink-0 px-3 pt-3" aria-label="Sosyal Sekmeler">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-white/[.07]">
            {tabs.map(t => (
              <button key={t.id} type="button" onClick={() => pickTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                      className={cx('relative rounded-lg px-0.5 py-2 text-[11px] font-semibold tracking-tight transition max-[339px]:text-[10px] min-[420px]:text-[13px]',
                                    tab === t.id ? 'bg-amber-400 text-[#031420]' : 'text-slate-600 dark:text-[#C9D0D6]')}>
                {t.label}
                {t.badge > 0 && <span className="absolute -top-1.5 right-0 min-w-[1.1rem] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">{t.badge > 99 ? '99+' : t.badge}</span>}
              </button>
            ))}
          </div>
        </nav>
        <div className={cx('min-h-0 min-w-0 flex-1 overflow-x-hidden px-3 pb-3 pt-3', tab === 'chat' ? 'overflow-y-hidden' : 'overflow-y-auto')}>
          {tab === 'feed' && (
            <div className="space-y-3">
              <Composer self={self} onPost={feed.prepend} />
              {newPosts && <button type="button" onClick={reloadFeed} className={cx(PRIMARY, 'w-full')}>Yeni Gönderiler Var · Yenile</button>}
              <PostList feed={feed} onOpenUser={openUser} emptyTitle="Akışın Boş" emptyText="Arkadaş ekle ya da ilk gönderini paylaş." />
            </div>
          )}
          {tab === 'profile' && (
            <div className="space-y-3">
              {!profileOf && (
                <div role="tablist" aria-label="Profil Bölümleri" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-white/[.07]">
                  {[{ id: 'me', label: 'Profilim' }, { id: 'friends', label: 'Arkadaşlar', badge: data.incoming.length }].map(t => (
                    <button key={t.id} type="button" role="tab" aria-selected={profSub === t.id} onClick={() => setProfSub(t.id)}
                            className={cx('relative min-h-[44px] rounded-lg px-2 text-sm font-semibold transition', profSub === t.id ? 'bg-amber-400 text-[#031420]' : 'text-slate-600 dark:text-[#C9D0D6]')}>
                      {t.label}
                      {t.badge > 0 && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{t.badge > 99 ? '99+' : t.badge}</span>}
                    </button>
                  ))}
                </div>
              )}
              {!profileOf && profSub === 'friends'
                ? <FriendsView data={data} version={version} onOpenUser={openUser} onChat={openChat} onRefresh={refresh} toast={toast} />
                : <ProfileView username={profileOf || self.username} self={self} version={version} onOpenUser={openUser} onChat={openChat}
                               onRefresh={refresh} onBack={profileOf ? () => setProfileOf(null) : null} toast={toast} />}
            </div>
          )}
          {tab === 'groups' && <GroupsView self={self} version={grpVer} openGid={openGid} onOpened={() => setOpenGid(null)} onOpenUser={openUser} toast={toast} />}
          {tab === 'chat' && (
            <ChatView self={self} friends={data.friends} threads={threads} active={active} typing={typing}
                      onPick={openChat} onSend={sendMsg} onTyping={emitTyping} onOlder={olderMsgs} onOpenUser={openUser} />
          )}
        </div>
        {toastMsg && (
          <div role="status" className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
            <span className="max-w-full truncate rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-[#F4EFE6] dark:text-[#031420]">{toastMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SocialProfile(props) {
  return <Boundary><Social {...props} /></Boundary>;
}

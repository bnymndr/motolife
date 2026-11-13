'use strict';
/* Cihazdaki sürüş deposu (IndexedDB) ve sunucuya eşitleme. window.RideStore.
   - Her GPS kaydı geldiği anda ayrı yazılır: sayfa kapansa/çökse en fazla son birkaç saniye kaybolur.
   - Sürüş bitince meta.sync = 'pending' olur; çevrimdışıysa kuyrukta bekler, bağlantı gelince sync() gönderir.
   - Sunucu kimlik (id) ile aynı sürüşü ikinci kez kabul etmez (tekrar gönderim zararsızdır).
   - IndexedDB kullanılamıyorsa (ör. bazı gizli sekmeler) bellek yedeği devreye girer; persistent=false olur ve arayüz uyarır.
   - Telemetri (ivme/yatış/olay) sürüşe KİMLİKLE bağlı eş kayıttır ('tele' deposu): saniyelik satırlar 'b<zaman>', tüm olaylar 'e', bitiş durumu 'm'.
     Sürüş kaydı ve doğrulaması değişmez; telemetri sürüş sunucuya ulaştıktan sonra ayrıca (POST /api/rides/:id/tele) gönderilir. */
(function () {
  const DB_NAME = 'motolife-rides';
  const clone = o => JSON.parse(JSON.stringify(o));

  class Mem {
    constructor() { this.m = new Map(); this.f = new Map(); this.t = new Map(); }
    async putMeta(m) { this.m.set(m.id, clone(m)); }
    async getMeta(id) { const m = this.m.get(id); return m ? clone(m) : null; }
    async allMeta() { return [...this.m.values()].map(clone); }
    async addFix(id, seq, f) { let a = this.f.get(id); if (!a) this.f.set(id, a = new Map()); a.set(seq, f); }
    async loadFixes(id) { const a = this.f.get(id); return a ? [...a.entries()].sort((x, y) => x[0] - y[0]).map(e => clone(e[1])) : []; }
    async del(id) { this.m.delete(id); this.f.delete(id); this.t.delete(id); }
    async addTele(id, rows) { let a = this.t.get(id); if (!a) this.t.set(id, a = new Map()); for (const [k, d] of rows) a.set(k, clone(d)); }
    async getTele(id, k) { const a = this.t.get(id), d = a && a.get(k); return d === undefined ? null : clone(d); }
    async loadTele(id) { const a = this.t.get(id); return a ? [...a.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, d]) => ({ k, d: clone(d) })) : []; }
  }

  class Idb {
    async open() {
      this.db = await new Promise((res, rej) => {
        const o = indexedDB.open(DB_NAME, 2);                       // v2: telemetri deposu eklendi (v1 verileri aynen korunur)
        o.onupgradeneeded = e => {
          const d = o.result;
          if (e.oldVersion < 1) { d.createObjectStore('rides', { keyPath: 'id' }); d.createObjectStore('fixes', { keyPath: ['rideId', 'seq'] }); }
          if (!d.objectStoreNames.contains('tele')) d.createObjectStore('tele', { keyPath: ['rideId', 'k'] });
        };
        o.onsuccess = () => res(o.result);
        o.onerror = () => rej(o.error || new Error('IndexedDB açılamadı'));
        o.onblocked = () => rej(new Error('IndexedDB engellendi'));
      });
    }
    _tx(stores, mode, fn) {
      return new Promise((res, rej) => {
        const t = this.db.transaction(stores, mode); let out;
        t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
        t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('İşlem iptal edildi'));
        out = fn(t);
      });
    }
    putMeta(m) { return this._tx(['rides'], 'readwrite', t => t.objectStore('rides').put(m)); }
    getMeta(id) { return this._tx(['rides'], 'readonly', t => t.objectStore('rides').get(id)).then(m => m || null); }
    allMeta() { return this._tx(['rides'], 'readonly', t => t.objectStore('rides').getAll()).then(a => a || []); }
    addFix(id, seq, f) { return this._tx(['fixes'], 'readwrite', t => t.objectStore('fixes').put({ rideId: id, seq, f })); }
    loadFixes(id) { return this._tx(['fixes'], 'readonly', t => t.objectStore('fixes').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))).then(a => (a || []).map(r => r.f)); }
    del(id) { return this._tx(['rides', 'fixes', 'tele'], 'readwrite', t => { t.objectStore('fixes').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])); t.objectStore('tele').delete(IDBKeyRange.bound([id, ''], [id, '\uffff'])); t.objectStore('rides').delete(id); }); }
    addTele(id, rows) { return this._tx(['tele'], 'readwrite', t => { const s = t.objectStore('tele'); for (const [k, d] of rows) s.put({ rideId: id, k, d }); }); }
    getTele(id, k) { return this._tx(['tele'], 'readonly', t => t.objectStore('tele').get([id, k])).then(r => (r ? r.d : null)); }
    loadTele(id) { return this._tx(['tele'], 'readonly', t => t.objectStore('tele').getAll(IDBKeyRange.bound([id, ''], [id, '\uffff']))).then(a => (a || []).map(r => ({ k: r.k, d: r.d }))); }
  }

  const RideStore = {
    persistent: false, s: null, syncing: null,
    async init() {
      if (this.s) return this.persistent;
      try {
        if (!window.indexedDB) throw new Error('IndexedDB yok');
        const s = new Idb(); await s.open();
        await s.putMeta({ id: '__probe', owner: '', status: 'probe' }); await s.del('__probe');   // gerçekten yazılabiliyor mu?
        this.s = s; this.persistent = true;
      } catch (e) { this.s = new Mem(); this.persistent = false; }
      return this.persistent;
    },
    saveMeta(m) { return this.s.putMeta(m); },
    addFix(id, seq, f) { return this.s.addFix(id, seq, f); },
    remove(id) { return this.s.del(id); },
    // Telemetri: rows = [[anahtar, değer], …]. Anahtarlar: 'b'+13 haneli zaman (saniyelik satır), 'e' (tüm olaylar), 'm' (bitiş durumu)
    addTele(id, rows) { return this.s.addTele(id, rows); },
    teleState(id) { return this.s.getTele(id, 'm'); },
    async list(owner) { return (await this.s.allMeta()).filter(m => m.owner === owner && m.status === 'ended').sort((a, b) => b.startedAt - a.startedAt); },   // analiz ekranı: cihazdaki tamamlanmış sürüşler
    async endedIds(owner, n) { return (await this.s.allMeta()).filter(m => m.owner === owner && m.status === 'ended').sort((a, b) => b.startedAt - a.startedAt).slice(0, n || 15).map(m => ({ id: m.id, endedAt: m.endedAt })); },
    async loadTele(id) {
      const rows = await this.s.loadTele(id), out = { bins: [], evs: [], state: null };
      for (const r of rows) { if (r.k[0] === 'b') out.bins.push(r.d); else if (r.k === 'e') out.evs = r.d; else if (r.k === 'm') out.state = r.d; }
      return out;
    },
    // Yarım kalmış (sayfa kapanmış/çökmüş) sürüşler: en yeni önce
    async findOpen(owner) {
      return (await this.s.allMeta()).filter(m => m.owner === owner && (m.status === 'active' || m.status === 'paused')).sort((a, b) => b.startedAt - a.startedAt);
    },
    // Saklanan sürüşü RideCore.Recorder.replay'in beklediği biçimde yükle
    async load(id) {
      const m = await this.s.getMeta(id); if (!m) return null;
      return { meta: m, data: { v: 1, id, startedAt: m.startedAt, endedAt: m.endedAt || 0, events: m.events, fixes: await this.s.loadFixes(id) } };
    },
    async counts(owner) {
      const a = (await this.s.allMeta()).filter(m => m.owner === owner && m.status === 'ended');
      return { total: a.length, pending: a.filter(m => m.sync === 'pending').length, failed: a.filter(m => m.sync === 'failed').length };
    },
    async retryFailed(owner) {
      for (const m of (await this.s.allMeta())) if (m.owner === owner && m.sync === 'failed') { m.sync = 'pending'; delete m.syncError; await this.s.putMeta(m); }
    },
    // Bekleyen (bitmiş, henüz gönderilmemiş) sürüşleri sırayla gönder. onState(id, durum, ileti)
    sync(owner, onState) {
      if (this.syncing) return this.syncing;
      this.syncing = this._sync(owner, onState || (() => {})).finally(() => { this.syncing = null; });
      return this.syncing;
    },
    async _sync(owner, onState) {
      const out = { sent: 0, left: 0, failed: 0, offline: false, auth: false };
      const list = (await this.s.allMeta()).filter(m => m.owner === owner && m.status === 'ended' && m.sync === 'pending').sort((a, b) => a.startedAt - b.startedAt);
      for (const m of list) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { out.offline = true; out.left++; onState(m.id, 'offline'); continue; }
        onState(m.id, 'sending');
        let r;
        try {
          const fixes = await this.s.loadFixes(m.id);
          r = await fetch('/api/rides', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' },
            body: JSON.stringify({ v: 1, id: m.id, startedAt: m.startedAt, endedAt: m.endedAt, events: m.events, fixes }) });
        } catch { out.offline = true; out.left++; onState(m.id, 'offline'); continue; }       // ağ yok / sunucuya ulaşılamadı: kuyrukta kalır
        if (r.ok) { m.sync = 'synced'; m.syncedAt = Date.now(); delete m.syncError; await this.s.putMeta(m); out.sent++; onState(m.id, 'synced'); }
        else if (r.status === 401) { out.auth = true; out.left++; onState(m.id, 'auth'); }
        else if (r.status >= 500 || r.status === 429) { out.left++; onState(m.id, 'retry'); }
        else {                                                                                  // sunucu veriyi reddetti: tekrar denemek işe yaramaz, veri cihazda durur
          const j = await r.json().catch(() => ({}));
          m.sync = 'failed'; m.syncError = j.error || ('HTTP ' + r.status); await this.s.putMeta(m); out.failed++; onState(m.id, 'failed', m.syncError);
        }
      }
      await this._syncTele(owner, out).catch(() => {});
      return out;
    },
    // Sunucuya ulaşmış sürüşlerin bekleyen telemetrisi (sürüş kaydından bağımsız; başarısız olması sürüşü etkilemez)
    async _syncTele(owner, out) {
      const rides = (await this.s.allMeta()).filter(m => m.owner === owner && m.status === 'ended' && m.sync === 'synced').sort((a, b) => b.startedAt - a.startedAt).slice(0, 40);
      for (const m of rides) {
        const st = await this.s.getTele(m.id, 'm');
        if (!st || !st.final || st.sync !== 'pending') continue;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { out.offline = true; continue; }
        const t = await this.loadTele(m.id); let r;
        try {
          r = await fetch('/api/rides/' + encodeURIComponent(m.id) + '/tele', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' },
            body: JSON.stringify({ v: 1, rideId: m.id, meta: st.meta, bins: t.bins, evs: t.evs }) });
        } catch { out.offline = true; continue; }
        if (r.ok) { st.sync = 'synced'; delete st.error; await this.s.addTele(m.id, [['m', st]]); }
        else if (r.status === 401 || r.status === 404 || r.status === 429 || r.status >= 500) continue;     // sonra yeniden denenir
        else { const j = await r.json().catch(() => ({})); st.sync = 'failed'; st.error = j.error || ('HTTP ' + r.status); await this.s.addTele(m.id, [['m', st]]); }   // reddedildi: veri cihazda kalır
      }
    }
  };
  window.RideStore = RideStore;
})();

/* Moto Life — gerçek zamanlı istemci (PHP hosting). Socket.IO istemcisinin uygulamanın kullandığı bölümünü HTTP yoklaması (polling) ile taklit eder:
   io({autoConnect:false}), socket.on/off/emit (ack'li), socket.timeout(ms).emit(..., (err, res) => …), socket.volatile.emit, connect(), disconnect(), connected, id,
   olaylar: connect, disconnect, connect_error (Error('unauthorized')).
   Sunucu: POST /api/rt  { sid, after, emits:[{ev,data,id?}] }  →  { sid, fresh, events:[{id,ev,data}], acks:{id:yanıt}, next(ms), keep }
   Gerçek socket.io (ya da test sahtesi) zaten window.io tanımladıysa hiçbir şey yapmaz. */
(function () {
  'use strict';
  if (window.io) return;
  const URL_RT = '/api/rt';

  function createSocket() {
    const L = new Map();                 // olay → [fn]
    const acks = new Map();              // ack id → { cb, timer, to }
    let outbox = [], seq = 1, sid = '', after = 0, timer = 0, inflight = false, again = false, want = false, fails = 0, wasUp = false, stopped = false;
    const S = { connected: false, id: '', disconnected: true, volatile: null };

    const fire = (ev, ...a) => { for (const f of (L.get(ev) || []).slice()) { try { f(...a); } catch (e) { setTimeout(() => { throw e; }); } } };
    S.on = (ev, fn) => { if (!L.has(ev)) L.set(ev, []); L.get(ev).push(fn); return S; };
    S.off = (ev, fn) => { if (!ev) { L.clear(); return S; } const a = L.get(ev); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); if (!fn) L.delete(ev); } return S; };
    S.once = (ev, fn) => { const w = (...a) => { S.off(ev, w); fn(...a); }; return S.on(ev, w); };

    function queue(ev, args, volatile, to) {
      let cb = null; if (args.length && typeof args[args.length - 1] === 'function') cb = args.pop();
      if (volatile && !S.connected) return S;                           // volatile: bağlı değilken atılır
      const item = { ev, data: args[0] };
      if (volatile) outbox = outbox.filter(x => !(x.volatile && x.ev === ev));   // yalnızca en yeni konum gönderilir
      item.volatile = !!volatile;
      if (cb) {
        const id = seq++; item.id = id;
        const rec = { cb, to: !!to, timer: 0 };
        if (to) rec.timer = setTimeout(() => { acks.delete(id); outbox = outbox.filter(x => x.id !== id); cb(new Error('operation has timed out')); }, to);
        acks.set(id, rec);
      }
      outbox.push(item);
      if (!volatile && want) setTimeout(poll, 0);                         // ack'li/normal olaylar hemen gider
      return S;
    }
    S.emit = (ev, ...args) => queue(ev, args, false, 0);
    S.volatile = { emit: (ev, ...args) => queue(ev, args, true, 0) };
    S.timeout = ms => ({ emit: (ev, ...args) => queue(ev, args, false, ms) });

    function drop(reason) {                                              // bağlantı koptu: bekleyen ack'ler zaman aşımına düşer (kendi zamanlayıcılarıyla)
      if (S.connected) { S.connected = false; S.disconnected = true; fire('disconnect', reason); }
      S.id = '';
    }
    function schedule(ms) { clearTimeout(timer); if (want) timer = setTimeout(poll, ms); }

    async function poll() {
      if (!want) return;
      if (inflight) { again = true; return; }
      inflight = true; again = false; clearTimeout(timer);
      const emits = outbox; outbox = [];
      let res = null, status = 0;
      try {
        const r = await fetch(URL_RT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, after, emits: emits.map(x => ({ ev: x.ev, data: x.data, id: x.id })) }) });
        status = r.status; if (r.ok) res = await r.json();
      } catch (e) { status = 0; }
      inflight = false;
      if (!want) return;
      if (status === 401) {                                              // oturum yok/düştü
        stopped = true; want = false; sid = ''; drop('io server disconnect');
        for (const x of emits) if (x.id && acks.has(x.id)) { const a = acks.get(x.id); acks.delete(x.id); clearTimeout(a.timer); a.cb(a.to ? new Error('unauthorized') : { error: 'Giriş gerekli.' }); }
        fire('connect_error', new Error('unauthorized')); return;
      }
      if (!res) {                                                        // ağ/sunucu hatası: geri çekilerek tekrar dene; gönderilemeyen olaylar geri konur
        outbox = emits.filter(x => !x.volatile).concat(outbox); fails++;
        drop('transport error'); if (fails === 1 || fails % 5 === 0) fire('connect_error', new Error('xhr poll error'));
        schedule(Math.min(15000, 1500 * Math.pow(1.7, fails))); return;
      }
      fails = 0;
      if (res.fresh && S.connected) drop('transport close');             // sunucu oturumu yenilemiş: odalar/paylaşımlar sıfırlandı → uygulama yeniden kursun
      if (res.sid) sid = res.sid;
      if (!S.connected) { S.connected = true; S.disconnected = false; S.id = sid; wasUp = true; fire('connect'); }
      if (res.acks) for (const k of Object.keys(res.acks)) { const a = acks.get(+k); if (!a) continue; acks.delete(+k); clearTimeout(a.timer); a.to ? a.cb(null, res.acks[k]) : a.cb(res.acks[k]); }
      for (const e of res.events || []) { after = Math.max(after, e.id); fire(e.ev, e.data); }
      const hidden = document.hidden && !res.keep;
      schedule(again || outbox.length ? 0 : Math.max(300, hidden ? Math.max(res.next || 4000, 8000) : (res.next || 4000)));
    }

    S.connect = () => { if (want) return S; want = true; stopped = false; fails = 0; poll(); return S; };
    S.disconnect = () => {
      if (!want && !S.connected) return S;
      want = false; clearTimeout(timer);
      if (sid) { try { navigator.sendBeacon(URL_RT, new Blob([JSON.stringify({ sid, bye: 1 })], { type: 'application/json' })); } catch (e) { /* yoksay */ } }
      sid = ''; after = 0; drop('io client disconnect'); return S;
    };
    S.open = S.connect; S.close = S.disconnect;
    S._start = () => S.connect();

    window.addEventListener('pagehide', () => { if (sid) { try { navigator.sendBeacon(URL_RT, new Blob([JSON.stringify({ sid, bye: 1 })], { type: 'application/json' })); } catch (e) { /* yoksay */ } } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && want && !inflight) poll(); });
    window.addEventListener('online', () => { if (want && !inflight) poll(); });
    return S;
  }

  window.io = function io(opts) {
    const s = createSocket();
    if (!opts || opts.autoConnect !== false) s.connect();
    return s;
  };
  window.io.rtPolling = true;
})();

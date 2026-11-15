'use strict';
/* Ses durum makinesi çekirdeği (tarayıcı + Node ortak, saf mantık: ses/DOM/ağ YOK). Aşama 1: yalnız karar katmanı.
   Durumlar: IDLE, SOLO_RIDE, GROUP_RIDE, ON_PHONE_CALL. Kanallar ve öncelik: telefon(3) > interkom(2) > müzik(1).
   Kural (tek yerde, `plan`): telefon aktifse diğer her şey askıda; interkom yalnız GROUP_RIDE'da çalışır; interkomda biri
   konuşuyorsa müzik kısılır (DUCK_GAIN); aksi halde müzik tam ses. Arama bitince temel durum (solo/grup) KORUNDUĞU için
   kullanıcı dokunmadan kalınan yere dönülür; aramada interkom askıdayken `missed` işaretlenir (ileride özet için kanca).
   GSM araması web'de doğrudan algılanamaz: CALL_START/CALL_END olaylarını bir köprü (native/ses kesintisi) gönderecek. */
(function (root) {
  const States = Object.freeze({ IDLE: 'IDLE', SOLO_RIDE: 'SOLO_RIDE', GROUP_RIDE: 'GROUP_RIDE', ON_PHONE_CALL: 'ON_PHONE_CALL' });
  const Channels = Object.freeze({ PHONE: 'phone', INTERCOM: 'intercom', MUSIC: 'music' });
  const Priority = Object.freeze({ phone: 100, intercom: 80, music: 20 });   // sayılar yalnız sıralama içindir (harici taslakla uyumlu)
  const RideState = States, AudioChannel = Object.freeze({ PHONE: 100, INTERCOM: 80, MUSIC: 20 });   // harici TS taslağındaki adlar için takma ad
  const Events = Object.freeze({ START_SOLO: 'START_SOLO', START_GROUP: 'START_GROUP', END_RIDE: 'END_RIDE', CALL_START: 'CALL_START', CALL_END: 'CALL_END', SPEECH: 'SPEECH', MUSIC_WANTED: 'MUSIC_WANTED', HOLD_AFTER_CALL: 'HOLD_AFTER_CALL', BRIEFING_END: 'BRIEFING_END' });
  const DUCK_GAIN = 0.25;
  const initial = () => Object.freeze({ base: States.IDLE, call: false, speech: false, musicWanted: true, missed: false, hold: false, briefing: false });
  const stateOf = c => (c.call ? States.ON_PHONE_CALL : c.base);
  function reduce(c, ev) {
    const t = ev && ev.type; let n = { ...c };
    if (t === Events.START_SOLO) n.base = States.SOLO_RIDE;
    else if (t === Events.START_GROUP) n.base = States.GROUP_RIDE;
    else if (t === Events.END_RIDE) { n.base = States.IDLE; n.speech = false; n.missed = false; n.hold = false; n.briefing = false; }
    else if (t === Events.CALL_START) { n.call = true; n.speech = false; }
    else if (t === Events.CALL_END) { n.call = false; if (c.hold) { n.briefing = true; n.hold = false; } }   // sesli bilgilendirme varsa grup sesi ONDAN SONRA döner
    else if (t === Events.HOLD_AFTER_CALL) n.hold = !!ev.on && c.base === States.GROUP_RIDE;
    else if (t === Events.BRIEFING_END) { n.briefing = false; n.hold = false; }
    else if (t === Events.SPEECH) n.speech = !!ev.on;
    else if (t === Events.MUSIC_WANTED) n.musicWanted = !!ev.on;
    else return c;                                      // bilinmeyen olay: durum değişmez
    if (n.speech && (n.call || n.briefing || n.base !== States.GROUP_RIDE)) n.speech = false;   // konuşma yalnız aktif grup sesinde anlamlı
    return Object.keys(n).every(k => n[k] === c[k]) ? c : Object.freeze(n);   // değişmediyse AYNI nesne
  }
  // Çıktı: kanal başına { act: 'play'|'duck'|'pause'|'off', gain } — arayüz/ses katmanı bunu uygular.
  function plan(c) {
    const st = stateOf(c), out = {};
    const phone = st === States.ON_PHONE_CALL, brief = c.briefing, group = c.base === States.GROUP_RIDE, riding = c.base !== States.IDLE;
    out.phone = { act: phone ? 'play' : 'off', gain: phone ? 1 : 0 };
    out.assistant = brief ? { act: 'play', gain: 1 } : { act: 'off', gain: 0 };
    out.intercom = !group ? { act: 'off', gain: 0 } : (phone || brief) ? { act: 'pause', gain: 0 } : { act: 'play', gain: 1 };
    if (!c.musicWanted) out.music = { act: 'off', gain: 0 };
    else if (phone) out.music = { act: 'pause', gain: 0 };
    else if (brief) out.music = { act: 'duck', gain: DUCK_GAIN };      // asistan konuşurken müzik kısık
    else if (group && c.speech) out.music = { act: 'duck', gain: DUCK_GAIN };
    else out.music = { act: 'play', gain: 1 };
    return { state: st, channels: out, missed: group && (phone || brief) };
  }
  function create() {
    let c = initial(); const subs = [];
    return {
      get ctx() { return c; }, get state() { return stateOf(c); }, plan: () => plan(c),
      dispatch(ev) {
        const prev = c, pp = plan(c); c = reduce(c, ev); const np = plan(c);
        if (np.missed && !pp.missed) c = Object.freeze({ ...c, missed: true });   // aramaya girerken grup sesi kaçırılmaya başladı
        if (c !== prev) subs.slice().forEach(fn => fn(plan(c), ev));
        return plan(c);
      },
      subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    };
  }
  const api = { States, RideState, AudioChannel, Channels, Priority, Events, DUCK_GAIN, initial, reduce, plan, stateOf, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AudioCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

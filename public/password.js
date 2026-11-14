/* Şifre gücü kuralları: tarayıcı (canlı kural listesi) VE Node sunucu AYNI dosyayı kullanır (PHP: php/api/auth.php `pw_check` aynı kuralların portu).
   Kural değişirse üçü birlikte değişir. Yalnız yeni şifre belirlenirken uygulanır; giriş yaparken eski şifreler çalışmaya devam eder. */
(function (root) {
  'use strict';
  const MIN = 10, MAX = 64;
  const COMMON = ['password', 'parola', 'sifre', 'şifre', 'qwerty', 'asdfgh', 'zxcvbn', '123456', '654321', 'abcdef', 'motolife', 'motosiklet', 'motor', 'admin', 'letmein', 'iloveyou', 'welcome', 'istanbul', 'ankara'];
  const lower = s => String(s || '').toLocaleLowerCase('tr');
  const seq = s => {                                   // 4+ ardışık artan/azalan harf ya da rakam (1234, dcba)
    const t = lower(s).replace(/[^\p{L}\p{N}]/gu, '');
    for (let i = 0; i + 3 < t.length; i++) {
      const d = t.charCodeAt(i + 1) - t.charCodeAt(i);
      if ((d === 1 || d === -1) && t.charCodeAt(i + 2) - t.charCodeAt(i + 1) === d && t.charCodeAt(i + 3) - t.charCodeAt(i + 2) === d) return true;
    }
    return false;
  };
  function rules(pw, ctx) {
    pw = String(pw || ''); ctx = ctx || {};
    const low = lower(pw), user = lower(ctx.username), mail = lower(String(ctx.email || '').split('@')[0]);
    return [
      { id: 'len', text: 'En az ' + MIN + ' karakter (en çok ' + MAX + ')', ok: [...pw].length >= MIN && [...pw].length <= MAX },
      { id: 'lower', text: 'Küçük harf (a-z)', ok: /\p{Ll}/u.test(pw) },
      { id: 'upper', text: 'Büyük harf (A-Z)', ok: /\p{Lu}/u.test(pw) },
      { id: 'digit', text: 'Rakam (0-9)', ok: /\p{N}/u.test(pw) },
      { id: 'special', text: 'Özel karakter (. , ! ? - _ @ # $ % …)', ok: /[^\p{L}\p{N}\s]/u.test(pw) },
      { id: 'guess', text: 'Tahmin edilmesi kolay olmamalı (kullanıcı adı, e-posta, 1234, aaa, “sifre” gibi kalıplar yok)',
        ok: !!pw && !(user.length >= 3 && low.includes(user)) && !(mail.length >= 3 && low.includes(mail)) && !/(.)\1\1/u.test(pw) && !seq(pw) && !COMMON.some(w => low.includes(w)) }
    ];
  }
  function check(pw, ctx) { const r = rules(pw, ctx), bad = r.filter(x => !x.ok); return { ok: bad.length === 0, rules: r, failed: bad.map(x => x.id) }; }
  const message = res => res.ok ? '' : 'Şifre yeterince güçlü değil. Eksik: ' + res.rules.filter(x => !x.ok).map(x => x.text.replace(/ \(.*$/, '')).join(', ') + '.';

  /* ---- Tarayıcı: girişin altına canlı kural listesi ---- */
  function attach(input, getCtx) {
    const box = document.createElement('ul'); box.className = 'pw-rules'; box.setAttribute('aria-live', 'polite'); input.insertAdjacentElement('afterend', box);
    const paint = () => {
      const r = check(input.value, getCtx ? getCtx() : {});
      box.innerHTML = r.rules.map(x => `<li data-ok="${x.ok ? 1 : 0}"><span aria-hidden="true">${x.ok ? '✓' : '○'}</span> ${x.text}</li>`).join('');
      box.hidden = !input.value; input.setAttribute('aria-invalid', input.value && !r.ok ? 'true' : 'false'); return r;
    };
    input.addEventListener('input', paint); paint();
    return { paint, check: () => check(input.value, getCtx ? getCtx() : {}) };
  }
  const api = { MIN, MAX, rules, check, message, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Password = api;
})(typeof window !== 'undefined' ? window : globalThis);

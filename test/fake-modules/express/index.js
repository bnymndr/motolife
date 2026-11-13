'use strict';
// Test amaçlı çok küçük express benzeri (gerçek express bu ortamda kurulu değil). Yalnızca projenin kullandığı yüzey: use/get/post/put/patch/delete/set/disable, json/raw/static/Router.
const mk = () => {
  const stack = [];
  const add = (method, path, hs) => hs.flat().forEach(h => stack.push({ method, path, h }));
  const r = (req, res, out) => {
    let i = 0; const base = req.__base || '';
    const next = err => {
      const l = stack[i++]; if (!l) return out ? out(err) : (res.statusCode = 404, res.end());
      if (err) return l.h.length === 4 ? l.h(err, req, res, next) : next(err);
      if (l.method && l.method !== req.method.toLowerCase()) return next();
      const url = req.path.slice(base.length);
      if (l.method) { const re = new RegExp('^' + l.path.replace(/:[a-zA-Z]+/g, '([^/]+)') + '/?$'), m = re.exec(url); if (!m) return next(); req.params = Object.fromEntries((l.path.match(/:[a-zA-Z]+/g) || []).map((k, n) => [k.slice(1), m[n + 1]])); }
      else if (l.path && !(url === l.path || url.startsWith(l.path + '/'))) return next();
      try { if (l.h.length === 4) return next(); const sub = l.h.stack && !l.method; if (sub) { const ob = req.__base; req.__base = base + l.path; return l.h(req, res, e => { req.__base = ob; next(e); }); } l.h(req, res, next); } catch (e) { next(e); }
    };
    next();
  };
  r.stack = stack;
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) r[m] = (p, ...hs) => add(m, p, hs);
  r.use = (p, ...hs) => typeof p === 'function' ? add(null, '', [p, ...hs]) : add(null, p, hs);
  r.set = () => {}; r.disable = () => {};
  return r;
};
const readBody = req => new Promise(res => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
const express = () => {
  const app = mk(), inner = app;
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x'); req.path = u.pathname; req.query = Object.fromEntries(u.searchParams); req.ip = req.socket.remoteAddress; req.secure = false;
    res.set = (k, v) => ((typeof k === 'object' ? Object.entries(k) : [[k, v]]).forEach(([a, b]) => res.setHeader(a, b)), res); res.status = c => (res.statusCode = c, res);
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); }; res.send = s => res.end(s);
    req.__raw = await readBody(req); req.body = {};
    inner(req, res, () => { res.statusCode = 404; res.end(); });
  };
  Object.assign(handler, app); handler.stack = app.stack;
  for (const k of Object.keys(app)) if (typeof app[k] === 'function') handler[k] = app[k];
  return handler;
};
express.Router = mk;
express.json = () => (req, res, next) => { if (/json/.test(req.headers['content-type'] || '') && req.__raw.length) { try { req.body = JSON.parse(req.__raw.toString()); } catch { return res.status(400).json({ error: 'JSON' }); } } next(); };
express.raw = () => (req, res, next) => { req.body = req.__raw; next(); };
express.static = () => (req, res, next) => next();
module.exports = express;

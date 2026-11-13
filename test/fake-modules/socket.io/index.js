'use strict';
// Test amaçlı sahte socket.io: hiçbir bağlantı gelmez, tüm çağrılar etkisizdir.
const noop = () => io;
const io = new Proxy(function () {}, { get: (t, k) => k === 'sockets' ? { sockets: new Map() } : noop });
exports.Server = function () { return io; };

'use strict';
const zlib = require('node:zlib');

// Transport only: res.json still performs the host's original serialization,
// after authorization and storage projection have completed. No body cache or
// compression queue; other requests retain the existing proxy gzip fallback.
const MIN_BYTES = 64 * 1024, MAX_BYTES = 16 * 1024 * 1024;
let active = 0;
function historyResponseCompression(req, res, next) {
    if (req.method !== 'GET') return next();
    const send = res.send;
    res.send = function (body) {
        res.send = send;
        if (res.statusCode !== 200 || res.headersSent || res.getHeader('Content-Encoding') ||
            typeof body !== 'string' || !/^application\/json(?:;|$)/i.test(String(res.getHeader('Content-Type') || '')) ||
            /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(String(res.getHeader('Cache-Control') || ''))) return send.call(res, body);
        const size = Buffer.byteLength(body);
        if (size < MIN_BYTES || size > MAX_BYTES) return send.call(res, body);
        res.vary('Accept-Encoding');
        if (active || req.acceptsEncodings('br', 'gzip', 'identity') !== 'br') return send.call(res, body);
        active++;
        try {
            zlib.brotliCompress(Buffer.from(body), { params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
                [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size
            } }, (failure, compressed) => {
                active--;
                if (res.destroyed || res.writableEnded || res.headersSent) return;
                if (failure || compressed.length >= size) return send.call(res, body);
                res.set('Content-Type', 'application/json; charset=utf-8');
                res.set('Content-Encoding', 'br');
                res.removeHeader('Content-Length');
                send.call(res, compressed);
            });
        } catch {
            active--;
            return send.call(res, body);
        }
        return res;
    };
    next();
}
module.exports = { historyResponseCompression };

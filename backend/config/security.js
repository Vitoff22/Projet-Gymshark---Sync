import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL('../../data/', import.meta.url));
const COOKIE = 'gymshark_session';
const LIFETIME = 30 * 24 * 60 * 60;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function loadSecret() {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const filename = path.join(DATA_DIR, 'session.key');
    if (!existsSync(filename)) {
        try { writeFileSync(filename, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const secret = readFileSync(filename);
    if (secret.length !== 32) throw new Error('Invalid local session key');
    return secret;
}

// This academic application is a local service, not a public authenticated service.
// Origin AND Host checks prevent hostile websites and DNS rebinding from using it.
export function localRequestGuard(req, res, next) {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
    if (!LOCAL_HOSTS.has(req.hostname)) return res.status(403).json({ error: 'Host not allowed' });
    const origin = req.get('Origin');
    if (origin) {
        const port = process.env.FRONTEND_PORT || '8080';
        const allowed = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
        // Swagger's same-origin POSTs use the actual bound port, never a Host
        // or forwarded header supplied by the caller.
        allowed.push(`http://localhost:${req.socket.localPort}`, `http://127.0.0.1:${req.socket.localPort}`);
        if (!allowed.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Credentials', 'true');
        res.vary('Origin');
    }
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        return res.sendStatus(204);
    }
    if (req.method === 'POST' && !req.is('application/json')) {
        return res.status(415).json({ error: 'JSON required' });
    }
    next();
}

export function createSessionMiddleware(secret = loadSecret()) {
    const sign = value => createHmac('sha256', secret).update(value).digest('hex');
    return (req, res, next) => {
        const cookie = (req.get('Cookie') || '').split(';').map(v => v.trim())
            .find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
        const match = /^([a-f0-9]{64})\.([0-9]{10})\.([a-f0-9]{64})$/.exec(cookie);
        let owner;
        if (match && Number(match[2]) > Date.now() / 1000 && Number(match[2]) <= Date.now() / 1000 + LIFETIME + 60) {
            const expected = Buffer.from(sign(`${match[1]}.${match[2]}`), 'hex');
            if (timingSafeEqual(expected, Buffer.from(match[3], 'hex'))) owner = match[1];
        }
        if (!owner) {
            owner = randomBytes(32).toString('hex');
            const value = `${owner}.${Math.floor(Date.now() / 1000) + LIFETIME}`;
            res.cookie(COOKIE, `${value}.${sign(value)}`, { httpOnly: true,
                sameSite: 'strict', secure: req.secure, path: '/api', maxAge: LIFETIME * 1000 });
        }
        req.ownerId = owner;
        next();
    };
}

// Bounded, process-wide quota cannot be reset by discarding the session cookie.
export function createRateLimit({ limit = 60, windowMs = 60000 } = {}) {
    let remaining = limit;
    let resetAt = Date.now() + windowMs;
    return (req, res, next) => {
        if (Date.now() >= resetAt) { remaining = limit; resetAt = Date.now() + windowMs; }
        if (remaining-- <= 0) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
            return res.status(429).json({ error: 'Too many requests; retry later' });
        }
        next();
    };
}

export function safeErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request too large' : status === 400 ? 'Invalid JSON' : 'Internal server error' });
}

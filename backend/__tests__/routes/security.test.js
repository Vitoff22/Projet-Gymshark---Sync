import { jest } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localRequestGuard, createSessionMiddleware, createRateLimit, safeErrorHandler } from '../../config/security.js';

const llm = { generateResponse: jest.fn(), getHealth: jest.fn() };
jest.unstable_mockModule('../../services/llm.js', () => llm);
let server, base, directory;
const request = (endpoint, options = {}) => fetch(base + endpoint, options);
async function session() {
    const response = await request('/api/session');
    await response.json();
    return response.headers.get('set-cookie').split(';')[0];
}
const post = (cookie, body) => request('/api/chat', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gymshark-security-test-'));
    process.env.DATA_DIR = directory;
    const { default: routes } = await import('../../routes/chat.js');
    const app = express();
    app.disable('x-powered-by');
    app.use(localRequestGuard);
    app.use(express.json({ limit: '16kb' }));
    app.use(createSessionMiddleware(Buffer.alloc(32, 7)));
    app.get('/api/session', (req, res) => res.json({ ok: true }));
    app.get('/limited', createRateLimit({ limit: 2 }), (req, res) => res.json({ ok: true }));
    app.use(routes);
    app.use(safeErrorHandler);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    delete process.env.DATA_DIR;
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('gymshark-security-test-')) throw new Error('Unsafe cleanup target');
    await fs.rm(directory, { recursive: true, force: true });
});
beforeEach(() => {
    llm.generateResponse.mockImplementation(async (prompt, { onChunk }) => { onChunk('Hello\n\ndata: forged'); });
    llm.getHealth.mockResolvedValue({ ok: false, error: 'SECRET upstream', url: 'http://internal', details: 'private' });
});
test('hostile origins, null origins and rebinding hosts are rejected before session creation', async () => {
    for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: 'null' }]) {
        const response = await request('/api/session', { headers });
        expect(response.status).toBe(403);
        expect(response.headers.get('set-cookie')).toBeNull();
        await response.text();
    }
    const rebinding = await new Promise(resolve => {
        http.get(base + '/api/session', { headers: { Host: 'attacker.example' } }, response => {
            response.resume(); response.on('end', () => resolve(response.statusCode));
        });
    });
    expect(rebinding).toBe(403);
    const sameOrigin = await request('/api/session', { headers: { Origin: base } });
    expect(sameOrigin.status).toBe(200); await sameOrigin.text();
    const response = await request('/api/session', { headers: { Origin: 'http://localhost:8080' } });
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8080');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
    await response.text();
});
test('known conversation IDs cannot be read, reused or deleted by another browser', async () => {
    const alice = await session(), bob = await session();
    const response = await post(alice, { message: 'Private' });
    const sse = await response.text();
    const id = JSON.parse(sse.split('\n')[0].slice(6)).conversationId;
    expect(sse).toContain('"response":"Hello\\n\\ndata: forged"');
    expect(sse).not.toContain('\n\ndata: forged');
    expect(await (await request('/api/conversations', { headers: { Cookie: bob } })).json()).toEqual([]);
    for (const method of ['GET', 'DELETE']) {
        const denied = await request(`/api/conversations/${id}`, { method, headers: { Cookie: bob } });
        expect(denied.status).toBe(404); await denied.text();
    }
    const denied = await post(bob, { message: 'Hijack', conversationId: id });
    expect(denied.status).toBe(404); await denied.text();
    const own = await request(`/api/conversations/${id}`, { headers: { Cookie: alice } });
    expect(own.status).toBe(200);
    expect((await own.json()).ownerId).toBeUndefined();
    // Alter a signed cookie without knowing its key: a fresh isolated session is issued.
    const forged = alice.slice(0, -1) + (alice.endsWith('0') ? '1' : '0');
    expect(await (await request('/api/conversations', { headers: { Cookie: forged } })).json()).toEqual([]);
});
test('message types, lengths, IDs, JSON size and content type are enforced', async () => {
    const cookie = await session();
    for (const body of [{ message: {} }, { message: ['x'] }, { message: '   ' }, { message: 'x', conversationId: '__proto__' }]) {
        const response = await post(cookie, body); expect(response.status).toBe(400); await response.text();
    }
    const long = await post(cookie, { message: 'x'.repeat(9000) }); expect(long.status).toBe(413); await long.text();
    const huge = await post(cookie, { message: 'x'.repeat(20000) }); expect(huge.status).toBe(413); await huge.text();
    const wrongType = await request('/api/chat', { method: 'POST', body: 'message=test' });
    expect(wrongType.status).toBe(415); await wrongType.text();
    const broken = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'broken{' });
    expect(broken.status).toBe(400); expect(await broken.text()).not.toContain('SyntaxError');
});
test('upstream errors and health responses do not expose provider details', async () => {
    const cookie = await session();
    llm.generateResponse.mockRejectedValue(new Error('SECRET provider response'));
    const response = await post(cookie, { message: 'x' });
    const text = await response.text(); expect(text).toContain('event: error'); expect(text).not.toContain('SECRET');
    const health = await request('/api/llm/health', { headers: { Cookie: cookie } });
    expect(await health.json()).toEqual({ ok: false, modelAvailable: false });
    const diagnostic = await request('/api/test-stream'); expect(diagnostic.status).toBe(404); await diagnostic.text();
});
test('rate limiting returns a retry delay', async () => {
    for (let i = 0; i < 2; i++) await (await request('/limited')).text();
    const response = await request('/limited'); expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0); await response.text();
});
test('oversized model output is stopped and not persisted', async () => {
    const cookie = await session();
    llm.generateResponse.mockImplementation(async (prompt, { onChunk, signal }) => {
        onChunk('x'.repeat(64001)); expect(signal.aborted).toBe(true);
    });
    const response = await post(cookie, { message: 'x' });
    expect(await response.text()).toContain('event: error');
    expect(await (await request('/api/conversations', { headers: { Cookie: cookie } })).json()).toEqual([]);
});
test('concurrent generation is rejected and a disconnect aborts provider work', async () => {
    const cookie = await session();
    let abortObserved;
    const aborted = new Promise(resolve => { abortObserved = resolve; });
    llm.generateResponse.mockImplementation((prompt, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { abortObserved(); reject(new Error('Aborted')); }, { once: true });
    }));
    const first = await post(cookie, { message: 'x' });
    const second = await post(cookie, { message: 'y' });
    expect(second.status).toBe(429); await second.text();
    await first.body.cancel();
    await aborted;
});

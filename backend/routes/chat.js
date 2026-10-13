import express from 'express';
import { randomUUID } from 'node:crypto';
import { generateResponse, getHealth } from '../services/llm.js';
import { getConversation, saveConversation, deleteConversation, listConversations } from '../services/history.js';
import logger from '../logger.js';

const router = express.Router();
const active = new Set();
const validId = id => typeof id === 'string' && /^conv_[a-zA-Z0-9_-]{1,80}$/.test(id);
const publicConversation = ({ ownerId, ...conversation }) => conversation;

// Even if mounted elsewhere, routes require the server's session middleware.
router.use('/api', (req, res, next) => {
    if (!req.ownerId) return res.status(401).json({ error: 'Session required' });
    next();
});

async function streamChat(req, res) {
    const { message, conversationId } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Missing message' });
    if (message.length > 8000) return res.status(413).json({ error: 'Message too long (8000 characters maximum)' });
    if (conversationId != null && !validId(conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' });
    if (active.has(req.ownerId) || active.size >= 2) return res.status(429).json({ error: 'Generation already in progress; retry later' });
    active.add(req.ownerId);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 120000);
    const onClose = () => controller.abort();
    res.once('close', onClose);
    try {
        const saved = conversationId ? await getConversation(conversationId, req.ownerId) : null;
        if (conversationId && !saved) return res.status(404).json({ error: 'Conversation not found' });
        if (!conversationId && (await listConversations(req.ownerId)).length >= 100) {
            return res.status(409).json({ error: 'Conversation limit reached; delete an old conversation' });
        }
        const convId = conversationId || `conv_${randomUUID()}`;
        const history = saved?.messages || [];
        const prompt = [...history.slice(-16).map(entry => `${entry.role === 'assistant' ? 'Assistant' : 'Utilisateur'}: ${entry.content}`),
            `Utilisateur: ${message}`, 'Assistant:'].join('\n');
        const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT);
        const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 60000) : 60000;
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
        res.flushHeaders?.();
        res.write(`data: ${JSON.stringify({ type: 'meta', conversationId: convId })}\n\n`);
        let reply = '';
        await generateResponse(prompt, { timeoutMs, signal: controller.signal,
            onChunk(chunk) {
                if (controller.signal.aborted || typeof chunk !== 'string') return;
                if (reply.length + chunk.length > 64000) { controller.abort(); return; }
                reply += chunk;
                // JSON prevents model output from injecting SSE control/meta events.
                res.write(`data: ${JSON.stringify({ response: chunk })}\n\n`);
            },
            onReasoning() {
                if (!controller.signal.aborted) res.write('data: {"type":"reasoning"}\n\n');
            }
        });
        if (controller.signal.aborted) throw new Error('Generation stopped');
        await saveConversation(convId, [...history, { role: 'user', content: message }, { role: 'assistant', content: reply.trim() }], undefined, req.ownerId);
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        logger.warn('Generation or conversation storage failed', 'routes/chat.js');
        if (!res.destroyed) {
            if (res.headersSent) {
                res.write(`event: error\ndata: ${JSON.stringify({ message: 'LLM error: response unavailable; retry later' })}\n\n`);
                res.end();
            } else res.status(500).json({ error: 'Conversation unavailable' });
        }
    } finally {
        clearTimeout(deadline);
        res.off('close', onClose);
        active.delete(req.ownerId);
    }
}
router.post('/api/chat', streamChat);
router.get('/api/conversations', async (req, res) => res.json(await listConversations(req.ownerId)));
router.get('/api/conversations/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    const conversation = await getConversation(req.params.id, req.ownerId);
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    res.json(publicConversation(conversation));
});
router.delete('/api/conversations/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    if (active.has(req.ownerId)) return res.status(409).json({ error: 'Wait for the current generation to finish' });
    if (!await deleteConversation(req.params.id, req.ownerId)) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
});
router.get('/api/llm/health', async (req, res) => {
    const health = await getHealth({ timeoutMs: 5000 });
    // Never disclose upstream responses, internal URLs or provider credentials.
    res.status(health.ok ? 200 : 503).json({ ok: Boolean(health.ok), modelAvailable: Boolean(health.modelAvailable) });
});
router.get('/api/test-stream', (req, res) => {
    if (process.env.ENABLE_TEST_STREAM !== 'true') return res.sendStatus(404);
    req.body = { message: 'Say hello in 5 words' };
    return streamChat(req, res);
});
export default router;

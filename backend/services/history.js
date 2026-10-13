import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL('../../data/', import.meta.url));
const HISTORY_FILE = path.join(DATA_DIR, 'conversations.json');
const MAX_FILE_BYTES = 20 * 1024 * 1024;
let writes = Promise.resolve();

function isOwned(conversation, ownerId) {
    return typeof ownerId === 'string' && ownerId.length > 0 && conversation?.ownerId === ownerId;
}
function validId(id) { return typeof id === 'string' && /^conv_[a-zA-Z0-9_-]{1,80}$/.test(id); }
async function loadAll() {
    try {
        const raw = await fs.readFile(HISTORY_FILE, 'utf8');
        if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error('History size limit reached');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid history file');
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') return Object.create(null);
        // Fail closed: never erase existing conversations after a read/parse failure.
        throw error;
    }
}
async function update(mutate) {
    const operation = writes.then(async () => {
        const data = await loadAll();
        const result = mutate(data);
        const serialized = JSON.stringify(data);
        if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new Error('History size limit reached');
        await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
        const temporary = `${HISTORY_FILE}.tmp`;
        await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, HISTORY_FILE);
        return result;
    });
    writes = operation.catch(() => {});
    return operation;
}
export async function getConversation(id, ownerId) {
    if (!validId(id)) return null;
    await writes;
    const all = await loadAll();
    return Object.hasOwn(all, id) && isOwned(all[id], ownerId) ? all[id] : null;
}
export async function saveConversation(id, messages, title, ownerId) {
    if (!validId(id) || typeof ownerId !== 'string' || !ownerId) throw new Error('Invalid conversation owner');
    return update(all => {
        const existing = Object.hasOwn(all, id) ? all[id] : null;
        if (existing && !isOwned(existing, ownerId)) throw new Error('Conversation unavailable');
        if (!existing && (Object.keys(all).length >= 1000 || Object.values(all).filter(c => isOwned(c, ownerId)).length >= 100)) {
            throw new Error('Conversation limit reached');
        }
        const first = messages.find(m => m.role === 'user')?.content?.trim() || 'Nouvelle conversation';
        const autoTitle = first.length > 60 ? `${first.slice(0, 57)}...` : first;
        const now = new Date().toISOString();
        all[id] = { id, ownerId, title: title || existing?.title || autoTitle,
            messages: messages.slice(-200), createdAt: existing?.createdAt || now, updatedAt: now };
    });
}
export async function deleteConversation(id, ownerId) {
    if (!validId(id)) return false;
    return update(all => {
        if (!Object.hasOwn(all, id) || !isOwned(all[id], ownerId)) return false;
        delete all[id];
        return true;
    });
}
export async function listConversations(ownerId) {
    await writes;
    const all = await loadAll();
    return Object.values(all).filter(c => isOwned(c, ownerId)).map(({ id, title, createdAt, updatedAt }) =>
        ({ id, title, createdAt, updatedAt })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

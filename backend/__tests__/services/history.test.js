import { jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let history, directory;
const messages = [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Bienvenue' }];
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gymshark-history-test-'));
    process.env.DATA_DIR = directory;
    jest.resetModules();
    history = await import('../../services/history.js');
});
afterEach(async () => {
    delete process.env.DATA_DIR;
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('gymshark-history-test-')) throw new Error('Unsafe cleanup target');
    await fs.rm(directory, { recursive: true, force: true });
});
const save = (id = 'conv_one', owner = 'alice', content = messages, title) => history.saveConversation(id, content, title, owner);

test('owner can save, read, list and delete their conversation', async () => {
    await save();
    expect((await history.getConversation('conv_one', 'alice')).messages).toEqual(messages);
    expect(await history.listConversations('alice')).toEqual([expect.objectContaining({ id: 'conv_one', title: 'Bonjour' })]);
    expect((await history.listConversations('alice'))[0].messages).toBeUndefined();
    expect(await history.deleteConversation('conv_one', 'alice')).toBe(true);
    expect(await history.getConversation('conv_one', 'alice')).toBeNull();
});
test('another browser cannot list, read, overwrite or delete a known ID', async () => {
    await save();
    expect(await history.listConversations('bob')).toEqual([]);
    expect(await history.getConversation('conv_one', 'bob')).toBeNull();
    expect(await history.deleteConversation('conv_one', 'bob')).toBe(false);
    await expect(save('conv_one', 'bob')).rejects.toThrow('unavailable');
    expect((await history.getConversation('conv_one', 'alice')).messages).toEqual(messages);
});
test('missing owner and prototype keys cannot bypass ownership', async () => {
    await save();
    expect(await history.getConversation('conv_one')).toBeNull();
    expect(await history.listConversations()).toEqual([]);
    for (const id of ['__proto__', 'constructor', '../conv_one']) {
        await expect(save(id)).rejects.toThrow();
        expect(await history.getConversation(id, 'alice')).toBeNull();
    }
});
test('legacy ownerless histories remain private and are not silently claimed', async () => {
    await fs.writeFile(path.join(directory, 'conversations.json'), JSON.stringify({ conv_old: { id: 'conv_old', messages } }));
    expect(await history.listConversations('alice')).toEqual([]);
    expect(await history.getConversation('conv_old', 'alice')).toBeNull();
    await expect(save('conv_old')).rejects.toThrow();
});
test('parallel updates do not lose conversations', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => save(`conv_${i}`)));
    expect(await history.listConversations('alice')).toHaveLength(20);
});
test('corrupt history fails closed without overwriting the file', async () => {
    const filename = path.join(directory, 'conversations.json');
    await fs.writeFile(filename, 'broken{');
    await expect(save()).rejects.toThrow();
    expect(await fs.readFile(filename, 'utf8')).toBe('broken{');
});
test('titles, original creation date and bounded retention are preserved', async () => {
    await save('conv_one', 'alice', [{ role: 'user', content: 'x'.repeat(80) }]);
    const original = await history.getConversation('conv_one', 'alice');
    expect(original.title).toHaveLength(60);
    await save('conv_one', 'alice', Array(240).fill(messages[0]), 'Custom title');
    const updated = await history.getConversation('conv_one', 'alice');
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.title).toBe('Custom title');
    expect(updated.messages).toHaveLength(200);
});
test('conversation storage has a per-browser quota', async () => {
    await Promise.all(Array.from({ length: 100 }, (_, i) => save(`conv_${i}`)));
    await expect(save('conv_extra')).rejects.toThrow('limit');
    await history.deleteConversation('conv_0', 'alice');
    await save('conv_extra');
});

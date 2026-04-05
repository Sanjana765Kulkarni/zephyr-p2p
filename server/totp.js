/**
 * Server-side TOTP handler (HMAC-SHA1, RFC 6238).
 * 6 digits, 30-second windows, 5-minute TTL (10 windows).
 * Codes stored in memory only. Deleted immediately on match.
 */

import { createHmac } from 'crypto';

/** @type {Map<string, { peerId: string, expiresAt: number }>} */
const codeStore = new Map();

const WINDOW_SECONDS = 30;
const TTL_WINDOWS = 10; // 5 minutes
const DIGITS = 6;

// Shared TOTP secret for server-side code verification (arbitrary bytes)
// In a real deployment this would be per-device, derived at registration.
// Here the client sends the code and we verify it against our stored code map.

function generateTOTP(secret, window) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(window));
    const hmac = createHmac('sha1', secret);
    hmac.update(counter);
    const digest = hmac.digest();
    const offset = digest[19] & 0x0f;
    const code =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);
    return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function currentWindow() {
    return Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
}

/**
 * Client sends CODE_REGISTER with { code } — we store it mapped to peer's ID.
 */
export function handleCodeRegister(peerId, ws, payload) {
    const { code } = payload;
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        ws.send(JSON.stringify({ type: 'CODE_REGISTER', payload: { success: false, error: 'Invalid code format' } }));
        return;
    }
    // Remove any existing code for this peer
    for (const [k, v] of codeStore.entries()) {
        if (v.peerId === peerId) codeStore.delete(k);
    }
    const expiresAt = Date.now() + WINDOW_SECONDS * TTL_WINDOWS * 1000;
    codeStore.set(code, { peerId, expiresAt });
    ws.send(JSON.stringify({ type: 'CODE_REGISTER', payload: { success: true } }));
}

/**
 * Sender sends CODE_MATCH with { code } — we look up target peer and return their ID.
 * Deletes code immediately on match.
 */
export function handleCodeMatch(peerId, ws, payload, peers) {
    const { code } = payload;
    if (!code || typeof code !== 'string') {
        ws.send(JSON.stringify({ type: 'CODE_MATCH', payload: { success: false, error: 'Missing code' } }));
        return;
    }

    // Purge expired codes
    const now = Date.now();
    for (const [k, v] of codeStore.entries()) {
        if (v.expiresAt < now) codeStore.delete(k);
    }

    const entry = codeStore.get(code);
    if (!entry) {
        ws.send(JSON.stringify({ type: 'CODE_MATCH', payload: { success: false, error: 'Code not found or expired' } }));
        return;
    }

    if (entry.peerId === peerId) {
        ws.send(JSON.stringify({ type: 'CODE_MATCH', payload: { success: false, error: 'Cannot match your own code' } }));
        return;
    }

    const targetPeer = peers.get(entry.peerId);
    if (!targetPeer) {
        codeStore.delete(code);
        ws.send(JSON.stringify({ type: 'CODE_MATCH', payload: { success: false, error: 'Peer disconnected' } }));
        return;
    }

    // Delete immediately — single use
    codeStore.delete(code);

    ws.send(JSON.stringify({
        type: 'CODE_MATCH',
        payload: { success: true, targetId: entry.peerId, targetName: targetPeer.name },
    }));
    // Also notify the target that someone has matched their code
    targetPeer.ws.send(JSON.stringify({
        type: 'CODE_MATCHED',
        payload: { fromId: peerId, fromName: peers.get(peerId)?.name || 'Unknown' },
    }));
}

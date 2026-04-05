/**
 * ZEPHYR-1 Signalling Server — Entry Point
 * Pure WebSocket server on port 7473. No HTTP routes.
 * Dispatches JSON envelope messages to handler modules.
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';

import { handleMessage, evictPeer, registerPeer } from './rooms.js';
import { startMdns } from './mdns.js';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 7473;

// HTTP Server for basic health checks (prevents "Upgrade Required" on standard HTTP requests)
const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Zephyr Signalling Server is Online!');
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
    console.log(`[ZEPHYR-1] Signalling server listening on port ${PORT}`);
});

startMdns(PORT);

wss.on('connection', (ws) => {
    const peerId = randomUUID();

    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            // Binary data: should not arrive here before handshake — ignore
            return;
        }
        try {
            const msg = JSON.parse(data.toString());
            handleMessage(peerId, ws, msg, wss);
        } catch {
            // Malformed JSON — ignore silently
        }
    });

    ws.on('close', () => {
        evictPeer(peerId);
    });

    ws.on('error', (err) => {
        console.error(`[ZEPHYR-1] ws error for peer ${peerId}:`, err.message);
        evictPeer(peerId);
    });

    // Peer will identify itself with a HELLO message; registerPeer called then.
    // Pre-register so we can assign peerId now, name will be updated on HELLO.
    registerPeer(peerId, ws, { name: 'Unknown', deviceType: 'desktop' });
});

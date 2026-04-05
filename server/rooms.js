/**
 * Peer registry, relay logic, and rate limiting.
 */

/** @type {Map<string, { ws: import('ws').WebSocket, name: string, deviceType: string, rateBucket: number, lastRefill: number }>} */
const peers = new Map();

const RATE_LIMIT = 10; // max RELAY per second per peer
const REFILL_INTERVAL_MS = 1000;

export function registerPeer(peerId, ws, info) {
    peers.set(peerId, {
        ws,
        name: info.name || 'Unknown',
        deviceType: info.deviceType || 'desktop',
        rateBucket: RATE_LIMIT,
        lastRefill: Date.now(),
    });
}

export function evictPeer(peerId) {
    peers.delete(peerId);
}

function refillBucket(peer) {
    const now = Date.now();
    const elapsed = now - peer.lastRefill;
    if (elapsed >= REFILL_INTERVAL_MS) {
        peer.rateBucket = RATE_LIMIT;
        peer.lastRefill = now;
    }
}

function canRelay(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return false;
    refillBucket(peer);
    if (peer.rateBucket <= 0) return false;
    peer.rateBucket--;
    return true;
}

/**
 * @param {string} peerId
 * @param {import('ws').WebSocket} ws
 * @param {{ type: string, payload: Record<string, unknown> }} msg
 * @param {import('ws').WebSocketServer} wss
 */
export function handleMessage(peerId, ws, msg, wss) {
    const { type, payload } = msg;

    switch (type) {
        case 'HELLO': {
            // Client sends its display name + device type
            const peer = peers.get(peerId);
            if (peer) {
                peer.name = payload.name || 'Unknown';
                peer.deviceType = payload.deviceType || 'desktop';
            }
            ws.send(JSON.stringify({ type: 'HELLO', payload: { peerId } }));
            break;
        }

        case 'PEER_LIST': {
            const list = [];
            for (const [id, p] of peers.entries()) {
                if (id !== peerId) {
                    list.push({ id, name: p.name, deviceType: p.deviceType });
                }
            }
            ws.send(JSON.stringify({ type: 'PEER_LIST', payload: { peers: list } }));
            break;
        }

        case 'RELAY': {
            // payload.targetId + payload.data (base64-encoded binary)
            if (!canRelay(peerId)) return; // rate limited — drop silently
            const target = peers.get(payload.targetId);
            if (!target) return;
            // Forward raw relay (reconstruct binary from base64 on target side)
            target.ws.send(JSON.stringify({
                type: 'RELAY',
                payload: { fromId: peerId, data: payload.data },
            }));
            break;
        }

        case 'REQUEST': {
            // Sender requests permission from target device
            const target = peers.get(payload.targetId);
            if (!target) {
                ws.send(JSON.stringify({
                    type: 'REQUEST_ACK',
                    payload: { targetId: payload.targetId, status: 'not_found' },
                }));
                return;
            }
            target.ws.send(JSON.stringify({
                type: 'REQUEST',
                payload: {
                    fromId: peerId,
                    fromName: peers.get(peerId)?.name || 'Unknown',
                    fileName: payload.fileName,
                    fileSize: payload.fileSize,
                },
            }));
            break;
        }

        case 'REQUEST_ACK': {
            // Receiver responds allow/deny to sender
            const sender = peers.get(payload.toId);
            if (!sender) return;
            sender.ws.send(JSON.stringify({
                type: 'REQUEST_ACK',
                // fromId = the peer who accepted (receiver), so sender knows who to connect to
                payload: { fromId: peerId, status: payload.status },
            }));
            break;
        }

        case 'CODE_REGISTER': {
            // Handled by totp.js (imported in index.js wrapper)
            // Re-export for external use
            import('./totp.js').then(({ handleCodeRegister }) =>
                handleCodeRegister(peerId, ws, payload)
            );
            break;
        }

        case 'CODE_MATCH': {
            import('./totp.js').then(({ handleCodeMatch }) =>
                handleCodeMatch(peerId, ws, payload, peers)
            );
            break;
        }

        default:
        // Unknown message type — ignore
    }
}

export { peers };

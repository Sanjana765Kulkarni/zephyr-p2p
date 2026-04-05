/**
 * useZephyr — Drives a ZephyrSession over a shared signalling WebSocket.
 *
 * Key design: ws is accessed via wsRef (not closure capture) so relayPacket
 * and getOrCreateSession are stable callbacks that survive WS reconnects /
 * React StrictMode double-invocation without destroying the session.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { ZephyrSession } from '../protocol/zephyr';
import type { ZephyrSessionState, ZephyrEvent } from '../protocol/zephyr';
import type { FileMetadata } from '../protocol/chunker';

export interface IncomingTransfer {
    meta: FileMetadata;
    blob?: Blob;
    progress: number; // 0–100
}

export interface UseZephyrReturn {
    sessionState: ZephyrSessionState;
    connect: (targetId: string) => Promise<void>;
    sendFile: (file: File) => void;
    incomingTransfer: IncomingTransfer | null;
    outgoingProgress: number;
}

export function useZephyr(ws: WebSocket | null, _myPeerId: string | null): UseZephyrReturn {
    const sessionRef = useRef<ZephyrSession | null>(null);
    const targetIdRef = useRef<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);   // always current WS

    // Keep wsRef in sync whenever ws prop changes
    useEffect(() => { wsRef.current = ws; }, [ws]);

    const [sessionState, setSessionState] = useState<ZephyrSessionState>('IDLE');
    const [incomingTransfer, setIncomingTransfer] = useState<IncomingTransfer | null>(null);
    const [outgoingProgress, setOutgoingProgress] = useState(0);

    // ── Stable helpers (no deps that change) ────────────────────────────────────

    /** Encode buffer to base64 safely for large arrays */
    const bufToB64 = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let str = '';
        for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
        return btoa(str);
    };

    const b64ToBuf = (b64: string): ArrayBuffer => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    };

    /** Stable relay — reads ws and targetId from refs, not closure */
    const relayPacket = useCallback((buf: ArrayBuffer) => {
        const socket = wsRef.current;
        const targetId = targetIdRef.current;
        if (!socket || !targetId || socket.readyState !== WebSocket.OPEN) {
            console.warn('[Zephyr] relayPacket skipped', {
                hasSocket: !!socket,
                targetId,
                readyState: socket?.readyState,
            });
            return;
        }
        // console.log('[Zephyr] → relay packet to', targetId, 'size', buf.byteLength);
        socket.send(JSON.stringify({ type: 'RELAY', payload: { targetId, data: bufToB64(buf) } }));
    }, []); // stable — no dependencies

    /** Stable session factory — captures stable relayPacket */
    const getOrCreateSession = useCallback((): ZephyrSession => {
        if (sessionRef.current) {
            console.log('[Zephyr] destroying existing session');
            sessionRef.current.destroy();
        }
        console.log('[Zephyr] creating new ZephyrSession');
        const s = new ZephyrSession();
        sessionRef.current = s;

        s.on((evt: ZephyrEvent) => {
            switch (evt.type) {
                case 'state_change':
                    console.log('[Zephyr] state →', evt.data);
                    setSessionState(evt.data as ZephyrSessionState);
                    break;
                case 'packet':
                    relayPacket(evt.data as ArrayBuffer);
                    break;
                case 'transfer_start':
                    console.log('[Zephyr] transfer_start', evt.data);
                    setIncomingTransfer({ meta: evt.data as FileMetadata, progress: 0 });
                    break;
                case 'chunk_received': {
                    const { index, total } = evt.data as { index: number; total: number };
                    setIncomingTransfer(prev =>
                        prev ? { ...prev, progress: Math.round((index / total) * 100) } : null,
                    );
                    break;
                }
                case 'progress': {
                    const { sent, total } = evt.data as { sent: number; total: number };
                    setOutgoingProgress(Math.round((sent / total) * 100));
                    break;
                }
                case 'fin':
                    if (evt.data?.blob) {
                        setIncomingTransfer(prev =>
                            prev ? { ...prev, blob: evt.data.blob, progress: 100 } : null,
                        );
                    }
                    setSessionState('ESTABLISHED');
                    break;
                case 'error':
                    console.error('[Zephyr] session error:', evt.data);
                    break;
            }
        });
        return s;
    }, [relayPacket]); // relayPacket is stable, so this is also stable

    // ── RELAY listener ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!ws) return;
        const handler = async (evt: MessageEvent) => {
            try {
                const msg = JSON.parse(evt.data as string);
                if (msg.type !== 'RELAY') return;

                const { fromId, data } = msg.payload as { fromId: string; data: string };
                // console.log('[Zephyr] ← relay from', fromId, 'size', data.length);

                // First inbound packet from a peer: record as target + init responder session
                if (!targetIdRef.current) {
                    console.log('[Zephyr] auto-setting target to', fromId, '(responder)');
                    targetIdRef.current = fromId;
                    getOrCreateSession();
                }

                const buf = b64ToBuf(data);
                if (!sessionRef.current) {
                    console.warn('[Zephyr] no session to receive packet');
                    return;
                }
                await sessionRef.current.receive(buf);
            } catch (err) {
                console.error('[Zephyr] RELAY handler error:', err);
            }
        };
        ws.addEventListener('message', handler);
        return () => ws.removeEventListener('message', handler);
    }, [ws, getOrCreateSession]); // getOrCreateSession is stable → this only re-runs when ws changes

    // ── Public API ──────────────────────────────────────────────────────────────

    const connect = useCallback(async (targetId: string) => {
        console.log('[Zephyr] connect() → initiator, target:', targetId);
        targetIdRef.current = targetId;
        const session = getOrCreateSession();
        await session.startAsInitiator();
        console.log('[Zephyr] connect() HELLO sent');
    }, [getOrCreateSession]);

    const sendFile = useCallback((file: File) => {
        console.log('[Zephyr] sendFile()', file.name, file.size);
        sessionRef.current?.queueFile(file);
    }, []);

    return { sessionState, connect, sendFile, incomingTransfer, outgoingProgress };
}

/**
 * useZephyr — Drives ZephyrSessions over a shared signalling WebSocket.
 * Maintains a map of concurrent sessions for multicast file transfers.
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
    sessionStates: Record<string, ZephyrSessionState>;
    connect: (targetId: string) => Promise<void>;
    sendFile: (targetId: string, file: File) => void;
    incomingTransfers: Record<string, IncomingTransfer>;
    outgoingProgresses: Record<string, number>;
}

export function useZephyr(ws: WebSocket | null, _myPeerId: string | null): UseZephyrReturn {
    const sessionsRef = useRef<Map<string, ZephyrSession>>(new Map());
    const wsRef = useRef<WebSocket | null>(null);

    // Keep wsRef in sync whenever ws prop changes
    useEffect(() => { wsRef.current = ws; }, [ws]);

    const [sessionStates, setSessionStates] = useState<Record<string, ZephyrSessionState>>({});
    const [incomingTransfers, setIncomingTransfers] = useState<Record<string, IncomingTransfer>>({});
    const [outgoingProgresses, setOutgoingProgresses] = useState<Record<string, number>>({});

    // ── Stable helpers ────────────────────────────────────────────────────────
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

    /** Stable relay — captures specific targetId via argument */
    const relayPacket = useCallback((targetId: string, buf: ArrayBuffer) => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'RELAY', payload: { targetId, data: bufToB64(buf) } }));
    }, []);

    /** Session factory for a specific targetId */
    const getOrCreateSession = useCallback((targetId: string): ZephyrSession => {
        if (sessionsRef.current.has(targetId)) {
            return sessionsRef.current.get(targetId)!;
        }

        console.log('[Zephyr] creating new ZephyrSession for', targetId);
        const s = new ZephyrSession();
        sessionsRef.current.set(targetId, s);

        s.on((evt: ZephyrEvent) => {
            switch (evt.type) {
                case 'state_change':
                    setSessionStates(prev => ({ ...prev, [targetId]: evt.data as ZephyrSessionState }));
                    break;
                case 'packet':
                    relayPacket(targetId, evt.data as ArrayBuffer);
                    break;
                case 'transfer_start':
                    setIncomingTransfers(prev => ({ ...prev, [targetId]: { meta: evt.data as FileMetadata, progress: 0 } }));
                    break;
                case 'chunk_received': {
                    const { index, total } = evt.data as { index: number; total: number };
                    setIncomingTransfers(prev => {
                        const existing = prev[targetId];
                        if (!existing) return prev;
                        return { ...prev, [targetId]: { ...existing, progress: Math.round((index / total) * 100) } };
                    });
                    break;
                }
                case 'progress': {
                    const { sent, total } = evt.data as { sent: number; total: number };
                    setOutgoingProgresses(prev => ({ ...prev, [targetId]: Math.round((sent / total) * 100) }));
                    break;
                }
                case 'fin':
                    if (evt.data?.blob) {
                        setIncomingTransfers(prev => {
                            const existing = prev[targetId];
                            if (!existing) return prev;
                            return { ...prev, [targetId]: { ...existing, blob: evt.data.blob, progress: 100 } };
                        });
                    }
                    setSessionStates(prev => ({ ...prev, [targetId]: 'ESTABLISHED' }));
                    break;
                case 'error':
                    console.error(`[Zephyr] session error with ${targetId}:`, evt.data);
                    break;
            }
        });
        return s;
    }, [relayPacket]);

    // ── RELAY listener ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!ws) return;
        const handler = async (evt: MessageEvent) => {
            try {
                const msg = JSON.parse(evt.data as string);
                if (msg.type !== 'RELAY') return;

                const { fromId, data } = msg.payload as { fromId: string; data: string };

                const session = getOrCreateSession(fromId);
                const buf = b64ToBuf(data);
                await session.receive(buf);
            } catch (err) {
                console.error('[Zephyr] RELAY handler error:', err);
            }
        };
        ws.addEventListener('message', handler);
        return () => ws.removeEventListener('message', handler);
    }, [ws, getOrCreateSession]);

    // ── Public API ──────────────────────────────────────────────────────────────
    const connect = useCallback(async (targetId: string) => {
        console.log('[Zephyr] connect() → initiator, target:', targetId);
        const session = getOrCreateSession(targetId);
        await session.startAsInitiator();
        console.log(`[Zephyr] connect() HELLO sent to ${targetId}`);
    }, [getOrCreateSession]);

    const sendFile = useCallback((targetId: string, file: File) => {
        console.log('[Zephyr] sendFile()', targetId, file.name, file.size);
        const session = sessionsRef.current.get(targetId);
        if (session) {
            session.queueFile(file);
        } else {
            console.warn(`[Zephyr] sendFile failed: no active session for ${targetId}`);
        }
    }, []);

    return { sessionStates, connect, sendFile, incomingTransfers, outgoingProgresses };
}

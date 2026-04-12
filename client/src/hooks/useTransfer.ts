/**
 * useTransfer — Permission request handling.
 * Sender: sends REQUEST, listens for REQUEST_ACK → triggers connect + sendFile.
 * Receiver: shows permission popup, sends REQUEST_ACK on allow.
 */
import { useEffect, useState, useRef } from 'react';

export interface PermissionRequest {
    fromId: string;
    fromName: string;
    fileName: string;
    fileSize: number;
}

type OnGranted = (fromId: string) => void;

export function useTransfer(ws: WebSocket | null) {
    // Receiver side: incoming request popups
    const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);

    // Sender side: callback map for multiple remote peers
    const onGrantedMapRef = useRef<Map<string, OnGranted>>(new Map());

    useEffect(() => {
        if (!ws) return;
        const handler = (evt: MessageEvent) => {
            try {
                const msg = JSON.parse(evt.data as string);

                if (msg.type === 'REQUEST') {
                    setPermissionRequests(prev => [...prev, {
                        fromId: msg.payload.fromId,
                        fromName: msg.payload.fromName,
                        fileName: msg.payload.fileName,
                        fileSize: msg.payload.fileSize,
                    }]);
                }

                if (msg.type === 'REQUEST_ACK' && msg.payload?.status === 'accepted') {
                    const cb = onGrantedMapRef.current.get(msg.payload.fromId);
                    if (cb) {
                        cb(msg.payload.fromId);
                        onGrantedMapRef.current.delete(msg.payload.fromId);
                    }
                }
            } catch { /* ignore */ }
        };
        ws.addEventListener('message', handler);
        return () => ws.removeEventListener('message', handler);
    }, [ws]);

    const respond = (req: PermissionRequest, allowed: boolean) => {
        if (!ws) return;
        ws.send(JSON.stringify({
            type: 'REQUEST_ACK',
            payload: { toId: req.fromId, status: allowed ? 'accepted' : 'denied' },
        }));
        setPermissionRequests(prev => prev.filter(r => r.fromId !== req.fromId));
    };

    const requestPermission = (
        targetId: string,
        fileName: string,
        fileSize: number,
        onGranted: OnGranted,
    ) => {
        if (!ws) return;
        onGrantedMapRef.current.set(targetId, onGranted);
        ws.send(JSON.stringify({
            type: 'REQUEST',
            payload: { targetId, fileName, fileSize },
        }));
    };

    return { permissionRequests, respond, requestPermission };
}

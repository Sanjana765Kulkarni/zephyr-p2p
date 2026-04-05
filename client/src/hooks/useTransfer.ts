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
    // Receiver side: incoming request popup
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);

    // Sender side: callback to fire when remote accepts
    const onGrantedRef = useRef<OnGranted | null>(null);

    useEffect(() => {
        if (!ws) return;
        const handler = (evt: MessageEvent) => {
            try {
                const msg = JSON.parse(evt.data as string);

                // Receiver side: show permission popup
                if (msg.type === 'REQUEST') {
                    setPermissionRequest({
                        fromId: msg.payload.fromId,
                        fromName: msg.payload.fromName,
                        fileName: msg.payload.fileName,
                        fileSize: msg.payload.fileSize,
                    });
                }

                // Sender side: peer accepted → fire callback
                if (msg.type === 'REQUEST_ACK' && msg.payload?.status === 'accepted') {
                    onGrantedRef.current?.(msg.payload.fromId);
                }
            } catch { /* ignore */ }
        };
        ws.addEventListener('message', handler);
        return () => ws.removeEventListener('message', handler);
    }, [ws]);

    /** Receiver: send permission decision */
    const respond = (req: PermissionRequest, allowed: boolean) => {
        if (!ws) return;
        ws.send(JSON.stringify({
            type: 'REQUEST_ACK',
            payload: { toId: req.fromId, status: allowed ? 'accepted' : 'denied' },
        }));
        setPermissionRequest(null);
    };

    /**
     * Sender: send a permission request.
     * @param onGranted called with the approving peer's id when they accept
     */
    const requestPermission = (
        targetId: string,
        fileName: string,
        fileSize: number,
        onGranted: OnGranted,
    ) => {
        if (!ws) return;
        onGrantedRef.current = onGranted;
        ws.send(JSON.stringify({
            type: 'REQUEST',
            payload: { targetId, fileName, fileSize },
        }));
    };

    return { permissionRequest, respond, requestPermission };
}

/**
 * useDevices — Polls the signalling server for the peer list every 5 seconds.
 */
import { useEffect, useRef, useState } from 'react';

export interface Device {
    id: string;
    name: string;
    deviceType: 'desktop' | 'mobile' | 'tablet';
}

export function useDevices(ws: WebSocket | null) {
    const [devices, setDevices] = useState<Device[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchPeers = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PEER_LIST', payload: {} }));
        }
    };

    useEffect(() => {
        if (!ws) return;

        const handler = (evt: MessageEvent) => {
            try {
                const msg = JSON.parse(evt.data as string);
                if (msg.type === 'PEER_LIST') {
                    setDevices(msg.payload.peers as Device[]);
                }
            } catch { /* ignore */ }
        };

        ws.addEventListener('message', handler);
        fetchPeers();
        timerRef.current = setInterval(fetchPeers, 5000);

        return () => {
            ws.removeEventListener('message', handler);
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [ws]);

    return devices;
}

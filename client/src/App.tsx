/**
 * App — Top bar, tab switcher, global layout.
 * Single shared WebSocket — all hooks use the same connection.
 */
import { useState, useEffect } from 'react';
import { WindWhisper } from './modes/WindWhisper';
import { useZephyr } from './hooks/useZephyr';
import { useDevices } from './hooks/useDevices';
import { useTransfer } from './hooks/useTransfer';

export default function App() {

  // ── Single shared WebSocket for ALL hooks ──────────────────────────────────
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string>('');

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let socket: WebSocket;

    const connectWS = () => {
      const generatedName = `Device-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      setDeviceName(generatedName);

      let rawUrl = (import.meta.env.VITE_WS_URL || '') as string;
      if (rawUrl && rawUrl.startsWith('http')) {
        rawUrl = rawUrl.replace(/^http/, 'ws');
      }
      
      // Render/cloud automatically expose apps on port 443. Strip manual :7473 declarations.
      if (rawUrl.includes('.onrender.com:7473')) {
        rawUrl = rawUrl.replace(':7473', '');
      }

      const defaultProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const isCloud = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      const fallbackUrl = isCloud 
        ? `${defaultProto}//${window.location.hostname}` 
        : `ws://${window.location.hostname}:7473`;
        
      const WS_URL = rawUrl || fallbackUrl;

      try {
        socket = new WebSocket(WS_URL);
      } catch (err) {
        console.error('[App] WebSocket initialization failed:', err);
        return;
      }

      socket.onopen = () => {
        const deviceType = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        socket.send(JSON.stringify({ type: 'HELLO', payload: { name: generatedName, deviceType } }));
      };

      const helloHandler = (evt: MessageEvent) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === 'HELLO' && msg.payload?.peerId) {
            console.log('[App] assigned peerId:', msg.payload.peerId);
            setPeerId(msg.payload.peerId);
          }
        } catch { /* ignore */ }
      };

      socket.addEventListener('message', helloHandler);
      
      socket.onclose = () => {
        console.warn('[App] WebSocket disconnected. Retrying in 3 seconds...');
        socket.removeEventListener('message', helloHandler);
        setWs(null);
        setPeerId(null);
        reconnectTimer = setTimeout(connectWS, 3000);
      };

      setWs(socket);
    };

    connectWS();

    return () => {
      clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null; // prevent reconnect on intended unmount
        socket.close();
      }
    };
  }, []);

  // ── All hooks share the same ws ────────────────────────────────────────────
  const { sessionState, connect, sendFile, incomingTransfer, outgoingProgress } = useZephyr(ws, peerId);
  const devices = useDevices(ws);
  const { permissionRequest, respond, requestPermission } = useTransfer(ws);

  const incomingBlob = incomingTransfer?.blob ?? null;
  const incomingName = incomingTransfer?.meta?.name;

  return (
    <div className="app">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <svg width="28" height="28" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="topbar-logo">
            <ellipse cx="68" cy="68" rx="28" ry="22" fill="#e8e5de" stroke="#1a1917" strokeWidth="1.5" />
            <ellipse cx="88" cy="48" rx="14" ry="13" fill="#e8e5de" stroke="#1a1917" strokeWidth="1.5" />
            <path d="M100 46 L108 48 L100 51 Z" fill="#BA7517" />
            <circle cx="93" cy="46" r="2.5" fill="#1a1917" />
            <path d="M60 60 Q52 50 44 56 Q50 66 60 68 Z" fill="#d6d3cc" stroke="#1a1917" strokeWidth="0.8" />
          </svg>
          <div className="topbar-title-block">
            <span className="topbar-name">WindWhisper</span>
            <span className="topbar-proto">ZEPHYR-1 protocol</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="topbar-devicename" style={{ marginRight: '16px', fontSize: '0.9rem', color: '#6a6a6a' }}>
            {deviceName}
          </span>
          <span className={`status-dot${ws && peerId ? '' : ' status-dot--offline'}`} title={peerId ? 'Connected' : 'Connecting…'} />
          <span className="status-label">{peerId ? 'online' : 'connecting…'}</span>
        </div>
      </header>

      {/* Mode content */}
      <main className="main-content">
          <WindWhisper
            peerId={peerId}
            devices={devices}
            onConnect={connect}
            onSendFile={sendFile}
            onRequestPermission={(targetId, fileName, fileSize, onGranted) =>
              requestPermission(targetId, fileName, fileSize, onGranted)
            }
            ws={ws}
            outgoingProgress={outgoingProgress}
            sessionState={sessionState}
            permissionRequest={permissionRequest}
            onRespondPermission={respond}
            incomingBlob={incomingBlob}
            incomingName={incomingName}
        />
      </main>
    </div>
  );
}

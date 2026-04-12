/**
 * Kabutar Mode — Code-based pairing and 1:1 transfer.
 * TOTP: HMAC-SHA1, RFC 6238, 6 digits, 30s windows, 5min TTL (10 windows).
 * Implemented entirely via WebCrypto (client side) + server-side code store.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CodeDisplay } from '../components/CodeDisplay';
import { CodeInput } from '../components/CodeInput';
import { FileDrop } from '../components/FileDrop';
import { TransferProgress } from '../components/TransferProgress';
import { Mascot } from '../components/Mascot';
import type { ZephyrSessionState } from '../protocol/zephyr';
import type { IncomingTransfer } from '../hooks/useZephyr';

const WINDOW_SECONDS = 30;
const TTL_WINDOWS = 10;
const TTL_MS = WINDOW_SECONDS * TTL_WINDOWS * 1000;
const DIGITS = 6;

/** Client-side TOTP: HMAC-SHA1, RFC 6238 */
async function generateTOTP(secret: ArrayBuffer, windowIndex: number): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const counter = new ArrayBuffer(8);
    const view = new DataView(counter);
    // Write 64-bit big-endian counter (window index)
    view.setUint32(0, Math.floor(windowIndex / 2 ** 32), false);
    view.setUint32(4, windowIndex >>> 0, false);
    const sig = await crypto.subtle.sign('HMAC', key, counter);
    const digest = new Uint8Array(sig);
    const offset = digest[19] & 0x0f;
    const code =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);
    return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function currentWindow(): number {
    return Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
}

interface KabutarProps {
    ws: WebSocket | null;
    onConnect: (targetId: string) => Promise<void>;
    onSendFile: (targetId: string, file: File) => void;
    outgoingProgresses: Record<string, number>;
    sessionStates: Record<string, ZephyrSessionState>;
    incomingTransfers: Record<string, IncomingTransfer>;
}

export const Kabutar: React.FC<KabutarProps> = ({
    ws, onConnect, onSendFile, outgoingProgresses, sessionStates,
    incomingTransfers,
}) => {
    const [myCode, setMyCode] = useState('------');
    const [expiresAt, setExpiresAt] = useState(Date.now() + TTL_MS);
    const [peerCode, setPeerCode] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const secretRef = useRef<ArrayBuffer | null>(null);

    // Kabutar acts as a 1:1 link, there should only be one active target ID.
    const activeTargetId = Object.keys(sessionStates)[0] || null;
    const sessionState = activeTargetId ? sessionStates[activeTargetId] : 'IDLE';
    const outgoingProgress = activeTargetId ? (outgoingProgresses[activeTargetId] || 0) : 0;
    const incomingTransfer = activeTargetId ? incomingTransfers[activeTargetId] : null;

    const incomingBlob = incomingTransfer?.blob ?? null;
    const incomingName = incomingTransfer?.meta?.name ?? '';

    // Maintain object URL properly to avoid browser truncation bugs on download
    useEffect(() => {
        if (incomingBlob) {
            const url = URL.createObjectURL(incomingBlob);
            setDownloadUrl(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [incomingBlob]);

    const generateAndRegister = useCallback(async () => {
        // Generate a random 20-byte secret for TOTP
        const secret = crypto.getRandomValues(new Uint8Array(20)).buffer;
        secretRef.current = secret;
        const win = currentWindow();
        const code = await generateTOTP(secret, win);
        setMyCode(code);
        setExpiresAt(Date.now() + TTL_MS);

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'CODE_REGISTER', payload: { code } }));
        }
    }, [ws]);

    useEffect(() => {
        generateAndRegister();
    }, [generateAndRegister]);

    // Handle CODE_MATCH response from server
    useEffect(() => {
        if (!ws) return;
        const handler = (evt: MessageEvent) => {
            try {
                const msg = JSON.parse(evt.data as string);
                if (msg.type === 'CODE_MATCH') {
                    if (msg.payload.success) {
                        setStatus(`Connecting to ${msg.payload.targetName}...`);
                        onConnect(msg.payload.targetId);
                    } else {
                        setStatus(`Error: ${msg.payload.error}`);
                    }
                }
                if (msg.type === 'CODE_MATCHED') {
                    setStatus(`${msg.payload.fromName} matched your code. Connecting...`);
                    // DO NOT call onConnect here. The person who typed the code is the initiator. 
                    // This host acts as the responder and will naturally react to the incoming HELLO packet.
                }
            } catch { /* ignore */ }
        };
        ws.addEventListener('message', handler);
        return () => ws.removeEventListener('message', handler);
    }, [ws, onConnect]);

    const handleMatchCode = () => {
        if (!ws || peerCode.length < 6) return;
        ws.send(JSON.stringify({ type: 'CODE_MATCH', payload: { code: peerCode } }));
        setPeerCode('');
    };

    const handleSend = () => {
        if (files.length === 0 || !activeTargetId) return;
        setSending(true);
        // Although multiple files are supported by FileDrop, ZephyrSession queueFile supports sequential.
        // We'll queue them all on the target.
        for (const file of files) {
            onSendFile(activeTargetId, file);
        }
    };

    const established = sessionState === 'ESTABLISHED' || sessionState === 'TRANSFERRING';

    return (
        <div className="mode-page">
            <div className="kabutar-header">
                <Mascot mode="kabutar" size={88} />
                <div className="kabutar-intro">
                    <h2 className="kabutar-title">Kabutar ja ja ja</h2>
                    <p className="kabutar-sub">Share your code, or enter a friend's code below.</p>
                </div>
            </div>

            <CodeDisplay
                code={myCode}
                ttlMs={TTL_MS}
                expiresAt={expiresAt}
                onRefresh={generateAndRegister}
            />

            <div className="kabutar-divider">
                <span>or connect to</span>
            </div>

            <CodeInput
                value={peerCode}
                onChange={setPeerCode}
                onSubmit={handleMatchCode}
                disabled={established}
            />

            {status && <div className="kabutar-status">{status}</div>}

            {established && (
                <>
                    <div className="session-badge">🔒 Session established</div>
                    <FileDrop files={files} onFiles={setFiles} />
                    {!sending ? (
                        <button
                            className="send-btn"
                            disabled={files.length === 0}
                            onClick={handleSend}
                            id="kabutar-send-btn"
                        >
                            Send {files.length > 1 ? `${files.length} ` : ''}file{files.length > 1 ? 's' : ''}
                        </button>
                    ) : (
                        <TransferProgress
                            filename={files.length === 1 ? files[0].name : `${files.length} files`}
                            progress={outgoingProgress}
                            speedBps={0}
                            done={outgoingProgress === 100}
                            error={null}
                        />
                    )}
                </>
            )}

            {downloadUrl && (
                <div className="incoming-ready">
                    <span>✓ File received</span>
                    <a className="download-btn" href={downloadUrl} download={incomingName} id="kabutar-download-btn">
                        Download {incomingName}
                    </a>
                </div>
            )}
        </div>
    );
};

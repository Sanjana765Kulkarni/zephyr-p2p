/**
 * WindWhisper Mode — LAN discovery + file transfer.
 *
 * Flow:
 *  Sender: selects devices + file → requestPermission (sends REQUEST to server)
 *          → server delivers REQUEST → receiver sees popup → clicks Allow
 *          → server delivers REQUEST_ACK to sender → sender calls connect(targetId)
 *          → ZEPHYR-1 handshake → ESTABLISHED → sendFile(file)
 *  Receiver: sees popup, clicks Allow → send REQUEST_ACK → wait for HELLO relay
 *            → session auto-created as responder → transfer begins
 */
import React, { useState, useEffect, useRef } from 'react';
import { ScannerBlock } from '../components/ScannerBlock';
import { DeviceCard } from '../components/DeviceCard';
import { FileDrop } from '../components/FileDrop';
import { TransferProgress } from '../components/TransferProgress';
import { Mascot } from '../components/Mascot';
import type { Device } from '../hooks/useDevices';

interface WindWhisperProps {
    peerId: string | null;
    devices: Device[];
    onConnect: (targetId: string) => Promise<void>;
    onSendFile: (file: File) => void;
    onRequestPermission: (targetId: string, fileName: string, fileSize: number, onGranted: (fromId: string) => void) => void;
    ws: WebSocket | null;
    outgoingProgress: number;
    sessionState: string;
    permissionRequest: { fromId: string; fromName: string; fileName: string; fileSize: number } | null;
    onRespondPermission: (req: { fromId: string; fromName: string; fileName: string; fileSize: number }, allow: boolean) => void;
    incomingBlob?: Blob | null;
    incomingName?: string;
}

export const WindWhisper: React.FC<WindWhisperProps> = ({
    devices, onConnect, onSendFile, onRequestPermission,
    outgoingProgress, sessionState, permissionRequest,
    onRespondPermission, incomingBlob, incomingName,
}) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [file, setFile] = useState<File | null>(null);
    const [sending, setSending] = useState(false);
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const pendingFileRef = useRef<File | null>(null);

    // Maintain object URL properly to avoid browser truncation bugs on download
    useEffect(() => {
        if (incomingBlob) {
            const url = URL.createObjectURL(incomingBlob);
            setDownloadUrl(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [incomingBlob]);

    // When session becomes ESTABLISHED and we have a pending file, send it
    useEffect(() => {
        if (sessionState === 'ESTABLISHED' && pendingFileRef.current) {
            onSendFile(pendingFileRef.current);
            pendingFileRef.current = null;
        }
    }, [sessionState, onSendFile]);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            if (prev.has(id)) return new Set();
            return new Set([id]); // Enforce STRICT 1-to-1 device selection only
        });
    };

    const handleSend = () => {
        if (!file || selectedIds.size === 0) return;
        setSending(true);
        pendingFileRef.current = file;
        for (const targetId of selectedIds) {
            // onGranted fires when recipient accepts → we become the INITIATOR
            onRequestPermission(targetId, file.name, file.size, (fromId) => {
                onConnect(fromId); // initiates ZEPHYR-1 handshake (sends HELLO)
                // sendFile is triggered by the sessionState effect above
            });
        }
    };

    // downloadBlob removed in favor of direct href via useEffect

    return (
        <div className="mode-page">
            <ScannerBlock deviceCount={devices.length} scanning={devices.length > 0} />

            <div className="device-grid">
                {devices.length === 0 ? (
                    <div className="no-devices">
                        <Mascot mode="windwhisper" size={64} />
                        <p>No nearby devices found. Make sure you're on the same network.</p>
                    </div>
                ) : (
                    devices.map(d => (
                        <DeviceCard
                            key={d.id}
                            device={d}
                            selected={selectedIds.has(d.id)}
                            onToggle={toggleSelect}
                        />
                    ))
                )}
            </div>

            <FileDrop file={file} onFile={setFile} />

            {!sending ? (
                <button
                    className="send-btn"
                    disabled={!file || selectedIds.size === 0}
                    onClick={handleSend}
                    id="send-btn"
                >
                    Send to {selectedIds.size > 0 ? `${selectedIds.size} device${selectedIds.size > 1 ? 's' : ''}` : 'device'}
                </button>
            ) : (
                <TransferProgress
                    filename={file?.name ?? ''}
                    progress={outgoingProgress}
                    speedBps={0}
                    done={outgoingProgress === 100}
                    error={null}
                />
            )}

            {/* Incoming download ready */}
            {downloadUrl && (
                <div className="incoming-ready">
                    <span>✓ File received</span>
                    <a className="download-btn" href={downloadUrl} download={incomingName} id="download-btn">Download {incomingName}</a>
                </div>
            )}

            {/* Permission popup overlay — receiver side */}
            {permissionRequest && (
                <div className="permission-overlay">
                    <div className="permission-card" id="permission-popup">
                        <Mascot mode="windwhisper" size={72} />
                        <div className="permission-title">Incoming File</div>
                        <div className="permission-body">
                            <strong>{permissionRequest.fromName}</strong> wants to send you
                        </div>
                        <div className="permission-file">
                            📄 {permissionRequest.fileName}
                            <span className="permission-size">
                                ({(permissionRequest.fileSize / 1024).toFixed(1)} KB)
                            </span>
                        </div>
                        <div className="permission-actions">
                            <button
                                className="btn-allow"
                                onClick={() => {
                                    // Receiver only sends the ACK.
                                    // The HELLO from the sender will arrive via RELAY and
                                    // useZephyr's RELAY handler auto-creates the responder session.
                                    onRespondPermission(permissionRequest, true);
                                }}
                                id="allow-btn"
                            >
                                Allow
                            </button>
                            <button
                                className="btn-decline"
                                onClick={() => onRespondPermission(permissionRequest, false)}
                                id="decline-btn"
                            >
                                Decline
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

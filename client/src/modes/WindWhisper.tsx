/**
 * WindWhisper Mode — LAN discovery + multicast file transfer.
 * 
 * Flow:
 *  Sender: selects multiple devices + multiple files -> triggers requestPermission
 *  Receiver: processes multiple request popups, downloads generated into list
 */
import React, { useState, useEffect, useRef } from 'react';
import { ScannerBlock } from '../components/ScannerBlock';
import { DeviceCard } from '../components/DeviceCard';
import { FileDrop } from '../components/FileDrop';
import { TransferProgress } from '../components/TransferProgress';
import { Mascot } from '../components/Mascot';
import type { Device } from '../hooks/useDevices';
import type { ZephyrSessionState } from '../protocol/zephyr';
import type { PermissionRequest } from '../hooks/useTransfer';
import type { IncomingTransfer } from '../hooks/useZephyr';

interface WindWhisperProps {
    peerId: string | null;
    devices: Device[];
    onConnect: (targetId: string) => Promise<void>;
    onSendFile: (targetId: string, file: File) => void;
    onRequestPermission: (targetId: string, fileName: string, fileSize: number, onGranted: (fromId: string) => void) => void;
    ws: WebSocket | null;
    outgoingProgresses: Record<string, number>;
    sessionStates: Record<string, ZephyrSessionState>;
    permissionRequests: PermissionRequest[];
    onRespondPermission: (req: PermissionRequest, allow: boolean) => void;
    incomingTransfers: Record<string, IncomingTransfer>;
}

export const WindWhisper: React.FC<WindWhisperProps> = ({
    devices, onConnect, onSendFile, onRequestPermission,
    outgoingProgresses, sessionStates, permissionRequests,
    onRespondPermission, incomingTransfers,
}) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);

    // Maintain URLs for received files
    const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        const newUrls: Record<string, string> = { ...downloadUrls };
        let changed = false;

        for (const [peerId, transfer] of Object.entries(incomingTransfers)) {
            const uniqueKey = `${peerId}-${transfer.meta.name}-${transfer.meta.size}`;
            if (transfer.blob && !newUrls[uniqueKey]) {
                const url = URL.createObjectURL(transfer.blob);
                newUrls[uniqueKey] = url;
                changed = true;
            }
        }

        if (changed) {
            setDownloadUrls(newUrls);
        }
    }, [incomingTransfers, downloadUrls]);

    // Keep track of pending files to send per target
    const pendingFilesRef = useRef<Record<string, File[]>>({});

    // When session becomes ESTABLISHED and we have a pending target, send queued files.
    // Notice this runs ANY time sessionStates changes.
    useEffect(() => {
        for (const [targetId, state] of Object.entries(sessionStates)) {
            if (state === 'ESTABLISHED') {
                const pending = pendingFilesRef.current[targetId];
                if (pending && pending.length > 0) {
                    for (const f of pending) {
                        onSendFile(targetId, f);
                    }
                    pendingFilesRef.current[targetId] = [];
                }
            }
        }
    }, [sessionStates, onSendFile]);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSend = () => {
        if (files.length === 0 || selectedIds.size === 0) return;
        setSending(true);

        const summaryName = files.length === 1 ? files[0].name : `${files.length} multiple files`;
        const totalSize = files.reduce((acc, f) => acc + f.size, 0);

        for (const targetId of selectedIds) {
            pendingFilesRef.current[targetId] = [...files];

            onRequestPermission(targetId, summaryName, totalSize, (fromId) => {
                onConnect(fromId); // initiates handshake, will trigger sendFile on ESTABLISHED
            });
        }
    };

    // calculate max progress amongst active targets for transferring state
    const maxProgress = Math.max(0, ...Array.from(selectedIds).map(id => outgoingProgresses[id] || 0));

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

            <FileDrop files={files} onFiles={setFiles} />

            {!sending ? (
                <button
                    className="send-btn"
                    disabled={files.length === 0 || selectedIds.size === 0}
                    onClick={handleSend}
                    id="send-btn"
                >
                    Send to {selectedIds.size > 0 ? `${selectedIds.size} device${selectedIds.size > 1 ? 's' : ''}` : 'device'}
                </button>
            ) : (
                <TransferProgress
                    filename={files.length === 1 ? files[0].name : `${files.length} files`}
                    progress={maxProgress}
                    speedBps={0}
                    done={maxProgress === 100}
                    error={null}
                />
            )}

            {/* Incoming download ready */}
            {Object.entries(downloadUrls).map(([key, url]) => {
                // Infer original name from the key since we used `peerId-name-size`
                // But it's easier to find it in the incomingTransfers array
                const name = key.split('-').slice(1, -1).join('-') || 'file'; // rough inference
                return (
                    <div className="incoming-ready" key={key}>
                        <span>✓ File received</span>
                        <a className="download-btn" href={url} download={name}>Download {name}</a>
                    </div>
                )
            })}

            {/* Permission popup overlay — processing them sequentially or stacked */}
            {permissionRequests.length > 0 && (
                <div className="permission-overlay">
                    <div className="permission-card" id="permission-popup">
                        <Mascot mode="windwhisper" size={72} />
                        <div className="permission-title">Incoming Transfer</div>
                        <div className="permission-body">
                            <strong>{permissionRequests[0].fromName}</strong> wants to send you
                        </div>
                        <div className="permission-file">
                            📄 {permissionRequests[0].fileName}
                            <span className="permission-size">
                                ({(permissionRequests[0].fileSize / 1024).toFixed(1)} KB)
                            </span>
                        </div>
                        <div className="permission-actions">
                            <button
                                className="btn-allow"
                                onClick={() => onRespondPermission(permissionRequests[0], true)}
                                id="allow-btn"
                            >
                                Allow
                            </button>
                            <button
                                className="btn-decline"
                                onClick={() => onRespondPermission(permissionRequests[0], false)}
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

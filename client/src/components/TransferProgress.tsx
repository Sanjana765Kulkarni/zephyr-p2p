/**
 * TransferProgress — Animated progress bar with speed, ETA, and completion state.
 */
import React from 'react';

interface TransferProgressProps {
    filename: string;
    progress: number;      // 0–100
    speedBps: number;      // bytes per second
    done: boolean;
    error: string | null;
}

function formatSpeed(bps: number): string {
    if (bps < 1024) return `${bps.toFixed(0)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

function formatEta(bps: number, remaining: number): string {
    if (bps === 0) return '–';
    const secs = Math.ceil(remaining / bps);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({
    filename, progress, speedBps, done, error
}) => {
    const remainingPct = 100 - progress;

    return (
        <div className="transfer-progress" id="transfer-progress">
            <div className="transfer-filename">{filename}</div>
            <div className="transfer-bar-track">
                <div
                    className={`transfer-bar-fill${done ? ' transfer-bar-done' : ''}`}
                    style={{ width: `${progress}%` }}
                />
            </div>
            <div className="transfer-meta">
                <span className="transfer-pct">{progress}%</span>
                {!done && !error && (
                    <>
                        <span className="transfer-speed">{formatSpeed(speedBps)}</span>
                        <span className="transfer-eta">
                            ETA {formatEta(speedBps, remainingPct)}
                        </span>
                    </>
                )}
                {done && !error && (
                    <span className="transfer-done">✓ received safely</span>
                )}
                {error && (
                    <span className="transfer-error">✗ {error}</span>
                )}
            </div>
        </div>
    );
};

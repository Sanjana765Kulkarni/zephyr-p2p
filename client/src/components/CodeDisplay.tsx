/**
 * CodeDisplay — Shows device's own TOTP code with live countdown + shrinking bar.
 */
import React, { useEffect, useState } from 'react';

interface CodeDisplayProps {
    code: string;
    ttlMs: number;       // total TTL in ms (300 000 for 5 min)
    expiresAt: number;   // Date.now() + ms
    onRefresh: () => void;
}

export const CodeDisplay: React.FC<CodeDisplayProps> = ({ code, ttlMs, expiresAt, onRefresh }) => {
    const [remaining, setRemaining] = useState<number>(0);

    useEffect(() => {
        const tick = () => {
            const left = Math.max(0, expiresAt - Date.now());
            setRemaining(left);
            if (left === 0) onRefresh();
        };
        tick();
        const id = setInterval(tick, 500);
        return () => clearInterval(id);
    }, [expiresAt, onRefresh]);

    const pct = (remaining / ttlMs) * 100;
    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    const display = `${mins}:${String(secs % 60).padStart(2, '0')}`;

    return (
        <div className="code-display" id="code-display">
            <div className="code-display-left">
                <div className="code-label">Your code</div>
                <div className="code-number">{code}</div>
            </div>
            <div className="code-display-right">
                <div className="code-expires">expires in {display}</div>
                <div className="code-bar-track">
                    <div className="code-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <button className="code-refresh-btn" onClick={onRefresh} id="refresh-code-btn">
                    ↻ Refresh
                </button>
            </div>
        </div>
    );
};

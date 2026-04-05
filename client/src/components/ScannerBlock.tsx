/**
 * ScannerBlock — Y2K dark terminal card with scanline animation.
 */
import React from 'react';

interface ScannerBlockProps {
    deviceCount: number;
    scanning: boolean;
}

export const ScannerBlock: React.FC<ScannerBlockProps> = ({ deviceCount, scanning }) => (
    <div className="scanner-block">
        <div className="scanline" />
        <div className="scanner-content">
            <div className="scanner-left">
                <span className="scanner-label">
                    {scanning ? 'scanning nearby' : 'idle'}
                </span>
                <span className="scanner-count">
                    {deviceCount} {deviceCount === 1 ? 'device' : 'devices'} found
                </span>
            </div>
            <div className="scanner-badge">ZEPHYR-1</div>
        </div>
        {/* Grid overlay */}
        <div className="scanner-grid" />
    </div>
);

/**
 * DeviceCard — Selectable peer device tile.
 */
import React from 'react';
import type { Device } from '../hooks/useDevices';

interface DeviceCardProps {
    device: Device;
    selected: boolean;
    onToggle: (id: string) => void;
}

const ICONS: Record<string, string> = {
    desktop: '🖥️',
    mobile: '📱',
    tablet: '📱',
};

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, selected, onToggle }) => (
    <button
        className={`device-card${selected ? ' device-card--selected' : ''}`}
        onClick={() => onToggle(device.id)}
        aria-pressed={selected}
        id={`device-${device.id}`}
    >
        {selected && <span className="device-selected-dot" aria-hidden="true" />}
        <span className="device-icon">{ICONS[device.deviceType] ?? '💻'}</span>
        <div className="device-info">
            <span className="device-name">{device.name}</span>
            <span className="device-type">{device.deviceType}</span>
        </div>
    </button>
);

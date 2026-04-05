/**
 * mDNS broadcast for LAN discovery.
 * Advertises the ZEPHYR-1 signalling server as _zephyr._tcp.local
 */

import { Bonjour } from 'bonjour-service';

let bonjourInstance = null;

export function startMdns(port) {
    try {
        bonjourInstance = new Bonjour();
        bonjourInstance.publish({
            name: 'Kabutar-WindWhisper',
            type: 'zephyr',
            protocol: 'tcp',
            port,
            txt: { protocol: 'ZEPHYR-1', version: '1' },
        });
        console.log(`[mDNS] Broadcasting _zephyr._tcp.local on port ${port}`);
    } catch (err) {
        console.warn('[mDNS] Failed to start mDNS broadcast:', err.message);
    }
}

export function stopMdns() {
    bonjourInstance?.unpublishAll();
    bonjourInstance?.destroy();
}

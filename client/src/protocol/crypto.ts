/**
 * ZEPHYR-1 Crypto Module
 * All cryptography via browser WebCrypto API.
 * Uses explicit ArrayBuffer casts to satisfy TypeScript's strict Uint8Array<ArrayBufferLike> typing.
 */

// Helper: convert any Uint8Array (possibly ArrayBufferLike-backed) to a plain ArrayBuffer copy
function toArrayBuffer(src: Uint8Array): ArrayBuffer {
    const buf = new ArrayBuffer(src.byteLength);
    new Uint8Array(buf).set(src);
    return buf;
}

// ─── Key Agreement ──────────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits'],
    );
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<ArrayBuffer> {
    return crypto.subtle.exportKey('raw', publicKey);
}

export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        toArrayBuffer(raw),
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
    );
}

export async function deriveSharedBits(
    privateKey: CryptoKey,
    peerPublicKey: CryptoKey,
): Promise<ArrayBuffer> {
    return crypto.subtle.deriveBits(
        { name: 'ECDH', public: peerPublicKey },
        privateKey,
        256,
    );
}

// ─── Key Derivation ─────────────────────────────────────────────────────────

export interface SessionKeys {
    sessionKey: CryptoKey; // AES-256-GCM
    macKey: CryptoKey;     // HMAC-SHA256
}

const ZEPHYR_INFO = new TextEncoder().encode('zephyr-1-session');

export async function deriveSessionKeys(
    ikm: ArrayBuffer,
    salt: Uint8Array,
): Promise<SessionKeys> {
    const saltBuf = toArrayBuffer(salt);
    const infoBuf = toArrayBuffer(ZEPHYR_INFO);

    const hkdfKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits']);

    const keyMaterial = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info: infoBuf },
        hkdfKey,
        512,
    );

    const sessionKeyRaw = keyMaterial.slice(0, 32);
    const macKeyRaw     = keyMaterial.slice(32, 64);

    const sessionKey = await crypto.subtle.importKey(
        'raw', sessionKeyRaw,
        { name: 'AES-GCM', length: 256 },
        false, ['encrypt', 'decrypt'],
    );

    const macKey = await crypto.subtle.importKey(
        'raw', macKeyRaw,
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign', 'verify'],
    );

    return { sessionKey, macKey };
}

// ─── Symmetric Encryption ───────────────────────────────────────────────────

export async function encrypt(
    key: CryptoKey,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
): Promise<ArrayBuffer> {
    return crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad) },
        key,
        toArrayBuffer(plaintext),
    );
}

export async function decrypt(
    key: CryptoKey,
    nonce: Uint8Array,
    aad: Uint8Array,
    ciphertext: Uint8Array,
): Promise<ArrayBuffer> {
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad) },
        key,
        toArrayBuffer(ciphertext),
    );
}

// ─── HMAC ───────────────────────────────────────────────────────────────────

export async function hmacSign(key: CryptoKey, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
    const buf = data instanceof ArrayBuffer ? data : toArrayBuffer(data);
    return crypto.subtle.sign('HMAC', key, buf);
}

export async function hmacVerify(
    key: CryptoKey,
    signature: Uint8Array | ArrayBuffer,
    data: Uint8Array | ArrayBuffer,
): Promise<boolean> {
    const sigBuf  = signature instanceof ArrayBuffer ? signature : toArrayBuffer(signature);
    const dataBuf = data      instanceof ArrayBuffer ? data      : toArrayBuffer(data);
    return crypto.subtle.verify('HMAC', key, sigBuf, dataBuf);
}

// ─── File Integrity ──────────────────────────────────────────────────────────

export async function sha256(buffer: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
    const buf = buffer instanceof ArrayBuffer ? buffer : toArrayBuffer(buffer);
    return crypto.subtle.digest('SHA-256', buf);
}

export function bufferToHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// ─── Nonce ───────────────────────────────────────────────────────────────────

export function seqToNonce(seq: number): Uint8Array {
    const nonce = new Uint8Array(12);
    const view  = new DataView(nonce.buffer);
    view.setUint32(8, seq, false);
    return nonce;
}

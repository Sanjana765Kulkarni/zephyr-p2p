/**
 * ZEPHYR-1 Packet Encoder / Decoder
 *
 * Binary format:
 * [ VER: 1 ][ TYPE: 1 ][ SEQ: 4 big-endian ][ NONCE: 12 ][ ENCRYPTED_PAYLOAD: n ][ GCM_TAG: 16 ]
 *
 * Total header before payload: 18 bytes
 * AAD (authenticated, not encrypted): VER + TYPE + SEQ = 6 bytes
 * The NONCE field carries the 12-byte nonce used for AES-GCM.
 * GCM tag is automatically appended by WebCrypto encrypt and stripped by decrypt.
 */

import { PACKET, PROTOCOL_VERSION, PacketType } from '../constants';
import { encrypt, decrypt, seqToNonce } from './crypto';

export interface DecodedPacket {
    ver: number;
    type: PacketType;
    seq: number;
    nonce: Uint8Array;
    aad: Uint8Array;
    /** Encrypted ciphertext + GCM tag (as received from wire) */
    rawCiphertext: Uint8Array;
}

export interface PlaintextPacket {
    ver: number;
    type: PacketType;
    seq: number;
    payload: Uint8Array;
}

/**
 * Build a raw (pre-encryption) packet buffer.
 * Caller must encrypt the payload separately if needed.
 * For handshake packets (HELLO, HELLO_ACK) where payload is not encrypted,
 * pass the plaintext directly. For DATA packets, pass already-encrypted bytes.
 */
export function buildPacketBuffer(
    type: PacketType,
    seq: number,
    nonce: Uint8Array,
    encryptedPayloadWithTag: Uint8Array,
): ArrayBuffer {
    const totalLen = PACKET.HEADER_SIZE + encryptedPayloadWithTag.byteLength;
    const buf = new ArrayBuffer(totalLen);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    view.setUint8(PACKET.VER_OFFSET, PROTOCOL_VERSION);
    view.setUint8(PACKET.TYPE_OFFSET, type);
    view.setUint32(PACKET.SEQ_OFFSET, seq, false); // big-endian
    bytes.set(nonce, PACKET.NONCE_OFFSET);
    bytes.set(encryptedPayloadWithTag, PACKET.PAYLOAD_OFFSET);

    return buf;
}

/** Extract the AAD bytes (VER + TYPE + SEQ) from a packet buffer */
export function extractAAD(buf: ArrayBuffer): Uint8Array {
    return new Uint8Array(buf, 0, PACKET.AAD_SIZE);
}

/** Parse raw wire bytes into a DecodedPacket (does NOT decrypt) */
export function parsePacket(buf: ArrayBuffer): DecodedPacket {
    if (buf.byteLength < PACKET.HEADER_SIZE) {
        throw new Error(`Packet too short: ${buf.byteLength} bytes`);
    }
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    const ver = view.getUint8(PACKET.VER_OFFSET);
    const type = view.getUint8(PACKET.TYPE_OFFSET) as PacketType;
    const seq = view.getUint32(PACKET.SEQ_OFFSET, false);
    const nonce = bytes.slice(PACKET.NONCE_OFFSET, PACKET.NONCE_OFFSET + PACKET.NONCE_SIZE);
    const aad = bytes.slice(0, PACKET.AAD_SIZE);
    const rawCiphertext = bytes.slice(PACKET.PAYLOAD_OFFSET);

    return { ver, type, seq, nonce, aad, rawCiphertext };
}

/**
 * Encode and encrypt a full ZEPHYR-1 packet.
 * Returns the complete wire-format ArrayBuffer.
 */
export async function encodePacket(
    sessionKey: CryptoKey,
    type: PacketType,
    seq: number,
    plaintext: Uint8Array,
): Promise<ArrayBuffer> {
    const nonce = seqToNonce(seq);

    // Build AAD: first 6 bytes (VER + TYPE + SEQ)
    const aadBuf = new ArrayBuffer(PACKET.AAD_SIZE);
    const aadView = new DataView(aadBuf);
    aadView.setUint8(0, PROTOCOL_VERSION);
    aadView.setUint8(1, type);
    aadView.setUint32(2, seq, false);
    const aad = new Uint8Array(aadBuf);

    const ciphertextWithTag = await encrypt(sessionKey, nonce, aad, plaintext);

    return buildPacketBuffer(type, seq, nonce, new Uint8Array(ciphertextWithTag));
}

/**
 * Decode and decrypt a ZEPHYR-1 packet.
 * Throws on auth tag failure — caller must handle and send ERR.
 */
export async function decodePacket(
    sessionKey: CryptoKey,
    buf: ArrayBuffer,
): Promise<PlaintextPacket> {
    const { ver, type, seq, nonce, aad, rawCiphertext } = parsePacket(buf);

    if (ver !== PROTOCOL_VERSION) {
        throw new Error(`Unsupported protocol version: 0x${ver.toString(16)}`);
    }

    const plaintext = await decrypt(sessionKey, nonce, aad, rawCiphertext);

    return { ver, type, seq, payload: new Uint8Array(plaintext) };
}

/**
 * Build an unencrypted handshake packet (HELLO, HELLO_ACK, VERIFY, VERIFY_ACK).
 * These packets carry the payload in plaintext (raw public keys / HMACs).
 * The nonce field is zero for HELLO; populated for others.
 */
export function buildHandshakePacket(
    type: PacketType,
    seq: number,
    nonce: Uint8Array,
    payload: Uint8Array,
): ArrayBuffer {
    return buildPacketBuffer(type, seq, nonce, payload);
}

/** Parse a handshake packet payload (not encrypted) */
export function parseHandshakePacket(buf: ArrayBuffer): { type: PacketType; seq: number; nonce: Uint8Array; payload: Uint8Array } {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const type = view.getUint8(PACKET.TYPE_OFFSET) as PacketType;
    const seq = view.getUint32(PACKET.SEQ_OFFSET, false);
    const nonce = bytes.slice(PACKET.NONCE_OFFSET, PACKET.NONCE_OFFSET + PACKET.NONCE_SIZE);
    const payload = bytes.slice(PACKET.PAYLOAD_OFFSET);
    return { type, seq, nonce, payload };
}

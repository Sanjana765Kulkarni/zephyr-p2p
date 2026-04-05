/**
 * ZEPHYR-1 Handshake Session
 * Implements HELLO / VERIFY sequence per spec.
 * States: IDLE → HELLO_SENT → HELLO_ACKED → VERIFY_SENT → ESTABLISHED
 *
 * All WebCrypto calls receive Uint8Array (BufferSource) directly to avoid
 * ArrayBufferLike / SharedArrayBuffer type confusion.
 */

import { PacketType } from '../constants';
import {
    generateKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveSharedBits,
    deriveSessionKeys,
    hmacSign,
    hmacVerify,
    seqToNonce,
} from './crypto';
import type { SessionKeys } from './crypto';
import { buildHandshakePacket, parseHandshakePacket } from './packet';

export type HandshakeState =
    | 'IDLE'
    | 'HELLO_SENT'
    | 'HELLO_ACKED'
    | 'VERIFY_SENT'
    | 'ESTABLISHED'
    | 'FAILED';

export class HandshakeSession {
    private state: HandshakeState = 'IDLE';
    private keyPair!: CryptoKeyPair;
    private sessionKeys?: SessionKeys;

    // Raw bytes saved for transcript hash
    private helloBytes?: Uint8Array;
    private helloAckBytes?: Uint8Array;
    private hkdfSalt?: Uint8Array;   // 12 bytes

    private seq = 0;

    getState(): HandshakeState { return this.state; }
    getSessionKeys(): SessionKeys | undefined { return this.sessionKeys; }

    /** Copy a Uint8Array view to a fresh standalone buffer */
    private static copy(src: Uint8Array): Uint8Array {
        const out = new Uint8Array(src.byteLength);
        out.set(src);
        return out;
    }

    /** Step 1: Initiator creates and returns the HELLO packet bytes */
    async createHello(): Promise<ArrayBuffer> {
        if (this.state !== 'IDLE') throw new Error('Handshake already started');

        this.keyPair = await generateKeyPair();
        const pubKeyRaw = await exportPublicKey(this.keyPair.publicKey);
        // pubKeyRaw is an ArrayBuffer from exportKey — wrap in Uint8Array
        const pubKeyBytes = new Uint8Array(pubKeyRaw);

        const nonce = seqToNonce(this.seq);
        const packet = buildHandshakePacket(PacketType.HELLO, this.seq++, nonce, pubKeyBytes);

        this.helloBytes = new Uint8Array(packet);
        this.state = 'HELLO_SENT';
        return packet;
    }

    /**
     * Step 2 (Responder): Receive HELLO, generate own keypair, return HELLO_ACK.
     */
    async createHelloAck(helloPacket: ArrayBuffer): Promise<ArrayBuffer> {
        if (this.state !== 'IDLE') throw new Error('Expected IDLE state');

        this.helloBytes = new Uint8Array(helloPacket);
        const { payload: peerPubKeyView } = parseHandshakePacket(helloPacket);
        // COPY the view to a standalone Uint8Array — never use .buffer on a view
        const peerPubKeyBytes = HandshakeSession.copy(peerPubKeyView);
        console.log('[Handshake] createHelloAck: peerPubKey size =', peerPubKeyBytes.length);

        this.keyPair = await generateKeyPair();
        const myPubKeyRaw = await exportPublicKey(this.keyPair.publicKey);
        const myPubKeyBytes = new Uint8Array(myPubKeyRaw);

        // 12-byte HKDF salt
        const saltBytes = new Uint8Array(12);
        crypto.getRandomValues(saltBytes);
        this.hkdfSalt = saltBytes;

        // Import peer public key and derive session keys
        console.log('[Handshake] importing peer pubkey...');
        const peerKey = await importPublicKey(peerPubKeyBytes);
        console.log('[Handshake] deriving shared bits...');
        const sharedBits = await deriveSharedBits(this.keyPair.privateKey, peerKey);
        console.log('[Handshake] deriving session keys...');
        this.sessionKeys = await deriveSessionKeys(sharedBits, saltBytes);
        console.log('[Handshake] session keys derived ✓');

        // HELLO_ACK payload: myPubKey (65 bytes) + salt (12 bytes)
        const ackPayload = new Uint8Array(myPubKeyBytes.byteLength + 12);
        ackPayload.set(myPubKeyBytes, 0);
        ackPayload.set(saltBytes, myPubKeyBytes.byteLength);

        const nonce = seqToNonce(this.seq);
        const packet = buildHandshakePacket(PacketType.HELLO_ACK, this.seq++, nonce, ackPayload);
        this.helloAckBytes = new Uint8Array(packet);
        this.state = 'HELLO_ACKED';
        return packet;
    }

    /**
     * Step 3 (Initiator): Receive HELLO_ACK, derive session keys, return VERIFY packet.
     */
    async createVerify(helloAckPacket: ArrayBuffer): Promise<ArrayBuffer> {
        if (this.state !== 'HELLO_SENT') throw new Error('Expected HELLO_SENT state');

        this.helloAckBytes = new Uint8Array(helloAckPacket);
        const { payload: ackPayloadView } = parseHandshakePacket(helloAckPacket);
        const ackPayload = HandshakeSession.copy(ackPayloadView);

        // ackPayload = peerPubKey(65) + salt(12)
        const peerPubKeyBytes = ackPayload.slice(0, 65);
        const saltBytes = ackPayload.slice(65, 77);
        this.hkdfSalt = HandshakeSession.copy(saltBytes);
        console.log('[Handshake] createVerify: peerPubKey size =', peerPubKeyBytes.length, 'salt size =', saltBytes.length);

        console.log('[Handshake] importing peer pubkey (verify)...');
        const peerKey = await importPublicKey(peerPubKeyBytes);
        const sharedBits = await deriveSharedBits(this.keyPair.privateKey, peerKey);
        this.sessionKeys = await deriveSessionKeys(sharedBits, this.hkdfSalt);
        console.log('[Handshake] session keys derived (verify) ✓');

        const transcriptData = await this.computeTranscriptData();
        const hmac = await hmacSign(this.sessionKeys!.macKey, transcriptData);
        const nonce = seqToNonce(this.seq);
        const packet = buildHandshakePacket(PacketType.VERIFY, this.seq++, nonce, new Uint8Array(hmac));
        this.state = 'VERIFY_SENT';
        return packet;
    }

    /**
     * Step 4 (Responder): Receive VERIFY from initiator, verify HMAC, return VERIFY_ACK.
     */
    async createVerifyAck(verifyPacket: ArrayBuffer): Promise<ArrayBuffer> {
        if (this.state !== 'HELLO_ACKED') throw new Error('Expected HELLO_ACKED state');

        const { payload: peerHmacView } = parseHandshakePacket(verifyPacket);
        const peerHmac = HandshakeSession.copy(peerHmacView);
        const transcriptData = await this.computeTranscriptData();

        const valid = await hmacVerify(this.sessionKeys!.macKey, peerHmac, transcriptData);
        if (!valid) {
            this.state = 'FAILED';
            throw new Error('VERIFY HMAC mismatch — session aborted');
        }

        const myHmac = await hmacSign(this.sessionKeys!.macKey, transcriptData);
        const nonce = seqToNonce(this.seq);
        const packet = buildHandshakePacket(PacketType.VERIFY_ACK, this.seq++, nonce, new Uint8Array(myHmac));
        this.state = 'ESTABLISHED';
        return packet;
    }

    /**
     * Step 5 (Initiator): Receive VERIFY_ACK, verify HMAC, set ESTABLISHED.
     */
    async processVerifyAck(verifyAckPacket: ArrayBuffer): Promise<void> {
        if (this.state !== 'VERIFY_SENT') throw new Error('Expected VERIFY_SENT state');

        const { payload: peerHmacView } = parseHandshakePacket(verifyAckPacket);
        const peerHmac = HandshakeSession.copy(peerHmacView);
        const transcriptData = await this.computeTranscriptData();

        const valid = await hmacVerify(this.sessionKeys!.macKey, peerHmac, transcriptData);
        if (!valid) {
            this.state = 'FAILED';
            throw new Error('VERIFY_ACK HMAC mismatch — session aborted');
        }

        this.state = 'ESTABLISHED';
    }

    private async computeTranscriptData(): Promise<Uint8Array> {
        const hello = this.helloBytes!;
        const helloAck = this.helloAckBytes!;
        const combined = new Uint8Array(hello.byteLength + helloAck.byteLength);
        combined.set(hello, 0);
        combined.set(helloAck, hello.byteLength);
        return combined;
    }
}

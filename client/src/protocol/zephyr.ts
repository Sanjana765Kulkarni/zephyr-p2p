/**
 * ZEPHYR-1 Session State Machine
 * Pure class — no DOM/side-effects. UI drives it; it emits events.
 *
 * Sessions flow: IDLE → handshake → ESTABLISHED → transfer → FIN/ERROR
 */

import { PacketType, TRANSFER, PACKET } from '../constants';
import type { SessionKeys } from './crypto';
import { seqToNonce } from './crypto';
import { HandshakeSession } from './handshake';
import {
    encodePacket,
    decodePacket,
    buildHandshakePacket,
} from './packet';
import {
    splitFile,
    prepareFile,
    reassembleChunks,
    verifyFileHash,
    encodeMetadata,
    decodeMetadata,
} from './chunker';
import type { FileMetadata } from './chunker';

// ─── Events ─────────────────────────────────────────────────────────────────

export type ZephyrEventType =
    | 'packet'          // raw outgoing packet to send via relay
    | 'established'     // handshake complete
    | 'transfer_start'  // receiving file, metadata decoded
    | 'chunk_received'  // chunk index received
    | 'progress'        // { sent, total } for sender
    | 'fin'             // transfer complete (receiver has full file)
    | 'error'           // protocol error
    | 'state_change';   // session state changed

export interface ZephyrEvent {
    type: ZephyrEventType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
}

type ZephyrListener = (event: ZephyrEvent) => void;

// ─── Session States ──────────────────────────────────────────────────────────

export type ZephyrSessionState =
    | 'IDLE'
    | 'HELLO_SENT'
    | 'HELLO_ACKED'
    | 'VERIFY_SENT'
    | 'ESTABLISHED'
    | 'TRANSFERRING'
    | 'FAILED'
    | 'CLOSED';

// ─── Receiver Buffer ─────────────────────────────────────────────────────────

interface ReceiverState {
    meta: FileMetadata;
    chunks: Map<number, Uint8Array>;
    expectedChunks: number;
    receivedCount: number;
}

// ─── Sender Retransmit ───────────────────────────────────────────────────────

interface PendingChunk {
    seq: number;
    type: PacketType;
    data: Uint8Array;
    sentAt: number;
    timer: ReturnType<typeof setTimeout>;
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class ZephyrSession {
    private state: ZephyrSessionState = 'IDLE';
    private listeners: ZephyrListener[] = [];
    private handshake = new HandshakeSession();
    private sessionKeys?: SessionKeys;
    private receiveQueue: Promise<void> = Promise.resolve();

    // Nonce counter — strictly incrementing
    private nonceCounter = 0;

    // Receiver state
    private receiverState?: ReceiverState;

    // Sender state
    private pendingChunks = new Map<number, PendingChunk>();
    private transferQueue: File[] = [];
    private isTransferring = false;
    private windowQueue: (() => void)[] = [];

    // ─── Event emitter ────────────────────────────────────────────────────────

    on(listener: ZephyrListener) {
        this.listeners.push(listener);
    }

    off(listener: ZephyrListener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    private emit(type: ZephyrEventType, data?: unknown) {
        for (const l of this.listeners) l({ type, data });
    }

    // ─── State ────────────────────────────────────────────────────────────────

    getState(): ZephyrSessionState { return this.state; }

    private setState(s: ZephyrSessionState) {
        this.state = s;
        this.emit('state_change', s);
    }

    private get nextSeq(): number { return this.nonceCounter; }

    // ─── Handshake: Initiator ─────────────────────────────────────────────────

    async startAsInitiator(): Promise<void> {
        const helloPacket = await this.handshake.createHello();
        this.setState('HELLO_SENT');
        this.emit('packet', helloPacket);
    }

    // ─── Handshake: Responder ─────────────────────────────────────────────────

    async startAsResponder(helloPacket: ArrayBuffer): Promise<void> {
        const helloAck = await this.handshake.createHelloAck(helloPacket);
        this.setState('HELLO_ACKED');
        this.emit('packet', helloAck);
    }

    // ─── Incoming packet router ───────────────────────────────────────────────

    async receive(rawBuf: ArrayBuffer): Promise<void> {
        return new Promise((resolve) => {
            this.receiveQueue = this.receiveQueue.then(async () => {
                await this._processReceive(rawBuf);
                resolve();
            });
        });
    }

    private async _processReceive(rawBuf: ArrayBuffer): Promise<void> {
        const view = new DataView(rawBuf);
        const type = view.getUint8(PACKET.TYPE_OFFSET) as PacketType;

        try {
            switch (type) {
                case PacketType.HELLO:
                    await this.handleHello(rawBuf); break;
                case PacketType.HELLO_ACK:
                    await this.handleHelloAck(rawBuf); break;
                case PacketType.VERIFY:
                    await this.handleVerify(rawBuf); break;
                case PacketType.VERIFY_ACK:
                    await this.handleVerifyAck(rawBuf); break;
                case PacketType.META:
                    await this.handleMeta(rawBuf); break;
                case PacketType.DATA:
                    await this.handleData(rawBuf); break;
                case PacketType.ACK:
                    await this.handleAck(rawBuf); break;
                case PacketType.FIN:
                    this.handleFin(); break;
                case PacketType.ERR:
                    this.handleErr(rawBuf); break;
                default:
                // ignore unknown types
            }
        } catch (err) {
            const typeName = Object.entries(PacketType).find(([, v]) => v === type)?.[0] ?? `0x${type.toString(16)}`;
            console.error(`[Zephyr] receive error on packet type ${typeName}:`, err);
            this.emit('error', { message: String(err), type: typeName });
            await this.sendErr(0);
        }
    }

    // ─── Handshake Handlers ───────────────────────────────────────────────────

    private async handleHello(buf: ArrayBuffer) {
        if (this.state !== 'IDLE') return;
        await this.startAsResponder(buf);
    }

    private async handleHelloAck(buf: ArrayBuffer) {
        if (this.state !== 'HELLO_SENT') return;
        const verifyPacket = await this.handshake.createVerify(buf);
        this.sessionKeys = this.handshake.getSessionKeys()!;
        this.setState('VERIFY_SENT');
        this.emit('packet', verifyPacket);
    }

    private async handleVerify(buf: ArrayBuffer) {
        if (this.state !== 'HELLO_ACKED') return;
        this.sessionKeys = this.handshake.getSessionKeys()!;
        const verifyAck = await this.handshake.createVerifyAck(buf);
        this.setState('ESTABLISHED');
        this.emit('packet', verifyAck);
        this.emit('established', null);
        this.processTransferQueue();
    }

    private async handleVerifyAck(buf: ArrayBuffer) {
        if (this.state !== 'VERIFY_SENT') return;
        await this.handshake.processVerifyAck(buf);
        this.setState('ESTABLISHED');
        this.emit('established', null);
        this.processTransferQueue();
    }

    // ─── Transfer: Sender ─────────────────────────────────────────────────────

    queueFile(file: File) {
        this.transferQueue.push(file);
        if (this.state === 'ESTABLISHED' && !this.isTransferring) {
            this.processTransferQueue();
        }
    }

    private async processTransferQueue() {
        if (this.isTransferring || this.transferQueue.length === 0) return;
        if (this.state !== 'ESTABLISHED') return;

        this.isTransferring = true;
        const file = this.transferQueue.shift()!;
        await this.sendFile(file);
    }

    private async sendFile(file: File) {
        if (!this.sessionKeys) throw new Error('No session keys');
        this.setState('TRANSFERRING');

        const meta = await prepareFile(file);

        // Send metadata packet (seq 0 of transfer uses next nonce slot)
        const metaPayload = encodeMetadata(meta);
        const metaSeq = this.nextSeq;
        const metaPacket = await encodePacket(
            this.sessionKeys.sessionKey,
            PacketType.META,
            metaSeq,
            metaPayload,
        );
        this.nonceCounter++;

        // Store meta packet for possible retransmit
        const metaTimer = setTimeout(() => this.retransmitChunk(metaSeq), TRANSFER.RETRANSMIT_TIMEOUT_MS);
        this.pendingChunks.set(metaSeq, { seq: metaSeq, type: PacketType.META, data: metaPayload, sentAt: Date.now(), timer: metaTimer });

        this.emit('packet', metaPacket);

        let chunkIndex = 0;
        for await (const chunk of splitFile(file)) {
            await this.waitForWindow();

            const seq = this.nextSeq;

            // Prefix 4 bytes for chunk index
            const payload = new Uint8Array(4 + chunk.length);
            new DataView(payload.buffer).setUint32(0, chunkIndex, false);
            payload.set(chunk, 4);

            const packet = await encodePacket(
                this.sessionKeys.sessionKey,
                PacketType.DATA,
                seq,
                payload,
            );
            this.nonceCounter++;

            // Store for retransmit
            const timer = setTimeout(() => this.retransmitChunk(seq), TRANSFER.RETRANSMIT_TIMEOUT_MS);
            this.pendingChunks.set(seq, { seq, type: PacketType.DATA, data: payload, sentAt: Date.now(), timer });

            this.emit('packet', packet);
            this.emit('progress', { sent: chunkIndex + 1, total: meta.totalChunks });
            chunkIndex++;
        }
    }

    private async retransmitChunk(seq: number) {
        const pending = this.pendingChunks.get(seq);
        if (!pending || !this.sessionKeys) return;
        // On retransmit we must use a NEW nonce — reuse old seq is forbidden, use next counter
        const newSeq = this.nextSeq;
        const packet = await encodePacket(
            this.sessionKeys.sessionKey,
            pending.type,
            newSeq,
            pending.data,
        );
        this.nonceCounter++;
        pending.timer = setTimeout(() => this.retransmitChunk(newSeq), TRANSFER.RETRANSMIT_TIMEOUT_MS);
        this.pendingChunks.delete(seq);
        this.pendingChunks.set(newSeq, { ...pending, seq: newSeq });
        this.emit('packet', packet);
    }

    private async waitForWindow(): Promise<void> {
        if (this.pendingChunks.size < TRANSFER.MAX_CONCURRENT) return;
        return new Promise<void>(resolve => {
            this.windowQueue.push(resolve);
        });
    }

    // ─── Transfer: Receiver ───────────────────────────────────────────────────

    private async handleMeta(buf: ArrayBuffer) {
        if (!this.sessionKeys) return;
        const { seq, payload } = await decodePacket(this.sessionKeys.sessionKey, buf);

        if (this.receiverState) {
            // we already parsed meta, just ack it in case our ack was lost
            await this.sendAckFor(seq);
            return;
        }

        const meta = decodeMetadata(payload);
        this.receiverState = {
            meta,
            chunks: new Map(),
            expectedChunks: meta.totalChunks,
            receivedCount: 0,
        };
        this.emit('transfer_start', meta);
        await this.sendAckFor(seq);
    }

    private async handleData(buf: ArrayBuffer) {
        if (!this.sessionKeys) return;

        const { seq, payload } = await decodePacket(this.sessionKeys.sessionKey, buf);

        const r = this.receiverState;
        if (!r) {
            // Wait for META packet; ignore DATA for now (sender will retransmit)
            return;
        }

        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const chunkIndex = view.getUint32(0, false);
        const chunkData = payload.subarray(4);

        if (!r.chunks.has(chunkIndex)) {
            r.chunks.set(chunkIndex, chunkData);
            r.receivedCount++;
            this.emit('chunk_received', { index: r.receivedCount, total: r.expectedChunks });
        }
        await this.sendAckFor(seq);


        // Check if complete
        if (r.receivedCount >= r.expectedChunks) {
            await this.finalizeReceive();
        }
    }

    private async finalizeReceive() {
        const r = this.receiverState!;
        // Sort chunks by seq order
        const sortedKeys = Array.from(r.chunks.keys()).sort((a, b) => a - b);
        const chunks = sortedKeys.map(k => r.chunks.get(k)!);
        const blob = reassembleChunks(chunks, r.meta.type);
        const valid = await verifyFileHash(blob, r.meta.sha256hex);

        if (!valid) {
            this.emit('error', { message: 'SHA-256 mismatch — file corrupted' });
            await this.sendErr(0);
            this.receiverState = undefined;
            return;
        }

        this.emit('fin', { blob, meta: r.meta });
        this.receiverState = undefined;
        this.setState('ESTABLISHED');
        this.isTransferring = false;
    }

    // ─── ACK ──────────────────────────────────────────────────────────────────

    private async handleAck(buf: ArrayBuffer) {
        if (!this.sessionKeys) return;
        const { seq } = await decodePacket(this.sessionKeys.sessionKey, buf);
        const pending = this.pendingChunks.get(seq);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingChunks.delete(seq);

            // Advance transmission window
            if (this.windowQueue.length > 0 && this.pendingChunks.size < TRANSFER.MAX_CONCURRENT) {
                this.windowQueue.shift()!();
            }
        }
        // All chunks acked?
        if (this.pendingChunks.size === 0 && this.isTransferring) {
            this.setState('ESTABLISHED');
            this.isTransferring = false;
            this.processTransferQueue();
        }
    }

    private async sendAckFor(seq: number) {
        if (!this.sessionKeys) return;
        const ackPayload = new Uint8Array(4);
        new DataView(ackPayload.buffer).setUint32(0, seq, false);
        const ackSeq = this.nextSeq;
        const packet = await encodePacket(this.sessionKeys.sessionKey, PacketType.ACK, ackSeq, ackPayload);
        this.nonceCounter++;
        this.emit('packet', packet);
    }

    // ─── FIN / ERR ────────────────────────────────────────────────────────────

    private handleFin() {
        this.setState('CLOSED');
        this.emit('fin', null);
    }

    private handleErr(buf: ArrayBuffer) {
        const view = new DataView(buf);
        const errSeq = view.getUint32(PACKET.SEQ_OFFSET, false);
        this.emit('error', { message: `Remote sent ERR for seq ${errSeq}` });
    }

    private async sendErr(forSeq: number) {
        const payload = new Uint8Array(4);
        new DataView(payload.buffer).setUint32(0, forSeq, false);
        if (!this.sessionKeys) {
            // Pre-establishment error: send unencrypted
            const nonce = seqToNonce(this.nonceCounter++);
            const p = buildHandshakePacket(PacketType.ERR, this.nonceCounter, nonce, payload);
            this.emit('packet', p);
            return;
        }
        const seq = this.nextSeq;
        const p = await encodePacket(this.sessionKeys.sessionKey, PacketType.ERR, seq, payload);
        this.nonceCounter++;
        this.emit('packet', p);
    }

    destroy() {
        for (const pending of this.pendingChunks.values()) {
            clearTimeout(pending.timer);
        }
        this.pendingChunks.clear();
        this.listeners = [];
        this.setState('CLOSED');
    }
}

/**
 * ZEPHYR-1 File Chunker
 * Splits files into 64KB chunks for sequential encrypted transfer.
 * Reassembles received Uint8Array chunks into a downloadable Blob.
 */

import { CHUNK_SIZE } from '../constants';
import { sha256, bufferToHex } from './crypto';

export interface FileMetadata {
    name: string;
    size: number;
    type: string;
    sha256hex: string;
    totalChunks: number;
}

/**
 * Compute SHA-256 of a File and return metadata including chunck count.
 */
export async function prepareFile(file: File): Promise<FileMetadata> {
    const arrayBuf = await file.arrayBuffer();
    const hashBuf = await sha256(arrayBuf);
    const sha256hex = bufferToHex(hashBuf);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    return {
        name: file.name,
        size: file.size,
        type: file.type,
        sha256hex,
        totalChunks,
    };
}

/**
 * Async generator — yields 64KB Uint8Array chunks from a File.
 */
export async function* splitFile(file: File): AsyncGenerator<Uint8Array> {
    let offset = 0;
    while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buf = await slice.arrayBuffer();
        yield new Uint8Array(buf);
        offset += CHUNK_SIZE;
    }
}

/**
 * Reassemble an ordered array of Uint8Array chunks into a Blob.
 */
export function reassembleChunks(chunks: Uint8Array[], mimeType: string): Blob {
    // Copy each view to a freshly allocated ArrayBuffer of the exact size
    // to satisfy TypeScript's strict BlobPart typings and avoid slicing bugs.
    const parts: BlobPart[] = chunks.map((c) => {
        const buf = new ArrayBuffer(c.byteLength);
        new Uint8Array(buf).set(c);
        return buf;
    });
    return new Blob(parts, { type: mimeType });
}

/**
 * Verify reassembled file integrity by comparing SHA-256 hex.
 */
export async function verifyFileHash(blob: Blob, expectedHex: string): Promise<boolean> {
    const buf = await blob.arrayBuffer();
    const hashBuf = await sha256(buf);
    const actualHex = bufferToHex(hashBuf);
    return actualHex === expectedHex;
}

/**
 * Encode FileMetadata as a JSON UTF-8 Uint8Array to send as DATA first payload.
 */
export function encodeMetadata(meta: FileMetadata): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(meta));
}

export function decodeMetadata(bytes: Uint8Array): FileMetadata {
    return JSON.parse(new TextDecoder().decode(bytes)) as FileMetadata;
}

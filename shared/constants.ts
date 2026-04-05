// ZEPHYR-1 Protocol Constants

export const PROTOCOL_VERSION = 0x01;
export const WS_PORT = 7473;
export const CHUNK_SIZE = 65536; // 64 KB

export enum PacketType {
    HELLO = 0x01,
    HELLO_ACK = 0x02,
    VERIFY = 0x03,
    VERIFY_ACK = 0x04,
    DATA = 0x05,
    ACK = 0x06,
    FIN = 0x07,
    ERR = 0x08,
    REQUEST = 0x09,
    REQUEST_ACK = 0x0A,
}

// Signalling server message types (JSON envelope)
export enum SignalType {
    HELLO = 'HELLO',
    PEER_LIST = 'PEER_LIST',
    RELAY = 'RELAY',
    CODE_REGISTER = 'CODE_REGISTER',
    CODE_MATCH = 'CODE_MATCH',
    REQUEST = 'REQUEST',
    REQUEST_ACK = 'REQUEST_ACK',
}

// Packet layout offsets
export const PACKET = {
    VER_OFFSET: 0,
    TYPE_OFFSET: 1,
    SEQ_OFFSET: 2,
    NONCE_OFFSET: 6,
    PAYLOAD_OFFSET: 18, // after VER(1) + TYPE(1) + SEQ(4) + NONCE(12)
    HEADER_SIZE: 18,
    TAG_SIZE: 16,
    NONCE_SIZE: 12,
    AAD_SIZE: 6,  // VER + TYPE + SEQ
} as const;

export const TRANSFER = {
    MAX_CONCURRENT: 1,
    RETRANSMIT_TIMEOUT_MS: 3000,
    NONCE_OVERFLOW: 2 ** 32,
} as const;

export const TOTP = {
    WINDOW_SECONDS: 30,
    TTL_WINDOWS: 10,      // 5 minutes
    DIGITS: 6,
} as const;

export const RATE_LIMIT = {
    MAX_RELAY_PER_SEC: 10,
} as const;

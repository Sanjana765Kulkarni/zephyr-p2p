# Research Paper Diagrams (Mermaid)

Copy and paste the code blocks below into any Mermaid renderer (like [Mermaid Live Editor](https://mermaid.live/), Notion, or GitHub) to export high-quality image files for your research paper.

## 1. System Architecture Diagram
This diagram shows the stateless signaling server routing traffic between the two clients.

```mermaid
graph LR
    subgraph S[Signaling Server]
        W[WebSocket Router]
    end
    
    subgraph A[Client A]
        UI_A[React UI] <--> Z_A[ZEPHYR Engine]
    end
    
    subgraph B[Client B]
        UI_B[React UI] <--> Z_B[ZEPHYR Engine]
    end
    
    Z_A -.->|Base64 Relayed WebSockets| W
    Z_B -.->|Base64 Relayed WebSockets| W
    Z_A ===|End-to-End Encrypted Tunnel| Z_B
    
    style S fill:#1c1e21,stroke:#4a5568,stroke-width:2px,color:#fff
    style A fill:#2d3748,stroke:#a0aec0,color:#fff
    style B fill:#2d3748,stroke:#a0aec0,color:#fff
    style Z_A fill:#3182ce,stroke:#2b6cb0,color:#fff
    style Z_B fill:#3182ce,stroke:#2b6cb0,color:#fff
```

## 2. Cryptographic Handshake Sequence
This diagram proves exactly how Device A and Device B generate their keys and lock the AES session.

```mermaid
sequenceDiagram
    participant A as Device A (Initiator)
    participant B as Device B (Responder)
    
    Note over A, B: 1. Asymmetric ECDH P-256 Key Pair Generation
    A->>B: HELLO (PubA, random bytes)
    B->>A: HELLO_ACK (PubB, random bytes)
    
    Note over A, B: 2. Both mathematically compute the EXACT same Shared Secret<br/>A computes: ECDH(PubA, PrivB)<br/>B computes: ECDH(PubB, PrivA)
    Note over A, B: 3. HKDF-SHA256(Shared Secret) derives the 256-bit AES Session Key
    
    A->>B: VERIFY (HMAC-SHA256 of entire transcript)
    B->>A: VERIFY_ACK (HMAC-SHA256 of VERIFY)
    
    Note over A, B: Keys verified against tampering. Session ESTABLISHED!
```

## 3. Data Transfer & Sliding Window Protocol
This sequence diagram visually demonstrates the ZEPHYR-1 chunking and ARQ window protocol.

```mermaid
sequenceDiagram
    participant S as Sender
    participant R as Receiver
    
    Note over S: Computes absolute SHA-256 hash of entire file
    S->>R: META (filename, totalChunks, sha256hex)
    R-->>S: ACK (seq 0)
    
    Note over S: File slicing initiates (64 KB fragments)
    rect rgb(30, 40, 50)
        Note over S: Sliding Window Pipeline [Capacity: 32 chunks]
        S->>R: DATA (chunkIndex: 0) AES-GCM Encrypted
        S->>R: DATA (chunkIndex: 1) AES-GCM Encrypted
        S->>R: DATA (chunkIndex: 2) AES-GCM Encrypted
        R-->>S: ACK (seq 1)
        Note over S: Window advances, unlocking next queued chunk
        S->>R: DATA (chunkIndex: 3) AES-GCM Encrypted
        R-->>S: ACK (seq 2)
        R-->>S: ACK (seq 3)
    end
    
    Note over R: Downloads chunks, AES deciphers natively, and sequentially <br/>re-assembles them into array buffers in active memory space.
    Note over R: Validates final unified file via original META SHA-256 <br/>to guarantee bit-for-bit uncorrupted file integrity!
    Note over R: Triggers Native Save File / Browser Download
```

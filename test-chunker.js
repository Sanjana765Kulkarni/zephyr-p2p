const crypto = require('crypto');
const fs = require('fs');

async function run() {
    const CHUNK_SIZE = 65536;
    const textData = "Hello, this is a secret message.";
    const fileBytes = Buffer.from(textData, 'utf-8');
    
    // Simulating prepareFile
    const expectedHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
    console.log("Expected Hash:", expectedHash);

    // Simulating splitFile
    const chunks = [];
    let offset = 0;
    while(offset < fileBytes.length) {
        chunks.push(fileBytes.subarray(offset, offset + CHUNK_SIZE));
        offset += CHUNK_SIZE;
    }

    // Simulating reassembleChunks
    const reassembled = Buffer.concat(chunks);
    const actualHash = crypto.createHash('sha256').update(reassembled).digest('hex');
    console.log("Actual Hash:", actualHash);

    // Blob creation via Blob class (node 18+)
    const blob = new Blob(chunks, { type: 'text/plain' });
    const blobBuf = await blob.arrayBuffer();
    const blobHash = crypto.createHash('sha256').update(Buffer.from(blobBuf)).digest('hex');
    console.log("Blob Hash:", blobHash);

    if (expectedHash === blobHash) {
        console.log("Integrity: PERFECT MATCH");
    } else {
        console.log("Integrity: FAILED");
    }
}
run();

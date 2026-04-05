/**
 * FileDrop — Drag-and-drop / click-to-select file zone.
 */
import React, { useRef, useState, useCallback } from 'react';

interface FileDropProps {
    onFile: (file: File) => void;
    file: File | null;
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const FileDrop: React.FC<FileDropProps> = ({ onFile, file }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
    }, [onFile]);

    return (
        <div
            className={`file-drop${dragging ? ' file-drop--active' : ''}${file ? ' file-drop--loaded' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="Drop a file or click to select"
            id="file-drop-zone"
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
            <input
                ref={inputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            {file ? (
                <div className="file-info">
                    <span className="file-icon">📄</span>
                    <div>
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatBytes(file.size)}</div>
                    </div>
                </div>
            ) : (
                <div className="file-placeholder">
                    <span className="file-drop-icon">↑</span>
                    <span>Drop a file or <u>click to select</u></span>
                </div>
            )}
        </div>
    );
};

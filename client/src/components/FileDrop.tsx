/**
 * FileDrop — Drag-and-drop / click-to-select file zone.
 */
import React, { useRef, useState, useCallback } from 'react';

interface FileDropProps {
    onFiles: (files: File[]) => void;
    files: File[];
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const FileDrop: React.FC<FileDropProps> = ({ onFiles, files }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) onFiles(droppedFiles);
    }, [onFiles]);

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    return (
        <div
            className={`file-drop${dragging ? ' file-drop--active' : ''}${files.length > 0 ? ' file-drop--loaded' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="Drop files or click to select"
            id="file-drop-zone"
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
            <input
                ref={inputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                    const f = Array.from(e.target.files || []);
                    if (f.length > 0) onFiles(f);
                }}
            />
            {files.length > 0 ? (
                <div className="file-info">
                    <span className="file-icon">📄</span>
                    <div>
                        <div className="file-name">{files.length === 1 ? files[0].name : `${files.length} files selected`}</div>
                        <div className="file-size">{formatBytes(totalSize)}</div>
                    </div>
                </div>
            ) : (
                <div className="file-placeholder">
                    <span className="file-drop-icon">↑</span>
                    <span>Drop files or <u>click to select</u></span>
                </div>
            )}
        </div>
    );
};

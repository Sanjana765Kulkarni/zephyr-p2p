/**
 * CodeInput — 6-digit numeric code entry field.
 */
import React from 'react';

interface CodeInputProps {
    value: string;
    onChange: (val: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
}

export const CodeInput: React.FC<CodeInputProps> = ({ value, onChange, onSubmit, disabled }) => (
    <div className="code-input-wrapper">
        <input
            id="code-input"
            className="code-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="──────"
            value={value}
            disabled={disabled}
            onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
                onChange(raw);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.length === 6) onSubmit(); }}
            autoComplete="one-time-code"
        />
        <button
            className="code-connect-btn"
            onClick={onSubmit}
            disabled={disabled || value.length < 6}
            id="code-connect-btn"
        >
            Connect →
        </button>
    </div>
);

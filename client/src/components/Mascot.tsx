/**
 * Mascot — Animated SVG pigeon with float + wind animations.
 * mode="windwhisper" → white letter
 * mode="kabutar"     → dark sealed letter
 */
import React from 'react';

interface MascotProps {
    mode: 'windwhisper' | 'kabutar';
    size?: number;
}

export const Mascot: React.FC<MascotProps> = ({ mode, size = 120 }) => {
    const letterFill = mode === 'windwhisper' ? '#ffffff' : '#1a1917';

    return (
        <div className="mascot-wrapper" style={{ width: size, height: size }}>
            <svg
                viewBox="0 0 120 120"
                width={size}
                height={size}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="mascot-pigeon"
            >
                {/* Wind lines — staggered left-to-right animation */}
                <line x1="2" y1="55" x2="18" y2="55" stroke="#1a1917" strokeWidth="1.5" className="wind-line wind-1" strokeLinecap="round" />
                <line x1="2" y1="63" x2="14" y2="63" stroke="#1a1917" strokeWidth="1.5" className="wind-line wind-2" strokeLinecap="round" />
                <line x1="2" y1="71" x2="10" y2="71" stroke="#1a1917" strokeWidth="1.5" className="wind-line wind-3" strokeLinecap="round" />

                {/* Body */}
                <ellipse cx="68" cy="68" rx="28" ry="22" fill="#e8e5de" stroke="#1a1917" strokeWidth="1" />

                {/* Head */}
                <ellipse cx="88" cy="48" rx="14" ry="13" fill="#e8e5de" stroke="#1a1917" strokeWidth="1" />

                {/* Beak */}
                <path d="M100 46 L108 48 L100 51 Z" fill="#BA7517" />

                {/* Eye */}
                <circle cx="93" cy="46" r="2.5" fill="#1a1917" />
                <circle cx="94" cy="45.2" r="0.8" fill="#ffffff" />

                {/* Wing */}
                <path
                    d="M60 60 Q52 50 44 56 Q50 66 60 68 Z"
                    fill="#d6d3cc"
                    stroke="#1a1917"
                    strokeWidth="0.8"
                />
                <path
                    d="M60 63 Q50 55 40 63 Q48 70 60 70 Z"
                    fill="#c8c5be"
                    stroke="#1a1917"
                    strokeWidth="0.6"
                />

                {/* Tail feathers */}
                <path d="M42 72 Q36 80 30 78 Q34 70 42 70 Z" fill="#d6d3cc" stroke="#1a1917" strokeWidth="0.8" />
                <path d="M38 74 Q30 84 24 80 Q30 72 38 72 Z" fill="#c8c5be" stroke="#1a1917" strokeWidth="0.6" />

                {/* Feet */}
                <path d="M60 88 L57 96 M60 88 L63 96 M58 96 L55 98 M58 96 L60 98 M62 96 L60 98" stroke="#1a1917" strokeWidth="1" strokeLinecap="round" />
                <path d="M72 90 L69 98 M72 90 L75 98 M70 98 L67 100 M70 98 L72 100 M74 98 L72 100" stroke="#1a1917" strokeWidth="1" strokeLinecap="round" />

                {/* Letter / envelope held in feet area */}
                <g transform="translate(58,76) rotate(-12)">
                    <rect
                        x="-9" y="-7"
                        width="18" height="14"
                        rx="1.5"
                        fill={letterFill}
                        stroke={mode === 'windwhisper' ? '#888780' : '#f5f3ee'}
                        strokeWidth="1"
                    />
                    {mode === 'windwhisper' ? (
                        /* Open envelope — flap */
                        <path d="M-9,-7 L0,1 L9,-7" stroke="#888780" strokeWidth="0.8" fill="none" />
                    ) : (
                        /* Sealed — wax dot */
                        <circle cx="0" cy="1" r="2.5" fill="#639922" />
                    )}
                </g>
            </svg>
        </div>
    );
};

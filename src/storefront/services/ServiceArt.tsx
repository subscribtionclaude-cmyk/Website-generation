import { useId } from 'react';

/**
 * Lightweight vector illustrations for the service heroes (local, no external assets, no
 * trademarks). Generic devices in the Malek Store palette: black, orange, white, neutral greys.
 */
type Variant = 'services' | 'repair' | 'tradeIn' | 'used' | 'afterSales';

const ORANGE = '#F65311';
const GLOW = 'rgba(246,83,17,0.35)';

function Phone({
  x,
  y,
  glow,
  scale = 1,
  tilt = 0,
}: {
  x: number;
  y: number;
  glow: string;
  scale?: number;
  tilt?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale})`}>
      <rect
        x="-46"
        y="-92"
        width="92"
        height="184"
        rx="18"
        fill="#1a1b1f"
        stroke="#3b3d44"
        strokeWidth="2"
      />
      <rect x="-40" y="-86" width="80" height="172" rx="13" fill="#0e0f12" />
      <rect x="-40" y="-86" width="80" height="172" rx="13" fill={`url(#${glow})`} opacity="0.9" />
      <rect x="-12" y="-80" width="24" height="6" rx="3" fill="#000" />
    </g>
  );
}

export function ServiceArt({ variant }: { variant: Variant }) {
  const id = useId().replace(/:/g, '');
  const glow = `glow${id}`;
  const floor = `floor${id}`;
  return (
    <svg viewBox="0 0 400 300" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glow} cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor={ORANGE} stopOpacity="0.55" />
          <stop offset="70%" stopColor="#0e0f12" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={floor} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={GLOW} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="262" rx="170" ry="26" fill={`url(#${floor})`} />
      {variant === 'repair' && (
        <g>
          {/* Exploded layers: back, battery, board, screen */}
          <g transform="translate(200 150) skewY(-8)">
            <rect
              x="-120"
              y="-80"
              width="92"
              height="170"
              rx="16"
              fill="#26282e"
              stroke="#44474f"
            />
            <rect x="-104" y="-20" width="60" height="84" rx="8" fill="#3a3d45" />
            <rect x="-60" y="-96" width="92" height="170" rx="16" fill="#1d1f24" stroke="#44474f" />
            <rect x="-48" y="-84" width="68" height="60" rx="6" fill="#2f6b4a" />
            <circle cx="-30" cy="-60" r="6" fill={ORANGE} />
            <rect
              x="0"
              y="-112"
              width="92"
              height="170"
              rx="16"
              fill="#0e0f12"
              stroke={ORANGE}
              strokeWidth="2.5"
            />
            <rect x="8" y="-104" width="76" height="154" rx="11" fill={`url(#${glow})`} />
          </g>
          <g stroke={ORANGE} strokeWidth="2" strokeDasharray="4 6" opacity="0.8">
            <path d="M120 70 L170 52" />
            <path d="M180 60 L230 42" />
          </g>
        </g>
      )}
      {variant === 'tradeIn' && (
        <g>
          <Phone x={130} y={150} glow={glow} scale={0.82} tilt={-8} />
          <Phone x={270} y={140} glow={glow} scale={0.92} tilt={6} />
          <path
            d="M160 64 C 200 30, 240 30, 262 52"
            fill="none"
            stroke={ORANGE}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M252 40 L266 54 L248 60"
            fill="none"
            stroke={ORANGE}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M240 250 C 200 280, 160 280, 138 258"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.5"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      )}
      {variant === 'used' && (
        <g>
          <Phone x={200} y={146} glow={glow} />
          <circle cx="258" cy="70" r="30" fill={ORANGE} />
          <path
            d="M244 70 l10 10 l18 -20"
            fill="none"
            stroke="#0b0b0c"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g fill="#fff" opacity="0.8">
            <rect x="150" y="226" width="100" height="8" rx="4" />
          </g>
        </g>
      )}
      {variant === 'afterSales' && (
        <g>
          <rect
            x="120"
            y="120"
            width="160"
            height="120"
            rx="14"
            fill="#1d1f24"
            stroke="#44474f"
            strokeWidth="2"
          />
          <path d="M120 150 L200 175 L280 150" fill="none" stroke="#44474f" strokeWidth="2" />
          <path
            d="M200 52 L246 70 V110 C246 140 226 160 200 170 C174 160 154 140 154 110 V70 Z"
            fill={ORANGE}
          />
          <path
            d="M182 110 l12 12 l24 -26"
            fill="none"
            stroke="#0b0b0c"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {variant === 'services' && (
        <g>
          <Phone x={150} y={150} glow={glow} scale={0.9} tilt={-10} />
          <rect
            x="210"
            y="96"
            width="140"
            height="100"
            rx="10"
            fill="#1d1f24"
            stroke="#44474f"
            strokeWidth="2"
          />
          <rect x="220" y="106" width="120" height="74" rx="6" fill={`url(#${glow})`} />
          <rect x="196" y="196" width="168" height="10" rx="5" fill="#3b3d44" />
          <circle cx="330" cy="72" r="22" fill={ORANGE} />
          <path
            d="M322 72 h16 M330 64 v16"
            stroke="#0b0b0c"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}

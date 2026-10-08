import { hash, inkFor, stampDate } from "../lib";

type Props = {
  serial: string;
  idx: number;
  place: string;
  date: number;
  imageUrl: string | null;
  pending?: boolean;
  active?: boolean;
  size?: number;
  onHover?: (on: boolean) => void;
  onClick?: () => void;
};

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/**
 * A passport stamp. Lettering is drawn here (crisp and correct); the AI only
 * paints the little ink illustration in the middle, tinted to the stamp's ink.
 */
export function Stamp({ serial, idx, place, date, imageUrl, pending, active, size = 132, onHover, onClick }: Props) {
  const h = hash(`${serial}:${idx}`);
  const ink = inkFor(`${serial}:${idx}`);
  const [r, g, b] = hexToRgb(ink);
  const shape = h % 3; // 0 circle, 1 rounded rect, 2 octagon
  const rot = ((h >> 3) % 25) - 12;
  const id = `s${h.toString(36)}`;
  const city = place.split(",")[0].toUpperCase().slice(0, 18);
  const top = `${city} ·`;
  const bottom = `${stampDate(date)} · HOP ${idx}`;

  return (
    <button
      type="button"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      onClick={onClick}
      className="group relative shrink-0 rounded-full transition-transform duration-200 hover:z-10 hover:scale-110 focus:outline-none"
      style={{ width: size, height: size, ["--r" as string]: `${rot}deg` }}
      aria-label={`Hop ${idx}, ${place}, ${stampDate(date)}`}
    >
      <svg viewBox="0 0 120 120" className="animate-stamp h-full w-full" style={{ transform: `rotate(${rot}deg)`, filter: active ? `drop-shadow(0 0 6px ${ink}88)` : undefined }}>
        <defs>
          <filter id={`${id}-tint`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={`0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  -0.75 -0.75 -0.75 0 2.05`} />
          </filter>
          <filter id={`${id}-worn`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed={h % 97} result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.9" result="m" />
            <feComposite in="SourceGraphic" in2="m" operator="in" />
          </filter>
          <path id={`${id}-top`} d="M 18 60 A 42 42 0 0 1 102 60" />
          <path id={`${id}-bot`} d="M 14 60 A 46 46 0 0 0 106 60" />
          <clipPath id={`${id}-clip`}>
            <circle cx="60" cy="60" r="29.5" />
          </clipPath>
        </defs>
        <g filter={`url(#${id}-worn)`} fill="none" stroke={ink} opacity={pending ? 0.45 : 0.92}>
          {shape === 0 && (
            <>
              <circle cx="60" cy="60" r="56" strokeWidth="3" />
              <circle cx="60" cy="60" r="51" strokeWidth="1" />
              <circle cx="60" cy="60" r="31" strokeWidth="1.4" />
            </>
          )}
          {shape === 1 && (
            <>
              <rect x="5" y="5" width="110" height="110" rx="20" strokeWidth="3" />
              <rect x="10" y="10" width="100" height="100" rx="16" strokeWidth="1" />
              <circle cx="60" cy="60" r="31" strokeWidth="1.4" />
            </>
          )}
          {shape === 2 && (
            <>
              <polygon points="38,4 82,4 116,38 116,82 82,116 38,116 4,82 4,38" strokeWidth="3" />
              <polygon points="40,9 80,9 111,40 111,80 80,111 40,111 9,80 9,40" strokeWidth="1" />
              <circle cx="60" cy="60" r="31" strokeWidth="1.4" />
            </>
          )}
          <g fill={ink} stroke="none" fontFamily="'IBM Plex Mono', monospace" fontWeight="600">
            <text fontSize="9.5" letterSpacing="1.5">
              <textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle">{top}</textPath>
            </text>
            <text fontSize="7.2" letterSpacing="1.1">
              <textPath href={`#${id}-bot`} startOffset="50%" textAnchor="middle">{bottom}</textPath>
            </text>
            <text x="20" y="64" fontSize="7" textAnchor="middle">★</text>
            <text x="100" y="64" fontSize="7" textAnchor="middle">★</text>
          </g>
          {imageUrl ? (
            <image
              href={imageUrl}
              x="30"
              y="30"
              width="60"
              height="60"
              clipPath={`url(#${id}-clip)`}
              filter={`url(#${id}-tint)`}
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <g fill={ink} stroke="none" textAnchor="middle">
              <text x="60" y="58" fontFamily="Fraunces, serif" fontSize="22" fontWeight="700" fontStyle="italic">
                №{idx}
              </text>
              <text x="60" y="72" fontFamily="'IBM Plex Mono', monospace" fontSize="6.5" letterSpacing="1">
                {pending ? "INKING…" : serial}
              </text>
            </g>
          )}
        </g>
      </svg>
    </button>
  );
}

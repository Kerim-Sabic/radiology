import { LEVEL_STYLE, starPoints, type CertLevel } from '../../shared/certificateLevels';

/** The certificate seal in its level's colour: ring, check mark and one to three stars (the same as on the share images). */
export function CertSeal({ level, size = 170 }: { level: CertLevel; size?: number }) {
  const st = LEVEL_STYLE[level];
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`cert-ring-${level}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={st.ring[0]} />
          <stop offset="1" stopColor={st.ring[1]} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="92" fill="none" stroke={`url(#cert-ring-${level})`} strokeWidth="10" />
      <circle cx="100" cy="100" r="74" fill={st.soft} stroke={st.line} strokeWidth="2" strokeDasharray="4 6" />
      <path d="M66 94 L89 117 L134 72" fill="none" stroke={st.accent} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      {[76, 100, 124].map((x, i) => (
        <polygon key={x} points={starPoints(x, 150, 10)} fill={i < level ? st.accent : 'none'} stroke={st.accent} strokeWidth="2" />
      ))}
    </svg>
  );
}

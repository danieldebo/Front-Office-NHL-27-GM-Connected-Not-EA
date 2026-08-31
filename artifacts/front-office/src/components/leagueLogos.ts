/**
 * Generic hockey-style league logo presets — simple inline SVG badges (no
 * external hosting needed) a commissioner can pick without providing their
 * own artwork. A league can also link any public image instead.
 */

function svgDataUri(inner: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const INK = '#0E1620';
const ICE = '#EAF1F6';
const CREASE = '#2F6FB5';
const GOAL = '#B33A2B';
const BULB = '#F2A93B';

export interface LeagueLogoPreset {
  name: string;
  url: string;
}

export const LEAGUE_LOGO_PRESETS: LeagueLogoPreset[] = [
  {
    name: 'Puck Badge',
    url: svgDataUri(`
      <circle cx="50" cy="50" r="46" fill="${CREASE}"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="${ICE}" stroke-width="4"/>
      <ellipse cx="50" cy="54" rx="24" ry="14" fill="${INK}"/>
      <ellipse cx="50" cy="50" rx="24" ry="14" fill="#1B2733"/>
    `),
  },
  {
    name: 'Crossed Sticks',
    url: svgDataUri(`
      <path d="M50 4 L92 30 L92 70 L50 96 L8 70 L8 30 Z" fill="${INK}"/>
      <path d="M50 10 L86 32 L86 68 L50 90 L14 68 L14 32 Z" fill="${CREASE}"/>
      <rect x="20" y="46" width="60" height="8" rx="4" fill="${ICE}" transform="rotate(-28 50 50)"/>
      <rect x="20" y="46" width="60" height="8" rx="4" fill="${ICE}" transform="rotate(28 50 50)"/>
      <circle cx="50" cy="50" r="7" fill="${BULB}"/>
    `),
  },
  {
    name: 'Ice Shield',
    url: svgDataUri(`
      <path d="M50 4 L90 18 L90 52 C90 76 72 92 50 98 C28 92 10 76 10 52 L10 18 Z" fill="${GOAL}"/>
      <path d="M50 12 L82 24 L82 52 C82 71 68 84 50 90 C32 84 18 71 18 52 L18 24 Z" fill="${ICE}"/>
      <rect x="18" y="46" width="64" height="12" fill="${CREASE}"/>
      <circle cx="50" cy="34" r="10" fill="${INK}"/>
    `),
  },
  {
    name: 'Rink Circle',
    url: svgDataUri(`
      <circle cx="50" cy="50" r="46" fill="${ICE}"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="${INK}" stroke-width="4"/>
      <circle cx="50" cy="50" r="28" fill="none" stroke="${CREASE}" stroke-width="5"/>
      <circle cx="50" cy="50" r="5" fill="${GOAL}"/>
      <line x1="50" y1="4" x2="50" y2="96" stroke="${CREASE}" stroke-width="3"/>
    `),
  },
  {
    name: 'Winged Puck',
    url: svgDataUri(`
      <path d="M6 52 C22 30 40 44 50 44 C60 44 78 30 94 52 C78 46 62 52 50 52 C38 52 22 46 6 52 Z" fill="${BULB}"/>
      <ellipse cx="50" cy="66" rx="26" ry="15" fill="${INK}"/>
      <ellipse cx="50" cy="62" rx="26" ry="15" fill="#1B2733"/>
    `),
  },
  {
    name: 'Net Badge',
    url: svgDataUri(`
      <circle cx="50" cy="50" r="46" fill="${INK}"/>
      <path d="M18 30 L82 30 L74 84 L26 84 Z" fill="none" stroke="${ICE}" stroke-width="3"/>
      <line x1="26" y1="30" x2="30" y2="84" stroke="${ICE}" stroke-width="1.5"/>
      <line x1="38" y1="30" x2="40" y2="84" stroke="${ICE}" stroke-width="1.5"/>
      <line x1="50" y1="30" x2="50" y2="84" stroke="${ICE}" stroke-width="1.5"/>
      <line x1="62" y1="30" x2="60" y2="84" stroke="${ICE}" stroke-width="1.5"/>
      <line x1="74" y1="30" x2="70" y2="84" stroke="${ICE}" stroke-width="1.5"/>
      <circle cx="50" cy="60" r="9" fill="${GOAL}"/>
    `),
  },
];

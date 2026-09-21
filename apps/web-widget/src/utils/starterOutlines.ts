/**
 * Built-in coloring pages so the Coloring Corner works instantly, offline,
 * and before a child has asked Kidbot for anything. Simple closed shapes so
 * the bucket fill has regions to fill. All use the same 1024 viewBox and
 * stroke style as generated outlines and pass the SVG sanitizer allowlist.
 */
export type StarterStyle = 'animals' | 'space' | 'underwater';

export interface StarterOutline {
  id: string;
  title: string;
  style: StarterStyle;
  svg: string;
}

const wrap = (body: string) =>
  `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" role="img"><g stroke="#000" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

export const STARTER_OUTLINES: readonly StarterOutline[] = [
  {
    id: 'cat',
    title: 'Curious cat',
    style: 'animals',
    svg: wrap(
      '<circle cx="512" cy="540" r="330"/>' +
        '<path d="M300 330 l-40 -190 l190 90 z"/><path d="M724 330 l40 -190 l-190 90 z"/>' +
        '<circle cx="410" cy="500" r="40"/><circle cx="614" cy="500" r="40"/>' +
        '<path d="M470 600 q42 40 84 0"/><path d="M512 600 l0 40"/>' +
        '<path d="M300 620 l-130 -20"/><path d="M300 660 l-130 20"/>' +
        '<path d="M724 620 l130 -20"/><path d="M724 660 l130 20"/>',
    ),
  },
  {
    id: 'turtle',
    title: 'Friendly turtle',
    style: 'animals',
    svg: wrap(
      '<ellipse cx="500" cy="560" rx="300" ry="200"/>' +
        '<path d="M330 500 q170 -120 340 0"/><path d="M290 600 q210 90 420 0"/>' +
        '<path d="M420 400 l50 160"/><path d="M580 400 l-50 160"/>' +
        '<circle cx="820" cy="520" r="80"/><circle cx="845" cy="500" r="12"/>' +
        '<ellipse cx="300" cy="740" rx="70" ry="40"/><ellipse cx="700" cy="740" rx="70" ry="40"/>' +
        '<path d="M200 560 q-80 20 -40 80"/>',
    ),
  },
  {
    id: 'rocket',
    title: 'Ready rocket',
    style: 'space',
    svg: wrap(
      '<path d="M512 120 q160 200 160 520 l-320 0 q0 -320 160 -520 z"/>' +
        '<circle cx="512" cy="420" r="70"/>' +
        '<path d="M352 520 l-110 130 l110 0 z"/><path d="M672 520 l110 130 l-110 0 z"/>' +
        '<path d="M430 640 l0 120 l164 0 l0 -120"/>' +
        '<path d="M460 760 q52 140 104 0"/>' +
        '<circle cx="180" cy="220" r="30"/><circle cx="860" cy="300" r="20"/><circle cx="800" cy="860" r="40"/>',
    ),
  },
  {
    id: 'planet',
    title: 'Ringed planet',
    style: 'space',
    svg: wrap(
      '<circle cx="512" cy="512" r="240"/>' +
        '<ellipse cx="512" cy="540" rx="420" ry="90"/>' +
        '<circle cx="430" cy="440" r="40"/><circle cx="590" cy="600" r="60"/><circle cx="560" cy="400" r="24"/>' +
        '<circle cx="150" cy="180" r="24"/><circle cx="900" cy="200" r="34"/><circle cx="880" cy="880" r="20"/>',
    ),
  },
  {
    id: 'fish',
    title: 'Happy fish',
    style: 'underwater',
    svg: wrap(
      '<path d="M220 512 q260 -300 560 0 q-300 300 -560 0 z"/>' +
        '<path d="M780 512 l150 -130 l0 260 z"/>' +
        '<circle cx="360" cy="470" r="34"/>' +
        '<path d="M480 420 q60 30 0 90"/><path d="M560 400 q70 40 0 120"/>' +
        '<circle cx="200" cy="260" r="26"/><circle cx="260" cy="180" r="18"/>' +
        '<path d="M120 900 q100 -60 200 0 q100 60 200 0 q100 -60 200 0 q100 60 200 0"/>',
    ),
  },
  {
    id: 'octopus',
    title: 'Waving octopus',
    style: 'underwater',
    svg: wrap(
      '<path d="M312 520 q0 -300 200 -300 q200 0 200 300 z"/>' +
        '<circle cx="450" cy="400" r="30"/><circle cx="574" cy="400" r="30"/>' +
        '<path d="M470 470 q42 30 84 0"/>' +
        '<path d="M330 520 q-80 200 40 300"/><path d="M420 520 q-20 220 60 320"/>' +
        '<path d="M512 520 q0 240 0 320"/><path d="M604 520 q20 220 -60 320"/>' +
        '<path d="M694 520 q80 200 -40 300"/>' +
        '<circle cx="820" cy="260" r="22"/><circle cx="860" cy="200" r="14"/>',
    ),
  },
];

export const starterOutlinesFor = (style?: StarterStyle): readonly StarterOutline[] =>
  style ? STARTER_OUTLINES.filter((outline) => outline.style === style) : STARTER_OUTLINES;

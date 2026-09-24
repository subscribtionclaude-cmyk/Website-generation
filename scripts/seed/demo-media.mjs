// Generic, brand-free device illustrations for DEMO products (no licensed product imagery).
// Each render is an SVG tinted with the variant colour so that switching colour visibly switches media.

const W = 800;
const H = 800;

function shade(hex, amount) {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + 255 * amount);
  const g = clamp(((n >> 8) & 255) + 255 * amount);
  const b = clamp((n & 255) + 255 * amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function frame(content, id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<defs>
<radialGradient id="floor-${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="gloss-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
<linearGradient id="screen-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1c22"/><stop offset=".55" stop-color="#0c0d10"/><stop offset="1" stop-color="#20120b"/></linearGradient>
<linearGradient id="wash-${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f65311" stop-opacity=".55"/><stop offset=".45" stop-color="#f65311" stop-opacity=".08"/><stop offset="1" stop-color="#3a4f7a" stop-opacity=".25"/></linearGradient>
</defs>
<ellipse cx="400" cy="722" rx="250" ry="26" fill="url(#floor-${id})"/>
${content}
</svg>
`;
}

const lens = (cx, cy, r, body) =>
  `<circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="${shade(body, -0.12)}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#0d0e12"/><circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#1f2a3c"/><circle cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.18}" fill="#fff" opacity=".55"/>`;

const templates = {
  'phone-front': (c, id) => `
<rect x="250" y="70" width="300" height="640" rx="58" fill="${c}"/>
<rect x="262" y="82" width="276" height="616" rx="48" fill="#050506"/>
<rect x="272" y="92" width="256" height="596" rx="40" fill="url(#screen-${id})"/>
<rect x="352" y="108" width="96" height="26" rx="13" fill="#000"/>
<rect x="272" y="92" width="256" height="596" rx="40" fill="url(#wash-${id})"/>
<rect x="250" y="70" width="300" height="640" rx="58" fill="url(#gloss-${id})" opacity=".35"/>`,
  'phone-back': (c, id) => `
<rect x="250" y="70" width="300" height="640" rx="58" fill="${c}"/>
<rect x="250" y="70" width="300" height="640" rx="58" fill="url(#gloss-${id})"/>
<rect x="276" y="96" width="170" height="170" rx="40" fill="${shade(c, -0.08)}" stroke="${shade(c, 0.12)}" stroke-width="3"/>
${lens(326, 146, 30, c)}${lens(326, 218, 30, c)}${lens(398, 182, 30, c)}
<circle cx="410" cy="116" r="8" fill="#e7e1c9"/>`,
  'phone-back-dual': (c, id) => `
<rect x="250" y="70" width="300" height="640" rx="58" fill="${c}"/>
<rect x="250" y="70" width="300" height="640" rx="58" fill="url(#gloss-${id})"/>
<rect x="276" y="96" width="92" height="170" rx="40" fill="${shade(c, -0.06)}"/>
${lens(322, 144, 28, c)}${lens(322, 218, 28, c)}`,
  'tablet-front': (c, id) => `
<rect x="150" y="110" width="500" height="600" rx="42" fill="${c}"/>
<rect x="164" y="124" width="472" height="572" rx="30" fill="#050506"/>
<rect x="176" y="136" width="448" height="548" rx="22" fill="url(#screen-${id})"/>
<rect x="176" y="136" width="448" height="548" rx="22" fill="url(#wash-${id})"/>
<rect x="150" y="110" width="500" height="600" rx="42" fill="url(#gloss-${id})" opacity=".3"/>`,
  'tablet-back': (c, id) => `
<rect x="150" y="110" width="500" height="600" rx="42" fill="${c}"/>
<rect x="150" y="110" width="500" height="600" rx="42" fill="url(#gloss-${id})"/>
<rect x="184" y="146" width="70" height="70" rx="22" fill="${shade(c, -0.07)}"/>${lens(219, 181, 20, c)}`,
  'laptop-open': (c, id) => `
<path d="M190 150 h420 a24 24 0 0 1 24 24 v330 h-468 v-330 a24 24 0 0 1 24 -24z" fill="${shade(c, -0.1)}"/>
<rect x="182" y="166" width="436" height="326" rx="12" fill="#050506"/>
<rect x="194" y="178" width="412" height="302" rx="6" fill="url(#screen-${id})"/>
<rect x="194" y="178" width="412" height="302" rx="6" fill="url(#wash-${id})"/>
<path d="M100 520 h600 l-40 70 a20 20 0 0 1 -18 10 h-484 a20 20 0 0 1 -18 -10z" fill="${c}"/>
<path d="M100 520 h600 l-40 70 a20 20 0 0 1 -18 10 h-484 a20 20 0 0 1 -18 -10z" fill="url(#gloss-${id})"/>
<rect x="160" y="506" width="480" height="16" rx="6" fill="${shade(c, -0.18)}"/>
<rect x="330" y="560" width="140" height="22" rx="8" fill="${shade(c, -0.08)}"/>`,
  'laptop-closed': (c, id) => `
<path d="M150 360 h500 l30 170 h-560z" fill="${c}"/>
<path d="M150 360 h500 l30 170 h-560z" fill="url(#gloss-${id})"/>
<rect x="120" y="528" width="560" height="22" rx="10" fill="${shade(c, -0.16)}"/>`,
  'watch-front': (c, id) => `
<rect x="330" y="40" width="140" height="230" rx="30" fill="${shade(c, -0.05)}"/>
<rect x="330" y="530" width="140" height="230" rx="30" fill="${shade(c, -0.05)}"/>
<rect x="270" y="230" width="260" height="320" rx="80" fill="${c}"/>
<rect x="286" y="246" width="228" height="288" rx="66" fill="#050506"/>
<circle cx="400" cy="390" r="92" fill="none" stroke="#f65311" stroke-width="16" stroke-linecap="round" stroke-dasharray="420 200"/>
<circle cx="400" cy="390" r="62" fill="none" stroke="#6fd18f" stroke-width="12" stroke-linecap="round" stroke-dasharray="260 200"/>
<rect x="528" y="330" width="14" height="70" rx="7" fill="${shade(c, -0.15)}"/>
<rect x="270" y="230" width="260" height="320" rx="80" fill="url(#gloss-${id})" opacity=".35"/>`,
  'watch-side': (c, id) => `
<path d="M300 90 q100 -40 200 0 l-10 250 h-180z" fill="${shade(c, -0.05)}"/>
<path d="M310 460 h180 l10 250 q-100 40 -200 0z" fill="${shade(c, -0.05)}"/>
<rect x="250" y="300" width="300" height="200" rx="70" fill="${c}"/>
<rect x="250" y="300" width="300" height="200" rx="70" fill="url(#gloss-${id})"/>
<rect x="540" y="360" width="26" height="80" rx="10" fill="${shade(c, -0.2)}"/>`,
  earbuds: (c, id) => `
<rect x="250" y="380" width="300" height="270" rx="110" fill="${c}"/>
<rect x="250" y="380" width="300" height="270" rx="110" fill="url(#gloss-${id})"/>
<line x1="256" y1="480" x2="544" y2="480" stroke="${shade(c, -0.12)}" stroke-width="4"/>
<circle cx="400" cy="590" r="10" fill="${shade(c, -0.25)}"/>
<g transform="translate(250 190) rotate(-24)"><rect x="-16" y="50" width="32" height="130" rx="16" fill="${c}"/><ellipse cx="0" cy="40" rx="50" ry="56" fill="${c}"/><ellipse cx="0" cy="40" rx="50" ry="56" fill="url(#gloss-${id})"/><ellipse cx="10" cy="30" rx="14" ry="17" fill="#16171b"/></g>
<g transform="translate(550 190) rotate(24)"><rect x="-16" y="50" width="32" height="130" rx="16" fill="${c}"/><ellipse cx="0" cy="40" rx="50" ry="56" fill="${c}"/><ellipse cx="0" cy="40" rx="50" ry="56" fill="url(#gloss-${id})"/><ellipse cx="-10" cy="30" rx="14" ry="17" fill="#16171b"/></g>`,
  'earbuds-case': (c, id) => `
<rect x="220" y="250" width="360" height="420" rx="140" fill="${c}"/>
<rect x="220" y="250" width="360" height="420" rx="140" fill="url(#gloss-${id})"/>
<line x1="226" y1="400" x2="574" y2="400" stroke="${shade(c, -0.12)}" stroke-width="4"/>
<circle cx="400" cy="600" r="12" fill="${shade(c, -0.25)}"/>`,
  console: (c, id) => `
<path d="M300 90 q60 -30 90 0 v610 q-60 20 -90 0z" fill="${c}"/>
<path d="M410 90 q30 -30 90 0 v610 q-30 20 -90 0z" fill="${c}"/>
<rect x="386" y="80" width="28" height="630" rx="10" fill="#101114"/>
<path d="M300 90 q60 -30 90 0 v610 q-60 20 -90 0z" fill="url(#gloss-${id})"/>
<path d="M410 90 q30 -30 90 0 v610 q-30 20 -90 0z" fill="url(#gloss-${id})"/>
<rect x="392" y="560" width="16" height="60" rx="6" fill="#f65311" opacity=".8"/>`,
  controller: (c, id) => `
<path d="M190 330 q30 -90 130 -90 h160 q100 0 130 90 l50 200 q20 90 -60 110 q-60 10 -100 -70 l-30 -50 h-200 l-30 50 q-40 80 -100 70 q-80 -20 -60 -110z" fill="${c}"/>
<path d="M190 330 q30 -90 130 -90 h160 q100 0 130 90 l50 200 q20 90 -60 110 q-60 10 -100 -70 l-30 -50 h-200 l-30 50 q-40 80 -100 70 q-80 -20 -60 -110z" fill="url(#gloss-${id})"/>
<rect x="330" y="290" width="140" height="80" rx="18" fill="${shade(c, -0.25)}"/>
<circle cx="320" cy="450" r="40" fill="#16171b"/><circle cx="480" cy="450" r="40" fill="#16171b"/>
<path d="M230 360 h60 M260 330 v60" stroke="#16171b" stroke-width="18" stroke-linecap="round"/>
<circle cx="560" cy="340" r="12" fill="#16171b"/><circle cx="590" cy="370" r="12" fill="#16171b"/><circle cx="530" cy="370" r="12" fill="#16171b"/><circle cx="560" cy="400" r="12" fill="#16171b"/>`,
  scooter: (c, id) => `
<circle cx="210" cy="600" r="80" fill="#16171b"/><circle cx="210" cy="600" r="36" fill="${shade(c, 0.25)}"/>
<circle cx="600" cy="600" r="80" fill="#16171b"/><circle cx="600" cy="600" r="36" fill="${shade(c, 0.25)}"/>
<path d="M210 600 L270 560 H560 L600 600" stroke="${c}" stroke-width="34" fill="none" stroke-linejoin="round"/>
<rect x="270" y="540" width="300" height="34" rx="14" fill="${c}"/>
<path d="M560 560 L500 150" stroke="${c}" stroke-width="30" stroke-linecap="round"/>
<path d="M430 150 H580" stroke="#16171b" stroke-width="26" stroke-linecap="round"/>
<rect x="270" y="540" width="300" height="34" rx="14" fill="url(#gloss-${id})"/>
<circle cx="508" cy="208" r="12" fill="#f65311"/>`,
  charger: (c, id) => `
<rect x="270" y="230" width="260" height="260" rx="46" fill="${c}"/>
<rect x="270" y="230" width="260" height="260" rx="46" fill="url(#gloss-${id})"/>
<rect x="370" y="330" width="60" height="30" rx="10" fill="${shade(c, -0.3)}"/>
<path d="M400 490 C400 620 250 600 240 700" stroke="${c}" stroke-width="22" fill="none" stroke-linecap="round"/>`,
  case: (c, id) => `
<rect x="240" y="60" width="320" height="660" rx="66" fill="${c}" opacity=".92"/>
<rect x="256" y="76" width="288" height="628" rx="54" fill="${shade(c, 0.1)}" opacity=".6"/>
<rect x="272" y="96" width="176" height="176" rx="42" fill="#0d0e12" opacity=".85"/>
<circle cx="400" cy="440" r="110" fill="none" stroke="${shade(c, -0.2)}" stroke-width="10"/>
<rect x="240" y="60" width="320" height="660" rx="66" fill="url(#gloss-${id})"/>`,
  cable: (c, id) => `
<path d="M250 250 c160 -80 320 20 260 130 c-60 110 -300 40 -300 150 c0 110 240 140 320 60" stroke="${c}" stroke-width="22" fill="none" stroke-linecap="round"/>
<rect x="230" y="220" width="60" height="110" rx="14" fill="${shade(c, -0.05)}" transform="rotate(-30 260 275)"/>
<rect x="520" y="560" width="60" height="110" rx="14" fill="${shade(c, -0.05)}" transform="rotate(40 550 615)"/>
<rect x="230" y="220" width="60" height="110" rx="14" fill="url(#gloss-${id})" transform="rotate(-30 260 275)"/>`,
  powerbank: (c, id) => `
<rect x="220" y="200" width="360" height="460" rx="56" fill="${c}"/>
<rect x="220" y="200" width="360" height="460" rx="56" fill="url(#gloss-${id})"/>
<rect x="370" y="220" width="60" height="16" rx="8" fill="${shade(c, -0.3)}"/>
<circle cx="370" cy="560" r="7" fill="#6fd18f"/><circle cx="395" cy="560" r="7" fill="#6fd18f"/><circle cx="420" cy="560" r="7" fill="#6fd18f"/><circle cx="445" cy="560" r="7" fill="${shade(c, -0.2)}"/>`,
};

export const DEVICE_VIEWS = {
  phone: ['phone-back', 'phone-front'],
  'phone-dual': ['phone-back-dual', 'phone-front'],
  tablet: ['tablet-back', 'tablet-front'],
  laptop: ['laptop-open', 'laptop-closed'],
  watch: ['watch-front', 'watch-side'],
  earbuds: ['earbuds', 'earbuds-case'],
  console: ['console'],
  controller: ['controller'],
  scooter: ['scooter'],
  charger: ['charger'],
  case: ['case'],
  cable: ['cable'],
  powerbank: ['powerbank'],
};

export function renderDeviceSvg(view, hex) {
  const template = templates[view];
  if (!template) throw new Error(`Unknown device view ${view}`);
  const id = `${view}-${hex.slice(1)}`;
  return frame(template(hex, id), id);
}

// C635h — OUR OWN MARKETPLACE BADGE. shields.io retired its visual-studio-marketplace badges: on 2026-10-04 the live
// iamfim.com first eyeshot drew "VS Code Marketplace | retired badge" (Playwright render, 1280 px and 420 px). So the count is
// read from the Marketplace gallery itself and drawn here. A count we cannot read draws "install free", never a zero and never
// "retired". And the badge carries NO count: the gallery's downloadCount (216 on 2026-10-04) counts every update download, while
// its install statistic and the Marketplace page read 2 — a count on the first eyeshot would be either false or meaningless.
// installsFrom() reads the install statistic for the funnel; the badge says what the reader gets. Pure: the route fetches, this draws. Guard: tests/vna/c635h-our-own-marketplace-badge.test.mjs
import { MARKETPLACE_ID } from './marketplace.mjs';

export const GALLERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
export const galleryRequest = () => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' },
  body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: MARKETPLACE_ID }] }], flags: 256 | 1 }),
});
/** the install count off a gallery answer, or null when the answer does not carry one */
export function installsFrom(json) {
  const ext = json?.results?.[0]?.extensions?.[0];
  const n = ext?.statistics?.find((s) => s.statisticName === 'install')?.value;
  return Number.isFinite(n) ? Math.round(n) : null;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** a two-part flat badge, no count; width estimated at 6.5 px per character of 11 px Verdana-ish text */
export function badgeSvg() {
  const left = 'VS Code Marketplace';
  const right = 'install free · MIT';
  const lw = Math.round(left.length * 6.5) + 12, rw = Math.round(right.length * 6.5) + 12, w = lw + rw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(left)}: ${esc(right)}">` +
    `<title>${esc(left)}: ${esc(right)}</title><rect width="${lw}" height="20" rx="3" fill="#2b2b2b"/>` +
    `<rect x="${lw - 3}" width="${rw + 3}" height="20" rx="3" fill="#007acc"/><rect x="${lw - 3}" width="3" height="20" fill="#007acc"/>` +
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">` +
    `<text x="${lw / 2}" y="14">${esc(left)}</text><text x="${lw + rw / 2}" y="14">${esc(right)}</text></g></svg>`;
}

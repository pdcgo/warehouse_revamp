import type { RestockRequest, RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { brokenQuantity, courierCharge } from "./summary";

// ⚠ SAMPLES — what the door's photos and the broken units' rack WILL look like on the detail pages, before anything keeps
// them. The accept page lets a photo be picked and a rack chosen and keeps neither; so the two detail pages show where each
// will sit, with these, and say they are samples (`sample` in each page's pending list). The day the restock carries
// them, this file goes and the pages read the restock's own.
//
// Drawings, not photographs: inline, so they need no file and no network, and nobody mistakes them for a real box.

const svg = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">${body}</svg>`)}`;

// A torn carton (the-detail-pages-show-the-broken-photo).
const BROKEN = svg(`
  <rect width="320" height="240" fill="#e7e5e4"/>
  <ellipse cx="160" cy="206" rx="112" ry="14" fill="#d6d3d1"/>
  <path d="M70 92 L160 62 L250 92 L250 196 L160 222 L70 196 Z" fill="#c08a5b"/>
  <path d="M70 92 L160 122 L250 92 L160 62 Z" fill="#d4a373"/>
  <path d="M160 122 L160 222" stroke="#9c6b42" stroke-width="3"/>
  <path d="M96 128 L112 146 L104 160 L122 176 L114 192" fill="none" stroke="#5b3a1e" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M196 136 L214 150 L206 164" fill="none" stroke="#5b3a1e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="206" cy="182" r="5" fill="#f5f5f4"/>
  <circle cx="220" cy="190" r="4" fill="#f5f5f4"/>
  <circle cx="196" cy="194" r="3" fill="#f5f5f4"/>`);

// A courier's slip on a counter (the-detail-pages-show-the-slip-and-the-broken-rack).
const SLIP = svg(`
  <rect width="320" height="240" fill="#d6d3d1"/>
  <path d="M104 28 H216 V204 L204 214 L192 204 L180 214 L168 204 L156 214 L144 204 L132 214 L120 204 L108 214 L104 210 Z" fill="#fafaf9"/>
  <rect x="122" y="46" width="76" height="10" rx="2" fill="#57534e"/>
  <rect x="122" y="72" width="52" height="6" rx="2" fill="#a8a29e"/>
  <rect x="122" y="88" width="68" height="6" rx="2" fill="#a8a29e"/>
  <rect x="122" y="104" width="44" height="6" rx="2" fill="#a8a29e"/>
  <path d="M122 126 H198" stroke="#d6d3d1" stroke-width="2" stroke-dasharray="4 4"/>
  <rect x="122" y="140" width="34" height="8" rx="2" fill="#78716c"/>
  <rect x="166" y="138" width="32" height="12" rx="2" fill="#44403c"/>
  <rect x="122" y="168" width="76" height="16" rx="2" fill="#e7e5e4"/>`);

/** The photo shown for a line's broken units — the sample on any line with one, "" otherwise. */
export function brokenPhotoSample(item: RestockRequestItem): string {
  return brokenQuantity(item) > 0n ? BROKEN : "";
}

/** The photo shown for the courier's slip — the sample on a restock that carries a charge, "" otherwise. */
export function courierSlipSample(request: RestockRequest): string {
  return courierCharge(request) > 0 ? SLIP : "";
}

/**
 * The rack a line's broken units were put on — the sample is the line's first placement's code, on a line with broken
 * units; "" otherwise. A real code of this warehouse, so the cell reads as it will — and marked, so nobody believes it.
 */
export function brokenRackSample(item: RestockRequestItem, codes: Record<string, string>): string {
  if (brokenQuantity(item) <= 0n) return "";
  const first = item.placements[0];

  return first ? (codes[first.placementId.toString()] ?? "") : "";
}

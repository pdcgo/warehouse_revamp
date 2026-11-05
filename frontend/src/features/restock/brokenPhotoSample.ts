import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { brokenQuantity } from "./summary";

// ⚠ A SAMPLE — nothing stores a photo of the broken units yet (a-broken-product-carries-a-photo): the accept page lets one
// be picked and keeps nothing. So the two detail pages show where the photo WILL sit, with this one drawing on every line
// that has a broken unit, and say it is a sample (`sample` in each page's pending list). The day the received line carries
// a photo, this file goes and the pages read the line's own.
//
// A drawing, not a photograph: inline, so it needs no file and no network, and nobody mistakes it for a real box.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#e7e5e4"/>
  <ellipse cx="160" cy="206" rx="112" ry="14" fill="#d6d3d1"/>
  <path d="M70 92 L160 62 L250 92 L250 196 L160 222 L70 196 Z" fill="#c08a5b"/>
  <path d="M70 92 L160 122 L250 92 L160 62 Z" fill="#d4a373"/>
  <path d="M160 122 L160 222" stroke="#9c6b42" stroke-width="3"/>
  <path d="M96 128 L112 146 L104 160 L122 176 L114 192" fill="none" stroke="#5b3a1e" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M196 136 L214 150 L206 164" fill="none" stroke="#5b3a1e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="206" cy="182" r="5" fill="#f5f5f4"/>
  <circle cx="220" cy="190" r="4" fill="#f5f5f4"/>
  <circle cx="196" cy="194" r="3" fill="#f5f5f4"/>
</svg>`;

const SAMPLE = `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`;

/** The photo shown for a line's broken units — the sample on any line with one, "" otherwise. */
export function brokenPhotoSample(item: RestockRequestItem): string {
  return brokenQuantity(item) > 0n ? SAMPLE : "";
}

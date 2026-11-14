import { expect } from "storybook/test";

// STORY-ONLY helpers for the restock detail pages' LAYOUT (the-delivery-card-stacks-when-the-page-is-narrow) — where
// Kiriman stands against the products, and whether the products table fits its box. Imported by `*.stories.tsx` only.

function rectOf(root: HTMLElement, testId: string): DOMRect {
  const el = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`no ${testId}`);
  return el.getBoundingClientRect();
}

/**
 * Where Kiriman (`restock-detail-info`) stands against the products card:
 * - `beside` — the 20rem column to the right, its top on the products' top;
 * - `below` — the stacked layout: under the products, as wide as they are, and above the note (the nav's order);
 * - `other` — anything else, which no layout should draw.
 */
export function kirimanPlacement(root: HTMLElement): "beside" | "below" | "other" {
  const products = rectOf(root, "restock-detail-products");
  const info = rectOf(root, "restock-detail-info");
  const note = rectOf(root, "restock-detail-note-section");

  if (info.left >= products.right && Math.abs(info.top - products.top) < 1) return "beside";
  if (
    info.top >= products.bottom &&
    Math.abs(info.left - products.left) < 1 &&
    Math.abs(info.width - products.width) < 1 &&
    note.top >= info.bottom
  ) {
    return "below";
  }
  return "other";
}

/** The products table never scrolls sideways in its own box: its scroller holds it whole. */
export async function expectTheTableFits(root: HTMLElement) {
  const table = root.querySelector<HTMLElement>('[data-testid="restock-detail-items"]');
  if (!table) throw new Error("no restock-detail-items");
  const scroller = table.parentElement!;
  await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
}

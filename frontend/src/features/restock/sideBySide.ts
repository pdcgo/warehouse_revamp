import { useElementWidth } from "../../lib/useElementWidth";
import { useIsMobile } from "../../layouts/shell";

// THE INFO COLUMN STANDS BESIDE THE PRODUCTS ONLY WHERE BOTH FIT (owner: *"A"*, the-delivery-card-stacks-when-the-page-is-
// narrow). A restock detail page draws its products in the main column and Kiriman (on the selling side the money too) in
// a 20rem column beside it — but the room for the two is the PAGE AREA's, not the screen's: the app's sidebar (259px when
// open), the section nav and the gutters all come out of the viewport first. Chosen from the viewport's `xl`, the side
// column stood beside the products at 1440 with the sidebar open and left the products table 521px for its ≈660, so it
// scrolled sideways. So the page MEASURES the area that holds the two columns, and puts the side column beside the
// products only when the area holds the products card at its narrowest + the gap + 20rem; below that the page draws its
// stacked layout (the info under the products, in the nav's order). No column is dropped. A phone is always stacked.
//
// Measured, not a CSS container query: the app's emotion/stylis does not pass `@container` through (useElementWidth.ts),
// and the choice is a JS branch anyway — it decides which section the scroll-spy lights and how Kiriman lays its facts out.

/** The side column's width — the second track of the two-column grid. */
export const SIDE_COLUMN = "20rem";
const SIDE_COLUMN_REM = 20;
/** The gap between the two columns: theme.ts's `section` space (`spacing.4`, 1rem). */
const SECTION_GAP_REM = 1;

let remCache: number | undefined;
function remPx(): number {
  if (remCache === undefined) {
    remCache = typeof document === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }
  return remCache;
}

/**
 * Whether the side column goes BESIDE the products: put the returned ref on the element whose width is the room for both
 * columns (the page's main column, beside the nav). `productsFloorPx` is the products CARD at its narrowest — the table's
 * min-content width plus the card's padding and border — measured on the page's widest fixture. The ref is a callback ref
 * measured before the first paint, so a wide page never paints stacked first.
 */
export function useSideBySide<T extends HTMLElement>(productsFloorPx: number): [(el: T | null) => void, boolean] {
  const isMobile = useIsMobile();
  const [ref, width] = useElementWidth<T>();
  const beside = !isMobile && width >= productsFloorPx + (SIDE_COLUMN_REM + SECTION_GAP_REM) * remPx();
  return [ref, beside];
}

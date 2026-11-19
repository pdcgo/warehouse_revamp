import { expect, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, markerWithSearch, routedPage } from "../../../../.storybook/pageStory";
import type { StoryEntry } from "../../../../.storybook/pageStory";
import { orderDetailExtras, pickLocations, teams } from "../../../../.storybook/fixtures";
import { resetBulkPickScenario } from "../../../../.storybook/bulkPickScenario";
import { returnAcceptScenario } from "../../../../.storybook/sessionScenario";

import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { PickQueuePage } from "../../pick-queue";
import { BulkPickPage } from "../index";

// WHAT THE BULK PICK LIST'S STORIES SHARE (the-bulk-pick-list-prototype-is-accepted —
// stories-are-grouped-by-the-part-of-the-screen). The page runs its REAL reads against the stub transport —
// OrderPickLines and StockPickLocations for many takes (.storybook/bulkPickStub.ts), ShopByIds for the shops' names — and
// what they received is in `bulkPickScenario` (.storybook/bulkPickScenario.ts).
//
// THE SCENE: five orders on Gudang Pusat's Dikonfirmasi tab — the fixtures' 103 and 104, plus 101, 102 and 110 read as
// processed — with lines that meet on the same racks, so the two views say different things:
//
//   order  lines (the take's racks)
//   101    Kaos Hitam M ×2 (A-01-1 ×1, A-01-2 ×1) · Kaos Putih L ×1 (unplaced) · Topi Rajut ×1 (no recorded rack)   ← fixture
//   102    Kaos Hitam M ×1 (B-02-1)                                                                               ← fixture default
//   103    Kaos Hitam M ×1 (A-01-1) · Topi Rajut ×2 (A-01-2)
//   104    Kaos Putih L ×2 (B-02-1) · Kaos Hitam M ×1 (A-01-2)
//   110    Kemeja Flanel L ×1 (B-02-1) — Kenanga's, the other selling team
//
//   per product, in walk order: Kaos Hitam M 5 (A-01-1 ×2, A-01-2 ×2, B-02-1 ×1, 4 orders) · Topi Rajut 3 (A-01-2 ×2,
//   1 with no recorded rack) · Kaos Putih L 3 (B-02-1 ×2, unplaced ×1) · Kemeja Flanel L 1 (B-02-1). 12 units, 5 orders.
//
// The lines are written into the SHARED fixtures (`orderDetailExtras`, `pickLocations`) for the story's life and put back
// after, so the list's qty column, the single pick page and this page read the same order the same way — the stub's
// OrderPickLines answers OrderDetail's lines, and its StockPickLocations each take's `pickLocations`.

export const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

/** The scene's orders, in id order — every one Dikonfirmasi at Gudang Pusat. */
export const SCENE = [101n, 102n, 103n, 104n, 110n] as const;

export const KAOS_HITAM = 301n;
export const KAOS_PUTIH = 302n;
export const TOPI = 303n;
export const KEMEJA = 501n;

/** Racks of Gudang Pusat (fixtures `racks`). */
export const A_01_1 = 41n;
export const A_01_2 = 42n;
export const B_02_1 = 43n;

/** The scene's address: every order of it, as the bar opens the page. */
export const SCENE_PATH = `/warehouse-orders/bulk-pick?ids=${SCENE.join(",")}`;

const LINES: Record<string, NonNullable<(typeof orderDetailExtras)[string]["items"]>> = {
  "103": [
    { id: 1n, productId: KAOS_HITAM, productCode: "KPH-M", name: "Kaos Polos Hitam — M", quantity: 1, unitCost: 48_000 },
    { id: 2n, productId: TOPI, productCode: "TOP-01", name: "Topi Rajut", quantity: 2, unitCost: 6_000 },
  ],
  "104": [
    { id: 1n, productId: KAOS_PUTIH, productCode: "KPP-L", name: "Kaos Polos Putih — L", quantity: 2, unitCost: 46_000 },
    { id: 2n, productId: KAOS_HITAM, productCode: "KPH-M", name: "Kaos Polos Hitam — M", quantity: 1, unitCost: 48_000 },
  ],
  "110": [{ id: 1n, productId: KEMEJA, productCode: "KMJ-FL-L", name: "Kemeja Flanel — L", quantity: 1, unitCost: 120_000 }],
};

const RACKS: Record<string, (typeof pickLocations)[string]> = {
  "103": [
    { productId: KAOS_HITAM, rackId: A_01_1, rackCode: "A-01-1", quantity: 1n },
    { productId: TOPI, rackId: A_01_2, rackCode: "A-01-2", quantity: 2n },
  ],
  "104": [
    { productId: KAOS_PUTIH, rackId: B_02_1, rackCode: "B-02-1", quantity: 2n },
    { productId: KAOS_HITAM, rackId: A_01_2, rackCode: "A-01-2", quantity: 1n },
  ],
  "110": [{ productId: KEMEJA, rackId: B_02_1, rackCode: "B-02-1", quantity: 1n }],
};

/**
 * A `beforeEach`: Gudang Pusat is the current team, the scene's orders read Dikonfirmasi and carry the lines above.
 * Returns the restore, so the next story reads the fixtures as they were.
 */
export function bulkPickScene() {
  asTeam(WAREHOUSE.id)();
  resetBulkPickScenario();

  const keptStatus = returnAcceptScenario.statusOf;
  returnAcceptScenario.statusOf = {
    ...keptStatus,
    "101": OrderStatus.PROCESSED,
    "102": OrderStatus.PROCESSED,
    "110": OrderStatus.PROCESSED,
  };

  const keptLines = Object.fromEntries(Object.keys(LINES).map((id) => [id, orderDetailExtras[id]]));
  const keptRacks = Object.fromEntries(Object.keys(RACKS).map((id) => [id, pickLocations[id]]));
  for (const [id, items] of Object.entries(LINES)) orderDetailExtras[id] = { ...orderDetailExtras[id], items };
  for (const [id, racks] of Object.entries(RACKS)) pickLocations[id] = racks;

  return () => {
    returnAcceptScenario.statusOf = keptStatus;
    for (const [id, extra] of Object.entries(keptLines)) {
      if (extra === undefined) delete orderDetailExtras[id];
      else orderDetailExtras[id] = extra;
    }
    for (const [id, racks] of Object.entries(keptRacks)) {
      if (racks === undefined) delete pickLocations[id];
      else pickLocations[id] = racks;
    }
  };
}

/** The 390px phone and the 1440 desktop the stories are judged at (addon-vitest merges these with MINIMAL_VIEWPORTS). */
export const VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};
export const DESKTOP = { viewport: { value: "desktop1440" } };
export const PHONE = { viewport: { value: "phone390" } };

/** The page alone, opened at `entry` — Back's list, an order's pick page and the address shown as markers. */
export function bulkPickPage(entry: StoryEntry) {
  return routedPage(
    [
      {
        path: "/warehouse-orders/bulk-pick",
        element: (
          <>
            <BulkPickPage />
            <LocationProbe hidden />
          </>
        ),
      },
      markerWithSearch("/warehouse-orders", "at-list"),
      marker("/warehouse-orders/:orderId", "at-pick-order"),
    ],
    entry,
  );
}

/** The warehouse list on its Dikonfirmasi tab, with the page behind its bar's Daftar Ambil. */
export const ListThenPage = routedPage(
  [
    { path: "/warehouse-orders", element: <PickQueuePage /> },
    {
      path: "/warehouse-orders/bulk-pick",
      element: (
        <>
          <BulkPickPage />
          <LocationProbe hidden />
        </>
      ),
    },
    marker("/warehouse-orders/:orderId", "at-pick-order"),
  ],
  "/warehouse-orders?step=confirm",
);

/** The page, its list loaded. */
export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("bulk-pick-page", {}, { timeout: 5000 });
  await waitFor(() => expect(canvas.getByTestId("bulk-pick-count")).toBeInTheDocument());
  return canvas;
}

/** A rack of a line: its code (empty for the unplaced pile) and its quantity, read from its attributes. */
export function rackOf(canvasElement: HTMLElement, testId: string): { code: string; quantity: number } | null {
  const el = canvasElement.querySelector(`[data-testid="${testId}"]`);
  if (!el) return null;
  return { code: el.getAttribute("data-rack-code") ?? "", quantity: Number(el.getAttribute("data-quantity")) };
}

/** Nothing runs past the screen's edge (nothing-runs-past-a-phones-edge). */
export async function fitsTheScreen() {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { productHistoryForStory, productPlacesForStory } from "../../../.storybook/batchStub";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { type HeldRpc, callsOf, holdRpc } from "../../../.storybook/holdRpc";
import { inventoryClient, productClient, rackClient, teamClient } from "../../api/clients";
import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiah } from "../../lib/money";
import { WarehouseProductPage } from "./index";

// ONE PRODUCT AS A WAREHOUSE HOLDS IT (#198) — Gudang Pusat's (11) Beras Pandan Wangi 5kg (74, Toko Melati's), read by
// its crew: what it is, where it sits, Move and Adjust. Beras holds 5 on A-01-1 and 2 on B-02-1 now (batchStub's
// `productPlacesForStory`). The tabs past Info read what the stub does not serve (cost layers, the stock summary) —
// these stories are about the page's head and its racks, and (#142/#143) its Stock History, whose rows a story gives
// through batchStub's `productHistoryForStory`.

const Routed = routedPage(
  [{ path: "/inventories/products/:productId", element: <WarehouseProductPage /> }, marker("/inventories/products", "at-products")],
  "/inventories/products/74",
);

const meta = {
  title: "Pages/Inventory/Products/WarehouseProduct",
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_STAFF)();
    productPlacesForStory({ "74": [[41n, 5n], [43n, 2n]] });
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("warehouse-product-page", {}, { timeout: 5000 });
  return canvas;
}

/** The product, and the two things a person at the shelf can do to it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("warehouse-product-page")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(canvas.getByTestId("warehouse-product-page")).toHaveTextContent("SKU-BERAS-5K");
    await expect(canvas.getByTestId("wp-action-move")).toBeVisible();
    await expect(canvas.getByTestId("wp-action-adjust")).toBeVisible();
  },
};

// A PHONE (every-page-has-a-mobile-story).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("wp-action-adjust")).toBeVisible();
  },
};

// THE PRODUCT'S RACKS ARE READ ONCE (#133, the-speed-audits-old-findings-are-fixed-smallest-first) — the page's own
// ProductPlaces gives Move and Adjust each rack's figure; the two dialogs, mounted closed beside the page, read the same
// ProductPlaces again on every load.
export const TheRacksAreReadOnce: Story = {
  name: "Racks read once",
  beforeEach: () => {
    const spy = spyOn(inventoryClient, "productPlaces");

    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("wp-action-adjust"));
    await waitFor(() => expect(screen.getByTestId("adjust-dialog")).toBeVisible());

    // A-01-1 reads the page's figure: a recount to 3 is 5 → 3.
    const trigger = screen.getByTestId("rack-select");
    const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
    await userEvent.click(trigger);
    await waitFor(() => expect(within(root).getByTestId("rack-select-option-41")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(within(root).getByTestId("rack-select-option-41"));
    await userEvent.clear(screen.getByTestId("adjust-amount"));
    await userEvent.type(screen.getByTestId("adjust-amount"), "3", { delay: 40 });
    await waitFor(() => expect(screen.getByTestId("adjust-delta")).toHaveTextContent("5 → 3"));

    await expect((inventoryClient.productPlaces as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  },
};

// THE PRODUCT'S READS GO OUT SIDE BY SIDE (#134, the-speed-audits-old-findings-are-fixed-smallest-first) — where it sits,
// what it cost, its ledgers and the warehouse's rack codes need only the address, so they are asked with the product
// itself, not after it: five round trips were one after another. The owner's name still waits for the product (it is the
// product's team), and the page still draws once all of it is in.
let productHeld: HeldRpc | undefined;

export const ItsReadsGoOutSideBySide: Story = {
  name: "Reads side by side",
  beforeEach: () => {
    // The catalogue entry answers late — the reads that used to queue behind it go out meanwhile.
    productHeld = holdRpc(productClient, "productByIds");
    const spies = [
      spyOn(inventoryClient, "productPlaces"),
      spyOn(inventoryClient, "stockCost"),
      spyOn(inventoryClient, "stockHistory"),
      spyOn(rackClient, "rackList"),
      spyOn(teamClient, "teamByIds"),
    ];

    return () => {
      productHeld?.restore();
      for (const spy of spies) spy.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Held: the product. Asked all the same — its places, its cost, its last count and both ledgers, the rack codes.
    await waitFor(
      () => {
        expect(callsOf(inventoryClient.productPlaces).length).toBeGreaterThan(0);
        expect(callsOf(inventoryClient.stockCost).length).toBeGreaterThan(0);
        expect(callsOf(inventoryClient.stockHistory).length).toBeGreaterThanOrEqual(3);
        expect(callsOf(rackClient.rackList).length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    // The owner is the PRODUCT's team: that one waits for it. And nothing is drawn by halves.
    await expect(callsOf(teamClient.teamByIds)).toHaveLength(0);
    await expect(canvas.queryByTestId("warehouse-product-page")).toBeNull();

    productHeld?.release();
    const page = await loaded(canvasElement);

    await expect(page.getByTestId("warehouse-product-page")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await waitFor(() => expect(callsOf(teamClient.teamByIds).length).toBeGreaterThan(0));
  },
};

// STOCK HISTORY NAMES EACH MOVEMENT'S BATCH AND KIND (#142/#143 — docs/acceptances/inventory/transaction.md givens 1–4):
// every row names the batch its units came from (the Batch column read "—" on every one), a cancel, a broken and a
// found unit say so (they read Returned and Counted), and a price correction is listed — *Price corrected · from → to*,
// on no rack. Beras's batches here are 7 and 9 (deliveries #1007 and #1009 in the batch filter).
const BERAS_BATCH = 7n;
const OTHER_BATCH = 9n;
const PRICE_ROW = (1n << 47n) | 900n;

export const StockHistoryNamesEachBatchAndKind: Story = {
  name: "Stock History · batch and kind",
  beforeEach: () => {
    const row = (id: bigint, kind: MovementKind, delta: bigint, balance: bigint, rackId: bigint, minutesAgo: number, batchId = BERAS_BATCH) =>
      ({ id, kind, delta, balance, rackId, batchId, actorUserId: 61n, minutesAgo });
    productHistoryForStory(74n, [
      {
        ...row(PRICE_ROW, MovementKind.REVALUATION, 0n, 7n, 0n, 1),
        reason: "harga supplier naik",
        priceUnitBefore: 10_000,
        priceUnitAfter: 11_000,
        valueChange: 7_000,
      },
      row(908n, MovementKind.FOUND, 1n, 5n, 41n, 2),
      row(907n, MovementKind.BROKEN, -1n, 2n, 43n, 3, OTHER_BATCH),
      row(906n, MovementKind.CANCEL, 3n, 4n, 41n, 4),
      row(905n, MovementKind.PICK, -3n, 1n, 41n, 5),
      row(904n, MovementKind.MOVE, 2n, 3n, 43n, 6),
      row(903n, MovementKind.MOVE, -2n, 4n, 41n, 6),
      row(902n, MovementKind.RECEIVE, 6n, 6n, 41n, 7),
    ]);
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("wp-tab-history"));
    await waitFor(() => expect(canvas.getByTestId("wp-history-row-906")).toBeVisible(), { timeout: 5000 });

    // When · What · By · Batch · Place · Change · After.
    const cell = (id: bigint, i: number) => canvas.getByTestId(`wp-history-row-${id}`).querySelectorAll(":scope > td")[i]!;

    await expect(cell(906n, 1)).toHaveTextContent("Cancelled");
    await expect(cell(907n, 1)).toHaveTextContent("Broken");
    await expect(cell(908n, 1)).toHaveTextContent("Found");
    await expect(cell(905n, 1)).toHaveTextContent("Picked");
    await expect(cell(904n, 1)).toHaveTextContent("Moved");

    // The price correction, said as one: its price from → to and why, on no rack, its batch named.
    await expect(cell(PRICE_ROW, 1)).toHaveTextContent("Price corrected");
    await expect(cell(PRICE_ROW, 1)).toHaveTextContent(`${formatRupiah(10_000)} → ${formatRupiah(11_000)}`);
    await expect(canvas.getByTestId(`wp-history-row-${PRICE_ROW}-price`)).toHaveTextContent(`${formatRupiah(10_000)} → ${formatRupiah(11_000)}`);
    await expect(canvas.getByTestId(`wp-history-row-${PRICE_ROW}-reason`)).toHaveTextContent("harga supplier naik");
    await expect(cell(PRICE_ROW, 4)).toHaveTextContent("—");

    // Every row names its batch — the move's two legs too.
    for (const id of [PRICE_ROW, 908n, 906n, 905n, 904n, 903n, 902n]) {
      await expect(cell(id, 3)).toHaveTextContent(`#${BERAS_BATCH}`);
    }
    await expect(cell(907n, 3)).toHaveTextContent(`#${OTHER_BATCH}`);

    // The batch filter keeps that batch's movements only (given 5).
    await userEvent.selectOptions(canvas.getByTestId("wp-history-batch-filter"), BERAS_BATCH.toString());
    await waitFor(() => expect(canvas.queryByTestId("wp-history-row-907")).toBeNull());
    await expect(canvas.getByTestId("wp-history-row-906")).toBeVisible();

    // Placement History is the moves alone — never the pick (givens 6–7) — each naming its batch too.
    await userEvent.click(canvas.getByTestId("wp-tab-placement-history"));
    await waitFor(() => expect(canvas.getByTestId("wp-placement-history-row-904")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("wp-placement-history-row-903")).toBeVisible();
    await expect(canvas.queryByTestId("wp-placement-history-row-905")).toBeNull();
    await expect(canvas.getByTestId("wp-placement-history-row-904")).toHaveTextContent(`#${BERAS_BATCH}`);
  },
};

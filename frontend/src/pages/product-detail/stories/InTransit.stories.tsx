import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { transfersInTransitForStory } from "../../../../.storybook/productStub";
import { AtTepung, PRODUCT_DETAIL_META, loaded } from "./kit";

// THE IN-TRANSIT FIGURE ON THE PRODUCT PAGE (in-transit-is-its-own-figure-beside-siap-and-dikirim,
// the-in-transit-column-shows-while-any-is-in-transit — docs/technical/frontend/products_decision.md): in its figures,
// the total and each warehouse's, ALWAYS — 0 pcs included —
//
//   Info (every warehouse)   in the highlight's line beside Dikirim: "+12 pcs on the way · +3 pcs in transit · cost …"
//                            (Siap and Dikirim live there, the-stock-headline-stands-out; Info's list does not repeat it)
//   Per Gudang › Overview    a row after Dikirim — units and what the out-leg took; under a warehouse, the units on their
//                            way TO it, and the line says so
//
// Stub: productStub.ts `IN_TRANSIT_SAMPLE` — 700 has 3 on their way Gudang Pusat → Gudang Cabang (Rp 137.100), 702 has 8
// Gudang Cabang → Gudang Pusat (Rp 76.000) and nothing on any shelf; `transfersInTransitForStory()` empties it.

const meta = {
  title: "Pages/Products/ProductDetail/InTransit",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const overviewKeys = (canvas: ReturnType<typeof within>) =>
  Array.from(canvas.getByTestId("pd-overview-row").children as HTMLCollection).map((r) => r.getAttribute("data-testid"));

/** THE TOTAL AND EACH WAREHOUSE'S. Info: beside Dikirim in the highlight, +3 pcs in transit, never in the 79 ready. The
 * Overview: a row after Dikirim — every warehouse 3 pcs, Rp 137.100; under Gudang Pusat 0 (none on its way there); under
 * Gudang Cabang 3, "on its way to Gudang Cabang". Info's total does not move with the picker. */
export const TheTotalAndEachWarehouse: Story = {
  name: "Total and per warehouse",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("pd-highlight-line")).toHaveTextContent(
        /^\+12 pcs on the way · \+3 pcs in transit · cost Rp 3\.667\.000$/,
      ),
    );
    await expect(canvas.getByTestId("pd-highlight-ready")).toHaveTextContent("79 pcs ready");
    await expect(canvas.queryByTestId("pd-total-inTransit")).toBeNull();

    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("3 pcs"));
    await expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("In transit3 pcsRp 137.100 · between warehouses, at cost");
    await expect(overviewKeys(canvas)).toEqual([
      "pd-overview-row-ready",
      "pd-overview-row-ongoing",
      "pd-overview-row-inTransit",
      "pd-overview-row-cost",
      "pd-overview-row-age",
    ]);

    // Gudang Pusat: SL-03-ANG-001's 3 are on their way to Cabang, not here.
    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-01");
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-ready")).toHaveTextContent("54 pcs"));
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("0 pcs"));
    await expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("on its way to Gudang Pusat");

    // Gudang Cabang: the 3, named as on their way to it.
    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-ready")).toHaveTextContent("25 pcs"));
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("3 pcs"));
    await expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("Rp 137.100 · on its way to Gudang Cabang, at cost");
    await expect(canvas.getByTestId("pd-highlight-line")).toHaveTextContent("+3 pcs in transit");
  },
};

/** A PRODUCT ONLY IN TRANSIT: SL-03-ANG-003 has nothing on any shelf (0 ready, Out of stock) and 8 on their way to Gudang
 * Pusat — the page says both, and the 8 never turn into ready stock. */
export const OnlyInTransitNothingReady: Story = {
  name: "Only in transit, nothing ready",
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("pd-highlight-ready")).toHaveTextContent("0 pcs ready"));
    await expect(canvas.getByTestId("pd-stock-status")).toHaveAttribute("data-status", "out");
    await waitFor(() => expect(canvas.getByTestId("pd-highlight-line")).toHaveTextContent("+8 pcs in transit"));
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("8 pcs"));
    await expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("Rp 76.000");
    await expect(canvas.getByTestId("pd-overview-row-ready")).toHaveTextContent("0 pcs");
  },
};

/** NOTHING IN TRANSIT — the figures do not hide on the product page (only the LIST's column does): the highlight reads
 * +0 pcs in transit beside Dikirim, and the Overview keeps its row at 0 pcs, Rp 0. */
export const NothingInTransitStillShowsZero: Story = {
  name: "Nothing in transit → 0 pcs, still shown",
  beforeEach: () => transfersInTransitForStory(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("pd-highlight-line")).toHaveTextContent(
        /^\+12 pcs on the way · \+0 pcs in transit · cost Rp 3\.667\.000$/,
      ),
    );
    await waitFor(() => expect(canvas.getByTestId("pd-overview-row-ready")).toHaveTextContent("79 pcs"));
    await expect(canvas.getByTestId("pd-overview-row-inTransit")).toHaveTextContent("In transit0 pcsRp 0 · between warehouses, at cost");
    await expect(overviewKeys(canvas)).toHaveLength(5);
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { type HeldRpc, callsOf, holdRpc } from "../../../../.storybook/holdRpc";
import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { teamClient, userClient } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { PRODUCTS_META } from "./kit";

// PRODUCTS — a WAREHOUSE's Products: what it holds (a-warehouses-products-is-what-it-holds), a different screen on the
// same path — other teams' goods with their owner and units on hand, none of the seller's columns, a row opening the
// warehouse product page, its ⋯ not, the search on the server, and a phone's blocks. The page's stories are grouped by
// the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

function asGudangPusatAdmin() {
  asTeam(11n)();
  asRole(Role.WAREHOUSE_ADMIN)();
}

const meta = {
  title: "Pages/Products/Products/Warehouse",
  ...PRODUCTS_META,
  beforeEach: asGudangPusatAdmin,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Gudang Pusat (11) holds, by name — see pages/inventory/index.stories.tsx for the fixture's whole story.
const GUDANG_PUSAT = [
  "SKU-BERAS-5K",
  "SKU-GULA-1K",
  "SL-03-ANG-002",
  "SL-03-ANG-001-L",
  "SL-03-ANG-001",
  "SL-03-ANG-004",
  "SL-03-ANG-003",
];

async function heldLoaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("stock-row-SKU-BERAS-5K", {}, { timeout: 5000 });
  return canvas;
}

const held = (canvas: ReturnType<typeof within>) =>
  canvas.getAllByTestId(/^stock-row-/).map((el: HTMLElement) => el.dataset.testid!.replace("stock-row-", ""));

/** A warehouse's Products lists what it HOLDS — other teams' goods, each with its owner by name and its units on hand,
 * at 0 too — under the title Products and the warehouse's sentence. Never the warehouse team's own catalogue. */
export const AWarehouseListsWhatItHolds: Story = {
  name: "What it holds",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await expect(canvas.getByTestId("warehouse-products-page")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(canvas.getByText("Every product this warehouse holds or has held — any team's, at 0 too.")).toBeVisible();

    await expect(held(canvas)).toEqual(GUDANG_PUSAT);
    await expect(canvas.getByTestId("stock-owner-SKU-BERAS-5K")).toHaveTextContent("Toko Melati");
    await expect(canvas.getByTestId("stock-owner-SL-03-ANG-001")).toHaveTextContent("Toko Anggrek");
    await expect(canvas.getByTestId("stock-onhand-SKU-BERAS-5K")).toHaveTextContent("8");
    await expect(canvas.getByTestId("stock-onhand-SL-03-ANG-002")).toHaveTextContent("0");
    await expect(canvas.getByTestId("stock-archived-SL-03-ANG-001-L")).toHaveTextContent("Archived");

    // An owner is named, never numbered.
    await expect(canvas.getByTestId("inventory-table")).not.toHaveTextContent("Team #");
    // The warehouse team's own catalogue, never stocked here, is not the list.
    await expect(canvas.queryByTestId("stock-row-SKU-KOPI-250")).toBeNull();
  },
};

/** The seller's columns leave a warehouse's view — no Cross markup, no Lock, no cost range, no catalogue figures, no
 * lens or lock filters, no New Product or Archive: six columns, the warehouse's own — the Tags a warehouse holding the
 * stock sees among them (products-have-their-own-tag-list, 🔄 who sees). */
export const AWarehouseSeesNoSellerColumns: Story = {
  name: "No seller columns",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    const headers = within(canvas.getByTestId("inventory-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    await expect(headers).toEqual(["Product code", "Product", "Tags", "Owner", "On hand", "Actions"]);

    await expect(canvas.queryByTestId("products-table")).toBeNull();
    await expect(canvas.queryAllByTestId(/^cross-/)).toHaveLength(0);
    await expect(canvas.queryAllByTestId(/^lock-/)).toHaveLength(0);
    await expect(canvas.queryByTestId("products-stats")).toBeNull();
    await expect(canvas.queryByTestId("product-warehouse-filter")).toBeNull();
    await expect(canvas.queryByTestId("product-lock-filter")).toBeNull();
    await expect(canvas.queryByTestId("open-create-product")).toBeNull();
    await expect(canvas.queryByTestId("open-archived-products")).toBeNull();
  },
};

/** A row opens the warehouse product page — the stock view of THAT product, not the seller's catalogue entry. */
export const AWarehouseRowOpensTheWarehouseProductPage: Story = {
  name: "Row opens the warehouse product",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await userEvent.click(canvas.getByText("Beras Pandan Wangi 5kg"));
    await expect(await canvas.findByTestId("at-warehouse-product")).toHaveTextContent("74");
    await expect(canvas.queryByTestId("at-product-detail")).toBeNull();
  },
};

/** The row's ⋯ and the action picked from it do not open the row — Adjust opens its dialog over the list. */
export const AWarehouseRowsActionsDoNotOpenIt: Story = {
  name: "Row actions stay",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await userEvent.click(canvas.getByTestId("row-actions-SKU-BERAS-5K"));
    const adjust = await screen.findByTestId("adjust-SKU-BERAS-5K");
    await waitFor(() => expect(adjust).toBeVisible());
    await userEvent.click(adjust);

    const dialog = await screen.findByTestId("adjust-dialog");
    await expect(dialog).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(canvas.queryByTestId("at-warehouse-product")).toBeNull();
    await expect(canvas.getByTestId("warehouse-products-page")).toBeInTheDocument();
  },
};

/** The search runs on the server, by name or code, and is kept in the URL. */
export const AWarehouseSearchNarrows: Story = {
  name: "Search narrows",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await userEvent.type(canvas.getByTestId("inventory-search"), "tepung", { delay: 40 });
    await waitFor(() => expect(held(canvas)).toEqual(["SL-03-ANG-004", "SL-03-ANG-003"]));
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("q=tepung");
  },
};

/**
 * A FORMER CODE FINDS WHAT IT HOLDS (backlog #152 — a-team-code-change-recomposes-its-product-codes, its 🔄 *an old
 * sticker scanned before the reprint*, owner Q1 "A"): Minyak was TA-ANG-001 before Toko Anggrek's code became SL-03 —
 * the old code typed whole, in any case, finds it, and not its sibling SL-03-ANG-001-L; a piece of it finds nothing.
 */
export const AWarehouseSearchFindsAFormerCode: Story = {
  name: "Search, a former code",
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);
    const search = canvas.getByTestId("inventory-search");

    await userEvent.type(search, "Ta-Ang-001", { delay: 40 });
    await waitFor(() => expect(held(canvas)).toEqual(["SL-03-ANG-001"]), { timeout: 5000 });
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("q=Ta-Ang-001");

    // A piece of the old code is no former code.
    await userEvent.type(search, "{Backspace}", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("q=Ta-Ang-00"), { timeout: 5000 });
    await waitFor(() => expect(canvas.queryAllByTestId(/^stock-row-/)).toHaveLength(0), { timeout: 5000 });
  },
};

/** On a phone each product is a block — name, code and owner, the units at the end; the block opens the product, its
 * ⋯ does not. */
export const AWarehouseOnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await heldLoaded(canvasElement);

    await expect(canvas.queryByRole("table")).toBeNull();
    const beras = within(canvas.getByTestId("stock-row-SKU-BERAS-5K"));
    await expect(beras.getByTestId("stock-owner-SKU-BERAS-5K")).toHaveTextContent("Toko Melati");
    await expect(beras.getByTestId("stock-onhand-SKU-BERAS-5K")).toHaveTextContent("8");

    await userEvent.click(beras.getByTestId("row-actions-SKU-BERAS-5K"));
    await waitFor(() => expect(screen.getByTestId("adjust-SKU-BERAS-5K")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByTestId("at-warehouse-product")).toBeNull();

    await userEvent.click(beras.getByText("Beras Pandan Wangi 5kg"));
    await expect(await canvas.findByTestId("at-warehouse-product")).toHaveTextContent("74");
  },
};

// THE TEAM KNOWN LATE (#136): until the memberships answer, the page does not know it stands in a warehouse, so it draws
// nothing and asks nothing — never the catalogue's branch for a beat (its warehouse lens's TeamList, its "no team" line),
// which is what sent the warehouse's Products one TeamList too many on some loads. Once they answer, the held list, as
// always — and no TeamList at all: the warehouse's screen has no lens.
let membershipsHeld: HeldRpc | undefined;

export const TheTeamKnownLate: Story = {
  name: "Team known late",
  beforeEach: () => {
    membershipsHeld = holdRpc(userClient, "teamAccessList");
    const teamList = spyOn(teamClient, "teamList");

    return () => {
      membershipsHeld?.restore();
      teamList.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The memberships are asked and held: nothing else is asked meanwhile, and nothing of either screen is drawn.
    await waitFor(() => expect(callsOf(userClient.teamAccessList)).toHaveLength(1), { timeout: 5000 });
    await expect(callsOf(teamClient.teamList)).toHaveLength(0);
    await expect(canvas.queryByTestId("products-no-team")).toBeNull();
    await expect(canvas.queryByTestId("products-page")).toBeNull();
    await expect(canvas.queryByTestId("warehouse-products-page")).toBeNull();

    membershipsHeld?.release();
    const page = await heldLoaded(canvasElement);

    await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
    await expect(held(page)).toEqual(GUDANG_PUSAT);
    await expect(page.queryByTestId("products-page")).toBeNull();
    await expect(callsOf(teamClient.teamList)).toHaveLength(0);
  },
};

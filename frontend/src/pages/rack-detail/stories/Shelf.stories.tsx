import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, waitFor, within } from "storybook/test";

import { callsOf } from "../../../../.storybook/holdRpc";
import { asTeam } from "../../../../.storybook/pageStory";
import { asPlatformOnly, asRole } from "../../../../.storybook/sessionScenario";
import { teamClient } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { At43, RACK_DETAIL_META, loaded, stock } from "./kit";

// RACK DETAIL — the shelf, Produk: when there is nothing on it, and whose money it shows. The page's stories are grouped
// by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.
//
// A WAREHOUSE READS A RACK'S VALUE (docs/acceptances/inventory/placement.md given 11 — *each product with its units and
// value*; the 🔄 2026-11-20 line of a-warehouse-sees-ready-value-but-a-shelf-only-units, backlog #109): the server gives
// every reader the money, the warehouse's own roles as Root from outside it, and the page draws all of it — Harga/pcs and
// Nilai, the value under the tile's units, a phone block's price line.
// A-01-1 (41): Kopi 12 × Rp 18.500, Gula 5 × Rp 14.000, Beras 8 × Rp 65.000 = Rp 812.000.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Shelf",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Root (or the Administrator), a member of the root team only, reading Gudang Pusat's rack from outside it. */
const asRootFromOutside = () => {
  asTeam(11n)();
  asPlatformOnly(Role.ROOT, [])();
};

// A WAREHOUSE'S SHELF, WITH ITS VALUE — its Owner reads Produk · Tim · Di rak ini · Harga/pcs · Nilai, and the tile's
// value under the units: each product with its units and value, as the acceptance reads.
export const AWarehouseReadsTheValue: Story = {
  name: "A warehouse reads the value",
  beforeEach: () => {
    asRole(Role.WAREHOUSE_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-unit-cost-71")).toHaveTextContent("Rp 18.500"));
    await expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12");
    await expect(stock(canvas).getByTestId("rack-line-value-71")).toHaveTextContent("Rp 222.000");
    await expect(stock(canvas).getByTestId("rack-line-value-73")).toHaveTextContent("Rp 70.000");
    await expect(stock(canvas).getByTestId("rack-line-value-74")).toHaveTextContent("Rp 520.000");
    const headers = within(canvas.getByTestId("rack-detail-stock")).getAllByRole("columnheader");
    await expect(headers.map((h) => h.textContent)).toEqual(["Product", "Team", "On this rack", "Unit cost", "Value"]);
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("25 units");
    await expect(canvas.getByTestId("rack-summary-value")).toHaveTextContent("Rp 812.000");
  },
};

// …and on a phone — staff this time: each block is the product, whose it is, *Di rak ini 12*, and its price line
// *Rp 18.500 × 12 … Rp 222.000*.
export const AWarehouseReadsTheValueOnAPhone: Story = {
  name: "A warehouse reads the value, phone",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-line-price-71")).toHaveTextContent("Rp 18.500 × 12 … Rp 222.000"));
    await expect(stock(canvas).getByTestId("rack-line-price-73")).toHaveTextContent("Rp 14.000 × 5 … Rp 70.000");
    await expect(within(canvas.getByTestId("rack-detail-stock")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("rack-summary-value")).toHaveTextContent("Rp 812.000");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// ROOT READS EVERY FIGURE TOO — from outside Gudang Pusat (no role there), the tile's value and Harga/pcs · Nilai.
export const RootReadsTheValue: Story = {
  name: "Root reads the value",
  beforeEach: asRootFromOutside,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-unit-cost-71")).toHaveTextContent("Rp 18.500"));
    await expect(stock(canvas).getByTestId("rack-line-value-71")).toHaveTextContent("Rp 222.000");
    await expect(stock(canvas).getByTestId("rack-line-value-74")).toHaveTextContent("Rp 520.000");
    const headers = within(canvas.getByTestId("rack-detail-stock")).getAllByRole("columnheader");
    await expect(headers.map((h) => h.textContent)).toEqual(["Product", "Team", "On this rack", "Unit cost", "Value"]);
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("25 units");
    await expect(canvas.getByTestId("rack-summary-value")).toHaveTextContent("Rp 812.000");
  },
};

// …and on a phone: the block's last line is *Rp 18.500 × 12 … Rp 222.000*.
export const RootReadsTheValueOnAPhone: Story = {
  name: "Root reads the value, phone",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: asRootFromOutside,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(stock(canvas).getByTestId("rack-line-price-71")).toHaveTextContent("Rp 18.500 × 12 … Rp 222.000"));
    await expect(within(canvas.getByTestId("rack-detail-stock")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("rack-summary-value")).toHaveTextContent("Rp 812.000");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// AN EMPTY RACK SAYS SO, AND WHAT FILLS IT (an-empty-list-shows-a-hint) — B-02-1 holds nothing and has no history: Produk
// says it, and so does Riwayat.
export const AnEmptyRack: Story = {
  name: "An empty rack",
  render: () => <At43 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const empty = await canvas.findByTestId("rack-detail-empty", {}, { timeout: 4000 });
    await expect(empty).toHaveTextContent("moved to it from another");
    await expect(canvas.getByTestId("rack-summary-last-counted")).toHaveTextContent("Never counted");
    await waitFor(() => expect(canvas.getByTestId("rack-history-empty")).toBeVisible(), { timeout: 5000 });
  },
};

// THE OWNERS ARE ASKED WITH THE NAMES (#138, a-chains-server-read-waits-for-a-frontend-probe) — the shelf's team read
// starts inside the shelf's own read, the moment ProductByIds has answered: when TeamByIds goes out, no row is on the
// page yet (started from the shelf's hook alone, it went out only once the rows had rendered). The rows still never wait
// for it (#120): with its answer held they draw, each product named, each team on TeamItem's "Team #<id>", and the
// names land in place once it answers — TeamByIds asked once, the hook joining the read already out.
let releaseOwners = () => {};
let rowsDrawnWhenAsked: boolean[] = [];

export const OwnersAskedWithTheNames: Story = {
  name: "Owners asked with the names",
  beforeEach: () => {
    rowsDrawnWhenAsked = [];
    const gate = new Promise<void>((resolve) => {
      releaseOwners = () => resolve();
    });
    const real = teamClient.teamByIds.bind(teamClient);
    const spy = spyOn(teamClient, "teamByIds").mockImplementation(async (...args: Parameters<typeof real>) => {
      // Is a shelf row on the page at the moment the owners are asked?
      rowsDrawnWhenAsked.push(document.querySelector('[data-testid^="rack-stock-row-"]') !== null);
      await gate;

      return real(...args);
    });

    return () => {
      releaseOwners();
      spy.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The owners' answer is still held, and the rows are drawn: the lines with their products' names, each team on its
    // fallback.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"), { timeout: 5000 });
    await expect(stock(canvas).getByTestId("rack-stock-row-71")).toHaveTextContent("Kopi Arabika 250g");
    await expect(stock(canvas).getByTestId("rack-stock-team-74")).toHaveTextContent("Team #12");
    // …and the owners were asked before any of those rows drew — from inside the shelf's read, for its three teams.
    await expect(rowsDrawnWhenAsked).toEqual([false]);
    await expect(callsOf(teamClient.teamByIds)[0]?.[0]).toMatchObject({ filter: { ids: [11n, 12n, 13n] } });

    releaseOwners();
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-team-74")).toHaveTextContent("Toko Melati"), {
      timeout: 5000,
    });
    await expect(stock(canvas).getByTestId("rack-stock-team-73")).toHaveTextContent("Toko Kenanga");
    await expect(stock(canvas).getByTestId("rack-stock-team-71")).toHaveTextContent("Gudang Pusat");
    await expect(callsOf(teamClient.teamByIds)).toHaveLength(1);
  },
};

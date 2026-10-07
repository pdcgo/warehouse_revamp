import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { asRole } from "../../../.storybook/sessionScenario";
import { supplierFixture, supplierFixtures } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSuppliersPage } from "./index";

// Discover Suppliers (discover-searches-every-teams-suppliers): every team's suppliers, searched across teams,
// independent of the Suppliers page (a team's own list). The stub plays supplier_service's SupplierList with the
// EVERY_TEAM scope (supplierStub.ts) — twelve live suppliers kept by three teams, and one deleted.

const Routed = routedPage(
  [
    { path: "/inventories/suppliers/discover", element: <DiscoverSuppliersPage /> },
    marker("/inventories/suppliers/discover/:supplierId", "at-discover-detail"),
    marker("/inventories/suppliers/:supplierId", "at-manage-detail"),
  ],
  "/inventories/suppliers/discover",
);

const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — the viewer's own team
const BANYAK = supplierFixture("PT Banyak Toko"); // team 12's — has a Lazada store
const NUSANTARA = supplierFixture("PT Tekstil Nusantara"); // team 15's — has a Lazada store
const LINEN = supplierFixture("Linen House"); // team 15's — its TikTok store is "linenhouse"
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted
const LIVE = supplierFixtures.filter((s) => !s.deleted);

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("discover-suppliers-table")).queryAllByTestId(/^discover-supplier-row-/);

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`discover-supplier-row-${SUMBER.id}`, {}, { timeout: 4000 });
  return canvas;
}

async function search(canvas: ReturnType<typeof within>, term: string) {
  await userEvent.clear(canvas.getByTestId("discover-suppliers-search"));
  await userEvent.type(canvas.getByTestId("discover-suppliers-search"), term, { delay: 40 });
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Across EVERY team — this one's included — each row naming the team that keeps the supplier. Real rows now, so
// the page carries no sample mark; a deleted supplier has left the list.
export const EveryTeamsSuppliers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(LIVE.length));
    for (const team of ["Toko Melati", "Toko Kenanga", "Toko Anggrek"]) {
      await expect(canvas.getByTestId("discover-suppliers-table")).toHaveTextContent(team);
    }
    await expect(canvas.queryByTestId(`discover-supplier-row-${LAMA_TUTUP.id}`)).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
  },
};

// The search reads the supplier, its address and contact, and its stores' names — on the server.
export const SearchByStoreOrAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // A store's name — Linen House's TikTok store.
    await search(canvas, "linenhouse");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));
    await expect(canvas.getByTestId(`discover-supplier-row-${LINEN.id}`)).toBeVisible();

    // An address. The previous answer stays on screen while this one loads (HARD RULE 10) and it, too, is one
    // row — so wait for the row this search is about, not for the count.
    await search(canvas, "pulogadung");
    await canvas.findByTestId(`discover-supplier-row-${NUSANTARA.id}`);
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));

    await search(canvas, "zzz");
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// ⚠ supplier_service holds a team id, not a team's name, so the search does not reach the team: "Anggrek" finds
// nothing, though Toko Anggrek's suppliers are on the list. The team is PICKED instead — below.
export const SearchDoesNotReachTheTeamName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await search(canvas, "anggrek");
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// "Whose suppliers?" — the Team filter keeps the suppliers one team keeps (discover-filters-by-the-team-that-keeps-it),
// sent to the server as the team's id.
export const FilterByTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const anggrek = teams.find((t) => t.id === 15n)!;

    await pickTeam(canvas.getByTestId("discover-suppliers-team-filter"), anggrek.teamCode);

    const kept = supplierFixtures.filter((s) => !s.deleted && s.teamId === anggrek.id);
    await waitFor(() => expect(rows(canvas)).toHaveLength(kept.length));
    for (const s of kept) {
      await expect(canvas.getByTestId(`discover-supplier-row-${s.id}`)).toBeVisible();
    }
  },
};

// "Who sells on Lazada?" — a supplier with at least one LIVE store of that type. PT Sumber Makmur's Lazada store
// was deleted, so it does not count (a-store-delete-is-soft-too).
export const FilterByChannelType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(
      within(canvas.getByTestId("discover-suppliers-type-filter")).getByTestId("marketplace-select"),
    );
    const lazada = await canvas.findByRole("option", { name: "Lazada" });
    await waitFor(() => expect(lazada).toBeVisible());
    await userEvent.click(lazada);

    await waitFor(() => expect(rows(canvas)).toHaveLength(2));
    await expect(canvas.getByTestId(`discover-supplier-row-${BANYAK.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`discover-supplier-row-${NUSANTARA.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`discover-supplier-row-${SUMBER.id}`)).toBeNull();
  },
};

// Twelve suppliers at ten a page: two pages.
export const Paginates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("page-size"));
    const ten = await canvas.findByRole("option", { name: "10" });
    await waitFor(() => expect(ten).toBeVisible());
    await userEvent.click(ten);
    await waitFor(() => expect(rows(canvas)).toHaveLength(10));

    await userEvent.click(canvas.getByTestId("page-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(LIVE.length - 10));
  },
};

// A row opens the DISCOVER detail — never the manage detail, which carries the owning team's actions.
export const ARowOpensTheDiscoverDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`discover-supplier-row-${NUSANTARA.id}`));
    await canvas.findByTestId("at-discover-detail");
    await expect(canvas.queryByTestId("at-manage-detail")).toBeNull();
  },
};

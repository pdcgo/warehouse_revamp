import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { supplierFixture } from "../../../.storybook/supplierFixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSupplierDetailPage } from "./index";

// Another team's supplier, read in full (another-team-sees-everything-of-a-supplier), from Discover Suppliers.
// Read-only, with the same Channels and Products tabs as the manage detail
// (supplier-detail-has-channels-and-products-tabs). The supplier and its stores are real reads of the stub's
// supplier_service (supplierStub.ts); the Products tab is still sample rows.

function routedAt(supplierId: bigint) {
  return routedPage(
    [
      { path: "/inventories/suppliers/discover/:supplierId", element: <DiscoverSupplierDetailPage /> },
      marker("/inventories/suppliers/discover", "at-discover"),
    ],
    `/inventories/suppliers/discover/${supplierId}`,
  );
}

const NUSANTARA = supplierFixture("PT Tekstil Nusantara"); // Toko Anggrek's — three stores on three marketplaces
const SINAR = supplierFixture("Toko Grosir Sinar"); // no stores at all
const LAMA_TUTUP = supplierFixture("CV Lama Tutup"); // deleted

const AtNusantara = routedAt(NUSANTARA.id);
const AtSinar = routedAt(SINAR.id);
const AtDeleted = routedAt(LAMA_TUTUP.id);
const AtUnknown = routedAt(999n);

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail",
  component: AtNusantara,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_CS)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("discover-detail-page", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const ProductsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-products"));
    await canvas.findByTestId("products-table");
  },
};

// the-figures-are-a-statistics-tab-and-a-supplier-report — the figures supplier_service folds (SupplierStatistics).
export const StatisticsTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await canvas.findByTestId("statistics-summary");
  },
};

export const NoStores: Story = { render: () => <AtSinar /> };

// every-selling-team-sees-every-teams-figures: another team's supplier shows EVERY team's restocks from it — Toko
// Anggrek keeps PT Tekstil Nusantara, and Toko Melati's Beras bought there is on the by-product table, named.
export const StatisticsCountEveryTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));

    // The team picker starts EMPTY — the filter left empty is every team (the-team-filter-picks-any-selling-team).
    const picker = within(await canvas.findByTestId("statistics-team")).getByRole("combobox");
    await expect(picker).toHaveValue("");
    await expect(picker).toHaveAttribute("placeholder", "Every team");
    const named = await canvas.findAllByTestId("statistics-product-team");
    await expect(named.map((cell) => cell.textContent)).toContain("Toko Melati");
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Whose supplier it is, on top — the thing worth knowing on a cross-team page.
export const NamesTheOwningTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-name")).toHaveTextContent(NUSANTARA.name);
    await waitFor(() => expect(canvas.getByTestId("discover-detail-team")).toHaveTextContent("Toko Anggrek"));
    await expect(canvas.getByTestId("discover-detail-address")).toHaveTextContent(NUSANTARA.address);
  },
};

// Read-only: another team's supplier offers no Add Channel and no row actions.
export const ReadOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await canvas.findByTestId("channels-table");
    await expect(canvas.queryByTestId("add-channel")).toBeNull();
    await expect(canvas.queryAllByTestId(/^edit-channel-|^delete-channel-/)).toHaveLength(0);
  },
};

// Only the Products tab is marked — the supplier itself is a real read now.
export const OnlyTheProductsAreSample: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(
      within(canvas.getByTestId("supplier-tab-products")).getByTestId("not-implemented-products"),
    ).toBeVisible();
    await expect(canvas.queryByTestId("not-implemented-supplier")).toBeNull();
  },
};

// The same Channels browser as the manage detail — searched and filtered by type, on the server.
export const ChannelsSearchAndFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await canvas.findByTestId("channels-table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 3));

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    const blibli = await canvas.findByRole("option", { name: "Blibli" });
    await waitFor(() => expect(blibli).toBeVisible());
    await userEvent.click(blibli);
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 1));
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Nusantara Official");
  },
};

export const UnknownSupplierIsNotFound: Story = {
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
  },
};

// a-deleted-supplier-is-kept-for-its-figures: kept for past restocks and the figures, but never opened as a record.
export const ADeletedSupplierIsNotFound: Story = {
  render: () => <AtDeleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
  },
};

export const BackGoesToDiscover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-back"));
    await canvas.findByTestId("at-discover");
  },
};

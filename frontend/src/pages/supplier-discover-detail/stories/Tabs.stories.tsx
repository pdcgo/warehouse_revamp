import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, marker, routedPage } from "../../../../.storybook/pageStory";
import { supplierExportScenario } from "../../../../.storybook/supplierExportScenario";
import { DiscoverSupplierDetailPage } from "../index";
import { NUSANTARA, SUPPLIER_DISCOVER_DETAIL_META, loaded } from "./kit";

// DISCOVER SUPPLIER DETAIL — the tabs — Products, Statistics counting every team
// (every-selling-team-sees-every-teams-figures), what is marked, and each tab's Export. The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSupplierDetail/Tabs",
  ...SUPPLIER_DISCOVER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProductsTab: Story = {
  name: "Products tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-products"));
    await canvas.findByTestId("products-table");
  },
};

// the-figures-are-a-statistics-tab-and-a-supplier-report — the figures supplier_service folds (SupplierStatistics).
export const StatisticsTab: Story = {
  name: "Statistics tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await canvas.findByTestId("statistics-summary");
  },
};

// every-selling-team-sees-every-teams-figures: another team's supplier shows EVERY team's restocks from it — Toko
// Anggrek keeps PT Tekstil Nusantara, and Toko Melati's Beras bought there is on the by-product table, named.
export const StatisticsCountEveryTeam: Story = {
  name: "Statistics, every team",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));

    // The team picker starts EMPTY — the filter left empty is every team (the-team-filter-picks-any-selling-team).
    const picker = within(await canvas.findByTestId("statistics-team")).getByRole("combobox");
    await expect(picker).toHaveValue("");
    await expect(picker).toHaveAttribute("placeholder", "Every team");
    await userEvent.click(canvas.getByTestId("statistics-view-product"));
    const named = await canvas.findAllByTestId("statistics-product-team");
    await expect(named.map((cell) => cell.textContent)).toContain("Toko Melati");
  },
};

// NOTHING IS LEFT UNBUILT here either: the chip narrows every tab, Statistik included
// (the-supplier-reports-carry-the-warehouse, the story below) — no summary strip, no ⚠ by the chips; the Products tab
// is real rows, unmarked, as is the supplier.
export const NothingIsMarkedAnyMore: Story = {
  name: "Nothing unbuilt",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await canvas.findByTestId("supplier-warehouses");
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-warehouseFilter")).toBeNull();
    await expect(
      within(canvas.getByTestId("supplier-tab-products")).queryByTestId("not-implemented-products"),
    ).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-supplier")).toBeNull();
  },
};

// EACH TAB EXPORTS ITS OWN TABLE, as on the manage detail (each-supplier-tab-exports-its-own-table) — read-only, so the
// Export is the Toko strip's only action. Both export real rows, unmarked — the Produk tab's with the reader's filter
// over every team's products (another-team-sees-everything-of-a-supplier).
export const EachTabExportsItsOwnTable: Story = {
  name: "Export per tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const button = await canvas.findByTestId("channels-export");
    await expect(within(button).queryByTestId("not-implemented-export")).toBeNull();

    await userEvent.click(canvas.getByTestId("supplier-tab-products"));
    const products = await canvas.findByTestId("products-export");
    await expect(within(products).queryByTestId("not-implemented-export")).toBeNull();
  },
};

// THE CHIP NARROWS THE TABS HERE TOO (a-supplier-page-is-scoped-by-its-warehouses), in the URL: Toko Anggrek's supplier,
// read from Discover — under Gudang Cabang its Toko tab keeps the one store whose goods were received there (not
// "Nusantara Official"), its Produk tab that store's row; Semua puts both back.
const AtNusantaraProbed = routedPage(
  [
    {
      path: "/inventories/suppliers/discover/:supplierId",
      element: (
        <>
          <DiscoverSupplierDetailPage />
          <LocationProbe hidden />
        </>
      ),
    },
    marker("/inventories/suppliers/discover", "at-discover"),
  ],
  `/inventories/suppliers/discover/${NUSANTARA.id}`,
);

export const TheChipNarrowsTheTabs: Story = {
  name: "A chip narrows Toko and Produk",
  render: () => <AtNusantaraProbed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    await canvas.findByTestId("channel-row-372", {}, { timeout: 4000 });

    const chips = canvas.getByTestId("supplier-warehouses-chips");
    await waitFor(() => expect(within(chips).getByRole("button", { name: "Gudang Cabang" })).toBeVisible());
    await userEvent.click(within(chips).getByRole("button", { name: "Gudang Cabang" }));
    await waitFor(() => expect(location).toHaveTextContent("warehouse=14"));

    await waitFor(() => expect(canvas.queryByTestId("channel-row-372")).toBeNull());
    await expect(canvas.getByTestId("channel-row-371")).toBeVisible();

    await userEvent.click(canvas.getByTestId("supplier-tab-products"));
    await waitFor(() => expect(canvas.getByTestId("product-row-3601")).toBeVisible());
    await expect(canvas.queryByTestId("product-row-3602")).toBeNull();

    await userEvent.click(within(chips).getByRole("button", { name: "All" }));
    await waitFor(() => expect(location).not.toHaveTextContent("warehouse="));
    await waitFor(() => expect(canvas.getByTestId("product-row-3602")).toBeVisible());
  },
};

// …AND STATISTIK (the-supplier-reports-carry-the-warehouse): under Gudang Cabang the tab reads that warehouse's rows —
// all of Nusantara's figures were received there, so its headline stays Rp 1.250.000 — and its Export carries the chip.
export const TheChipNarrowsStatistik: Story = {
  name: "A chip narrows Statistik",
  render: () => <AtNusantaraProbed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    const chips = await canvas.findByTestId("supplier-warehouses-chips");
    await waitFor(() => expect(within(chips).getByRole("button", { name: "Gudang Cabang" })).toBeVisible());
    await userEvent.click(within(chips).getByRole("button", { name: "Gudang Cabang" }));
    await waitFor(() => expect(location).toHaveTextContent("warehouse=14"));

    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    await waitFor(() =>
      expect(canvas.getByTestId("statistics-summary-restocked-value")).toHaveTextContent(/1\.250\.000/),
    );

    await userEvent.click(canvas.getByTestId("statistics-export"));
    await waitFor(() => expect(supplierExportScenario.figures).toHaveLength(1));
    await expect(supplierExportScenario.figures[0]!.filters.find((f) => f.f.case === "warehouseFilter")?.f.value).toMatchObject(
      { warehouseId: 14n },
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSuppliersPage } from "./index";

// ⚠ PROTOTYPE for design_accept — Discover Suppliers (manage-and-discover-are-two-pages).
//
// Every team's suppliers, searched across teams, independent of the Suppliers page (a team's own list). The
// rows are the SAMPLE in features/suppliers/discover.ts — twelve suppliers kept by four teams — because no
// server answers a cross-team supplier search yet; the page's mark says so.

const Routed = routedPage(
  [
    { path: "/inventories/suppliers/discover", element: <DiscoverSuppliersPage /> },
    marker("/inventories/suppliers/discover/:supplierId", "at-discover-detail"),
    marker("/inventories/suppliers/:supplierId", "at-manage-detail"),
  ],
  "/inventories/suppliers/discover",
);

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
  await canvas.findByTestId("discover-supplier-row-901", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Across EVERY team, each row naming the team that keeps the supplier — and the sample says it is a sample.
export const EveryTeamsSuppliers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(12));
    for (const team of ["Toko Melati", "Toko Kenanga", "Toko Anggrek", "Toko Mawar"]) {
      await expect(canvas.getByTestId("discover-suppliers-table")).toHaveTextContent(team);
    }
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
  },
};

// The search reads the supplier, its address and contact, its TEAM, and its stores' names.
export const SearchByTeamOrStore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("discover-suppliers-search"), "kenanga", { delay: 40 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(3));

    await userEvent.clear(canvas.getByTestId("discover-suppliers-search"));
    await userEvent.type(canvas.getByTestId("discover-suppliers-search"), "linenhouse", { delay: 40 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));
    await expect(canvas.getByTestId("discover-supplier-row-912")).toBeVisible();

    await userEvent.clear(canvas.getByTestId("discover-suppliers-search"));
    await userEvent.type(canvas.getByTestId("discover-suppliers-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// "Who sells on Lazada?" — a supplier with at least one store of that type.
export const FilterByChannelType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(
      within(canvas.getByTestId("discover-suppliers-type-filter")).getByTestId("marketplace-select"),
    );
    await userEvent.click(await canvas.findByRole("option", { name: "Lazada" }));

    await waitFor(() => expect(rows(canvas)).toHaveLength(2));
    await expect(canvas.getByTestId("discover-supplier-row-905")).toBeVisible();
    await expect(canvas.getByTestId("discover-supplier-row-909")).toBeVisible();
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
    await waitFor(() => expect(rows(canvas)).toHaveLength(2));
  },
};

// A row opens the DISCOVER detail — never the manage detail, which answers the owning team only.
export const ARowOpensTheDiscoverDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-supplier-row-905"));
    await canvas.findByTestId("at-discover-detail");
    await expect(canvas.queryByTestId("at-manage-detail")).toBeNull();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverSupplierDetailPage } from "./index";

// ⚠ PROTOTYPE for design_accept — another team's supplier, read in full
// (another-team-sees-everything-of-a-supplier), from Discover Suppliers. Read-only, with the same Channels and
// Products tabs as the manage detail (supplier-detail-has-channels-and-products-tabs). SAMPLE data — see
// features/suppliers/discover.ts.

function routedAt(supplierId: number) {
  return routedPage(
    [
      { path: "/inventories/suppliers/discover/:supplierId", element: <DiscoverSupplierDetailPage /> },
      marker("/inventories/suppliers/discover", "at-discover"),
    ],
    `/inventories/suppliers/discover/${supplierId}`,
  );
}

// PT Tekstil Nusantara — Toko Anggrek's, three stores on three marketplaces.
const AtNusantara = routedAt(905);
const AtSinar = routedAt(911); // no stores at all
const AtUnknown = routedAt(999);

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

export const NoStores: Story = { render: () => <AtSinar /> };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Whose supplier it is, on top — the thing worth knowing on a cross-team page.
export const NamesTheOwningTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-name")).toHaveTextContent("PT Tekstil Nusantara");
    await expect(canvas.getByTestId("discover-detail-team")).toHaveTextContent("Toko Anggrek");
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

// The same Channels browser as the manage detail — searched and filtered by type.
export const ChannelsSearchAndFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await canvas.findByTestId("channels-table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 3));

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    await userEvent.click(await canvas.findByRole("option", { name: "Blibli" }));
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

export const BackGoesToDiscover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-back"));
    await canvas.findByTestId("at-discover");
  },
};

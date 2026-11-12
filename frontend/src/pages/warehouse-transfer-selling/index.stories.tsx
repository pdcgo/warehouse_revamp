import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { FORMER_USER_ID } from "../../../.storybook/fixtures";
import { transferLogByForStory, transferRaisedByForStory } from "../../../.storybook/warehouseTransferStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseTransferSellingPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md). This runs on the Storybook stub, which plays the same rules
// as the server.
//
// Toko Melati's (12) transfers: 601 created, 602 process, 603 shipped, 604 arrived, 605 accepted with problems,
// 606 cancelled, 607 lost, 608 shipped the other way. Toko Kenanga's 609 is NOT here — a team sees only its own.

const Routed = routedPage(
  [
    { path: "/inventories/transfer", element: <WarehouseTransferSellingPage /> },
    marker("/inventories/transfer/new", "at-transfer-new"),
    marker("/inventories/transfer/:transferId", "at-transfer-detail"),
  ],
  "/inventories/transfer",
);

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferSelling",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("transfer-row-601", {}, { timeout: 4000 });
  return canvas;
}

export const Default: Story = {};

// A FORMER USER (erase-keeps-the-row): a transfer raised by somebody since erased still names them — "Former user #69",
// never the synthetic username `erased69`.
export const RaisedByAFormerUser: Story = {
  beforeEach: () => transferRaisedByForStory(601n, FORMER_USER_ID),
  play: async ({ canvasElement }) => {
    const row = (await loaded(canvasElement)).getByTestId("transfer-row-601");

    await waitFor(() => expect(row).toHaveTextContent("Former user #69"));
    await expect(row).not.toHaveTextContent("erased69");
  },
};

// The team's own transfers, newest first, and only its own — another team's leaving the same warehouse is not here.
export const OnlyTheTeamsOwn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-row-609")).toBeNull();
    // The route by NAME, once the lookup lands.
    await waitFor(() =>
      expect(canvas.getByTestId("transfer-route-601")).toHaveTextContent(/Gudang Pusat.*Gudang Cabang/),
    );
  },
};

// Broken and missing units are the team's loss, so the row says so without opening it.
export const ProblemsAreOnTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("transfer-problems-605")).toHaveTextContent(/2/);
    await expect(canvas.queryByTestId("transfer-problems-601")).toBeNull();
  },
};

// The status tab is a server-side filter.
export const ShippedTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-tab-shipped"));
    await waitFor(() => expect(canvas.queryByTestId("transfer-row-601")).toBeNull());
    await expect(canvas.getByTestId("transfer-row-603")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
  },
};

// A row's ⋯ offers what its status allows: a shipped transfer can be given up, never cancelled.
export const ShippedRowOffersMarkLost: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-actions-603"));
    const items = await screen.findAllByRole("menuitem", {}, { timeout: 2000 });
    await waitFor(() => expect(items[0]).toBeVisible());
    const ids = screen.getAllByRole("menuitem").map((item) => item.dataset.testid ?? "");

    await expect(ids).toContain("transfer-action-mark-lost-603");
    await expect(ids).not.toContain("transfer-action-cancel-603");
  },
};

export const OpensTheDetailAndTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-row-601"));
    await canvas.findByTestId("at-transfer-detail");
  },
};

export const OpensTheCreateForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-transfer"));
    await canvas.findByTestId("at-transfer-new");
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the tab and the search are its; a
// change is written back.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/transfer", element: <><WarehouseTransferSellingPage /><LocationProbe /></> }],
  "/inventories/transfer?status=shipped&q=JNE",
);

export const FiltersLiveInTheUrl: Story = {
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("transfer-row-603", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("transfer-search")).toHaveValue("JNE");
    await expect(canvas.getByTestId("transfer-tab-shipped")).toHaveAttribute("aria-selected", "true");
    // 608 is shipped too, by another courier — the search is what leaves it out.
    await expect(canvas.queryByTestId("transfer-row-608")).toBeNull();

    await userEvent.click(canvas.getByTestId("transfer-tab-arrived"));
    await waitFor(() => expect(location).toHaveTextContent("status=arrived"));
    await expect(location).toHaveTextContent("q=JNE");
  },
};

// OPENED BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): Fajar, a Root, opened 601 inside Toko Melati, which he
// is not in — the row names him under its number with the "by Root team" badge, read from the create's trail row. No
// other row carries one.
const openedByRoot = () => {
  transferRaisedByForStory(601n, 66n);
  transferLogByForStory(601n, 1n, 66n, true);
};

export const OpenedByRootFromOutside: Story = {
  beforeEach: openedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = await canvas.findByTestId("transfer-created-by-601");

    await waitFor(() => expect(created).toHaveTextContent("by Fajar Nugroho"));
    await expect(within(created).getByTestId("root-team-badge")).toHaveTextContent("by Root team");
    await expect(within(canvas.getByTestId("transfers-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
    await expect(within(canvas.getByTestId("transfer-row-602")).queryByTestId("root-team-badge")).toBeNull();
  },
};

// A phone draws the same table, scrolled in its box; the badge's sentence opens on a tap and does not open the transfer.
export const MobileOpenedByRootFromOutside: Story = {
  globals: { viewport: { value: "mobile2" } },
  beforeEach: openedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = await canvas.findByTestId("transfer-created-by-601");

    await waitFor(() => expect(created).toHaveTextContent("Fajar Nugroho"));
    const badge = within(created).getByTestId("root-team-badge");
    await userEvent.click(badge);
    const hint = await screen.findByTestId("root-team-badge-hint");
    await waitFor(() => expect(hint).toBeVisible());
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseTransferSellingPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md). The real server answers Unimplemented; this runs on the
// Storybook stub.
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
  title: "Pages/WarehouseTransfer/TransferSelling",
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

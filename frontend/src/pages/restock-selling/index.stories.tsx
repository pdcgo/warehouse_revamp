import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { RestockSellingPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// Toko Melati's (12) restock list: 501 ongoing, 502 arrived, 503 accepted, 504 lost, 505 cancelled, 507 accepted with a
// deleted store. Each row's ⋯ offers what its status allows; the Value is goods + shipping, never the courier's
// charge at the door.

const Routed = routedPage(
  [
    { path: "/inventories/restock", element: <RestockSellingPage /> },
    marker("/inventories/restock/new", "at-restock-new"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock/:requestId/edit", "at-restock-edit"),
  ],
  "/inventories/restock",
);

const meta = {
  title: "Pages/Restock/RestockSelling",
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
  await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
  return canvas;
}

// The items of the row's open menu — portalled, so read off `screen`.
async function menuOf(canvas: ReturnType<typeof within>, id: number): Promise<string[]> {
  await userEvent.click(canvas.getByTestId(`restock-actions-${id}`));
  const [first] = await screen.findAllByRole("menuitem", {}, { timeout: 2000 });
  await waitFor(() => expect(first).toBeVisible());

  return screen.getAllByRole("menuitem").map((item) => item.dataset.testid ?? "");
}

async function closeMenu() {
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryAllByRole("menuitem").filter((el) => el.offsetParent !== null)).toHaveLength(0));
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const OngoingRowMenu: Story = {
  play: async ({ canvasElement }) => {
    await menuOf(await loaded(canvasElement), 501);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Five statuses, five tabs, plus All (statusTabs.ts).
export const FiveStatusTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const tab of ["all", "ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      await expect(canvas.getByTestId(`restock-tab-${tab}`)).toBeVisible();
    }
  },
};

// the-warehouse-signs-and-accepts-the-team-does-the-rest — the row menu follows the status: ongoing Edit · Cancel ·
// Mark Lost; arrived Edit Lines only; accepted, lost and cancelled have no menu at all.
export const TheRowMenuFollowsTheStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await menuOf(canvas, 501)).toEqual([
      "restock-action-edit-501",
      "restock-action-cancel-501",
      "restock-action-mark-lost-501",
    ]);
    await closeMenu();

    await expect(await menuOf(canvas, 502)).toEqual(["restock-action-edit-lines-502"]);
    await closeMenu();

    for (const id of [503, 504, 505, 507]) {
      await expect(canvas.queryByTestId(`restock-actions-${id}`)).toBeNull();
    }
  },
};

// Edit Lines opens the same edit form — the form applies the arrived rules.
export const EditLinesOpensTheEditForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 502);
    await userEvent.click(screen.getByTestId("restock-action-edit-lines-502"));
    await expect(await canvas.findByTestId("at-restock-edit")).toBeInTheDocument();
  },
};

// a-restock-names-its-paying-account — cancelling from the row asks the money question too, and the row moves to
// cancelled.
export const CancelFromTheRowAsksAboutTheMoney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-cancel-501"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByTestId("restock-cancel-money-no"));
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.CANCELLED}`)).toBeVisible());
    await expect(canvas.queryByTestId("restock-actions-501")).toBeNull();
    // The dialog did not navigate the row behind it.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// lost-is-set-only-before-the-box-arrives — Mark Lost from the row.
export const MarkLostFromTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-mark-lost-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.LOST}`)).toBeVisible());
  },
};

// the-couriers-charge-stays-out-of-total — 503's Value is goods 950.000 + shipping 30.000, not the 5.000 the courier
// asked at the door.
export const TheValueIsGoodsPlusShipping: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-value-503")).toHaveTextContent("Rp 980.000");
    await expect(canvas.getByTestId("restock-value-501")).toHaveTextContent("Rp 2.080.000");
  },
};

// a-short-unit-at-the-door-is-missing — an accepted row with units short says MISSING.
export const MissingUnitsAreFlagged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-missing-503")).toHaveTextContent("1 missing");
    await expect(canvas.queryByTestId("restock-missing-501")).toBeNull();
  },
};

// The supplier is read off the lines, and a deleted store still shows, badged (a-deleted-supplier-still-shows-with-a-
// badge). The invoice and the tracking number are labelled.
export const SupplierInvoiceAndCourier: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-supplier-503")).toHaveTextContent("PT Sumber Makmur"));
    await waitFor(() => expect(within(canvas.getByTestId("restock-supplier-507")).getByTestId("deleted-badge")).toBeVisible());
    // 501's lines name two suppliers — the first, and "+1 more".
    await expect(canvas.getByTestId("restock-supplier-501")).toHaveTextContent("+1 more supplier");
    await expect(canvas.getByTestId("restock-invoice-503")).toHaveTextContent("Invoice INV/2026/09/0412");
    await expect(canvas.getByTestId("restock-receipt-503")).toHaveTextContent("SCP5544332211");
  },
};

// The Arrived tab is a real filter — the box at the door, waiting for the warehouse to count it.
export const TheArrivedTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-tab-arrived"));
    await waitFor(() => expect(canvas.queryByTestId("restock-row-501")).toBeNull());
    await expect(canvas.getByTestId("restock-row-502")).toBeVisible();
  },
};

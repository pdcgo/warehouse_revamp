import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { toaster } from "../../../components/feedback/Toaster";
import { storedRestockForStory } from "../../../features/restock/storyRestock";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { WAREHOUSE_META, loaded } from "./kit";

// RESTOCK WAREHOUSE — the row's acts at the door — Sign for Box and Accept, by status, and what they run.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Actions",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function actionsOf(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")].map((el) => el.dataset.testid ?? "");
}

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing rows offer Sign for Box and Accept; the arrived one
// Accept only. Never Edit, Cancel or Mark Lost — those are the selling team's.
export const TheRowActionsFollowTheStatus: Story = {
  name: "Acts by status",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(actionsOf(canvas.getByTestId("restock-row-501"))).toEqual([
      "restock-action-sign-501",
      "restock-action-accept-501",
    ]);
    await expect(actionsOf(canvas.getByTestId("restock-row-502"))).toEqual(["restock-action-accept-502", "restock-action-labels-502"]);
    await expect(actionsOf(canvas.getByTestId("restock-row-506"))).toEqual([
      "restock-action-sign-506",
      "restock-action-accept-506",
    ]);
  },
};

// MONITORING KEEPS WHAT ONLY READS (monitoring-keeps-what-only-reads) — the admin team reading this warehouse: Sign for
// Box and Accept are gone (the-admin-team-monitors-read-only), Print stays — the labels read and change nothing.
export const MonitoringKeepsPrint: Story = {
  name: "Monitoring, Print only",
  beforeEach: () => asAdminTeam()(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(actionsOf(canvas.getByTestId("restock-row-501"))).toEqual([]);
    await expect(actionsOf(canvas.getByTestId("restock-row-502"))).toEqual(["restock-action-labels-502"]);
  },
};

// Signing for the box confirms, and the row moves to arrived — leaving Accept.
export const SignForBoxFromTheRow: Story = {
  name: "Sign for box",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible());
    await waitFor(() => expect(actionsOf(row)).toEqual(["restock-action-accept-501", "restock-action-labels-501"]));
    // The dialog did not navigate the row behind it.
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// THE COURIER'S CHARGE IN THE ROW'S SIGN DIALOG IS KEPT (the-courier-charge-is-noted-at-tiba-and-final-at-terima) — it
// was this page's last mark, so the page has none now: no strip, no mark in the dialog, no toast saying to enter it again
// at Terima. Signed with a charge, the row moves to arrived and the restock holds the charge for Terima.
export const TheSignDialogKeepsItsCourierCharge: Story = {
  name: "Courier charge, kept",
  // The toaster is module-level: a story reading its own toasts clears the last story's first.
  beforeEach: () => {
    toaster.remove();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const charge = await screen.findByTestId("sign-courier");
    await waitFor(() => expect(charge).toBeVisible());
    await expect(within(charge).queryByTestId(/^not-implemented-/)).toBeNull();

    await userEvent.click(screen.getByTestId("sign-courier-asked-yes"));
    await userEvent.type(await screen.findByTestId("sign-courier-charge"), "15000", { delay: 20 });
    await userEvent.type(screen.getByTestId("sign-courier-note"), "Biaya COD", { delay: 20 });
    const confirm = screen.getByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    const row = canvas.getByTestId("restock-row-501");
    await waitFor(() => expect(within(row).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible());
    await expect(await screen.findByText("Restock marked as arrived")).toBeInTheDocument();
    await expect(screen.queryByText(/enter it again at Accept/)).toBeNull();

    const stored = await storedRestockForStory(501n);
    await expect(stored.warehouseAdditionalCost).toBe(15000);
    await expect(stored.warehouseAdditionalCostNote).toBe("Biaya COD");
  },
};

// Accept opens the accept PAGE — counting, placing and pricing is a form with sections.
export const AcceptOpensTheAcceptPage: Story = {
  name: "Accept opens its page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-accept-502"));
    await expect(await canvas.findByTestId("at-restock-accept")).toBeInTheDocument();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { resetRestockStub } from "../../../../.storybook/restockStub";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { ARRIVED, BERAS, CAHAYA, CAHAYA_STORE, EditAccepted, EditArrived, EditOngoing, FORM_META, loaded, pickProducts } from "./kit";

// RESTOCK FORM — an edit, by status and by team — on a phone, by another team, arrived (the lines stay open, a line
// may be added with a note), and accepted (not editable).
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Edit",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 502 holds BOTH of the products on team 12's restocks, so its picker has nothing new to add. For the add-a-line
 * rule, this beforeEach takes Beras off 502 for one story — so it can come back as a product found in the box — and
 * puts it back after.
 */
function arrivedWithoutBeras() {
  const saved = ARRIVED.items;
  ARRIVED.items = saved.filter((l) => l.productId !== BERAS);
  resetRestockStub();

  return () => {
    ARRIVED.items = saved;
    resetRestockStub();
  };
}

// …and an ongoing restock on a phone, its lines filled.
export const MobileEdit: Story = {
  name: "Phone · an edit",
  globals: { viewport: { value: "mobile1" } },
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("restock-line-0")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// The warehouse can READ the restock, so its detail call succeeds — but only the raising team edits it.
export const NotTheRaisingTeam: Story = {
  name: "Not the raising team",
  render: () => <EditOngoing />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-not-editable");

    await expect(canvas.getByTestId("restock-not-editable-reason")).toHaveTextContent("Only the team that raised");
    await expect(canvas.queryByTestId("submit-restock")).toBeNull();
  },
};

// the-lines-stay-editable-until-accepted: while ARRIVED the payment and the parcel are closed — and say why — while
// each line's count, total and note stay open, and no stored line can be removed or re-connected.
export const ArrivedClosesTheHeaderAndKeepsTheLines: Story = {
  name: "Arrived · lines only",
  render: () => <EditArrived />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("restock-arrived-banner")).toBeVisible();
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeInTheDocument();
    await expect(canvas.getByTestId("restock-header-locked")).toBeVisible();

    await expect(canvas.getByTestId("restock-finance-account")).toBeDisabled();
    await expect(canvas.getByTestId("restock-invoice-ref")).toBeDisabled();
    await expect(canvas.getByTestId("restock-receipt")).toBeDisabled();
    await expect(canvas.getByTestId("restock-shipping-cost")).toBeDisabled();
    await expect(canvas.getByTestId("restock-note")).toBeDisabled();
    await expect(within(canvas.getByTestId("restock-courier")).getByRole("combobox")).toBeDisabled();
    await expect(canvas.getByTestId("order-receipt-pick")).toBeDisabled();

    // The lines stay open …
    await expect(canvas.getByTestId("restock-qty-0")).toBeEnabled();
    await expect(canvas.getByTestId("restock-total-price-0")).toBeEnabled();
    await expect(canvas.getByTestId("restock-line-0-note")).toBeEnabled();
    await expect(canvas.getByTestId("restock-line-0-note")).toHaveValue("extra stock — 2 bonus dari supplier");

    // … but none can be removed, and none re-connected (lines-can-be-added-not-removed-while-arrived).
    await expect(canvas.queryByTestId("restock-remove-0")).toBeNull();
    await expect(canvas.queryByTestId("restock-remove-1")).toBeNull();
    await expect(canvas.queryByTestId("restock-line-0-picker-trigger")).toBeNull();
    await expect(canvas.queryByTestId("restock-line-0-supplier-clear")).toBeNull();

    // No supplier for all while the box is at the door — the stored lines' suppliers are closed
    // (the-supplier-leads-the-produk-card).
    await expect(canvas.queryByTestId("restock-all-supplier")).toBeNull();
  },
};

// lines-can-be-added-not-removed-while-arrived: a product found in the box can be ADDED — with a note — and that new
// line, never saved, can still be dropped; the stored one cannot. a-line-added-after-arrival-names-its-supplier: the
// added line may connect where it was bought, while the stored line's supplier stays closed.
export const ArrivedAddsALineOnlyWithANote: Story = {
  name: "Arrived · add with a note",
  render: () => <EditArrived />,
  beforeEach: arrivedWithoutBeras,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    await canvas.findByTestId("restock-line-0");

    await pickProducts(canvas, [BERAS]);

    const added = await canvas.findByTestId("restock-line-1");
    await expect(within(added).getByTestId("restock-line-1-added")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-remove-0")).toBeNull();
    await expect(canvas.getByTestId("restock-remove-1")).toBeInTheDocument();

    // The added line can say where it came from; the stored one cannot be re-connected.
    await expect(canvas.queryByTestId("restock-line-0-picker-trigger")).toBeNull();
    await userEvent.click(canvas.getByTestId("restock-line-1-picker-trigger"));
    const dialog = within(await screen.findByTestId("restock-line-1-picker-dialog"));
    await userEvent.type(dialog.getByTestId("restock-line-1-picker-search"), "Cahaya", { delay: 20 });
    await userEvent.click(await dialog.findByTestId(`restock-line-1-picker-supplier-${CAHAYA.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await dialog.findByTestId(`restock-line-1-picker-store-${CAHAYA_STORE}`, {}, { timeout: 4000 }));
    await userEvent.click(dialog.getByTestId("restock-line-1-picker-confirm"));
    await waitFor(() => expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent("Cahaya Abadi"));

    // Its total, which every product carries (the-count-and-total-are-required) …
    await userEvent.type(canvas.getByTestId("restock-total-price-1"), "65000", { delay: 20 });

    // … but no note, no save.
    await expect(canvas.getByTestId("submit-restock")).toBeDisabled();
    await waitFor(() => expect(canvas.getByTestId("restock-form-missing-newLineNote")).toBeInTheDocument());

    await userEvent.type(canvas.getByTestId("restock-line-1-note"), "ada di dalam paket", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("submit-restock"));
    // Reached by a link (no screen opened it), so the save lands on the list (a-form-returns-where-it-was-opened).
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// a-restock-is-edited-only-while-ongoing: an accepted restock opens as "cannot be edited", not as a form the server
// would refuse.
export const AnAcceptedRestockIsNotEditable: Story = {
  name: "Accepted · not editable",
  render: () => <EditAccepted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-not-editable");

    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ACCEPTED}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId("submit-restock")).toBeNull();

    // Reached by a link, so back is the list (a-form-returns-where-it-was-opened).
    await userEvent.click(canvas.getByTestId("restock-not-editable-back"));
    await canvas.findByTestId("at-restock-list");
  },
};

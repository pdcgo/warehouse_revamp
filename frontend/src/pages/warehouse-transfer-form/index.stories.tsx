import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferFormPage } from "./index";

// ⚠ PROTOTYPE for implementation_analysis — the warehouse transfer decisions
// (docs/business/inventory/warehouse_transfer_decision.md).
//
// Toko Melati (12) opens a transfer from Gudang Pusat (WH-01), which holds 25 of its Beras, to Gudang Cabang (WH-02).
// No price is typed — the system fills it from A's batches — and no courier: A enters it when it ships.

const Routed = routedPage(
  [
    { path: "/inventories/transfer/new", element: <WarehouseTransferFormPage /> },
    marker("/inventories/transfer", "at-transfer-list"),
    marker("/inventories/transfer/:transferId", "at-transfer-detail"),
  ],
  "/inventories/transfer/new",
);

const meta = {
  title: "Pages/WarehouseTransfer/TransferForm",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The new transfer's id — one past the fixtures' last.
const NEW_ID = 610n;

async function pickBeras() {
  await userEvent.click(screen.getByTestId("transfer-form-pick"));
  const option = await screen.findByTestId("product-picker-option-74", {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await userEvent.click(screen.getByTestId("product-picker-confirm"));
}

// TWO TeamSelects on one page, and each portals its own listbox — so an option's test id exists twice. The one to click
// is in the listbox THIS field's input controls, which the input names in `aria-controls`.
//
// ⚠ TeamSelect REMOUNTS once its list lands (`key={filled ? "ready" : "loading"}`), so an input read before then is
// detached and clicking it opens nothing — and the LOADING combobox has a listbox of its own, just an empty one. So the
// input is re-read until the option itself is in the listbox it names.
async function pickTeamIn(field: HTMLElement, teamCode: string) {
  let input!: HTMLElement;
  let option: HTMLElement | null = null;
  await waitFor(() => {
    input = within(field).getByRole("combobox");
    const listbox = document.getElementById(input.getAttribute("aria-controls") ?? "");
    option = listbox?.querySelector<HTMLElement>(`[data-testid="team-select-option-${teamCode}"]`) ?? null;
    expect(option).not.toBeNull();
  });

  await userEvent.click(input);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option!);
}

async function route(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await pickTeamIn(await canvas.findByTestId("transfer-form-from"), "WH-01");
  await pickTeamIn(canvas.getByTestId("transfer-form-to"), "WH-02");
  return canvas;
}

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Products come from A's shelves, so A comes first.
    await expect(await canvas.findByTestId("transfer-form-pick-from-first")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-form-submit")).toBeDisabled();
    // The shipping cost is optional and reaches no account yet — the field says so.
    await expect(canvas.getByTestId("not-implemented-costEvent")).toBeInTheDocument();
  },
};

// The happy path: route, one product, a count — and the transfer exists, created, with the system's value.
export const OpensATransfer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await route(canvasElement);
    await pickBeras();

    await expect(await canvas.findByTestId("transfer-form-line-74")).toBeInTheDocument();
    // A holds 25 of it.
    await waitFor(() => expect(canvas.getByTestId("transfer-form-available-74")).toHaveTextContent("25"));

    const count = canvas.getByTestId("transfer-form-count-74");
    await userEvent.clear(count);
    await userEvent.type(count, "8", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("transfer-form-submit")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("transfer-form-submit"));

    await canvas.findByTestId("at-transfer-detail");
    const made = transferWire(NEW_ID);
    await expect(made.status).toBe(WarehouseTransferStatus.CREATED);
    await expect(made.items[0]?.count).toBe(8n);
    await expect(made.total).toBeGreaterThan(0n);
  },
};

// More than A holds would fail the create (a-shelf-never-goes-below-zero) — the form says so before it is sent.
export const MoreThanAHoldsIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await route(canvasElement);
    await pickBeras();

    const count = await canvas.findByTestId("transfer-form-count-74");
    await userEvent.clear(count);
    await userEvent.type(count, "30", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("transfer-form-missing")).toHaveTextContent(/stock/i));
    await expect(canvas.getByTestId("transfer-form-submit")).toBeDisabled();
  },
};

// A cost needs the account that pays it (a-transfer-names-its-paying-account).
export const ACostNeedsAnAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await route(canvasElement);
    await pickBeras();

    await userEvent.type(canvas.getByTestId("transfer-form-cost"), "18000", { delay: 20 });
    await waitFor(() => expect(canvas.getByTestId("transfer-form-missing")).toHaveTextContent(/account/i));
    await expect(canvas.getByTestId("transfer-form-submit")).toBeDisabled();
  },
};

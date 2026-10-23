import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { warehouseFeeOf } from "../../../../.storybook/warehouseFeeStub";
import { WarehouseFeeCard } from "./WarehouseFeeCard";

// THE WAREHOUSE FEE CARD on Settings (warehouse-prices-balance-records) — one rate per warehouse:
//   fee = clamp(goods × percent / 100, floor, cap), an empty cap meaning no cap (an-empty-cap-means-no-cap).
//
// The stub seeds Gudang Pusat (11) with 2.5%, floor 2 000, cap 20 000 and leaves Gudang Cabang (14) without one.

const PUSAT = 11n;
const CABANG = 14n;

const meta = {
  title: "Pages/Settings/WarehouseFeeCard",
  component: WarehouseFeeCard,
  args: { teamId: PUSAT, canEdit: true },
} satisfies Meta<typeof WarehouseFeeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Set: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await waitFor(() => expect(card.getByTestId("warehouse-fee-percent")).toHaveValue("2.5"));
    await expect(card.getByTestId("warehouse-fee-floor")).toHaveValue("2.000");
    await expect(card.getByTestId("warehouse-fee-cap")).toHaveValue("20.000");
    // Nothing changed, nothing to save — and the card says the rate is not charged yet (step 1 of five).
    await expect(card.getByTestId("save-warehouse-fee")).toBeDisabled();
    await expect(card.getByTestId("warehouse-fee-not-live")).toBeVisible();
  },
};

// A warehouse with none is WARNED: it takes no orders once the check is on.
export const NotSet: Story = {
  args: { teamId: CABANG },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await expect(await card.findByTestId("warehouse-fee-not-set")).toBeVisible();
    await expect(card.getByTestId("save-warehouse-fee")).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await waitFor(() => expect(card.getByTestId("warehouse-fee-percent")).toHaveValue("2.5"));
    await expect(card.getByTestId("warehouse-fee-percent")).toBeDisabled();
    await expect(card.getByTestId("save-warehouse-fee")).toBeDisabled();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// A cap of 0 would charge nothing, so it is refused before it is sent (an-empty-cap-means-no-cap).
export const ACapOfZeroIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    const cap = card.getByTestId("warehouse-fee-cap");

    await waitFor(() => expect(cap).toHaveValue("20.000"));
    await userEvent.clear(cap);
    await userEvent.type(cap, "0", { delay: 30 });

    await expect(await card.findByText("A cap of 0 would charge nothing — leave it empty for no cap.")).toBeVisible();
    await expect(card.getByTestId("save-warehouse-fee")).toBeDisabled();
  },
};

// A floor above the cap is refused; the save stays off until it is fixed.
export const AFloorAboveTheCapIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    const floor = card.getByTestId("warehouse-fee-floor");

    await waitFor(() => expect(floor).toHaveValue("2.000"));
    await userEvent.clear(floor);
    await userEvent.type(floor, "30000", { delay: 30 });

    await expect(await card.findByText("The floor cannot be above the cap. Equal is a flat fee.")).toBeVisible();
    await expect(card.getByTestId("save-warehouse-fee")).toBeDisabled();
  },
};

// A first rate saved with the cap left EMPTY is sent with no cap — never as a cap of 0.
export const SavesARateWithNoCap: Story = {
  args: { teamId: CABANG },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await card.findByTestId("warehouse-fee-not-set");
    await userEvent.type(card.getByTestId("warehouse-fee-percent"), "2.5", { delay: 30 });
    await userEvent.type(card.getByTestId("warehouse-fee-floor"), "2000", { delay: 30 });

    const save = card.getByTestId("save-warehouse-fee");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await expect(await screen.findByText("Warehouse fee saved")).toBeInTheDocument();

    const row = warehouseFeeOf(CABANG)!;
    await expect(row.feePercent).toBe(2.5);
    await expect(row.minFee).toBe(2000);
    await expect(row.maxFee).toBeUndefined();
  },
};

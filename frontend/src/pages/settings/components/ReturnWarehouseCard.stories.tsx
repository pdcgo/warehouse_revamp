import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { teams } from "../../../../.storybook/fixtures";
import { returnWarehouseOf } from "../../../../.storybook/returnConfigurationStub";
import { ReturnWarehouseCard } from "./ReturnWarehouseCard";

// THE RETURN WAREHOUSE CARD on Settings (the-return-warehouse-lives-in-team-return-configurations) — where a
// selling team's returned parcels are received. It is the editor the create check waits on
// (create-refuses-a-team-with-no-return-warehouse), so "not set" is said, not left as an empty field.
//
// The stub seeds Toko Melati (12) with Gudang Pusat and leaves Toko Kenanga (13) without one.

const MELATI = 12n;
const KENANGA = 13n;
const CABANG = teams.find((t) => t.teamCode === "WH-02")!; // Gudang Cabang (14)

const meta = {
  title: "Pages/Settings/ReturnWarehouseCard",
  component: ReturnWarehouseCard,
  args: { teamId: MELATI, canEdit: true },
} satisfies Meta<typeof ReturnWarehouseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Set: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    // The saved warehouse fills the picker, and with nothing changed there is nothing to save.
    await expect(await card.findByTestId("team-select-selected")).toHaveTextContent("Gudang Pusat");
    await expect(card.getByTestId("save-return-warehouse")).toBeDisabled();
    await expect(card.queryByTestId("return-warehouse-not-set")).not.toBeInTheDocument();
  },
};

// A team with none is WARNED: the create check will refuse it once it is on, and an empty field alone does not
// say so. Nothing picked cannot be saved — there is no clear.
export const NotSet: Story = {
  args: { teamId: KENANGA },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await expect(await card.findByTestId("return-warehouse-not-set")).toBeVisible();
    await expect(card.getByTestId("save-return-warehouse")).toBeDisabled();
  },
};

// Somebody who may not change it sees it, and cannot.
export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await expect(await card.findByTestId("team-select-selected")).toHaveTextContent("Gudang Pusat");
    await expect(card.getByRole("combobox")).toBeDisabled();
    await expect(card.getByTestId("save-return-warehouse")).toBeDisabled();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Picking a warehouse and saving writes THAT warehouse for THIS team — and the warning goes.
export const SavesThePickedWarehouse: Story = {
  args: { teamId: KENANGA },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);

    await card.findByTestId("return-warehouse-not-set");
    await userEvent.click(card.getByRole("combobox"));

    const option = await screen.findByTestId(`team-select-option-${CABANG.teamCode}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    const save = card.getByTestId("save-return-warehouse");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(returnWarehouseOf(KENANGA)).toBe(CABANG.id));
    await waitFor(() => expect(card.queryByTestId("return-warehouse-not-set")).not.toBeInTheDocument());
  },
};

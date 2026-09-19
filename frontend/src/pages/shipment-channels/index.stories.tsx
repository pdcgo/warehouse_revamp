import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { shipmentChannels } from "../../../.storybook/fixtures";
import { ShipmentChannelsPage } from "./index";

// ⚠ PROTOTYPE for design_accept — docs/business/shipment/context_decision.md.
//
// Root curates the courier catalogue. Every play() below is one recorded decision; the stub serves the
// same rules the server will (soft delete, restore, code uniqueness over deleted rows).

const [jne, , , pos] = shipmentChannels;

const meta = {
  title: "Pages/Shipment/ShipmentChannels",
  component: ShipmentChannelsPage,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ShipmentChannelsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const WithDeletedShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId(`shipment-channel-row-${jne!.code}`);
    await userEvent.click(canvas.getByText("Show deleted channels"));
    await canvas.findByTestId(`shipment-channel-row-${pos!.code}`);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// a-deleted-channel-still-resolves-by-id: the management list hides deleted channels until asked —
// otherwise root could never find the one to restore.
export const DeletedChannelsAreHiddenUntilAsked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`shipment-channel-row-${jne!.code}`);
    await expect(canvas.queryByTestId(`shipment-channel-row-${pos!.code}`)).toBeNull();

    await userEvent.click(canvas.getByText("Show deleted channels"));

    const status = await canvas.findByTestId(`shipment-channel-status-${pos!.code}`);
    await expect(status).toHaveTextContent("Deleted");
  },
};

// a-channel-is-soft-deleted: delete confirms, then the row leaves the live list — and is still there,
// marked, when deleted channels are shown.
export const DeleteConfirmsAndSoftDeletes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`delete-${jne!.code}`));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`shipment-channel-row-${jne!.code}`)).toBeNull());

    await userEvent.click(canvas.getByText("Show deleted channels"));
    const status = await canvas.findByTestId(`shipment-channel-status-${jne!.code}`);
    await waitFor(() => expect(status).toHaveTextContent("Deleted"));
  },
};

// a-deleted-code-is-restored-not-recreated: a deleted row offers Restore — and nothing else.
export const ADeletedChannelIsRestored: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`shipment-channel-row-${jne!.code}`);
    await userEvent.click(canvas.getByText("Show deleted channels"));

    await canvas.findByTestId(`restore-${pos!.code}`);
    await expect(canvas.queryByTestId(`edit-${pos!.code}`)).toBeNull();
    await expect(canvas.queryByTestId(`delete-${pos!.code}`)).toBeNull();

    await userEvent.click(canvas.getByTestId(`restore-${pos!.code}`));

    const status = canvas.getByTestId(`shipment-channel-status-${pos!.code}`);
    await waitFor(() => expect(status).toHaveTextContent("Live"));
  },
};

// a-deleted-code-is-restored-not-recreated: creating "pos" again is refused, and the message says restore.
export const RecreatingADeletedCodeIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("open-create-shipment-channel"));

    const code = await screen.findByTestId("shipment-channel-code");
    await waitFor(() => expect(code).toBeVisible());
    await userEvent.type(code, pos!.code, { delay: 40 });
    await userEvent.type(screen.getByTestId("shipment-channel-name"), "POS", { delay: 40 });
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    const error = await screen.findByTestId("shipment-channel-form-error");
    await expect(error).toHaveTextContent("restore it instead");
  },
};

// a-code-never-changes: the edit dialog shows the code read-only; only name and desc change.
export const EditingKeepsTheCode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`edit-${jne!.code}`));

    const code = await screen.findByTestId("shipment-channel-code");
    await waitFor(() => expect(code).toBeVisible());
    await expect(code).toHaveValue(jne!.code);
    await expect(code).toHaveAttribute("readonly");

    const name = screen.getByTestId("shipment-channel-name");
    await userEvent.clear(name);
    await userEvent.type(name, "JNE Express", { delay: 40 });
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    const row = await canvas.findByTestId(`shipment-channel-row-${jne!.code}`);
    await waitFor(() => expect(row).toHaveTextContent("JNE Express"));
  },
};

export const NewChannelAppears: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("open-create-shipment-channel"));

    const code = await screen.findByTestId("shipment-channel-code");
    await waitFor(() => expect(code).toBeVisible());
    await userEvent.type(code, "anteraja", { delay: 40 });
    await userEvent.type(screen.getByTestId("shipment-channel-name"), "AnterAja", { delay: 40 });
    await userEvent.click(screen.getByTestId("shipment-channel-save"));

    await canvas.findByTestId("shipment-channel-row-anteraja");
  },
};

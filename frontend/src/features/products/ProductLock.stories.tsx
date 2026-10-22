import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { LockModeField, ProductLockControl, description } from "./ProductLock";
import type { LockMode } from "./ProductLock";

// THE LOCK — one setting, three ways (one-lock-three-ways). The control on a product row and page, and the editor the
// product form uses as a field. Each way maps onto the two fields a product already has.

const meta = {
  title: "Features/Products/ProductLock",
  component: ProductLockControl,
  parameters: { docs: { description: { component: description } } },
  args: {
    product: { crossLocked: false, reservedStock: 0 },
    editable: true,
    onSave: fn(async () => true),
    testId: "lock",
  },
  decorators: [
    (Story) => (
      <Box p="4">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ProductLockControl>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openPanel(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByTestId("lock"));
  const panel = await screen.findByTestId("lock-panel");
  await waitFor(() => expect(panel).toBeVisible());
  return within(panel);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Open: Story = {};

export const Minimum: Story = { args: { product: { crossLocked: false, reservedStock: 20 }, totalReady: 79n } };

/** A minimum above the total stock is in force — the badge says the product is closed to other teams NOW. */
export const MinimumInForce: Story = {
  args: { product: { crossLocked: false, reservedStock: 20 }, totalReady: 12n },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("lock-now")).toHaveTextContent("Locked");
  },
};

export const Always: Story = { args: { product: { crossLocked: true, reservedStock: 20 } } };

/** An archived product, or another team's: the setting reads, nothing opens. */
export const ReadOnly: Story = {
  args: { product: { crossLocked: false, reservedStock: 20 }, editable: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("lock").tagName).not.toBe("BUTTON");
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** Without a known total — a warehouse lens holds one building's stock — a minimum draws no badge either way. */
export const NoTotalNoBadge: Story = {
  args: { product: { crossLocked: false, reservedStock: 20 }, totalReady: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("lock")).toHaveTextContent("Min 20 pcs");
    await expect(within(canvasElement).queryByTestId("lock-now")).toBeNull();
  },
};

/** Picking a minimum asks for one, and Save waits for at least 1; saved, it writes the two fields. */
export const AMinimumWritesItsNumber: Story = {
  play: async ({ args, canvasElement }) => {
    const panel = await openPanel(canvasElement);

    await userEvent.click(panel.getByTestId("lock-field-mode-min"));
    await expect(panel.getByTestId("lock-save")).toBeDisabled();
    await userEvent.type(panel.getByTestId("lock-field-minimum"), "15", { delay: 30 });
    await userEvent.click(panel.getByTestId("lock-save"));

    await expect(args.onSave).toHaveBeenCalledWith({ crossLocked: false, reservedStock: 15 });
  },
};

/** Always keeps the minimum the product had; Open clears it — a minimum left behind would still close it at low stock. */
export const AlwaysKeepsTheMinimumOpenClearsIt: Story = {
  args: { product: { crossLocked: false, reservedStock: 20 } },
  play: async ({ args, canvasElement }) => {
    let panel = await openPanel(canvasElement);
    await userEvent.click(panel.getByTestId("lock-field-mode-always"));
    await userEvent.click(panel.getByTestId("lock-save"));
    await expect(args.onSave).toHaveBeenLastCalledWith({ crossLocked: true, reservedStock: 20 });

    panel = await openPanel(canvasElement);
    await userEvent.click(panel.getByTestId("lock-field-mode-open"));
    await userEvent.click(panel.getByTestId("lock-save"));
    await expect(args.onSave).toHaveBeenLastCalledWith({ crossLocked: false, reservedStock: 0 });
  },
};

/** A failed save keeps the popover open, so the choice is not lost. */
export const AFailedSaveStaysOpen: Story = {
  args: { onSave: fn(async () => false) },
  play: async ({ canvasElement }) => {
    const panel = await openPanel(canvasElement);
    await userEvent.click(panel.getByTestId("lock-field-mode-always"));
    await userEvent.click(panel.getByTestId("lock-save"));

    await expect(screen.getByTestId("lock-panel")).toBeVisible();
  },
};

/** ON A PHONE THE EDITOR IS A MODAL (a-phone-edits-the-lock-in-a-modal) — the same pills and minimum, in a dialog with
 * its title and its ×. Pinned with `presentation`, since the story runner has one desktop viewport. */
export const OnAPhoneItIsAModal: Story = {
  args: { product: { crossLocked: false, reservedStock: 20 }, presentation: "dialog" },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("lock"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Change Lock");
    await expect(within(dialog).getByTestId("lock-field-minimum")).toHaveValue("20");

    await userEvent.click(within(dialog).getByTestId("lock-field-mode-always"));
    await userEvent.click(within(dialog).getByTestId("lock-save"));
    await expect(args.onSave).toHaveBeenCalledWith({ crossLocked: true, reservedStock: 20 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};

/** The editor alone, as the product form uses it — the minimum only for its own way. */
export const TheField: Story = {
  render: () => {
    const [mode, setMode] = useState<LockMode>("open");
    const [minimum, setMinimum] = useState("");

    return (
      <Box maxW="sm">
        <LockModeField mode={mode} onModeChange={setMode} minimum={minimum} onMinimumChange={setMinimum} testId="field" />
      </Box>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("field-minimum")).toBeNull();
    await userEvent.click(canvas.getByTestId("field-mode-min"));
    await expect(await canvas.findByTestId("field-minimum-error")).toHaveTextContent("at least 1");
  },
};

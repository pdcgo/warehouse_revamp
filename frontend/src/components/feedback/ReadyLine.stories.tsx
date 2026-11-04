import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ReadyLine, description } from "./ReadyLine";

// WHETHER A FORM'S BUTTON IS READY, IN ONE LINE (a-save-button-says-what-it-waits-for).

const meta = {
  title: "Components/Feedback/ReadyLine",
  component: ReadyLine,
  parameters: { docs: { description: { component: description } } },
  args: {
    readyLabel: "Ready to create",
    testId: "ready",
    missing: [
      { id: "warehouse", label: "warehouse" },
      { id: "account", label: "paying account" },
      { id: "lines", label: "products" },
    ],
  },
} satisfies Meta<typeof ReadyLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three parts missing: the FIRST is shown, the other two one click away. */
export const SeveralMissing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const line = canvas.getByTestId("ready-missing");

    await expect(line).toHaveTextContent("Not filled in: warehouse");
    await expect(canvas.queryByTestId("ready-missing-account")).toBeNull();
    await expect(line.getBoundingClientRect().height).toBeLessThan(24);

    // MASIH BISA DIDETAILKAN — the whole list, in a popover.
    await userEvent.click(canvas.getByTestId("ready-missing-more"));
    const detail = await screen.findByTestId("ready-missing-detail");
    await waitFor(() => expect(detail).toBeVisible());
    for (const id of ["warehouse", "account", "lines"]) {
      await expect(within(detail).getByTestId(`ready-missing-detail-${id}`)).toBeVisible();
    }
  },
};

/** One part missing: the line alone, nothing to open. */
export const OneMissing: Story = {
  args: { missing: [{ id: "account", label: "paying account" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ready-missing-account")).toHaveTextContent("paying account");
    await expect(canvas.queryByTestId("ready-missing-more")).toBeNull();
  },
};

/** Nothing missing: the ready mark, in green. */
export const Ready: Story = {
  args: { missing: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ready = canvas.getByTestId("ready-ready");

    await expect(ready).toHaveTextContent("Ready to create");
    await expect(canvas.queryByTestId("ready-missing")).toBeNull();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Alert, description } from "./Alert";

const meta = {
  title: "Legacy/Components/Display/Alert",
  component: Alert,
  parameters: { docs: { description: { component: description } } },
  args: { title: "No warehouse assigned", children: "This team cannot receive stock until a warehouse is linked." },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const Warning: Story = { args: { tone: "warning" } };

export const Error: Story = { args: { tone: "error", title: "3 rows failed to import" } };

// The tone drives Chakra's STATUS, not just the colour — so an error alert is announced as an error
// rather than merely being red.
export const EveryTone: Story = {
  render: () => (
    <Stack gap="2" w="420px">
      <Alert tone="info" title="Info" />
      <Alert tone="success" title="Success" />
      <Alert tone="warning" title="Warning" />
      <Alert tone="error" title="Error" />
      <Alert tone="plain" title="Neutral" />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("alert")).toHaveLength(5);
  },
};

// Dismiss is OPT-IN, and this story is the reason to think before enabling it: most alerts here
// describe a condition that is still true afterwards, and a dismissable warning about unpaid
// invoices is a warning that gets dismissed.
export const Closable: Story = {
  args: { closable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("alert-close"));

    await waitFor(async () => {
      await expect(canvas.queryByTestId("alert")).toBeNull();
    });
  },
};

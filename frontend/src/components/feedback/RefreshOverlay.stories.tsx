import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Table } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { products } from "../../../.storybook/fixtures";
import { RefreshOverlay, description } from "./RefreshOverlay";

function Rows() {
  return (
    <Table.Root size="sm" variant="outline">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>SKU</Table.ColumnHeader>
          <Table.ColumnHeader>Name</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {products.map((p) => (
          <Table.Row key={p.id.toString()}>
            <Table.Cell>{p.sku}</Table.Cell>
            <Table.Cell>{p.name}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

const meta = {
  title: "Components/Feedback/RefreshOverlay",
  component: RefreshOverlay,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { busy: false, children: <Rows /> },
} satisfies Meta<typeof RefreshOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Refreshing: Story = { args: { busy: true } };

export const Toggle: Story = {
  render: (args) => {
    const [busy, setBusy] = useState(false);

    return (
      <Stack gap="3" w="lg">
        <Button alignSelf="flex-start" size="xs" onClick={() => setBusy((b) => !b)}>
          {busy ? "Stop" : "Refresh"}
        </Button>
        <RefreshOverlay {...args} busy={busy} />
      </Stack>
    );
  },
};

// ⚠ THE 150ms DELAY IS THE COMPONENT. With `staleTime: 0` every tab switch, page turn and remount
// refetches, so an undelayed overlay would flicker on essentially every interaction. The bar appears
// only if the fetch is STILL running after 150ms — and that delay is the component's job, never the
// caller's, which is why it is tested here rather than trusted.
export const DoesNotFlashForAFastRefetch: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Immediately after mounting with busy=true, nothing is dimmed yet.
    await expect(canvas.getByTestId("refresh-overlay")).not.toHaveAttribute("data-busy");

    // …and once the fetch has outlasted the delay, it is.
    await waitFor(() => expect(canvas.getByTestId("refresh-overlay")).toHaveAttribute("data-busy", "true"), {
      timeout: 1000,
    });
  },
};

// Both halves are load-bearing. The BAR says a request is running; the DIM says the rows beneath are
// the PREVIOUS answer. Pointer events go off with them, because a click landing on row 3 of the old
// answer would open whatever row 3 turns out to be in the new one.
export const DimmedContentIsNotClickable: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("refresh-overlay")).toHaveAttribute("data-busy", "true"));

    const dimmed = canvas.getByRole("table").parentElement!;
    await expect(dimmed).toHaveAttribute("aria-busy", "true");
    await expect(getComputedStyle(dimmed).pointerEvents).toBe("none");
  },
};

// The rows STAY on screen while refreshing — that is the whole pairing with `keepPreviousData`.
// An overlay that cleared the table would trade a stale screen for a flickering one.
export const KeepsTheRowsOnScreen: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("refresh-overlay")).toHaveAttribute("data-busy", "true"));

    await expect(canvas.getByText(products[0]!.sku)).toBeInTheDocument();
  },
};

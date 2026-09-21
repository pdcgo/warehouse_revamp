import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Card } from "../components/display/Card";
import { FormDetail, description } from "./FormDetail";

const FIGURES = [
  { name: "Subtotal", value: 4_200_000n },
  { name: "Shipping", value: 32_000n },
  { name: "Total", value: 4_232_000n },
];

const SUMMARY = (
  <Stack gap="2">
    <Text fontWeight="medium">Order summary</Text>
    <Text fontSize="sm" color="fg.muted">
      12 items · 3 shipments · supplier Ani
    </Text>
  </Stack>
);

const meta = {
  title: "Legacy/Layout/FormDetail",
  component: FormDetail,
  parameters: { docs: { description: { component: description } } },
  args: {
    figures: FIGURES,
    summary: SUMMARY,
    children: (
      <Stack gap="2">
        {Array.from({ length: 8 }, (_, i) => (
          <Card key={i}>
            <Text>Line {i + 1}</Text>
          </Card>
        ))}
      </Stack>
    ),
  },
} satisfies Meta<typeof FormDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

// The totals stay in view while the form is filled in. Both arrangements are always in the tree and
// CSS picks one by width — which is why both test ids exist below.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("form-detail")).toHaveTextContent("Total");
  },
};

// The narrow case is the whole reason this is a component. The obvious responsive answer — drop the
// summary BELOW the form — puts the totals off-screen exactly while you are entering the lines that
// change them, so the full summary goes behind a button instead and the key figures stay sticky.
export const SummaryTogglesOnNarrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("form-detail-summary-inline")).toBeNull();

    await userEvent.click(canvas.getByTestId("form-detail-toggle"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("form-detail-summary-inline")).toBeVisible();
    });
  },
};

export const SingleFigure: Story = {
  args: { figures: [{ name: "Total", value: 4_232_000n }] },
};

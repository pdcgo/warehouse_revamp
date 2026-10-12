import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { categories } from "../../../.storybook/fixtures";
import { CategorySelect, description } from "./CategorySelect";

const meta = {
  title: "Components/Pickers/CategorySelect",
  component: CategorySelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: 0n, onChange: fn() },
  decorators: [
    (Story) => (
      <Box w="80">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof CategorySelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

// The trigger shows the full ANCESTRY, not just the leaf — "Elektronik › Audio › Headphone" — so a
// category named the same under two parents is still unambiguous.
export const Selected: Story = { args: { value: 53n } };

export const Disabled: Story = { args: { value: 53n, disabled: true } };

export const LeafOnly: Story = { args: { leafOnly: true } };

// ⚠ THE ONE FULL-TREE READ the pagination rule exempts: a picker needs EVERY node to assemble a
// tree, because a page is a flat window. That is why CategoryList takes no filter — the drilling
// happens here, in the component.
export const DrillsIntoChildren: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("category-select"));

    // Not portalled — it has to work inside modal dialogs.
    const drill = await canvas.findByTestId("category-drill-Elektronik");
    await waitFor(() => expect(drill).toBeVisible());
    await userEvent.click(drill);

    // A second column appears with the children.
    await expect(await canvas.findByTestId("category-node-Audio")).toBeVisible();
  },
};

export const TriggerShowsTheWholeAncestry: Story = {
  args: { value: 53n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("category-select")).toHaveTextContent("Elektronik › Audio › Headphone"),
    );
  },
};

// Search flattens the tree and shows each hit WITH its path, because "Dapur" alone does not say
// which branch it is on.
export const SearchShowsTheMatchesPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("category-select"));
    await userEvent.type(await canvas.findByTestId("category-search"), "dapur");

    const hit = await canvas.findByTestId("category-node-Dapur");
    await expect(hit).toHaveTextContent("Rumah Tangga › Dapur");
  },
};

export const EmitsTheCategoryId: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("category-select"));
    const node = await canvas.findByTestId("category-node-Rumah Tangga");
    await waitFor(() => expect(node).toBeVisible());
    await userEvent.click(node);

    await expect(args.onChange).toHaveBeenCalledWith(54n);
  },
};

// A category picked by mistake must be removable — the clear only appears once something is set.
export const ClearsBackToNone: Story = {
  args: { value: 53n },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("category-select"));
    const clear = await canvas.findByTestId("category-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);

    await expect(args.onChange).toHaveBeenCalledWith(0n);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(0n);

    return <CategorySelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("category-select"));
    const node = await canvas.findByTestId(`category-node-${categories[0]!.name}`);
    await waitFor(() => expect(node).toBeVisible());
    await userEvent.click(node);

    await waitFor(() => expect(canvas.getByTestId("category-select")).toHaveTextContent(categories[0]!.name));
  },
};

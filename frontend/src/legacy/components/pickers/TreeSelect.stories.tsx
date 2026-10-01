import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { TreeSelect, description, type TreeSelectProps } from "./TreeSelect";

const NODES = [
  {
    value: "apparel",
    label: "Apparel",
    // A grouping branch that is not itself a category anything can be filed under.
    selectable: false,
    children: [
      {
        value: "tshirts",
        label: "T-shirts",
        selectable: false,
        children: [
          { value: "tshirt-m", label: "M" },
          { value: "tshirt-l", label: "L" },
        ],
      },
      { value: "hoodies", label: "Hoodies" },
    ],
  },
  {
    value: "accessories",
    label: "Accessories",
    children: [{ value: "bags", label: "Bags" }],
  },
];

const meta: Meta<TreeSelectProps<string>> = {
  title: "Legacy/Components/Pickers/TreeSelect",
  component: TreeSelect,
  parameters: { docs: { description: { component: description } } },
  args: { nodes: NODES },
};

export default meta;
type Story = StoryObj<TreeSelectProps<string>>;

function Harness(props: Partial<TreeSelectProps<string>>) {
  const [value, setValue] = useState<string>();
  return (
    <Box w="320px">
      <TreeSelect nodes={NODES} value={value} onChange={setValue} {...props} />
    </Box>
  );
}

// RULE 1: branches COLLAPSE. A fully-expanded tree is a long flat list plus indentation — strictly
// worse than a flat list. Only the roots are visible until a branch is opened.
export const BranchesStartCollapsed: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("tree-select-trigger"));
    await waitFor(async () => {
      await expect(screen.getByTestId("tree-select-panel")).toBeVisible();
    });

    await expect(screen.getByTestId("tree-node-apparel")).toBeVisible();
    await expect(screen.queryByTestId("tree-node-tshirts")).toBeNull();

    await userEvent.click(screen.getByTestId("tree-toggle-apparel"));
    await waitFor(async () => {
      await expect(screen.getByTestId("tree-node-tshirts")).toBeVisible();
    });
  },
};

// RULE 2: searching FLATTENS and shows the full ancestor path. "L" on its own is meaningless;
// "Apparel › T-shirts › L" is an answer — and while searching you no longer know which branch to open.
export const SearchShowsThePath: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("tree-select-trigger"));
    await userEvent.type(await screen.findByTestId("tree-select-search"), "L", { delay: 20 });

    await waitFor(async () => {
      const row = screen.getByTestId("tree-node-tshirt-l");
      // The row carries its ancestry, without the branch having been opened.
      expect(row).toHaveTextContent("Apparel");
      expect(row).toHaveTextContent("T-shirts");
    });
  },
};

// A grouping branch cannot be CHOSEN — clicking it opens it instead, which is what the reader meant.
export const UnselectableBranchOpensInstead: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("tree-select-trigger"));
    await userEvent.click(await screen.findByTestId("tree-node-apparel"));

    // Still open, and the branch expanded rather than the value being taken.
    await waitFor(async () => {
      await expect(screen.getByTestId("tree-node-hoodies")).toBeVisible();
    });
  },
};

// Picking a leaf closes the panel and puts the FULL PATH in the trigger — same reason search shows
// it: the leaf label alone does not identify the choice.
export const PickingALeafShowsItsPath: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("tree-select-trigger"));
    await userEvent.click(await screen.findByTestId("tree-toggle-apparel"));
    await userEvent.click(await screen.findByTestId("tree-node-hoodies"));

    await waitFor(async () => {
      await expect(canvas.getByTestId("tree-select-trigger")).toHaveTextContent("Apparel › Hoodies");
    });
  },
};

export const NoMatches: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("tree-select-trigger"));
    await userEvent.type(await screen.findByTestId("tree-select-search"), "zzz", { delay: 20 });

    await waitFor(async () => {
      await expect(screen.getByTestId("tree-select-empty")).toBeVisible();
    });
  },
};

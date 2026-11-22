import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Button, Stack, Text } from "@chakra-ui/react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";

import { categories } from "../../../.storybook/fixtures";
import { categoryClient } from "../../api/clients";
import { useSaveCategory } from "../../pages/categories/queries";
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

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

// A picker mounted after the first — a second field, a dialog opened on the same form, the form opened again.
function ASecondPickerLater(props: { onChange: (id: bigint) => void }) {
  const [second, setSecond] = useState(false);

  return (
    <Stack gap="3">
      <Box data-testid="story-first-picker">
        <CategorySelect onChange={props.onChange} />
      </Box>
      <Button data-testid="story-mount-second" onClick={() => setSecond(true)}>
        Open Another Field
      </Button>
      {second && (
        <Box data-testid="story-second-picker">
          <CategorySelect onChange={props.onChange} />
        </Box>
      )}
    </Stack>
  );
}

// THE TREE IS READ ONCE (#121). Through the query cache (`useCategoryOptions`, referenceQuery), so a picker mounted
// later draws the tree the first one read — no second CategoryList. Each mount used to fetch its own.
export const APickerMountedLaterReadsTheCache: Story = {
  name: "A picker mounted later reads the cached tree — no second CategoryList",
  beforeEach: () => {
    const spy = spyOn(categoryClient, "categoryList");

    return () => spy.mockRestore();
  },
  render: (args) => <ASecondPickerLater onChange={args.onChange ?? (() => {})} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = within(canvas.getByTestId("story-first-picker"));

    await userEvent.click(first.getByTestId("category-select"));
    await waitFor(() => expect(first.getByTestId(`category-node-${categories[0]!.name}`)).toBeVisible(), {
      timeout: 5000,
    });
    await userEvent.click(first.getByTestId("category-select"));

    await userEvent.click(canvas.getByTestId("story-mount-second"));
    const second = within(await canvas.findByTestId("story-second-picker"));
    await userEvent.click(second.getByTestId("category-select"));
    await waitFor(() => expect(second.getByTestId(`category-node-${categories[0]!.name}`)).toBeVisible(), {
      timeout: 5000,
    });

    await expect(callsOf(categoryClient.categoryList)).toBe(1);
  },
};

// A category added on the category page (its write invalidates `categories`).
function AddThenPick(props: { onChange: (id: bigint) => void }) {
  const save = useSaveCategory();
  const [added, setAdded] = useState(false);

  return (
    <Stack gap="3">
      <CategorySelect onChange={props.onChange} />
      <Button
        data-testid="story-add-category"
        onClick={async () => {
          await save.mutateAsync({ name: "Kamera", parentId: 0n });
          setAdded(true);
        }}
      >
        Add Category Elsewhere
      </Button>
      {added && <Text data-testid="story-category-added">added</Text>}
    </Stack>
  );
}

// A CATEGORY ADDED ELSEWHERE IS OFFERED. The picker's tree is cached, but under `categories` — the category page's
// write invalidates it, so the picker on screen re-reads and offers the new node without a reload.
export const ACategoryAddedElsewhereIsOffered: Story = {
  name: "A category added on the category page is offered in the picker",
  render: (args) => <AddThenPick onChange={args.onChange ?? (() => {})} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("category-select"));
    await waitFor(() => expect(canvas.getByTestId(`category-node-${categories[0]!.name}`)).toBeVisible(), {
      timeout: 5000,
    });
    await expect(canvas.queryByTestId("category-node-Kamera")).toBeNull();
    await userEvent.click(canvas.getByTestId("category-select"));

    await userEvent.click(canvas.getByTestId("story-add-category"));
    await canvas.findByTestId("story-category-added", {}, { timeout: 5000 });

    await userEvent.click(canvas.getByTestId("category-select"));
    await waitFor(() => expect(canvas.getByTestId("category-node-Kamera")).toBeVisible(), { timeout: 5000 });
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { UnfinishedPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Unfinished",
  component: UnfinishedPage,
  parameters: { docs: { description: { component: description } } },
  args: { screen: "Notifications" },
} satisfies Meta<typeof UnfinishedPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ IT NAMES THE SCREEN IT IS STANDING IN FOR. A shared placeholder that cannot say what is missing
// is worse than no placeholder — it reads as a screen that failed to load.
export const ItNamesWhatIsMissing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("unfinished-page")).toHaveAttribute("data-screen", "Notifications");
    await expect(canvas.getByText("Notifications is not built yet")).toBeVisible();
  },
};

// The second route that lands here. Two of the floor app's menu items are doors into an empty room.
export const TheOtherRouteThatLandsHere: Story = {
  args: { screen: "Reports" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Reports is not built yet")).toBeVisible();
  },
};

// It says the absence is KNOWN, and that there is nothing to retry — otherwise an operator refreshes
// a page that will never load and concludes the app is broken.
export const ItSaysThereIsNothingToRetry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("unfinished-page")).toHaveTextContent("nothing to retry");
    await expect(canvas.getByTestId("unfinished-page")).toHaveTextContent("not something you have done wrong");
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { SetupPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Setup",
  component: SetupPage,
  parameters: { docs: { description: { component: description } }, layout: "fullscreen" },
  args: { onFinish: fn() },
} satisfies Meta<typeof SetupPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstStep: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("setup-team")).toBeVisible();
    // Nowhere to go back to from the first step.
    await expect(canvas.getByTestId("setup-back")).toBeDisabled();
  },
};

// ⚠ THE FIRST TWO STEPS ARE NOT SKIPPABLE. A team with no warehouse cannot receive stock, so
// advancing past it would produce an account that looks set up and does not work.
export const CannotAdvancePastAnEmptyRequiredStep: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("setup-next")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("setup-team"), "Jaya Abadi", { delay: 10 });
    await waitFor(async () => {
      await expect(canvas.getByTestId("setup-next")).toBeEnabled();
    });

    await userEvent.click(canvas.getByTestId("setup-next"));
    // Step two is required too.
    await waitFor(async () => {
      await expect(canvas.getByTestId("setup-warehouse")).toBeVisible();
    });
    await expect(canvas.getByTestId("setup-next")).toBeDisabled();
  },
};

// The LAST step is skippable — inviting people is the one part that can genuinely wait, so Finish is
// enabled with nothing typed.
export const InvitingPeopleIsOptional: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("setup-team"), "Jaya Abadi", { delay: 10 });
    await userEvent.click(canvas.getByTestId("setup-next"));

    await userEvent.type(await canvas.findByTestId("setup-warehouse"), "Gudang Utara", { delay: 10 });
    await userEvent.click(canvas.getByTestId("setup-next"));

    await waitFor(async () => {
      await expect(canvas.getByTestId("setup-finish")).toBeEnabled();
    });

    await userEvent.click(canvas.getByTestId("setup-finish"));
    await expect(args.onFinish).toHaveBeenCalledWith({ team: "Jaya Abadi", warehouse: "Gudang Utara" });
  },
};

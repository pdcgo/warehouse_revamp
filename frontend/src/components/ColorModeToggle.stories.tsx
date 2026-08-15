import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ColorModeToggle, description } from "./ColorModeToggle";

const meta = {
  title: "Components/ColorModeToggle",
  component: ColorModeToggle,
  parameters: {
    docs: { description: { component: description } },
  },
} satisfies Meta<typeof ColorModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// The icon shows the mode you would switch TO, the way the mocks' own toggle does — a moon while
// you are in light mode. That is the opposite of what "show the current state" would suggest, so it
// is the detail most likely to be "fixed" by mistake.
export const ShowsTheModeItWouldSwitchTo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const button = canvas.getByTestId("color-mode-toggle");
    await expect(button).toHaveAttribute("aria-label", "Switch to dark mode");

    await userEvent.click(button);

    // The whole mechanism is one class on <html> — no next-themes, no provider (src/lib/colorMode.ts).
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    await expect(canvas.getByTestId("color-mode-toggle")).toHaveAttribute(
      "aria-label",
      "Switch to light mode",
    );
  },
};

// The choice is REMEMBERED — a reload must not drop back to the system preference.
export const RemembersTheChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("color-mode-toggle"));

    await waitFor(() => expect(localStorage.getItem("wh-color-mode")).toBe("dark"));
  },
};

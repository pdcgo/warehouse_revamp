import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { RestrictedPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Restricted",
  component: RestrictedPage,
  parameters: { docs: { description: { component: description } } },
  args: { screen: "Team members", requires: ["owner", "admin"] },
} satisfies Meta<typeof RestrictedPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ IT NAMES WHAT IS NEEDED, NOT WHAT YOU ARE. "You need the owner or admin role" is actionable —
// the operator knows who to ask. "Access denied" makes them ask what it means first.
export const ItNamesWhatIsNeeded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("required-roles")).toHaveTextContent('"owner" or "admin"');
    await expect(canvas.getByTestId("required-roles")).toHaveTextContent("Ask a supervisor");
  },
};

// The screen is named, so the message is a refusal with a subject rather than a bare "no".
export const TheScreenIsNamed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Team members is not open to you")).toBeVisible();
  },
};

// ⚠ THE REVOKED-MID-SESSION CASE, SAID OUT LOUD. The menu is built from your roles at render time,
// but a role can be taken away while you are signed in — and the route guard is what actually holds.
// Without this line the operator's model is "the app is broken", when it is working correctly.
export const ItExplainsWhyItWorkedThisMorning: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restricted-page")).toHaveTextContent("If this worked earlier today");
  },
};

// It does not list the roles you DO have. Saying no is fine; enumerating what you are not is a
// slightly hostile way to do it.
export const ItDoesNotEnumerateWhatYouAre: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restricted-page")).not.toHaveTextContent("your role is");
  },
};

// Reached with nothing known about what was wanted — still says something useful.
export const NothingKnownAboutTheRequest: Story = {
  args: { screen: undefined, requires: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("This screen is not open to you")).toBeVisible();
    await expect(canvas.queryByTestId("required-roles")).toBeNull();
  },
};

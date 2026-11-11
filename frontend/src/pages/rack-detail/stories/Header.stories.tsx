import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { FromTheList, RACK_DETAIL_META, loaded } from "./kit";

// RACK DETAIL — the title row: back to where the page was opened, and the same row in small once it scrolls away.
// The page's stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen);
// what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Racks/RackDetail/Header",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// OPENED FROM THE LIST, BACK TO THE LIST (a-form-returns-where-it-was-opened) — with its search.
export const BackToTheList: Story = {
  name: "Back to the list",
  render: () => <FromTheList />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("rack-detail-back", {}, { timeout: 4000 }));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=a-01"));
  },
};

// THE TITLE STICKS ONCE IT HAS SCROLLED AWAY (the-title-row-is-the-sticky-bar, a-sticky-bar-waits-for-the-whole-title-row)
// — hidden while the title is on screen; after a jump down the page, the code in small with back and the acts, folded.
export const TheTitleSticks: Story = {
  name: "Title sticks",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const bar = canvas.getByTestId("rack-detail-name-bar");

    await expect(bar).not.toHaveAttribute("data-shown");
    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await waitFor(() => expect(bar).toHaveAttribute("data-shown"));
    await expect(bar).toHaveTextContent("A-01-1");
    await expect(within(bar).getByTestId("rack-detail-sticky-back")).toBeVisible();
    await expect(within(bar).getByTestId("rack-actions-sticky")).toBeVisible();
  },
};

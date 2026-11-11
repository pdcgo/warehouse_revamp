import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { At, CATEGORIES_META, TOP, loaded, visibleNames } from "./kit";

// CATEGORIES — the search — the path kept, nothing matching, and the URL. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Categories/Categories/Search",
  ...CATEGORIES_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A search keeps the matches and the path down to each, every branch on the way OPEN — Headphone, under Audio, under
 * Elektronik; Rumah Tangga's branch is gone. */
export const ASearchKeepsThePath: Story = {
  name: "Keeps the path",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("categories-search"), "head", { delay: 40 });
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=head"));
  },
};

/** Nothing matches — the hint says so, and Clear Filters brings the tree back, shut (an-empty-list-shows-a-hint). */
export const NothingMatches: Story = {
  name: "Nothing matches",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("categories-search"), "kamera", { delay: 40 });
    const hint = await canvas.findByTestId("categories-none-match");
    await waitFor(() => expect(hint).toBeVisible());

    await userEvent.click(within(hint).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(TOP));
  },
};

/** Opened at a URL holding a search, the tree is narrowed by it (a-lists-filters-live-in-the-url). */
const AtSearched = At("/categories?q=dapur");
export const TheSearchComesBackFromTheUrl: Story = {
  name: "From the URL",
  render: () => <AtSearched />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("categories-search", {}, { timeout: 4000 })).toHaveValue("dapur");
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(["Rumah Tangga", "Dapur"]));
  },
};

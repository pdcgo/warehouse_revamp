import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { shops } from "../../../../.storybook/fixtures";
import { MELATI, SHOPS_META, loaded } from "./kit";

// SHOPS — what a row shows, its sort, and how it opens the shop.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/Shops/Rows",
  ...SHOPS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const OWN = shops.filter((s) => s.teamId === MELATI);
const KENANGA_SHOP = shops.find((s) => s.teamId !== MELATI)!;

/** The team's OWN shops, each with its code and its marketplace — another team's is never on the list. */
export const TheTeamsOwnShops: Story = {
  name: "Own shops only",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const shop of OWN) {
      await expect(canvas.getByTestId(`shop-row-${shop.shopCode}`)).toHaveTextContent(shop.name);
    }
    await expect(canvas.queryByTestId(`shop-row-${KENANGA_SHOP.shopCode}`)).toBeNull();
    await expect(canvas.getByTestId("shop-row-MEL-SHP")).toHaveTextContent("MEL-SHP");
  },
};

/** The name and the code sort from their headings — A to Z first, then flipped; the server sorts. */
export const SortsFromTheHeadings: Story = {
  name: "Sort by heading",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const firstRow = () => within(canvas.getByTestId("shops-table")).getAllByRole("row")[1]!;

    await userEvent.click(canvas.getByTestId("shop-sort-name"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("Melati Grosir"));
    await userEvent.click(canvas.getByTestId("shop-sort-name"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("Melati TikTok"));

    await userEvent.click(canvas.getByTestId("shop-sort-code"));
    await waitFor(() => expect(firstRow()).toHaveTextContent("MEL-LAZ"));
  },
};

/** A row lights up under the pointer, every cell (a-table-row-lights-up) — and the whole row opens the shop. */
export const TheWholeRowLightsUpAndOpens: Story = {
  name: "Row lights up, opens",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId("shop-row-MEL-SHP");
    const cells = within(row).getAllByRole("cell");

    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    row.removeAttribute("data-hover");

    await userEvent.click(cells[1]!);
    await waitFor(() => expect(canvas.getByTestId("at-shop-detail")).toBeInTheDocument());
  },
};

/** A shop's name opens its page. */
export const ANameOpensTheShop: Story = {
  name: "Name opens",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-shop-MEL-SHP"));
    await waitFor(() => expect(canvas.getByTestId("at-shop-detail")).toBeInTheDocument());
  },
};

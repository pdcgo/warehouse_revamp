import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ShopsPage } from "../index";
import { SHOPS_META, loaded } from "./kit";

// SHOPS — the search, the marketplace and primary CS filters, the URL, the empty hint.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Shops/Shops/Filters",
  ...SHOPS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The search reads the name and the code. */
export const SearchesByNameOrCode: Story = {
  name: "Search",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("shop-search"), "grosir", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId("shop-row-MEL-SHP")).toBeNull());
    await expect(canvas.getByTestId("shop-row-MEL-LAZ")).toBeVisible();

    await userEvent.clear(canvas.getByTestId("shop-search"));
    await userEvent.type(canvas.getByTestId("shop-search"), "mel-tik", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-TIK")).toBeVisible());
    await expect(canvas.queryByTestId("shop-row-MEL-LAZ")).toBeNull();
  },
};

/** Nothing matches — the hint says so, and Clear Filters brings the shops back (an-empty-list-shows-a-hint). */
export const NothingMatches: Story = {
  name: "Nothing matches",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("shop-search"), "tidak ada", { delay: 40 });
    const hint = await canvas.findByTestId("shops-none-match");
    await waitFor(() => expect(hint).toBeVisible());

    await userEvent.click(within(hint).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-SHP")).toBeVisible());
    await expect(canvas.getByTestId("shop-search")).toHaveValue("");
  },
};

// THE SEARCH LIVES IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the list is narrowed by it; a change
// is written back.
const AtSearchedUrl = routedPage([{ path: "/shops", element: <><ShopsPage /><LocationProbe /></> }], "/shops?q=grosir");

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtSearchedUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("shop-search", {}, { timeout: 4000 });

    await expect(search).toHaveValue("grosir");
    await waitFor(() => expect(canvas.getByTestId("shop-row-MEL-LAZ")).toBeVisible());
    await expect(canvas.queryByTestId("shop-row-MEL-SHP")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "store", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=store"));
  },
};

// THE MARKETPLACE, THE PRIMARY CS AND "NO PRIMARY CS", AHEAD OF THE CONTRACT (owner: "oke tambahkan dengan warning,
// filter mp, cs utama sama belum ada cs", then "bedakan belum ada csnya") — each held in the URL and marked ⚠, its pick
// thrown away: ShopListFilter has only `q`.
const AtShopsWithProbe = routedPage([{ path: "/shops", element: <><ShopsPage /><LocationProbe /></> }], "/shops");

/** The three filters carry their ⚠ numbers and the summary names them; a pick is kept in the URL but the list is not
 * narrowed — every shop is still there. */
export const TheNewFiltersAreHeldButNotSentYet: Story = {
  name: "Held, not sent",
  render: () => <AtShopsWithProbe />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(within(canvas.getByTestId("shops-marketplace-filter")).getByTestId("not-implemented-marketplaceFilter")).toHaveTextContent("1");
    await expect(within(canvas.getByTestId("shops-primary-filter")).getByTestId("not-implemented-primaryFilter")).toHaveTextContent("2");
    await expect(within(canvas.getByTestId("shops-no-primary-filter")).getByTestId("not-implemented-noPrimaryFilter")).toHaveTextContent("3");

    await userEvent.click(canvas.getByTestId("shops-marketplace-select"));
    const lazada = await within(canvas.getByTestId("shops-marketplace-filter")).findByRole("option", { name: "Lazada" });
    await waitFor(() => expect(lazada).toBeVisible());
    await userEvent.click(lazada);

    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`market=${Marketplace.LAZADA}`));
    await expect(canvas.getByTestId("shop-row-MEL-SHP")).toBeVisible();
    await expect(canvas.getByTestId("shop-row-MEL-TOK")).toBeVisible();
  },
};

/** The CS filter offers the people who ARE a primary CS on this team's shops — Ani and Eko; Budi holds a grant but is
 * nobody's primary, so he is not offered (a-who-filter-lists-the-people-on-its-rows). No "nobody" among them. */
export const ThePrimaryFilterOffersThePrimaries: Story = {
  name: "Primary CS filter",
  render: () => <AtShopsWithProbe />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const input = within(canvas.getByTestId("shops-primary-filter")).getByRole("combobox");

    await userEvent.click(input);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const [first, second] = screen.getAllByRole("option");
    await waitFor(() => expect(first).toBeVisible());
    await expect(first).toHaveTextContent("Ani Rahayu");
    await expect(second).toHaveTextContent("Eko Prasetyo");

    await userEvent.click(second!);
    await waitFor(() => expect(input).toHaveValue("Eko Prasetyo"));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("cs=65"));
  },
};

/** "No primary CS" is a tick of its own (owner: "bedakan belum ada csnya"), in the Filter panel ("pakai panel untuk
 * checkbox"). It and a person cannot both hold, so setting one lifts the other; the trigger counts it, and the × attached
 * to it turns it off without opening the panel. */
export const NoPrimaryCsIsATickInThePanel: Story = {
  name: "No primary CS tick",
  render: () => <AtShopsWithProbe />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const person = within(canvas.getByTestId("shops-primary-filter")).getByRole("combobox");

    // The tick is in the panel, not on the strip.
    await expect(canvas.queryByTestId("shops-no-primary-only")).toBeNull();
    await userEvent.click(canvas.getByTestId("shops-options-trigger"));
    const panel = await screen.findByTestId("shops-options-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await userEvent.click(within(panel).getByTestId("shops-no-primary-only"));
    await waitFor(() => expect(within(panel).getByRole("checkbox")).toBeChecked());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("nocs=1"));
    await expect(canvas.getByTestId("shops-options-count")).toHaveTextContent("1");
    await userEvent.keyboard("{Escape}");

    // A person lifts the tick…
    await userEvent.click(person);
    const ani = await screen.findByTestId("person-filter-option-61");
    await waitFor(() => expect(ani).toBeVisible());
    await userEvent.click(ani);
    await waitFor(() => expect(canvas.queryByTestId("shops-options-count")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?cs=61"));

    // …the tick lifts the person…
    await userEvent.click(canvas.getByTestId("shops-options-trigger"));
    const again = await screen.findByTestId("shops-options-panel");
    await waitFor(() => expect(again).toBeVisible());
    await userEvent.click(within(again).getByTestId("shops-no-primary-only"));
    await waitFor(() => expect(person).toHaveValue(""));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?nocs=1"));
    await userEvent.keyboard("{Escape}");

    // …and the trigger's own × turns it off.
    await userEvent.click(canvas.getByTestId("shops-options-clear"));
    await waitFor(() => expect(canvas.queryByTestId("shops-options-count")).toBeNull());
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(/^$/));
  },
};

/** Opened at a URL holding them, the filters show them; Clear Filters empties every one — and the URL. */
const AtFilteredUrl = routedPage(
  [{ path: "/shops", element: <><ShopsPage /><LocationProbe /></> }],
  `/shops?market=${Marketplace.SHOPEE}&cs=65`,
);

export const TheNewFiltersComeBackFromTheUrl: Story = {
  name: "Back from the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shops-marketplace-select")).toHaveTextContent("Shopee");
    const input = within(canvas.getByTestId("shops-primary-filter")).getByRole("combobox");
    await waitFor(() => expect(input).toHaveValue("Eko Prasetyo"));

    await userEvent.click(canvas.getByTestId("shops-filter-clear"));
    await waitFor(() => expect(input).toHaveValue(""));
    await expect(canvas.getByTestId("shops-marketplace-select")).not.toHaveTextContent("Shopee");
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(/^$/));
  },
};

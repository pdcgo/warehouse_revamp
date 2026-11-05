import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { DiscoverSuppliersPage } from "../index";
import { SUPPLIER_DISCOVER_META, NUSANTARA, loaded, rows } from "./kit";

// DISCOVER SUPPLIERS — the search — what it reads and what it does not — and the filters in the URL
// (a-lists-filters-live-in-the-url). The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/DiscoverSuppliers/Search",
  ...SUPPLIER_DISCOVER_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const LINEN = supplierFixture("Linen House");

async function search(canvas: ReturnType<typeof within>, term: string) {
  await userEvent.clear(canvas.getByTestId("discover-suppliers-search"));
  await userEvent.type(canvas.getByTestId("discover-suppliers-search"), term, { delay: 40 });
}

// The search reads the supplier, its address and contact, and its stores' names — on the server.
export const SearchByStoreOrAddress: Story = {
  name: "Store, address, contact",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // A store's name — Linen House's TikTok store.
    await search(canvas, "linenhouse");
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));
    await expect(canvas.getByTestId(`discover-supplier-row-${LINEN.id}`)).toBeVisible();

    // An address. The previous answer stays on screen while this one loads (HARD RULE 10) and it, too, is one
    // row — so wait for the row this search is about, not for the count.
    await search(canvas, "pulogadung");
    await canvas.findByTestId(`discover-supplier-row-${NUSANTARA.id}`);
    await waitFor(() => expect(rows(canvas)).toHaveLength(1));

    await search(canvas, "zzz");
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// ⚠ supplier_service holds a team id, not a team's name, so the search does not reach the team: "Anggrek" finds
// nothing, though Toko Anggrek's suppliers are on the list. The team is PICKED instead — below.
export const SearchDoesNotReachTheTeamName: Story = {
  name: "Not the team's name",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await search(canvas, "anggrek");
    await canvas.findByTestId("discover-suppliers-none-match");
  },
};

// THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the search and the store type are
// read from it; a change is written back, beside the keys already there.
const AtFilteredUrl = routedPage(
  [{ path: "/inventories/suppliers/discover", element: <><DiscoverSuppliersPage /><LocationProbe /></> }],
  `/inventories/suppliers/discover?q=linenhouse&type=${Marketplace.TIKTOK}`,
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByTestId("discover-suppliers-search", {}, { timeout: 4000 });
    const location = canvas.getByTestId("location-search");
    const chips = within(canvas.getByTestId("discover-suppliers-type-filter"));

    await expect(search).toHaveValue("linenhouse");
    await expect(chips.getByRole("button", { name: "TikTok" })).toHaveAttribute("aria-pressed", "true");
    await canvas.findByTestId(`discover-supplier-row-${LINEN.id}`, {}, { timeout: 4000 });

    await userEvent.click(chips.getByRole("button", { name: "Shopee" }));
    await waitFor(() => expect(location).toHaveTextContent(`type=${Marketplace.SHOPEE}`));
    await expect(location).toHaveTextContent("q=linenhouse");
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { teams, warehouseStock } from "../../../../.storybook/fixtures";
import { discoverPriceOf } from "../../../features/products/discoverSample";
import { formatRupiahRange } from "../../../lib/money";
import { AtKopi, DISCOVER_PRODUCT_DETAIL_META, GULA, SUGAR_PICTURE, loaded, sectionOf, stockLoaded } from "./kit";

// DISCOVER PRODUCT DETAIL — the Info section: whose product it is and no markup, the picture and the derived products,
// the cross price as the card says it, and the ready figure. The page's stories are grouped by the part of the screen
// they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/Info",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const teamName = (id: bigint) => teams.find((t) => t.id === id)!.name;

// WHAT and WHOSE: the owning team is named — on a cross-team page that is the fact worth knowing — BY NAME ALONE, under
// *Team*: it is a selling team, so an avatar and a type badge said nothing. The category and the cross price in Info — and
// NO markup percentage (the-discover-detail-shows-no-markup). An open product carries no lock badge.
export const NamesTheTeamNotTheMarkup: Story = {
  name: "Team, no markup",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() => expect(info.getByTestId("discover-detail-owner")).toHaveTextContent(teamName(GULA.teamId)));
    await expect(info.getByTestId("discover-detail-info-team")).toHaveTextContent(/^Team/);
    await expect(info.getByTestId("discover-detail-owner")).not.toHaveTextContent("Selling");
    await expect(info.getByTestId("discover-detail-category")).toHaveTextContent("Rumah Tangga");
    await expect(canvas.queryByTestId("discover-detail-markup")).toBeNull();
    await expect(canvas.getByTestId("discover-detail-page")).not.toHaveTextContent("1.5%");
    await expect(canvas.queryByTestId(`discover-detail-lock-${GULA.id}`)).toBeNull();
    // Somebody else's product: no way "home", and no cost of the owner's.
    await expect(canvas.queryByTestId("discover-detail-open-own")).toBeNull();
    await expect(info.queryByTestId("discover-detail-cost")).toBeNull();
  },
};

// THE PICTURE AND PRODUK TURUNAN, as on the owner's page (owner: *"gambar produk ada, produk turunan juga ditampilkan"*):
// the shared gallery shows the cover — the one picture a by-ids row carries, marked — and the derived products are the
// owner's page's sample rows, marked too.
export const ThePictureAndTheDerivedProducts: Story = {
  name: "Picture and derived",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const derived = await sectionOf(canvas, "derived");

    await expect(info.getByTestId("discover-detail-image-0")).toHaveAttribute("src", SUGAR_PICTURE);
    await expect(info.getByTestId("not-implemented-gallery")).toBeInTheDocument();
    await expect(derived.getByTestId("pd-derived-to")).toBeInTheDocument();
    await expect(derived.getAllByTestId(/^pd-derived-to-\d+$/).length).toBeGreaterThan(0);
    await expect(derived.getByTestId("not-implemented-derived")).toBeInTheDocument();
  },
};

// A product with no picture says so — its cover is its first image, so there is no gallery to mark.
export const NoPictureSaysSo: Story = {
  name: "No picture",
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await expect(info.getByTestId("discover-detail-no-images")).toBeInTheDocument();
    await expect(info.queryByTestId("not-implemented-gallery")).toBeNull();
  },
};

// THE CROSS PRICE is the card's: the same rule (discoverPriceOf), so the card and its page never disagree — red, and
// marked, since another team's cost is invented.
export const TheCrossPriceIsTheCards: Story = {
  name: "Cross price, as the card's",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const price = discoverPriceOf(GULA.id, GULA.crossMarkupBps, false);

    await expect(info.getByTestId("discover-detail-cross")).toHaveTextContent(
      formatRupiahRange(price.cross!.min, price.cross!.max),
    );
  },
};

// THE LARGE FIGURE IS THE TABLE ADDED UP — every shelf summed, so the two can never disagree.
export const TheReadyFigureIsTheShelvesSummed: Story = {
  name: "Ready, the shelves summed",
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() =>
      expect(info.getByTestId("discover-detail-highlight-ready")).toHaveTextContent(
        `${warehouseStock[GULA.id.toString()]} pcs ready`,
      ),
    );
    await expect(info.getByTestId("discover-detail-highlight-status")).toHaveAttribute("data-status", "ok");
  },
};

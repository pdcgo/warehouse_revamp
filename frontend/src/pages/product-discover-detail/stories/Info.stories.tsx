import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { teams, warehouseStock } from "../../../../.storybook/fixtures";
import { productImagesCalls } from "../../../../.storybook/productListScenario";
import { discoverStockSample } from "../../../../.storybook/productStub";
import { withReturnMaps } from "../../../../.storybook/returnConfigurationStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiahRange } from "../../../lib/money";
import {
  AtKopi,
  AtTeh,
  BERAS,
  DISCOVER_PRODUCT_DETAIL_META,
  GULA,
  GULA_GALLERY,
  KOPI,
  SUGAR_PICTURE,
  TEH,
  gulaHasItsGallery,
  loaded,
  openPendingStrip,
  sectionOf,
  stockLoaded,
} from "./kit";

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

// Produk Turunan's cast beyond the kit's: Anggrek's Minyak (700) and Melati's Kecap (76).
const MINYAK = { id: 700n, productCode: "SL-03-ANG-001" };
const KECAP_ID = 76n;

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
// the shared gallery shows Gula's one picture, square — its gallery IS its cover, so there is nothing more and nothing
// marked — and the derived products are REAL (produk-turunan-is-the-return-map): every team's map from Gula, read across
// teams by a team that holds neither — Anggrek's (the newest) and Melati's seeded one, each under its team with its SKU
// and ready stock — and Turunan dari, Melati's Kecap that Kenanga lands on Gula. No mark, and none in the strip.
export const ThePictureAndTheDerivedProducts: Story = {
  name: "Picture and derived",
  beforeEach: withReturnMaps([15n, GULA.id, MINYAK.id], [13n, KECAP_ID, GULA.id]),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const derived = await sectionOf(canvas, "derived");

    await expect(info.getByTestId("discover-detail-image-0")).toHaveAttribute("src", SUGAR_PICTURE);
    await expect(info.queryByTestId("discover-detail-thumb-0")).toBeNull();
    await expect(info.queryByTestId("not-implemented-gallery")).toBeNull();
    await expect(info.queryByText("Cover only")).toBeNull();

    await waitFor(() => expect(derived.getByTestId("pd-derived-count")).toHaveTextContent(/^2$/), { timeout: 5000 });
    await expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent("Toko Anggrek");
    await expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent(MINYAK.productCode);
    await expect(derived.getByTestId("pd-derived-to-1")).toHaveTextContent(teamName(BERAS.teamId));
    await expect(derived.getByTestId("pd-derived-to-1")).toHaveTextContent(BERAS.productCode);
    await expect(derived.getByTestId("pd-derived-to-1-pcs")).toHaveTextContent(`${discoverStockSample(BERAS.id, 0n).readyQty} pcs`);
    await expect(derived.getByTestId("pd-derived-from-item")).toHaveTextContent("Toko Melati");
    await expect(derived.getByTestId("pd-derived-from-item")).toHaveTextContent("SKU-KECAP-600");
    await expect(derived.queryByTestId("not-implemented-derived")).toBeNull();
    await openPendingStrip(canvas);
    await expect(canvas.queryByTestId("pending-row-derived")).toBeNull();
  },
};

// A REFUSED DERIVED READ says so in its section — a warehouse role is refused, as Discover refuses it — and costs the
// page nothing else: whose product it is still reads.
export const ARefusedDerivedReadSaysSo: Story = {
  name: "Refused derived",
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const derived = await sectionOf(canvas, "derived");

    await waitFor(() => expect(derived.getByTestId("pd-derived-error")).toHaveTextContent(/Discover/), { timeout: 5000 });
    await expect(derived.queryByTestId("pd-derived-to")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("discover-detail-owner")).toHaveTextContent(teamName(GULA.teamId)), { timeout: 5000 });
  },
};

// ANOTHER TEAM'S WHOLE GALLERY (the-discover-detail-shows-no-markup: "the pictures are the product page's gallery") —
// every picture its owner gave it, in order, the cover first, as a carousel with a thumbnail per picture; a thumbnail
// shows its picture. Read by ProductByIds' IMAGES slice for this one product — no Hanya sampul, no ⚠.
export const AnotherTeamsWholeGallery: Story = {
  name: "Another team's whole gallery",
  beforeEach: gulaHasItsGallery,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() => expect(info.getAllByTestId(/^discover-detail-thumb-\d+$/)).toHaveLength(GULA_GALLERY.length));
    for (const [i, url] of GULA_GALLERY.entries()) {
      await expect(info.getByTestId(`discover-detail-image-${i}`)).toHaveAttribute("src", url);
    }
    await expect(productImagesCalls.at(-1)).toEqual({ teamId: 12n, ids: [GULA.id] });

    await userEvent.click(info.getByTestId("discover-detail-thumb-2"));
    await waitFor(() => expect(info.getByTestId("discover-detail-thumb-2")).toHaveAttribute("data-current"));
    await expect(info.getByTestId("discover-detail-thumb-0")).not.toHaveAttribute("data-current");

    await expect(info.queryByTestId("not-implemented-gallery")).toBeNull();
    await expect(info.queryByText("Cover only")).toBeNull();
    // …and the page's ⚠ strip no longer lists it.
    await openPendingStrip(canvas);
    await expect(canvas.queryByTestId("pending-row-gallery")).toBeNull();
  },
};

// THE GALLERY IS DISCOVER'S: a warehouse role asking for it is refused (Discover serves no warehouse) — and a refusal
// costs the page its gallery alone. The record's cover still stands, nothing else on the page breaks.
export const ARefusedGalleryKeepsTheCover: Story = {
  name: "Refused gallery keeps the cover",
  beforeEach: [gulaHasItsGallery, asRole(Role.WAREHOUSE_ADMIN)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");

    await waitFor(() => expect(productImagesCalls.length).toBeGreaterThan(0));
    await expect(info.getByTestId("discover-detail-image-0")).toHaveAttribute("src", GULA_GALLERY[0]);
    await expect(info.queryByTestId("discover-detail-thumb-0")).toBeNull();
    await expect(canvas.queryByTestId("discover-detail-error")).toBeNull();
    await expect(info.getByTestId("discover-detail-owner")).toBeInTheDocument();
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

// THE CROSS PRICE is the card's: the same read (DiscoverStockByIds, every warehouse), so the card and its page never
// disagree — Kopi's Rp 18.500 batch with its 10% on top, red, real, unmarked. The cost itself is never on the page.
export const TheCrossPriceIsTheCards: Story = {
  name: "Cross price, as the card's",
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const card = discoverStockSample(KOPI.id, 0n);
    await expect(card.crossKnown).toBe(true);

    await waitFor(() =>
      expect(info.getByTestId("discover-detail-cross")).toHaveTextContent(formatRupiahRange(card.crossMin, card.crossMax)),
    );
    await expect(info.queryByTestId("not-implemented-crossPrice")).toBeNull();
    await expect(info.queryByTestId("discover-detail-cost")).toBeNull();
  },
};

// WHAT IS ON ITS WAY is the card's too — Teh's 6 units bound for Gudang Pusat, from the same read; real, unmarked.
export const OnItsWayIsTheCards: Story = {
  name: "On its way, as the card's",
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const info = await sectionOf(canvas, "info");
    const card = discoverStockSample(TEH.id, 0n);
    await expect(card.ongoingQty).toBe(6n);

    await waitFor(() => expect(info.getByTestId("discover-detail-highlight-line")).toHaveTextContent(`+${card.ongoingQty} pcs on the way`));
    await expect(info.queryByTestId("not-implemented-ongoing")).toBeNull();
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

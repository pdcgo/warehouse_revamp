import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../../.storybook/fixtures";
import { callsOf, holdRpc, type HeldRpc } from "../../../../.storybook/holdRpc";
import { discoverStockSample, productsForStory } from "../../../../.storybook/productStub";
import { withReturnMaps } from "../../../../.storybook/returnConfigurationStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { inventoryClient, productClient, teamClient, teamReturnConfigurationClient } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { PRODUCT_DETAIL_META, loaded, sectionOf } from "./kit";

// PRODUCT DETAIL — Produk Turunan, REAL since 2026-11-27 (#140): the return maps read both ways and ACROSS TEAMS
// (produk-turunan-is-the-return-map; TeamReturnConfigurationService.ProductDerivedList), named by the reads the page
// already makes — ProductByIds, TeamByIds, DiscoverStockByIds. The section keeps the accepted look
// (the-warehouse-zone-is-tabs: Turunan dari, then Turunannya with its count, the first three, Lihat Semua).
//
// Minyak Goreng (700) is Toko Anggrek's (15). The maps these stories write, oldest first:
//
//   Anggrek  Kenanga's Gula (73)  → Minyak      Turunan dari — two borrowed products may land on ONE own product
//   Anggrek  Melati's Kecap (76)  → Minyak      (the map is unique on its source only)
//   Kenanga  Minyak → its Gula (73)             Turunannya
//   Melati   Minyak → its Beras (74)            Turunannya — Beras has a picture
//
// and for "many", three more selling teams this file adds for its story (16–18), each mapping Minyak to its own product.

const meta = {
  title: "Pages/Products/ProductDetail/Derived",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const MINYAK = 700n;
const product = (id: bigint) => products.find((p) => p.id === id)!;
const GULA = product(73n);
const BERAS = product(74n);
const KECAP = product(76n);
const pcs = (id: bigint) => `${discoverStockSample(id, 0n).readyQty} pcs`;

const LANDS_ON_MINYAK: [bigint, bigint, bigint][] = [
  [15n, GULA.id, MINYAK],
  [15n, KECAP.id, MINYAK],
];
const MAPS_MINYAK: [bigint, bigint, bigint][] = [
  [13n, MINYAK, GULA.id],
  [12n, MINYAK, BERAS.id],
];

// THREE MORE SELLING TEAMS, for "many" — added to the team fixture (TeamByIds reads it live) and taken back after.
const MORE_TEAMS = [
  { id: 16n, name: "Toko Dahlia", code: "SL-04", productId: 9301n },
  { id: 17n, name: "Toko Mawar", code: "SL-05", productId: 9302n },
  { id: 18n, name: "Toko Kamboja", code: "SL-06", productId: 9303n },
];

function moreTeamsDeriveMinyak() {
  const added = MORE_TEAMS.map((m) => ({
    id: m.id,
    type: TeamType.SELLING,
    name: m.name,
    teamCode: m.code,
    description: "",
    deleted: false,
    imageUrl: "",
    priorityProduct: false,
  }));
  teams.push(...added);
  productsForStory(
    ...MORE_TEAMS.map((m) => ({ id: m.productId, teamId: m.id, productCode: `${m.code}-MNY-2L`, name: `Minyak Goreng 2L (${m.name})` })),
  );
  withReturnMaps(...LANDS_ON_MINYAK, ...MAPS_MINYAK, ...MORE_TEAMS.map((m): [bigint, bigint, bigint] => [m.id, MINYAK, m.productId]))();

  return () => {
    for (const team of added) teams.splice(teams.indexOf(team), 1);
  };
}

/** The section, once its rows (or its empty lines) have answered. */
async function derivedLoaded(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  const derived = await sectionOf(canvas, "derived");
  await waitFor(() => expect(derived.getByTestId("pd-derived-to")).toBeInTheDocument(), { timeout: 5000 });
  return { canvas, derived };
}

/** BOTH WAYS, REAL: Turunan dari names the two borrowed products that land on Minyak — each its own line, newest first,
 * each under its OWNER (Kecap is Melati's, Gula Kenanga's) — and Turunannya every other team's own product made of it,
 * under the team that maps it. Every line its SKU and its ready stock in pcs (the Discover card's figure). Two of them,
 * so no Lihat Semua. Nothing is marked any more. */
export const BothWaysAreReal: Story = {
  name: "Both ways, real",
  beforeEach: withReturnMaps(...LANDS_ON_MINYAK, ...MAPS_MINYAK),
  play: async ({ canvasElement }) => {
    const { canvas, derived } = await derivedLoaded(canvasElement);

    await waitFor(() => expect(derived.getByTestId("pd-derived-from-item")).toHaveTextContent("Toko Melati"), { timeout: 5000 });
    await expect(derived.getByTestId("pd-derived-from-item")).toHaveTextContent(KECAP.productCode);
    await expect(derived.getByTestId("pd-derived-from-item-pcs")).toHaveTextContent(pcs(KECAP.id));
    await expect(derived.getByTestId("pd-derived-from-item-1")).toHaveTextContent("Toko Kenanga");
    await expect(derived.getByTestId("pd-derived-from-item-1")).toHaveTextContent(GULA.productCode);

    await expect(derived.getByTestId("pd-derived-count")).toHaveTextContent(/^2$/);
    await expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent("Toko Melati");
    await expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent(BERAS.productCode);
    await expect(derived.getByTestId("pd-derived-to-0-pcs")).toHaveTextContent(pcs(BERAS.id));
    await expect(derived.getByTestId("pd-derived-to-0-pcs")).toHaveAttribute("aria-label", expect.stringMatching(/pcs ready/));
    await expect(derived.getByTestId("pd-derived-to-1")).toHaveTextContent("Toko Kenanga");
    await expect(derived.getByTestId("pd-derived-to-1")).toHaveTextContent(GULA.productCode);
    await expect(derived.queryByTestId("pd-derived-to-2")).toBeNull();
    await expect(derived.queryByTestId("pd-derived-see-all")).toBeNull();

    await expect(derived.queryByTestId("not-implemented-derived")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();
  },
};

/** MANY (owner: *"dia bisa banyak … kalau kepanjangan membingungkan"*): five teams map Minyak, so the card holds the
 * count and the first three — the newest — and Lihat Semua (5) opens all five as a table, each with its name, SKU, team
 * and ready stock, and its picture where it has one (Beras's rice). */
export const ManyTeamsSeeAll: Story = {
  name: "Many — see all",
  beforeEach: moreTeamsDeriveMinyak,
  play: async ({ canvasElement }) => {
    const { derived } = await derivedLoaded(canvasElement);

    await waitFor(() => expect(derived.getByTestId("pd-derived-count")).toHaveTextContent(/^5$/), { timeout: 5000 });
    await expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent("Toko Kamboja");
    await expect(derived.getByTestId("pd-derived-to-1")).toHaveTextContent("Toko Mawar");
    await expect(derived.getByTestId("pd-derived-to-2")).toHaveTextContent("Toko Dahlia");
    await expect(derived.queryByTestId("pd-derived-to-3")).toBeNull();

    await userEvent.click(derived.getByTestId("pd-derived-see-all"));
    await waitFor(() => expect(screen.getByTestId("pd-derived-dialog")).toBeVisible(), { timeout: 5000 });
    const dialog = within(screen.getByTestId("pd-derived-dialog"));
    await expect(dialog.getAllByTestId(/^pd-derived-row-\d+$/)).toHaveLength(5);
    await expect(dialog.getByTestId("pd-derived-row-0")).toHaveTextContent("Minyak Goreng 2L (Toko Kamboja)");
    await expect(dialog.getByTestId("pd-derived-row-3")).toHaveTextContent(BERAS.name);
    await expect(dialog.getByTestId("pd-derived-row-3")).toHaveTextContent("Toko Melati");
    await expect(dialog.getByTestId("pd-derived-row-3")).toHaveTextContent(pcs(BERAS.id));
    // Each with its picture (owner: *"produk turunan di modal ada gambarnya"*) — Beras has one; the others the placeholder.
    await expect(dialog.getByTestId("pd-derived-image-3")).toHaveAttribute("src", BERAS.defaultImageThumbnailUrl);
    await expect(dialog.queryByTestId("pd-derived-image-0")).toBeNull();
    await userEvent.keyboard("{Escape}");
  },
};

/** NONE EITHER WAY — the section says so in both halves, as the accepted design does (`fromNone`, `toNone`), with a count
 * of 0 and no Lihat Semua. */
export const NoMapsEitherWay: Story = {
  name: "None",
  play: async ({ canvasElement }) => {
    const { derived } = await derivedLoaded(canvasElement);

    await expect(derived.getByTestId("pd-derived-from")).toHaveTextContent("This product is not derived from another team’s.");
    await expect(derived.getByTestId("pd-derived-to")).toHaveTextContent("No other team has made a product of this one.");
    await expect(derived.getByTestId("pd-derived-count")).toHaveTextContent(/^0$/);
    await expect(derived.queryByTestId("pd-derived-from-item")).toBeNull();
    await expect(derived.queryByTestId("pd-derived-see-all")).toBeNull();
  },
};

let held: HeldRpc | null = null;

/** WHILE THE MAPS LOAD the section shows its spinner — the rest of the page is already drawn — and the rows replace it
 * the moment they answer. */
export const WhileTheMapsLoad: Story = {
  name: "Loading",
  beforeEach: [
    withReturnMaps(...MAPS_MINYAK),
    () => {
      held = holdRpc(teamReturnConfigurationClient, "productDerivedList");
      return () => held?.restore();
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const derived = await sectionOf(canvas, "derived");

    await waitFor(() => expect(derived.getByTestId("pd-derived-loading")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("pd-section-info")).toBeInTheDocument();
    await expect(derived.queryByTestId("pd-derived-to")).toBeNull();

    held!.release();
    await waitFor(() => expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent("Toko Melati"), { timeout: 5000 });
    await expect(derived.queryByTestId("pd-derived-loading")).toBeNull();
  },
};

/** A REFUSED READ says so IN THE SECTION — the server refuses a warehouse role, as Discover does — and costs nothing
 * else: the product and its other sections stand. */
export const ARefusedReadSaysSo: Story = {
  name: "Refused",
  beforeEach: [withReturnMaps(...MAPS_MINYAK), asRole(Role.WAREHOUSE_ADMIN)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const derived = await sectionOf(canvas, "derived");

    await waitFor(() => expect(derived.getByTestId("pd-derived-error")).toHaveTextContent(/Discover/), { timeout: 5000 });
    await expect(derived.queryByTestId("pd-derived-to")).toBeNull();
    await expect(canvas.getByTestId("pd-section-info")).toBeInTheDocument();
    await expect(canvas.getByTestId("pd-section-batch")).toBeInTheDocument();
  },
};

let heldDetail: HeldRpc | null = null;

/** THE MAPS ARE ASKED BESIDE THE PRODUCT'S OWN READ — the id is in the address, so the section never waits for the
 * record to land before its read starts: with ProductDetail held, ProductDerivedList has already gone out. */
export const TheMapsGoOutBesideTheRecord: Story = {
  name: "Maps beside the record",
  beforeEach: () => {
    const maps = spyOn(teamReturnConfigurationClient, "productDerivedList");
    heldDetail = holdRpc(productClient, "productDetail");
    return () => {
      heldDetail?.restore();
      maps.mockRestore();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(callsOf(productClient.productDetail).length).toBeGreaterThan(0), { timeout: 5000 });
    await waitFor(() => expect(callsOf(teamReturnConfigurationClient.productDerivedList).length).toBeGreaterThan(0), { timeout: 5000 });
    await expect(callsOf(teamReturnConfigurationClient.productDerivedList)[0]![0]).toMatchObject({
      teamId: 15n,
      filter: { productId: MINYAK },
    });
    // …while the record is still out: the page has not drawn.
    await expect(canvas.queryByTestId("product-detail-page")).toBeNull();

    heldDetail!.release();
    await loaded(canvasElement);
  },
};

let heldRecords: HeldRpc | null = null;

/** THE NAMES GO OUT TOGETHER, the moment the maps answer (#134/#138): with ProductByIds held, DiscoverStockByIds has
 * already been asked for the same products — every warehouse — and nothing is drawn until both are in. Turunan dari
 * is on the page, so its owners' names wait for the records (a borrowed product's owner is only its record's). */
export const TheNamesGoOutTogether: Story = {
  name: "Names side by side",
  beforeEach: [
    withReturnMaps(...LANDS_ON_MINYAK, ...MAPS_MINYAK),
    () => {
      const stock = spyOn(inventoryClient, "discoverStockByIds");
      const names = spyOn(teamClient, "teamByIds");
      heldRecords = holdRpc(productClient, "productByIds");
      return () => {
        heldRecords?.restore();
        stock.mockRestore();
        names.mockRestore();
      };
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const derived = await sectionOf(canvas, "derived");
    const ids = [GULA.id, BERAS.id, KECAP.id];

    await waitFor(() => expect(callsOf(productClient.productByIds).length).toBeGreaterThan(0), { timeout: 5000 });
    await expect(callsOf(productClient.productByIds)[0]![0]).toMatchObject({ teamId: 15n, filter: { ids } });
    await waitFor(() => expect(callsOf(inventoryClient.discoverStockByIds).length).toBeGreaterThan(0), { timeout: 5000 });
    await expect(callsOf(inventoryClient.discoverStockByIds)[0]![0]).toMatchObject({ productIds: ids, warehouseId: 0n });
    await expect(callsOf(teamClient.teamByIds)).toHaveLength(0);
    await expect(derived.getByTestId("pd-derived-loading")).toBeInTheDocument();

    heldRecords!.release();
    await waitFor(() => expect(derived.getByTestId("pd-derived-from-item")).toHaveTextContent("Toko Melati"), { timeout: 5000 });
    // ONE TeamByIds for every line's team — the maps' (12, 13) and the borrowed products' owners (12, 13).
    await expect(callsOf(teamClient.teamByIds)).toHaveLength(1);
  },
};

/** WITH NO TURUNAN DARI the teams' names go out BESIDE the records — a Turunannya line's team is its map's own — so with
 * ProductByIds held, TeamByIds has already been asked for the two teams that map Minyak. */
export const TeamsGoOutBesideTheRecords: Story = {
  name: "Teams beside the records",
  beforeEach: [
    withReturnMaps(...MAPS_MINYAK),
    () => {
      const names = spyOn(teamClient, "teamByIds");
      heldRecords = holdRpc(productClient, "productByIds");
      return () => {
        heldRecords?.restore();
        names.mockRestore();
      };
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const derived = await sectionOf(canvas, "derived");

    await waitFor(() => expect(callsOf(productClient.productByIds).length).toBeGreaterThan(0), { timeout: 5000 });
    await waitFor(() => expect(callsOf(teamClient.teamByIds).length).toBeGreaterThan(0), { timeout: 5000 });
    await expect(callsOf(teamClient.teamByIds)[0]![0]).toMatchObject({ filter: { ids: [12n, 13n] } });

    heldRecords!.release();
    await waitFor(() => expect(derived.getByTestId("pd-derived-to-0")).toHaveTextContent("Toko Melati"), { timeout: 5000 });
    await expect(callsOf(teamClient.teamByIds)).toHaveLength(1);
  },
};

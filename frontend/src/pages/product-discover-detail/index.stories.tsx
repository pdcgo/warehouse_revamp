import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { products, teams, warehouseStock } from "../../../.storybook/fixtures";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { DiscoverProductDetailPage } from "./index";

// ANOTHER team's product, as a selling team deciding whether to sell it — the discover detail.
//
// Team 12 (Toko Melati) stands here. The fixture stock is one building's (Gudang Pusat, 11), and the stub
// answers the second warehouse (Gudang Cabang, 14) with zeros — so every page shows one stocked row and
// one empty one, which is the comparison the table exists for.

const SELLING_TEAM = 12n;

const byName = (name: string) => products.find((p) => p.name === name)!;
const teamName = (id: bigint) => teams.find((t) => t.id === id)!.name;

const GULA = byName("Gula Pasir 1kg"); // Toko Kenanga's (13), 1.5% markup, no reserve
const KOPI = byName("Kopi Arabika 250g"); // reserves 2 of its 40
const TEH = byName("Teh Melati 100g"); // the one a story locks or archives
const BERAS = byName("Beras Pandan Wangi 5kg"); // team 12's own

const STOCKED = teams[0]!; // Gudang Pusat
const EMPTY = teams[3]!; // Gudang Cabang

function routedAt(productId: bigint | string) {
  return routedPage(
    [
      { path: "/products/discover/:productId", element: <DiscoverProductDetailPage /> },
      marker("/products/discover", "at-discover"),
      marker("/products/:productId", "at-own-product"),
      marker("/inventories/suppliers/discover/:supplierId", "at-supplier"),
    ],
    `/products/discover/${productId}`,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render
// (pageStory.tsx).
const AtGula = routedAt(GULA.id);
const AtKopi = routedAt(KOPI.id);
const AtTeh = routedAt(TEH.id);
const AtBeras = routedAt(BERAS.id);
const AtNothing = routedAt(999n);

/** A `beforeEach` that flips one flag on the Teh fixture for the story, and puts it back after. */
function tehIs(flag: "crossLocked" | "deleted") {
  return () => {
    TEH[flag] = true;

    return () => {
      TEH[flag] = false;
    };
  };
}

const meta = {
  title: "Pages/Products/DiscoverProductDetail",
  component: AtGula,
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
  beforeEach: () => {
    asTeam(SELLING_TEAM)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("discover-detail-page", {}, { timeout: 4000 });
  return canvas;
}

async function stockLoaded(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await canvas.findByTestId(`discover-stock-row-${STOCKED.id}`, {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const WithAReserve: Story = { render: () => <AtKopi /> };

export const YourOwnProduct: Story = { render: () => <AtBeras /> };

export const Locked: Story = { beforeEach: tehIs("crossLocked"), render: () => <AtTeh /> };

export const Archived: Story = { beforeEach: tehIs("deleted"), render: () => <AtTeh /> };

// ⚠ NO `play()`: the `viewport` global resizes the workbench canvas only, and the story runner has one
// fixed viewport (MobileLayout.stories). For looking — the cover stacks above the record.
export const Mobile: Story = { globals: { viewport: { value: "mobile2" } } };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// WHAT and WHOSE: the owning team is named — on a cross-team page that is the fact worth knowing — and
// the terms it shares on (markup, reserve) sit beside it.
export const NamesTheOwnerAndTheTerms: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-name")).toHaveTextContent(GULA.name);
    await waitFor(() => expect(canvas.getByTestId("discover-detail-owner")).toHaveTextContent(teamName(GULA.teamId)));
    await expect(canvas.getByTestId("discover-detail-category")).toHaveTextContent("Rumah Tangga");
    await expect(canvas.getByTestId("discover-detail-markup")).toHaveTextContent("1.5%");
    await expect(canvas.getByTestId("discover-detail-reserved")).toHaveTextContent("0 pcs");
    // Somebody else's product: no "this is yours" pointer.
    await expect(canvas.queryByTestId("discover-detail-own")).toBeNull();
  },
};

// WHERE: every warehouse gets a row, including the one holding nothing — out of stock there is the
// answer worth seeing, not a row to hide.
export const EveryWarehouseHasARow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const shelf = warehouseStock[GULA.id.toString()]!.toString();

    await expect(canvas.getByTestId(`discover-stock-shelf-${STOCKED.id}`)).toHaveTextContent(shelf);
    await expect(canvas.getByTestId(`discover-stock-take-${STOCKED.id}`)).toHaveTextContent(shelf);

    await expect(canvas.getByTestId(`discover-stock-row-${EMPTY.id}`)).toHaveTextContent(EMPTY.name);
    await expect(canvas.getByTestId(`discover-stock-shelf-${EMPTY.id}`)).toHaveTextContent("0");
    await expect(canvas.getByTestId(`discover-stock-take-${EMPTY.id}`)).toHaveTextContent("0");
  },
};

// The owner's reserve is not offered: Kopi keeps 2 of its 40, so another team can take 38. ⚠ The rule is
// pending ("canTake") — this pins what the screen does today, not a settled business rule.
export const TheReserveIsNotOffered: Story = {
  render: () => <AtKopi />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const shelf = warehouseStock[KOPI.id.toString()]!;

    await expect(canvas.getByTestId(`discover-stock-shelf-${STOCKED.id}`)).toHaveTextContent(shelf.toString());
    await expect(canvas.getByTestId(`discover-stock-take-${STOCKED.id}`)).toHaveTextContent(
      (shelf - BigInt(KOPI.reservedStock)).toString(),
    );
  },
};

// Discovery lists your own products too; opening one points you at the owner's page, which has the
// cost story and the controls this one deliberately lacks.
export const YourOwnProductPointsHome: Story = {
  render: () => <AtBeras />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-open-own"));
    await canvas.findByTestId("at-own-product");
  },
};

// A locked product is out of discovery, so it is reached only by an old link — which must say why, and
// offer no stock, since none of it is on offer.
export const LockedSaysSoAndOffersNoStock: Story = {
  beforeEach: tehIs("crossLocked"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-locked")).toBeVisible();
    await expect(canvas.queryByTestId("discover-detail-stock")).toBeNull();
    // …but still says who sells it: a team may restock from another team's supplier itself.
    await expect(canvas.getByTestId("discover-detail-suppliers")).toBeVisible();
  },
};

export const ArchivedSaysSoAndOffersNoStock: Story = {
  beforeEach: tehIs("deleted"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("discover-detail-archived")).toBeVisible();
    await expect(canvas.queryByTestId("discover-detail-locked")).toBeNull();
    await expect(canvas.queryByTestId("discover-detail-stock")).toBeNull();
  },
};

// WHO SELLS IT: the supplier stores listing the product, each supplier opening the supplier DISCOVER detail —
// it is usually another team's. ⚠ Sample rows (pending "suppliers"), from the supplier discover sample.
export const SuppliersOpenTheSupplierDiscoverDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const suppliers = await canvas.findByTestId("discover-detail-suppliers");

    await waitFor(() => expect(within(suppliers).getAllByTestId(/^discover-supplier-[0-9]+$/).length).toBeGreaterThan(0));
    await userEvent.click(within(suppliers).getAllByTestId(/^discover-supplier-open-/)[0]!);
    await canvas.findByTestId("at-supplier");
  },
};

// ProductByIds omits an id it cannot resolve rather than failing, so "not found" is the page's own call.
export const AnUnknownIdIsNotFound: Story = {
  render: () => <AtNothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("discover-detail-error", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("discover-detail-error")).toHaveTextContent("Product not found.");
  },
};

export const BackGoesToDiscover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("discover-detail-back"));
    await canvas.findByTestId("at-discover");
  },
};

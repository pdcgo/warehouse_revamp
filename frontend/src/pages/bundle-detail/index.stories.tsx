import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { BERAS, GULA, bundleFixture } from "../../../.storybook/bundleFixtures";
import { users } from "../../../.storybook/fixtures";
import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { withProductState } from "../../../.storybook/productScenario";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BundlesPage } from "../bundles";
import { BundleDetailPage } from "./index";

// ⚠ PROTOTYPE for design_accept — a-bundle-has-a-detail-page-that-counts-what-stock-can-make
// (docs/technical/frontend/bundles_decision.md).
//
// One bundle, read: its recipe, and how many bundles one warehouse's stock can make. The fixtures put 25 Beras and 12 Gula
// at Gudang Pusat and nothing at Gudang Cabang — so Paket Hemat (1 Beras + 2 Gula) makes 6 at the first, limited by
// the Gula, and none at the second.

const ANI = users[0]!.id; // the signed-in person
const BUDI = users[1]!.id;

const HEMAT_ANI = bundleFixture("Paket Hemat", ANI);
const HEMAT_BUDI = bundleFixture("Paket Hemat", BUDI);
const THREE_PACK = bundleFixture("Kopi Robusta 3-pack");
const KENANGA = bundleFixture("Paket Kenanga"); // team 13's

const MELATI = 12n;

function routedAt(id: bigint) {
  return routedPage(
    [
      { path: "/products/bundles", element: <BundlesPage /> },
      { path: "/products/bundles/:bundleId", element: <BundleDetailPage /> },
      marker("/products/bundles/:bundleId/edit", "at-bundle-edit"),
    ],
    `/products/bundles/${id}`,
  );
}

// Built ONCE, at module scope (pageStory.tsx).
const AtHematAni = routedAt(HEMAT_ANI.id);
const AtHematBudi = routedAt(HEMAT_BUDI.id);
const AtThreePack = routedAt(THREE_PACK.id);
const AtKenanga = routedAt(KENANGA.id);

function standingAs(role: Role) {
  return () => {
    asTeam(MELATI)();
    asRole(role)();
  };
}

const meta = {
  title: "Pages/Products/BundleDetail",
  component: AtHematAni,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: standingAs(Role.SELLING_OWNER),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("bundle-stock-0", {}, { timeout: 4000 });
  return canvas;
}

const canMake = (canvas: ReturnType<typeof within>, text: string) =>
  waitFor(() => expect(canvas.getByTestId("bundle-can-make")).toHaveTextContent(text), { timeout: 4000 });

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// On a phone the header is one row — Edit and Delete fold into `⋯` (the-phone-header-is-one-row) — and each product is a
// block with its arithmetic as one line (a-phone-reads-each-line-as-a-block).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("bundle-stock-1-sum")).toHaveTextContent("2 per bundle · 12 ready · enough for 6"),
    );

    await userEvent.click(canvas.getByTestId("bundle-detail-more"));
    const edit = await screen.findByTestId("bundle-detail-edit");
    await waitFor(() => expect(edit).toBeVisible());
    await expect(screen.getByTestId("bundle-detail-delete")).toBeVisible();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Can make = the smallest "enough for"; the line that sets it is marked as the one that runs out first.
export const CountsWhatStockCanMake: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await canMake(canvas, "6 bundles");
    await expect(canvas.getByTestId("bundle-stock-0-ready")).toHaveTextContent("25");
    await expect(canvas.getByTestId("bundle-stock-0-enough")).toHaveTextContent("25");
    await expect(canvas.getByTestId("bundle-stock-1-ready")).toHaveTextContent("12");
    await expect(canvas.getByTestId("bundle-stock-1-enough")).toHaveTextContent("6");
    await expect(canvas.getByTestId("bundle-stock-1-limit")).toHaveTextContent("Runs out first");
    await expect(canvas.queryByTestId("bundle-stock-0-limit")).toBeNull();
  },
};

// One warehouse at a time — stock is held per building. Gudang Cabang holds none of it.
export const AnotherWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);
    await canMake(canvas, "6 bundles");

    await pickTeam(canvas.getByTestId("bundle-stock-warehouse"), "WH-02");

    await canMake(canvas, "0 bundles");
    await expect(canvas.getByTestId("bundle-stock-summary")).toHaveTextContent("at Gudang Cabang");
  },
};

// the-reserve-stops-other-teams-at-low-stock: Kenanga holds its last 20 Gula back, and only 12 exist — so a Melati order
// for it would be refused, and the line says so rather than counting the 12.
export const ABorrowedProductBelowItsReserve: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(GULA, { reservedStock: 20 })();
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await canMake(canvas, "0 bundles");
    await expect(canvas.getByTestId("bundle-stock-1-enough")).toHaveTextContent("0");
    await waitFor(() => expect(canvas.getByTestId("bundle-stock-1-reserve")).toHaveTextContent("Below Toko Kenanga’s reserve"));
  },
};

// …and the reserve never stops its owner: Melati's own Beras, reserve 100, still counts all 25.
export const TheReserveNeverStopsItsOwner: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(BERAS, { reservedStock: 100 })();
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await canMake(canvas, "6 bundles");
    await expect(canvas.getByTestId("bundle-stock-0-enough")).toHaveTextContent("25");
    await expect(canvas.queryByTestId("bundle-stock-0-reserve")).toBeNull();
  },
};

// a-borrowed-product-never-blocks-its-owner: Kenanga locked its Gula. The line stays, says why, and is left out of
// "can make" — an order fills that slot with something else.
export const AnUnavailableLineIsLeftOut: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(GULA, { crossLocked: true })();
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await canMake(canvas, "25 bundles");
    await expect(canvas.getByTestId("bundle-stock-1-unavailable")).toHaveTextContent("Locked by its owner");
    await expect(canvas.getByTestId("bundle-stock-1-enough")).toHaveTextContent("—");
    await expect(canvas.getByTestId("bundle-detail-unavailable")).toBeVisible();
  },
};

// the-creator-or-an-admin-edits-a-bundle: everyone reads; a CS who did not make it gets no Edit and no Delete, and is
// told who may change it.
export const ACsReadsSomeoneElses: Story = {
  beforeEach: standingAs(Role.SELLING_CS),
  render: () => <AtHematBudi />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bundle-detail-read-only")).toHaveTextContent("Only Budi Santoso"));
    await expect(canvas.queryByTestId("bundle-detail-edit")).toBeNull();
    await expect(canvas.queryByTestId("bundle-detail-delete")).toBeNull();
    await expect(canvas.getByTestId("bundle-detail-description")).toHaveTextContent("Versi Tokopedia");
  },
};

// Edit opens the form.
export const EditOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await userEvent.click(canvas.getByTestId("bundle-detail-edit"));
    await expect(await canvas.findByTestId("at-bundle-edit")).toBeVisible();
  },
};

// Delete confirms, then lands on the list without it — a hard delete (the-order-keeps-only-product-lines).
export const DeleteFromThePage: Story = {
  render: () => <AtThreePack />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await userEvent.click(canvas.getByTestId("bundle-detail-delete"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    const list = await canvas.findByTestId("bundles-table", {}, { timeout: 4000 });
    await waitFor(() => expect(list).not.toHaveTextContent("Kopi Robusta 3-pack"));
  },
};

// Another team's bundle is not this team's to open.
export const AnotherTeamsBundle: Story = {
  render: () => <AtKenanga />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("bundle-detail-load-error", {}, { timeout: 4000 })).toHaveTextContent(
      "Bundle not found.",
    );
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { BERAS, TEH, TEPUNG, bundleFixture } from "../../../.storybook/bundleFixtures";
import { users } from "../../../.storybook/fixtures";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { withProductState } from "../../../.storybook/productScenario";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BundleDetailPage } from "../bundle-detail";
import { BundlesPage } from "../bundles";
import { BundleEditPage } from "./index";

// ⚠ PROTOTYPE for design_accept — the bundle pass (docs/business/product/product_bundle.md, product_bundle_decision.md).
//
// The form that makes or changes a bundle. The stub (bundleStub.ts) plays the decided rules, and the bundle's page is
// mounted at /products/bundles/:id so a save is seen to land (a-bundle-has-a-detail-page-that-counts-what-stock-can-make).

const ANI = users[0]!.id; // the signed-in person
const BUDI = users[1]!.id;

const HEMAT_ANI = bundleFixture("Paket Hemat", ANI);
const HEMAT_BUDI = bundleFixture("Paket Hemat", BUDI);
const DAPUR = bundleFixture("Paket Dapur");
const SARAPAN = bundleFixture("Paket Sarapan");
const THREE_PACK = bundleFixture("Kopi Robusta 3-pack");
const KENANGA = bundleFixture("Paket Kenanga"); // team 13's

const MELATI = 12n;

function routedAt(path: string) {
  return routedPage(
    [
      { path: "/products/bundles", element: <BundlesPage /> },
      { path: "/products/bundles/new", element: <BundleEditPage /> },
      { path: "/products/bundles/:bundleId", element: <BundleDetailPage /> },
      { path: "/products/bundles/:bundleId/edit", element: <BundleEditPage /> },
    ],
    path,
  );
}

// Built ONCE, at module scope — a router built inside `render` is a fresh history on every re-render (pageStory.tsx).
const AtNew = routedAt("/products/bundles/new");
// What the draft page's Make It a Bundle opens (features/bundles/prefill.ts).
const AtPrefilled = routedAt("/products/bundles/new?name=Paket%20Listing%20Shopee&lines=74:2,73:1");
const editOf = (id: bigint) => routedAt(`/products/bundles/${id}/edit`);
const AtHematAni = editOf(HEMAT_ANI.id);
const AtHematBudi = editOf(HEMAT_BUDI.id);
const AtDapur = editOf(DAPUR.id);
const AtSarapan = editOf(SARAPAN.id);
const AtThreePack = editOf(THREE_PACK.id);
const AtKenanga = editOf(KENANGA.id);

function standingAs(role: Role) {
  return () => {
    asTeam(MELATI)();
    asRole(role)();
  };
}

const meta = {
  title: "Pages/Products/BundleEdit",
  component: AtHematAni,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: standingAs(Role.SELLING_OWNER),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("bundle-line-0", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// On a phone a line is a block — the product at full width, its quantity under it.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("bundle-line-0-quantity")).toBeVisible();
    // The form only — Delete is the bundle page's.
    await expect(canvas.queryByRole("button", { name: "Delete" })).toBeNull();
  },
};

export const New: Story = {
  render: () => <AtNew />,
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// a-bundle-has-at-least-one-line: a new bundle waits for a name AND a product, and says which is missing.
export const SaveWaitsForANameAndAProduct: Story = {
  render: () => <AtNew />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const save = await canvas.findByTestId("bundle-save", {}, { timeout: 4000 });
    await expect(save).toBeDisabled();
    await expect(canvas.getByTestId("bundle-form-missing-name")).toBeVisible();
    await expect(canvas.getByTestId("bundle-form-missing-lines")).toBeVisible();
    // An example, not a label, as its placeholder (every-form-field-shows-an-example).
    await expect(canvas.getByTestId("bundle-name")).toHaveAttribute("placeholder", "e.g. Paket Hemat Lebaran");
  },
};

// Made from scratch: a name, a product from the picker, how many go in one bundle — and it lands on its own page,
// already saying what the stock can make of it.
export const CreatesABundle: Story = {
  render: () => <AtNew />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(await canvas.findByTestId("bundle-name", {}, { timeout: 4000 }), "Paket Beras Duo", { delay: 30 });

    await userEvent.click(canvas.getByRole("button", { name: "Add Products" }));
    const beras = await screen.findByTestId(`product-picker-option-${BERAS}`, {}, { timeout: 4000 });
    await waitFor(() => expect(beras).toBeVisible());
    await userEvent.click(within(beras).getByRole("checkbox"));
    await userEvent.click(screen.getByTestId("product-picker-confirm"));

    // A new line starts at 1 — set it to 2.
    const line = await canvas.findByTestId("bundle-line-0");
    await expect(line).toHaveTextContent("Beras Pandan Wangi 5kg");
    await userEvent.click(within(line).getByTestId("bundle-line-0-quantity-plus"));
    await expect(within(line).getByTestId("bundle-line-0-quantity")).toHaveValue("2");

    await expect(canvas.getByTestId("bundle-save")).toBeEnabled();
    await userEvent.click(canvas.getByTestId("bundle-save"));

    await expect(await canvas.findByTestId("bundle-detail-title", {}, { timeout: 4000 })).toHaveTextContent("Paket Beras Duo");
    // 25 Beras at Gudang Pusat, 2 per bundle.
    await waitFor(() => expect(canvas.getByTestId("bundle-can-make")).toHaveTextContent("12 bundles"));
  },
};

// Make It a Bundle on the draft page: the form opens with the listing's name and the split's products — a starting
// point the person saves, or not.
export const PrefilledFromADraft: Story = {
  render: () => <AtPrefilled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("bundle-name", {}, { timeout: 4000 })).toHaveValue("Paket Listing Shopee");
    const first = await canvas.findByTestId("bundle-line-0");
    await waitFor(() => expect(first).toHaveTextContent("Beras Pandan Wangi 5kg"));
    await expect(within(first).getByTestId("bundle-line-0-quantity")).toHaveValue("2");
    await expect(canvas.getByTestId("bundle-line-1")).toHaveTextContent("Gula Pasir 1kg");
    await expect(canvas.getByTestId("bundle-save")).toBeEnabled();
  },
};

// A borrowed line names whose product it is; the team's own needs no label.
export const ABorrowedLineNamesItsOwner: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bundle-line-1")).toHaveTextContent("Toko Kenanga"));
    await expect(canvas.getByTestId("bundle-line-1")).toHaveAttribute("data-state", "borrowed");
    await expect(canvas.getByTestId("bundle-line-0")).toHaveAttribute("data-state", "own");
    await expect(canvas.getByTestId("bundle-line-0")).not.toHaveTextContent("Toko Melati");
  },
};

// the-creator-or-an-admin-edits-a-bundle: a CS who reaches somebody else's form by its URL gets it read-only, and is
// told who may change it.
export const ACsReachesSomeoneElsesForm: Story = {
  beforeEach: standingAs(Role.SELLING_CS),
  render: () => <AtHematBudi />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bundle-edit-read-only")).toHaveTextContent("Only Budi Santoso"));
    await expect(canvas.queryByTestId("bundle-save")).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Add Products" })).toBeNull();
    await expect(canvas.getByTestId("bundle-line-0-quantity")).toHaveTextContent("2 per bundle");
  },
};

// …and changes her own.
export const ACsChangesHerOwn: Story = {
  beforeEach: standingAs(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.queryByTestId("bundle-edit-read-only")).toBeNull();
    await expect(canvas.getByTestId("bundle-save")).toBeEnabled();
  },
};

// a-borrowed-product-never-blocks-its-owner: Toko Anggrek locked its Tepung. The line stays and says why — and the
// bundle still SAVES with it, because the save does not add it (only an added line must be shareable).
export const ALockedLineIsKeptOnSave: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(TEPUNG, { crossLocked: true })();
  },
  render: () => <AtDapur />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bundle-line-1")).toHaveAttribute("data-state", "locked"));
    await expect(canvas.getByTestId("bundle-line-1-unavailable")).toHaveTextContent("Locked by its owner");
    await expect(canvas.getByTestId("bundle-edit-unavailable")).toBeVisible();

    const name = canvas.getByTestId("bundle-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Paket Dapur Lama", { delay: 30 });
    await userEvent.click(canvas.getByTestId("bundle-save"));

    await expect(await canvas.findByTestId("bundle-detail-title", {}, { timeout: 4000 })).toHaveTextContent("Paket Dapur Lama");
  },
};

// An archived product keeps its name on the line, marked — and the line says what an order will do about it.
export const AnArchivedLine: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(TEH, { deleted: true })();
  },
  render: () => <AtSarapan />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("bundle-line-1")).toHaveAttribute("data-state", "archived"));
    await expect(canvas.getByTestId("bundle-line-1")).toHaveTextContent("Teh Hijau Celup 25s — Satuan (archived)");
    await expect(canvas.getByTestId("bundle-line-1-unavailable")).toHaveTextContent("Archived");
  },
};

// Removing the last line is refused like an empty create — to get rid of a bundle, delete it from its page.
export const RemovingTheLastLine: Story = {
  render: () => <AtThreePack />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await userEvent.click(canvas.getByTestId("bundle-line-0-remove"));
    await expect(canvas.getByTestId("bundle-save")).toBeDisabled();
    await expect(canvas.getByTestId("bundle-form-missing-lines")).toBeVisible();
  },
};

// Another team's bundle is not this team's to open.
export const AnotherTeamsBundle: Story = {
  render: () => <AtKenanga />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("bundle-edit-load-error", {}, { timeout: 4000 })).toHaveTextContent(
      "Bundle not found.",
    );
  },
};

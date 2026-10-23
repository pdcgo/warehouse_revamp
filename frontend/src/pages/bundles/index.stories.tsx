import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { TEH, TEPUNG, bundleFixture } from "../../../.storybook/bundleFixtures";
import { users } from "../../../.storybook/fixtures";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { withProductState } from "../../../.storybook/productScenario";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { BundlesPage } from "./index";

// ⚠ PROTOTYPE for design_accept — the bundle pass (docs/business/product/product_bundle.md, product_bundle_decision.md).
//
// A selling team's picking recipes. The stub (bundleStub.ts) plays the decided rules: names may repeat, a CS changes
// only her own, a borrowed product locked or archived by its owner leaves the line in place and unavailable.

const ANI = users[0]!.id; // the signed-in person
const BUDI = users[1]!.id;

const HEMAT_ANI = bundleFixture("Paket Hemat", ANI);
const HEMAT_BUDI = bundleFixture("Paket Hemat", BUDI);
const DAPUR = bundleFixture("Paket Dapur");
const SARAPAN = bundleFixture("Paket Sarapan");
const THREE_PACK = bundleFixture("Kopi Robusta 3-pack");
const KENANGA = bundleFixture("Paket Kenanga"); // team 13's — never on Melati's list

const MELATI = 12n;

function standingAs(role: Role, teamId = MELATI) {
  return () => {
    asTeam(teamId)();
    asRole(role)();
  };
}

const meta = {
  title: "Pages/Products/Bundles",
  component: BundlesPage,
  parameters: { signedIn: true },
  beforeEach: standingAs(Role.SELLING_OWNER),
} satisfies Meta<typeof BundlesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`bundle-row-${HEMAT_ANI.id}`, {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE READS EACH BUNDLE AS A BLOCK (a-phone-reads-each-line-as-a-block): its name, what is in it, its actions at
// the foot. No headings, so the sort is the Filter sheet's.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("bundles-table")).queryAllByRole("columnheader")).toHaveLength(0);
    // The names arrive with ProductByIds, a beat after the rows.
    await waitFor(() => expect(canvas.getByTestId(`bundle-row-${HEMAT_ANI.id}-lines`)).toHaveTextContent("2 × Gula Pasir 1kg"));

    await userEvent.click(canvas.getByTestId("bundles-filter-open"));
    const sheet = await screen.findByTestId("bundles-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("bundle-sort-select")).toBeVisible();
  },
};

// A team with no bundles says so.
export const NoBundlesYet: Story = {
  beforeEach: standingAs(Role.SELLING_OWNER, 15n),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("bundles-empty", {}, { timeout: 4000 })).toBeVisible();
  },
};

// Only a selling team has bundles — a warehouse sees the sentence, and no New Bundle.
export const AWarehouseTeam: Story = {
  beforeEach: standingAs(Role.WAREHOUSE_ADMIN, 11n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("bundles-selling-only")).toBeVisible();
    await expect(canvas.queryByTestId("open-create-bundle")).toBeNull();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// bundle-names-may-repeat: two "Paket Hemat", and what is in them is what tells them apart — so it is on every row.
export const TwoBundlesOneName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`bundle-row-${HEMAT_ANI.id}`)).toHaveTextContent("Paket Hemat");
    await expect(canvas.getByTestId(`bundle-row-${HEMAT_BUDI.id}`)).toHaveTextContent("Paket Hemat");
    await waitFor(() =>
      expect(canvas.getByTestId(`bundle-row-${HEMAT_ANI.id}-lines`)).toHaveTextContent(
        "1 × Beras Pandan Wangi 5kg · 2 × Gula Pasir 1kg",
      ),
    );
    await expect(canvas.getByTestId(`bundle-row-${HEMAT_BUDI.id}-lines`)).toHaveTextContent(
      "2 × Beras Pandan Wangi 5kg · 1 × Minyak Goreng Sawit 2L — Satuan",
    );
    // Who made each — the other thing that tells them apart.
    await waitFor(() => expect(canvas.getByTestId(`bundle-row-${HEMAT_BUDI.id}-creator`)).toHaveTextContent("Budi Santoso"));
  },
};

// The team's own bundles, and nobody else's.
export const OnlyThisTeamsBundles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId(`bundle-row-${KENANGA.id}`)).toBeNull();
  },
};

// The search reaches INTO a bundle: "which one has the Gula in it?" is asked as often as its name.
export const SearchesByAProductInIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("bundle-search"), "gula", { delay: 40 });

    await waitFor(() => expect(canvas.queryByTestId(`bundle-row-${HEMAT_BUDI.id}`)).toBeNull());
    await expect(canvas.getByTestId(`bundle-row-${HEMAT_ANI.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`bundle-row-${DAPUR.id}`)).toBeNull();
  },
};

// The list's own order is the last change first; the name heading sorts A to Z first.
export const SortsByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const rows = () => within(canvas.getByTestId("bundles-table")).getAllByRole("row").slice(1);

    await expect(rows()[0]).toHaveAttribute("data-testid", `bundle-row-${HEMAT_ANI.id}`);

    await userEvent.click(canvas.getByTestId("bundle-sort-name"));
    await waitFor(() => expect(rows()[0]).toHaveAttribute("data-testid", `bundle-row-${THREE_PACK.id}`));
  },
};

// a-borrowed-product-never-blocks-its-owner: Toko Anggrek locked its Tepung — Paket Dapur keeps the line, and says one
// product of it can no longer be used.
export const ALockedBorrowedLine: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(TEPUNG, { crossLocked: true })();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`bundle-row-${DAPUR.id}-lines`)).toHaveTextContent("Tepung Terigu Serbaguna 1kg"));
    await expect(await canvas.findByTestId(`bundle-row-${DAPUR.id}-lines-unavailable`)).toHaveTextContent("1 unavailable");
    await expect(canvas.queryByTestId(`bundle-row-${HEMAT_ANI.id}-lines-unavailable`)).toBeNull();
  },
};

// An archived product keeps its name on the line, marked.
export const AnArchivedLine: Story = {
  beforeEach: () => {
    standingAs(Role.SELLING_OWNER)();
    withProductState(TEH, { deleted: true })();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId(`bundle-row-${SARAPAN.id}-lines`)).toHaveTextContent("Teh Hijau Celup 25s — Satuan (archived)"),
    );
    await expect(canvas.getByTestId(`bundle-row-${SARAPAN.id}-lines-unavailable`)).toBeVisible();
  },
};

// the-creator-or-an-admin-edits-a-bundle: a CS sees Edit and Delete on her own bundles only.
export const ACsChangesOnlyHerOwn: Story = {
  beforeEach: standingAs(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`edit-bundle-${HEMAT_ANI.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`edit-bundle-${HEMAT_BUDI.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`delete-bundle-${HEMAT_BUDI.id}`)).toBeNull();
    // She may still make one.
    await expect(canvas.getByTestId("open-create-bundle")).toBeVisible();
  },
};

// …and an Owner or Admin changes every bundle of the team.
export const AnAdminChangesEvery: Story = {
  beforeEach: standingAs(Role.SELLING_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`edit-bundle-${HEMAT_BUDI.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`delete-bundle-${DAPUR.id}`)).toBeVisible();
  },
};

// Delete confirms, then the bundle is gone — a hard delete (the-order-keeps-only-product-lines).
export const DeleteConfirms: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`delete-bundle-${THREE_PACK.id}`));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/Orders already made keep their products/)).toBeVisible();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`bundle-row-${THREE_PACK.id}`)).toBeNull());
  },
};

// ── Where it goes ───────────────────────────────────────────────────────────────────────────────

const Routed = routedPage(
  [
    { path: "/products/bundles", element: <BundlesPage /> },
    marker("/products/bundles/new", "at-bundle-new"),
    marker("/products/bundles/:bundleId", "at-bundle"),
  ],
  "/products/bundles",
);

// A row opens its bundle — for everyone, read-only where they may not change it.
export const ARowOpensTheBundle: Story = {
  parameters: { dataRouter: true },
  render: () => <Routed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(within(canvas.getByTestId(`bundle-row-${HEMAT_BUDI.id}`)).getByText("Paket Hemat"));
    await expect(await canvas.findByTestId("at-bundle")).toBeVisible();
  },
};

export const NewBundleOpensTheForm: Story = {
  parameters: { dataRouter: true },
  render: () => <Routed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-bundle"));
    await expect(await canvas.findByTestId("at-bundle-new")).toBeVisible();
  },
};

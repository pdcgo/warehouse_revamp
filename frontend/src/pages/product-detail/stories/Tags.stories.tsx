import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { PRODUCT_TAG, productTagCallsOf, productTagScenario } from "../../../../.storybook/productTagScenario";
import { asAdminTeam, asPlatformOnly, asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { At, AtTepung, PRODUCT_DETAIL_META, loaded } from "./kit";

// PRODUCT DETAIL — THE TAG CARD (backlog #148, live: the-team-code-and-product-tags-prototype-is-accepted). The product's
// own tags in a card of their own — its nav item, the first side card beside Info (stacked: after Batch) — as the order
// page's Tag box (the-order-tags-prototype-is-accepted) on the products' own list (products-have-their-own-tag-list):
// system tags locked, custom tags added and taken off by the product's writers (the selling Owner and Admin, Root, the
// Administrator), the app's `need_reprint_code` locked for everyone, Kelola tag produk for the admins. The chips ride on
// ProductDetail (`Product.tags`); every write goes to ProductService (productTagStub.ts). Minyak (700) carries
// need_reprint_code, Laris and Promo Lebaran (.storybook/productTagScenario.ts).

// Tepung Karton (703) carries the app's tag and an admin's (Audit Admin); Minyak Goreng Sawit 2L — Karton (701) none.
const AtTepungKarton = At(703);
const AtUntagged = At(701);

const meta = {
  title: "Pages/Products/ProductDetail/Tags",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function tagCard(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  return { canvas, card: within(await canvas.findByTestId("pd-section-tags", {}, { timeout: 5000 })) };
}

/** The card beside Info: the app's tag first and locked, the custom ones with their ×, the add box, who sees them —
 *  and a nav item of its own. No Kelola tag for a team's Owner: that is the admins'. */
export const TheTagCard: Story = {
  name: "The Tag card",
  // Wide enough for the side cards beside the main column (useSideBySide).
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const { canvas, card } = await tagCard(canvasElement);

    const chips = card.getAllByTestId(/^product-tag-\d+$/).map((el) => el.textContent);
    await expect(chips).toEqual(["need_reprint_code", "Laris", "Promo Lebaran"]);
    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.reprint}-lock`)).toBeInTheDocument();
    await expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.reprint}-remove`)).toBeNull();
    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.laris}-remove`)).toBeInTheDocument();
    await expect(card.getByTestId("product-tag-add-input")).toBeVisible();
    await expect(card.getByTestId("product-tags-hint")).toHaveTextContent("every warehouse holding its stock");
    await expect(card.queryByTestId("product-tag-manage")).toBeNull();

    // Beside Info, in the side column — and in the navigation.
    await expect(within(canvas.getByTestId("product-detail-side-column")).getByTestId("pd-section-tags")).toBeVisible();
    await expect(canvas.getByTestId("section-nav")).toHaveTextContent("Tags");
    // The code's history is its own Riwayat card since #150 (History.stories.tsx) — never a row of the Tag card.
    await expect(card.queryByTestId("pd-section-history")).toBeNull();
  },
};

/** WRITES — an Owner types a name nobody has used: *Create tag "…"* makes it and puts it on (ProductTagCreate, then
 *  ProductTagAdd), and the card reads it back from the product. */
export const AnOwnerAddsANewTag: Story = {
  name: "Add a new tag (writes)",
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await userEvent.type(card.getByTestId("product-tag-add-input"), "Grosir", { delay: 30 });
    await waitFor(() => expect(screen.getByTestId("product-tag-add-create-custom")).toBeVisible());
    // A custom tag only — a system create is the admins'.
    await expect(screen.queryByTestId("product-tag-add-create-system")).toBeNull();
    await userEvent.click(screen.getByTestId("product-tag-add-create-custom"));

    await waitFor(() => expect(card.getByText("Grosir")).toBeVisible());
    await expect(productTagCallsOf("ProductTagCreate")).toEqual([{ rpc: "ProductTagCreate", teamId: 15n, name: "Grosir" }]);
    await expect(productTagCallsOf("ProductTagAdd")).toHaveLength(1);
  },
};

/** One name, one tag: typing an existing name in another case offers THAT tag, never a twin. */
export const AnExistingNameOffersThatTag: Story = {
  name: "No twin",
  // Tepung (702) carries Promo Lebaran only, so Laris is still to be put on.
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await userEvent.type(card.getByTestId("product-tag-add-input"), "laris", { delay: 30 });
    await waitFor(() => expect(screen.getByTestId(`product-tag-add-option-${PRODUCT_TAG.laris}`)).toBeVisible());
    await expect(screen.queryByTestId("product-tag-add-create-custom")).toBeNull();
  },
};

/** WRITES — a custom tag comes off with its × (ProductTagRemove). */
export const AnOwnerTakesATagOff: Story = {
  name: "Take a tag off (writes)",
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await userEvent.click(card.getByTestId(`product-tag-${PRODUCT_TAG.laris}-remove`));

    await waitFor(() => expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.laris}`)).toBeNull());
    await expect(productTagCallsOf("ProductTagRemove")).toEqual([{ rpc: "ProductTagRemove", productId: 700n, tagId: PRODUCT_TAG.laris }]);
  },
};

/** The team's CS reads the tags — no add, no × (ProductUpdate's roles write; CS is not among them) — and the page asks
 *  nothing more for them: the chips are ProductDetail's, and the tag list is read only for someone who may add. */
export const TheTeamsCsReadsThem: Story = {
  name: "CS reads them",
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.laris}`)).toBeVisible();
    await expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.laris}-remove`)).toBeNull();
    await expect(card.queryByTestId("product-tag-add-input")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(productTagScenario.catalogueReads).toBe(0);
  },
};

/** The admin team monitoring the team reads the chips and changes none (the-admin-team-monitors-read-only). */
export const AMonitorReadsThem: Story = {
  name: "Monitor reads them",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.reprint}`)).toBeVisible();
    await expect(card.queryByTestId("product-tag-add-input")).toBeNull();
    await expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.laris}-remove`)).toBeNull();
    await expect(card.queryByTestId("product-tag-manage")).toBeNull();
  },
};

/** Root: an admin takes a system tag off — but never the app's own, which only the warehouses' reprint clears. */
export const TheAppTagIsLockedForAnAdminToo: Story = {
  name: "App tag locked for an admin",
  beforeEach: asPlatformOnly(Role.ROOT, [15n]),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.reprint}-remove`)).toBeNull();
    // An admin takes a custom tag off too.
    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.laris}-remove`)).toBeInTheDocument();
    await expect(card.getByTestId("product-tag-manage")).toBeVisible();
    await expect(card.getByTestId("product-tags-hint")).toHaveTextContent("any tag but the app's");
  },
};

/** WRITES — Root takes an admin's system tag off (ProductSystemTagRemove) on Tepung Karton (703), which also carries the
 *  app's tag: that one keeps no ×. */
export const AnAdminTakesASystemTagOff: Story = {
  name: "Admin takes a system tag off (writes)",
  beforeEach: asPlatformOnly(Role.ROOT, [15n]),
  render: () => <AtTepungKarton />,
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.reprint}-remove`)).toBeNull();
    await userEvent.click(card.getByTestId(`product-tag-${PRODUCT_TAG.audit}-remove`));

    await waitFor(() => expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.audit}`)).toBeNull());
    await expect(productTagCallsOf("ProductSystemTagRemove")).toEqual([
      { rpc: "ProductSystemTagRemove", productId: 703n, tagId: PRODUCT_TAG.audit },
    ]);
    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.reprint}`)).toBeVisible();
  },
};

/** KELOLA TAG PRODUK — every team's product tags with how many products carry each; the app's tag listed as put on by
 *  the app, with no rename or delete. */
export const TheManageDialog: Story = {
  name: "Manage tags",
  beforeEach: asPlatformOnly(Role.ROOT, [15n]),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);
    await userEvent.click(card.getByTestId("product-tag-manage"));

    await waitFor(() => expect(screen.getByTestId("product-tag-manage-dialog")).toBeVisible(), { timeout: 5000 });
    await expect(screen.getByText("Manage product tags")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId(`product-tag-manage-usage-${PRODUCT_TAG.reprint}`)).toHaveTextContent("2 products"));
    await expect(screen.getByTestId(`product-tag-manage-usage-${PRODUCT_TAG.laris}`)).toHaveTextContent("3 products");
    await expect(screen.getByTestId(`product-tag-manage-app-${PRODUCT_TAG.reprint}`)).toHaveTextContent("Put on by the app");
    await expect(screen.queryByTestId(`product-tag-manage-rename-${PRODUCT_TAG.reprint}`)).toBeNull();
    await expect(screen.queryByTestId(`product-tag-manage-delete-${PRODUCT_TAG.reprint}`)).toBeNull();
    await expect(screen.getByTestId(`product-tag-manage-rename-${PRODUCT_TAG.laris}`)).toBeVisible();
  },
};

/** A rename to a name another tag carries (any case) is refused in place; nothing is sent. */
export const ARenameToATakenNameIsRefused: Story = {
  name: "Rename to a taken name",
  beforeEach: asPlatformOnly(Role.ROOT, [15n]),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);
    await userEvent.click(card.getByTestId("product-tag-manage"));
    await waitFor(() => expect(screen.getByTestId(`product-tag-manage-rename-${PRODUCT_TAG.laris}`)).toBeVisible(), { timeout: 5000 });
    await userEvent.click(screen.getByTestId(`product-tag-manage-rename-${PRODUCT_TAG.laris}`));

    const input = screen.getByTestId("product-tag-manage-name-input");
    await userEvent.clear(input);
    await userEvent.type(input, "promo lebaran", { delay: 20 });
    await userEvent.click(screen.getByTestId("product-tag-manage-save"));

    await waitFor(() => expect(screen.getByTestId("product-tag-manage-taken")).toBeVisible());
    await expect(productTagCallsOf("ProductTagRename")).toHaveLength(0);
  },
};

/** WRITES — an admin renames a tag (ProductTagRename); the card reads the new name. */
export const AnAdminRenamesATag: Story = {
  name: "Rename (writes)",
  beforeEach: asPlatformOnly(Role.ROOT, [15n]),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);
    await userEvent.click(card.getByTestId("product-tag-manage"));
    await waitFor(() => expect(screen.getByTestId(`product-tag-manage-rename-${PRODUCT_TAG.laris}`)).toBeVisible(), { timeout: 5000 });
    await userEvent.click(screen.getByTestId(`product-tag-manage-rename-${PRODUCT_TAG.laris}`));

    const input = screen.getByTestId("product-tag-manage-name-input");
    await userEvent.clear(input);
    await userEvent.type(input, "Terlaris", { delay: 20 });
    await userEvent.click(screen.getByTestId("product-tag-manage-save"));

    await waitFor(() =>
      expect(productTagCallsOf("ProductTagRename")).toEqual([{ rpc: "ProductTagRename", tagId: PRODUCT_TAG.laris, name: "Terlaris" }]),
    );
    await waitFor(() => expect(card.getByTestId(`product-tag-${PRODUCT_TAG.laris}`)).toHaveTextContent("Terlaris"));
  },
};

/** WRITES — an admin deletes a tag: the confirm says how many products it comes off, then ProductTagDelete. */
export const AnAdminDeletesATag: Story = {
  name: "Delete (writes)",
  beforeEach: asPlatformOnly(Role.ROOT, [15n]),
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);
    await userEvent.click(card.getByTestId("product-tag-manage"));
    await waitFor(() => expect(screen.getByTestId(`product-tag-manage-delete-${PRODUCT_TAG.promo}`)).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId(`product-tag-manage-usage-${PRODUCT_TAG.promo}`)).toHaveTextContent("2 products"));
    await userEvent.click(screen.getByTestId(`product-tag-manage-delete-${PRODUCT_TAG.promo}`));

    await waitFor(() => expect(screen.getByText(/comes off the 2 products that carry it/)).toBeVisible());
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(productTagCallsOf("ProductTagDelete")).toEqual([{ rpc: "ProductTagDelete", tagId: PRODUCT_TAG.promo }]));
    await waitFor(() => expect(card.queryByTestId(`product-tag-${PRODUCT_TAG.promo}`)).toBeNull());
  },
};

/** On a phone the card comes after Batch (the side cards stack in their order), and its chip in the nav strip. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const { canvas, card } = await tagCard(canvasElement);

    await expect(card.getByTestId(`product-tag-${PRODUCT_TAG.reprint}`)).toBeVisible();
    const batch = canvas.getByTestId("pd-section-batch");
    const tags = canvas.getByTestId("pd-section-tags");
    await expect(batch.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(tags.scrollWidth).toBeLessThanOrEqual(tags.clientWidth);
  },
};

/** A product with no tags says so in its card. */
export const NoTagsYet: Story = {
  name: "No tags yet",
  render: () => <AtUntagged />,
  play: async ({ canvasElement }) => {
    const { card } = await tagCard(canvasElement);

    await expect(card.getByText("No tags on this product yet.")).toBeVisible();
    await expect(card.queryAllByTestId(/^product-tag-\d+$/)).toHaveLength(0);
  },
};

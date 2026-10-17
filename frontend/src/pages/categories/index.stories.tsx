import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../.storybook/pageStory";
import { clearCategoriesForStory } from "../../../.storybook/categoryStub";
import { CategoriesPage } from "./index";

// THE CATEGORIES PAGE — the one global taxonomy, curated by Root and the Administrator (the nav gate), AS A TREE
// (the-category-page-is-a-tree) that READS LIKE THE APP'S TABLES (the-category-tree-reads-like-a-table): branches that
// open and close — shut on arrival, one button for all — how many sub-categories each holds, ＋ Sub-kategori under a
// node, and Ubah Nama · Pindahkan · Hapus in its ⋯. The stub is categoryStub.ts, writeable, with the server's rules:
//
//   ▸ Elektronik            1
//       ▸ Audio             1
//           Headphone
//   ▸ Rumah Tangga          1
//       Dapur
//
// a parent must exist, a name is unique under its parent, a delete is soft and refused while the category still has
// sub-categories.

const At = (path: string) =>
  routedPage([{ path: "/categories", element: <><CategoriesPage /><LocationProbe /></> }], path);
const AtCategories = At("/categories");

const meta = {
  title: "Pages/Categories/Categories",
  component: AtCategories,
  parameters: { dataRouter: true },
} satisfies Meta<typeof AtCategories>;

export default meta;
type Story = StoryObj<typeof meta>;

const ALL = ["Elektronik", "Audio", "Headphone", "Rumah Tangga", "Dapur"];
const TOP = ["Elektronik", "Rumah Tangga"];

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("category-row-51", {}, { timeout: 4000 });
  return canvas;
}

/** The names of the rows on screen, in reading order. */
function visibleNames(canvasElement: HTMLElement) {
  return within(canvasElement)
    .getAllByTestId(/^category-name-/)
    .filter((el) => el.checkVisibility())
    .map((el) => el.textContent);
}

/** Open every branch with the one button — most rules are about a row the shut tree does not show. */
async function openAll(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await userEvent.click(canvas.getByTestId("categories-toggle-all"));
  await waitFor(() => expect(visibleNames(canvasElement)).toEqual(ALL));
  return canvas;
}

async function openDialog(trigger: HTMLElement) {
  await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}

/** A row's ⋯, opened — the item it holds. The menu portals. */
async function menuItem(canvas: ReturnType<typeof within>, id: number, item: string) {
  await userEvent.click(canvas.getByTestId(`category-actions-${id}`));
  const el = await screen.findByTestId(`${item}-${id}`);
  await waitFor(() => expect(el).toBeVisible());
  return el;
}

/** Pick a node in the CategorySelect inside a dialog (it renders inline, so within the dialog). */
async function pickParent(dialog: HTMLElement, name: string) {
  await userEvent.click(within(dialog).getByTestId("category-select"));
  const node = await within(dialog).findByTestId(`category-node-${name}`);
  await waitFor(() => expect(node).toBeVisible());
  await userEvent.click(node);
}

/** No row's actions run over its count — the count ends before the ＋ button begins. Measured on the BUTTON, not the
 * actions' box: the bug was the button spilling out of a box too narrow for it, over the count. */
async function columnsDoNotOverlap(canvasElement: HTMLElement) {
  for (const add of within(canvasElement).getAllByTestId(/^add-child-/)) {
    if (!add.checkVisibility()) continue;
    const id = add.dataset.testid!.replace("add-child-", "");
    const count = within(canvasElement).getByTestId(`category-children-${id}`).getBoundingClientRect();
    await expect(count.right).toBeLessThanOrEqual(add.getBoundingClientRect().left);
  }
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — the same tree, New Category its ＋ alone on the title's row (a-phone-header-action-is-an-icon). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const create = canvas.getByRole("button", { name: "New Category" });
    await expect(create).toHaveAttribute("data-testid", "open-create-category");
    await expect(create).not.toHaveTextContent("New Category");
    // No heading row on a phone — the count says what it is, and ＋ and the open-all button are their icons alone.
    await expect(canvas.queryByTestId("categories-heading")).toBeNull();
    await expect(canvas.getByTestId("category-children-51")).toHaveTextContent("1 sub-category · 102 products");
    await expect(canvas.getByTestId("add-child-51")).not.toHaveTextContent("Sub-category");
    await expect(canvas.getByTestId("categories-toggle-all")).not.toHaveTextContent("Expand All");
  },
};

/** In Indonesian — *＋ Sub-kategori* fits its column, and never runs over the counts beside it. */
export const InIndonesian: Story = {
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    await expect(canvas.getByTestId("add-child-51")).toHaveTextContent(/^Sub-kategori$/);
    await columnsDoNotOverlap(canvasElement);
  },
};

/** A taxonomy with nothing in it says what next, and its own New Category opens the form. */
export const AnEmptyTreeSaysWhatNext: Story = {
  beforeEach: () => clearCategoriesForStory(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const hint = await canvas.findByTestId("categories-empty", {}, { timeout: 4000 });
    await expect(hint).toHaveTextContent("No categories yet");
    await openDialog(within(hint).getByTestId("categories-empty-create"));
    await expect(screen.getByTestId("new-category-name")).toBeVisible();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The tree arrives SHUT — the top level only, A to Z ("default tutup semua") — each saying how many it holds. */
export const TheTreeArrivesShut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(TOP));
    await expect(canvas.getByTestId("category-children-51")).toHaveTextContent(/^1$/);
    await expect(canvas.getByTestId("categories-toggle-all")).toHaveTextContent("Expand All");
  },
};

/** ONE button opens everything, then shuts everything ("tutup buka semua jadi 1 tombol") — and a click opens or shuts
 * a single branch; once every branch is open by hand the button offers to shut them. */
export const OneButtonOpensAndShutsAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);
    const toggle = canvas.getByTestId("categories-toggle-all");

    await expect(toggle).toHaveTextContent("Collapse All");
    await expect(canvas.getByTestId("category-children-53")).toHaveTextContent("—");
    await userEvent.click(toggle);
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(TOP));
    await expect(toggle).toHaveTextContent("Expand All");

    await userEvent.click(canvas.getByTestId("category-name-51"));
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Rumah Tangga"]));
    await expect(toggle).toHaveTextContent("Expand All");
  },
};

/** IT READS LIKE THE APP'S TABLES (owner: "secara tema kurang sesuai") — a heading row, rows the full width with a line
 * under each at a table row's height, square, and labelled actions that keep clear of the count; no card around it. */
export const TheTreeReadsLikeATable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    await expect(canvas.getByTestId("categories-heading")).toHaveTextContent(/Name.*Sub-categories.*Products.*Actions/);
    const row = getComputedStyle(canvas.getByTestId("category-row-51"));
    await expect(parseFloat(row.height)).toBeGreaterThanOrEqual(44);
    await expect(row.borderBottomWidth).toBe("1px");
    await expect(row.borderTopLeftRadius).toBe("0px");
    await expect(canvas.getByTestId("add-child-51")).toHaveTextContent(/^Sub-category$/);
    await expect(canvasElement.querySelector(".chakra-card__root")).toBeNull();
    await columnsDoNotOverlap(canvasElement);
  },
};

/** HOW MANY PRODUCTS each holds (owner: "tambah jumlah produk dan kasih warning") — invented, so its column carries the
 * ⚠ mark and the strip at the top names it: nothing counts the products filed under a category yet. */
export const TheProductCountIsASampleAndSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await expect(
      within(canvas.getByTestId("categories-heading")).getByTestId("not-implemented-productCount"),
    ).toHaveTextContent("1");
    await expect(canvas.getByTestId("category-products-51")).toHaveTextContent(/^102$/);
    await expect(canvas.getByTestId("category-products-54")).toHaveTextContent(/^9$/);
  },
};

/** A search keeps the matches and the path down to each, every branch on the way OPEN — Headphone, under Audio, under
 * Elektronik; Rumah Tangga's branch is gone. */
export const ASearchKeepsThePath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("categories-search"), "head", { delay: 40 });
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("?q=head"));
  },
};

/** Nothing matches — the hint says so, and Clear Filters brings the tree back, shut (an-empty-list-shows-a-hint). */
export const NothingMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("categories-search"), "kamera", { delay: 40 });
    const hint = await canvas.findByTestId("categories-none-match");
    await waitFor(() => expect(hint).toBeVisible());

    await userEvent.click(within(hint).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(TOP));
  },
};

/** Opened at a URL holding a search, the tree is narrowed by it (a-lists-filters-live-in-the-url). */
const AtSearched = At("/categories?q=dapur");
export const TheSearchComesBackFromTheUrl: Story = {
  render: () => <AtSearched />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("categories-search", {}, { timeout: 4000 })).toHaveValue("dapur");
    await waitFor(() => expect(visibleNames(canvasElement)).toEqual(["Rumah Tangga", "Dapur"]));
  },
};

/** New Category adds a category anywhere — here under Elektronik, picked in the form — and it is in the tree after. */
export const NewCategoryLandsInTheTree: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(canvas.getByTestId("open-create-category"));
    await expect(within(dialog).getByTestId("submit-create-category")).toBeDisabled();
    await userEvent.type(within(dialog).getByTestId("new-category-name"), "Kamera", { delay: 20 });
    await pickParent(dialog, "Elektronik");
    await userEvent.click(within(dialog).getByTestId("submit-create-category"));

    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Kamera", "Rumah Tangga", "Dapur"]),
    );
    await expect(canvas.getByTestId("category-children-51")).toHaveTextContent(/^2$/);
  },
};

/** ＋ on a node adds a sub-category UNDER IT — the form opens with that node already its parent. */
export const AddStartsUnderTheNode: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(canvas.getByTestId("add-child-52"));
    await expect(dialog).toHaveTextContent("New Sub-category");
    await waitFor(() => expect(within(dialog).getByTestId("category-select")).toHaveTextContent("Elektronik › Audio"));

    await userEvent.type(within(dialog).getByTestId("new-category-name"), "Speaker", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-create-category"));
    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Speaker", "Rumah Tangga", "Dapur"]),
    );
  },
};

/** A name is unique under its parent — a second Audio under Elektronik is refused, and the form says why. */
export const ADuplicateNameIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const dialog = await openDialog(canvas.getByTestId("add-child-51"));
    await userEvent.type(within(dialog).getByTestId("new-category-name"), "Audio", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-create-category"));

    await waitFor(() => expect(within(dialog).getByTestId("create-category-error")).toHaveTextContent("already exists"));
    await expect(canvas.queryByTestId("category-row-56")).toBeNull();
  },
};

/** Ubah Nama changes the name and nothing else — Dapur stays under Rumah Tangga. */
export const RenameChangesTheNameOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(await menuItem(canvas, 55, "rename-cat"));
    const name = within(dialog).getByTestId("edit-category-name");
    await expect(name).toHaveValue("Dapur");
    await expect(within(dialog).queryByTestId("category-select")).toBeNull();
    await userEvent.clear(name);
    await userEvent.type(name, "Dapur dan Makan", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-edit-category"));

    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Rumah Tangga", "Dapur dan Makan"]),
    );
  },
};

/** Pindahkan gives a new parent — Dapur moves under Elektronik, and Rumah Tangga is left with none. */
export const MoveGivesANewParent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    const dialog = await openDialog(await menuItem(canvas, 55, "move-cat"));
    await expect(within(dialog).getByTestId("submit-move-category")).toBeDisabled();
    await pickParent(dialog, "Elektronik");
    await userEvent.click(within(dialog).getByTestId("submit-move-category"));

    await waitFor(() =>
      expect(visibleNames(canvasElement)).toEqual(["Elektronik", "Audio", "Headphone", "Dapur", "Rumah Tangga"]),
    );
    await expect(canvas.getByTestId("category-children-54")).toHaveTextContent("—");
  },
};

/** Moving a category does not offer its own branch — Elektronik cannot go under itself or its children. */
export const TheMovePickerLeavesOutItsOwnBranch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const dialog = await openDialog(await menuItem(canvas, 51, "move-cat"));
    await userEvent.click(within(dialog).getByTestId("category-select"));
    const other = await within(dialog).findByTestId("category-node-Rumah Tangga");
    await waitFor(() => expect(other).toBeVisible());
    await expect(within(dialog).queryByTestId("category-node-Elektronik")).toBeNull();
  },
};

/** Hapus is OFF while a category has sub-categories, and says why — the server would refuse it after the confirm. */
export const DeleteIsOffWhileItHasSubCategories: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const del = await menuItem(canvas, 51, "delete-cat");
    await expect(del).toHaveAttribute("data-disabled");
    await expect(screen.getByTestId("delete-blocked-51")).toHaveTextContent("Delete its sub-categories first");

    // …and OFF means off: a click on it opens no confirm (owner: "hapus disabled masih bisa ku klik").
    await userEvent.click(del, { pointerEventsCheck: 0 });
    await new Promise((r) => setTimeout(r, 300));
    await expect(screen.queryByRole("alertdialog")).toBeNull();
  },
};

/** Hapus on a leaf confirms first, naming it — and it is gone after, its parent a leaf now. */
export const DeleteConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openAll(canvasElement);

    await userEvent.click(await menuItem(canvas, 53, "delete-cat"));
    const confirm = await screen.findByRole("alertdialog");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(confirm).toHaveTextContent("Headphone");

    await userEvent.click(within(confirm).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("category-row-53")).toBeNull());
    await expect(canvas.getByTestId("category-children-52")).toHaveTextContent("—");
  },
};

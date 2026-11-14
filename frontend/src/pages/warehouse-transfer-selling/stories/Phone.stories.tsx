import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { teams } from "../../../../.storybook/fixtures";
import { userNamedForStory } from "../../../../.storybook/userStub";
import { fitsTheScreen, tabsDoNotOverlap, theBadgeIsWhole } from "../../../features/warehouseTransfer/storyPhone";
import { SELLING_META, loaded, openedByRoot, sellingAt } from "./kit";

// TRANSFER SELLING ON A PHONE (the-transfer-lists-read-as-blocks-on-a-phone, accepted 2026-11-14) — below `md` the list
// stops drawing its table. Each part an accepted rule (docs/technical/frontend/context_decision.md):
//
//   title + ＋ on one row         the-phone-shell-has-no-top-bar, a-phone-header-action-is-an-icon, every-phone-title-is-20px
//   search + Filter (sheet)       a-phone-filters-from-a-sheet — FilterBar does it
//   tabs: one row, slides         nothing-runs-past-a-phones-edge ("a tab never shrinks")
//   a block per transfer          a-phone-reads-each-line-as-a-block, a-table-row-lights-up — number · status · problems ·
//                                 ⋯; the route; products beside the value; courier and its cost; when · by whom + badge
//   empty                         an-empty-list-shows-a-hint
//   pager                         every-list-pages-with-the-growing-pager, a-phone-pager-is-centred-without-a-page-size
//
// At the 390px it was accepted at, and at 320px (a new screen is looked at at 320 too). The page's other stories are
// grouped by the part of the screen they are about; what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferSelling/Phone",
  ...SELLING_META,
  globals: { viewport: { value: "phone390" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A BLOCK READS THE TRANSFER — the desktop row's facts, one context per line: number, status and ⋯; the route; what is
// in it beside its value; the courier and its cost (beside the value, never inside); when and by whom.
export const TheBlock: Story = {
  name: "A block reads the transfer",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const block = canvas.getByTestId("transfer-row-603");

    await expect(block).toHaveTextContent("#603");
    await expect(block).toHaveTextContent("Shipped");
    await waitFor(() => expect(within(block).getByTestId("transfer-route-603")).toHaveTextContent(/Gudang Pusat.*Gudang Cabang/));
    await expect(within(block).getByTestId("transfer-value-603")).toHaveTextContent(/^Rp\s?[\d.]+$/);
    await waitFor(() => expect(block).toHaveTextContent("JNE"));
    await expect(within(block).getByTestId("transfer-cost-603")).toHaveTextContent(/^Shipping Rp\s?18\.000$/);
    await waitFor(() => expect(within(block).getByTestId("transfer-created-by-603")).toHaveTextContent("by Ani Rahayu"));
    await expect(within(block).getByTestId("transfer-actions-603")).toBeVisible();

    // Broken and missing units are the team's loss, so the block says so without opening it.
    await expect(canvas.getByTestId("transfer-problems-605")).toHaveTextContent(/2 units broken or missing/);
    // A transfer whose cost is not typed yet says so.
    await expect(canvas.getByTestId("transfer-cost-601")).toHaveTextContent("No cost yet");
    await fitsTheScreen(canvasElement);
  },
};

// THE BLOCK OPENS THE TRANSFER; its ⋯ does not — the ⋯ offers what the status allows, as the desktop row's does.
export const TheBlockOpensTheTransfer: Story = {
  name: "A block opens the transfer, its ⋯ does not",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-actions-603"));
    const items = await screen.findAllByRole("menuitem", {}, { timeout: 2000 });
    await waitFor(() => expect(items[0]).toBeVisible());
    const ids = screen.getAllByRole("menuitem").map((item) => item.dataset.testid ?? "");
    await expect(ids).toContain("transfer-action-mark-lost-603");
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByTestId("transfer-route-601"));
    await canvas.findByTestId("at-transfer-detail");
  },
};

// OPENED BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): the block's by-line names Fajar with the "by Root
// team" badge — WHOLE, inside the block. Its sentence opens on a tap, and the tap does not open the transfer.
export const OpenedByRootFromOutside: Story = {
  name: "Opened by Root from outside",
  beforeEach: openedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = await canvas.findByTestId("transfer-created-by-601");

    await waitFor(() => expect(created).toHaveTextContent("by Fajar Nugroho"));
    await expect(within(created).getByTestId("root-team-badge")).toHaveTextContent("by Root team");
    await expect(within(canvas.getByTestId("transfers-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
    await theBadgeIsWhole(canvasElement, "601", "transfer-when-601");

    await userEvent.click(within(created).getByTestId("root-team-badge"));
    const hint = await screen.findByTestId("root-team-badge-hint");
    await waitFor(() => expect(hint).toBeVisible());
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();
  },
};

// LONG NAMES ON THE NARROWEST PHONE — two long warehouses wrap on the route line at full width (names are never clamped
// to a word), and a long Root name keeps its badge whole: the by-line wraps instead of cutting it.
const LONG_FROM = "Gudang Pusat Distribusi Jawa Barat Cikarang Utara";
const LONG_TO = "Gudang Cabang Surabaya Timur Rungkut Industri Blok C";
const LONG_PERSON = "Fajar Nugroho Wicaksono Adiputra Prasetyo";

function longNames() {
  const from = teams.find((t) => t.id === 11n)!;
  const to = teams.find((t) => t.id === 14n)!;
  const was = [from.name, to.name];
  from.name = LONG_FROM;
  to.name = LONG_TO;
  userNamedForStory(66n, LONG_PERSON);
  openedByRoot();

  return () => {
    from.name = was[0]!;
    to.name = was[1]!;
  };
}

export const ALongNameAt320: Story = {
  name: "Long names at 320px",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: longNames,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const route = canvas.getByTestId("transfer-route-601");

    await expect(window.innerWidth).toBe(320);
    await waitFor(() => expect(route).toHaveTextContent(LONG_FROM));
    await expect(route).toHaveTextContent(LONG_TO);
    await expect(route.scrollWidth).toBeLessThanOrEqual(route.clientWidth);
    await waitFor(() => expect(canvas.getByTestId("transfer-created-by-601")).toHaveTextContent(LONG_PERSON));
    await theBadgeIsWhole(canvasElement, "601", "transfer-when-601");
    await fitsTheScreen(canvasElement);
  },
};

// ON THE NARROWEST PHONE (nothing-runs-past-a-phones-edge): the tabs still sit side by side, nothing runs past the edge.
export const At320: Story = {
  name: "At 320px",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(window.innerWidth).toBe(320);
    await tabsDoNotOverlap(canvasElement);
    await fitsTheScreen(canvasElement);
  },
};

// ── Empty, and the filters ───────────────────────────────────────────────────────────────────────────────────────

// NOTHING YET (an-empty-list-shows-a-hint): Toko Anggrek has opened no transfer — the hint says what one is for, and
// offers New Transfer. The pager stays on screen.
export const NothingYet: Story = {
  name: "Empty: nothing yet",
  beforeEach: () => {
    asTeam(15n)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No transfers yet.");
    await expect(empty).toHaveTextContent("Open a transfer to move stock from one warehouse to another.");
    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();
    await fitsTheScreen(canvasElement);
    await userEvent.click(canvas.getByTestId("open-create-transfer-empty"));
    await canvas.findByTestId("at-transfer-new");
  },
};

// NOTHING MATCHES: the hint's Clear Filters is the strip's Clear — the search goes, from the URL too, and the rows return.
const AtNoMatch = sellingAt("/inventories/transfer?q=zzz");

export const NothingMatches: Story = {
  name: "Empty: nothing matches",
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No transfers match.");
    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();
    await fitsTheScreen(canvasElement);

    await userEvent.click(canvas.getByTestId("transfers-empty-clear"));
    await canvas.findByTestId("transfer-row-601", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("q="));
  },
};

// THE FILTERS ARE A SHEET (a-phone-filters-from-a-sheet): the search in the row, the warehouse in the sheet at full
// width, counted on the button.
export const FiltersFromASheet: Story = {
  name: "The filters' sheet",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("transfer-search"), "JNE", { delay: 40 });
    await waitFor(() => expect(canvas.getByTestId("transfer-filters-count")).toHaveTextContent("1"));
    await waitFor(() => expect(canvas.queryByTestId("transfer-row-601")).toBeNull());

    await userEvent.click(canvas.getByTestId("transfer-filters-open"));
    const sheet = await screen.findByTestId("transfer-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("transfer-warehouse-filter")).toBeVisible();
    await expect(within(sheet).getByTestId("transfer-filters-clear")).toBeVisible();
  },
};

// ── In Indonesian ────────────────────────────────────────────────────────────────────────────────────────────────

// IN INDONESIAN — the longer tab labels still sit side by side, and the block's words are the catalogue's.
export const Indonesian: Story = {
  name: "In Indonesian",
  globals: { locale: "id", viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Transfer Stok" })).toBeVisible();
    await expect(canvas.getByTestId("open-create-transfer")).toHaveAccessibleName("Transfer Baru");
    await expect(canvas.getByTestId("transfer-tab-all")).toHaveTextContent("Semua Status");
    await expect(canvas.getByTestId("transfer-cost-603")).toHaveTextContent(/^Ongkir Rp\s?18\.000$/);
    await expect(canvas.getByTestId("transfer-cost-601")).toHaveTextContent("Belum ada biaya");
    await waitFor(() => expect(canvas.getByTestId("transfer-created-by-603")).toHaveTextContent("oleh Ani Rahayu"));
    await expect(canvas.getByTestId("transfer-problems-605")).toHaveTextContent("2 unit rusak atau kurang");
    await tabsDoNotOverlap(canvasElement);
    await fitsTheScreen(canvasElement);
  },
};

// …and its empty hint: nothing matches says so in Indonesian, with Hapus Filter.
export const IndonesianNothingMatches: Story = {
  name: "In Indonesian: nothing matches",
  globals: { locale: "id", viewport: { value: "phone390" } },
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("Tidak ada transfer yang cocok.");
    await expect(empty).toHaveTextContent("Coba kata lain, atau hapus filternya.");
    await expect(canvas.getByTestId("transfers-empty-clear")).toHaveTextContent("Hapus Filter");
  },
};

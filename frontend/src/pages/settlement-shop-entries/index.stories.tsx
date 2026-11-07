import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { closeShopForStory } from "../../../.storybook/shopStub";
import {
  longShopEntriesBook,
  reverseShopEntryForStory,
  shopEntriesCalls,
  shopEntryPosts,
  withShopEntriesBook,
} from "../../../.storybook/shopEntriesStub";
import { SHOP_ENTRIES_PATH } from "../../features/settlement/shopEntries";
import { jakartaWindowOf } from "../../features/settlement/window";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { SettlementType, SourceType } from "../../gen/warehouse/settlement/v1/settlement_pb";
import { formatRupiah, formatSignedRupiah } from "../../lib/money";
import { SettlementShopEntriesPage } from "./index";

// SHOP ENTRIES (the-shop-entries-page-is-accepted, a-shop-entry-reverses-inline): the settlement rows addressed to a
// shop, not to an order, which fold into the report. Served by `.storybook/shopEntriesStub.ts` with the server's rules —
// ShopSettlementEntryList, and SettlementPost of a row's opposite for Reverse.
//
// The book, in the last month: 8 entries — 3 at Melati Official from its Shopee statement (a withdrawal, a payout whose
// ref found no order, one whose ref found two live orders), 2 at Melati TikTok (an ads charge, a fee with a fraction),
// a system adjustment at Melati Store posted by hand, and two more at Melati Official 12 days ago. Received +192.765,5,
// withdrawn 1.700.000.

// formatRupiah uses a no-break space; toHaveTextContent normalises whitespace, so the expectation is normalised too.
const norm = (s: string) => s.replace(/\s/g, " ");

const at = (search = "") =>
  routedPage(
    [
      {
        path: SHOP_ENTRIES_PATH,
        element: (
          <>
            <SettlementShopEntriesPage />
            <LocationProbe />
          </>
        ),
      },
      marker("/settlement/imports/:fileId", "at-import-file"),
    ],
    `${SHOP_ENTRIES_PATH}${search}`,
  );

const meta = {
  title: "Pages/Settlement/Shop Entries",
  component: SettlementShopEntriesPage,
  parameters: { signedIn: true, dataRouter: true },
  // A selling owner — in the order ledger's write set, so every row offers Reverse.
  beforeEach: [asTeam(12n), asRole(Role.SELLING_OWNER)],
  render: at(),
} satisfies Meta<typeof SettlementShopEntriesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("8"), { timeout: 4000 });
  return canvas;
}

// The rows, the kind in business words, the amount signed, the statement they came from — and the totals strip over
// the whole filtered set.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("shop-entries-received")).toHaveTextContent(norm(formatSignedRupiah(192_765.5)));
    await expect(canvas.getByTestId("shop-entries-withdrawn")).toHaveTextContent(norm(formatRupiah(1_700_000)));

    const withdrawal = await canvas.findByTestId("shop-entry-7101");
    await waitFor(() => expect(withdrawal).toHaveTextContent("Melati Official"));
    await expect(canvas.getByTestId("shop-entry-kind-7101")).toHaveTextContent("Withdrawal");
    await expect(canvas.getByTestId("shop-entry-amount-7101")).toHaveTextContent(norm(formatSignedRupiah(-200_000)));
    await expect(canvas.getByTestId("shop-entry-ref-7101")).toHaveTextContent("Penarikan dana ke rekening BCA");
    await expect(canvas.getByTestId("shop-entry-import-7101")).toHaveAttribute("href", "/settlement/imports/905");
    await expect(within(withdrawal).getByTestId("source-badge-importer")).toBeInTheDocument();
    // Who uploaded the statement — the name the server resolved.
    await expect(canvas.getByTestId("shop-entry-by-7101")).toHaveTextContent("Budi Santoso");
    await expect(canvas.getByTestId("shop-entry-reverse-7101")).toBeInTheDocument();

    // A ref that found no order, and one that found two live ones — named, so a person can place the money.
    await expect(canvas.getByTestId("shop-entry-ref-7102")).toHaveTextContent("Ref 241101ABCD · no order found");
    await expect(canvas.getByTestId("shop-entry-ref-7103")).toHaveTextContent("#5001, #5002");

    // A hand-posted system adjustment — a kind no order ever carries, and no statement to link.
    await expect(canvas.getByTestId("shop-entry-kind-7106")).toHaveTextContent("System adjustment");
    await expect(canvas.getByTestId("shop-entry-import-7106")).toHaveTextContent("Posted by hand");
    await expect(canvas.getByTestId("shop-entry-by-7106")).toHaveTextContent("Rina Wijaya");
    await expect(within(canvas.getByTestId("shop-entry-7106")).getByTestId("source-badge-manual")).toBeInTheDocument();

    // Newest learned first, and the 45-days-ago entry is outside the last month.
    const rows = within(canvas.getByTestId("shop-entries-table")).getAllByRole("row").slice(1);
    await expect(rows[0]).toHaveAttribute("data-testid", "shop-entry-7103");
    await expect(canvas.queryByTestId("shop-entry-7109")).toBeNull();
    await expect(canvas.getByTestId("location-search")).toHaveTextContent("");
  },
};

// a-phone-reads-each-line-as-a-block · a-phone-filters-from-a-sheet: one block per entry, every filter behind the button.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("shop-entries-page")).toHaveAttribute("data-layout", "phone");
    await expect(canvas.getByTestId("shop-entries-table")).toHaveAttribute("data-layout", "blocks");
    // The lead card first, across the row; the other two share the next.
    await expect(canvas.getByTestId("shop-entries-summary").firstElementChild).toHaveAttribute(
      "data-testid",
      "shop-entries-received-card",
    );

    const block = await canvas.findByTestId("shop-entry-7101");
    await waitFor(() => expect(block).toHaveTextContent("Melati Official"));
    await expect(block).toHaveTextContent("Withdrawal");
    await expect(block).toHaveTextContent(norm(formatSignedRupiah(-200_000)));
    await expect(canvas.getByTestId("shop-entries-filters-open")).toBeVisible();
    await expect(canvas.queryByTestId("shop-entries-kind")).toBeNull();
  },
};

export const MobileFiltersFromASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("shop-entries-filters-open"));
    const sheet = await screen.findByTestId("shop-entries-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());

    await userEvent.click(within(sheet).getByTestId("shop-entries-kind"));
    const option = await within(sheet).findByTestId("shop-entries-kind-option-withdrawal");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("2"));
    await waitFor(() => expect(canvas.getByTestId("shop-entries-filters-count")).toHaveTextContent("1"));
  },
};

// The kind filter narrows on the server, starts the totals over, and is written to the URL.
export const AKindNarrowsTheListAndTheTotals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("shop-entries-kind"));
    const option = await within(canvasElement).findByTestId("shop-entries-kind-option-withdrawal");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("2"));
    await expect(canvas.getByTestId("shop-entries-withdrawn")).toHaveTextContent(norm(formatRupiah(1_700_000)));
    await expect(canvas.getByTestId("shop-entries-received")).toHaveTextContent(norm(formatSignedRupiah(0)));
    await expect(canvas.queryByTestId("shop-entry-7102")).toBeNull();
    await expect(shopEntriesCalls.at(-1)?.filter?.settlementTypes).toEqual([SettlementType.WITHDRAWAL]);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("kind=withdrawal"));
  },
};

// report-filters-offer-closed-shops: a closed shop's entries stay reachable — offered after the open shops, badged, and
// badged on its rows.
export const AClosedShopIsOfferedBadged: Story = {
  beforeEach: () => closeShopForStory(22n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-entry-closed-7106")).toBeInTheDocument());

    const field = canvas.getByTestId("shop-entries-shop-filter");
    await userEvent.click(within(field).getByTestId("shop-select"));
    const option = await within(field).findByTestId("shop-select-option-22");
    await waitFor(() => expect(option).toBeVisible());
    await expect(within(option).getByTestId("shop-select-closed-22")).toHaveTextContent("Closed");
    const listed = within(option.closest('[role="listbox"]') as HTMLElement)
      .getAllByRole("option")
      .map((o) => o.getAttribute("data-testid"));
    await expect(listed[listed.length - 1]).toBe("shop-select-option-22");
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("1"));
    await expect(shopEntriesCalls.at(-1)?.filter?.shopId).toBe(22n);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("shop=22"));
    await expect(within(field).getByTestId("shop-select-value-closed")).toBeVisible();
  },
};

// a-lists-filters-live-in-the-url: the report's By shop row opens this list on its shop and window.
export const FiltersLiveInTheUrl: Story = {
  render: at("?shop=21&kind=fund&range=3m"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("2"), { timeout: 4000 });
    await expect(canvas.getByTestId("shop-entry-7102")).toBeInTheDocument();
    await expect(canvas.getByTestId("shop-entry-7103")).toBeInTheDocument();
    await expect(shopEntriesCalls.at(-1)?.filter).toMatchObject({ shopId: 21n, settlementTypes: [SettlementType.FUND] });
    await expect(canvas.getByTestId("shop-entries-filters-clear")).toBeInTheDocument();
  },
};

// A statement line opens the import it came from — that file's own page.
export const AnEntryOpensItsStatement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("shop-entry-import-7104"));
    await expect(await canvas.findByTestId("at-import-file")).toBeInTheDocument();
  },
};

// a-fraction-of-a-rupiah-shows-three-decimals: an exact figure, shown to its places — never fed back into a sum.
export const AFractionShowsItsPlaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("shop-entry-amount-7105")).toHaveTextContent(norm("−Rp 1.234,5"));
    await expect(canvas.getByTestId("shop-entries-received")).toHaveTextContent(norm("+Rp 192.765,5"));
  },
};

// The day an entry was learned leads; the day the platform says it belongs to shows under it when they differ.
export const TheOtherDayShowsWhenItDiffers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("shop-entry-7102")).toHaveTextContent(/for /);
    await expect(canvas.getByTestId("shop-entry-7101")).not.toHaveTextContent(/for /);
  },
};

// an-empty-list-shows-a-hint — nothing yet, and nothing matching (with its Clear Filters).
export const Empty: Story = {
  beforeEach: () => withShopEntriesBook([]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("0"), { timeout: 4000 });
    await expect(canvas.getByTestId("shop-entries-empty")).toHaveTextContent("No shop entries in this window.");
    await expect(canvas.queryByTestId("shop-entries-empty-clear")).toBeNull();
    await expect(canvas.getByTestId("shop-entries-pager")).toBeInTheDocument();
  },
};

export const NothingMatches: Story = {
  render: at("?shop=23"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("0"), { timeout: 4000 });
    await expect(canvas.getByTestId("shop-entries-empty")).toHaveTextContent("No shop entries match these filters.");
    await userEvent.click(canvas.getByTestId("shop-entries-empty-clear"));
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("8"));
  },
};

// every-list-pages-with-the-growing-pager: 25 entries — page 2 holds the last 5.
export const TheListPagesAsItGrows: Story = {
  beforeEach: () => withShopEntriesBook(longShopEntriesBook(25)),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("25"), { timeout: 4000 });
    await expect(within(canvas.getByTestId("shop-entries-table")).getAllByRole("row")).toHaveLength(21);
    await userEvent.click(canvas.getByTestId("shop-entries-pager-next"));
    await waitFor(() => expect(within(canvas.getByTestId("shop-entries-table")).getAllByRole("row")).toHaveLength(6));
    await expect(shopEntriesCalls.at(-1)?.page?.page).toBe(2);
  },
};

// The window is in JAKARTA days: at 23:30 UTC it is already tomorrow in Jakarta, and the range counts back from there.
export const TheWindowIsJakartaDays: Story = {
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    const late = new Date("2026-11-06T23:30:00Z"); // 06:30 WIB on 7 Nov
    await expect(jakartaWindowOf({ kind: "relative", days: 7 }, late)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    await expect(jakartaWindowOf({ kind: "relative", months: 1 }, late)).toEqual({ from: "2026-10-08", to: "2026-11-07" });
    await expect(jakartaWindowOf({ kind: "relative", months: 1 }, new Date("2026-03-31T03:00:00Z"))).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
    await expect(jakartaWindowOf({ kind: "absolute", from: "2026-10-01", to: "2026-10-15" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
    });
    // And the server was asked for the day the book counts from.
    await expect(shopEntriesCalls.at(-1)?.filter?.postedTo).toBe(jakartaWindowOf({ kind: "relative", months: 1 }).to);
  },
};

// a-shop-entry-reverses-inline: Reverse confirms, naming the row and its amount, then posts the opposite row on the same
// shop through the order ledger's write — the row reads Reversed, the reversal appears, and the totals move with it.
export const AReverseConfirmsAndPostsTheOpposite: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("shop-entry-reverse-7106"));

    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Reverse This Entry");
    await expect(dialog).toHaveTextContent(norm(formatSignedRupiah(-12_000)));
    await expect(dialog).toHaveTextContent("System adjustment");
    await expect(dialog).toHaveTextContent("Melati Store");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("shop-entry-reversed-7106")).toHaveTextContent("Reversed"));
    await expect(canvas.queryByTestId("shop-entry-reverse-7106")).toBeNull();
    await expect(await canvas.findByTestId("shop-entry-reversal-9000")).toHaveTextContent("Reverses #7106");
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("9"));
    await expect(canvas.getByTestId("shop-entries-received")).toHaveTextContent(norm(formatSignedRupiah(180_765.5)));

    // The order ledger's write: the opposite, same type, on the shop (order 0), keyed reverse-<id>.
    await expect(shopEntryPosts.at(-1)).toMatchObject({
      teamId: 12n,
      orderId: 0n,
      shopId: 22n,
      uniqueId: "reverse-7106",
      settlementType: SettlementType.SYSTEM_ADJUSTMENT,
      sourceType: SourceType.MANUAL,
      change: -12_000,
      reversesId: 7106n,
    });
    await expect((await screen.findAllByText("Entry #7106 reversed")).length).toBeGreaterThan(0);
  },
};

// Cancel posts nothing — the row keeps its Reverse.
export const CancellingTheConfirmPostsNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("shop-entry-reverse-7101"));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(shopEntryPosts).toHaveLength(0);
    await expect(canvas.getByTestId("shop-entry-reverse-7101")).toBeInTheDocument();
  },
};

// A row already reversed shows so and offers no second Reverse; its reversal offers none either.
export const AReversedRowOffersNoSecondReverse: Story = {
  beforeEach: () => reverseShopEntryForStory(7102n),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("shop-entries-count")).toHaveTextContent("9"), { timeout: 4000 });
    await expect(canvas.getByTestId("shop-entry-reversed-7102")).toHaveTextContent("Reversed");
    await expect(canvas.queryByTestId("shop-entry-reverse-7102")).toBeNull();
    await expect(canvas.getByTestId("shop-entry-reversal-9000")).toHaveTextContent("Reverses #7102");
    await expect(canvas.queryByTestId("shop-entry-reverse-9000")).toBeNull();
    // The two cancel out: Received is back to what it was without the 185.000.
    await expect(canvas.getByTestId("shop-entries-received")).toHaveTextContent(norm(formatSignedRupiah(7_765.5)));
  },
};

// The admin team MONITORS read-only (the-admin-team-monitors-read-only): the rows, never a Reverse.
export const TheMonitorReadsButCannotReverse: Story = {
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("shop-entry-7101")).toBeInTheDocument();
    await expect(canvas.queryByTestId("shop-entry-reverse-7101")).toBeNull();
    await expect(canvas.queryByTestId("shop-entry-reverse-7106")).toBeNull();
  },
};

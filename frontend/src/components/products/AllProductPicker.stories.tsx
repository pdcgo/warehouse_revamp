import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../.storybook/fixtures";
import { AllProductPicker, description } from "./AllProductPicker";
import type { PickedProduct } from "./ProductSelect";

// The TABBED browse. What is pinned here is what the tabs are for — a partition of the catalogue,
// and one selection that crosses between them. The dialog's own behaviour (ticks as a draft,
// Confirm/Cancel, the table columns) is pinned once in OwnProductPicker.stories.tsx.
const meta = {
  title: "Components/Products/AllProductPicker",
  component: AllProductPicker,
  parameters: {
    docs: { description: { component: description } },
    signedIn: true,
  },
  args: { teamId: teams[0]!.id, stockWarehouseId: teams[0]!.id, value: [], onChange: fn() },
} satisfies Meta<typeof AllProductPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

// Which fixture product lives on which tab. Named, because a story that crosses to a tab has to tick
// a product that is actually ON it — and the whole point of the partition is that no product is on two.
const MY_PRODUCT = products[0]!.id;       // team 11 — the caller's own catalogue
const PRIORITY_PRODUCT = products[2]!.id; // team 13 — root granted it the priority feature
const OTHER_PRODUCT = products[3]!.id;    // team 12 — an ordinary other team

export const Closed: Story = {};

// Three tabs, in browsing order. Priority sits between the two, because it is other teams' goods you
// are meant to reach for BEFORE the rest.
export const ShowsTheCatalogueTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    await expect(await screen.findByTestId("product-picker-tab-own")).toBeInTheDocument();
    await expect(await screen.findByTestId("product-picker-tab-priority")).toBeInTheDocument();
    await expect(screen.getByTestId("product-picker-tab-other")).toBeInTheDocument();
  },
};

// ⚠ THE THREE TABS ARE A PARTITION — every product on exactly one of them, none on two.
//
// The fixtures are built to prove it: 71/72 are the caller's own, 73 belongs to the PRIORITY team
// (root granted team 13 the feature), and 74 belongs to an ordinary other team. Each tab must show
// its one product and neither of the others'.
export const TheThreeTabsPartitionTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const own = MY_PRODUCT;
    const priority = PRIORITY_PRODUCT;
    const other = OTHER_PRODUCT;

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    // MY PRODUCT
    await waitFor(async () => {
      await expect(screen.getByTestId(`product-picker-option-${own}`)).toBeInTheDocument();
      await expect(screen.queryByTestId(`product-picker-option-${priority}`)).toBeNull();
      await expect(screen.queryByTestId(`product-picker-option-${other}`)).toBeNull();
    });

    // PRIORITY PRODUCT — only the granted team's.
    await userEvent.click(screen.getByTestId("product-picker-tab-priority"));
    await waitFor(async () => {
      await expect(screen.getByTestId(`product-picker-option-${priority}`)).toBeInTheDocument();
      await expect(screen.queryByTestId(`product-picker-option-${own}`)).toBeNull();
      await expect(screen.queryByTestId(`product-picker-option-${other}`)).toBeNull();
    });

    // OTHER PRODUCT — the complement, and crucially NOT the priority team's. This is the half that
    // breaks if the two tabs ever stop being driven by the same id list.
    await userEvent.click(screen.getByTestId("product-picker-tab-other"));
    await waitFor(async () => {
      await expect(screen.getByTestId(`product-picker-option-${other}`)).toBeInTheDocument();
      await expect(screen.queryByTestId(`product-picker-option-${priority}`)).toBeNull();
      await expect(screen.queryByTestId(`product-picker-option-${own}`)).toBeNull();
    });
  },
};

// ⚠ THE RULE THE TABS EXIST INSIDE ONE DIALOG FOR. A tick is a set of ids, not a filter over the
// loaded page, so it survives crossing a tab exactly as it survives paging and searching. Three
// sibling picker components would be three dialogs, and the selection would die on every crossing.
export const TicksSurviveCrossingATab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const mine = await screen.findByTestId(`product-picker-option-${MY_PRODUCT}`);
    await waitFor(() => expect(mine).toBeVisible());
    await userEvent.click(within(mine).getByRole("checkbox"));
    await expect(within(mine).getByRole("checkbox")).toBeChecked();

    // Cross to the other catalogue and tick one there too.
    await userEvent.click(screen.getByTestId("product-picker-tab-other"));

    const theirs = await screen.findByTestId(`product-picker-option-${OTHER_PRODUCT}`);
    await waitFor(() => expect(theirs).toBeVisible());
    await userEvent.click(within(theirs).getByRole("checkbox"));
    await expect(within(theirs).getByRole("checkbox")).toBeChecked();

    // ⚠ "BOTH ARE HELD" is asserted by ConfirmEmitsPicksFromEveryTab, not here. With the tick count
    // gone from the dialog, nothing on screen states the size of the set — the only place the whole
    // draft is observable is what Confirm emits. What THIS story can still prove is the half that
    // matters most: crossing back finds the first one still ticked.
    await userEvent.click(screen.getByTestId("product-picker-tab-own"));

    await waitFor(async () => {
      const back = screen.getByTestId(`product-picker-option-${MY_PRODUCT}`);
      await expect(within(back).getByRole("checkbox")).toBeChecked();
    });
  },
};

// Confirm emits the whole ticked set ACROSS tabs in one go — the caller gets one list, not one per
// catalogue, because it only ever asked one question.
export const ConfirmEmitsPicksFromEveryTab: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const mine = await screen.findByTestId(`product-picker-option-${MY_PRODUCT}`);
    await waitFor(() => expect(mine).toBeVisible());
    await userEvent.click(within(mine).getByRole("checkbox"));

    await userEvent.click(screen.getByTestId("product-picker-tab-other"));

    const theirs = await screen.findByTestId(`product-picker-option-${OTHER_PRODUCT}`);
    await waitFor(() => expect(theirs).toBeVisible());
    await userEvent.click(within(theirs).getByRole("checkbox"));

    await userEvent.click(screen.getByTestId("product-picker-confirm"));

    // Sorted with an explicit comparator: the default `.sort()` compares STRINGIFIED values, which
    // orders bigints lexically and would pass or fail on digit count rather than on the ids.
    const byId = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

    await waitFor(() => {
      const picked = (args.onChange.mock.calls.at(-1)?.[0] ?? []) as PickedProduct[];
      expect(picked.map((p) => p.id).sort(byId)).toEqual([MY_PRODUCT, OTHER_PRODUCT].sort(byId));
    });
  },
};

// ONLY "OTHER PRODUCT" CARRIES THE OWNER-TEAM FILTER (owner).
//
// My Product is already one team's catalogue, so a team control there could narrow it to itself or to
// nothing. Priority Product is already a narrowing BY TEAM — the handful root has granted the feature
// — so a team control over the top of it is a filter on a filter, over a set small enough to read.
// Other is the only tab whose team list is open-ended, and therefore the only one worth narrowing.
export const OnlyTheOtherTabCarriesTheTeamFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    await expect(screen.queryByTestId("product-picker-filters")).toBeNull();

    await userEvent.click(await screen.findByTestId("product-picker-tab-priority"));
    await waitFor(async () => await expect(screen.queryByTestId("product-picker-filters")).toBeNull());

    await userEvent.click(screen.getByTestId("product-picker-tab-other"));
    await expect(await screen.findByTestId("product-picker-filters")).toBeInTheDocument();
  },
};

// ⚠ THE FILTER DOES NOT FOLLOW YOU — and this rule is NOT COVERED BY A STORY. Recorded here so the
// gap is deliberate rather than an oversight.
//
// `ownerTeamId` is sent by the tab that OWNS the control and by no other. It used to be applied to
// both discover tabs, which was invisible while both showed the control and became a trap the moment
// one stopped: narrow Other to a team, cross to Priority, and Priority would be filtered by a control
// it no longer displays. A filter you cannot see is a filter you cannot clear.
//
// It cannot be exercised here because the control cannot be OPERATED inside the dialog at all:
// TeamSelect wraps its listbox in a <Portal>, so it renders outside the Dialog's focus trap and the
// options are inert — the same failure ShopSelect carries an explicit "No Portal on purpose" comment
// about, for exactly this reason. That is a real bug in the Other tab's filter, older than these tabs,
// and fixing it is a change to a SHARED component rather than to this picker.

// ── A REAL CATALOGUE ────────────────────────────────────────────────────────────────────────────
//
// A tab with FORTY-FIVE products (team 15's catalogue, plus the one other-team product) — the only
// way to see what this dialog does when the warehouse is not a four-row fixture. Page 1 is FULL and
// page 5 is SHORT, which is the pair of states the panel's height has to survive.
const OTHER_TAB_TOTAL = products.filter((p) => p.teamId !== teams[0]!.id && p.teamId !== teams[2]!.id).length;
const PAGE_SIZE = 10;
const LAST_PAGE = Math.ceil(OTHER_TAB_TOTAL / PAGE_SIZE);

/** Open the dialog on the big catalogue, with page 1 loaded. */
async function openOtherTab(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("product-picker-trigger"));
  await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

  await userEvent.click(await screen.findByTestId("product-picker-tab-other"));
  await waitFor(() => {
    expect(screen.getAllByTestId(/^product-picker-option-/)).toHaveLength(PAGE_SIZE);
  });
}

export const ManyProducts: Story = {
  play: async ({ canvasElement }) => {
    await openOtherTab(canvasElement);

    // A pager, which only renders when the list genuinely does not fit on one page.
    await expect(screen.getByTestId("pagination")).toBeVisible();

    // THE SHORT LAST PAGE. 45 products over pages of ten leaves five on page 5, so the dialog is
    // asked to hold two very different row counts in one sitting.
    for (let i = 1; i < LAST_PAGE; i += 1) {
      await userEvent.click(screen.getByTestId("page-next"));
    }

    await waitFor(() => {
      expect(screen.getAllByTestId(/^product-picker-option-/)).toHaveLength(
        OTHER_TAB_TOTAL % PAGE_SIZE || PAGE_SIZE,
      );
    });
  },
};

// ⚠ THE OVERFLOW IS IN THE TABLE AND NOWHERE ELSE (owner).
//
// The dialog is a fixed panel: the tabs, the team filter, the search box, the tick count and the pager
// are PINNED, and the rows are the one thing that scrolls. Before this, `scrollBehavior="inside"` gave
// the whole body a single scrollbar — so reading row ten meant the search box that produced it had
// scrolled off the top, and turning the page meant scrolling down to find the pager first.
export const OnlyTheTableScrolls: Story = {
  play: async ({ canvasElement }) => {
    await openOtherTab(canvasElement);

    const dialog = screen.getByTestId("product-picker-dialog");
    const body = screen.getByTestId("product-picker-body");
    const scroll = screen.getByTestId("product-picker-scroll");

    // The rows overflow — otherwise everything below passes for the wrong reason.
    await expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);

    // …and NOTHING ELSE does. The body divides its height between pinned chrome and the rows box; if
    // the chrome were still in the scroll flow this is where it would spill (and, being
    // `overflow: hidden` now, be CLIPPED rather than reachable — the worse of the two failures).
    await expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);

    // Scroll the rows to the very bottom and the pager is still where it was — inside the dialog,
    // not pushed past its edge.
    scroll.scrollTop = scroll.scrollHeight;
    await waitFor(() => expect(scroll.scrollTop).toBeGreaterThan(0));

    await expect(screen.getByTestId("pagination").getBoundingClientRect().bottom).toBeLessThanOrEqual(
      dialog.getBoundingClientRect().bottom + 1,
    );
    await expect(screen.getByTestId("product-picker-search")).toBeVisible();

    // A NEW PAGE IS SHOWN FROM ITS FIRST ROW. The browser keeps a container's scrollTop across a
    // content swap, so without the reset page 2 opens halfway down — which reads as a list that
    // starts at row six.
    await userEvent.click(screen.getByTestId("page-next"));

    await waitFor(() => expect(scroll.scrollTop).toBe(0));
  },
};

// A search is a question about products, not about a tab, so it stays put when you cross — the term
// is re-run against the new catalogue rather than cleared. Clearing it would make "is this on the
// other tab?" a retype every time, which is the most common reason to cross at all.
export const TheSearchTermSurvivesCrossingATab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    // "Gula" is the PRIORITY team's product — absent from My Product, present on Priority Product.
    await userEvent.type(screen.getByTestId("product-picker-search"), "Gula", { delay: 40 });

    await waitFor(async () => await expect(screen.getByTestId("product-picker-empty")).toBeInTheDocument());

    await userEvent.click(await screen.findByTestId("product-picker-tab-priority"));

    await expect(screen.getByTestId("product-picker-search")).toHaveValue("Gula");
    await waitFor(async () =>
      await expect(screen.getByTestId(`product-picker-option-${PRIORITY_PRODUCT}`)).toBeInTheDocument(),
    );
  },
};

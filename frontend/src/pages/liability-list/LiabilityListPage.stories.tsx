import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { liabilityPositions, teams } from "../../../.storybook/fixtures";
import { LiabilityListPage } from "./index";

const WAREHOUSE = teams.find((t) => t.id === 11n)!; // the creditor, watching its debtors

const Routed = routedPage(
  [
    { path: "/liability", element: <LiabilityListPage /> },
    marker("/liability/:counterpartyId", "at-pair-detail"),
  ],
  "/liability",
);

const meta = {
  title: "Pages/Liability/PairList",
  component: LiabilityListPage,
  render: () => <Routed />,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(WAREHOUSE.id),
} satisfies Meta<typeof LiabilityListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("liability-table")).toBeInTheDocument(), {
    timeout: 3000,
  });
  return canvas;
}

// §Frontend Requirements 1 and 2 are ONE SCREEN (the-summary-is-tiles-on-the-list): the tiles
// summarise, the rows below are what they summarise.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("liability-total-payable")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-table")).toBeInTheDocument();
  },
};

// ⛔ THE BUG THIS RETIRES. The tiles used to be a `rows.reduce` over the loaded page, so a creditor
// with more counterparties than fit on a page read a headline that silently omitted the rest — and
// the "total" changed as they paged. It looked right while being wrong.
//
// The whole set is 8.7m + 1m + 6.2m + 250k = 16.15m receivable, and every page must say so.
export const TheSummaryIsTheWholeSetNotThePage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const whole = liabilityPositions.reduce((s, p) => (p.balance > 0n ? s + p.balance : s), 0n);

    // The tile reads the SERVER's number. Asserting on the fixture total rather than on a formatted
    // string keeps this a statement about the arithmetic, not about the locale.
    const receivable = canvas.getByText(
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      })
        .format(Number(whole))
        .replace(/ /g, " "),
    );

    await expect(receivable).toBeInTheDocument();
  },
};

// §About Thresholds 1 — *"there is warning on the balance screen … if thresholds 80% reached"*.
//
// ⚠ WORDED FROM THE CREDITOR'S SIDE, because this is their screen: they are watching debtors approach
// limits THEY set. Team 12 owes 8.7m against a 10m limit — 87%.
export const ADebtorNearItsLimitIsBadged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const badge = await canvas.findByTestId("liability-near-limit-12");
    await expect(badge).toHaveTextContent("87%");
  },
};

// ⚠ THE BADGE IS ONLY FOR A REAL CEILING, and the three limit states are why. Team 13 is FROZEN
// (limit 0) and team 15 has no row at all, inheriting the DEFAULT — which is unlimited. A percentage
// of zero is a division by zero and a percentage of unlimited is not a number, so neither is badged.
export const FrozenAndUnlimitedTeamsAreNotBadged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Team 14 IS over its limit (6.2m against 5m), so the screen is definitely rendering badges.
    await expect(await canvas.findByTestId("liability-near-limit-14")).toBeInTheDocument();

    await expect(canvas.queryByTestId("liability-near-limit-13")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("liability-near-limit-15")).not.toBeInTheDocument();
  },
};

// THE DEFAULT ROW'S ONLY HOME (the-default-terms-row-is-a-dialog-on-the-list). `counterparty_id = 0`
// is not a pair, so no `/liability/:counterpartyId` page can ever show it — and deleting the terms
// LIST left it settable nowhere in the running app at all.
export const TheDefaultTermsRowIsEditableFromTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("liability-default-terms"));

    // The counterparty is PINNED, not picked — the dialog shows the default row rather than a
    // dropdown that could quietly set one real team's terms instead.
    const fixed = await screen.findByTestId("terms-counterparty-fixed");
    await expect(fixed).toBeInTheDocument();
    await expect(screen.queryByTestId("terms-counterparty")).not.toBeInTheDocument();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { LiabilityDetailPage } from "./index";

const WAREHOUSE = teams.find((t) => t.id === 11n)!; // the creditor
const COUNTERPARTY = 12n; //                            Toko Melati, the debtor at 87% of its limit

// The page reads `:counterpartyId` from the route and navigates back to the list, so it needs a real
// router — built once at module scope, or every re-render would reset the history.
const Routed = routedPage(
  [
    { path: "/liability/:counterpartyId", element: <LiabilityDetailPage /> },
    marker("/liability", "at-liability-list"),
  ],
  `/liability/${COUNTERPARTY}`,
);

const meta = {
  title: "Pages/Liability/PairDetail",
  component: LiabilityDetailPage,
  render: () => <Routed />,
  parameters: {
    signedIn: true,
    // The page mounts its own data router, so preview.tsx must stand its MemoryRouter down.
    dataRouter: true,
  },
  beforeEach: asTeam(WAREHOUSE.id),
} satisfies Meta<typeof LiabilityDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("liability-detail-page")).toBeInTheDocument(), {
    timeout: 3000,
  });
  return canvas;
}

// The three things `team_balance_design.md` §Detail Pair Team Balance asks this page for.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 1. "Its show general summarize" — the pair's position, split into the two directions. Never a
    //    bare signed number: direction is words and separate figures.
    await expect(canvas.getByTestId("liability-detail-balance")).toBeInTheDocument();

    // 3. "its show change balance log" — the ledger, in its four cuts.
    await expect(canvas.getByTestId("liability-detail-tab-receivable")).toBeInTheDocument();
    await expect(canvas.getByTestId("liability-detail-tab-payable")).toBeInTheDocument();

    // 2. "Its show change limit history log" — the NEW tab, and a different kind of log entirely.
    await expect(canvas.getByTestId("liability-detail-tab-limits")).toBeInTheDocument();
  },
};

// ⚠ THE TWO LOGS ARE DIFFERENT KINDS OF THING and must not merge: the entry tabs are money that
// MOVED, the limit tab is a RULE that changed. They share a page because somebody asking "why is
// this team blocked" needs both — and they have different grains, so only one of them is a ledger.
export const TheLimitLogIsSeparateFromTheLedger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The ledger tab first: entries carry an amount and a running balance.
    await expect(canvas.getByTestId("liability-detail-receivable")).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId("liability-detail-tab-limits"));

    // The limit log carries old → new limits and a reason. Fixture change 2 is the one on this pair
    // that SET a ceiling where there had been none: unlimited → 10.000.000.
    await waitFor(() => expect(canvas.getByTestId("terms-history")).toBeInTheDocument(), {
      timeout: 3000,
    });
    await expect(canvas.getByTestId("terms-change-2")).toHaveTextContent(/unlimited/i);

    // And the override — a limit lifted by somebody outside the creditor team — is marked as one.
    await expect(canvas.getByTestId("terms-override-3")).toBeInTheDocument();
  },
};

// The log is filtered to THIS pair. A per-pair page showing every team's limit changes would be
// reporting somebody else's negotiation on this counterparty's record.
export const TheLimitLogIsScopedToThisPair: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("liability-detail-tab-limits"));

    await waitFor(() => expect(canvas.getByTestId("terms-history-table")).toBeInTheDocument(), {
      timeout: 3000,
    });

    // Changes 2 and 3 are this pair's. Change 4 belongs to team 13 and change 1 to team 14.
    await expect(canvas.getByTestId("terms-change-2")).toBeInTheDocument();
    await expect(canvas.queryByTestId("terms-change-4")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("terms-change-1")).not.toBeInTheDocument();
  },
};

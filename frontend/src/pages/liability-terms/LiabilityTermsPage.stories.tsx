import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { liabilityPositions, liabilityTerms, teams } from "../../../.storybook/fixtures";
import { LiabilityTermsPage } from "./index";

// The CREDITOR. A warehouse, because a warehouse is who carries the credit risk here — it fronts
// courier money and charges handling fees, and the selling teams are the ones running a balance.
const WAREHOUSE = teams.find((t) => t.id === 11n)!;

// The four rows the fixture is built around, named so an assertion reads as the rule it is checking.
const DEFAULT_ROW = 0n; // unlimited — the house rule every other row is an exception to
const NEAR = 12n; //       10.000.000 limit against 8.700.000 owed → 87%, the warning
const FROZEN = 13n; //     limit 0 → no credit at all, the OPPOSITE of the default row
const OVER = 14n; //       5.000.000 limit against 6.200.000 owed → 124%

const meta = {
  title: "Pages/Liability/CreditTerms",
  component: LiabilityTermsPage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team everywhere.
    signedIn: true,
  },
  beforeEach: asTeam(WAREHOUSE.id),
} satisfies Meta<typeof LiabilityTermsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("terms-table")).toBeInTheDocument(), {
    timeout: 3000,
  });
  return canvas;
}

// THE SCREEN, with all three limit states on it at once. That is the point of the fixture: a table
// showing only "a number" would prove nothing about the design, because the whole design is keeping
// absent, zero and a ceiling apart.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const id of [DEFAULT_ROW, NEAR, FROZEN, OVER]) {
      await expect(canvas.getByTestId(`terms-row-${id}`)).toBeInTheDocument();
    }

    // Team 15 trades with this warehouse and has NO terms row — it belongs in the "set terms"
    // options, not in the table. A screen that invented a row for it would be showing a limit
    // nobody set.
    await expect(canvas.queryByTestId("terms-row-15")).not.toBeInTheDocument();
  },
};

// ⚠ THE RULE THIS SCREEN EXISTS FOR: absent and 0 are OPPOSITES.
//
// The default row has no limit — unlimited. Team 13's limit is 0 — frozen, no credit at all. If the
// two ever render the same way, the day somebody freezes a team they will instead have granted it
// infinite credit, and nothing on the screen would say so.
export const UnlimitedAndFrozenAreOpposites: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const unlimited = canvas.getByTestId(`terms-meter-${DEFAULT_ROW}`);
    const frozen = canvas.getByTestId(`terms-meter-${FROZEN}`);

    await expect(unlimited).toHaveTextContent(/unlimited/i);
    await expect(frozen).toHaveTextContent(/frozen/i);
    await expect(unlimited.textContent).not.toEqual(frozen.textContent);

    // And neither draws a bar: a percentage of unlimited is not a number, and a percentage of zero
    // is a division by zero. Both would render as "0%" or "100%" and invert the screen's meaning.
    await expect(canvas.queryByTestId(`terms-meter-${DEFAULT_ROW}-pct`)).not.toBeInTheDocument();
    await expect(canvas.queryByTestId(`terms-meter-${FROZEN}-pct`)).not.toBeInTheDocument();
  },
};

// The 80% warning — the decision that made the BLOCK stop being the notification. Before it, the
// first person to learn a team was over its limit was customer service, mid-order, with a customer
// waiting.
export const TheWarningFiresAtEightyPercent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // 8.700.000 of 10.000.000 → 87%, so the badge is up while there is still room to trade.
    await expect(canvas.getByTestId(`terms-meter-${NEAR}-pct`)).toHaveTextContent("87%");
    await expect(canvas.getByTestId(`terms-meter-${NEAR}-warn`)).toHaveTextContent(/near limit/i);

    // 6.200.000 of 5.000.000 → over, and it says so rather than pinning quietly at 100%.
    await expect(canvas.getByTestId(`terms-meter-${OVER}-warn`)).toHaveTextContent(/over limit/i);

    // The tile counts BOTH of them: "near limit" is at 80% OR MORE, so a team already over is not
    // silently dropped from the number a manager reads first.
    await expect(canvas.getByTestId("terms-tile-near")).toHaveTextContent("2");
    await expect(canvas.getByTestId("terms-tile-frozen")).toHaveTextContent("1");
    await expect(canvas.getByTestId("terms-tile-unlimited")).toHaveTextContent("1");
  },
};

// The limit is a THREE-WAY CHOICE, not a number field — the amount input only exists once a ceiling
// is chosen, so a blank field can never be saved as 0.
export const TheLimitIsAThreeWayChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`terms-actions-${NEAR}`));
    // The menu portals, so it is found on `screen` rather than in the canvas.
    const edit = await screen.findByTestId(`terms-edit-${NEAR}`);
    await waitFor(() => expect(edit).toBeVisible());
    await userEvent.click(edit);

    const capped = await screen.findByTestId("terms-limit-capped");
    await waitFor(() => expect(capped).toBeVisible());

    // Team 12 has a real ceiling, so the dialog opens on "capped" with the amount showing.
    await expect(screen.getByTestId("terms-limit-amount")).toBeInTheDocument();

    // Choose Unlimited and the amount field GOES — there is no number to type, and leaving one on
    // screen is how a person ends up saving 0 while believing they removed the cap.
    await userEvent.click(screen.getByTestId("terms-limit-unlimited"));
    await waitFor(() =>
      expect(screen.queryByTestId("terms-limit-amount")).not.toBeInTheDocument(),
    );

    // Frozen has no amount either — 0 is the whole value.
    await userEvent.click(screen.getByTestId("terms-limit-frozen"));
    await expect(screen.queryByTestId("terms-limit-amount")).not.toBeInTheDocument();
  },
};

// Saving writes through the real query hook and the real adapter, and the row re-reads.
export const FreezingATeamShowsOnTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`terms-meter-${NEAR}`)).toHaveTextContent("87%");

    await userEvent.click(canvas.getByTestId(`terms-actions-${NEAR}`));
    const edit = await screen.findByTestId(`terms-edit-${NEAR}`);
    await waitFor(() => expect(edit).toBeVisible());
    await userEvent.click(edit);

    const frozen = await screen.findByTestId("terms-limit-frozen");
    await waitFor(() => expect(frozen).toBeVisible());
    await userEvent.click(frozen);
    await userEvent.click(screen.getByTestId("terms-submit"));

    // The row now reads FROZEN — not "0", and not an empty cell.
    await waitFor(
      () => expect(canvas.getByTestId(`terms-meter-${NEAR}`)).toHaveTextContent(/frozen/i),
      { timeout: 3000 },
    );
    await expect(canvas.getByTestId("terms-tile-frozen")).toHaveTextContent("2");
  },
};

// Removing terms RAISES the ceiling to unlimited — the only way to express "no limit" once one is
// set — so it is the most consequential write on the screen and it confirms first.
export const RemovingTermsConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`terms-actions-${OVER}`));
    const remove = await screen.findByTestId(`terms-remove-${OVER}`);
    await waitFor(() => expect(remove).toBeVisible());
    await userEvent.click(remove);

    // A confirm dialog, and it says what the removal DOES rather than asking "are you sure".
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent(/unlimited/i);

    // The row is still there — nothing was removed by opening the dialog.
    await expect(canvas.getByTestId(`terms-row-${OVER}`)).toBeInTheDocument();
  },
};

// The change log. It is on the page rather than behind a dialog because it is the only record that
// survives a raise: a team at 87% whose limit doubles drops to 43% and the warning simply vanishes.
export const TheChangeLogSurvivesARaise: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("terms-history-table")).toBeInTheDocument(), {
      timeout: 3000,
    });

    // An override — a write by somebody outside the creditor team — is marked as one, with its
    // reason. That is what makes it distinguishable from the creditor changing its own mind.
    await expect(canvas.getByTestId("terms-override-3")).toBeInTheDocument();
    await expect(canvas.getByTestId("terms-change-3")).toHaveTextContent(/ramadan/i);

    // ⚠ Change 3 removed a cap: 5.000.000 → unlimited. Change 4 froze a team: unlimited → 0. The two
    // rows must not read the same, which is exactly what an integer column would have made them.
    await expect(canvas.getByTestId("terms-change-3")).toHaveTextContent(/unlimited/i);
    await expect(canvas.getByTestId("terms-change-4")).toHaveTextContent(/frozen/i);
  },
};

// Picking one team narrows the log to it, and the way back is offered — a filtered log with no exit
// reads as an empty history for everybody else.
export const TheLogNarrowsToOneTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("terms-history-table")).toBeInTheDocument(), {
      timeout: 3000,
    });

    await userEvent.click(canvas.getByTestId(`terms-actions-${FROZEN}`));
    const history = await screen.findByTestId(`terms-history-${FROZEN}`);
    await waitFor(() => expect(history).toBeVisible());
    await userEvent.click(history);

    await waitFor(() =>
      expect(canvas.queryByTestId("terms-change-3")).not.toBeInTheDocument(),
    );
    await expect(canvas.getByTestId("terms-change-4")).toBeInTheDocument();
    await expect(canvas.getByTestId("terms-history-all")).toBeInTheDocument();
  },
};

// A sanity check on the fixture itself: the screen's numbers come from two RPCs lined up on the
// client, and a story that agreed with a mistake in the fixture would pass for the wrong reason.
export const FixtureIsConsistent: Story = {
  play: async () => {
    const near = liabilityTerms.find((x) => x.counterpartyId === NEAR)!;
    const debt = liabilityPositions.find((p) => p.counterpartyId === NEAR)!.balance;
    await expect(Number((debt * 100n) / near.creditLimit!)).toBe(87);
  },
};

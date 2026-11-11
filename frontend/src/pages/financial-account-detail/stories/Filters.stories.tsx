import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { FinancialAccountChangeType as T } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { FinancialAccountDetailPage } from "../index";
import { ACCOUNT_DETAIL_META, BCA_OPS, loaded } from "./kit";

// ACCOUNT DETAIL — the statement's types and window — several types, the URL, and a phone's sheet. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Account/Filters",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Mobile: the type and the window open from the Filter button, full width, in a bottom sheet.
export const MobileFiltersAreASheet: Story = {
  name: "Phone · filter sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await userEvent.click(canvas.getByTestId("account-log-filters-open"));
    const sheet = await screen.findByTestId("account-log-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("account-log-type-filter")).toBeVisible();
    await expect(within(sheet).getByTestId("account-log-range")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("account-log-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("account-log-filters-sheet")).toBeNull());
  },
};

// SEVERAL TYPES AT ONCE (owner, `the-statement-filters-several-types`) — a search select: typing narrows the nine, each
// option is the type's own badge, and the picks sit in the field as the same badges, four at most and "+N" past that.
// Expense + Ads is "what did we spend": BCA Operasional's packing material and its Shopee ads top-up.
export const TheStatementFiltersSeveralTypes: Story = {
  name: "Several types",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);
    const rows = () => within(canvas.getByTestId("account-log-table")).getAllByRole("row");
    const height = (testId: string) => Math.round(canvas.getByTestId(testId).getBoundingClientRect().height);

    // It starts at the date field's height — the recipe's own input minimum made it 42 against the date's 36.
    await expect(height("account-log-type-field")).toBe(height("account-log-range"));

    // Typing narrows the list to what matches.
    await userEvent.click(canvas.getByTestId("account-log-type-filter"));
    await userEvent.type(canvas.getByTestId("account-log-type-filter"), "Expense", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`account-log-type-option-${T.WITHDRAWAL}`)).toBeNull());
    const expense = await canvas.findByTestId(`account-log-type-option-${T.EXPENSE}`);
    await waitFor(() => expect(expense).toBeVisible());
    await userEvent.click(expense);

    // A pick starts the list over, and the panel stays open for the next one.
    const ads = await canvas.findByTestId(`account-log-type-option-${T.ADS_EXPENSE}`);
    await waitFor(() => expect(ads).toBeVisible());
    await userEvent.click(ads);
    await waitFor(() => expect(rows()).toHaveLength(1 + 2));

    // The picks are badges in the field, in the statement's colours.
    await expect(canvas.getByTestId(`account-log-type-chip-${T.EXPENSE}`)).toHaveTextContent("Expense");
    await expect(canvas.getByTestId(`account-log-type-chip-${T.ADS_EXPENSE}`)).toHaveTextContent("Ads");

    // Two picks still fit one line, at the field's height.
    await expect(height("account-log-type-field")).toBe(height("account-log-range"));

    // Four badges at most; the fifth and after are "+N".
    for (const c of [T.WITHDRAWAL, T.RESTOCK, T.TRANSFER]) {
      const option = canvas.getByTestId(`account-log-type-option-${c}`);
      await waitFor(() => expect(option).toBeVisible());
      await userEvent.click(option);
    }
    await waitFor(() => expect(canvas.getByTestId("account-log-type-more")).toHaveTextContent("+1"));
    await expect(within(canvas.getByTestId("account-log-type-picks")).getAllByTestId(/^account-log-type-chip-/)).toHaveLength(4);

    // The × and the ⌄ are not in the box the picks wrap in — they hold the field's right edge.
    const picks = canvas.getByTestId("account-log-type-picks");
    const indicators = canvas.getByTestId("account-log-type-indicators");
    await expect(picks.contains(indicators)).toBe(false);
    await expect(indicators.getBoundingClientRect().left).toBeGreaterThanOrEqual(picks.getBoundingClientRect().right);

    // A pick is taken back by its ✓ in the list; Clear takes the rest.
    for (const c of [T.WITHDRAWAL, T.RESTOCK, T.TRANSFER, T.ADS_EXPENSE]) {
      await userEvent.click(canvas.getByTestId(`account-log-type-option-${c}`));
    }
    await waitFor(() => expect(rows()).toHaveLength(1 + 1));
    await expect(canvas.queryByTestId(`account-log-type-chip-${T.ADS_EXPENSE}`)).toBeNull();
    await expect(canvas.queryByTestId("account-log-type-more")).toBeNull();

    await userEvent.click(canvas.getByTestId("account-log-filters-clear"));
    await waitFor(() => expect(canvas.queryByTestId(`account-log-type-chip-${T.EXPENSE}`)).toBeNull());
    await waitFor(() => expect(rows().length).toBeGreaterThan(1 + 2));
  },
};

// The statement filters by type — Withdrawal leaves the three withdrawals.
export const FilterTheStatementByType: Story = {
  name: "By type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await userEvent.click(canvas.getByTestId("account-log-type-filter"));
    const withdrawal = await canvas.findByTestId(`account-log-type-option-${T.WITHDRAWAL}`);
    await waitFor(() => expect(withdrawal).toBeVisible());
    await userEvent.click(withdrawal);

    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 3));
  },
};

// THE STATEMENT'S FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the types are read from
// it; a window picked is written back beside them.
const AtFilteredUrl = routedPage(
  [{ path: "/financial-accounts/:accountId", element: <><FinancialAccountDetailPage /><LocationProbe /></> }],
  `/financial-accounts/${BCA_OPS.id}?types=${T.WITHDRAWAL}`,
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId(`account-log-type-chip-${T.WITHDRAWAL}`)).toHaveTextContent("Withdrawal");
    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 3));

    await userEvent.click(canvas.getByTestId("account-log-range"));
    const week = await screen.findByTestId("account-log-range-quick-7");
    await waitFor(() => expect(week).toBeVisible());
    await userEvent.click(week);
    await waitFor(() => expect(location).toHaveTextContent("range=7d"));
    await expect(location).toHaveTextContent(`types=${T.WITHDRAWAL}`);
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { FinancialAccountType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { FinancialAccountsPage } from "../index";
import { ACCOUNTS_META, BCA_GAJI, BCA_OPS, SHOPEEPAY, UNKNOWN, loaded, rowIds } from "./kit";

// ACCOUNTS — the type tabs, the search, the shop and the options panel — the URL, and a phone's sheet. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Accounts/Filters",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Mobile: the shop, Operational only and the sort open from the Filter button, full width — the sort a select
// there, because a phone has no column headings to press.
export const MobileFiltersAreASheet: Story = {
  name: "Phone · filter sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-filters-open"));
    const sheet = await screen.findByTestId("account-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("account-shop-filter")).toBeVisible();
    await expect(within(sheet).getByTestId("account-operational-only")).toBeVisible();
    await expect(within(sheet).getByTestId("account-sort-select")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("account-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("account-filters-sheet")).toBeNull());
  },
};

/**
 * THE TYPE IS A TAB ROW, AND ITS CARD LEADS (owner, `the-accounts-type-is-a-tab-row`,
 * `the-total-leads-until-a-type-is-picked`) — Total saldo leads until a type is picked; then that type's card
 * does, and the table holds only that type.
 */
export const TheTypeTabNarrowsAndLeads: Story = {
  name: "Type tab",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-total-team")).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("account-total-team")).toHaveTextContent("Total balance");
    // The whole first, then what it is made of (the-total-saldo-comes-first).
    await expect(canvas.getByTestId("account-totals").firstElementChild).toHaveAttribute("data-testid", "account-total-team");

    const tab = canvas.getByTestId(`account-type-tab-${FinancialAccountType.UNKNOWN}`);
    await userEvent.click(tab);
    // The picked tab in the main tone — rose-700 text (a-selected-tab-is-in-the-main-tone).
    await waitFor(() => expect(getComputedStyle(tab).color).toBe("rgb(190, 18, 60)"));

    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_OPS.id}`)).toBeNull());
    await expect(canvas.getByTestId(`account-row-${UNKNOWN.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}`)).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("account-total-team")).not.toHaveAttribute("data-emphasis");

    await userEvent.click(canvas.getByTestId("account-type-tab-all"));
    await waitFor(() => expect(canvas.getByTestId("account-total-team")).toHaveAttribute("data-emphasis"));
  },
};

/**
 * EVERY FILTER THE CONTRACT HAS (owner, `the-accounts-list-has-every-filter-the-contract-has`) — the search,
 * the type, the shop, operational only, and archived; Clear resets them all.
 */
export const EveryFilterTheContractHas: Story = {
  name: "Every filter",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-search")).toBeVisible();
    await expect(canvas.getByTestId("account-type-tabs")).toBeVisible();
    await expect(canvas.getByTestId("account-shop-filter")).toBeVisible();

    // Operational only and archived live in ONE panel behind its own trigger
    // (operational-and-archived-share-one-filter-panel).
    await userEvent.click(canvas.getByTestId("account-options-trigger"));
    const operational = await screen.findByText("Operational only");
    await waitFor(() => expect(operational).toBeVisible());
    await userEvent.click(operational);
    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_GAJI.id}`)).toBeNull());
    await expect(canvas.getByTestId("account-options-count")).toHaveTextContent("1");
    for (const id of rowIds(canvas)) {
      await expect(canvas.getByTestId(`account-operational-${id}`)).toBeVisible();
    }

    await userEvent.click(canvas.getByTestId("account-filters-clear"));
    await waitFor(() => expect(canvas.getByTestId(`account-row-${BCA_GAJI.id}`)).toBeVisible());
  },
};

// THE FILTERS, THE TYPE TAB AND THE SORT LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the search
// and the type tab are read from it; a sort is written back beside them; and the archive's own `view` key is set
// without wiping them — it drops only the type, as the archive starts at every type.
const AtFilteredUrl = routedPage(
  [{ path: "/financial-accounts", element: <><FinancialAccountsPage /><LocationProbe /></> }],
  `/financial-accounts?q=bca&type=${FinancialAccountType.BANK_ACCOUNT}`,
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    await expect(canvas.getByTestId("account-search")).toHaveValue("bca");
    await expect(canvas.getByTestId(`account-type-tab-${FinancialAccountType.BANK_ACCOUNT}`)).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByTestId(`account-row-${SHOPEEPAY.id}`)).toBeNull();

    await userEvent.click(canvas.getByTestId("account-sort-name"));
    await waitFor(() => expect(location).toHaveTextContent(/sort=name(%3A|:)asc/));

    await userEvent.click(canvas.getByTestId("open-archived-accounts"));
    await waitFor(() => expect(location).toHaveTextContent("view=archived"));
    await expect(location).toHaveTextContent("q=bca");
    await expect(location).toHaveTextContent(/sort=name(%3A|:)asc/);
    await expect(location).not.toHaveTextContent("type=");
  },
};

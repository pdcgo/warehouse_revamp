import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { FinancialAccountChangeType as T } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { FinancialAccountReportPage } from "../index";
import { BCA_OPS, MELATI_TIKTOK, REPORT_META, loaded, pickAccount, rp, signed } from "./kit";

// ACCOUNT REPORT — the account, the window and the grain — the search, Clear, the URL, and a phone's sheet. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Report/Filters",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Mobile: the account, the window and the grain open from the Filter button, full width, in a bottom sheet.
export const MobileFiltersAreASheet: Story = {
  name: "Phone · filter sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-filters-open"));
    const sheet = await screen.findByTestId("account-report-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("account-report-account")).toBeVisible();
    await expect(within(sheet).getByTestId("account-report-range")).toBeVisible();
    await expect(within(sheet).getByTestId("account-report-grain")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("account-report-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("account-report-filters-sheet")).toBeNull());
  },
};

// The account filter SEARCHES — typing "BCA" leaves the two BCA accounts. It looked like a search and searched nothing:
// Ark's list collection filters only when given a matcher.
export const TheAccountFilterSearches: Story = {
  name: "Account search",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-account"));
    await userEvent.type(canvas.getByTestId("account-report-account"), "BCA", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`account-report-account-option-${MELATI_TIKTOK.id}`)).toBeNull());
    await expect(canvas.getByTestId(`account-report-account-option-${BCA_OPS.id}`)).toBeVisible();
  },
};

// One account: its own open and close, and its transfers show in the breakdown — they left IT, even if not the team.
export const OneAccount: Story = {
  name: "One account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickAccount(canvas, BCA_OPS.id);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(11_443_500)));
    await expect(canvas.getByTestId("account-report-open-value")).toHaveTextContent(rp(10_750_000));

    await userEvent.click(canvas.getByTestId("account-report-change-detail"));
    const dialog = await screen.findByTestId("change-detail");
    await waitFor(() => expect(within(dialog).getByTestId(`change-detail-${T.TRANSFER}`)).toHaveTextContent(signed(-3_500_000)));
  },
};

// The grain picker's pick is rose, and stays rose under the pointer — never black; a segment not picked turns the same
// rose when pointed at (`a-segmented-choice-is-in-the-main-tone`). Driven by `data-hover`, as the table's row is.
export const TheGrainPickStaysInTheMainTone: Story = {
  name: "Grain in the main tone",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const daily = canvas.getByTestId("account-report-grain-day");
    const monthly = canvas.getByTestId("account-report-grain-month");
    const picked = getComputedStyle(daily).color;
    const resting = getComputedStyle(monthly).color;
    await expect(picked).not.toBe(resting);

    daily.setAttribute("data-hover", "");
    monthly.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(monthly).color).toBe(picked));
    await expect(getComputedStyle(daily).color).toBe(picked);
  },
};

/** Clear puts the account, the window and the grain back — red and bold while anything is narrowed. */
export const ClearPutsTheFiltersBack: Story = {
  name: "Clear",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("account-report-filters-clear")).toBeNull();
    await pickAccount(canvas, BCA_OPS.id);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(11_443_500)));

    await userEvent.click(canvas.getByTestId("account-report-filters-clear"));
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(16_443_500)));
  },
};

// THE FILTERS AND THE PERIODS' ORDER LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at a URL, the account and
// the grain are read from it; the order flipped is written back beside them. The view is not a filter: it stays out.
const AtFilteredUrl = routedPage(
  [{ path: "/financial-accounts/report", element: <><FinancialAccountReportPage /><LocationProbe /></> }],
  `/financial-accounts/report?account=${BCA_OPS.id}&grain=month`,
);

export const FiltersLiveInTheUrl: Story = {
  name: "In the URL",
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(11_443_500)), {
      timeout: 4000,
    });
    const location = canvas.getByTestId("location-search");

    await waitFor(() => expect(canvas.getByTestId("account-report-account")).toHaveValue(BCA_OPS.name));
    await expect(within(canvas.getByTestId("account-report-grain")).getByRole("radio", { name: "Monthly" })).toBeChecked();

    await userEvent.click(canvas.getByTestId("account-report-sort-period"));
    await waitFor(() => expect(location).toHaveTextContent(/sort=period(%3A|:)asc/));
    await expect(location).toHaveTextContent(`account=${BCA_OPS.id}`);

    await userEvent.click(canvas.getByTestId("account-report-view-breakdown"));
    await waitFor(() => expect(canvas.getByTestId("account-report-view-breakdown")).toHaveAttribute("aria-selected", "true"));
    await expect(location).not.toHaveTextContent("view");
  },
};

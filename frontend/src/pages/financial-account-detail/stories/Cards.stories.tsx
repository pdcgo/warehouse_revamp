import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import { FinancialAccountChangeType as T } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { ACCOUNT_DETAIL_META, AtBcaGaji, AtShopeePay, BCA_GAJI, BCA_OPS, loaded } from "./kit";

// ACCOUNT DETAIL — the balance, last checked and the linked shops — the screen rules, a date's language, pointing a shop here. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Account/Cards",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// TOKO TERHUBUNG IS THE THIRD CARD (owner, `linked-shops-sit-beside-the-cards`) — as wide and as tall as the two beside
// it, in their row; two shops then "+1", each chip in its marketplace's colour; "Point a Shop ›" at the end of its label
// row, only the word pressed.
export const LinkedShopsAreTheThirdCard: Story = {
  name: "Linked shops card",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    const cards = Array.from(canvas.getByTestId("account-detail-summary").children).map((el) => el.getBoundingClientRect());
    await expect(cards).toHaveLength(3);
    await expect(Math.abs(cards[2]!.width - cards[0]!.width)).toBeLessThan(2);
    await expect(Math.abs(cards[2]!.top - cards[0]!.top)).toBeLessThan(2);
    await expect(Math.abs(cards[2]!.height - cards[0]!.height)).toBeLessThan(2);

    const shops = canvas.getByTestId("account-shops");
    await expect(shops).toHaveTextContent("Linked shops");
    await expect(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-21`)).toHaveTextContent("Melati Official");
    await expect(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-22`)).toHaveTextContent("Melati Store");
    await expect(within(shops).queryByTestId(`account-shop-${BCA_OPS.id}-23`)).toBeNull();
    await expect(within(shops).getByTestId(`account-links-more-${BCA_OPS.id}`)).toHaveTextContent("+1");
    await expect(within(shops).getByTestId("account-shops-count")).toHaveTextContent("3 shops");

    // Shopee and Tokopedia: two marketplaces, two colours.
    const official = getComputedStyle(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-21`)).backgroundColor;
    const store = getComputedStyle(within(shops).getByTestId(`account-shop-${BCA_OPS.id}-22`)).backgroundColor;
    await expect(official).not.toBe(store);

    await expect(within(shops).getByTestId("open-shop-set")).toHaveTextContent("Point a Shop");
  },
};

// A date speaks the app's language, not the browser's (owner: *"yesterday tidak ikut i18n?"*) — in Indonesian the last
// check reads "kemarin", its date "7 Okt 2026"-style.
export const DatesFollowTheAppsLanguage: Story = {
  name: "Dates in the app's language",
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("kemarin");
    await expect(canvas.getByTestId("account-detail-checked")).not.toHaveTextContent("yesterday");
  },
};

// THE ACCOUNT PAGE FOLLOWS THE SCREEN RULES (owner, `the-account-page-follows-the-screen-rules`) — the figures are the
// order list's cards, the balance leading; the statement's filters the shared FilterBar, Clear red and bold while one is
// set; the pages grow as they are opened.
export const TheAccountPageFollowsTheScreenRules: Story = {
  name: "Screen rules",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    // Saldo, Terakhir dicek — and Toko terhubung beside them (`linked-shops-sit-beside-the-cards`).
    await expect(canvas.getByTestId("account-detail-summary").children).toHaveLength(3);
    await expect(canvas.getByTestId("account-detail-balance-card")).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("account-detail-checked-card")).not.toHaveAttribute("data-emphasis");

    await expect(canvas.queryByTestId("account-log-filters-clear")).toBeNull();
    await userEvent.click(canvas.getByTestId("account-log-type-filter"));
    const withdrawal = await canvas.findByTestId(`account-log-type-option-${T.WITHDRAWAL}`);
    await waitFor(() => expect(withdrawal).toBeVisible());
    await userEvent.click(withdrawal);
    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 3));

    await userEvent.click(canvas.getByTestId("account-log-filters-clear"));
    await waitFor(() => expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row").length).toBeGreaterThan(1 + 3));
    await expect(canvas.getByTestId("account-log-pager")).toBeVisible();
  },
};

// The shops whose withdrawals land here.
export const TheShopsThatWithdrawHere: Story = {
  name: "Shops that withdraw",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.getByTestId("account-shop-1301-21")).toHaveTextContent("Melati Official");
    await expect(canvas.getByTestId("account-shop-1301-22")).toHaveTextContent("Melati Store");
  },
};

// below-zero-is-warned-never-refused — the account's own page says it too.
export const BelowZeroIsExplained: Story = {
  name: "Below zero",
  render: () => <AtShopeePay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1303"]!);

    await expect(canvas.getByTestId("account-detail-balance-below-zero")).toBeVisible();
    await expect(canvas.getByTestId("account-detail-below-zero")).toBeVisible();
  },
};

// a-shop-has-one-account: pointing a shop here MOVES it, and the dialog names the account it leaves.
export const PointAShopHere: Story = {
  name: "Point a shop",
  render: () => <AtBcaGaji />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1302"]!);
    await expect(canvas.getByTestId("account-shops-none")).toBeVisible();

    await userEvent.click(canvas.getByTestId("open-shop-set"));
    const shop = await screen.findByTestId("shop-select");
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    const official = await screen.findByTestId("shop-select-option-21");
    await waitFor(() => expect(official).toBeVisible());
    await userEvent.click(official);

    await waitFor(() =>
      expect(screen.getByTestId("shop-set-current")).toHaveTextContent(`withdraws into ${BCA_OPS.name} now — it moves to ${BCA_GAJI.name}`),
    );
    await userEvent.click(screen.getByTestId("shop-set-save"));

    await canvas.findByTestId(`account-shop-${BCA_GAJI.id}-21`);
  },
};

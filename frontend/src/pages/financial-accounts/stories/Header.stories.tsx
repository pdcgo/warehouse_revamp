import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import { account } from "../../../../.storybook/financialAccountFixtures";
import { FinancialAccountType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { ACCOUNTS_META, BCA_OPS, loaded, rp } from "./kit";

// ACCOUNTS — the title and subtitle, the totals under them, and the Archive view the header's button opens. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Accounts/Header",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The totals are by TYPE and asked of the server — bank, wallet, the money in unknown accounts, the team.
export const TotalsByType: Story = {
  name: "Totals by type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.BANK_ACCOUNT}-value`)).toHaveTextContent(rp(12_043_500));
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.WALLET}-value`)).toHaveTextContent(rp(-150_000));
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.CASH}-value`)).toHaveTextContent(rp(350_000));
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}-value`)).toHaveTextContent(rp(4_200_000));
    await expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_443_500));
  },
};

/**
 * THE HEADER (owner) — the subtitle directly under the title, and the report button says its word. It used
 * to render i18next's "returned an object instead of string": its key was the report page's namespace.
 */
export const TheHeaderReadsAsOneBlock: Story = {
  name: "One block",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("open-account-report")).toHaveTextContent(/^Report$/);
    const title = canvas.getByRole("heading", { name: "Accounts" });
    const subtitle = canvas.getByTestId("financial-accounts-subtitle");
    // Under the title, inside the same block — not a section away.
    await expect(subtitle.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toBeLessThan(12);
  },
};

const BNI = account("BNI Lama");

/**
 * THE ARCHIVE IS ITS OWN VIEW (owner, `the-archive-is-its-own-view`) — the Archive button beside New Account turns
 * this screen into the archived list: no totals, no Filter panel, the search, the shop and the type tabs. The server
 * lists the archived alone (`archived_only`) and counts them per type for the tabs — no window, no mark. An archived
 * row offers Restore and nothing else. Active Accounts goes back.
 */
export const ArchivedAccountsAreHiddenUntilAsked: Story = {
  name: "Archive view",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`account-row-${BNI.id}`)).toBeNull();
    await userEvent.click(canvas.getByTestId("open-archived-accounts"));

    await canvas.findByTestId(`account-archived-${BNI.id}`);
    await expect(canvas.getByTestId("financial-accounts-heading")).toHaveTextContent("Archived Accounts");
    await expect(canvas.queryByTestId(`account-row-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId("account-totals")).toBeNull();
    await expect(canvas.queryByTestId("account-options-trigger")).toBeNull();
    await expect(canvas.getByTestId("account-search")).toBeVisible();
    await expect(canvas.getByTestId("account-type-tab-all")).toHaveTextContent("1");
    // Served, not worked out on screen — nothing on the view says otherwise any more.
    await expect(canvas.queryByLabelText(/Not implemented/)).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();

    // Restore is the only thing an archived account offers — a button, and no menu.
    await expect(canvas.getByTestId(`account-restore-button-${BNI.id}`)).toBeVisible();
    await expect(canvas.queryByTestId(`account-actions-${BNI.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-transfer-button-${BNI.id}`)).toBeNull();

    await userEvent.click(canvas.getByTestId("back-to-active-accounts"));
    await waitFor(() => expect(canvas.getByTestId(`account-row-${BCA_OPS.id}`)).toBeVisible());
    await expect(canvas.queryByTestId(`account-row-${BNI.id}`)).toBeNull();
    await expect(canvas.getByTestId("account-totals")).toBeVisible();
  },
};

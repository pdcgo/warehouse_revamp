import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { account } from "../../../../.storybook/financialAccountFixtures";
import { FinancialAccountType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { ACCOUNTS_META, loaded, rp } from "./kit";

// ACCOUNTS — the New Account form — the opening balance, the type deciding the provider, a number refused. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Accounts/Create",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// an-account-opens-with-a-log-row: a new account appears with its opening balance — posted as its first row.
export const ANewAccountOpensWithItsBalance: Story = {
  name: "Opening balance",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-account"));
    const name = await screen.findByTestId("account-name");
    await waitFor(() => expect(name).toBeVisible());
    await userEvent.type(name, "Kas Toko", { delay: 20 });
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.CASH}`));
    // A cash box's provider is Kas by itself (the-type-decides-the-provider) — no provider field at all.
    await waitFor(() => expect(screen.queryByTestId("account-provider")).toBeNull());
    // A cash box has no number to ask for.
    await expect(screen.queryByTestId("account-number")).toBeNull();
    const opening = screen.getByTestId("account-opening");
    await userEvent.clear(opening);
    await userEvent.type(opening, "250000", { delay: 20 });
    await userEvent.click(screen.getByTestId("account-form-save"));

    const row = await canvas.findByText("Kas Toko");
    await waitFor(() => expect(row).toBeVisible());
    await waitFor(() => expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_693_500)));
  },
};

/**
 * THE TYPE DECIDES THE PROVIDER (owner, `the-type-decides-the-provider`) — a bank account picks among BCA, BNI and
 * Jago; a digital wallet among ShopeePay; a cash box is Kas by itself; type Lainnya is Lainnya by itself, its number
 * optional, and the server takes it as that pair.
 */
export const TheTypeDecidesTheProvider: Story = {
  name: "Type decides provider",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-account"));
    await userEvent.click(await screen.findByTestId("account-provider"));
    await waitFor(() => expect(screen.getByTestId("account-provider-option-2")).toBeVisible());
    // A bank account: the banks only.
    await expect(screen.queryByTestId("account-provider-option-5")).toBeNull();
    await expect(screen.queryByTestId("account-provider-option-6")).toBeNull();
    await userEvent.keyboard("{Escape}");

    // A digital wallet keeps its picker, ShopeePay already picked — the only one there is.
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.WALLET}`));
    await waitFor(() => expect(screen.getByTestId("account-provider")).toHaveTextContent("ShopeePay"));

    // Kas and Lainnya set their own provider — no field (kas-and-lainnya-ask-no-provider).
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.CASH}`));
    await waitFor(() => expect(screen.queryByTestId("account-provider")).toBeNull());
    await expect(screen.queryByTestId("account-number")).toBeNull();

    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.UNKNOWN}`));
    await expect(screen.queryByTestId("account-provider")).toBeNull();
    await expect(screen.getByTestId("account-number")).toBeVisible();
    // No warning: the server opens a Lainnya account now.
    await expect(screen.queryByLabelText(/Not implemented/)).toBeNull();
  },
};

/**
 * A LAINNYA ACCOUNT (owner, `the-type-decides-the-provider`) — Mandiri Usaha, type Lainnya, provider Lainnya: shown
 * by its own name with its holder under it, no warning (it holds no shop's withdrawals), counted under Other. A new one
 * saves without a number, as on the server.
 */
export const AnotherBankReadsOtherInTheDemo: Story = {
  name: "Lainnya account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const mandiri = account("Mandiri Usaha");
    const row = canvas.getByTestId(`account-row-${mandiri.id}`);

    await expect(row).toHaveTextContent("Mandiri Usaha");
    await expect(row).toHaveTextContent("PT Melati Sejahtera");
    await expect(row).toHaveTextContent("Other");
    await expect(canvas.queryByTestId(`account-not-set-${mandiri.id}`)).toBeNull();

    await userEvent.click(canvas.getByTestId("open-create-account"));
    const name = await screen.findByTestId("account-name");
    await waitFor(() => expect(name).toBeVisible());
    await userEvent.type(name, "BRI Usaha", { delay: 20 });
    await userEvent.click(screen.getByTestId(`account-type-${FinancialAccountType.UNKNOWN}`));
    await userEvent.click(screen.getByTestId("account-form-save"));

    await waitFor(() => expect(canvas.getByText("BRI Usaha")).toBeVisible());
  },
};

// a-real-account-is-recorded-once: a number recorded in ANOTHER team is refused, and the dialog says so.
export const ARecordedNumberIsRefused: Story = {
  name: "Number refused",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-account"));
    const name = await screen.findByTestId("account-name");
    await waitFor(() => expect(name).toBeVisible());
    await userEvent.type(name, "Jago Baru", { delay: 20 });
    await userEvent.click(screen.getByTestId("account-provider"));
    const jago = await screen.findByTestId("account-provider-option-4");
    await waitFor(() => expect(jago).toBeVisible());
    await userEvent.click(jago);
    // Jago Kenanga's number — Toko Kenanga's account, not this team's.
    await userEvent.type(screen.getByTestId("account-number"), "1029384756", { delay: 20 });
    await userEvent.click(screen.getByTestId("account-form-save"));

    await expect(await screen.findByTestId("account-form-error")).toHaveTextContent("already recorded");
  },
};

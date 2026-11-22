import type { Meta, StoryObj } from "@storybook/react-vite";
import { useNavigate } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { EXPENSE_TEAM, FIRST_NEW_EXPENSE_ID, expenseFixtures } from "../../../../.storybook/expenseFixtures";
import { expenseCountForStory } from "../../../../.storybook/expenseStub";
import { expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import { asTeam, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiah } from "../../../lib/money";
import { ExpensesPage } from "../../expenses/index";
import { FinancialAccountDetailPage } from "../index";
import { ACCOUNT_DETAIL_META, AtBcaGaji, AtKasGudang, BCA_GAJI, BCA_OPS, KAS, firstRow, loaded, rp } from "./kit";

// ACCOUNT DETAIL — Match Balance and Capital — a difference, an agreement, a cash box, and who may move money. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Account/Actions",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// adjustment-is-for-reconciling-only: the bank's figure in, the difference worked out on screen, a note
// required before it posts — then the top row is the adjustment and the account is checked now.
export const AReconcilePostsTheDifference: Story = {
  name: "Match, a difference",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    // Named the way a person says it, "reconciliation" kept as the dialog's description
    // (reconcile-reads-cocokkan-saldo). The note is a textarea (an-account-note-is-a-textarea).
    await expect(canvas.getByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toHaveTextContent("Match Balance");
    await userEvent.click(canvas.getByTestId(`account-reconcile-button-${BCA_OPS.id}`));
    const actual = await screen.findByTestId("reconcile-actual");
    await waitFor(() => expect(actual).toBeVisible());
    await expect(screen.getByTestId("reconcile-description")).toHaveTextContent(/^Reconciliation:/);
    await expect(screen.getByTestId("reconcile-note").tagName).toBe("TEXTAREA");
    await userEvent.type(actual, "11400000", { delay: 20 });

    await expect(screen.getByTestId("reconcile-difference")).toHaveTextContent(`−${rp(43_500)}`);
    await expect(screen.getByTestId("reconcile-save")).toBeDisabled();

    await userEvent.type(screen.getByTestId("reconcile-note"), "card fee", { delay: 20 });
    await userEvent.click(screen.getByTestId("reconcile-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(11_400_000)));
    const top = firstRow(canvas);
    await expect(top).toHaveTextContent("Adjustment");
    await expect(top).toHaveTextContent("card fee");
    await waitFor(() => expect(canvas.getByTestId("account-detail-checked")).not.toHaveTextContent("yesterday"));
  },
};

// A reconcile that agrees posts NOTHING — and still marks the account checked.
export const AReconcileThatAgreesPostsNothing: Story = {
  name: "Match, agrees",
  render: () => <AtBcaGaji />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1302"]!);
    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("Never checked");

    await userEvent.click(canvas.getByTestId(`account-reconcile-button-${BCA_GAJI.id}`));
    const actual = await screen.findByTestId("reconcile-actual");
    await waitFor(() => expect(actual).toBeVisible());
    await userEvent.type(actual, "600000", { delay: 20 });
    await expect(screen.getByTestId("reconcile-difference")).toHaveTextContent("agree");
    await userEvent.click(screen.getByTestId("reconcile-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-checked")).not.toHaveTextContent("Never checked"));
    await expect(firstRow(canvas)).toHaveTextContent("Payroll");
  },
};

// capital-joins-the-types: a direction and a positive amount — the person never types a sign.
export const CapitalOutMovesTheBalance: Story = {
  name: "Capital out",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await userEvent.click(canvas.getByTestId(`account-actions-${BCA_OPS.id}`));
    const capital = await screen.findByTestId(`account-capital-${BCA_OPS.id}`);
    await waitFor(() => expect(capital).toBeVisible());
    await userEvent.click(capital);

    const out = await screen.findByTestId("capital-out");
    await waitFor(() => expect(out).toBeVisible());
    await userEvent.click(out);
    await userEvent.type(screen.getByTestId("capital-amount"), "443500", { delay: 20 });
    await userEvent.click(screen.getByTestId("capital-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(11_000_000)));
    await expect(firstRow(canvas)).toHaveTextContent("Capital out");
  },
};

// A warehouse's cash box: Reconcile asks what the box COUNTS. (That a warehouse sees no shops section rests on the
// server scoping ShopList by team — the stub serves every shop to every team, which other stories rely on.)
export const ACashBoxIsCounted: Story = {
  name: "Cash box count",
  beforeEach: asTeam(11n),
  render: () => <AtKasGudang />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1306"]!);

    await userEvent.click(canvas.getByTestId(`account-reconcile-button-${KAS.id}`));
    const dialog = await screen.findByTestId("reconcile");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("What does the box count?");
  },
};

// seeing-is-team-wide-moving-is-admin-and-up: a CS reads the statement and moves nothing.
export const AMemberReadsButDoesNotMove: Story = {
  name: "Member reads only",
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await expect(canvas.queryByTestId(`account-actions-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId("open-shop-set")).toBeNull();
  },
};

// CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital — one act, one record, two doors).
// On a SELLING team's account the dialog says the act shows on Biaya too; a warehouse team's says nothing — its Setor /
// Tarik Modal stays on the account page alone.
async function openCapital(canvas: ReturnType<typeof within>, accountId: bigint) {
  await userEvent.click(canvas.getByTestId(`account-actions-${accountId}`));
  const capital = await screen.findByTestId(`account-capital-${accountId}`);
  await waitFor(() => expect(capital).toBeVisible());
  await userEvent.click(capital);
  await screen.findByTestId("capital-out");
}

export const ASellingTeamsCapitalSaysBiaya: Story = {
  name: "Capital says it shows on Biaya",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    await openCapital(canvas, BCA_OPS.id);
    await expect(screen.getByTestId("capital-on-expenses-hint")).toHaveTextContent(
      "Also shown on Expenses — Withdraw as Prive, Add as Deposit. One record.",
    );
  },
};

export const AWarehousesCapitalStaysHere: Story = {
  name: "Warehouse capital, no Biaya",
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
  render: () => <AtKasGudang />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1306"]!);

    await openCapital(canvas, KAS.id);
    await expect(screen.queryByTestId("capital-on-expenses-hint")).toBeNull();

    // Setor Modal as today — the box holds more — and nothing on Biaya.
    await userEvent.type(screen.getByTestId("capital-amount"), "150000", { delay: 20 });
    await userEvent.click(screen.getByTestId("capital-save"));
    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(1_000_000)));
    await expect(firstRow(canvas)).toHaveTextContent("Capital in");
    await expect(expenseCountForStory(11n)).toBe(0);
  },
};

// THE SAME ACT ON BOTH PAGES: a Setor Modal on BCA Operasional moves the balance at once (as always) and is, on Biaya,
// one Setoran modal *Recorded on the account page* — Modal and the month's total down by it (given 19).
function GoToBiaya() {
  const navigate = useNavigate();

  return (
    <button type="button" data-testid="story-go-to-biaya" onClick={() => navigate("/expenses")}>
      Biaya
    </button>
  );
}

const AccountThenBiaya = routedPage(
  [
    {
      path: "/financial-accounts/:accountId",
      element: (
        <>
          <FinancialAccountDetailPage />
          <GoToBiaya />
        </>
      ),
    },
    { path: "/expenses", element: <ExpensesPage /> },
  ],
  `/financial-accounts/${BCA_OPS.id}`,
);

// Toko Melati's month before the act (expenseFixtures.ts): Rp 6.350.000, no capital.
const MELATI_MONTH = 6_350_000;

export const ASetorModalShowsOnBiaya: Story = {
  name: "Setor Modal shows on Biaya",
  render: () => <AccountThenBiaya />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);
    const before = expenseCountForStory(EXPENSE_TEAM);

    await openCapital(canvas, BCA_OPS.id);
    await userEvent.type(screen.getByTestId("capital-amount"), "1000000", { delay: 20 });
    await userEvent.type(screen.getByTestId("capital-note"), "Top up for stock", { delay: 10 });
    await userEvent.click(screen.getByTestId("capital-save"));

    // The account: one by-hand capital row, the balance moved at once.
    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(12_443_500)));
    await expect(firstRow(canvas)).toHaveTextContent("Capital in — Top up for stock");
    await expect(firstRow(canvas)).toHaveTextContent("by hand");
    // Biaya: exactly one record for the act.
    await expect(expenseCountForStory(EXPENSE_TEAM)).toBe(before + 1);

    await userEvent.click(canvas.getByTestId("story-go-to-biaya"));
    const id = FIRST_NEW_EXPENSE_ID;
    await canvas.findByTestId(`expense-row-${id}`, {}, { timeout: 4000 });

    await expect(canvas.getByTestId(`expense-type-${id}`)).toHaveTextContent("Other › Deposit · owner adds capital");
    await expect(canvas.getByTestId(`expense-origin-${id}`)).toHaveTextContent("Recorded on the account page");
    await expect(canvas.getByTestId(`expense-mark-${id}-capital`)).toBeInTheDocument();
    await expect(canvas.getByTestId("expenses-total-capital")).toHaveTextContent(formatRupiah(-1_000_000));
    await expect(canvas.getByTestId("expenses-total")).toHaveTextContent(formatRupiah(MELATI_MONTH - 1_000_000));
    // The rows from before stay as they were.
    await expect(canvas.queryByTestId(`expense-origin-${expenseFixtures[0]!.id}`)).toBeNull();
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { expect, within } from "storybook/test";

import {
  FinancialAccountChangeType as T,
  FinancialAccountLogSchema,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { AccountLogTable } from "./components/AccountLogTable";

// A FINANCIAL ACCOUNT'S STATEMENT — newest first, each row saying why in words and which way it came in,
// on its own so it can be read beside the other ledgers (settlement, liability, stock).
//
//   | story               | the rule it pins                                                  |
//   | ------------------- | ----------------------------------------------------------------- |
//   | Default             | by hand names who; a listener row says it was automatic           |
//   | ARowRecordedLater   | the day the money moved leads; the day it was typed shows under it |
//   | BelowZeroIsWarned   | the balance may go below zero, and says so wherever it is shown    |
//   | Empty               | the statement's own sentence                                       |

const at = (day: string) => timestampFromDate(new Date(`${day}T10:00:00+07:00`));
const ANI = 61n;
const LISTENER = 0n;

const log = (
  id: bigint,
  changeType: T,
  change: number,
  balanceAfter: number,
  description: string,
  actorId: bigint,
  occurred: string,
  recorded = occurred,
) =>
  create(FinancialAccountLogSchema, {
    id,
    teamId: 12n,
    accountId: 1301n,
    changeType,
    change,
    balanceAfter,
    description,
    actorId,
    occurredAt: at(occurred),
    createdAt: at(recorded),
  });

// Newest first — the order `balance_after` runs in.
const expense = log(3n, T.EXPENSE, -15_000_000, -1_500_000, "Restock paid from this account", LISTENER, "2026-09-28", "2026-10-01");
const withdrawal = log(2n, T.WITHDRAWAL, 3_500_000, 13_500_000, "Withdrawal from shop #21", LISTENER, "2026-09-20");
const opening = log(1n, T.OPENING_BALANCE, 10_000_000, 10_000_000, "Opening balance", ANI, "2026-09-01");

const meta = {
  title: "Pages/FinancialAccount/Account Log Table",
  component: AccountLogTable,
  args: {
    logs: [withdrawal, opening],
    actorName: (id: bigint) => (id === ANI ? "Ani" : `#${id}`),
    // A listener writes a shop by id; the page puts its name in.
    describe: (text: string) => text.replace("shop #21", "Melati Official"),
  },
} satisfies Meta<typeof AccountLogTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A row typed by a person names them; a row a listener posted says it came from where it happened. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId(`account-log-way-${opening.id}`)).toHaveTextContent("by hand · Ani");
    await expect(canvas.getByTestId(`account-log-way-${withdrawal.id}`)).toHaveTextContent(/automatic/i);
    // The shop's id became its name.
    await expect(canvas.getByTestId(`account-log-row-${withdrawal.id}`)).toHaveTextContent("Melati Official");
  },
};

/** A row dated last week that appeared today says so — it explains a balance that changed today. */
export const ARowRecordedLater: Story = {
  args: { logs: [expense, withdrawal, opening] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId(`account-log-recorded-${expense.id}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(`account-log-recorded-${opening.id}`)).toBeNull();
  },
};

/** The books may go below zero — never refused, always warned. */
export const BelowZeroIsWarned: Story = {
  args: { logs: [expense, withdrawal, opening] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId(`account-log-row-${expense.id}`);
    await expect(row.querySelector("[data-below-zero]")).not.toBeNull();
    await expect(canvas.getByTestId(`account-log-row-${opening.id}`).querySelector("[data-below-zero]")).toBeNull();
  },
};

export const Empty: Story = {
  args: { logs: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("account-log-empty")).toBeInTheDocument();
  },
};

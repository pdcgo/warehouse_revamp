// expense_service's ExpenseService (list, record, adjust) as Storybook's stub. The server is
// backend/services/expense_service/expense_v1/; this plays the same rules so the expenses screen is proven against them:
//   an-expense-is-never-edited                  a row never changes once written — record adds one, adjust adds one.
//   every-correction-is-a-signed-adjustment      a correction is a NEW row, signed, never 0, on an expense — never on
//                                                another adjustment (FailedPrecondition), never past 0 (FailedPrecondition).
//   an-adjustment-counts-on-the-day-it-fixes     the adjustment copies the expense's team, shop, kind and DAY.
//   the totals are the whole filtered period, not the page; a kind with nothing is absent.
//   the list is newest occurred_at first, id breaking the tie (expenseOrderClause).
//   who may: ROOT, ADMINISTRATOR, SELLING_OWNER, SELLING_ADMIN read and write; the admin team's monitor reads
//   (NO_SIDE_EFFECTS); anyone else is PermissionDenied. A missing row, or another team's, is NotFound.
//   the request validation the interceptor runs (expense.proto): kind set, amount > 0, a YYYY-MM-DD day, note ≤ 500,
//                                                and finance_account_id > 0 (an-expense-must-name-the-account-that-paid);
//                                                STOCK_LOSS is refused — stock loss is recorded by inventory, not typed.
//   an-expense-names-a-shop-only-for-ads         an ADS expense names its shop, and only an ADS expense names one —
//                                                InvalidArgument either way. Rows already stored keep whatever shop.
//   an-expense-must-name-the-account-that-paid  the account is the team's ACTIVE OPERATIONAL one, asked of the
//                                                financial account stub (payingAccountRefusal) — else
//                                                FailedPrecondition, naming it. STOCK_LOSS names none.
//   a-correction-follows-the-expenses-account   an adjustment copies its expense's account; an old expense has none.
//
// ExpenseDaily stays in stubTransport.ts, on its own day series — the daily statement's figures are reviewed artefacts.
//
// WRITEABLE: a story that records or cancels changes what its next step reads. preview.tsx resets it in `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { ExpenseKind, ExpenseListDataType, type ExpenseService } from "../src/gen/warehouse/expense/v1/expense_pb";
import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { type ExpenseFixture, FIRST_NEW_EXPENSE_ID, expenseFixtures } from "./expenseFixtures";
import { payingAccountRefusal } from "./financialAccountStub";
import { sessionScenario } from "./sessionScenario";
import { SELF_ID } from "./userStub";

let rows: ExpenseFixture[] = [];
let nextId = FIRST_NEW_EXPENSE_ID;

/** What the last write carried — a story pins what the form SENT, not only what the list shows after. */
export const expenseScenario = {
  lastCreate: undefined as
    | undefined
    | {
        teamId: bigint;
        kind: ExpenseKind;
        amount: number;
        occurredAt: string;
        shopId: bigint;
        note: string;
        financeAccountId: bigint;
      },
  lastAdjust: undefined as undefined | { teamId: bigint; expenseId: bigint; amount: number; note: string },
  /** How many times ExpenseList was asked — a read-only story pins that the screen still reads. */
  listCalls: 0,
  /** Set by a story: the next ExpenseAdjust fails as a server FAULT (Unavailable, a Go error's text) — not a refusal. */
  faultNextAdjust: false,
};

export function resetExpenseStub() {
  rows = structuredClone(expenseFixtures);
  nextId = FIRST_NEW_EXPENSE_ID;
  expenseScenario.lastCreate = undefined;
  expenseScenario.lastAdjust = undefined;
  expenseScenario.listCalls = 0;
  expenseScenario.faultNextAdjust = false;
}

resetExpenseStub();

/**
 * SOMEBODY ELSE corrects an expense, behind the screen's back — called from a story's play() between opening a dialog
 * and pressing save, so the screen's figure is stale and the server's floor is what refuses. Writes the adjustment row
 * directly (no role check): it is the other person's request, not this one's.
 */
export function someoneElseAdjusts(expenseId: bigint, amount: number, note = "Corrected by a colleague") {
  const expense = rows.find((r) => r.id === expenseId)!;
  rows.push({
    ...expense,
    id: nextId++,
    amount,
    note,
    createdBy: 99n,
    createdAtUnix: now(),
    adjustsExpenseId: expense.id,
  });
}

const now = () => BigInt(Math.floor(Date.now() / 1000));

const WRITERS = new Set<Role>([Role.ROOT, Role.ADMINISTRATOR, Role.SELLING_OWNER, Role.SELLING_ADMIN]);
const isMonitor = () => sessionScenario.role === Role.ADMIN_OWNER || sessionScenario.role === Role.ADMIN_ADMINISTRATOR;

function mayRead() {
  if (!WRITERS.has(sessionScenario.role) && !isMonitor()) {
    throw new ConnectError("expenses are read by the team's Owner and Admin", Code.PermissionDenied);
  }
}

function mayWrite() {
  if (!WRITERS.has(sessionScenario.role)) {
    throw new ConnectError("expenses are recorded by the team's Owner and Admin", Code.PermissionDenied);
  }
}

const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);

/** What an expense counts for after every adjustment of it; 0 on an adjustment. */
function netOf(r: ExpenseFixture): number {
  if (r.adjustsExpenseId !== 0n) return 0;

  return rows.filter((a) => a.adjustsExpenseId === r.id).reduce((sum, a) => sum + a.amount, r.amount);
}

function wire(r: ExpenseFixture) {
  return { ...r, netAmount: netOf(r) };
}

export const expenseService: Partial<ServiceImpl<typeof ExpenseService>> = {
  expenseList: (req) => {
    expenseScenario.listCalls++;
    mayRead();
    if (req.teamId === 0n) throw invalid("team_id: value must be greater than 0");
    if (!req.page) throw invalid("page: value is required");

    const from = req.filter?.from ?? "";
    const to = req.filter?.to ?? "";
    const kind = req.filter?.kind ?? ExpenseKind.UNSPECIFIED;
    const shopId = req.filter?.shopId ?? 0n;

    const matched = rows
      .filter((r) => r.teamId === req.teamId)
      .filter((r) => (from === "" || r.occurredAt >= from) && (to === "" || r.occurredAt <= to))
      .filter((r) => kind === ExpenseKind.UNSPECIFIED || r.kind === kind)
      .filter((r) => shopId === 0n || r.shopId === shopId)
      // occurred_at DESC, id DESC — an adjustment sits just above the expense it corrects.
      .sort((a, b) => (a.occurredAt === b.occurredAt ? (a.id > b.id ? -1 : 1) : a.occurredAt > b.occurredAt ? -1 : 1));

    // The WHOLE period, adjustments included (each carries its expense's kind) — never the page.
    const byKind: Record<number, number> = {};
    for (const r of matched) byKind[r.kind] = (byKind[r.kind] ?? 0) + r.amount;
    const total = matched.reduce((sum, r) => sum + r.amount, 0);

    const limit = req.page.limit || 20;
    const current = req.page.page || 1;
    const window = matched.slice((current - 1) * limit, current * limit);
    const wanted = req.dataRequest.length === 0 ? [ExpenseListDataType.EXPENSE] : req.dataRequest;

    return {
      items: wanted.includes(ExpenseListDataType.EXPENSE)
        ? [
            {
              d: {
                case: "expense" as const,
                value: { mapData: Object.fromEntries(window.map((r) => [r.id.toString(), wire(r)])) },
              },
            },
          ]
        : [],
      ids: window.map((r) => r.id),
      pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(matched.length / limit)), totalItems: BigInt(matched.length) },
      totals: { total, byKind },
    };
  },

  expenseCreate: (req) => {
    mayWrite();
    // The request validation (expense.proto) — what the interceptor answers before the service runs.
    if (req.teamId === 0n) throw invalid("team_id: value must be greater than 0");
    if (req.kind === ExpenseKind.UNSPECIFIED || !(req.kind in ExpenseKind)) throw invalid("kind: value must not be in list [0]");
    if (req.kind === ExpenseKind.STOCK_LOSS) throw invalid("kind: stock loss is recorded by inventory, not typed");
    if (!(req.amount > 0)) throw invalid("amount: value must be greater than 0");
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.occurredAt)) throw invalid("a date must be YYYY-MM-DD");
    if ([...req.note].length > 500) throw invalid("note: value length must be at most 500 characters");
    if (req.financeAccountId === 0n) throw invalid("finance_account_id: value must be greater than 0");
    // The service's own rules (expense_create.go): the ads-only shop, then the account that paid.
    if (req.kind === ExpenseKind.ADS && req.shopId === 0n) throw invalid("an ads expense names its shop");
    if (req.kind !== ExpenseKind.ADS && req.shopId !== 0n) throw invalid("only an ads expense names a shop");
    const refused = payingAccountRefusal(req.teamId, req.financeAccountId);
    if (refused !== null) throw new ConnectError(refused, Code.FailedPrecondition);

    expenseScenario.lastCreate = {
      teamId: req.teamId,
      kind: req.kind,
      amount: req.amount,
      occurredAt: req.occurredAt,
      shopId: req.shopId,
      note: req.note,
      financeAccountId: req.financeAccountId,
    };

    const r: ExpenseFixture = {
      id: nextId++,
      teamId: req.teamId,
      shopId: req.shopId,
      kind: req.kind,
      amount: req.amount,
      occurredAt: req.occurredAt,
      note: req.note,
      createdBy: SELF_ID,
      createdAtUnix: now(),
      adjustsExpenseId: 0n,
      financeAccountId: req.financeAccountId,
    };
    rows.push(r);

    // A new expense has no adjustments yet: it counts for its own amount.
    return { expense: wire(r) };
  },

  expenseAdjust: (req) => {
    if (expenseScenario.faultNextAdjust) {
      expenseScenario.faultNextAdjust = false;
      throw new ConnectError("expense_service: dial tcp 127.0.0.1:5433: connect: connection refused", Code.Unavailable);
    }
    mayWrite();
    if (req.teamId === 0n) throw invalid("team_id: value must be greater than 0");
    if (req.expenseId === 0n) throw invalid("expense_id: value must be greater than 0");
    if (req.amount === 0) throw invalid("a correction of 0 corrects nothing");
    if ([...req.note].length > 500) throw invalid("note: value length must be at most 500 characters");

    expenseScenario.lastAdjust = { teamId: req.teamId, expenseId: req.expenseId, amount: req.amount, note: req.note };

    // The team clause IS the scope check — another team's expense is NotFound, never PermissionDenied.
    const expense = rows.find((r) => r.id === req.expenseId && r.teamId === req.teamId);
    if (!expense) throw new ConnectError("cost not found", Code.NotFound);
    if (expense.adjustsExpenseId !== 0n) {
      throw new ConnectError("an adjustment corrects an expense, never another adjustment", Code.FailedPrecondition);
    }
    if (netOf(expense) + req.amount < 0) {
      throw new ConnectError("the correction would take the expense below 0", Code.FailedPrecondition);
    }

    const adjustment: ExpenseFixture = {
      ...expense,
      id: nextId++,
      amount: req.amount,
      note: req.note,
      createdBy: SELF_ID,
      createdAtUnix: now(),
      adjustsExpenseId: expense.id,
    };
    rows.push(adjustment);

    return { adjustment: wire(adjustment), expense: wire(expense) };
  },
};

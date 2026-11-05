// The financial account service as Storybook's stub — docs/business/financial_account.
//
// It plays the rules backend/services/financial_account_service enforces, so a story fails when a screen
// stops honouring one; every refusal below names its decision. Built for the prototype, kept for the
// stories (the-prototype-and-its-contract-are-accepted).
//
// WRITEABLE, and the balance is DERIVED: an account holds no balance field here — it is the sum of its
// rows, and `balance_after` is computed in entry order on the way out. So "the balance moves only with a
// row" (the-accounts-are-one-ledger) is true of the stub by construction, not by care.
//
// The Finance metrics read the same rows, summed by day — what `financial_account_daily_reports` holds —
// so a transfer made in one story moves the report in the same story
// (the-daily-row-is-written-with-the-log-row: the report is never behind the balance).
//
// Module state survives between stories in one tab — preview.tsx calls `resetFinancialAccounts()` in its
// `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import { type Timestamp, timestampFromDate } from "@bufbuild/protobuf/wkt";

import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import { GroupType, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import { FinancialAccountAnalyticService } from "../src/gen/warehouse/financial_account/v1/financial_account_analytic_pb";
import { timeSpine } from "../src/features/analytic/provider";
import {
  CapitalDirection,
  FinancialAccountChangeType as T,
  FinancialAccountLogSort,
  FinancialAccountMetricDataType,
  FinancialAccountProvider,
  FinancialAccountRowSort,
  FinancialAccountService,
  FinancialAccountStatus,
  FinancialAccountType,
} from "../src/gen/warehouse/financial_account/v1/financial_account_pb";
import { type AccountFixture, financialAccountLogs, financialAccounts } from "./financialAccountFixtures";
import { dayKey, shops } from "./fixtures";

// ── The tables ──────────────────────────────────────────────────────────────────────────────────

type StubAccount = Omit<AccountFixture, "reconciledAgo" | "shopIds"> & {
  shopIds: bigint[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  reconciledAt?: Timestamp;
};

type StubLog = {
  id: bigint;
  teamId: bigint;
  accountId: bigint;
  changeType: T;
  change: number;
  description: string;
  actorId: bigint;
  /** The Jakarta day the money moved — what the daily report buckets by. */
  occurredOn: string;
  occurredAt: Timestamp;
  createdAt: Timestamp;
  groupId: bigint;
  counterAccountId: bigint;
};

// The signed-in person every hand row is recorded under — the stub's CheckAccess answers Ani.
const ACTOR = 61n;

const atTen = (day: string) => timestampFromDate(new Date(`${day}T10:00:00+07:00`));
const today = () => dayKey(0);

function seedAccounts(): StubAccount[] {
  return financialAccounts.map(({ reconciledAgo, ...a }) => ({
    ...a,
    shopIds: [...a.shopIds],
    createdAt: atTen(dayKey(60)),
    updatedAt: atTen(dayKey(reconciledAgo ?? 30)),
    // Exactly N×24h ago, not N days ago at 10:00: the relative label counts elapsed time, so a fixed
    // clock hour read "17 hours ago" before 10:00 WIB and "2 days ago" after 22:00.
    reconciledAt:
      reconciledAgo === undefined
        ? undefined
        : timestampFromDate(new Date(Date.now() - reconciledAgo * 86_400_000)),
  }));
}

function seedLogs(): StubLog[] {
  return financialAccountLogs.map((l) => ({
    id: l.id,
    teamId: financialAccounts.find((a) => a.id === l.accountId)!.teamId,
    accountId: l.accountId,
    changeType: l.changeType,
    change: l.change,
    description: l.description,
    actorId: l.actorId,
    occurredOn: dayKey(l.ago),
    occurredAt: atTen(dayKey(l.ago)),
    createdAt: atTen(dayKey(l.ago)),
    groupId: l.groupId ?? 0n,
    counterAccountId: l.counterAccountId ?? 0n,
  }));
}

let accounts = seedAccounts();
let logs = seedLogs();
let nextAccountId = 1350n;
let nextLogId = 1500n;
let nextGroupId = 100n;

export function resetFinancialAccounts() {
  accounts = seedAccounts();
  logs = seedLogs();
  nextAccountId = 1350n;
  nextLogId = 1500n;
  nextGroupId = 100n;
}

/**
 * A STORY'S SETUP: leave a shop withdrawing into no account. Every fixture shop is linked to one, and the contract has
 * no unlink (FinancialAccountShopSet only moves the link), so a shop page's "no withdrawal account" state is set here.
 * `resetFinancialAccounts` (preview's beforeEach) puts the link back.
 */
export function unlinkShopForStory(shopId: bigint) {
  for (const a of accounts) a.shopIds = a.shopIds.filter((id) => id !== shopId);
}

/**
 * A STORY'S SETUP: a team with NO operational account — nothing a Paid from may pick (the expense and restock forms
 * cannot be sent). `resetFinancialAccounts` (preview's beforeEach) marks them back.
 */
export function noOperationalAccountForStory(teamId: bigint) {
  for (const a of accounts) if (a.teamId === teamId) a.operational = false;
}

/**
 * A STORY'S SETUP: one account unmarked as operational — as an admin would, between a form loading its Paid from and
 * the person pressing Save. `resetFinancialAccounts` (preview's beforeEach) marks it back.
 */
export function unmarkOperationalForStory(accountId: bigint) {
  for (const a of accounts) if (a.id === accountId) a.operational = false;
}

/**
 * A STORY'S SETUP: one account archived — as an admin would, between a form loading its picker and the person pressing
 * Save. `resetFinancialAccounts` (preview's beforeEach) brings it back.
 */
export function archiveAccountForStory(accountId: bigint) {
  for (const a of accounts) if (a.id === accountId) a.status = FinancialAccountStatus.ARCHIVED;
}

/**
 * Whether an account may pay a warehouse transfer's shipping — the team's own and ACTIVE, operational or not
 * (a-transfers-shipping-is-paid-from-any-active-account; inventory_v1 `checkActive`). `null` when it may; else the
 * server's FailedPrecondition sentence. Another team's account reads as one that never existed.
 */
export function activeAccountRefusal(teamId: bigint, accountId: bigint): string | null {
  const a = accounts.find((x) => x.id === accountId && x.teamId === teamId);
  const why = "not one of the team's active accounts";
  if (!a) return `account #${accountId} is ${why}`;
  if (a.status === FinancialAccountStatus.ARCHIVED) return `${a.name} is archived — it is ${why}`;
  return null;
}

/**
 * Whether an account may pay a team's expense — what expense_service asks financial_account in-process
 * (expense_v1/paying_accounts.go): the team's own, active, marked operational. `null` when it may; else the server's
 * FailedPrecondition sentence, naming it. Another team's account reads as one that never existed.
 */
export function payingAccountRefusal(teamId: bigint, accountId: bigint): string | null {
  const a = accounts.find((x) => x.id === accountId && x.teamId === teamId);
  const why = "not one of the team's active operational accounts";
  if (!a) return `account #${accountId} is ${why}`;
  if (a.status === FinancialAccountStatus.ARCHIVED) return `${a.name} is archived — it is ${why}`;
  if (!a.operational) return `${a.name} is ${why} — pick another, or ask an admin to mark it operational`;
  return null;
}

// ── The arithmetic ──────────────────────────────────────────────────────────────────────────────

// Whole rupiah as a row posts (rupiah-is-floating-point's mitigation) — so a balance compares exactly.
const rupiah = (n: number) => Math.round(n);

const balanceOf = (accountId: bigint) =>
  logs.filter((l) => l.accountId === accountId).reduce((sum, l) => sum + l.change, 0);

function wireAccount(a: StubAccount) {
  return {
    id: a.id,
    teamId: a.teamId,
    type: a.type,
    provider: a.provider,
    status: a.status,
    accountNumber: a.accountNumber,
    name: a.name,
    holderName: a.holderName,
    description: a.description,
    operational: a.operational,
    shopIds: [...a.shopIds],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// `balance_after` in ENTRY order, per account (the-log-says-balance-after).
function wireLog(l: StubLog) {
  const before = logs.filter((x) => x.accountId === l.accountId && x.id <= l.id);

  return {
    id: l.id,
    teamId: l.teamId,
    accountId: l.accountId,
    changeType: l.changeType,
    change: l.change,
    balanceAfter: before.reduce((sum, x) => sum + x.change, 0),
    description: l.description,
    actorId: l.actorId,
    occurredAt: l.occurredAt,
    createdAt: l.createdAt,
    groupId: l.groupId,
    counterAccountId: l.counterAccountId,
  };
}

// Another team's account is ABSENT — NotFound, never "permission denied", so an id leaks nothing.
function teamAccount(teamId: bigint, accountId: bigint): StubAccount {
  const found = accounts.find((a) => a.id === accountId && a.teamId === teamId);
  if (!found) throw new ConnectError(`account ${accountId} not found`, Code.NotFound);

  return found;
}

// A hand row is refused on an archived account (an-account-is-archived-only-at-zero, my spec).
function mustBeActive(a: StubAccount) {
  if (a.status === FinancialAccountStatus.ARCHIVED) {
    throw new ConnectError(`${a.name} is archived — restore it first`, Code.FailedPrecondition);
  }
}

// A picked day is never in the future: money cannot have moved tomorrow.
function mustBePast(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ConnectError("pick a day", Code.InvalidArgument);
  if (day > today()) throw new ConnectError("the day cannot be in the future", Code.InvalidArgument);
}

function post(
  a: StubAccount,
  changeType: T,
  change: number,
  description: string,
  occurredOn: string,
  extra: { groupId?: bigint; counterAccountId?: bigint } = {},
): StubLog {
  const row: StubLog = {
    id: nextLogId++,
    teamId: a.teamId,
    accountId: a.id,
    changeType,
    change: rupiah(change),
    description,
    actorId: ACTOR,
    occurredOn,
    occurredAt: atTen(occurredOn),
    createdAt: timestampFromDate(new Date()),
    groupId: extra.groupId ?? 0n,
    counterAccountId: extra.counterAccountId ?? 0n,
  };

  logs.push(row);
  a.updatedAt = timestampFromDate(new Date());

  return row;
}

// One real account, one row (a-real-account-is-recorded-once): provider + number across ALL teams,
// archived included. A cash box and an unknown account carry no number and are exempt.
function mustBeUnregistered(provider: FinancialAccountProvider, accountNumber: string, except?: bigint) {
  const number = accountNumber.trim();
  if (number === "") return;

  const taken = accounts.find((a) => a.id !== except && a.provider === provider && a.accountNumber === number);
  if (taken) {
    throw new ConnectError(
      `this account is already recorded${taken.status === FinancialAccountStatus.ARCHIVED ? " (archived)" : ""} — one real account, one row`,
      Code.AlreadyExists,
    );
  }
}

// A name is unique in the team (my spec) — a picker never shows two of the same.
function mustBeUniqueName(teamId: bigint, name: string, except?: bigint) {
  const clash = accounts.find(
    (a) => a.teamId === teamId && a.id !== except && a.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (clash) throw new ConnectError(`the team already has an account named ${clash.name}`, Code.AlreadyExists);
}

function transferLegs(from: StubAccount, to: StubAccount, amount: number, day: string, note: string) {
  const groupId = nextGroupId++;
  const suffix = note.trim() ? ` — ${note.trim()}` : "";

  return [
    post(from, T.TRANSFER, -amount, `To ${to.name}${suffix}`, day, { groupId, counterAccountId: to.id }),
    post(to, T.TRANSFER, amount, `From ${from.name}${suffix}`, day, { groupId, counterAccountId: from.id }),
  ];
}

// ── The paged envelopes ─────────────────────────────────────────────────────────────────────────

type PageReq = { page?: number; limit?: number } | undefined;

function window<R>(rows: R[], page: PageReq) {
  const limit = page?.limit || 20;
  const current = page?.page || 1;

  return {
    rows: rows.slice((current - 1) * limit, current * limit),
    pageInfo: {
      currentPage: current,
      totalPage: Math.max(1, Math.ceil(rows.length / limit)),
      totalItems: BigInt(rows.length),
    },
  };
}

const matches = (q: string | undefined, ...fields: string[]) => {
  const needle = (q ?? "").trim().toLowerCase();

  return !needle || fields.some((f) => f.toLowerCase().includes(needle));
};

// ── FinancialAccountService ─────────────────────────────────────────────────────────────────────

// The server's `listOrder`: a heading's sort when one is asked — the provider by its stored word, as the
// column is text — else active before archived, then by name.
function listOrder(sort: { sortType: CommonSortType; s: { case: string | undefined; value?: unknown } } | undefined) {
  const flip = sort?.sortType === CommonSortType.DESC ? -1 : 1;
  const by = sort?.s.case === "account" ? (sort.s.value as FinancialAccountRowSort) : undefined;

  return (x: StubAccount, y: StubAccount) => {
    if (by === FinancialAccountRowSort.NAME) return flip * x.name.localeCompare(y.name);
    if (by === FinancialAccountRowSort.PROVIDER) {
      const word = (a: StubAccount) => FinancialAccountProvider[a.provider].toLowerCase();
      return flip * word(x).localeCompare(word(y)) || x.name.localeCompare(y.name);
    }
    return x.status - y.status || x.name.localeCompare(y.name);
  };
}

export const financialAccountService: Partial<ServiceImpl<typeof FinancialAccountService>> = {
  financialAccountList: (req) => {
    const f = req.filter;
    const rows = accounts
      .filter((a) => a.teamId === req.teamId)
      // archived_only wins over include_archived, as on the server (the-archive-is-its-own-view).
      .filter((a) =>
        f?.archivedOnly
          ? a.status === FinancialAccountStatus.ARCHIVED
          : f?.includeArchived || a.status === FinancialAccountStatus.ACTIVE,
      )
      .filter((a) => !f?.operationalOnly || a.operational)
      .filter((a) => !f?.types?.length || f.types.includes(a.type))
      .filter((a) => !f?.shopId || a.shopIds.includes(f.shopId))
      .filter((a) => matches(f?.q, a.name, a.holderName, a.accountNumber))
      .sort(listOrder(req.sort));

    const { rows: page, pageInfo } = window(rows, req.page);
    const mapData = Object.fromEntries(page.map((a) => [a.id.toString(), wireAccount(a)]));

    return {
      items: [{ d: { case: "account" as const, value: { mapData } } }],
      ids: page.map((a) => a.id),
      pageInfo,
    };
  },

  // Archived accounts come back — an old restock still names who paid. Another team's are absent.
  financialAccountByIds: (req) => {
    const items: Record<string, { items: { d: { case: "account"; value: { mapData: Record<string, ReturnType<typeof wireAccount>> } } }[] }> = {};

    for (const id of req.filter?.ids ?? []) {
      const a = accounts.find((x) => x.id === id && x.teamId === req.teamId);
      if (!a) continue;

      items[id.toString()] = { items: [{ d: { case: "account", value: { mapData: { [id.toString()]: wireAccount(a) } } } }] };
    }

    return { items };
  },

  financialAccountOverview: (req) => {
    const out = [];

    if (req.metricRequest.includes(FinancialAccountMetricDataType.BALANCE)) {
      const mapData = Object.fromEntries(
        (req.filter?.accountIds ?? [])
          .map((id) => accounts.find((a) => a.id === id && a.teamId === req.teamId))
          .filter((a): a is StubAccount => !!a)
          .map((a) => [a.id.toString(), { accountId: a.id, balance: balanceOf(a.id), reconciledAt: a.reconciledAt }]),
      );
      out.push({ d: { case: "balance" as const, value: { mapData } } });
    }

    if (req.metricRequest.includes(FinancialAccountMetricDataType.TYPE_TOTAL)) {
      // The active by default; `archived` counts the archived instead — the archive view's tabs.
      const status = req.filter?.archived ? FinancialAccountStatus.ARCHIVED : FinancialAccountStatus.ACTIVE;
      const active = accounts.filter((a) => a.teamId === req.teamId && a.status === status);
      const types = [
        FinancialAccountType.BANK_ACCOUNT,
        FinancialAccountType.WALLET,
        FinancialAccountType.CASH,
        FinancialAccountType.UNKNOWN,
      ];

      const items = types
        .map((type) => {
          const ofType = active.filter((a) => a.type === type);

          return {
            type,
            balance: ofType.reduce((sum, a) => sum + balanceOf(a.id), 0),
            accountCount: BigInt(ofType.length),
            belowZeroCount: BigInt(ofType.filter((a) => balanceOf(a.id) < 0).length),
          };
        })
        .filter((t) => t.accountCount > 0n);

      out.push({ d: { case: "typeTotal" as const, value: { items } } });
    }

    return { items: out };
  },

  financialAccountLogList: (req) => {
    const f = req.filter;
    teamAccount(req.teamId, f?.accountId ?? 0n);

    const byOccurred = req.sort?.s.case === "log" && req.sort.s.value === FinancialAccountLogSort.OCCURRED_AT;
    const ascending = req.sort?.sortType === CommonSortType.ASC;

    const rows = logs
      .filter((l) => l.accountId === f?.accountId)
      .filter((l) => !f?.changeTypes?.length || f.changeTypes.includes(l.changeType))
      .filter((l) => !f?.occurredFrom || l.occurredOn >= f.occurredFrom)
      .filter((l) => !f?.occurredTo || l.occurredOn <= f.occurredTo)
      .sort((x, y) => {
        const by = byOccurred ? x.occurredOn.localeCompare(y.occurredOn) || Number(x.id - y.id) : Number(x.id - y.id);

        return ascending ? by : -by;
      });

    const { rows: page, pageInfo } = window(rows, req.page);
    const mapData = Object.fromEntries(page.map((l) => [l.id.toString(), wireLog(l)]));

    return {
      items: [{ d: { case: "log" as const, value: { mapData } } }],
      ids: page.map((l) => l.id),
      pageInfo,
    };
  },

  // Posts `opening_balance` in the same act — even at 0 (an-account-opens-with-a-log-row).
  //
  // ⚠ THE DEMO ACCEPTS TYPE LAINNYA (`unknown`, its provider Lainnya, its number optional) — the real server does
  // NOT yet (owner: *"untuk lainnya buat aja dulu demonya saja … kita tidak akan mengubah api apapun"*,
  // the-type-decides-the-provider). The screens mark it unimplemented.
  financialAccountCreate: (req) => {
    if ((req.type === FinancialAccountType.UNKNOWN) !== (req.provider === FinancialAccountProvider.UNKNOWN)) {
      throw new ConnectError("type Lainnya and provider Lainnya go together", Code.InvalidArgument);
    }
    if (req.type !== FinancialAccountType.CASH && req.type !== FinancialAccountType.UNKNOWN && req.accountNumber.trim() === "") {
      throw new ConnectError("a bank account or a wallet needs its number", Code.InvalidArgument);
    }
    if (!req.name.trim()) throw new ConnectError("name the account", Code.InvalidArgument);
    mustBePast(req.openingOn);
    mustBeUniqueName(req.teamId, req.name);
    mustBeUnregistered(req.provider, req.accountNumber);

    const now = timestampFromDate(new Date());
    const a: StubAccount = {
      id: nextAccountId++,
      teamId: req.teamId,
      type: req.type,
      provider: req.provider,
      status: FinancialAccountStatus.ACTIVE,
      accountNumber: req.accountNumber.trim(),
      name: req.name.trim(),
      holderName: req.holderName.trim(),
      description: req.description,
      operational: false,
      shopIds: [],
      createdAt: now,
      updatedAt: now,
    };

    accounts.push(a);
    post(a, T.OPENING_BALANCE, req.openingBalance, "Opening balance", req.openingOn);

    return { account: wireAccount(a) };
  },

  financialAccountUpdate: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    if (!req.name.trim()) throw new ConnectError("name the account", Code.InvalidArgument);
    mustBeUniqueName(req.teamId, req.name, a.id);

    a.name = req.name.trim();
    a.holderName = req.holderName.trim();
    a.description = req.description;
    a.updatedAt = timestampFromDate(new Date());

    return { account: wireAccount(a) };
  },

  // (an-unknown-account-is-filled-in-or-moved-in)
  financialAccountIdentify: (req) => {
    const unknown = teamAccount(req.teamId, req.accountId);
    if (unknown.type !== FinancialAccountType.UNKNOWN) {
      throw new ConnectError(`${unknown.name} is not an unknown account`, Code.FailedPrecondition);
    }

    if (req.target.case === "fillIn") {
      const t = req.target.value;
      if (t.type !== FinancialAccountType.CASH && t.accountNumber.trim() === "") {
        throw new ConnectError("a bank account or a wallet needs its number", Code.InvalidArgument);
      }
      mustBeUniqueName(req.teamId, t.name, unknown.id);
      try {
        mustBeUnregistered(t.provider, t.accountNumber, unknown.id);
      } catch {
        throw new ConnectError(
          "this account is already recorded — choose it under “It is one we already have” to move the money into it",
          Code.AlreadyExists,
        );
      }

      unknown.type = t.type;
      unknown.provider = t.provider;
      unknown.accountNumber = t.accountNumber.trim();
      unknown.holderName = t.holderName.trim();
      unknown.name = t.name.trim();
      unknown.updatedAt = timestampFromDate(new Date());

      return { account: wireAccount(unknown) };
    }

    if (req.target.case === "moveIntoAccountId") {
      const real = teamAccount(req.teamId, req.target.value);
      if (real.id === unknown.id || real.type === FinancialAccountType.UNKNOWN) {
        throw new ConnectError("move it into a real account", Code.InvalidArgument);
      }
      mustBeActive(real);

      // One act: the balance across, the shops re-pointed, the unknown archived at zero.
      const balance = balanceOf(unknown.id);
      if (balance !== 0) transferLegs(unknown, real, balance, today(), "the bank was named");

      real.shopIds = [...new Set([...real.shopIds, ...unknown.shopIds])];
      unknown.shopIds = [];
      unknown.status = FinancialAccountStatus.ARCHIVED;
      unknown.updatedAt = timestampFromDate(new Date());

      return { account: wireAccount(real) };
    }

    throw new ConnectError("fill it in, or move it into an account", Code.InvalidArgument);
  },

  // Only at zero (an-account-is-archived-only-at-zero).
  financialAccountArchive: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    const balance = balanceOf(a.id);
    if (balance !== 0) {
      throw new ConnectError(
        `${a.name} still holds Rp ${balance.toLocaleString("id-ID")} — move it out first`,
        Code.FailedPrecondition,
      );
    }

    a.status = FinancialAccountStatus.ARCHIVED;
    a.operational = false;
    a.updatedAt = timestampFromDate(new Date());

    return { account: wireAccount(a) };
  },

  financialAccountRestore: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    a.status = FinancialAccountStatus.ACTIVE;
    a.updatedAt = timestampFromDate(new Date());

    return { account: wireAccount(a) };
  },

  // Two legs, one act. Below zero is allowed (below-zero-is-warned-never-refused).
  financialAccountTransfer: (req) => {
    const from = teamAccount(req.teamId, req.fromAccountId);
    const to = teamAccount(req.teamId, req.toAccountId);
    if (from.id === to.id) throw new ConnectError("pick two different accounts", Code.InvalidArgument);
    if (to.type === FinancialAccountType.UNKNOWN) {
      throw new ConnectError("money cannot go INTO an unknown account", Code.InvalidArgument);
    }
    mustBeActive(from);
    mustBeActive(to);
    if (!(req.amount > 0)) throw new ConnectError("type an amount", Code.InvalidArgument);
    mustBePast(req.occurredOn);

    return { logs: transferLegs(from, to, rupiah(req.amount), req.occurredOn, req.note).map(wireLog) };
  },

  financialAccountCapital: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    mustBeActive(a);
    if (!(req.amount > 0)) throw new ConnectError("type an amount", Code.InvalidArgument);
    mustBePast(req.occurredOn);

    const inward = req.direction === CapitalDirection.IN;
    const note = req.note.trim();
    const row = post(
      a,
      T.CAPITAL,
      inward ? req.amount : -req.amount,
      `Capital ${inward ? "in" : "out"}${note ? ` — ${note}` : ""}`,
      req.occurredOn,
    );

    return { log: wireLog(row) };
  },

  // The bank's figure in, the difference posted (adjustment-is-for-reconciling-only).
  financialAccountReconcile: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    mustBeActive(a);
    if (a.type === FinancialAccountType.UNKNOWN) {
      throw new ConnectError("an unknown account has no statement to read — name its bank first", Code.FailedPrecondition);
    }
    mustBePast(req.asOf);

    const difference = rupiah(req.actualBalance) - balanceOf(a.id);
    const note = req.note.trim();
    if (difference !== 0 && !note) {
      throw new ConnectError("say why the books and the bank differ", Code.InvalidArgument);
    }

    const row =
      difference === 0
        ? undefined
        : post(a, T.ADJUSTMENT, difference, `Reconcile — the ${a.type === FinancialAccountType.CASH ? "box counted" : "app showed"} Rp ${rupiah(req.actualBalance).toLocaleString("id-ID")} · ${note}`, req.asOf);

    a.reconciledAt = timestampFromDate(new Date());

    return { difference, log: row ? wireLog(row) : undefined, reconciledAt: a.reconciledAt };
  },

  // A shop names one account (a-shop-has-one-account) — pointing it here moves it off the last one.
  financialAccountShopSet: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    mustBeActive(a);
    if (a.type === FinancialAccountType.UNKNOWN) {
      throw new ConnectError("point the shop at a real account", Code.InvalidArgument);
    }
    if (!shops.some((s) => s.id === req.shopId && s.teamId === req.teamId)) {
      throw new ConnectError(`shop ${req.shopId} not found`, Code.NotFound);
    }

    const previous = accounts.find((x) => x.shopIds.includes(req.shopId));
    for (const x of accounts) x.shopIds = x.shopIds.filter((id) => id !== req.shopId);
    a.shopIds.push(req.shopId);

    return { account: wireAccount(a), previousAccountId: previous?.id ?? 0n };
  },

  financialAccountOperationalSet: (req) => {
    const a = teamAccount(req.teamId, req.accountId);
    if (req.operational) {
      mustBeActive(a);
      if (a.type === FinancialAccountType.UNKNOWN) {
        throw new ConnectError("an unknown account cannot pay for operations", Code.InvalidArgument);
      }
    }

    a.operational = req.operational;
    a.updatedAt = timestampFromDate(new Date());

    return { account: wireAccount(a) };
  },
};

// ── FinancialAccountAnalyticService — the Finance metrics ───────────────────────────────────────────
//
// `metrics/financial_accounts` and `metrics/financial_accounts/types` (financial-accounts-serve-their-changes-and-their-
// types), folded from the stub's OWN ledger, as the server folds `financial_account_daily_reports` — so a transfer a
// story makes moves both the accounts page and every report in the same story. The rules the server keeps:
//   - every team reads its own accounts, the root team its own too (every-team-reads-its-own-finance);
//   - a balance is one running sum: the balance before the window, then each period's change in date order
//     (the-balance-series-is-a-running-sum) — a period cut by the range opens on the range's first day;
//   - an account with a row up to the window's end is a key, a quiet one included; a change type is a key when it moved;
//   - money out is negative; the change type OPENING_BALANCE is `account_opening`, the position `opening_balance`.

const CHANGE_FIELD: Record<number, string> = {
  [T.EXPENSE]: "expense",
  [T.ADS_EXPENSE]: "adsExpense",
  [T.ADJUSTMENT]: "adjustment",
  [T.WITHDRAWAL]: "withdrawal",
  [T.RESTOCK]: "restock",
  [T.OPENING_BALANCE]: "accountOpening",
  [T.TRANSFER]: "transfer",
  [T.TEAM_PAYMENT]: "teamPayment",
  [T.CAPITAL]: "capital",
};

/** One key's figures — the AccountChangeMetric's fields by their JS names. */
type Figures = Record<string, number>;

const zeroFigures = (): Figures => {
  const f: Figures = { openingBalance: 0, change: 0, closingBalance: 0 };
  for (const name of Object.values(CHANGE_FIELD)) f[name] = 0;

  return f;
};

const CHANGES_ID = "metrics/financial_accounts";
const TYPES_ID = "metrics/financial_accounts/types";

interface FinanceFilters {
  from: string;
  to: string;
  accounts: bigint[];
}

type AnyFilter = { f: { case: string | undefined; value?: unknown } };

function financeFilters(filters: AnyFilter[], metricIds: string[]): FinanceFilters {
  for (const id of metricIds) {
    if (id !== CHANGES_ID && id !== TYPES_ID) {
      throw new ConnectError(`this service does not serve "${id}"`, Code.InvalidArgument);
    }
  }

  const out: FinanceFilters = { from: "", to: "", accounts: [] };
  for (const item of filters) {
    if (item.f.case === "dateRangeFilter") {
      const range = item.f.value as { dateMin: string; dateMax: string };
      out.from = range.dateMin;
      out.to = range.dateMax;
    } else if (item.f.case === "accountFilter") {
      out.accounts = (item.f.value as { accountIds: bigint[] }).accountIds;
    } else {
      // finance-filters-by-account: the date range and the Account filter, nothing else.
      throw new ConnectError(`the Finance metrics do not support ${item.f.case}`, Code.InvalidArgument);
    }
  }

  if (!out.from || !out.to) throw new ConnectError("the Finance metrics require a date range", Code.InvalidArgument);

  return out;
}

/** The team's rows, narrowed to the Account filter — never another team's (every-team-reads-its-own-finance). */
function scopedRows(teamId: bigint, filters: FinanceFilters): StubLog[] {
  return logs.filter((l) => l.teamId === teamId && (filters.accounts.length === 0 || filters.accounts.includes(l.accountId)));
}

/** A set of rows over a window: the balance before it, what moved inside it, by type, and the balance at its end. */
function foldWindow(rows: StubLog[], from: string, to: string, opening?: number): Figures {
  const f = zeroFigures();
  f.openingBalance = opening ?? rows.filter((l) => l.occurredOn < from).reduce((s, l) => s + l.change, 0);

  for (const l of rows) {
    if (l.occurredOn < from || l.occurredOn > to) continue;
    f[CHANGE_FIELD[l.changeType]!] = (f[CHANGE_FIELD[l.changeType]!] ?? 0) + l.change;
    f.change! += l.change;
  }

  f.closingBalance = f.openingBalance! + f.change!;

  return f;
}

const GROUP_TIME = new Set([GroupType.DAILY, GroupType.WEEKLY, GroupType.MONTHLY, GroupType.YEARLY]);
const TIME_OF: Partial<Record<GroupType, "daily" | "weekly" | "monthly" | "yearly">> = {
  [GroupType.DAILY]: "daily",
  [GroupType.WEEKLY]: "weekly",
  [GroupType.MONTHLY]: "monthly",
  [GroupType.YEARLY]: "yearly",
};

/** The last day of the period starting on `key`. */
function periodEnd(key: string, group: "daily" | "weekly" | "monthly" | "yearly"): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (group === "weekly") d.setUTCDate(d.getUTCDate() + 6);
  if (group === "monthly") d.setUTCMonth(d.getUTCMonth() + 1, 0);
  if (group === "yearly") d.setUTCFullYear(d.getUTCFullYear(), 11, 31);

  return d.toISOString().slice(0, 10);
}

/** Every period of the window, oldest first, each carrying the running balance. */
function financeSeries(teamId: bigint, group: GroupType, filters: FinanceFilters): Map<string, Figures> {
  const time = TIME_OF[group]!;
  const rows = scopedRows(teamId, filters);
  const out = new Map<string, Figures>();

  let running = rows.filter((l) => l.occurredOn < filters.from).reduce((s, l) => s + l.change, 0);
  for (const key of timeSpine(filters.from, filters.to, time)) {
    const from = key < filters.from ? filters.from : key;
    const end = periodEnd(key, time);
    const f = foldWindow(rows, from, end < filters.to ? end : filters.to, running);
    running = f.closingBalance!;
    out.set(key, f);
  }

  return out;
}

/** The id keys of a group, each with its figures — in key order. */
function financeIdKeys(teamId: bigint, group: GroupType, filters: FinanceFilters): Map<string, Figures> {
  const rows = scopedRows(teamId, filters);
  const held = accounts.filter((a) => a.teamId === teamId && rows.some((l) => l.accountId === a.id && l.occurredOn <= filters.to));
  const out = new Map<string, Figures>();

  if (group === GroupType.ACCOUNT) {
    for (const a of held) out.set(a.id.toString(), foldWindow(rows.filter((l) => l.accountId === a.id), filters.from, filters.to));
  } else if (group === GroupType.PROVIDER) {
    for (const provider of [...new Set(held.map((a) => a.provider))].sort((x, y) => x - y)) {
      const ids = held.filter((a) => a.provider === provider).map((a) => a.id);
      out.set(String(provider), foldWindow(rows.filter((l) => ids.includes(l.accountId)), filters.from, filters.to));
    }
  } else if (group === GroupType.CHANGE_TYPE) {
    const moved = rows.filter((l) => l.occurredOn >= filters.from && l.occurredOn <= filters.to && l.change !== 0);
    for (const type of [...new Set(moved.map((l) => l.changeType))].sort((x, y) => x - y)) {
      // A type's figure, and no balance — a balance belongs to an account, not to a type.
      const f = zeroFigures();
      f.change = moved.filter((l) => l.changeType === type).reduce((s, l) => s + l.change, 0);
      out.set(String(type), f);
    }
  } else {
    throw new ConnectError(`the Finance metrics cannot be grouped by ${GroupType[group]}`, Code.InvalidArgument);
  }

  return out;
}

/** The two metrics' messages for one key. */
const changesOf = (f: Figures) => ({ ...f });
const typesOf = (f: Figures) => ({ amount: f.change ?? 0 });

const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function checkGroupOf(metricIds: string[], group: GroupType) {
  // Account changes cannot be grouped by change type — a balance belongs to an account (the picker greys it).
  if (group === GroupType.CHANGE_TYPE && metricIds.includes(CHANGES_ID)) {
    throw new ConnectError("metrics/financial_accounts cannot be grouped by GROUP_TYPE_CHANGE_TYPE", Code.InvalidArgument);
  }
}

export const financialAccountAnalyticService: Partial<ServiceImpl<typeof FinancialAccountAnalyticService>> = {
  metricSearch: (req) => {
    const metricId = req.sort?.metricId ?? "";
    const filters = financeFilters(req.filters as AnyFilter[], [metricId]);
    checkGroupOf([metricId], req.groupBy);

    const time = GROUP_TIME.has(req.groupBy);
    const all = time ? financeSeries(req.teamId, req.groupBy, filters) : financeIdKeys(req.teamId, req.groupBy, filters);
    const field = camel(req.sort?.field ?? "");
    const value = (f: Figures) => (metricId === TYPES_ID ? typesOf(f).amount : (f[field] ?? 0));
    const desc = req.sort?.sortType !== SortType.ASC;
    const byKey = (a: string, b: string) => (time ? (a < b ? -1 : a > b ? 1 : 0) : Number(a) - Number(b));

    const ranked = [...all.entries()].sort(([ka, a], [kb, b]) => (desc ? value(b) - value(a) : value(a) - value(b)) || -byKey(ka, kb));
    const offset = req.page?.offset ?? 0;
    const limit = req.page?.limit ?? 20;
    const page = ranked.slice(offset, offset + limit + 1);
    const keys = page.slice(0, limit).map(([k]) => k);

    return {
      keys: time ? { k: { case: "days", value: { days: keys } } } : { k: { case: "ids", value: { ids: keys.map((k) => BigInt(k)) } } },
      hasNext: page.length > limit,
    };
  },

  metricData: (req) => {
    const filters = financeFilters(req.filters as AnyFilter[], req.metricIds);
    checkGroupOf(req.metricIds, req.groupBy);
    const asOfUnix = BigInt(Math.floor(Date.now() / 1000));

    if (req.groupBy === GroupType.SUMMARY) {
      const total = foldWindow(scopedRows(req.teamId, filters), filters.from, filters.to);

      return {
        asOfUnix,
        metricDatas: req.metricIds.map((id) =>
          id === CHANGES_ID
            ? { m: { case: "changesSummary" as const, value: changesOf(total) } }
            : { m: { case: "typesSummary" as const, value: typesOf(total) } },
        ),
      };
    }

    if (GROUP_TIME.has(req.groupBy)) {
      const asked = req.keys?.k.case === "days" ? req.keys.k.value.days : [];
      const series = financeSeries(req.teamId, req.groupBy, filters);
      const at = (k: string) => series.get(k) ?? zeroFigures();

      return {
        asOfUnix,
        metricDatas: req.metricIds.map((id) =>
          id === CHANGES_ID
            ? { m: { case: "changesByDay" as const, value: { items: Object.fromEntries(asked.map((k) => [k, changesOf(at(k))])) } } }
            : { m: { case: "typesByDay" as const, value: { items: Object.fromEntries(asked.map((k) => [k, typesOf(at(k))])) } } },
        ),
      };
    }

    const asked = req.keys?.k.case === "ids" ? req.keys.k.value.ids : [];
    const keyed = financeIdKeys(req.teamId, req.groupBy, filters);
    const of = (id: bigint) => keyed.get(id.toString()) ?? zeroFigures();

    return {
      asOfUnix,
      metricDatas: req.metricIds.map((id) =>
        id === CHANGES_ID
          ? { m: { case: "changesById" as const, value: { items: Object.fromEntries(asked.map((k) => [k.toString(), changesOf(of(k))])) } } }
          : { m: { case: "typesById" as const, value: { items: Object.fromEntries(asked.map((k) => [k.toString(), typesOf(of(k))])) } } },
      ),
    };
  },
};

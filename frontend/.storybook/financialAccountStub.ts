// The financial account service as the prototype's stub — docs/business/financial_account.
//
// ⚠ PROTOTYPE for design_accept. Nothing serves warehouse.financial_account.v1 yet; this plays the
// decided rules so the screens can be judged against them, and every refusal below names its decision.
//
// WRITEABLE, and the balance is DERIVED: an account holds no balance field here — it is the sum of its
// rows, and `balance_after` is computed in entry order on the way out. So "the balance moves only with a
// row" (the-accounts-are-one-ledger) is true of the stub by construction, not by care.
//
// The analytics read the same rows, summed by day — what `financial_account_daily_reports` will hold —
// so a transfer made in one story moves the report in the same story
// (the-daily-row-is-written-with-the-log-row: the report is never behind the balance).
//
// Module state survives between stories in one tab — preview.tsx calls `resetFinancialAccounts()` in its
// `beforeEach`.

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import { type Timestamp, timestampFromDate } from "@bufbuild/protobuf/wkt";

import { CommonSortType } from "../src/gen/warehouse/common/v1/list_pb";
import {
  AnalyticGroupType,
  AnalyticMetricSort,
  AnalyticTimeframe,
  CapitalDirection,
  FinancialAccountAnalyticService,
  FinancialAccountChangeType as T,
  FinancialAccountLogSort,
  FinancialAccountMetricDataType,
  FinancialAccountProvider,
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
    reconciledAt: reconciledAgo === undefined ? undefined : atTen(dayKey(reconciledAgo)),
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

export const financialAccountService: Partial<ServiceImpl<typeof FinancialAccountService>> = {
  financialAccountList: (req) => {
    const f = req.filter;
    const rows = accounts
      .filter((a) => a.teamId === req.teamId)
      .filter((a) => f?.includeArchived || a.status === FinancialAccountStatus.ACTIVE)
      .filter((a) => !f?.operationalOnly || a.operational)
      .filter((a) => !f?.types?.length || f.types.includes(a.type))
      .filter((a) => !f?.shopId || a.shopIds.includes(f.shopId))
      .filter((a) => matches(f?.q, a.name, a.holderName, a.accountNumber))
      // Active before archived, then by name — the list's default order.
      .sort((x, y) => x.status - y.status || x.name.localeCompare(y.name));

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
      const active = accounts.filter((a) => a.teamId === req.teamId && a.status === FinancialAccountStatus.ACTIVE);
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
  financialAccountCreate: (req) => {
    if (req.type === FinancialAccountType.UNKNOWN || req.provider === FinancialAccountProvider.UNKNOWN) {
      throw new ConnectError("an unknown account is made only by a withdrawal", Code.InvalidArgument);
    }
    if (req.type !== FinancialAccountType.CASH && req.accountNumber.trim() === "") {
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

// ── FinancialAccountAnalyticService ─────────────────────────────────────────────────────────────

const COLUMN: Record<number, keyof Omit<Metric, "change" | "openBalance" | "closeBalance">> = {
  [T.EXPENSE]: "expense",
  [T.ADS_EXPENSE]: "adsExpense",
  [T.ADJUSTMENT]: "adjustment",
  [T.WITHDRAWAL]: "withdrawal",
  [T.RESTOCK]: "restock",
  [T.OPENING_BALANCE]: "openingBalance",
  [T.TRANSFER]: "transfer",
  [T.TEAM_PAYMENT]: "teamPayment",
  [T.CAPITAL]: "capital",
};

type Metric = {
  expense: number;
  adsExpense: number;
  adjustment: number;
  withdrawal: number;
  restock: number;
  openingBalance: number;
  transfer: number;
  teamPayment: number;
  capital: number;
  change: number;
  openBalance: number;
  closeBalance: number;
};

const zero = (): Metric => ({
  expense: 0,
  adsExpense: 0,
  adjustment: 0,
  withdrawal: 0,
  restock: 0,
  openingBalance: 0,
  transfer: 0,
  teamPayment: 0,
  capital: 0,
  change: 0,
  openBalance: 0,
  closeBalance: 0,
});

// The movements in [start, end], and the balance carried up to `end`.
function metricOf(rows: StubLog[], start: string, end: string): Metric {
  const m = zero();

  for (const l of rows) {
    if (l.occurredOn > end) continue;
    m.closeBalance += l.change;
    if (l.occurredOn < start) continue;
    m[COLUMN[l.changeType]!] += l.change;
    m.change += l.change;
  }

  m.openBalance = m.closeBalance - m.change;

  return m;
}

const teamRows = (teamId: bigint) => logs.filter((l) => l.teamId === teamId);

// Every bucket from start to end, ascending: `yyyy-mm-dd`, `yyyy-mm` or `yyyy`.
function buckets(start: string, end: string, width: number): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(last)) return [];

  const out: string[] = [];
  for (let at = first; at <= last && out.length < 800; at += 86_400_000) {
    const label = new Date(at).toISOString().slice(0, width);
    if (out[out.length - 1] !== label) out.push(label);
  }

  return out;
}

type GroupKey =
  | { case: "accountId"; value: bigint }
  | { case: "provider"; value: FinancialAccountProvider }
  | { case: "changeType"; value: T };

function rowsOfKey(teamId: bigint, key: GroupKey): StubLog[] {
  const rows = teamRows(teamId);

  if (key.case === "accountId") return rows.filter((l) => l.accountId === key.value);
  if (key.case === "provider") {
    return rows.filter((l) => accounts.find((a) => a.id === l.accountId)?.provider === key.value);
  }

  return rows.filter((l) => l.changeType === key.value);
}

function groupMetric(teamId: bigint, key: GroupKey, start: string, end: string): Metric {
  const m = metricOf(rowsOfKey(teamId, key), start, end);

  // A balance belongs to an account, not to a type.
  if (key.case === "changeType") {
    m.openBalance = 0;
    m.closeBalance = 0;
  }

  return m;
}

function groupKeys(teamId: bigint, groupType: AnalyticGroupType | undefined, start: string, end: string): GroupKey[] {
  const teamAccounts = accounts.filter((a) => a.teamId === teamId);

  if (groupType === AnalyticGroupType.ACCOUNT) {
    return teamAccounts.map((a) => ({ case: "accountId" as const, value: a.id }));
  }
  if (groupType === AnalyticGroupType.PROVIDER) {
    return [...new Set(teamAccounts.map((a) => a.provider))].map((p) => ({ case: "provider" as const, value: p }));
  }

  // Change types that moved in the window.
  const moved = teamRows(teamId).filter((l) => l.occurredOn >= start && l.occurredOn <= end);

  return [...new Set(moved.map((l) => l.changeType))].map((t) => ({ case: "changeType" as const, value: t }));
}

export const financialAccountAnalyticService: Partial<ServiceImpl<typeof FinancialAccountAnalyticService>> = {
  analyticTimeSearch: (req) => {
    const start = req.filter?.dateRange?.startDate ?? "";
    const end = req.filter?.dateRange?.endDate ?? "";
    const width = req.timeframe === AnalyticTimeframe.MONTHLY ? 7 : req.timeframe === AnalyticTimeframe.YEARLY ? 4 : 10;

    const accountId = req.filter?.accountId ?? 0n;
    const rows = teamRows(req.teamId).filter((l) => !accountId || l.accountId === accountId);

    const points = buckets(start, end, width).map((bucket) => {
      // The bucket clipped to the window — a month that starts before the window opens at the window.
      const bucketStart = width === 10 ? bucket : width === 7 ? `${bucket}-01` : `${bucket}-01-01`;
      const bucketEnd = width === 10 ? bucket : width === 7 ? `${bucket}-31` : `${bucket}-12-31`;

      return {
        at: bucketStart,
        metric: metricOf(rows, bucketStart < start ? start : bucketStart, bucketEnd > end ? end : bucketEnd),
      };
    });

    if (req.sortType === CommonSortType.DESC) points.reverse();

    const { rows: page, pageInfo } = window(points, req.page);

    return { datas: page, pageInfo };
  },

  analyticGroupSearch: (req) => {
    const start = req.filter?.dateRange?.startDate ?? "";
    const end = req.filter?.dateRange?.endDate ?? "";

    const ranked = groupKeys(req.teamId, req.filter?.groupType, start, end)
      .map((key) => ({ key, m: groupMetric(req.teamId, key, start, end) }))
      .sort((x, y) =>
        req.sort === AnalyticMetricSort.CLOSE_BALANCE
          ? y.m.closeBalance - x.m.closeBalance
          : Math.abs(y.m.change) - Math.abs(x.m.change),
      );

    if (req.sortType === CommonSortType.ASC) ranked.reverse();

    const { rows: page, pageInfo } = window(ranked, req.page);

    return { keys: page.map((r) => ({ key: r.key })), pageInfo };
  },

  analyticGroupMetric: (req) => {
    const start = req.filter?.dateRange?.startDate ?? "";
    const end = req.filter?.dateRange?.endDate ?? "";

    return {
      items: req.keys
        .filter((k) => k.key.case !== undefined)
        .map((k) => ({ key: k, metric: groupMetric(req.teamId, k.key as GroupKey, start, end) })),
    };
  },
};

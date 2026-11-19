import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── make payment — the checks behind docs/acceptances/balance/payment.md ───────────────────────────────────────────────
//
// make payment's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then, run as EVERY role the
// given names (status-is-per-then). The rows' statuses are the owner's, set by hand — never by this file.
// The one 🚧 then of the first given — `payment can be cancelled until accepted` — has its check in
// payment_selling_wants_to_cancel.spec.ts, beside the cancel it needs (backlog #81).
//
// Business rules (docs/business/balance/context_decision.md):
// - the-debtor-claims-the-creditor-decides — the team that OWES records the payment (its side of the pair negative);
//   it posts NOTHING while pending. A team owing nothing is refused (FailedPrecondition, "your team owes this team
//   nothing right now …"), and the pair page offers Make Payment only while the team owes.
// - a-payment-must-carry-proof — no document, no payment: the form holds Make Payment, the contract refuses it; the
//   proof is shared with the creditor, who opens it by id.
// - a-payment-always-moves-money — from one of the payer's accounts (the operational one here) to one of the creditor's,
//   and only when the creditor accepts.
// - a-creditor-may-request-payment — the debtor RECORDING a payment to the asking creditor clears its request.
// - warehouse-roles-count-as-their-own-team — a warehouse that owes a selling team (after an overpayment) pays through
//   the same flow; the-cross-markup-belongs-to-the-product — a borrowed product's fee is owed to the team that lent it.
//
// The WHEN, as the person does it: the payer's /liability/<creditor> page → Make Payment → amount, Paid from (the one
// operational account, pre-picked), a note, Attach Proof → Make Payment.
//
// GROUND (beforeAll, as root, through the API) — every given and role its own paying team, so no balance read here is
// moved by another test:
//   warehouse W (PYW…, a warehouse:owner and a warehouse:admin user, one operational account);
//   per selling role, teams a (pay) · b (told to pay — W's Request Payment stands) · f (no proof) · c (more than the
//   debt), each owing W a courier's Rp 50.000 — a restock accepted with the courier paid at the door, *Restock
//   Accepted* pushed to liability as the broker would — and team n (owes W nothing: no pair at all);
//   per warehouse role, a selling team e that owed W Rp 50.000, paid Rp 80.000 and was accepted → W owes it Rp 30.000;
//   per selling role, a team d owing cross team X (PYX…, a selling:owner user) Rp 24.000 product fee — two units of X's
//   borrowed product (20% markup on Rp 10.000) ordered at warehouse WX (PYV…) by root.
//   Every paying team pays from its OWN operational account.
//
// Where each then is read:
// - `payment recorded as pending` — the payer's pair page, My payments: the new row reads Pending with its amount; the
//   server lists it RECORDED, from the operational account, with one document.
// - `liability balance unchanged until confirmed` — the pair balance on BOTH sides (the payer's page and the creditor's)
//   and the payer's total, as before the payment. At the test's end the creditor accepts it and the balance moves —
//   only then.
// - `operational account balance unchanged until confirmed` — the paying account's balance, read before and after the
//   payment; after the accept (its event pushed as the broker would) it falls by the payment.
// - `<creditor> sees pending payment with proof` — the creditor on its own pair page, Their payments: the row reads
//   Pending and offers Accept, and its proof opens — the download URL the creditor is given serves the very bytes the
//   payer attached.
// - `warehouse sees payment awaiting confirmation on liability` — the warehouse's /liability list: the payer's row reads
//   "1 to accept", and the Awaiting tile and the server's count are one more than before.
// - `tell to make payment cleared` — the payer's pair page no longer warns "<W> asks you to pay", its liability list
//   row has no request badge, the warehouse's pair page no longer says it asked (Request Payment is offered again), and
//   the server's position carries no request.
// - `payment refused` / `message says team owes nothing` — the payer's pair page reads Square with no Make Payment; the
//   same claim sent anyway (its own account, a proof shared) is refused failed_precondition with the server's words, and
//   nothing is recorded.
// - `cannot make payment` — the form, filled but with no proof attached, holds Make Payment; the same claim sent anyway
//   with no document is refused invalid_argument, and nothing is recorded.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-paymake-pass-1";
// What a paying team owes W: the courier's charge at the door.
const DEBT = 50_000;
// More than the debt.
const OVER = 80_000;
// What W owes a team that paid Rp 80.000 on Rp 50.000.
const W_OWES = OVER - DEBT;
// The borrowed product: Rp 10.000 a unit + 20% markup, two units.
const CROSS_MARKUP_BPS = 2_000;
const CROSS_DEBT = 24_000;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SELLING = [
  { key: "own", code: "O", given: "selling:owner", role: "ROLE_SELLING_OWNER" },
  { key: "adm", code: "A", given: "selling:admin", role: "ROLE_SELLING_ADMIN" },
] as const;
const WAREHOUSE = [
  { key: "own", code: "O", given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER" },
  { key: "adm", code: "A", given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN" },
] as const;

const user = (tag: string) => `e2epy${tag}${SUFFIX}`;
const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

interface Payer {
  team: string;
  name: string;
  account: string;
  accountName: string;
  // the person who acts in the test: the role's user (a selling payer) or the team's reader (team e)
  user: string;
}

const ground = {
  wh: "",
  whName: `E2E PayMake WH ${SUFFIX}`,
  whAccount: "",
  whAccountName: "",
  cross: "",
  crossName: `E2E PayMake Cross ${SUFFIX}`,
  // keyed `<given letter><role key>` — `aown`, `eadm`, …
  teams: {} as Record<string, Payer>,
};

// An RPC as the signed-in person — the status and the JSON body, never thrown.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
async function ok<T = any>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// Somebody else on a page of their own, signed in through the form, working in their team.
async function pageOf(browser: Browser, username: string, teamId: string) {
  const p = await browser.newPage();
  await signIn(p, username, PASSWORD);
  await useTeam(p, teamId);

  return p;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// The account's balance as its team reads it — proto3 JSON leaves a zero out.
async function accountBalance(page: Page, teamId: string, accountId: string) {
  const res = await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOverview", {
    teamId,
    filter: { accountIds: [accountId] },
    metricRequest: ["FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_BALANCE"],
  });

  return Number(res.items?.[0]?.balance?.mapData?.[accountId]?.balance ?? 0);
}

// What a team owes in total, by the server. `+ 0` because a magnitude of nothing comes back as -0 (the negated sum of
// no negative balance), and toBe(0) tells -0 from 0.
async function totalPayable(page: Page, teamId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", { teamId, page: { page: 1, limit: 50 } });

  return Number(res.totalPayable ?? 0) + 0;
}

// The team's position with ONE counterparty, by the server.
async function positionOf(page: Page, teamId: string, counterpartyId: string): Promise<Record<string, any> | undefined> {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId,
    filter: { counterpartyId },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { position?: { mapData: Record<string, Record<string, any>> } }[] | undefined)?.find(
    (it) => it.position,
  )?.position?.mapData;

  return map?.[counterpartyId];
}

// Every payment the team has not yet confirmed, across its counterparties (the nav badge's number).
async function awaitingOf(page: Page, teamId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", { teamId, page: { page: 1, limit: 50 } });

  return Number(res.awaitingConfirmation ?? 0);
}

// The payments `payer` recorded to `creditor`, as the server lists them to the payer.
async function paymentsOf(page: Page, payer: string, creditor: string): Promise<Record<string, any>[]> {
  const res = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentList", {
    teamId: payer,
    filter: { counterpartyId: creditor },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { payment?: { mapData: Record<string, Record<string, any>> } }[]).find((it) => it.payment)
    ?.payment?.mapData;

  return Object.values(map ?? {}).filter((p) => String(p.payerTeamId) === payer);
}

// What `debtor` owes `creditor` right now, as the order form and the create's check read it.
async function debtTo(page: Page, debtor: string, creditor: string): Promise<number> {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityCreditByIds", {
    teamId: debtor,
    filter: { ids: [creditor] },
    dataRequest: ["LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT"],
  });
  for (const item of res.items?.[creditor]?.items ?? []) {
    const credit = item.credit?.mapData?.[creditor];
    if (credit) return Number(credit.debt ?? 0);
  }

  return 0;
}

// The payer's proof, uploaded and shared with the creditor (a-payment-must-carry-proof).
async function uploadProof(page: Page, ownerTeam: string, shareWith: string) {
  const requested = await ok(page, "document.v1.DocumentService/RequestUpload", {
    teamId: ownerTeam,
    filename: "transfer.png",
    contentType: "image/png",
    sizeBytes: "70",
    resourceType: "DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF",
  });

  const put = await page.evaluate(
    async ([url, method, headers, png]) => {
      const bytes = Uint8Array.from(atob(png as string), (c) => c.charCodeAt(0));
      const res = await fetch(url as string, { method: method as string, headers: headers as Record<string, string>, body: bytes });

      return res.status;
    },
    [requested.uploadUrl, requested.method, requested.headers ?? {}, PNG] as const,
  );
  expect(put).toBeLessThan(300);

  const confirmed = await ok(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  await ok(page, "document.v1.DocumentService/ShareDocument", {
    teamId: ownerTeam,
    documentId: confirmed.document.id,
    withTeamId: shareWith,
  });

  return String(confirmed.document.id);
}

// *Restock Accepted* as the broker pushes it to liability's listener — built from the restock the server returned.
function pushRestockAccepted(restock: Record<string, string | number>) {
  const acceptedAt = new Date(Number(restock.acceptedAtUnix) * 1000);
  const event = {
    eventId: `restock-accepted:${restock.id}`,
    occurredAt: acceptedAt.toISOString(),
    aggregateId: `restock:${restock.id}`,
    restockAccepted: {
      restockId: restock.id,
      teamId: restock.requestingTeamId,
      warehouseId: restock.warehouseId,
      acceptedOn: acceptedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      acceptedAtUnix: restock.acceptedAtUnix,
      warehouseAdditionalCost: restock.warehouseAdditionalCost,
      warehouseAdditionalCostNote: restock.warehouseAdditionalCostNote,
      actorId: restock.acceptedByUserId,
    },
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: "warehouse.events.v1.RestockAccepted" },
      messageId: `${event.eventId}-${Date.now()}`,
    },
    subscription: "projects/warehouse-dev/subscriptions/liability-restock-accepted",
  };
}

// *Liability Payment Accepted* as the broker pushes it to the financial accounts — the money leaving the payer's account.
function pushPaymentAccepted(payment: Record<string, string>) {
  const event = {
    eventId: `liability-payment-accepted:${payment.id}`,
    occurredAt: new Date(Number(payment.confirmedAtUnix) * 1000).toISOString(),
    aggregateId: `liability-payment:${payment.id}`,
    liabilityPaymentAccepted: {
      paymentId: payment.id,
      payerTeamId: payment.payerTeamId,
      creditorTeamId: payment.creditorTeamId,
      amount: payment.amount,
      fromAccountId: payment.fromAccountId,
      toAccountId: payment.toAccountId,
      actorId: payment.confirmedBy,
    },
  };

  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString("base64"),
      attributes: { event_type: "warehouse.events.v1.LiabilityPaymentAccepted" },
      messageId: `${event.eventId}-${Date.now()}`,
    },
    subscription: "projects/warehouse-dev/subscriptions/financial-account-team-payment",
  };
}

// The pair page, loaded: its balance has rendered.
async function openPair(page: Page, counterpartyId: string) {
  await page.goto(`/liability/${counterpartyId}`);
  await expect(page.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("liability-detail-balance")).toBeVisible();
}

// The payer's view of its own payments: the pair page, My payments.
async function openMine(page: Page, counterpartyId: string) {
  await openPair(page, counterpartyId);
  await page.getByTestId("liability-detail-tab-mine").click();

  return page.getByTestId("liability-detail-mine");
}

// The creditor's view of the payer's payments: the pair page, Their payments.
async function openTheirs(page: Page, counterpartyId: string) {
  await openPair(page, counterpartyId);
  await page.getByTestId("liability-detail-tab-team").click();

  return page.getByTestId("liability-detail-team");
}

// THE WHEN — Make Payment on the open pair page: the amount, Paid from (the team's one operational account, pre-picked),
// a note, the proof attached. Returns the payment the server then lists, the one that was not there before.
async function makePayment(page: Page, payer: Payer, creditor: string, amount: number, note: string) {
  const before = new Set((await paymentsOf(page, payer.team, creditor)).map((p) => String(p.id)));

  await page.getByTestId("liability-detail-make-payment").click();
  await page.getByTestId("record-amount").fill(String(amount));
  await expect(page.getByTestId("record-from-account")).toContainText(payer.accountName);
  await page.getByTestId("record-note").fill(note);
  await page.getByTestId("record-proof-input").setInputFiles({
    name: "transfer.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG, "base64"),
  });
  await expect(page.getByTestId("record-proof-list")).toBeVisible();
  await expect(page.getByTestId("record-submit")).toBeEnabled();
  await page.getByTestId("record-submit").click();
  await expect(page.getByTestId("record-submit")).toBeHidden();

  let made: Record<string, any> | undefined;
  await expect
    .poll(async () => {
      made = (await paymentsOf(page, payer.team, creditor)).find((p) => !before.has(String(p.id)));

      return made !== undefined;
    })
    .toBe(true);

  return made!;
}

// `payment recorded as pending`, read on the payer's side: My payments, and the server's record.
async function recordedAsPending(page: Page, payer: Payer, creditor: string, paid: Record<string, any>, amount: number) {
  expect.soft(paid.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");
  expect.soft(Number(paid.amount)).toBe(amount);
  expect.soft(String(paid.fromAccountId)).toBe(payer.account);
  expect.soft((paid.documentIds as string[] | undefined) ?? []).toHaveLength(1);

  const mine = await openMine(page, creditor);
  await expect.soft(mine.getByTestId(`liability-detail-payment-status-${paid.id}`)).toHaveText("Pending");
  await expect.soft(mine.getByTestId(`liability-detail-payment-${paid.id}`)).toContainText(rp(amount));
}

// `<creditor> sees pending payment with proof` — on the creditor's own pair page, Their payments: Pending, Accept offered,
// and the proof opens to the bytes the payer attached.
async function creditorSeesPendingWithProof(reader: Page, payerTeam: string, paymentId: string) {
  const theirs = await openTheirs(reader, payerTeam);
  await expect.soft(theirs.getByTestId(`liability-detail-payment-status-${paymentId}`)).toHaveText("Pending");
  await expect.soft(theirs.getByTestId(`liability-detail-confirm-${paymentId}`)).toBeVisible();

  const links = theirs.getByTestId(`liability-detail-payment-${paymentId}`).locator('[data-testid^="liability-detail-proof-"]');
  await expect(links).toHaveCount(1);

  // The proof opens in a new tab: catch the URL it is given rather than open one (headless has no tab to look at).
  await reader.evaluate(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => {
      w.__opened.push(String(url));

      return null;
    }) as typeof window.open;
  });
  await links.first().click();
  await expect.poll(() => reader.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1);

  const url = await reader.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]!);
  const res = await reader.request.get(new URL(url, API_URL).toString());
  expect.soft(res.status()).toBe(200);
  expect.soft(Buffer.compare(await res.body(), Buffer.from(PNG, "base64"))).toBe(0);
}

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser, request }) => {
  test.setTimeout(420_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  const member = async (teamId: string, username: string, role: string) =>
    ok(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: `PayMake ${username}`, role });
  const account = async (teamId: string, tag: string) => {
    const name = `E2E PayMake ${tag} BCA ${SUFFIX}`;
    const id = String(
      (
        await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name,
          holderName: "PT E2E",
          accountNumber: `E2E-PYM-${tag}-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: today(),
        })
      ).account.id,
    );
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId,
      accountId: id,
      operational: true,
    });

    return { id, name };
  };

  // ── W, its two people and its operational account.
  ground.wh = await team(ground.whName, `PYW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await member(ground.wh, user("who"), "ROLE_WAREHOUSE_OWNER");
  await member(ground.wh, user("wha"), "ROLE_WAREHOUSE_ADMIN");
  const wa = await account(ground.wh, "W");
  ground.whAccount = wa.id;
  ground.whAccountName = wa.name;

  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.wh, code: `py-${SUFFIX}` })).rack.id);
  const category = String((await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E PayMake ${SUFFIX}` })).category.id);

  // A selling team with its person and its operational account.
  const payer = async (letter: string, code: string, username: string, role: string): Promise<Payer> => {
    const name = `E2E PayMake ${letter.toUpperCase()}${code} ${SUFFIX}`;
    const id = await team(name, `PY${letter.toUpperCase()}${code}${SUFFIX}`, "TEAM_TYPE_SELLING");
    await member(id, username, role);
    const acc = await account(id, `${letter.toUpperCase()}${code}`);

    return { team: id, name, account: acc.id, accountName: acc.name, user: username };
  };

  // The courier's Rp 50.000 at the door: a restock counted in, *Restock Accepted* pushed to liability.
  const owesWarehouse = async (p: Payer, code: string) => {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: p.team,
        productCodePart: `PY${code}P${SUFFIX}`,
        name: "Widget",
        categoryId: category,
      })
    ).product;
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: p.team,
      warehouseId: ground.wh,
      financeAccountId: p.account,
      items: [{ productId: product.id, productCode: product.productCode, name: "Widget", count: 2, total: 20_000 }],
    });
    const accepted = await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.wh,
      requestId: created.request.id,
      warehouseAdditionalCost: DEBT,
      warehouseAdditionalCostNote: "courier asked at the door",
      lines: (created.request.items as { id: string; count: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: item.count,
        placements: [{ placementId: rack, quantity: item.count }],
      })),
    });

    // Balance posts the courier's charge from *Restock Accepted* — once, however often it arrives.
    const res = await request.post(`${API_URL}/event/liability-restock-accepted/push`, {
      data: pushRestockAccepted(accepted.request),
    });
    expect(res.status()).toBe(200);
    await expect.poll(() => totalPayable(page, p.team), { timeout: 20_000 }).toBe(DEBT);
  };

  // ── per selling role: a (pay), b (told to pay), f (no proof), c (more than the debt) owe W; n owes it nothing.
  for (const r of SELLING) {
    for (const letter of ["a", "b", "f", "c", "n"]) {
      const p = await payer(letter, r.code, user(`${letter}${r.key}`), r.role);
      ground.teams[`${letter}${r.key}`] = p;
      if (letter !== "n") await owesWarehouse(p, `${letter.toUpperCase()}${r.code}`);
    }

    // b — W asked it to pay (a-creditor-may-request-payment).
    await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRequestSend", {
      teamId: ground.wh,
      debtorTeamId: ground.teams[`b${r.key}`]!.team,
    });
  }

  // ── per warehouse role: a selling team e that owed W Rp 50.000 and paid Rp 80.000, accepted → W owes it Rp 30.000.
  // Its person is the team's Owner, who reads W's payment to it.
  for (const r of WAREHOUSE) {
    const e = await payer("e", r.code, user(`e${r.key}`), "ROLE_SELLING_OWNER");
    ground.teams[`e${r.key}`] = e;
    await owesWarehouse(e, `E${r.code}`);

    const proof = await uploadProof(page, e.team, ground.wh);
    const over = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
      teamId: e.team,
      creditorTeamId: ground.wh,
      amount: String(OVER),
      note: "paid too much",
      documentIds: [proof],
      fromAccountId: e.account,
    });
    await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
      teamId: ground.wh,
      paymentId: over.payment.id,
      toAccountId: ground.whAccount,
    });
    await expect.poll(async () => Number((await positionOf(page, ground.wh, e.team))?.balance ?? 0)).toBe(-W_OWES);
  }

  // ── the product-fee pairs: X lends its product; per selling role a team d orders 2 units of it at WX.
  ground.cross = await team(ground.crossName, `PYX${SUFFIX}`, "TEAM_TYPE_SELLING");
  await member(ground.cross, user("xo"), "ROLE_SELLING_OWNER");
  const wx = await team(`E2E PayMake WX ${SUFFIX}`, `PYV${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const wxRack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: wx, code: `pyx-${SUFFIX}` })).rack.id);
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wx, feePercent: 10, minFee: 0 });

  const product = async (owner: string, code: string, cross: boolean) =>
    String(
      (
        await ok(page, "product.v1.ProductService/ProductCreate", {
          teamId: owner,
          productCodePart: code,
          name: `E2E ${code}`,
          categoryId: category,
          ...(cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
        })
      ).product.id,
    );
  const crossCode = `PYXP${SUFFIX}`;
  const crossProduct = await product(ground.cross, crossCode, true);
  const crossAccount = await account(ground.cross, "X");
  const supplier = String(
    (await ok(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.cross, name: `E2E PayMake Supplier ${SUFFIX}` }))
      .supplier.id,
  );
  const raised = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.cross,
    warehouseId: wx,
    financeAccountId: crossAccount.id,
    items: [{ productId: crossProduct, productCode: crossCode, name: `E2E ${crossCode}`, count: 10, total: 100_000, supplierId: supplier }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: wx,
    requestId: raised.request.id,
    lines: (raised.request.items as { id: string }[]).map((item) => ({
      itemId: item.id,
      receivedCount: 10,
      placements: [{ placementId: wxRack, quantity: 10 }],
    })),
  });

  for (const [i, r] of SELLING.entries()) {
    const d = await payer("d", r.code, user(`d${r.key}`), r.role);
    ground.teams[`d${r.key}`] = d;
    // A team with no return warehouse cannot order, and a borrowed line needs its return mapping.
    await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: d.team, warehouseId: wx });
    const own = await product(d.team, `PYM${r.code}${SUFFIX}`, false);
    await ok(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: d.team,
      sharedProductId: crossProduct,
      ownProductId: own,
    });
    const shop = String(
      (
        await ok(page, "selling.v1.ShopService/ShopCreate", {
          teamId: d.team,
          name: `E2E PayMake Shop ${r.code} ${SUFFIX}`,
          shopCode: `PYS${i + 1}${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-py-${SUFFIX}-${r.key}`,
      shipmentChannelId: "1",
      teamId: d.team,
      shopId: shop,
      warehouseId: wx,
      customerName: `E2E PayMake Buyer ${r.key}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `PY${SUFFIX}X${r.code}`,
      items: [{ productId: crossProduct, productCode: crossCode, name: `E2E ${crossCode}`, quantity: 2 }],
    });
  }
  // The product fee lands through the ledger's listener — wait until each debt reads.
  for (const r of SELLING) {
    await expect.poll(() => debtTo(page, ground.teams[`d${r.key}`]!.team, ground.cross), { timeout: 60_000 }).toBe(CROSS_DEBT);
  }

  await page.close();
});

test.describe("selling:owner · selling:admin wants to pay a debt (owes 1 warehouse · 1 proof · operational account)", () => {
  for (const r of SELLING) {
    test(`${r.given} make payment`, async ({ page, browser, request }) => {
      const t = ground.teams[`a${r.key}`]!;
      await signIn(page, t.user, PASSWORD);
      await useTeam(page, t.team);
      const wh = await pageOf(browser, user("who"), ground.wh);

      const accountBefore = await accountBalance(page, t.team, t.account);
      const awaitingBefore = await awaitingOf(wh, ground.wh);

      // THE GIVEN, on the payer's page: it owes W Rp 50.000.
      await openPair(page, ground.wh);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
      await expect(page.getByTestId("liability-detail-direction")).toHaveText("You owe them");

      const paid = await makePayment(page, t, ground.wh, DEBT, "transfer BCA, the courier's charge");
      const accountWhilePending = await accountBalance(page, t.team, t.account);

      await test.step("then: payment recorded as pending", async () => {
        await recordedAsPending(page, t, ground.wh, paid, DEBT);
      });

      await test.step("then: liability balance unchanged until confirmed", async () => {
        await openPair(page, ground.wh);
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
        await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText("You owe them");
        expect.soft(await totalPayable(page, t.team)).toBe(DEBT);

        // …and on the creditor's side of the pair.
        await openPair(wh, t.team);
        await expect.soft(wh.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
        await expect.soft(wh.getByTestId("liability-detail-direction")).toHaveText("They owe you");
      });

      await test.step("then: operational account balance unchanged until confirmed", async () => {
        expect.soft(accountWhilePending).toBe(accountBefore);
        expect.soft(await accountBalance(page, t.team, t.account)).toBe(accountBefore);
      });

      await test.step("then: warehouse sees pending payment with proof", async () => {
        await creditorSeesPendingWithProof(wh, t.team, String(paid.id));
      });

      await test.step("then: warehouse sees payment awaiting confirmation on liability", async () => {
        const awaitingAfter = await awaitingOf(wh, ground.wh);
        expect.soft(awaitingAfter).toBe(awaitingBefore + 1);

        await wh.goto(`/liability?awaiting=true&q=${encodeURIComponent(t.name)}`);
        await expect.soft(wh.getByTestId(`liability-row-${t.team}`)).toContainText("1 to accept");
        await expect.soft(wh.getByTestId("liability-awaiting-total")).toHaveText(String(awaitingAfter));
      });

      // UNTIL CONFIRMED — the warehouse accepts it, and only now do the pair and the account move.
      await test.step("the warehouse accepts: the balance and the account move only now", async () => {
        const confirmed = await ok(wh, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
          teamId: ground.wh,
          paymentId: paid.id,
          toAccountId: ground.whAccount,
        });
        expect(confirmed.payment.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
        expect.soft(await totalPayable(page, t.team)).toBe(0);

        const res = await request.post(`${API_URL}/event/financial-account-team-payment/push`, {
          data: pushPaymentAccepted(confirmed.payment),
        });
        expect(res.status()).toBe(200);
        await expect.poll(() => accountBalance(page, t.team, t.account)).toBe(accountBefore - DEBT);
      });

      await wh.close();
    });
  }
});

test.describe(
  "selling:owner · selling:admin wants to pay a debt (owes 1 warehouse · 1 proof · operational account · warehouse tell to make payment)",
  () => {
    for (const r of SELLING) {
      test(`${r.given} make payment`, async ({ page, browser }) => {
        const t = ground.teams[`b${r.key}`]!;
        await signIn(page, t.user, PASSWORD);
        await useTeam(page, t.team);
        const wh = await pageOf(browser, user("who"), ground.wh);

        // THE GIVEN: W asked it to pay — on the payer's pair page and list, and on W's side.
        await openPair(page, ground.wh);
        await expect(page.getByTestId("liability-detail-payment-request")).toContainText(`${ground.whName} asks you to pay ${rp(DEBT)}`);
        await openPair(wh, t.team);
        await expect(wh.getByTestId("liability-detail-payment-requested")).toBeVisible();
        expect((await positionOf(page, t.team, ground.wh))?.paymentRequest).toBeTruthy();

        await openPair(page, ground.wh);
        const paid = await makePayment(page, t, ground.wh, DEBT, "paid as asked");
        expect(paid.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");

        await test.step("then: tell to make payment cleared", async () => {
          await openPair(page, ground.wh);
          await expect.soft(page.getByTestId("liability-detail-payment-request")).toHaveCount(0);
          expect.soft((await positionOf(page, t.team, ground.wh))?.paymentRequest).toBeFalsy();

          // The payer's list: W's row, with no request badge.
          await page.goto(`/liability?q=${encodeURIComponent(ground.whName)}`);
          await expect.soft(page.getByTestId(`liability-row-${ground.wh}`)).toBeVisible();
          await expect.soft(page.getByTestId(`liability-request-${ground.wh}`)).toHaveCount(0);

          // W's side: it no longer says it asked, and Request Payment is offered again.
          await openPair(wh, t.team);
          await expect.soft(wh.getByTestId("liability-detail-request-payment")).toBeVisible();
          await expect.soft(wh.getByTestId("liability-detail-payment-requested")).toHaveCount(0);
        });

        await wh.close();
      });
    }
  },
);

test.describe("selling:owner · selling:admin wants to pay a debt (owes nothing to the warehouse)", () => {
  for (const r of SELLING) {
    test(`${r.given} make payment`, async ({ page }) => {
      const t = ground.teams[`n${r.key}`]!;
      await signIn(page, t.user, PASSWORD);
      await useTeam(page, t.team);

      // THE GIVEN, on its own pair page with W: square, nothing ever moved, and Make Payment is not offered.
      await openPair(page, ground.wh);
      await expect(page.getByTestId("liability-detail-all")).toContainText("Nothing has moved between you");

      // THE WHEN, as far as anyone can take it: the claim sent anyway — its own operational account, a proof shared.
      const proof = await uploadProof(page, t.team, ground.wh);
      const refused = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
        teamId: t.team,
        creditorTeamId: ground.wh,
        amount: String(DEBT),
        note: "paying what we do not owe",
        documentIds: [proof],
        fromAccountId: t.account,
      });

      await test.step("then: payment refused", async () => {
        expect.soft(refused.status).toBe(400);
        expect.soft(refused.body.code).toBe("failed_precondition");
        expect.soft(await paymentsOf(page, t.team, ground.wh)).toHaveLength(0);
        await expect.soft(page.getByTestId("liability-detail-make-payment")).toHaveCount(0);
      });

      await test.step("then: message says team owes nothing", async () => {
        expect.soft(refused.body.message).toContain("your team owes this team nothing");
        await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText("Square");
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText("Rp 0");
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to pay a debt (owes 1 warehouse · no proof)", () => {
  for (const r of SELLING) {
    test(`${r.given} make payment`, async ({ page }) => {
      const t = ground.teams[`f${r.key}`]!;
      await signIn(page, t.user, PASSWORD);
      await useTeam(page, t.team);

      await openPair(page, ground.wh);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));

      // THE WHEN, with no proof: the amount and the account filled, nothing attached.
      await page.getByTestId("liability-detail-make-payment").click();
      await page.getByTestId("record-amount").fill(String(DEBT));
      await expect(page.getByTestId("record-from-account")).toContainText(t.accountName);
      await page.getByTestId("record-note").fill("the slip is still on my phone");

      await test.step("then: cannot make payment", async () => {
        await expect.soft(page.getByTestId("record-proof-list")).toHaveCount(0);
        await expect.soft(page.getByTestId("record-submit")).toBeDisabled();

        // The same claim sent anyway, with no document, is refused by the contract — and nothing is recorded.
        const sent = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
          teamId: t.team,
          creditorTeamId: ground.wh,
          amount: String(DEBT),
          note: "no slip attached",
          documentIds: [],
          fromAccountId: t.account,
        });
        expect.soft(sent.status).toBe(400);
        expect.soft(sent.body.code).toBe("invalid_argument");
        expect.soft(await paymentsOf(page, t.team, ground.wh)).toHaveLength(0);
        expect.soft(await totalPayable(page, t.team)).toBe(DEBT);
      });
    });
  }
});

test.describe(
  "selling:owner · selling:admin wants to pay a debt (owes 1 warehouse · amount more than debt · 1 proof · operational account)",
  () => {
    for (const r of SELLING) {
      test(`${r.given} make payment`, async ({ page }) => {
        const t = ground.teams[`c${r.key}`]!;
        await signIn(page, t.user, PASSWORD);
        await useTeam(page, t.team);

        await openPair(page, ground.wh);
        await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));

        // THE WHEN — Rp 80.000 on a debt of Rp 50.000.
        const paid = await makePayment(page, t, ground.wh, OVER, "rounded up, the rest on account");

        await test.step("then: payment recorded as pending", async () => {
          await recordedAsPending(page, t, ground.wh, paid, OVER);
          // Pending moves nothing: the debt still reads Rp 50.000.
          await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(DEBT));
          expect.soft(await totalPayable(page, t.team)).toBe(DEBT);
        });
      });
    }
  },
);

test.describe(
  "warehouse:owner · warehouse:admin wants to pay a debt (owes 1 selling team · after overpayment · 1 proof · operational account)",
  () => {
    for (const r of WAREHOUSE) {
      test(`${r.given} make payment`, async ({ page, browser }) => {
        const t = ground.teams[`e${r.key}`]!;
        const warehouse: Payer = {
          team: ground.wh,
          name: ground.whName,
          account: ground.whAccount,
          accountName: ground.whAccountName,
          user: user(r.key === "own" ? "who" : "wha"),
        };
        await signIn(page, warehouse.user, PASSWORD);
        await useTeam(page, ground.wh);

        // THE GIVEN, on W's page: after the overpayment W owes the selling team Rp 30.000.
        await openPair(page, t.team);
        await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(W_OWES));
        await expect(page.getByTestId("liability-detail-direction")).toHaveText("You owe them");

        const paid = await makePayment(page, warehouse, t.team, W_OWES, "returning the overpayment");

        await test.step("then: payment recorded as pending", async () => {
          await recordedAsPending(page, warehouse, t.team, paid, W_OWES);
          await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(W_OWES));
        });

        await test.step("then: selling team sees pending payment with proof", async () => {
          const seller = await pageOf(browser, t.user, t.team);
          await creditorSeesPendingWithProof(seller, ground.wh, String(paid.id));
          await seller.close();
        });
      });
    }
  },
);

test.describe(
  "selling:owner · selling:admin wants to pay a debt (owes 1 cross team · product fee · 1 proof · operational account)",
  () => {
    for (const r of SELLING) {
      test(`${r.given} make payment`, async ({ page, browser }) => {
        const t = ground.teams[`d${r.key}`]!;
        await signIn(page, t.user, PASSWORD);
        await useTeam(page, t.team);

        // THE GIVEN, on its page with X: it owes the lent product's Rp 24.000.
        await openPair(page, ground.cross);
        await expect(page.getByTestId("liability-detail-balance")).toHaveText(rp(CROSS_DEBT));
        await expect(page.getByTestId("liability-detail-direction")).toHaveText("You owe them");

        const paid = await makePayment(page, t, ground.cross, CROSS_DEBT, "the borrowed widgets");

        await test.step("then: payment recorded as pending", async () => {
          await recordedAsPending(page, t, ground.cross, paid, CROSS_DEBT);
          await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText(rp(CROSS_DEBT));
        });

        await test.step("then: cross team sees pending payment with proof", async () => {
          const cross = await pageOf(browser, user("xo"), ground.cross);
          await creditorSeesPendingWithProof(cross, t.team, String(paid.id));
          await cross.close();
        });
      });
    }
  },
);

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── cancel payment — the checks behind docs/acceptances/balance/payment.md ─────────────────────────────────────────────
//
// a-pending-payment-is-cancelled-by-its-selling-team (docs/business/balance/context_decision.md, backlog #81): a payment
// still PENDING can be taken back by the paying selling team's Owner or Admin. It moved no money while it waited, so
// cancelling moves none; it leaves the creditor's confirm list, stays in the history as Cancelled, and the team may pay
// again. A payment the creditor ACCEPTED is final (an-accepted-payment-is-final) — nothing to cancel.
//
// Two givens, each run as BOTH roles the row names (status-is-per-then), each role in a selling team of its own:
// - `selling:owner · selling:admin wants to take back a wrong payment (pending · wrong amount)` / cancel payment — five
//   thens.
// - `selling:owner · selling:admin wants to pay a debt (owes 1 warehouse · 1 proof · operational account)` / make
//   payment — only its then `payment can be cancelled until accepted` here; that action's other thens are its own item.
//
// GROUND: one warehouse, with an Owner of its own who reads the creditor's side; per role, a selling team (root owns it,
// the role is a member) that owes the warehouse a courier's Rp 50.000 — a restock counted in with the courier paid at the
// door, *Restock Accepted* pushed to liability as the broker would. Each team pays from its OWN operational account, so
// no balance read here is moved by another test.
//
// Where each then is read:
// - `payment cancelled` — the payer's pair page, My payments: the row's Cancel (Batalkan) asks first, then the row
//   reads Cancelled and offers nothing; the server's list says CANCELLED.
// - `warehouse no longer sees it to confirm` — the warehouse Owner on the same pair: before, the row offers Accept; after,
//   it reads Cancelled with no Accept or Reject, and the awaiting count (the /liability tile) is one less. An accept sent
//   anyway is refused.
// - `liability balance unchanged` — the payer's pair page balance, Rp 50.000 before and after (and the server's total).
// - `operational account balance unchanged` — the paying account's balance, read before the wrong payment and after
//   the cancel.
// - `selling team can make a new payment` — the payer's own Make Payment form, proof attached: a new Pending row beside
//   the Cancelled one.
// - `payment can be cancelled until accepted` — that new payment offers Cancel while it waits; once the warehouse accepts
//   it, the row offers none and a cancel sent anyway is refused (FailedPrecondition).

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-paycancel-pass-1";
// What each selling team owes the warehouse: the courier's charge at the door.
const DEBT = 50_000;
// The wrong payment — a zero short.
const WRONG = 5_000;
const WH_OWNER = `e2epcwh${SUFFIX}`;
const CS = `e2epccs${SUFFIX}`;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ROLES = [
  { key: "owner", role: "ROLE_SELLING_OWNER", code: "PCO", label: "selling:owner" },
  { key: "admin", role: "ROLE_SELLING_ADMIN", code: "PCA", label: "selling:admin" },
] as const;
type Key = (typeof ROLES)[number]["key"];

const userOf = (key: Key) => `e2epc${key}${SUFFIX}`;

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
const state = {
  warehouse: "",
  warehouseAccount: "",
  teams: {} as Record<Key, { seller: string; account: string; wrong: string; again: string }>,
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

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

async function openAccount(page: Page, teamId: string, name: string, accountNumber: string) {
  const res = await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name,
    holderName: "PT E2E",
    accountNumber,
    openingBalance: 1_000_000,
    openingOn: today(),
  });

  return String(res.account.id);
}

// The account's balance as its team reads it — proto3 JSON leaves a zero out.
async function accountBalance(page: Page, teamId: string, accountId: string) {
  const res = await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOverview", {
    teamId,
    filter: { accountIds: [accountId] },
    metricRequest: ["FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_BALANCE"],
  });

  return Number(res.items?.[0]?.balance?.mapData?.[accountId]?.balance ?? 0);
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

// What a team owes in total, by the server.
async function totalPayable(page: Page, teamId: string) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", { teamId, page: { page: 1, limit: 50 } });

  return Number(res.totalPayable ?? 0);
}

// Every payment the warehouse has not yet confirmed, across its counterparties (the nav badge's number).
async function awaitingOf(page: Page) {
  const res = await ok(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId: state.warehouse,
    page: { page: 1, limit: 50 },
  });

  return Number(res.awaitingConfirmation ?? 0);
}

// The seller's payments to the warehouse, as the server lists them.
async function paymentsOf(page: Page, seller: string): Promise<Record<string, any>[]> {
  const res = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentList", {
    teamId: seller,
    filter: { counterpartyId: state.warehouse },
    page: { page: 1, limit: 50 },
  });
  const map = (res.items as { payment?: { mapData: Record<string, Record<string, any>> } }[]).find((it) => it.payment)
    ?.payment?.mapData;

  return Object.values(map ?? {});
}

// The warehouse Owner, on a page of its own, signed in through the form.
async function warehousePage(browser: import("@playwright/test").Browser) {
  const wh = await browser.newPage();
  await signIn(wh, WH_OWNER, PASSWORD);
  await useTeam(wh, state.warehouse);

  return wh;
}

// The creditor's view of the seller's payments: the pair page, Their payments.
async function openTheirPayments(wh: Page, seller: string) {
  await wh.goto(`/liability/${seller}`);
  await expect(wh.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
  await wh.getByTestId("liability-detail-tab-team").click();

  return wh.getByTestId("liability-detail-team");
}

// The payer's view: the pair page, My payments.
async function openMyPayments(page: Page) {
  await page.goto(`/liability/${state.warehouse}`);
  await expect(page.getByTestId("liability-detail-tab-all")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("liability-detail-tab-mine").click();

  return page.getByTestId("liability-detail-mine");
}

test.describe.configure({ mode: "serial" });

test("Setup: a warehouse with its Owner, and per paying role a selling team owing it a courier's Rp 50.000", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.warehouse = String(
    (
      await ok(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E PayCancel WH ${SUFFIX}`,
        teamCode: `PCW${SUFFIX}`,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id,
  );
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.warehouse,
    username: WH_OWNER,
    password: PASSWORD,
    name: `PayCancel WH Owner ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_OWNER",
  });
  state.warehouseAccount = await openAccount(page, state.warehouse, `E2E PayCancel WH BCA ${SUFFIX}`, `81${SUFFIX}00`);

  const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: `pc-${SUFFIX}` })).rack
    .id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E PayCancel ${SUFFIX}` })).category
    .id;

  for (const [i, r] of ROLES.entries()) {
    const seller = String(
      (
        await ok(page, "team.v1.TeamService/TeamCreate", {
          name: `E2E PayCancel ${r.key} ${SUFFIX}`,
          teamCode: `${r.code}${SUFFIX}`,
          type: "TEAM_TYPE_SELLING",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId: seller,
      username: userOf(r.key),
      password: PASSWORD,
      name: `PayCancel ${r.key} ${SUFFIX}`,
      role: r.role,
    });

    const account = await openAccount(page, seller, `E2E PayCancel ${r.key} BCA ${SUFFIX}`, `81${SUFFIX}${i + 1}`);
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: seller,
      accountId: account,
      operational: true,
    });

    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: seller,
        productCodePart: `${r.code}P${SUFFIX}`,
        name: "Widget",
        categoryId: category,
      })
    ).product;
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: seller,
      warehouseId: state.warehouse,
      financeAccountId: account,
      items: [{ productId: product.id, productCode: product.productCode, name: "Widget", count: 2, total: 20_000 }],
    });
    const accepted = await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: state.warehouse,
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
    await expect.poll(() => totalPayable(page, seller), { timeout: 20_000 }).toBe(DEBT);

    state.teams[r.key] = { seller, account, wrong: "", again: "" };
  }

  // Customer service of the Owner's team — refused below.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.teams.owner.seller,
    username: CS,
    password: PASSWORD,
    name: `PayCancel CS ${SUFFIX}`,
    role: "ROLE_SELLING_CS",
  });
});

// ONLY THE PAYING TEAM'S OWNER AND ADMIN (a-pending-payment-is-cancelled-by-its-selling-team): its customer service is
// refused by the policy, and the warehouse — the creditor — can neither cancel it from its own seat nor from the payer's.
// Run while the Owner's team still owes (the make-payment given below pays its debt off).
test("A pending payment is not the CS's or the creditor's to cancel", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const t = state.teams.owner;
  await signIn(page, userOf("owner"), PASSWORD);
  await useTeam(page, t.seller);

  const proof = await uploadProof(page, t.seller, state.warehouse);
  const pending = String(
    (
      await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
        teamId: t.seller,
        creditorTeamId: state.warehouse,
        amount: "1000",
        note: "a claim nobody else may take back",
        documentIds: [proof],
        fromAccountId: t.account,
      })
    ).payment.id,
  );

  const cs = await browser.newPage();
  await signIn(cs, CS, PASSWORD);
  const byCs = await call(cs, "liability.v1.LiabilityPaymentService/LiabilityPaymentCancel", { teamId: t.seller, paymentId: pending });
  expect(byCs.status).toBe(403);
  expect(byCs.body.code).toBe("permission_denied");
  await cs.close();

  const wh = await warehousePage(browser);
  for (const teamId of [state.warehouse, t.seller]) {
    const byWarehouse = await call(wh, "liability.v1.LiabilityPaymentService/LiabilityPaymentCancel", { teamId, paymentId: pending });
    expect(byWarehouse.status, `cancel scoped to team ${teamId}`).toBe(403);
  }
  // The creditor's own row offers Accept and Reject — never Cancel.
  const theirs = await openTheirPayments(wh, t.seller);
  await expect(theirs.getByTestId(`liability-detail-confirm-${pending}`)).toBeVisible();
  await expect(theirs.getByTestId(`liability-detail-cancel-${pending}`)).toHaveCount(0);
  await wh.close();

  // Still pending — nobody moved it. Its own Owner then takes it back, so the givens below start with nothing waiting.
  const listed = (await paymentsOf(page, t.seller)).find((p) => String(p.id) === pending);
  expect(listed?.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");
  const own = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentCancel", { teamId: t.seller, paymentId: pending });
  expect(own.payment.status).toBe("LIABILITY_PAYMENT_STATUS_CANCELLED");
});

test.describe("selling:owner · selling:admin wants to take back a wrong payment (pending · wrong amount)", () => {
  for (const r of ROLES) {
    test(`${r.label} cancel payment`, async ({ page, browser }) => {
      test.setTimeout(150_000);
      const t = state.teams[r.key];
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, t.seller);

      const accountBefore = await accountBalance(page, t.seller, t.account);

      // THE GIVEN: a pending payment of the wrong amount, recorded by this role with its proof, from the operational account.
      const proof = await uploadProof(page, t.seller, state.warehouse);
      const recorded = await ok(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
        teamId: t.seller,
        creditorTeamId: state.warehouse,
        amount: String(WRONG),
        note: "typed a zero short",
        documentIds: [proof],
        fromAccountId: t.account,
      });
      expect(recorded.payment.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");
      t.wrong = String(recorded.payment.id);

      // Before: the warehouse is waiting on it, and its row offers Accept.
      const wh = await warehousePage(browser);
      const awaitingBefore = await awaitingOf(wh);
      const theirs = await openTheirPayments(wh, t.seller);
      await expect(theirs.getByTestId(`liability-detail-confirm-${t.wrong}`)).toBeVisible();

      // Before, on the payer's side: the debt stands at Rp 50.000 and the claim is Pending with its Cancel.
      const mine = await openMyPayments(page);
      await expect(page.getByTestId("liability-detail-balance")).toHaveText("Rp 50.000");
      await expect(mine.getByTestId(`liability-detail-payment-status-${t.wrong}`)).toHaveText("Pending");

      await test.step("then: payment cancelled", async () => {
        await mine.getByTestId(`liability-detail-cancel-${t.wrong}`).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toContainText("Cancel Payment");
        await dialog.getByTestId("confirm-action").click();
        await expect(dialog).toBeHidden();

        await expect.soft(mine.getByTestId(`liability-detail-payment-status-${t.wrong}`)).toHaveText("Cancelled");
        await expect.soft(mine.getByTestId(`liability-detail-cancel-${t.wrong}`)).toHaveCount(0);
        // It stays in the history, and the server says so.
        const listed = (await paymentsOf(page, t.seller)).find((p) => String(p.id) === t.wrong);
        expect.soft(listed?.status).toBe("LIABILITY_PAYMENT_STATUS_CANCELLED");
      });

      await test.step("then: warehouse no longer sees it to confirm", async () => {
        const after = await openTheirPayments(wh, t.seller);
        await expect.soft(after.getByTestId(`liability-detail-payment-status-${t.wrong}`)).toHaveText("Cancelled");
        await expect.soft(after.getByTestId(`liability-detail-confirm-${t.wrong}`)).toHaveCount(0);
        await expect.soft(after.getByTestId(`liability-detail-reject-${t.wrong}`)).toHaveCount(0);

        // One fewer waiting for it — on the server and on the /liability tile.
        const awaitingAfter = await awaitingOf(wh);
        expect.soft(awaitingAfter).toBe(awaitingBefore - 1);
        await wh.goto("/liability");
        await expect.soft(wh.getByTestId("liability-awaiting-total")).toHaveText(String(awaitingAfter));

        // An accept sent anyway is refused.
        const accept = await call(wh, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
          teamId: state.warehouse,
          paymentId: t.wrong,
          toAccountId: state.warehouseAccount,
        });
        expect.soft(accept.status).toBe(400);
      });

      await test.step("then: liability balance unchanged", async () => {
        await openMyPayments(page);
        await expect.soft(page.getByTestId("liability-detail-balance")).toHaveText("Rp 50.000");
        await expect.soft(page.getByTestId("liability-detail-direction")).toHaveText("You owe them");
        expect.soft(await totalPayable(page, t.seller)).toBe(DEBT);
      });

      await test.step("then: operational account balance unchanged", async () => {
        expect.soft(await accountBalance(page, t.seller, t.account)).toBe(accountBefore);
      });

      await test.step("then: selling team can make a new payment", async () => {
        await page.getByTestId("liability-detail-make-payment").click();
        await page.getByTestId("record-amount").fill(String(DEBT));
        await page.getByTestId("record-proof-input").setInputFiles({
          name: "transfer-again.png",
          mimeType: "image/png",
          buffer: Buffer.from(PNG, "base64"),
        });
        await expect(page.getByTestId("record-proof-list")).toBeVisible();
        await expect(page.getByTestId("record-submit")).toBeEnabled();
        await page.getByTestId("record-submit").click();
        await expect(page.getByTestId("record-submit")).toBeHidden();

        // A new claim waits — the cancelled one stays beside it.
        await expect
          .poll(async () => (await paymentsOf(page, t.seller)).filter((p) => p.status === "LIABILITY_PAYMENT_STATUS_RECORDED").length)
          .toBe(1);
        const again = (await paymentsOf(page, t.seller)).find((p) => p.status === "LIABILITY_PAYMENT_STATUS_RECORDED")!;
        expect.soft(Number(again.amount)).toBe(DEBT);
        t.again = String(again.id);

        const mineAfter = await openMyPayments(page);
        await expect.soft(mineAfter.getByTestId(`liability-detail-payment-status-${t.again}`)).toHaveText("Pending");
        await expect.soft(mineAfter.getByTestId(`liability-detail-payment-status-${t.wrong}`)).toHaveText("Cancelled");
      });

      await wh.close();
    });
  }
});

test.describe("selling:owner · selling:admin wants to pay a debt (owes 1 warehouse · 1 proof · operational account)", () => {
  for (const r of ROLES) {
    test(`${r.label} make payment`, async ({ page, browser }) => {
      test.setTimeout(120_000);
      const t = state.teams[r.key];
      expect(t.again, "the payment the cancel test made through the form").not.toBe("");
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, t.seller);

      await test.step("then: payment can be cancelled until accepted", async () => {
        // While it waits: Cancel is offered.
        const mine = await openMyPayments(page);
        await expect.soft(mine.getByTestId(`liability-detail-cancel-${t.again}`)).toBeVisible();

        // The warehouse accepts it — the payment is final from here (an-accepted-payment-is-final).
        const wh = await warehousePage(browser);
        await ok(wh, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
          teamId: state.warehouse,
          paymentId: t.again,
          toAccountId: state.warehouseAccount,
        });
        await wh.close();

        const after = await openMyPayments(page);
        await expect.soft(after.getByTestId(`liability-detail-payment-status-${t.again}`)).toHaveText("Accepted");
        await expect.soft(after.getByTestId(`liability-detail-cancel-${t.again}`)).toHaveCount(0);

        // …and a cancel sent anyway is refused, the payment still accepted.
        const refused = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentCancel", {
          teamId: t.seller,
          paymentId: t.again,
        });
        expect.soft(refused.status).toBe(400);
        expect.soft(refused.body.code).toBe("failed_precondition");
        expect.soft(refused.body.message).toContain("only a pending payment can be cancelled");
        const listed = (await paymentsOf(page, t.seller)).find((p) => String(p.id) === t.again);
        expect.soft(listed?.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");
      });
    });
  }
});

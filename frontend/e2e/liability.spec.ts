import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #185 — the Liability screens: the position list and one counterparty's history.
//
// THE FIRST THING THE OWNER CAN LOOK AT, and it reads REAL COD obligations (#184) rather than seeded
// ledger rows: the spec creates a restock request and accepts it with a fee paid at the door, which
// is the only way a debt exists in this system today. If the screen is wrong, it is wrong while
// there are two tables and one writer.
//
// Root is a ROOT team, so the Liability menu item is not offered (it is a selling/warehouse surface),
// but root holds ROLE_ROOT and the RPCs are authorised in team 1 — the route is reached directly, as
// orders.spec.ts and expenses.spec.ts do. The menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const SKU = `SET${SUFFIX}`;
const COD_FEE = 25000;

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// call makes a Connect JSON call with the logged-in token, and fails loudly on a non-200 — a fixture
// that half-worked would produce an empty screen and a confusing assertion.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body] as const,
  );
}

// uploadProof runs the WHOLE four-step proof flow the payer performs before recording a payment
// (a-payment-must-carry-proof):
//
//   RequestUpload → PUT the bytes → ConfirmUpload → ShareDocument
//
// ⚠ THE SHARE IS THE STEP THAT MATTERS and the reason this is a helper rather than three inline
// lines. `GetDownloadUrl` scopes every read to the owning team, so without the fourth call the
// CREDITOR — the one person who has to look at the slip — gets NotFound on it. The payer grants it
// themselves, in their own scope, which is what keeps document_service from ever having to trust
// another service's word about who may read a file.
async function uploadProof(page: Page, ownerTeam: string, shareWith: string, filename: string) {
  const requested = await call(page, "document.v1.DocumentService/RequestUpload", {
    teamId: ownerTeam,
    filename,
    contentType: "image/png",
    sizeBytes: "70",
    resourceType: "DOCUMENT_RESOURCE_TYPE_PAYMENT_PROOF",
  });
  expect(requested.status).toBe(200);

  // The bytes go to the signed URL, with the headers echoed exactly as the response gave them.
  const put = await page.evaluate(
    async ([url, method, headers]) => {
      // A one-pixel PNG — the store validates the content type, and a thumbnail attempt on garbage
      // logs a warning that reads like a failure.
      const png = Uint8Array.from(atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ), (c) => c.charCodeAt(0));

      const res = await fetch(url as string, {
        method: method as string,
        headers: headers as Record<string, string>,
        body: png,
      });

      return res.status;
    },
    [requested.body.uploadUrl, requested.body.method, requested.body.headers ?? {}] as const,
  );
  expect(put).toBeLessThan(300);

  const confirmed = await call(page, "document.v1.DocumentService/ConfirmUpload", {
    uploadToken: requested.body.uploadToken,
  });
  expect(confirmed.status).toBe(200);

  const shared = await call(page, "document.v1.DocumentService/ShareDocument", {
    teamId: ownerTeam,
    documentId: confirmed.body.document.id,
    withTeamId: shareWith,
  });
  expect(shared.status).toBe(200);

  return confirmed.body.document.id as string;
}

// A COD restock, accepted — the one obligation this system creates today. Team 1 (root) plays the
// requesting team; team 1 cannot owe itself, so the warehouse is a separate id.
const WAREHOUSE_TEAM = 1;

// Shared across the two SERIAL tests below: the second reads the same debt from the other side, so
// it needs the id the first one created.
let warehouseId = "";

test.describe.configure({ mode: "serial" });

test("Liability: a COD acceptance creates the debt every test below reads (#185)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // A warehouse team for the goods to arrive at — the debt is between two DIFFERENT teams, since a
  // team cannot owe itself.
  const wh = await call(page, "team.v1.TeamService/TeamCreate", {
    name: `E2E Settle WH ${SUFFIX}`,
    teamCode: `SW${SUFFIX}`.slice(0, 10),
    type: "TEAM_TYPE_WAREHOUSE",
  });
  expect(wh.status).toBe(200);

  warehouseId = String(wh.body.team.id);

  const created = await call(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: String(WAREHOUSE_TEAM),
    warehouseId,
    shippingCode: "jne",
    items: [{ productId: "100", sku: SKU, name: "Widget", quantity: 10, totalPrice: "500000" }],
  });
  expect(created.status).toBe(200);

  const request = created.body.request;

  // The warehouse accepts, paying the courier at the door. THIS is what creates the obligation.
  const accepted = await call(page, "inventory.v1.RestockRequestService/RestockRequestFulfill", {
    teamId: warehouseId,
    requestId: String(request.id),
    // ⚠ `INCIDENTAL`, and the NOTE IS REQUIRED. The kinds collapsed to one
    // (the-ledger-speaks-the-business-words) and the note rule stopped being conditional with them:
    // every line is now the untyped case, so the words are the only thing saying what the money was
    // (an-incidental-line-must-say-what-it-was-for).
    costLines: [
      {
        kind: "RESTOCK_COST_KIND_INCIDENTAL",
        amount: String(COD_FEE),
        note: "courier asked at the door",
      },
    ],
    lines: request.items.map((item: { id: string; quantity: number }) => ({
      itemId: item.id,
      receivedQuantity: item.quantity,
      // "unplaced" is a REAL PLACE in this system (#135), not a rack id of zero — the contract makes
      // that a oneof so an empty row cannot masquerade as a partial put-away.
      placements: [{ unplaced: true, quantity: String(item.quantity) }],
    })),
  });
  expect(accepted.status).toBe(200);

  // ⚠ NO SCREEN ASSERTION HERE ANY MORE. This test used to read the debt off `/settlement`, which is
  // deleted — the word now means the MARKETPLACE PAYOUT, and this ledger reads at `/liability`. What
  // it still does is the part the later tests cannot do for themselves: CREATE the obligation. A COD
  // acceptance is the only way a debt exists in this system today, so every assertion below depends
  // on this having run, which is what `mode: "serial"` is for.
  expect(warehouseId).not.toBe("");
});

// THE SAME DEBT FROM THE OTHER SIDE. One signed number, one query, one convention — neither team has
// to know which way round the pair was stored.
//
// ⚠ RETARGETED from the deleted `/settlement` page rather than deleted with it. The rule is unchanged,
// but the redesign shows direction as TWO COLUMNS instead of a sentence, so what read `"They owe you"`
// is now "the amount sits in RECEIVABLE and PAYABLE is a dash". Nothing else in this file reads the
// ledger from the creditor's side.
test("Liability: the warehouse sees the same debt as money owed TO it (#185)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/liability");
  await expect(page.getByTestId("liability-list-page")).toBeVisible();

  // Root holds a role in every team, so the switcher is how the other side is reached. Selected by
  // TESTID, not by text: the switcher shows the current team AND the option list, so the name is on
  // screen twice.
  await page.getByTestId("team-switcher").click();
  await page.getByTestId(`team-option-${warehouseId}`).click();

  await page.goto("/liability");
  await expect(page.getByTestId("liability-table")).toBeVisible();

  // Team 1 owes THIS team, so from here the money is RECEIVABLE — the second of the two money cells.
  const cells = page.getByTestId(`liability-row-${WAREHOUSE_TEAM}`).locator("td");
  await expect(cells.nth(1)).toHaveText("—");
  await expect(cells.nth(2)).toHaveText("Rp 25.000");
});

// #221 — the Chakra redesign at /liability. Same real debt as above (root owes the warehouse), but the
// direction is TWO COLUMNS now, never a sign: the amount lands in Payable, and the age is its own cell.
// Reuses the serial seed's warehouseId.
test("Liability redesign: the position reads in two columns on /liability (#221)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/liability");
  await expect(page.getByTestId("liability-list-page")).toBeVisible();
  await expect(page.getByTestId("liability-table")).toBeVisible();

  const row = page.getByTestId(`liability-row-${warehouseId}`);
  await expect(row).toBeVisible();
  // Root OWES the warehouse, so the amount is in the Payable column — no minus sign anywhere.
  await expect(row).toContainText("Rp 25.000");
  await expect(row).not.toContainText("-");
  await expect(page.getByTestId(`liability-age-${warehouseId}`)).toBeVisible();

  // The header tile totals the payable side.
  await expect(page.getByTestId("liability-total-payable")).toContainText("Rp 25.000");
});

// #222 — the counterparty detail, redesigned. Clicking a /liability row opens the relationship's
// history: the net position in words, the ledger split by direction with its TYPED cause, and the
// Make-Payment form. Reuses the serial seed (root owes the warehouse a COD fee).
test("Liability redesign: the counterparty detail opens with the ledger and its typed cause (#222)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/liability");
  await page.getByTestId(`liability-row-${warehouseId}`).click();

  await expect(page.getByTestId("liability-detail-page")).toBeVisible();
  // Net position, in words — never a sign.
  await expect(page.getByTestId("liability-detail-balance")).toContainText("You owe them Rp 25.000");

  // The Payable tab carries the debt, named by its typed cause + the restock id (not a free-text note).
  await page.getByTestId("liability-detail-tab-payable").click();
  await expect(page.getByTestId("liability-detail-payable")).toContainText("Delivery costs");

  // Make Payment opens the two-phase form (recording alone moves nothing until they confirm).
  await page.getByTestId("liability-detail-make-payment").click();
  await expect(page.getByTestId("record-amount")).toBeVisible();
});

// §Payment Flow, end to end — the diagram in `balance_context.md`:
//
//   Team A sees what it owes → creates a Payment WITH PROOF → Team B checks manually
//     → correct?  yes → Accept    no → Reject
//
// ⚠ THE REJECT ARM IS THE ONE THAT DID NOT EXIST. Before it, a creditor facing a claim that never
// landed could only leave it pending forever, or CONFIRM and then REVERSE — two real ledger movements
// for money that never moved.
test("Liability: a payment is claimed with proof, refused, then paid again and accepted", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The debt the earlier tests created runs the other way: the warehouse is owed by team 1. So team 1
  // is the PAYER here and the warehouse is the CREDITOR — which is also why every act below is scoped
  // to whichever of the two is entitled to it.
  const proofId = await uploadProof(page, String(WAREHOUSE_TEAM), warehouseId, "transfer.png");

  // ⚠ A PAYMENT WITHOUT PROOF IS REFUSED BY THE CONTRACT (a-payment-must-carry-proof), so the
  // negative case is worth asserting before the happy one: the creditor's check is a MANUAL look at a
  // document, and a claim with nothing attached asks them to accept on the payer's word.
  const noProof = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
    teamId: String(WAREHOUSE_TEAM),
    creditorTeamId: warehouseId,
    amount: "5000",
    note: "no slip attached",
    documentIds: [],
  });
  expect(noProof.status).toBe(400);

  // A claim the creditor will refuse.
  const claimed = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
    teamId: String(WAREHOUSE_TEAM),
    creditorTeamId: warehouseId,
    amount: "5000",
    note: "transfer BCA",
    documentIds: [proofId],
  });
  expect(claimed.status).toBe(200);
  expect(claimed.body.payment.status).toBe("LIABILITY_PAYMENT_STATUS_RECORDED");

  const before = await call(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId: String(WAREHOUSE_TEAM),
    page: { page: 1, limit: 50 },
  });
  expect(before.status).toBe(200);

  // ⚠ RECORDING MOVED NOTHING. One side asserting a transfer is not evidence that it landed.
  const owedBefore = before.body.totalPayable;

  const rejected = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentReject", {
    teamId: warehouseId,
    paymentId: claimed.body.payment.id,
    reason: "no transfer of this amount reached our account",
  });
  expect(rejected.status).toBe(200);
  expect(rejected.body.payment.status).toBe("LIABILITY_PAYMENT_STATUS_REJECTED");
  // The payer has to be able to READ why, or they cannot tell whether to re-send the slip or the money.
  expect(rejected.body.payment.reason).toContain("reached our account");

  const afterReject = await call(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId: String(WAREHOUSE_TEAM),
    page: { page: 1, limit: 50 },
  });
  // ⛔ THE WHOLE POINT: a rejection posts NOTHING, so the debt is exactly what it was.
  expect(afterReject.body.totalPayable).toBe(owedBefore);

  // Rejection is TERMINAL — the payer records a new claim rather than amending this one.
  const reconfirm = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
    teamId: warehouseId,
    paymentId: claimed.body.payment.id,
  });
  expect(reconfirm.status).toBe(400);

  // The money really does arrive the second time.
  const proofId2 = await uploadProof(page, String(WAREHOUSE_TEAM), warehouseId, "transfer-2.png");

  const second = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentRecord", {
    teamId: String(WAREHOUSE_TEAM),
    creditorTeamId: warehouseId,
    amount: "5000",
    note: "transfer BCA, again",
    documentIds: [proofId2],
  });
  expect(second.status).toBe(200);

  const confirmed = await call(page, "liability.v1.LiabilityPaymentService/LiabilityPaymentConfirm", {
    teamId: warehouseId,
    paymentId: second.body.payment.id,
  });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.payment.status).toBe("LIABILITY_PAYMENT_STATUS_CONFIRMED");

  // ✅ THIS one posted. The debt fell by exactly the amount paid.
  const afterConfirm = await call(page, "liability.v1.LiabilityService/LiabilityPositionList", {
    teamId: String(WAREHOUSE_TEAM),
    page: { page: 1, limit: 50 },
  });
  expect(Number(afterConfirm.body.totalPayable)).toBe(Number(owedBefore) - 5000);
});

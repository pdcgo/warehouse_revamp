import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { listLanded } from "./pickers";
import { SUFFIX, api } from "./restock_helpers";

// THE COURIER'S CHARGE TYPED AT TANDAI TIBA IS KEPT, AND TERIMA'S FIGURE IS FINAL — end to end, on the real server,
// Postgres, document storage and the liability ledger (backlog #76):
//
//   the-courier-charge-is-noted-at-tiba-and-final-at-terima (docs/business/inventory/restock_decision.md) — the charge
//     at the door, its note (and the slip's photo) can be SET when the box is signed for and EDITED at Terima: what Tiba
//     sets is kept and shown, Terima opens with it, and its figure is final — it REPLACES Tiba's, never adds to it. The
//     money (the selling team owing the warehouse) moves only at Terima;
//   the-courier-is-paid-once-per-restock — one debt per restock, whichever act noted the charge;
//   the-cod-can-be-noted-when-the-box-arrives (docs/technical/frontend/restock_decision.md) — the sign dialog asks for it.
//
// The people: SARI owns the selling team that raises the restock (she reads its liability with the warehouse); DEDI, the
// warehouse's STAFF, signs for the box and counts it in. Root only seeds the ground, on a page of its own.
//
// ⚠ NOT PINNED: how the "noted" line is worded beyond its opening (*Noted by …* — not asked, the build's default), and the
// broken units' rack (waits on the owner).

const PASSWORD = "e2e-tiba-pass-1";
const SERVICE = "inventory.v1.RestockRequestService";
// A real 1×1 PNG — the detail pages must DRAW the slip, so the bytes have to be an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function tibaGround(browser: Browser, page: Page, tag: string) {
  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string, ownerUserId: string) =>
    String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId })).team.id);
  const user = async (teamId: string, username: string, role: string) =>
    String((await api(root, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: username, role })).user.id);

  // TeamCreate names an EXISTING person as the owner, so Sari's account is made first, in a scratch team of root's.
  const scratch = await team(`E2E Tiba Scratch ${tag} ${SUFFIX}`, `KTX${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", ROOT_USER_ID);
  const sariUsername = `e2etibasari${tag.toLowerCase()}${SUFFIX}`;
  const sari = await user(scratch, sariUsername, "ROLE_SELLING_ADMIN");
  const seller = await team(`E2E Tiba Seller ${tag} ${SUFFIX}`, `KTS${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", sari);

  const warehouse = await team(`E2E Tiba Gudang ${tag} ${SUFFIX}`, `KTW${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE", ROOT_USER_ID);
  const dediUsername = `e2etibadedi${tag.toLowerCase()}${SUFFIX}`;
  await user(warehouse, dediUsername, "ROLE_WAREHOUSE_STAFF");
  const rack = String(
    (await api(root, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `tiba-${tag.toLowerCase()}-${SUFFIX}`, name: "E2E tiba shelf" }))
      .rack.id,
  );

  const category = await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E Tiba Cat ${tag} ${SUFFIX}` });
  const part = `KTP${tag}${SUFFIX}`;
  const created = (await api(root, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: part, name: `E2E ${part}`, categoryId: category.category.id }))
    .product;
  const product = { id: String(created.id), code: String(created.productCode || part), name: `E2E ${part}` };

  const account = String(
    (
      await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Tiba Kas ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `TIBA-${tag}-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: seller, accountId: account, operational: true });
  await root.close();

  // Sari on the test's own page, in her selling team; Dedi on a page of his own, in his warehouse.
  await signIn(page, sariUsername, PASSWORD);
  await asTeam(page, seller);
  const door = await browser.newPage();
  await signIn(door, dediUsername, PASSWORD);
  await asTeam(door, warehouse);

  return { seller, warehouse, rack, product, account, door };
}

type Ground = Awaited<ReturnType<typeof tibaGround>>;

// Sari raises a restock of 5 units for Rp 50.000 — `n` keeps its resi unique within the team.
async function raise(page: Page, g: Ground, n: number): Promise<string> {
  const request = (
    await api(page, `${SERVICE}/RestockRequestCreate`, {
      teamId: g.seller,
      warehouseId: g.warehouse,
      financeAccountId: g.account,
      receipt: `E2E-TIBA-${n}-${g.seller}-${SUFFIX}`,
      items: [{ productId: g.product.id, productCode: g.product.code, name: g.product.name, count: 5, total: 50_000 }],
    })
  ).request;

  return String(request.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detail(page: Page, teamId: string, id: string): Promise<any> {
  return (await api(page, `${SERVICE}/RestockRequestDetail`, { teamId, requestId: id })).request;
}

// Hold every ConfirmUpload until `release` — the slip stays "on its way" for as long as the test needs to read it.
async function holdUploads(page: Page) {
  const pattern = "**/warehouse.document.v1.DocumentService/ConfirmUpload";
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue();
  });

  return { release: open, done: () => page.unroute(pattern) };
}

// A thumbnail that opens its photo whole — and the photo DRAWS, so the signed link really opened the stored file.
async function opensWhole(page: Page, testId: string) {
  await page.getByTestId(`${testId}-open`).click();
  const dialog = page.getByTestId(`${testId}-dialog`);
  await expect(dialog).toBeVisible();
  const img = dialog.locator("img");
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

// THE SIGN — Dedi, from the warehouse's inbound row: Tandai Tiba, the charge asked for (or not), typed, noted.
async function signFor(door: Page, id: string, charge?: { typed: string; note: string }) {
  await door.goto("/inventories/restock?status=all");
  await expect(door.getByTestId("restock-inbound-page")).toBeVisible();
  const row = door.getByTestId(`restock-row-${id}`);
  await expect(row.getByTestId("restock-status-1")).toBeVisible();
  await row.getByTestId(`restock-action-sign-${id}`).click();
  if (charge) {
    await door.getByTestId("sign-courier-asked-yes").click();
    await door.getByTestId("sign-courier-charge").fill(charge.typed);
    await door.getByTestId("sign-courier-note").fill(charge.note);
  }

  return row;
}

async function confirmSign(door: Page, row: ReturnType<Page["getByTestId"]>) {
  const arrived = door.waitForResponse((res) => res.url().endsWith(`/warehouse.${SERVICE}/RestockRequestArrive`));
  await door.getByTestId("confirm-action").click();
  const res = await arrived;
  expect(res.status()).toBe(200);
  await expect(row.getByTestId("restock-status-4")).toBeVisible();

  return res.request().postDataJSON() as Record<string, unknown>;
}

// TERIMA — every unit arrived, none broken, all on the rack; then Terima and its confirm.
async function countAllIn(door: Page, g: Ground) {
  await door.getByTestId(`accept-all-arrived-${g.product.id}`).click();
  const row = door.getByTestId(`accept-placement-${g.product.id}-0`);
  await listLanded(row.getByTestId(`rack-select-option-${g.rack}`));
  await row.getByTestId("rack-select").click();
  await row.getByTestId(`rack-select-option-${g.rack}`).click();
  await expect(door.getByTestId(`accept-balanced-${g.product.id}`)).toBeVisible();
}

async function terima(door: Page, id: string) {
  const submit = door.getByTestId("accept-submit");
  await expect(submit).toBeEnabled();
  const accepted = door.waitForResponse((res) => res.url().endsWith(`/warehouse.${SERVICE}/RestockRequestAccept`));
  await submit.click();
  await door.getByTestId("confirm-action").click();
  const res = await accepted;
  expect(res.status()).toBe(200);
  await expect(door).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

  return res.request().postDataJSON() as Record<string, unknown>;
}

// The selling team's ledger with the warehouse — the entries naming this restock (Sari, the team's owner, reads it).
async function ledgerEntries(page: Page, g: Ground, id: string) {
  await page.goto(`/liability/${g.warehouse}`);
  await expect(page.getByTestId("liability-detail-page")).toBeVisible();
  await expect(page.getByTestId("liability-detail-all")).toBeVisible();
  await expect(page.getByTestId("liability-detail-tab-loading")).toHaveCount(0);

  return page.getByTestId("liability-detail-all").locator('[data-testid^="liability-detail-entry-"]').filter({ hasText: `restock #${id}` });
}

test.describe("the courier's charge typed at Tandai Tiba is kept, and Terima's figure is final", () => {
  test.describe.configure({ timeout: 180_000 });

  test("Tiba charge: Rp 8.000, its note and its slip are kept at the sign — both pages say it is noted, nothing is owed yet; Terima opens with it, changed to Rp 10.000, and ONE debt of Rp 10.000 posts", async ({
    browser,
    page,
  }) => {
    const g = await tibaGround(browser, page, "A");
    const { door } = g;
    const id = await raise(page, g, 1);
    const NOTE = `COD asked at the door ${SUFFIX}`;

    // ── TANDAI TIBA, as the warehouse's staff: the charge, its note, and the slip — the sign waits while it uploads ──
    const row = await signFor(door, id, { typed: "8000", note: NOTE });
    const hold = await holdUploads(door);
    await door.getByTestId("sign-courier-photo-input").setInputFiles({ name: "nota.png", mimeType: "image/png", buffer: PNG });
    const slip = door.getByTestId("sign-courier-photo-shown");
    await expect(slip).toHaveAttribute("data-state", "uploading");
    await expect(door.getByTestId("confirm-action")).toBeDisabled();
    hold.release();
    await expect(slip).toHaveAttribute("data-state", "kept");
    await hold.done();
    await expect(door.getByTestId("confirm-action")).toBeEnabled();
    const sent = await confirmSign(door, row);
    expect(Number(sent.warehouseAdditionalCost)).toBe(8000);
    expect(sent.warehouseAdditionalCostNote).toBe(NOTE);
    expect(String(sent.warehouseAdditionalCostFile ?? "")).not.toBe("");

    // ── KEPT on the restock, which is arrived, not accepted ────────────────────────────────────────────────────────
    const kept = await detail(door, g.warehouse, id);
    expect(kept.status).toBe("RESTOCK_REQUEST_STATUS_ARRIVED");
    expect(kept.warehouseAdditionalCost).toBe(8000);
    expect(kept.warehouseAdditionalCostNote).toBe(NOTE);
    expect(String(kept.warehouseAdditionalCostFile ?? "")).toBe(String(sent.warehouseAdditionalCostFile));

    // ── THE WAREHOUSE'S PAGE (Dedi): Kiriman's charge, its note and slip, said as NOTED — final at Terima ──────────────
    await door.goto(`/inventories/restock/${id}`);
    await expect(door.getByTestId("restock-detail-page")).toBeVisible();
    await expect(door.getByTestId("restock-detail-courier-charge")).toContainText("8.000");
    await expect(door.getByTestId("restock-detail-courier-charge-note")).toHaveText(NOTE);
    await expect(door.getByTestId("restock-detail-courier-charge-owed")).toContainText("Noted by this warehouse when the box was signed for");
    await expect(door.getByTestId("restock-detail-courier-photo")).toBeVisible();
    await opensWhole(door, "restock-detail-courier-photo");

    // ── THE SELLING TEAM'S PAGE (Sari): its Ongkir COD card shows once a charge is noted — the same figure, noted ─────
    await page.goto(`/inventories/restock/${id}`);
    await expect(page.getByTestId("restock-detail-page")).toBeVisible();
    const card = page.getByTestId("restock-detail-courier-charge-card");
    await expect(card.getByTestId("restock-detail-courier-charge")).toContainText("8.000");
    await expect(card.getByTestId("restock-detail-courier-charge-note")).toHaveText(NOTE);
    await expect(card.getByTestId("restock-detail-courier-charge-owed")).toContainText("Noted by");
    await expect(card.getByTestId("restock-detail-courier-charge-owed")).toContainText("when the box was signed for");
    await expect(card.getByTestId("restock-detail-courier-photo")).toBeVisible();

    // ── NO MONEY AT TIBA: the selling team's ledger with the warehouse holds nothing for this restock ─────────────────
    await page.waitForTimeout(3_000);
    await expect(await ledgerEntries(page, g, id)).toHaveCount(0);

    // ── TERIMA opens with Tiba's charge, its note and its slip (already kept) — Dedi changes the charge to Rp 10.000 ──
    await door.goto(`/inventories/restock/${id}/accept`);
    await expect(door.getByTestId(`accept-line-${g.product.id}`)).toBeVisible();
    await expect(door.getByTestId("accept-courier-owed")).toContainText("8.000");
    await expect(door.getByTestId("accept-courier-paid-line")).toContainText(NOTE);
    await door.getByTestId("accept-courier-edit").click();
    await expect(door.getByTestId("accept-courier-note")).toHaveValue(NOTE);
    await expect(door.getByTestId("accept-courier-photo-shown")).toHaveAttribute("data-state", "kept");
    await door.getByTestId("accept-courier-charge").fill("10000");
    await door.getByTestId("accept-courier-done").click();
    await expect(door.getByTestId("accept-courier-owed")).toContainText("10.000");
    await countAllIn(door, g);
    const accepted = await terima(door, id);
    expect(Number(accepted.warehouseAdditionalCost)).toBe(10_000);

    // ── FINAL: Terima's figure replaced Tiba's; the note and the slip kept ────────────────────────────────────────────
    const final = await detail(door, g.warehouse, id);
    expect(final.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
    expect(final.warehouseAdditionalCost).toBe(10_000);
    expect(final.warehouseAdditionalCostNote).toBe(NOTE);
    expect(String(final.warehouseAdditionalCostFile ?? "")).toBe(String(sent.warehouseAdditionalCostFile));

    // The selling page now says it is OWED, at Terima's figure.
    await page.goto(`/inventories/restock/${id}`);
    const owedCard = page.getByTestId("restock-detail-courier-charge-card");
    await expect(owedCard.getByTestId("restock-detail-courier-charge")).toContainText("10.000");
    await expect(owedCard.getByTestId("restock-detail-courier-charge-owed")).toContainText("Your team owes it to the warehouse");

    // ── ONE DEBT, Rp 10.000 — never Tiba's 8.000, never both. Liability posts from the accept's event: re-read. ───────
    await expect(async () => {
      const entries = await ledgerEntries(page, g, id);
      await expect(entries).toHaveCount(1, { timeout: 3_000 });
      await expect(entries).toContainText("10.000");
      await expect(entries).not.toContainText("8.000");
    }).toPass({ timeout: 30_000 });

    await door.close();
  });

  test("Tiba charge: Rp 7.500 left as it is at Terima posts ONCE at Tiba's figure; a box signed with no charge keeps none and shows none", async ({
    browser,
    page,
  }) => {
    const g = await tibaGround(browser, page, "B");
    const { door } = g;
    const noted = await raise(page, g, 1);
    const none = await raise(page, g, 2);
    const NOTE = `ongkir di pintu ${SUFFIX}`;

    // ── R1: signed with Rp 7.500 and its note, no slip ────────────────────────────────────────────────────────────
    const row1 = await signFor(door, noted, { typed: "7500", note: NOTE });
    await confirmSign(door, row1);
    expect((await detail(door, g.warehouse, noted)).warehouseAdditionalCost).toBe(7500);

    // ── R2: signed with Tidak ada — nothing to fill, nothing kept ─────────────────────────────────────────────────────
    const row2 = await signFor(door, none);
    const sentNone = await confirmSign(door, row2);
    expect(Number(sentNone.warehouseAdditionalCost ?? 0)).toBe(0);
    const keptNone = await detail(door, g.warehouse, none);
    expect(keptNone.warehouseAdditionalCost ?? 0).toBe(0);
    expect(keptNone.warehouseAdditionalCostNote ?? "").toBe("");

    // Neither page draws a charge for R2: the warehouse's Kiriman has no figure, the selling page no Ongkir COD card.
    await door.goto(`/inventories/restock/${none}`);
    await expect(door.getByTestId("restock-detail-page")).toBeVisible();
    await expect(door.getByTestId("restock-detail-courier-charge")).toHaveCount(0);
    await page.goto(`/inventories/restock/${none}`);
    await expect(page.getByTestId("restock-detail-page")).toBeVisible();
    await expect(page.getByTestId("restock-detail-courier-charge-card")).toHaveCount(0);

    // …and its Terima opens with no charge.
    await door.goto(`/inventories/restock/${none}/accept`);
    await expect(door.getByTestId(`accept-line-${g.product.id}`)).toBeVisible();
    await expect(door.getByTestId("accept-courier-none")).toBeVisible();

    // ── R1's TERIMA: opened with Tiba's Rp 7.500, left as it is ───────────────────────────────────────────────────────
    await door.goto(`/inventories/restock/${noted}/accept`);
    await expect(door.getByTestId(`accept-line-${g.product.id}`)).toBeVisible();
    await expect(door.getByTestId("accept-courier-owed")).toContainText("7.500");
    await countAllIn(door, g);
    const accepted = await terima(door, noted);
    expect(Number(accepted.warehouseAdditionalCost)).toBe(7500);
    const final = await detail(door, g.warehouse, noted);
    expect(final.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
    expect(final.warehouseAdditionalCost).toBe(7500);
    expect(final.warehouseAdditionalCostNote).toBe(NOTE);

    // ── ONE DEBT for R1, at Tiba's figure; none for R2 ────────────────────────────────────────────────────────────────
    await expect(async () => {
      const entries = await ledgerEntries(page, g, noted);
      await expect(entries).toHaveCount(1, { timeout: 3_000 });
      await expect(entries).toContainText("7.500");
    }).toPass({ timeout: 30_000 });
    await expect(await ledgerEntries(page, g, none)).toHaveCount(0);

    await door.close();
  });
});

import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { listLanded } from "./pickers";
import { SUFFIX, api } from "./restock_helpers";

// THE PHOTOS TAKEN AT THE DOOR ARE KEPT, AND BOTH SIDES OF THE RESTOCK READ THEM BACK — end to end, on the real server,
// Postgres and document storage (backlog #66):
//
//   a-broken-product-carries-a-photo (docs/technical/frontend/restock_decision.md) — at Terima a line with broken units
//     takes ONE optional photo, uploaded under the receiving warehouse the moment it is picked; Terima waits only while it
//     is still on its way, and the accept keeps it on the line's broken row;
//   the-courier-slip-has-an-optional-photo — the courier's slip, optional, kept with the charge — only with a charge
//     above 0: a slip sent with none is dropped;
//   the-detail-pages-show-the-broken-photo, the-detail-pages-show-the-slip-and-the-broken-rack (the slip part) — the
//     selling team's page and the warehouse's page show the restock's OWN photos (RestockDoorPhotos): either side of the
//     restock reads them, a third team reads NotFound, a link is signed only for a file the restock's warehouse uploaded,
//     and a restock that kept no photo shows none and asks for none.
//
// The people: SARI, a selling admin, owns the selling team that raises the restock; DEDI, the warehouse's STAFF, counts it
// in at the door (any-warehouse-member-counts-what-arrived) — the photos are his uploads; EKO is staff of ANOTHER
// warehouse. Root only seeds the ground, on a page of its own.
//
// ⚠ NOT PINNED: the broken units' rack (a-broken-product-may-go-on-a-rack — waits on the owner against
// a-broken-unit-is-thrown-away); Tandai Tiba's slip photo (not uploaded there — its charge is not kept yet).

const PASSWORD = "e2e-door-pass-1";
const SERVICE = "inventory.v1.RestockRequestService";
// A real 1×1 PNG — the detail pages must DRAW it, so the bytes have to be an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function doorGround(browser: Browser, page: Page, tag: string) {
  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string, ownerUserId: string) =>
    String((await api(root, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId })).team.id);
  const user = async (teamId: string, username: string, role: string) =>
    String((await api(root, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name: username, role })).user.id);

  // TeamCreate names an EXISTING person as the owner, so Sari's account is made first, in a scratch team of root's.
  const scratch = await team(`E2E Door Scratch ${tag} ${SUFFIX}`, `DX${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", ROOT_USER_ID);
  const sariUsername = `e2edoorsari${tag.toLowerCase()}${SUFFIX}`;
  const sari = await user(scratch, sariUsername, "ROLE_SELLING_ADMIN");
  const seller = await team(`E2E Door Seller ${tag} ${SUFFIX}`, `DS${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_SELLING", sari);

  const warehouse = await team(`E2E Door Gudang ${tag} ${SUFFIX}`, `DW${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE", ROOT_USER_ID);
  const dediUsername = `e2edoordedi${tag.toLowerCase()}${SUFFIX}`;
  await user(warehouse, dediUsername, "ROLE_WAREHOUSE_STAFF");
  const rack = String(
    (await api(root, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `door-${tag.toLowerCase()}-${SUFFIX}`, name: "E2E door shelf" }))
      .rack.id,
  );

  // A third team — another warehouse — and its staff.
  const other = await team(`E2E Door Gudang Lain ${tag} ${SUFFIX}`, `DO${tag}${SUFFIX}`.slice(0, 10), "TEAM_TYPE_WAREHOUSE", ROOT_USER_ID);
  const ekoUsername = `e2edooreko${tag.toLowerCase()}${SUFFIX}`;
  await user(other, ekoUsername, "ROLE_WAREHOUSE_STAFF");

  const category = await api(root, "category.v1.CategoryService/CategoryCreate", { name: `E2E Door Cat ${tag} ${SUFFIX}` });
  const product = async (part: string) => {
    const created = (await api(root, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: part, name: `E2E ${part}`, categoryId: category.category.id }))
      .product;
    return { id: String(created.id), code: String(created.productCode || part), name: `E2E ${part}` };
  };
  const a = await product(`DPA${tag}${SUFFIX}`);
  const b = await product(`DPB${tag}${SUFFIX}`);

  const account = String(
    (
      await api(root, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Door Kas ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `DOOR-${tag}-${SUFFIX}`,
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

  return { seller, warehouse, rack, other, ekoUsername, a, b, account, door };
}

type Ground = Awaited<ReturnType<typeof doorGround>>;

// Sari raises a restock of A × 10 (Rp 100.000) and B × 4 (Rp 20.000) — `n` keeps its resi unique within the team.
async function raise(page: Page, g: Ground, n: number) {
  const request = (
    await api(page, `${SERVICE}/RestockRequestCreate`, {
      teamId: g.seller,
      warehouseId: g.warehouse,
      financeAccountId: g.account,
      receipt: `E2E-DOOR-${n}-${g.seller}-${SUFFIX}`,
      items: [
        { productId: g.a.id, productCode: g.a.code, name: g.a.name, count: 10, total: 100_000 },
        { productId: g.b.id, productCode: g.b.code, name: g.b.name, count: 4, total: 20_000 },
      ],
    })
  ).request;
  const item = (productId: string) => String(request.items.find((i: { productId: string }) => String(i.productId) === productId).id);

  return { id: String(request.id), itemA: item(g.a.id), itemB: item(g.b.id) };
}

// A file uploaded the way the app uploads one — RequestUpload → PUT the bytes → ConfirmUpload — in `teamId`'s scope.
async function upload(page: Page, teamId: string, filename: string): Promise<string> {
  const requested = await api(page, "document.v1.DocumentService/RequestUpload", {
    teamId,
    filename,
    contentType: "image/png",
    sizeBytes: String(PNG.length),
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
  });
  const put = await page.evaluate(
    async ([url, method, headers, b64]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const res = await fetch(url as string, { method: method as string, headers: headers as Record<string, string>, body: bytes });
      return res.status;
    },
    [requested.uploadUrl, requested.method, requested.headers ?? {}, PNG.toString("base64")] as const,
  );
  expect(put).toBeLessThan(300);

  return String((await api(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken })).document.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detail(page: Page, teamId: string, id: string): Promise<any> {
  return (await api(page, `${SERVICE}/RestockRequestDetail`, { teamId, requestId: id })).request;
}

// The photo kept on a product's BROKEN row, "" when none (proto JSON leaves an empty string out).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function brokenPhotoOf(request: any, productId: string): string {
  const item = request.items.find((i: { productId: string }) => String(i.productId) === productId);
  const broken = (item.problems ?? []).find((p: { type: string }) => p.type === "RESTOCK_PROBLEM_TYPE_BROKEN");
  return broken?.photoFile ?? "";
}

// RestockDoorPhotos as `teamId`: the slip's link and each photographed line's, by product.
async function doorPhotos(page: Page, teamId: string, id: string) {
  const res = await api(page, `${SERVICE}/RestockDoorPhotos`, { teamId, requestId: id });
  return {
    slip: String(res.courierSlipUrl ?? ""),
    broken: Object.fromEntries(((res.broken ?? []) as { productId: string; url: string }[]).map((b) => [String(b.productId), b.url])),
  };
}

// Hold every ConfirmUpload until `release` — the photo stays "on its way" for as long as the test needs to read it.
async function holdUploads(page: Page) {
  const pattern = "**/warehouse.document.v1.DocumentService/ConfirmUpload";
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue();
  });

  return {
    release: open,
    done: () => page.unroute(pattern),
  };
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

// Every RestockDoorPhotos call the page makes, from now on.
function doorPhotoCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(`/warehouse.${SERVICE}/RestockDoorPhotos`)) calls.push(r.url());
  });
  return calls;
}

// One line counted in on the accept screen: all of it arrived, `broken` of it broken, the good units on the rack.
async function countIn(door: Page, g: Ground, productId: string, broken: number) {
  await door.getByTestId(`accept-all-arrived-${productId}`).click();
  if (broken > 0) {
    await door.getByTestId(`accept-broken-${productId}`).fill(String(broken));
  }
  const row = door.getByTestId(`accept-placement-${productId}-0`);
  await listLanded(row.getByTestId(`rack-select-option-${g.rack}`));
  await row.getByTestId("rack-select").click();
  await row.getByTestId(`rack-select-option-${g.rack}`).click();
  await expect(door.getByTestId(`accept-balanced-${productId}`)).toBeVisible();
}

test.describe("the photos taken at the door are kept, and both sides of the restock read them back", () => {
  test.describe.configure({ timeout: 150_000 });

  test("Door photos: Terima waits for each photo on its way, keeps the broken units' photo and the courier's slip — both detail pages open them, a third team reads NotFound", async ({
    browser,
    page,
  }) => {
    const g = await doorGround(browser, page, "K");
    const { door } = g;
    const r = await raise(page, g, 1);

    // ── TERIMA, as the warehouse's staff ─────────────────────────────────────────────────────────────────────────────
    await door.goto(`/inventories/restock/${r.id}/accept`);
    await expect(door.getByTestId(`accept-line-${g.a.id}`)).toBeVisible();

    // A: 10 arrived, 2 broken. B: 4 arrived, none broken — so B has no broken block and no photo to take.
    await countIn(door, g, g.a.id, 2);
    await countIn(door, g, g.b.id, 0);
    await door.getByTestId(`accept-broken-note-${g.a.id}`).fill("karton sobek");
    await expect(door.getByTestId(`accept-broken-photo-${g.a.id}-pick`)).toBeVisible();
    await expect(door.getByTestId(`accept-broken-photo-${g.b.id}`)).toHaveCount(0);

    // Optional: with no photo at all, Terima is already ready.
    const submit = door.getByTestId("accept-submit");
    await expect(submit).toBeEnabled();

    // THE BROKEN UNITS' PHOTO — picked, it goes up at once; while it is on its way Terima waits and the ready line says why.
    const brokenHold = await holdUploads(door);
    await door.getByTestId(`accept-broken-photo-${g.a.id}-input`).setInputFiles({ name: "rusak.png", mimeType: "image/png", buffer: PNG });
    const brokenShown = door.getByTestId(`accept-broken-photo-${g.a.id}-shown`);
    await expect(brokenShown).toHaveAttribute("data-state", "uploading");
    await expect(brokenShown).toContainText("rusak.png");
    await expect(submit).toBeDisabled();
    await expect(door.getByTestId(`accept-ready-line-missing-photo-line-${g.a.id}`)).toBeVisible();
    brokenHold.release();
    await expect(brokenShown).toHaveAttribute("data-state", "kept");
    await brokenHold.done();
    await expect(door.getByTestId(`accept-ready-line-missing-photo-line-${g.a.id}`)).toHaveCount(0);
    await expect(submit).toBeEnabled();

    // THE COURIER'S CHARGE, and a photo of its slip — the same wait while it uploads.
    await door.getByTestId("accept-courier-edit").click();
    await door.getByTestId("accept-courier-asked-yes").click();
    await door.getByTestId("accept-courier-charge").fill("8000");
    await door.getByTestId("accept-courier-note").fill("COD diminta kurir di pintu");
    await expect(submit).toBeEnabled();
    const slipHold = await holdUploads(door);
    await door.getByTestId("accept-courier-photo-input").setInputFiles({ name: "nota.png", mimeType: "image/png", buffer: PNG });
    const slipShown = door.getByTestId("accept-courier-photo-shown");
    await expect(slipShown).toHaveAttribute("data-state", "uploading");
    await expect(submit).toBeDisabled();
    await expect(door.getByTestId("accept-ready-line-missing-photo-charge")).toBeVisible();
    slipHold.release();
    await expect(slipShown).toHaveAttribute("data-state", "kept");
    await slipHold.done();
    await expect(submit).toBeEnabled();

    const accepted = door.waitForResponse((res) => res.url().endsWith(`/warehouse.${SERVICE}/RestockRequestAccept`));
    await submit.click();
    await door.getByTestId("confirm-action").click();
    expect((await accepted).status()).toBe(200);
    await expect(door).toHaveURL(new RegExp(`/inventories/restock/${r.id}$`));

    // ── KEPT: the slip on the restock beside its charge, the photo on A's broken row, none for B ────────────────────
    const kept = await detail(door, g.warehouse, r.id);
    expect(kept.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
    expect(kept.warehouseAdditionalCost).toBe(8000);
    expect(String(kept.warehouseAdditionalCostFile ?? "")).not.toBe("");
    expect(brokenPhotoOf(kept, g.a.id)).not.toBe("");
    expect(brokenPhotoOf(kept, g.b.id)).toBe("");

    // ── THE WAREHOUSE'S PAGE (Dedi, where Terima landed): A's Rusak cell shows its photo, B's none; the slip under the
    // charge's note. Each opens whole, and draws.
    await expect(door.getByTestId("restock-detail-page")).toBeVisible();
    await expect(door.getByTestId(`restock-detail-broken-photo-${g.a.id}`)).toBeVisible();
    await expect(door.getByTestId(`restock-detail-broken-photo-${g.b.id}`)).toHaveCount(0);
    await opensWhole(door, `restock-detail-broken-photo-${g.a.id}`);
    await expect(door.getByTestId("restock-detail-courier-charge-note")).toContainText("COD diminta kurir di pintu");
    await expect(door.getByTestId("restock-detail-courier-photo")).toBeVisible();
    await opensWhole(door, "restock-detail-courier-photo");

    // ── THE SELLING TEAM'S PAGE (Sari): the slip in the courier's card; A's photo in its Penyesuaian, under the broken row.
    await page.goto(`/inventories/restock/${r.id}`);
    await expect(page.getByTestId("restock-detail-page")).toBeVisible();
    const card = page.getByTestId("restock-detail-courier-charge-card");
    await expect(card.getByTestId("restock-detail-courier-charge")).toContainText("8.000");
    await expect(card.getByTestId("restock-detail-courier-photo")).toBeVisible();
    await opensWhole(page, "restock-detail-courier-photo");

    await page.getByTestId(`restock-detail-adjustment-${g.a.id}`).click();
    const adjustA = page.getByTestId(`restock-detail-adjustment-${g.a.id}-dialog`);
    await expect(adjustA).toBeVisible();
    await expect(adjustA.getByTestId(`restock-detail-broken-${g.a.id}-count`)).toHaveText("2");
    await expect(adjustA.getByTestId(`restock-detail-broken-${g.a.id}-note`)).toContainText("karton sobek");
    await adjustA.getByTestId(`restock-detail-broken-photo-${g.a.id}-open`).click();
    const photoA = page.getByTestId(`restock-detail-broken-photo-${g.a.id}-dialog`);
    await expect(photoA).toBeVisible();
    await expect.poll(() => photoA.locator("img").evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);

    // ── WHO READS THEM: both sides of the restock; a third team reads NotFound, as for an id that does not exist ────────
    const bySeller = await doorPhotos(page, g.seller, r.id);
    expect(bySeller.slip).toMatch(/^https?:\/\//);
    expect(Object.keys(bySeller.broken)).toEqual([g.a.id]);
    const byWarehouse = await doorPhotos(door, g.warehouse, r.id);
    expect(byWarehouse.slip).toMatch(/^https?:\/\//);
    expect(Object.keys(byWarehouse.broken)).toEqual([g.a.id]);

    await signIn(door, g.ekoUsername, PASSWORD);
    await expect(doorPhotos(door, g.other, r.id)).rejects.toThrow(/404|not_found/);

    await door.close();
  });

  test("Door photos: a slip with no charge is dropped, a file the warehouse did not upload never opens, and a restock that kept none shows none and asks for none", async ({
    browser,
    page,
  }) => {
    const g = await doorGround(browser, page, "N");
    const { door } = g;

    // ── R1: accepted with 1 broken unit and NO photo, no charge — and a slip sent anyway, which has no charge to go with.
    const r1 = await raise(page, g, 1);
    const strayslip = await upload(door, g.warehouse, "nota-tanpa-ongkir.png");
    await api(door, `${SERVICE}/RestockRequestAccept`, {
      teamId: g.warehouse,
      requestId: r1.id,
      warehouseAdditionalCost: 0,
      warehouseAdditionalCostFile: strayslip,
      lines: [
        { itemId: r1.itemA, receivedCount: 10, brokenCount: 1, placements: [{ placementId: g.rack, quantity: 9 }] },
        { itemId: r1.itemB, receivedCount: 4, placements: [{ placementId: g.rack, quantity: 4 }] },
      ],
    });

    const one = await detail(door, g.warehouse, r1.id);
    expect(one.status).toBe("RESTOCK_REQUEST_STATUS_ACCEPTED");
    expect(String(one.warehouseAdditionalCostFile ?? "")).toBe("");
    expect(brokenPhotoOf(one, g.a.id)).toBe("");
    expect(await doorPhotos(door, g.warehouse, r1.id)).toEqual({ slip: "", broken: {} });

    // Neither page shows a photo — and neither asks for one.
    const warehouseCalls = doorPhotoCalls(door);
    await door.goto(`/inventories/restock/${r1.id}`);
    await expect(door.getByTestId(`restock-detail-broken-${g.a.id}`)).toBeVisible();
    await expect(door.getByTestId("restock-detail-courier-charge-none")).toBeVisible();
    await door.waitForLoadState("networkidle");
    await expect(door.getByTestId(`restock-detail-broken-photo-${g.a.id}`)).toHaveCount(0);
    await expect(door.getByTestId("restock-detail-courier-photo")).toHaveCount(0);
    expect(warehouseCalls).toEqual([]);

    const sellerCalls = doorPhotoCalls(page);
    await page.goto(`/inventories/restock/${r1.id}`);
    await expect(page.getByTestId("restock-detail-courier-charge-card").getByTestId("restock-detail-courier-charge-none")).toBeVisible();
    await page.getByTestId(`restock-detail-adjustment-${g.a.id}`).click();
    const adjust1 = page.getByTestId(`restock-detail-adjustment-${g.a.id}-dialog`);
    await expect(adjust1.getByTestId(`restock-detail-broken-${g.a.id}-count`)).toHaveText("1");
    await page.waitForLoadState("networkidle");
    await expect(adjust1.getByTestId(`restock-detail-broken-photo-${g.a.id}`)).toHaveCount(0);
    await expect(page.getByTestId("restock-detail-courier-photo")).toHaveCount(0);
    expect(sellerCalls).toEqual([]);
    await page.keyboard.press("Escape");

    // ── R2: a charge with the warehouse's own slip, and A's broken photo pointing at a file SARI uploaded — not the
    // warehouse's upload, so it is never signed: the slip opens, the broken photo is left out.
    const r2 = await raise(page, g, 2);
    const sellersFile = await upload(page, g.seller, "bukan-foto-gudang.png");
    const slip = await upload(door, g.warehouse, "nota.png");
    await api(door, `${SERVICE}/RestockRequestAccept`, {
      teamId: g.warehouse,
      requestId: r2.id,
      warehouseAdditionalCost: 5000,
      warehouseAdditionalCostNote: "ongkos bongkar",
      warehouseAdditionalCostFile: slip,
      lines: [
        { itemId: r2.itemA, receivedCount: 10, brokenCount: 1, brokenPhotoFile: sellersFile, placements: [{ placementId: g.rack, quantity: 9 }] },
        { itemId: r2.itemB, receivedCount: 4, placements: [{ placementId: g.rack, quantity: 4 }] },
      ],
    });

    const two = await doorPhotos(door, g.warehouse, r2.id);
    expect(two.slip).toMatch(/^https?:\/\//);
    expect(two.broken).toEqual({});

    await page.goto(`/inventories/restock/${r2.id}`);
    const card = page.getByTestId("restock-detail-courier-charge-card");
    await expect(card.getByTestId("restock-detail-courier-photo")).toBeVisible();
    await opensWhole(page, "restock-detail-courier-photo");
    await page.getByTestId(`restock-detail-adjustment-${g.a.id}`).click();
    const adjust2 = page.getByTestId(`restock-detail-adjustment-${g.a.id}-dialog`);
    await expect(adjust2.getByTestId(`restock-detail-broken-${g.a.id}-count`)).toHaveText("1");
    await expect(adjust2.getByTestId(`restock-detail-broken-photo-${g.a.id}`)).toHaveCount(0);

    await door.close();
  });
});


import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";
import { readXlsx } from "./xlsx";

// RESTOCK TAGS — end to end, on the real server and Postgres (backlog #87). The rules
// (docs/business/inventory/restock_decision.md and docs/technical/frontend/restock_decision.md):
//
//   a-restock-tag-is-system-or-custom — a restock carries tags, SYSTEM or CUSTOM, and the restock list filters by tag;
//   custom-tags-are-shared-system-tags-are-the-admins-and-the-apps — ONE app-wide list, a name unique across it (any
//     case): a name that exists answers that tag, never a twin; a custom tag is made and put on / taken off by any team
//     role that may tag, from EITHER side of the restock; a system tag is made, put on and taken off by Root / the
//     Administrator alone; renaming and deleting a tag (Kelola tag) are the admins' alone (its 🔄 line), and a delete
//     takes it off every restock;
//   a-restock-problem-is-a-system-tag (+ its 🔄 "A") — Terima puts *Barang kurang* on when it records missing units and
//     *Barang rusak* when it records broken ones; those two are the app's, locked for everyone, admins included;
//   the-restock-tags-prototype-is-accepted (+ its 🔄 lines) — the Tag column on both lists, the Tag box on both details,
//     tagging in EVERY status; the Tag filter takes several tags, a restock shown when it carries ANY of them, kept in the
//     address (`?tag=1,2`), and the seller's Statistik and Ekspor follow it.
//
// The ground, all the spec's own (root raises every restock through the API): a selling team S and its warehouse W, a
// second selling team O sending to its own warehouse X (the restock NO tag RPC of S or W may reach), Sela (S's
// SELLING_ADMIN) and Wira (W's WAREHOUSE_STAFF). Each test has its own restocks, so each runs alone. Every tag name
// carries SUFFIX — the list is app-wide, and a second run would otherwise answer the first run's tags.

const PASSWORD = "e2e-restock-tags-1";
const SELA = `e2etgsel${SUFFIX}`;
const WIRA = `e2etgwh${SUFFIX}`;
const SERVICE = "inventory.v1.RestockRequestService";
const SYSTEM = "RESTOCK_TAG_TYPE_SYSTEM";
const CUSTOM = "RESTOCK_TAG_TYPE_CUSTOM";

type Tag = { id: string; name: string; type: string; appTask?: string };
type Raised = { id: string; itemId: string };

const ground = {
  seller: "",
  warehouse: "",
  other: "",
  otherWarehouse: "",
  rack: "",
  account: "",
  otherAccount: "",
  product: { id: "", code: "" },
  otherProduct: { id: "", code: "" },
  // The app's two problem tags, seeded by inventory migration 00055.
  kurang: "",
  rusak: "",
  r: {} as Record<string, Raised>,
};

const resiOf = (key: string) => `E2E-TG-${key}-${SUFFIX}`;

// An RPC as the signed-in person — its status and its JSON body (an error's `code` included).
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// A refusal, by its Connect code.
async function refused(page: Page, method: string, body: unknown, code: string) {
  const res = await call(page, method, body);
  expect(res.status, `${method} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).not.toBe(200);
  expect(res.body.code, `${method} ${JSON.stringify(body)}`).toBe(code);
}

// The app-wide list's tags whose name contains `q` (any case), as `teamId`'s caller reads them.
async function tagsNamed(page: Page, teamId: string, q: string): Promise<Tag[]> {
  const res = await api(page, `${SERVICE}/RestockTagList`, { teamId, q, page: { page: 1, limit: 200 } });

  return (res.tags ?? []) as Tag[];
}

// The ONE tag carrying exactly this name.
async function tagCalled(page: Page, teamId: string, name: string): Promise<Tag> {
  const hits = (await tagsNamed(page, teamId, name)).filter((t) => t.name.toLowerCase() === name.toLowerCase());
  expect(hits, `tags named ${name}`).toHaveLength(1);

  return hits[0]!;
}

// A restock's tags as its own side reads them (Detail).
async function tagsOn(page: Page, teamId: string, requestId: string): Promise<Tag[]> {
  const res = await api(page, `${SERVICE}/RestockRequestDetail`, { teamId, requestId });

  return (res.request.tags ?? []) as Tag[];
}

const ids = (tags: Tag[]) => tags.map((t) => t.id).sort();

// `user` signed in on a page of its own, on `team`.
async function as(page: Page, user: string, password: string, team: string) {
  await login(page, user, password);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, password: string, team: string) {
  const page = await browser.newPage();
  await as(page, user, password, team);

  return page;
}

// A restock's own page, its Tag box drawn.
async function openDetail(page: Page, requestId: string) {
  await page.goto(`/inventories/restock/${requestId}`);
  const box = page.getByTestId("restock-tags-box");
  await expect(box).toBeVisible();

  return box;
}

// The seller's list, searched for one restock's resi — its row.
async function sellerRow(page: Page, key: string) {
  await page.goto(`/inventories/restock?q=${encodeURIComponent(resiOf(key))}`);
  await expect(page.getByTestId("restock-selling-page")).toBeVisible();
  const row = page.getByTestId(`restock-row-${ground.r[key]!.id}`);
  await expect(row).toBeVisible();

  return row;
}

// The warehouse's inbound list, every status, searched for the resi — its row.
async function inboundRow(page: Page, key: string) {
  await page.goto(`/inventories/restock?status=all&q=${encodeURIComponent(resiOf(key))}`);
  const row = page.getByTestId(`restock-row-${ground.r[key]!.id}`);
  await expect(row).toBeVisible();

  return row;
}

// Type into a restock page's add box (it opens on the click).
async function typeTag(page: Page, text: string) {
  const input = page.getByTestId("restock-tag-add-input");
  await input.click();
  await input.fill(text);
}

// Pick one tag in a list's Tag filter: the list opened, the name typed to narrow it, the option clicked.
async function pickTag(page: Page, tagId: string, name: string) {
  const input = page.getByTestId("restock-tag-filter-input");
  const option = page.getByTestId(`restock-tag-filter-option-${tagId}`);
  await input.click();
  await expect(option).toBeVisible();
  await input.fill(name);
  await option.click();
  await expect(page.getByTestId(`restock-tag-filter-pick-${tagId}`)).toBeVisible();
}

const tagParam = (page: Page) => new URL(page.url()).searchParams.get("tag");

/** Clicks Ekspor and reads the file it downloads. */
async function exportFile(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByTestId("restock-export").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^restok-.*\.xlsx$/);

  return readXlsx(await download.path());
}

test.describe("restock tags", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.seller = await team(`E2E Tag Seller ${SUFFIX}`, `TGS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Tag WH ${SUFFIX}`, `TGW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    ground.other = await team(`E2E Tag Other ${SUFFIX}`, `TGO${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.otherWarehouse = await team(`E2E Tag Other WH ${SUFFIX}`, `TGX${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    ground.rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: "e2e-tg", name: "E2E tag shelf" }))
        .rack.id,
    );

    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.seller,
      username: SELA,
      password: PASSWORD,
      name: `Sela Tag ${SUFFIX}`,
      role: "ROLE_SELLING_ADMIN",
    });
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: WIRA,
      password: PASSWORD,
      name: `Wira Tag ${SUFFIX}`,
      role: "ROLE_WAREHOUSE_STAFF",
    });

    const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Tag Cat ${SUFFIX}` })).category.id;
    const product = async (teamId: string, code: string) => ({
      id: String(
        (await api(page, "product.v1.ProductService/ProductCreate", { teamId, productCodePart: code, name: `E2E ${code}`, categoryId: category }))
          .product.id,
      ),
      code,
    });
    ground.product = await product(ground.seller, `TGP${SUFFIX}`);
    ground.otherProduct = await product(ground.other, `TGQ${SUFFIX}`);

    const account = async (teamId: string, n: string) => {
      const id = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E Tag BCA ${n} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `E2E-TG-${n}-${SUFFIX}`,
            openingBalance: 10_000_000,
            openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
          })
        ).account.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: id,
        operational: true,
      });

      return id;
    };
    ground.account = await account(ground.seller, "S");
    ground.otherAccount = await account(ground.other, "O");

    // A restock of 10 pcs for Rp 100.000 — S's to W, or O's to X.
    const raise = async (key: string, other = false) => {
      const p = other ? ground.otherProduct : ground.product;
      const res = await api(page, `${SERVICE}/RestockRequestCreate`, {
        teamId: other ? ground.other : ground.seller,
        warehouseId: other ? ground.otherWarehouse : ground.warehouse,
        financeAccountId: other ? ground.otherAccount : ground.account,
        receipt: resiOf(key),
        items: [{ productId: p.id, productCode: p.code, name: `E2E ${p.code}`, count: 10, total: 100_000 }],
      });
      ground.r[key] = { id: String(res.request.id), itemId: String(res.request.items[0].id) };
    };
    // W counts a restock in: `received` of the 10 in the box, `broken` of them broken; the good ones on the shelf.
    const accept = async (key: string, received: number, broken: number) => {
      await api(page, `${SERVICE}/RestockRequestAccept`, {
        teamId: ground.warehouse,
        requestId: ground.r[key]!.id,
        lines: [
          {
            itemId: ground.r[key]!.itemId,
            receivedCount: received,
            ...(broken > 0 ? { brokenCount: broken, brokenNote: "penyok" } : {}),
            ...(received < 10 ? { missingNote: "tidak ada di kardus" } : {}),
            placements: [{ placementId: ground.rack, quantity: received - broken }],
          },
        ],
      });
    };

    for (const key of ["detail", "twin", "wh", "lost", "sys", "plain", "prob", "terima", "whole", "f1", "f2", "f3", "f4"]) {
      await raise(key);
    }
    await raise("other", true);
    await accept("wh", 10, 0);
    await accept("prob", 7, 2);
    await api(page, `${SERVICE}/RestockRequestMarkLost`, {
      teamId: ground.seller,
      requestId: ground.r.lost!.id,
      description: "hilang di jalan",
    });

    // The Tag filter's ground: FA on f1, FB on f2, both on f3, none on f4.
    const fa = (await api(page, `${SERVICE}/RestockTagCreate`, { teamId: ground.seller, name: `E2E Filter A ${SUFFIX}` })).tag.id;
    const fb = (await api(page, `${SERVICE}/RestockTagCreate`, { teamId: ground.seller, name: `E2E Filter B ${SUFFIX}` })).tag.id;
    for (const [key, tagId] of [["f1", fa], ["f2", fb], ["f3", fa], ["f3", fb]] as const) {
      await api(page, `${SERVICE}/RestockRequestTagAdd`, { teamId: ground.seller, requestId: ground.r[key]!.id, tagId });
    }

    // The app's two problem tags, by their task.
    const problems = await tagsNamed(page, "1", "Barang");
    ground.kurang = problems.find((t) => t.appTask === "restock.problem.missing")?.id ?? "";
    ground.rusak = problems.find((t) => t.appTask === "restock.problem.broken")?.id ?? "";
    expect(ground.kurang && ground.rusak, JSON.stringify(problems)).toBeTruthy();

    await page.close();
  });

  test("a custom tag made on the seller's restock page goes on, shows on both lists, and comes off by its ×", async ({ page }) => {
    const name = `E2E Lebaran ${SUFFIX}`;
    const id = ground.r.detail!.id;

    await as(page, SELA, PASSWORD, ground.seller);
    const box = await openDetail(page, id);
    await expect(box.getByTestId("restock-tags")).toHaveCount(0);

    // Typed, it is a name nobody has: Buat tag — a custom one only, Sela is no admin.
    await typeTag(page, name);
    await expect(page.getByTestId("restock-tag-add-create-custom")).toBeVisible();
    await expect(page.getByTestId("restock-tag-add-create-system")).toHaveCount(0);
    await page.getByTestId("restock-tag-add-create-custom").click();
    await expect(box.getByTestId("restock-tags")).toContainText(name);

    const tag = await tagCalled(page, ground.seller, name);
    expect(tag.type).toBe(CUSTOM);
    const chip = box.getByTestId(`restock-tag-${tag.id}`);
    await expect(chip).toHaveText(name);
    await expect(chip).toHaveAttribute("data-tag-type", "custom");
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([tag.id]);

    // The seller's list row carries the chip in its Tag column…
    const row = await sellerRow(page, "detail");
    await expect(row.getByTestId(`restock-tags-cell-${id}`).getByTestId(`restock-tags-${id}-${tag.id}`)).toHaveText(name);

    // …and so does the warehouse's: a restock's tags are one set, seen from both sides.
    const wira = await pageAs(page.context().browser()!, WIRA, PASSWORD, ground.warehouse);
    const inbound = await inboundRow(wira, "detail");
    await expect(inbound.getByTestId(`restock-tags-${id}-${tag.id}`)).toHaveText(name);
    await wira.close();

    // Its × takes it off — the tag stays on the app-wide list.
    await openDetail(page, id);
    await box.getByTestId(`restock-tag-${tag.id}-remove`).click();
    await expect(box.getByTestId(`restock-tag-${tag.id}`)).toHaveCount(0);
    expect(await tagsOn(page, ground.seller, id)).toEqual([]);
    expect((await tagsNamed(page, ground.seller, name)).map((t) => t.id)).toEqual([tag.id]);
  });

  test("a name that exists, typed in another case, answers that tag — never a twin", async ({ page }) => {
    const name = `E2E Prioritas ${SUFFIX}`;
    const id = ground.r.twin!.id;

    await as(page, SELA, PASSWORD, ground.seller);
    const made = await api(page, `${SERVICE}/RestockTagCreate`, { teamId: ground.seller, name });
    expect(made.created).toBe(true);
    const tagId = String(made.tag.id);

    // Through the API, another case and loose spaces — from either side, since the list is app-wide.
    const again = await api(page, `${SERVICE}/RestockTagCreate`, { teamId: ground.seller, name: `  e2e   PRIORITAS ${SUFFIX} ` });
    expect(again.created ?? false).toBe(false);
    expect(String(again.tag.id)).toBe(tagId);
    expect(again.tag.name).toBe(name);
    const wira = await pageAs(page.context().browser()!, WIRA, PASSWORD, ground.warehouse);
    const fromWarehouse = await api(wira, `${SERVICE}/RestockTagCreate`, { teamId: ground.warehouse, name: name.toLowerCase() });
    expect(String(fromWarehouse.tag.id)).toBe(tagId);
    await wira.close();
    expect((await tagsNamed(page, ground.seller, `prioritas ${SUFFIX}`)).map((t) => t.id)).toEqual([tagId]);

    // On the screen: typed in lower case, the add box offers THAT tag and no Buat tag.
    const box = await openDetail(page, id);
    await typeTag(page, name.toLowerCase());
    await expect(page.getByTestId(`restock-tag-add-option-${tagId}`)).toBeVisible();
    await expect(page.getByTestId("restock-tag-add-create-custom")).toHaveCount(0);
    await page.getByTestId(`restock-tag-add-option-${tagId}`).click();
    await expect(box.getByTestId(`restock-tag-${tagId}`)).toHaveText(name);

    // Typed once more, it is said to be on already — still no Buat tag.
    await typeTag(page, name.toUpperCase());
    await expect(page.getByTestId(`restock-tag-add-on-${tagId}`)).toBeVisible();
    await expect(page.getByTestId("restock-tag-add-create-custom")).toHaveCount(0);
    await page.keyboard.press("Escape");

    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([tagId]);
    expect((await tagsNamed(page, ground.seller, `prioritas ${SUFFIX}`)).map((t) => t.id)).toEqual([tagId]);
  });

  test("the warehouse tags a restock sent to it, accepted or lost — every status", async ({ page }) => {
    const name = `E2E Rak Retur ${SUFFIX}`;
    const id = ground.r.wh!.id;

    // The warehouse's own restock page of an ACCEPTED restock: Wira makes the tag and puts it on.
    await as(page, WIRA, PASSWORD, ground.warehouse);
    const box = await openDetail(page, id);
    await expect(page.getByTestId("restock-detail-status").getByTestId("restock-status-2")).toBeVisible();
    await typeTag(page, name);
    await page.getByTestId("restock-tag-add-create-custom").click();
    await expect(box.getByTestId("restock-tags")).toContainText(name);
    const tag = await tagCalled(page, ground.warehouse, name);
    await expect(box.getByTestId(`restock-tag-${tag.id}`)).toHaveText(name);

    const inbound = await inboundRow(page, "wh");
    await expect(inbound.getByTestId(`restock-tags-${id}-${tag.id}`)).toHaveText(name);

    // The seller reads the same tag on its row, and may take it off — whoever put it on.
    const sela = await pageAs(page.context().browser()!, SELA, PASSWORD, ground.seller);
    const row = await sellerRow(sela, "wh");
    await expect(row.getByTestId(`restock-tags-${id}-${tag.id}`)).toHaveText(name);
    expect(ids(await tagsOn(sela, ground.seller, id))).toEqual([tag.id]);

    // A LOST restock is tagged too, from either side.
    const lost = ground.r.lost!.id;
    await api(sela, `${SERVICE}/RestockRequestTagAdd`, { teamId: ground.seller, requestId: lost, tagId: tag.id });
    expect(ids(await tagsOn(sela, ground.seller, lost))).toEqual([tag.id]);
    await api(page, `${SERVICE}/RestockRequestTagRemove`, { teamId: ground.warehouse, requestId: lost, tagId: tag.id });
    expect(await tagsOn(sela, ground.seller, lost)).toEqual([]);

    await api(sela, `${SERVICE}/RestockRequestTagRemove`, { teamId: ground.seller, requestId: id, tagId: tag.id });
    expect(await tagsOn(page, ground.warehouse, id)).toEqual([]);
    await sela.close();
  });

  test("another team's restock is NotFound to a tag put on or taken off, from either side", async ({ page }) => {
    const other = ground.r.other!.id;

    await as(page, SELA, PASSWORD, ground.seller);
    const tagId = String((await api(page, `${SERVICE}/RestockTagCreate`, { teamId: ground.seller, name: `E2E Asing ${SUFFIX}` })).tag.id);

    await refused(page, `${SERVICE}/RestockRequestTagAdd`, { teamId: ground.seller, requestId: other, tagId }, "not_found");
    await refused(page, `${SERVICE}/RestockRequestTagRemove`, { teamId: ground.seller, requestId: other, tagId }, "not_found");

    const wira = await pageAs(page.context().browser()!, WIRA, PASSWORD, ground.warehouse);
    await refused(wira, `${SERVICE}/RestockRequestTagAdd`, { teamId: ground.warehouse, requestId: other, tagId }, "not_found");
    await wira.close();

    // Nothing went on it: its own team reads none.
    const root = await pageAs(page.context().browser()!, ROOT_USERNAME, ROOT_PASSWORD, ground.other);
    expect(await tagsOn(root, ground.other, other)).toEqual([]);
    await root.close();
  });

  test("a system tag is the admins': refused to a team's user, made by root, and Kelola tag renames and deletes it", async ({ page }) => {
    const name = `E2E Diperiksa ${SUFFIX}`;
    const renamed = `E2E Diperiksa Admin ${SUFFIX}`;
    const id = ground.r.sys!.id;
    const browser = page.context().browser()!;

    // Sela may not make a system tag.
    const sela = await pageAs(browser, SELA, PASSWORD, ground.seller);
    await refused(sela, `${SERVICE}/RestockTagSystemCreate`, { name: `E2E Sela Sys ${SUFFIX}` }, "permission_denied");
    expect(await tagsNamed(sela, ground.seller, `E2E Sela Sys ${SUFFIX}`)).toEqual([]);

    // Root, on the seller's restock page: Buat tag sistem.
    await as(page, ROOT_USERNAME, ROOT_PASSWORD, ground.seller);
    const box = await openDetail(page, id);
    await typeTag(page, name);
    await expect(page.getByTestId("restock-tag-add-create-custom")).toBeVisible();
    await page.getByTestId("restock-tag-add-create-system").click();
    await expect(box.getByTestId("restock-tags")).toContainText(name);
    const tag = await tagCalled(page, ground.seller, name);
    expect(tag.type).toBe(SYSTEM);
    expect(tag.appTask ?? "").toBe("");
    const chip = box.getByTestId(`restock-tag-${tag.id}`);
    await expect(chip).toHaveText(name);
    await expect(chip).toHaveAttribute("data-tag-type", "system");
    await expect(chip.getByTestId(`restock-tag-${tag.id}-lock`)).toBeVisible();
    // An admin's own system tag keeps its × for an admin.
    await expect(chip.getByTestId(`restock-tag-${tag.id}-remove`)).toBeVisible();

    // A team's user: no put on, no take off, no rename, no delete — by any RPC.
    const ref = { teamId: ground.seller, requestId: id, tagId: tag.id };
    await refused(sela, `${SERVICE}/RestockRequestSystemTagAdd`, { ...ref, requestId: ground.r.plain!.id }, "permission_denied");
    await refused(sela, `${SERVICE}/RestockRequestTagAdd`, { ...ref, requestId: ground.r.plain!.id }, "permission_denied");
    await refused(sela, `${SERVICE}/RestockRequestSystemTagRemove`, ref, "permission_denied");
    await refused(sela, `${SERVICE}/RestockRequestTagRemove`, ref, "permission_denied");
    await refused(sela, `${SERVICE}/RestockTagRename`, { tagId: tag.id, name: `E2E Sela ${SUFFIX}` }, "permission_denied");
    await refused(sela, `${SERVICE}/RestockTagDelete`, { tagId: tag.id }, "permission_denied");
    expect(ids(await tagsOn(sela, ground.seller, id))).toEqual([tag.id]);
    expect(await tagsOn(sela, ground.seller, ground.r.plain!.id)).toEqual([]);

    // …and on its screen: the chip locked with no ×, a new name offers Buat tag only, no Kelola tag.
    const selaBox = await openDetail(sela, id);
    await expect(selaBox.getByTestId(`restock-tag-${tag.id}-lock`)).toBeVisible();
    await expect(selaBox.getByTestId(`restock-tag-${tag.id}-remove`)).toHaveCount(0);
    await typeTag(sela, `E2E Belum Ada ${SUFFIX}`);
    await expect(sela.getByTestId("restock-tag-add-create-custom")).toBeVisible();
    await expect(sela.getByTestId("restock-tag-add-create-system")).toHaveCount(0);
    await sela.keyboard.press("Escape");
    await expect(sela.getByTestId("restock-tag-manage")).toHaveCount(0);

    // Root's Kelola tag: a name another tag carries (any case) is refused; then the rename.
    await page.getByTestId("restock-tag-manage").click();
    const dialog = page.getByTestId("restock-tag-manage-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId(`restock-tag-manage-rename-${tag.id}`).click();
    await dialog.getByTestId("restock-tag-manage-name-input").fill("barang KURANG");
    await dialog.getByTestId("restock-tag-manage-save").click();
    await expect(dialog.getByTestId("restock-tag-manage-taken")).toBeVisible();
    await refused(page, `${SERVICE}/RestockTagRename`, { tagId: tag.id, name: "BARANG rusak" }, "already_exists");
    await dialog.getByTestId("restock-tag-manage-name-input").fill(renamed);
    await dialog.getByTestId("restock-tag-manage-save").click();
    await expect(dialog.getByTestId("restock-tag-manage-name-input")).toHaveCount(0);
    await expect(dialog.getByTestId(`restock-tag-manage-row-${tag.id}`)).toContainText(renamed);
    await expect(dialog.getByTestId(`restock-tag-manage-usage-${tag.id}`)).toHaveText("1 restock");

    // The delete asks first, naming how many restocks it comes off — then it is off this one, and off the list.
    await dialog.getByTestId(`restock-tag-manage-delete-${tag.id}`).click();
    await expect(page.getByRole("alertdialog")).toContainText("1 restock");
    await page.getByTestId("confirm-action").click();
    await expect(dialog.getByTestId(`restock-tag-manage-row-${tag.id}`)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(box.getByTestId(`restock-tag-${tag.id}`)).toHaveCount(0);
    expect(await tagsOn(page, ground.seller, id)).toEqual([]);
    expect(await tagsNamed(page, ground.seller, renamed)).toEqual([]);

    await openDetail(sela, id);
    await expect(sela.getByTestId(`restock-tag-${tag.id}`)).toHaveCount(0);
    await sela.close();
  });

  test("the app's two problem tags are locked even for root: never taken off, put on, renamed or deleted by hand", async ({ page }) => {
    const id = ground.r.prob!.id;

    await as(page, ROOT_USERNAME, ROOT_PASSWORD, ground.seller);
    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([ground.kurang, ground.rusak].sort());

    const ref = (tagId: string, requestId = id) => ({ teamId: ground.seller, requestId, tagId });
    await refused(page, `${SERVICE}/RestockRequestSystemTagRemove`, ref(ground.kurang), "failed_precondition");
    await refused(page, `${SERVICE}/RestockRequestSystemTagRemove`, ref(ground.rusak), "failed_precondition");
    await refused(page, `${SERVICE}/RestockRequestSystemTagAdd`, ref(ground.rusak, ground.r.plain!.id), "failed_precondition");
    // Through the team's RPCs a system tag is no custom one.
    await refused(page, `${SERVICE}/RestockRequestTagRemove`, ref(ground.kurang), "permission_denied");
    await refused(page, `${SERVICE}/RestockRequestTagAdd`, ref(ground.kurang, ground.r.plain!.id), "permission_denied");
    await refused(page, `${SERVICE}/RestockTagRename`, { tagId: ground.kurang, name: `Barang kurang ${SUFFIX}` }, "failed_precondition");
    await refused(page, `${SERVICE}/RestockTagDelete`, { tagId: ground.rusak }, "failed_precondition");

    expect(ids(await tagsOn(page, ground.seller, id))).toEqual([ground.kurang, ground.rusak].sort());
    expect(await tagsOn(page, ground.seller, ground.r.plain!.id)).toEqual([]);
    expect((await tagCalled(page, ground.seller, "Barang kurang")).id).toBe(ground.kurang);
    expect((await tagCalled(page, ground.seller, "Barang rusak")).id).toBe(ground.rusak);

    // On root's screen: both chips locked, no ×; Kelola tag lists them as the app's, with no rename and no delete.
    const box = await openDetail(page, id);
    for (const tagId of [ground.kurang, ground.rusak]) {
      await expect(box.getByTestId(`restock-tag-${tagId}-lock`)).toBeVisible();
      await expect(box.getByTestId(`restock-tag-${tagId}-remove`)).toHaveCount(0);
    }
    await page.getByTestId("restock-tag-manage").click();
    const dialog = page.getByTestId("restock-tag-manage-dialog");
    for (const tagId of [ground.kurang, ground.rusak]) {
      await expect(dialog.getByTestId(`restock-tag-manage-app-${tagId}`)).toBeVisible();
      await expect(dialog.getByTestId(`restock-tag-manage-rename-${tagId}`)).toHaveCount(0);
      await expect(dialog.getByTestId(`restock-tag-manage-delete-${tagId}`)).toHaveCount(0);
    }
  });

  test("Terima with missing and broken units puts Barang kurang and Barang rusak on; a whole count puts none", async ({ page }) => {
    const id = ground.r.terima!.id;
    const whole = ground.r.whole!.id;

    // WHEN — Wira counts 7 of the 10 in, 2 of them broken: 3 missing, 2 broken, 5 on the shelf; and the control whole.
    await as(page, WIRA, PASSWORD, ground.warehouse);
    await api(page, `${SERVICE}/RestockRequestAccept`, {
      teamId: ground.warehouse,
      requestId: id,
      lines: [
        {
          itemId: ground.r.terima!.itemId,
          receivedCount: 7,
          brokenCount: 2,
          brokenNote: "penyok",
          missingNote: "tidak ada di kardus",
          placements: [{ placementId: ground.rack, quantity: 5 }],
        },
      ],
    });
    await api(page, `${SERVICE}/RestockRequestAccept`, {
      teamId: ground.warehouse,
      requestId: whole,
      lines: [{ itemId: ground.r.whole!.itemId, receivedCount: 10, placements: [{ placementId: ground.rack, quantity: 10 }] }],
    });

    const tags = await tagsOn(page, ground.warehouse, id);
    expect(ids(tags)).toEqual([ground.kurang, ground.rusak].sort());
    expect(tags.every((t) => t.type === SYSTEM)).toBe(true);
    expect(await tagsOn(page, ground.warehouse, whole)).toEqual([]);

    // The warehouse's row: both chips, locked.
    const inbound = await inboundRow(page, "terima");
    await expect(inbound.getByTestId(`restock-tags-${id}-${ground.kurang}-lock`)).toBeVisible();
    await expect(inbound.getByTestId(`restock-tags-${id}-${ground.rusak}-lock`)).toBeVisible();

    // The seller's row: both chips, the system's first, locked. (Its counts beside the status are the test below.)
    const sela = await pageAs(page.context().browser()!, SELA, PASSWORD, ground.seller);
    const row = await sellerRow(sela, "terima");
    const chips = row.getByTestId(`restock-tags-${id}`).locator('[data-tag-type]');
    await expect(chips).toHaveText(["Barang kurang", "Barang rusak"]);
    await expect(row.getByTestId(`restock-tags-${id}-${ground.kurang}`)).toHaveAttribute("data-tag-type", "system");
    await expect(row.getByTestId(`restock-tags-${id}-${ground.rusak}-lock`)).toBeVisible();

    // The control: accepted, no problem — no chip, the Tag cell still drawn.
    const control = await sellerRow(sela, "whole");
    await expect(control.getByTestId(`restock-tags-cell-${whole}`)).toBeAttached();
    await expect(control.getByTestId(`restock-tags-${whole}`)).toHaveCount(0);
    await sela.close();
  });

  // the-restock-tags-prototype-is-accepted draws *kurang N · rusak N* on accepted rows of BOTH lists
  // (a-restock-problem-is-a-system-tag: the problem list is the restock "listed with missing and broken count"):
  // RestockRequestList fills each line's missing and broken counts with one grouped read per page (backlog #89), and the
  // seller's and the warehouse's row draw them as `restock-missing-<id>` / `restock-broken-<id>`.
  test("an accepted problem row reads its missing and broken counts on both lists", async ({ page }) => {
    const id = ground.r.prob!.id;

    await as(page, SELA, PASSWORD, ground.seller);
    const row = await sellerRow(page, "prob");
    await expect.soft(row.getByTestId(`restock-missing-${id}`)).toHaveText("3 missing", { timeout: 5_000 });
    await expect.soft(row.getByTestId(`restock-broken-${id}`)).toHaveText("2 broken", { timeout: 5_000 });

    const wira = await pageAs(page.context().browser()!, WIRA, PASSWORD, ground.warehouse);
    const inbound = await inboundRow(wira, "prob");
    await expect.soft(inbound.getByTestId(`restock-missing-${id}`)).toHaveText("3 missing", { timeout: 5_000 });
    await expect.soft(inbound.getByTestId(`restock-broken-${id}`)).toHaveText("2 broken", { timeout: 5_000 });
    await wira.close();
  });

  test("the Tag filter takes two tags: the list, Statistik and Ekspor hold the restocks carrying ANY of them, kept as ?tag=", async ({
    page,
  }) => {
    const nameA = `E2E Filter A ${SUFFIX}`;
    const nameB = `E2E Filter B ${SUFFIX}`;
    const [f1, f2, f3, f4] = ["f1", "f2", "f3", "f4"].map((k) => ground.r[k]!.id);

    await as(page, SELA, PASSWORD, ground.seller);
    const fa = (await tagCalled(page, ground.seller, nameA)).id;
    const fb = (await tagCalled(page, ground.seller, nameB)).id;

    await page.goto("/inventories/restock");
    await expect(page.getByTestId(`restock-row-${f4}`)).toBeVisible();

    await pickTag(page, fa, nameA);
    await pickTag(page, fb, nameB);
    await page.keyboard.press("Escape");

    // Kept in the address, in the order picked.
    await expect.poll(() => tagParam(page)).toBe(`${fa},${fb}`);
    const rows = page.locator('[data-testid^="restock-row-"]');
    await expect(rows).toHaveCount(3);
    for (const id of [f1, f2, f3]) await expect(page.getByTestId(`restock-row-${id}`)).toBeVisible();
    await expect(page.getByTestId(`restock-row-${f4}`)).toHaveCount(0);
    await expect(page.getByTestId(`restock-tags-${f3}`).locator("[data-tag-type]")).toHaveText([nameA, nameB]);

    // Statistik reads the same filter: three transactions.
    const statRead = page.waitForRequest((r) => r.url().includes("RestockRequestService/RestockSellingStat"));
    await page.getByTestId("restock-summary-toggle").click();
    const sent = JSON.parse((await statRead).postData() ?? "{}") as { filter?: { tagIds?: string[] } };
    expect([...(sent.filter?.tagIds ?? [])].sort()).toEqual([fa, fb].sort());
    await expect(page.getByTestId("restock-summary-total-value")).toHaveText("3 transactions");
    await expect(page.getByTestId("restock-summary-pile-ongoing-value")).toHaveText("3 transactions");

    // Ekspor writes the same three, newest first, each with its tags in the Tag column after Status.
    const file = (await exportFile(page)).get("Restok")!;
    const header = file[0]!;
    const tagCol = header.indexOf("Tag");
    expect(tagCol).toBe(header.indexOf("Status") + 1);
    expect(file.slice(1).map((r) => r[1])).toEqual([resiOf("f3"), resiOf("f2"), resiOf("f1")]);
    expect(file.slice(1).map((r) => r[tagCol])).toEqual([`${nameA}, ${nameB}`, nameB, nameA]);

    // The address alone brings the filter back.
    await page.reload();
    await expect(page.getByTestId(`restock-tag-filter-pick-${fa}`)).toBeVisible();
    await expect(page.getByTestId(`restock-tag-filter-pick-${fb}`)).toBeVisible();
    await expect(rows).toHaveCount(3);

    // The list's RPC narrows by the same predicate: FA alone is f1 and f3.
    const byA = await api(page, `${SERVICE}/RestockRequestList`, {
      teamId: ground.seller,
      filter: { tagIds: [fa] },
      dataRequest: ["RESTOCK_REQUEST_LIST_DATA_TYPE_GENERAL"],
      page: { page: 1, limit: 10 },
    });
    expect(Number(byA.pageInfo?.totalItems ?? 0)).toBe(2);

    // Past three picks the field says +N.
    await page.goto(`/inventories/restock?tag=${ground.kurang},${ground.rusak},${fa},${fb}`);
    await expect(page.getByTestId("restock-tag-filter-more")).toHaveText("+1");

    // × takes every pick back: the whole list again, f4 in it with its Tag cell drawn empty.
    await page.goto(`/inventories/restock?tag=${fa},${fb}`);
    await expect(rows).toHaveCount(3);
    await page.getByTestId("restock-tag-filter-clear").click();
    await expect.poll(() => tagParam(page) ?? "").toBe("");
    await expect(page.getByTestId(`restock-row-${f4}`)).toBeVisible();
    await expect(page.getByTestId(`restock-tags-cell-${f4}`)).toBeAttached();
    await expect(page.getByTestId(`restock-tags-${f4}`)).toHaveCount(0);
  });
});

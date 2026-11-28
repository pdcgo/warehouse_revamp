import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";

// PRODUCT TAGS ON SCREEN — end to end, on the real server and Postgres (backlog #148 on the #147 backend), plus a
// regression of #149 (a team code change tags the held products `need_reprint_code`). A REGRESSION spec: no acceptance
// row is marked from it (docs/acceptances/teams/team_code.md waits for #150), so its checks are plain tests and steps.
// The rules (docs/business/product/context_decision.md):
//
//   products-have-their-own-tag-list — products keep a tag list of their OWN, one list for every team, a name unique in
//     it (any case, spaces folded: `product_tags_name_key` on lower(name)); a tag is SYSTEM or CUSTOM; a custom tag is
//     made, put on and taken off by anyone who may WRITE on the product (ProductUpdate's roles: the selling owner and
//     admin, root, the administrator — so a selling CS reads only); system tags, rename and delete are root's and the
//     administrator's; the Products list filters by tag; the app's own `need_reprint_code` is put on by the team code
//     change, locked for everyone, admins included;
//   its 🔄 *who sees* — the owning team AND every warehouse holding the product's stock see its tags;
//   the-team-code-and-product-tags-prototype-is-accepted — the product page's Tag card (`need_reprint_code` first,
//     locked, no ×; custom tags with ×; *Add a tag…* for the writers; *Manage tags* for root / the administrator, where
//     the app tag reads *Put on by the app* with neither rename nor delete); the warehouse product page's read-only chips
//     under the code; both Products lists' Tag column right after the product (two chips + `+N`) and Tag filter (several
//     tags, ANY of them, `?tag=` in the address, cleared by Clear Filters, in the Filter sheet on a phone);
//   a-team-code-change-recomposes-its-product-codes — `<old>-<part>` becomes `<new>-<part>` on every product of the
//     team; `need_reprint_code` only on the products some warehouse holds on a shelf (#149's ✅ line); a code once held
//     stays taken.
//
// The ground, all the spec's own (root seeds through the API): a selling team S (owner, admin, CS), a warehouse W (staff)
// holding four of S's products on its rack, and a selling team T (owner) whose code changes in beforeAll — two of its
// products on W's rack, a third on no shelf. Every tag name carries SUFFIX: the products' tag list is app-wide.

const PASSWORD = "e2e-product-tags-1";
const OWNER = `e2eptown${SUFFIX}`;
const ADMIN = `e2eptadm${SUFFIX}`;
const CS = `e2eptcs${SUFFIX}`;
const STAFF = `e2eptstf${SUFFIX}`;
const T_OWNER = `e2epttow${SUFFIX}`;

const RPC = "product.v1.ProductService";
const SYSTEM = "PRODUCT_TAG_TYPE_SYSTEM";
const CUSTOM = "PRODUCT_TAG_TYPE_CUSTOM";
const APP_TAG = "need_reprint_code";
const APP_TASK = "product.code.reprint";

// Team codes: at most 10 characters, and apart from every other SUFFIX importer's (`UG…` is free).
const S_CODE = `UGS${SUFFIX}`;
const W_CODE = `UGW${SUFFIX}`;
const T_OLD = `UGT${SUFFIX}`;
const T_NEW = `UGN${SUFFIX}`;

// S's products: one per writer test, the CS's, root's, and the list's four (W holds the list's four).
const S_KEYS = ["own", "adm", "cs", "sys", "l3", "la", "lb", "ln"] as const;
const S_HELD = ["l3", "la", "lb", "ln"] as const;
// T's: t1 and t2 on W's rack, t3 on no shelf.
const T_KEYS = ["t1", "t2", "t3"] as const;

const SHARED_HINT = "The owning team and every warehouse holding its stock see the same tags.";
const LOCKED_HINT = "A system tag (with a lock) is put on by the app or an admin; you cannot change it.";
const ADMIN_HINT = "As an admin you may also make a system tag, put one on or take it off, and rename or delete any tag but the app's.";

type Tag = { id: string; name: string; type?: string; appTask?: string; productCount?: string };
type Product = { id: string; productCode: string; tags?: Tag[] };

const tagName = (word: string) => `E2E PT ${word} ${SUFFIX}`;
const NAMES = {
  a: tagName("Alpha"),
  b: tagName("Beta"),
  c: tagName("Charlie"),
  d: tagName("Delta"),
  ada: tagName("Ada Sudah"),
  read: tagName("Dibaca"),
  rename: tagName("Ganti"),
  taken: tagName("Dipakai"),
  // Sorts before `need_reprint_code` by name — the card still draws the app tag first (the system's first).
  early: tagName("Aaa Awal"),
};

const ground = {
  seller: "",
  warehouse: "",
  recode: "",
  p: {} as Record<string, Product>,
  tag: {} as Record<keyof typeof NAMES, string>,
  app: "",
  codeUpdate: {} as Record<string, unknown>,
};

// An RPC as the signed-in person — its status and its JSON body (an error's `code` included), never thrown.
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
  expect(res.body.code, `${method} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(code);
}

// The products' list's tags whose name contains `q`, as `teamId`'s caller reads them.
async function tagsNamed(page: Page, teamId: string, q: string): Promise<Tag[]> {
  const res = await api(page, `${RPC}/ProductTagList`, { teamId, q, page: { page: 1, limit: 200 } });

  return (res.tags ?? []) as Tag[];
}

// The ONE tag carrying exactly this name (any case).
async function tagCalled(page: Page, teamId: string, name: string): Promise<Tag> {
  const hits = (await tagsNamed(page, teamId, name)).filter((t) => t.name.toLowerCase() === name.toLowerCase());
  expect(hits, `product tags named ${name}`).toHaveLength(1);

  return hits[0]!;
}

// A product as its own team reads it (ProductDetail).
async function detail(page: Page, teamId: string, productId: string): Promise<Product> {
  return (await api(page, `${RPC}/ProductDetail`, { teamId, productId })).product as Product;
}

const tagsOn = async (page: Page, teamId: string, productId: string) => (await detail(page, teamId, productId)).tags ?? [];
const ids = (tags: Tag[]) => tags.map((t) => t.id).sort();

// `user` signed in, working in `team` (the active team is per tab, in sessionStorage).
async function as(page: Page, user: string, password: string, team: string) {
  await login(page, user, password);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
}

async function pageAs(browser: Browser, user: string, password: string, team: string) {
  const page = await browser.newPage();
  await as(page, user, password, team);

  return page;
}

// The seller's product page — its Tag card drawn.
async function tagCard(page: Page, productId: string) {
  await page.goto(`/products/${productId}`);
  await expect(page.getByTestId("product-detail-page")).toBeVisible();
  const card = page.getByTestId("pd-section-tags");
  await expect(card.getByTestId("product-tags-box")).toBeVisible();

  return card;
}

// Type into the card's add box (it opens on the click).
async function typeTag(card: Locator, text: string) {
  const input = card.getByTestId("product-tag-add-input");
  await input.click();
  await input.fill(text);
}

// The card's chips' tag ids, in the order drawn.
async function chipOrder(card: Locator) {
  const testIds = await card
    .getByTestId("product-tags")
    .locator("[data-tag-type]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));

  return testIds.map((t) => t.replace(/^product-tag-/, ""));
}

// Pick one tag in a list's Tag filter (inside `scope`): the list opened, the name typed to narrow it, the option clicked.
async function pickTag(scope: Page | Locator, tagId: string, name: string) {
  const input = scope.getByTestId("product-tag-filter-input");
  const option = scope.getByTestId(`product-tag-filter-option-${tagId}`);
  // The filter's list lands once (ProductTagList) and the field remounts with it — opened before, it closes again.
  await expect(async () => {
    await input.click();
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await input.fill(name);
  await option.click();
  await expect(scope.getByTestId(`product-tag-filter-pick-${tagId}`)).toBeVisible();
}

const tagParam = (page: Page) => (new URL(page.url()).searchParams.get("tag") ?? "").split(",").filter(Boolean).sort();

// The seller's wide list's product rows (⚠ `product-row-tags-…` sits under the `product-row-` prefix too).
const sellerRows = (page: Page) => page.getByTestId("products-table").locator('tbody tr[data-testid^="product-row-"]');
// The warehouse's wide list's rows.
const stockRows = (page: Page) => page.getByTestId("inventory-table").locator('tbody tr[data-testid^="stock-row-"]');

// A table's header cells, trimmed, with each one's test id.
async function headers(page: Page, table: string) {
  return page
    .getByTestId(table)
    .locator("thead th")
    .evaluateAll((els) => els.map((el) => ({ text: (el.textContent ?? "").trim(), testId: el.getAttribute("data-testid") ?? "" })));
}

test.describe("product tags", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.seller = await team(`E2E ProdTag Seller ${SUFFIX}`, S_CODE, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E ProdTag WH ${SUFFIX}`, W_CODE, "TEAM_TYPE_WAREHOUSE");
    ground.recode = await team(`E2E ProdTag Recode ${SUFFIX}`, T_OLD, "TEAM_TYPE_SELLING");

    for (const [teamId, username, name, role] of [
      [ground.seller, OWNER, `Owner ProdTag ${SUFFIX}`, "ROLE_SELLING_OWNER"],
      [ground.seller, ADMIN, `Admin ProdTag ${SUFFIX}`, "ROLE_SELLING_ADMIN"],
      [ground.seller, CS, `CS ProdTag ${SUFFIX}`, "ROLE_SELLING_CS"],
      [ground.warehouse, STAFF, `Staff ProdTag ${SUFFIX}`, "ROLE_WAREHOUSE_STAFF"],
      [ground.recode, T_OWNER, `Recode Owner ProdTag ${SUFFIX}`, "ROLE_SELLING_OWNER"],
    ] as const) {
      await api(page, "user.v1.UserService/CreateUser", { teamId, username, password: PASSWORD, name, role });
    }

    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `pt-${SUFFIX}`, name: "E2E product tags" }))
        .rack.id,
    );
    const category = (await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E ProdTag Cat ${SUFFIX}` })).category.id;

    const product = async (teamId: string, key: string) => {
      const made = await api(page, `${RPC}/ProductCreate`, {
        teamId,
        productCodePart: `${key.toUpperCase()}${SUFFIX}`,
        name: `E2E PT ${key} ${SUFFIX}`,
        categoryId: category,
      });
      ground.p[key] = { id: String(made.product.id), productCode: made.product.productCode as string };
    };
    for (const key of S_KEYS) await product(ground.seller, key);
    for (const key of T_KEYS) await product(ground.recode, key);

    // A team's products onto W's rack: one restock, accepted whole onto the rack — W then holds them on a shelf.
    const hold = async (teamId: string, keys: readonly string[], tag: string) => {
      const account = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E ProdTag BCA ${tag} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `E2E-PTG-${tag}-${SUFFIX}`,
            openingBalance: 0,
            openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
          })
        ).account.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId, accountId: account, operational: true });
      const restock = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId,
        warehouseId: ground.warehouse,
        financeAccountId: account,
        items: keys.map((key) => ({
          productId: ground.p[key]!.id,
          productCode: ground.p[key]!.productCode,
          name: `E2E PT ${key} ${SUFFIX}`,
          count: 5,
          total: 50_000,
        })),
      });
      const items = restock.request.items as { id: string; productId: string }[];
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: restock.request.id,
        lines: items.map((item) => ({ itemId: item.id, receivedCount: 5, placements: [{ placementId: rack, quantity: 5 }] })),
      });
    };
    await hold(ground.seller, S_HELD, "S");
    await hold(ground.recode, ["t1", "t2"], "T");

    // The tags, all custom, made by root in the owning team; put on where the tests read them.
    const make = async (teamId: string, name: string) => String((await api(page, `${RPC}/ProductTagCreate`, { teamId, name })).tag.id);
    for (const key of Object.keys(NAMES) as (keyof typeof NAMES)[]) {
      ground.tag[key] = await make(key === "early" ? ground.recode : ground.seller, NAMES[key]);
    }
    const on = async (teamId: string, key: string, tag: keyof typeof NAMES) =>
      api(page, `${RPC}/ProductTagAdd`, { teamId, productId: ground.p[key]!.id, tagId: ground.tag[tag] });
    for (const [key, tag] of [
      ["l3", "a"],
      ["l3", "c"],
      ["l3", "d"],
      ["la", "a"],
      ["lb", "b"],
      ["cs", "read"],
      ["sys", "rename"],
    ] as const) {
      await on(ground.seller, key, tag);
    }
    await on(ground.recode, "t1", "early");

    // The app's own tag — found by its name in the products' list (seeded locked, with its task).
    const app = (await tagsNamed(page, ground.seller, APP_TAG)).filter((t) => t.name === APP_TAG);
    expect(app, `the ${APP_TAG} tag`).toHaveLength(1);
    expect(app[0]!.type).toBe(SYSTEM);
    expect(app[0]!.appTask).toBe(APP_TASK);
    ground.app = String(app[0]!.id);

    // #149 — T's selling owner changes the team's code (TeamCodeUpdate): its products recompose, the held ones tagged.
    const owner = await pageAs(browser, T_OWNER, PASSWORD, ground.recode);
    ground.codeUpdate = await api(owner, "team.v1.TeamService/TeamCodeUpdate", { teamId: ground.recode, teamCode: T_NEW });
    await owner.close();

    await page.close();
  });

  // A writer's flow on its product page: a new tag made in the add box, its × takes it off, typed again in another case
  // the add box offers THAT tag (no twin), and an existing tag is picked from the list.
  async function writerTags(page: Page, user: string, key: string, word: string) {
    const fresh = tagName(`Kemasan ${word}`);
    const id = ground.p[key]!.id;

    await as(page, user, PASSWORD, ground.seller);
    const card = await tagCard(page, id);

    await test.step("regression: the card starts empty — the add box, the shared hint, no Manage tags", async () => {
      await expect(card.getByTestId("product-tags")).toHaveCount(0);
      await expect(card.getByTestId("product-tag-add-input")).toBeVisible();
      await expect(card.getByTestId("product-tags-hint")).toHaveText(SHARED_HINT);
      await expect(page.getByTestId("product-tag-manage")).toHaveCount(0);
    });

    const tag = await test.step("regression: a name nobody has offers Create tag (custom only); picked, the chip carries its ×", async () => {
      await typeTag(card, fresh);
      await expect(page.getByTestId("product-tag-add-create-custom")).toBeVisible();
      await expect(page.getByTestId("product-tag-add-create-system")).toHaveCount(0);
      await page.getByTestId("product-tag-add-create-custom").click();
      await expect(card.getByTestId("product-tags")).toContainText(fresh);

      const made = await tagCalled(page, ground.seller, fresh);
      expect(made.type).toBe(CUSTOM);
      const chip = card.getByTestId(`product-tag-${made.id}`);
      await expect(chip).toHaveText(fresh);
      await expect(chip).toHaveAttribute("data-tag-type", "custom");
      await expect(chip.getByTestId(`product-tag-${made.id}-remove`)).toBeVisible();
      await expect(chip.getByTestId(`product-tag-${made.id}-lock`)).toHaveCount(0);
      expect(ids(await tagsOn(page, ground.seller, id))).toEqual([made.id]);

      return made;
    });

    await test.step("regression: its × takes it off the product — the tag stays on the products' list", async () => {
      await card.getByTestId(`product-tag-${tag.id}-remove`).click();
      await expect(card.getByTestId(`product-tag-${tag.id}`)).toHaveCount(0);
      expect(await tagsOn(page, ground.seller, id)).toEqual([]);
      expect((await tagsNamed(page, ground.seller, fresh)).map((t) => t.id)).toEqual([tag.id]);
    });

    await test.step("regression: typed again in upper case with loose spaces, the add box offers THAT tag and no Create", async () => {
      await typeTag(card, `  ${fresh.toUpperCase().replace(/ /g, "  ")} `);
      await expect(page.getByTestId(`product-tag-add-option-${tag.id}`)).toBeVisible();
      await expect(page.getByTestId("product-tag-add-create-custom")).toHaveCount(0);
      await page.getByTestId(`product-tag-add-option-${tag.id}`).click();
      await expect(card.getByTestId(`product-tag-${tag.id}`)).toHaveText(fresh);
    });

    await test.step("regression: an existing tag, found by a part of its name, is put on from the list", async () => {
      await typeTag(card, `Ada Sudah ${SUFFIX}`);
      await page.getByTestId(`product-tag-add-option-${ground.tag.ada}`).click();
      await expect(card.getByTestId(`product-tag-${ground.tag.ada}`)).toHaveText(NAMES.ada);
      await expect(card.getByTestId(`product-tag-${ground.tag.ada}-remove`)).toBeVisible();
      expect(ids(await tagsOn(page, ground.seller, id))).toEqual([tag.id, ground.tag.ada].sort());
      expect((await tagsNamed(page, ground.seller, fresh)).map((t) => t.id)).toEqual([tag.id]);
    });
  }

  test("a selling owner tags its product on the product page: a new tag made, taken off by ×, put back from the list", async ({ page }) => {
    await writerTags(page, OWNER, "own", "Owner");
  });

  test("a selling admin tags its product on the product page: a new tag made, taken off by ×, put back from the list", async ({ page }) => {
    await writerTags(page, ADMIN, "adm", "Admin");
  });

  test("a selling CS reads the product's tags read-only — no add box, no ×, no Manage tags — and every write is refused", async ({ page }) => {
    const id = ground.p.cs!.id;
    await as(page, CS, PASSWORD, ground.seller);

    await test.step("regression: the card draws the chip, with no × and no add box", async () => {
      const card = await tagCard(page, id);
      const chip = card.getByTestId(`product-tag-${ground.tag.read}`);
      await expect(chip).toHaveText(NAMES.read);
      await expect(chip.getByTestId(`product-tag-${ground.tag.read}-remove`)).toHaveCount(0);
      await expect(card.getByTestId("product-tag-add")).toHaveCount(0);
      await expect(card.getByTestId("product-tag-add-input")).toHaveCount(0);
      await expect(page.getByTestId("product-tag-manage")).toHaveCount(0);
      await expect(card.getByTestId("product-tags-hint")).toHaveText(SHARED_HINT);
    });

    await test.step("regression: the API refuses the CS every tag write", async () => {
      const body = { teamId: ground.seller, productId: id };
      await refused(page, `${RPC}/ProductTagAdd`, { ...body, tagId: ground.tag.ada }, "permission_denied");
      await refused(page, `${RPC}/ProductTagRemove`, { ...body, tagId: ground.tag.read }, "permission_denied");
      await refused(page, `${RPC}/ProductTagCreate`, { teamId: ground.seller, name: tagName("CS Baru") }, "permission_denied");
      expect(ids(await tagsOn(page, ground.seller, id))).toEqual([ground.tag.read]);
      expect(await tagsNamed(page, ground.seller, `CS Baru ${SUFFIX}`)).toEqual([]);
    });
  });

  test("need_reprint_code is first and locked on the product page — no × for the owner nor for root, never put on or taken off by hand", async ({
    page,
  }) => {
    const [t1, t3] = [ground.p.t1!.id, ground.p.t3!.id];
    const app = ground.app;

    await test.step("regression: the selling owner sees it first (before a custom tag named earlier), locked, with no ×", async () => {
      await as(page, T_OWNER, PASSWORD, ground.recode);
      const card = await tagCard(page, t1);
      await expect(card.getByTestId(`product-tag-${app}`)).toHaveText(APP_TAG);
      expect(await chipOrder(card)).toEqual([app, ground.tag.early]);
      const chip = card.getByTestId(`product-tag-${app}`);
      await expect(chip).toHaveAttribute("data-tag-type", "system");
      await expect(chip.getByTestId(`product-tag-${app}-lock`)).toBeVisible();
      await expect(chip.getByTestId(`product-tag-${app}-remove`)).toHaveCount(0);
      await expect(card.getByTestId(`product-tag-${ground.tag.early}-remove`)).toBeVisible();
      await expect(card.getByTestId("product-tags-hint")).toHaveText(`${SHARED_HINT} ${LOCKED_HINT}`);

      // Typed, it is said to be on already — no Create.
      await typeTag(card, APP_TAG);
      await expect(page.getByTestId(`product-tag-add-on-${app}`)).toBeVisible();
      await expect(page.getByTestId("product-tag-add-create-custom")).toHaveCount(0);
      await page.keyboard.press("Escape");

      // The owner's own RPC cannot take it off either.
      const off = await call(page, `${RPC}/ProductTagRemove`, { teamId: ground.recode, productId: t1, tagId: app });
      expect(off.status, JSON.stringify(off.body)).not.toBe(200);
    });

    const root = await pageAs(page.context().browser()!, ROOT_USERNAME, ROOT_PASSWORD, ground.recode);

    await test.step("regression: root (an admin) sees it first and locked too — still no ×", async () => {
      const card = await tagCard(root, t1);
      expect(await chipOrder(card)).toEqual([app, ground.tag.early]);
      await expect(card.getByTestId(`product-tag-${app}-lock`)).toBeVisible();
      await expect(card.getByTestId(`product-tag-${app}-remove`)).toHaveCount(0);
      await expect(card.getByTestId(`product-tag-${ground.tag.early}-remove`)).toBeVisible();
    });

    await test.step("regression: on a product without it, root finds it only greyed — Put on by the app — and no Create", async () => {
      const card = await tagCard(root, t3);
      await expect(card.getByTestId(`product-tag-${app}`)).toHaveCount(0);
      await typeTag(card, APP_TAG);
      const option = root.getByTestId(`product-tag-add-option-${app}`);
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute("data-disabled", /.*/);
      await expect(option).toContainText("Put on by the app");
      await expect(root.getByTestId("product-tag-add-create-custom")).toHaveCount(0);
      await expect(root.getByTestId("product-tag-add-create-system")).toHaveCount(0);
      await root.keyboard.press("Escape");
    });

    await test.step("regression: root's RPCs cannot take it off, put it on, rename or delete it (FailedPrecondition)", async () => {
      await refused(root, `${RPC}/ProductSystemTagRemove`, { teamId: ground.recode, productId: t1, tagId: app }, "failed_precondition");
      await refused(root, `${RPC}/ProductSystemTagAdd`, { teamId: ground.recode, productId: t3, tagId: app }, "failed_precondition");
      await refused(root, `${RPC}/ProductTagRename`, { tagId: app, name: tagName("Reprint Renamed") }, "failed_precondition");
      await refused(root, `${RPC}/ProductTagDelete`, { tagId: app }, "failed_precondition");
      expect(ids(await tagsOn(root, ground.recode, t1))).toContain(app);
      expect(ids(await tagsOn(root, ground.recode, t3))).not.toContain(app);
      expect((await tagCalled(root, ground.recode, APP_TAG)).id).toBe(app);
    });

    await root.close();
  });

  test("root puts a system tag on and manages the products' tags: the app tag cannot be renamed or deleted, a taken name is refused, a delete takes it off", async ({
    page,
  }) => {
    const sysName = tagName("Audit Sistem");
    const renamed = tagName("Diperiksa");
    const id = ground.p.sys!.id;
    const { rename, taken } = ground.tag;

    await as(page, ROOT_USERNAME, ROOT_PASSWORD, ground.seller);
    const card = await tagCard(page, id);

    const sys = await test.step("regression: root's add box offers both creates; Create system tag puts on a locked chip root may still take off", async () => {
      await expect(card.getByTestId("product-tags-hint")).toHaveText(ADMIN_HINT);
      await expect(card.getByTestId(`product-tag-${rename}-remove`)).toBeVisible();
      await typeTag(card, sysName);
      await expect(page.getByTestId("product-tag-add-create-custom")).toBeVisible();
      await page.getByTestId("product-tag-add-create-system").click();
      await expect(card.getByTestId("product-tags")).toContainText(sysName);

      const made = await tagCalled(page, ground.seller, sysName);
      expect(made.type).toBe(SYSTEM);
      const chip = card.getByTestId(`product-tag-${made.id}`);
      await expect(chip).toHaveAttribute("data-tag-type", "system");
      await expect(chip.getByTestId(`product-tag-${made.id}-lock`)).toBeVisible();
      await expect(chip.getByTestId(`product-tag-${made.id}-remove`)).toBeVisible();
      // The system's first.
      expect(await chipOrder(card)).toEqual([made.id, rename]);
      expect(ids(await tagsOn(page, ground.seller, id))).toEqual([made.id, rename].sort());

      return made;
    });

    await page.getByTestId("product-tag-manage").click();
    const dialog = page.getByTestId("product-tag-manage-dialog");
    await expect(dialog).toBeVisible();

    await test.step("regression: Manage tags lists the app tag as Put on by the app, with neither rename nor delete", async () => {
      await expect(dialog.getByTestId(`product-tag-manage-app-${ground.app}`)).toHaveText("Put on by the app");
      await expect(dialog.getByTestId(`product-tag-manage-rename-${ground.app}`)).toHaveCount(0);
      await expect(dialog.getByTestId(`product-tag-manage-delete-${ground.app}`)).toHaveCount(0);
      await expect(dialog.getByTestId(`product-tag-manage-usage-${sys.id}`)).toHaveText("1 product");
    });

    await test.step("regression: a rename onto a name another tag carries (another case) is refused in place", async () => {
      await dialog.getByTestId(`product-tag-manage-rename-${rename}`).click();
      await dialog.getByTestId("product-tag-manage-name-input").fill(NAMES.taken.toUpperCase());
      await dialog.getByTestId("product-tag-manage-save").click();
      await expect(dialog.getByTestId("product-tag-manage-taken")).toBeVisible();
      await refused(page, `${RPC}/ProductTagRename`, { tagId: rename, name: NAMES.taken.toLowerCase() }, "already_exists");
      expect((await tagCalled(page, ground.seller, NAMES.rename)).id).toBe(rename);
      expect((await tagCalled(page, ground.seller, NAMES.taken)).id).toBe(taken);
    });

    await test.step("regression: a free name renames it — on the list and on the product", async () => {
      await dialog.getByTestId("product-tag-manage-name-input").fill(renamed);
      await dialog.getByTestId("product-tag-manage-save").click();
      await expect(dialog.getByTestId("product-tag-manage-name-input")).toHaveCount(0);
      await expect(dialog.getByTestId(`product-tag-manage-row-${rename}`)).toContainText(renamed);
      expect((await tagCalled(page, ground.seller, renamed)).id).toBe(rename);
      expect(await tagsNamed(page, ground.seller, `Ganti ${SUFFIX}`)).toEqual([]);
    });

    await test.step("regression: the delete asks first, counting its product — then the tag is off the product and off the list", async () => {
      await dialog.getByTestId(`product-tag-manage-delete-${sys.id}`).click();
      await expect(page.getByRole("alertdialog")).toContainText("1 product");
      await page.getByTestId("confirm-action").click();
      await expect(dialog.getByTestId(`product-tag-manage-row-${sys.id}`)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await expect(card.getByTestId(`product-tag-${sys.id}`)).toHaveCount(0);
      await expect(card.getByTestId(`product-tag-${rename}`)).toHaveText(renamed);
      expect(ids(await tagsOn(page, ground.seller, id))).toEqual([rename]);
      expect(await tagsNamed(page, ground.seller, sysName)).toEqual([]);
    });
  });

  test("the seller's Products list: a Tag column right after the product, two chips + N, and a Tag filter of ANY picked tag kept as ?tag=", async ({
    page,
  }) => {
    const { a, b, c, d } = ground.tag;
    const code = (key: string) => ground.p[key]!.productCode;

    await as(page, OWNER, PASSWORD, ground.seller);
    await page.goto("/products");
    const rows = sellerRows(page);
    await expect(rows).toHaveCount(S_KEYS.length, { timeout: 15_000 });

    await test.step("regression: the Tag column is the second, right after Product", async () => {
      const head = await headers(page, "products-table");
      expect(head[0]!.text, JSON.stringify(head)).toMatch(/^Product/);
      expect(head[1]!.testId, JSON.stringify(head)).toBe("products-tag-header");
      expect(head[1]!.text).toBe("Tags");
    });

    await test.step("regression: a product with three tags shows two chips and +1, whose hover names the third", async () => {
      const cell = page.getByTestId(`product-tags-cell-${code("l3")}`);
      await expect(cell.getByTestId(`product-row-tags-${code("l3")}-${a}`)).toHaveText(NAMES.a);
      await expect(cell.getByTestId(`product-row-tags-${code("l3")}-${c}`)).toHaveText(NAMES.c);
      await expect(cell.getByTestId(`product-row-tags-${code("l3")}-${d}`)).toHaveCount(0);
      const more = cell.getByTestId(`product-row-tags-${code("l3")}-more`);
      await expect(more).toHaveText("+1");
      await expect(more).toHaveAttribute("title", NAMES.d);
      // A row's chips are read-only.
      await expect(page.getByTestId("products-table").locator('[data-testid$="-remove"]')).toHaveCount(0);
      // A product with none draws its cell empty.
      await expect(page.getByTestId(`product-tags-cell-${code("ln")}`)).toBeAttached();
      await expect(page.getByTestId(`product-row-tags-${code("ln")}`)).toHaveCount(0);
    });

    await test.step("regression: two tags picked — the rows carrying ANY of them, kept in the address", async () => {
      const filter = page.getByTestId("product-tag-filter");
      await expect(filter.getByTestId("product-tag-filter-select")).toBeVisible();
      await pickTag(filter, a, NAMES.a);
      await pickTag(filter, b, NAMES.b);
      await page.keyboard.press("Escape");

      await expect.poll(() => tagParam(page)).toEqual([a, b].sort());
      await expect(rows).toHaveCount(3);
      for (const key of ["l3", "la", "lb"]) await expect(page.getByTestId(`product-row-${code(key)}`)).toBeVisible();
      await expect(page.getByTestId(`product-row-${code("ln")}`)).toHaveCount(0);
    });

    await test.step("regression: the address alone brings the filter back", async () => {
      await page.reload();
      await expect(page.getByTestId(`product-tag-filter-pick-${a}`)).toBeVisible();
      await expect(page.getByTestId(`product-tag-filter-pick-${b}`)).toBeVisible();
      await expect(rows).toHaveCount(3);
    });

    await test.step("regression: Clear Filters empties it — every product again", async () => {
      await page.getByTestId("products-filter-clear").click();
      await expect.poll(() => tagParam(page)).toEqual([]);
      await expect(page.getByTestId("product-tag-filter-pick-" + a)).toHaveCount(0);
      await expect(rows).toHaveCount(S_KEYS.length);
      await expect(page.getByTestId(`product-row-${code("ln")}`)).toBeVisible();
    });
  });

  test("on a 390 px phone the seller's product block carries its chips, and the Tag filter is in the Filter sheet", async ({ page }) => {
    const { a, b } = ground.tag;
    const code = (key: string) => ground.p[key]!.productCode;

    // Sign in on the desktop shell (login waits for its current-user), then turn the page into a phone.
    await as(page, OWNER, PASSWORD, ground.seller);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/products");
    const blocks = page.getByTestId("products-table").locator(':scope > [data-testid^="product-row-"]');
    await expect(blocks).toHaveCount(S_KEYS.length, { timeout: 15_000 });
    await expect(page.locator("table")).toHaveCount(0);

    await test.step("regression: the block's line of chips — two and +1", async () => {
      const block = page.getByTestId(`product-row-${code("l3")}`);
      await expect(block.getByTestId(`product-row-tags-${code("l3")}-${a}`)).toHaveText(NAMES.a);
      await expect(block.getByTestId(`product-row-tags-${code("l3")}-more`)).toHaveText("+1");
      await expect(page.getByTestId(`product-row-tags-${code("ln")}`)).toHaveCount(0);
    });

    await test.step("regression: the Filter sheet holds the Tag filter; a pick narrows the blocks", async () => {
      await page.getByTestId("products-filter-open").click();
      const sheet = page.getByTestId("products-filter-sheet");
      await expect(sheet.getByTestId("product-tag-filter")).toBeVisible();
      await pickTag(sheet, b, NAMES.b);
      await page.getByTestId("products-filter-done").click();
      await expect.poll(() => tagParam(page)).toEqual([b]);
      await expect(blocks).toHaveCount(1);
      await expect(page.getByTestId(`product-row-${code("lb")}`)).toBeVisible();
    });
  });

  test("a warehouse holding the products sees their tags read-only — its Products list's Tag column and filter, and its product page's chips", async ({
    page,
  }) => {
    const { a, b, c, d } = ground.tag;
    const code = (key: string) => ground.p[key]!.productCode;
    const held = S_HELD.length + 2;

    await as(page, STAFF, PASSWORD, ground.warehouse);
    await page.goto("/products");
    await expect(page.getByTestId("warehouse-products-page")).toBeVisible();
    const rows = stockRows(page);
    await expect(rows).toHaveCount(held, { timeout: 15_000 });

    await test.step("regression: the Tag column right after the product, two chips + 1, nothing to take off", async () => {
      const head = await headers(page, "inventory-table");
      const at = head.findIndex((h) => h.testId === "inventory-tag-header");
      expect(head[at - 1]?.text, JSON.stringify(head)).toBe("Product");
      const cell = page.getByTestId(`stock-tags-cell-${code("l3")}`);
      await expect(cell.getByTestId(`stock-tags-${code("l3")}-${a}`)).toHaveText(NAMES.a);
      await expect(cell.getByTestId(`stock-tags-${code("l3")}-${c}`)).toHaveText(NAMES.c);
      await expect(cell.getByTestId(`stock-tags-${code("l3")}-more`)).toHaveText("+1");
      await expect(page.getByTestId(`stock-tags-${code("lb")}-${b}`)).toHaveText(NAMES.b);
      await expect(page.getByTestId(`stock-tags-${code("ln")}`)).toHaveCount(0);
      await expect(page.getByTestId("inventory-table").locator('[data-testid$="-remove"]')).toHaveCount(0);
    });

    await test.step("regression: the Tag filter narrows to the tagged product, kept as ?tag=, and Clear Filters empties it", async () => {
      await pickTag(page.getByTestId("inventory-tag-filter"), b, NAMES.b);
      await page.keyboard.press("Escape");
      await expect.poll(() => tagParam(page)).toEqual([b]);
      await expect(rows).toHaveCount(1);
      await expect(page.getByTestId(`stock-row-${code("lb")}`)).toBeVisible();

      await page.getByTestId("inventory-filter-clear").click();
      await expect.poll(() => tagParam(page)).toEqual([]);
      await expect(rows).toHaveCount(held);
    });

    await test.step("regression: its product page shows every tag as a read-only chip under the code", async () => {
      await page.goto(`/inventories/products/${ground.p.l3!.id}`);
      await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
      const chips = page.getByTestId("wp-tags");
      for (const [tag, name] of [
        [a, NAMES.a],
        [c, NAMES.c],
        [d, NAMES.d],
      ] as const) {
        await expect(chips.getByTestId(`wp-tags-${tag}`)).toHaveText(name);
      }
      await expect(chips.getByTestId(`wp-tags-more`)).toHaveCount(0);
      await expect(chips.locator('[data-testid$="-remove"]')).toHaveCount(0);
      await expect(page.getByTestId("product-tag-add-input")).toHaveCount(0);
    });

    await test.step("regression: ProductTagsByIds answers the products it holds and leaves the others out; it cannot tag", async () => {
      const res = await api(page, `${RPC}/ProductTagsByIds`, {
        teamId: ground.warehouse,
        productIds: [ground.p.l3!.id, ground.p.la!.id, ground.p.own!.id],
      });
      const items = res.items as Record<string, { tags?: Tag[] }>;
      expect(ids(items[ground.p.l3!.id]?.tags ?? [])).toEqual([a, c, d].sort());
      expect(ids(items[ground.p.la!.id]?.tags ?? [])).toEqual([a]);
      expect(Object.keys(items)).not.toContain(ground.p.own!.id);
      await refused(page, `${RPC}/ProductTagAdd`, { teamId: ground.warehouse, productId: ground.p.ln!.id, tagId: a }, "permission_denied");
    });

    await test.step("regression: root's Inventory reuses the warehouse's list — its chips and its Tag filter from the address", async () => {
      const root = await pageAs(page.context().browser()!, ROOT_USERNAME, ROOT_PASSWORD, "1");
      await root.goto(`/inventory?warehouse=${ground.warehouse}&tag=${a}`);
      await expect(root.getByTestId("inventory-page")).toBeVisible();
      await expect(stockRows(root)).toHaveCount(2, { timeout: 15_000 });
      await expect(root.getByTestId(`stock-tags-${code("l3")}-${a}`)).toHaveText(NAMES.a);
      await expect(root.getByTestId(`stock-tags-${code("la")}-${a}`)).toHaveText(NAMES.a);
      await expect(root.getByTestId("inventory-tag-filter").getByTestId(`product-tag-filter-pick-${a}`)).toBeVisible();
      await root.close();
    });
  });

  test("regression #149: the selling owner's team code change recomposes every product code and tags need_reprint_code only on the two a warehouse holds", async ({
    page,
  }) => {
    const app = ground.app;
    const res = ground.codeUpdate as {
      changed?: boolean;
      team?: { teamCode?: string };
      productsRecomposed?: number;
      productsTagged?: number;
    };
    const part = (key: string) => ground.p[key]!.productCode.slice(`${T_OLD}-`.length);
    const newCode = (key: string) => `${T_NEW}-${part(key)}`;

    await test.step("regression: TeamCodeUpdate answered the change — 3 products recomposed, 2 tagged", async () => {
      for (const key of T_KEYS) expect(ground.p[key]!.productCode.startsWith(`${T_OLD}-`), ground.p[key]!.productCode).toBe(true);
      expect(res.changed, JSON.stringify(res)).toBe(true);
      expect(res.team?.teamCode).toBe(T_NEW);
      expect(res.productsRecomposed).toBe(3);
      expect(res.productsTagged).toBe(2);
    });

    await as(page, T_OWNER, PASSWORD, ground.recode);

    await test.step("regression: ProductDetail — each code under the new team code; the 2 held carry need_reprint_code, the third does not", async () => {
      for (const key of T_KEYS) {
        const product = await detail(page, ground.recode, ground.p[key]!.id);
        expect(product.productCode).toBe(newCode(key));
        const tagIds = ids(product.tags ?? []);
        if (key === "t3") expect(tagIds).not.toContain(app);
        else expect(tagIds).toContain(app);
      }
    });

    await test.step("regression: the seller's list — the new codes, the held two's locked chip, the third without", async () => {
      await page.goto("/products");
      const rows = sellerRows(page);
      await expect(rows).toHaveCount(T_KEYS.length, { timeout: 15_000 });
      for (const key of T_KEYS) await expect(page.getByTestId(`product-row-${newCode(key)}`)).toBeVisible();
      for (const key of ["t1", "t2"]) {
        const chip = page.getByTestId(`product-row-tags-${newCode(key)}-${app}`);
        await expect(chip).toHaveText(APP_TAG);
        await expect(chip.getByTestId(`product-row-tags-${newCode(key)}-${app}-lock`)).toBeVisible();
      }
      await expect(page.getByTestId(`product-row-tags-${newCode("t3")}`)).toHaveCount(0);
    });

    await test.step("regression: filtered by need_reprint_code, the list shows exactly the two held", async () => {
      await pickTag(page.getByTestId("product-tag-filter"), app, APP_TAG);
      await page.keyboard.press("Escape");
      await expect.poll(() => tagParam(page)).toEqual([app]);
      const rows = sellerRows(page);
      await expect(rows).toHaveCount(2);
      await expect(page.getByTestId(`product-row-${newCode("t1")}`)).toBeVisible();
      await expect(page.getByTestId(`product-row-${newCode("t2")}`)).toBeVisible();
      await expect(page.getByTestId(`product-row-${newCode("t3")}`)).toHaveCount(0);
    });

    await test.step("regression: the product page of the one on no shelf shows its new code and no need_reprint_code", async () => {
      const card = await tagCard(page, ground.p.t3!.id);
      await expect(page.getByTestId("product-detail-page")).toContainText(newCode("t3"));
      await expect(card.getByTestId(`product-tag-${app}`)).toHaveCount(0);
    });

    await test.step("regression: the holding warehouse's product page and list show the need_reprint_code chip, locked", async () => {
      const staff = await pageAs(page.context().browser()!, STAFF, PASSWORD, ground.warehouse);
      await staff.goto(`/inventories/products/${ground.p.t1!.id}`);
      await expect(staff.getByTestId("warehouse-product-page")).toContainText(newCode("t1"));
      await expect(staff.getByTestId(`wp-tags-${app}`)).toHaveText(APP_TAG);
      await expect(staff.getByTestId(`wp-tags-${app}-lock`)).toBeVisible();

      await staff.goto(`/products?tag=${app}`);
      const rows = stockRows(staff);
      await expect(rows).toHaveCount(2, { timeout: 15_000 });
      for (const key of ["t1", "t2"]) await expect(staff.getByTestId(`stock-tags-${newCode(key)}-${app}`)).toHaveText(APP_TAG);
      await staff.close();
    });

    await test.step("regression: the old team code stays taken — a new team cannot have it", async () => {
      const root = await pageAs(page.context().browser()!, ROOT_USERNAME, ROOT_PASSWORD, "1");
      await refused(
        root,
        "team.v1.TeamService/TeamCreate",
        { name: `E2E ProdTag Old Code ${SUFFIX}`, teamCode: T_OLD, type: "TEAM_TYPE_SELLING", ownerUserId: ROOT_USER_ID },
        "already_exists",
      );
      await root.close();
    });
  });
});

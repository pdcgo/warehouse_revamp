import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE KATEGORI PAGE'S PRODUK COLUMN IS COUNTED (backlog #115) — the-product-count-is-a-marked-sample (✅ built
// 2026-11-21, docs/technical/frontend/categories_decision.md): ProductService.ProductCategoryCounts answers, per category,
// every team's LIVE (unarchived) products filed directly on it; a product has exactly one category
// (a-product-has-one-category, docs/business/product/context_decision.md), so moving it re-files it — it leaves the old
// node and lands on the new one, never counted on both. The sample figures and their ⚠ marks are gone.
//
// A tree of the test's own: P (top level) with two LEAVES, L1 and L2, and products of TWO selling teams on them —
//
//   L1   X1, X2 (team X) · Y1 (team Y) · XA (team X, ARCHIVED)   → 3: every team counts, the archived one does not
//   L2   Y2 (team Y)                                             → 1
//   P    nothing filed on it directly                            → not listed in the answer
//
// ⚠ HELD — the owner's Q3 (a BRANCH reads its own products or its whole subtree; `productCountShown`, built as option A).
// So no BRANCH's shown figure is pinned here: P's cell is never read. Only LEAVES are, where own = whole subtree and both
// options agree — and never a leaf at 0, which option A draws "0" and option B "—". The server's answer is pinned in full
// (it counts only what is filed on each node, whatever Q3 decides).
//
// The tree ARRIVES SHUT (the-category-tree-arrives-shut), so P's leaves are hidden until a click opens it
// (a-branch-slides-open-and-shut: a click opens or shuts one branch).
//
// ⚠ The suite shares ONE database: other specs file products on categories of their own, so only THIS test's
// categories' cells and answer rows are read.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-catcount-pass-1";
const OWNER = `e2ecatown${SUFFIX}`;

const COUNTS = "/warehouse.product.v1.ProductService/ProductCategoryCounts";

const ground = {
  teamX: "",
  teamY: "",
  parent: "",
  leaf1: "",
  leaf2: "",
  // X2 — moved from L1 to L2 in the second test.
  movedProduct: "",
  // XA — archived on L1 at the start, unarchived in the second test.
  archivedProduct: "",
};

// The real contract under the signed-in token — a refusal comes back as its status and body, never thrown.
async function call(page: Page, method: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    [method, body, API_URL] as const,
  );
}

// The same, for a seed: anything but 200 fails here, by name.
async function api<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.body)}`);

  return res.body as T;
}

type CountsAnswer = { counts?: { categoryId?: string; products?: string }[] };

// What the answer says of one category — proto3 JSON drops a zero, and a category holding none is not listed at all.
function countOf(answer: CountsAnswer, categoryId: string): number | undefined {
  const row = (answer.counts ?? []).find((c) => String(c.categoryId ?? "0") === categoryId);

  return row === undefined ? undefined : Number(row.products ?? 0);
}

// Opens /categories and hands back the ProductCategoryCounts answer the page itself read.
async function openCategories(page: Page): Promise<CountsAnswer> {
  const answered = page.waitForResponse((r) => r.url().endsWith(COUNTS));
  await page.goto("/categories");
  const res = await answered;
  expect(res.status(), `ProductCategoryCounts answered ${res.status()}`).toBe(200);
  await expect(page.getByTestId("categories-tree")).toBeVisible();

  return (await res.json()) as CountsAnswer;
}

// Opens P with a click on its row (the name — the row's actions are their own clicks) and waits for its leaves.
async function openParent(page: Page) {
  await page.getByTestId(`category-name-${ground.parent}`).click();
  await expect(page.getByTestId(`category-row-${ground.leaf1}`)).toBeVisible();
  await expect(page.getByTestId(`category-row-${ground.leaf2}`)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string) =>
    String(
      (await api<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
        name,
        teamCode,
        type: "TEAM_TYPE_SELLING",
        ownerUserId: ROOT_USER_ID,
      })).team.id,
    );
  ground.teamX = await team(`E2E CatCount Seller X ${SUFFIX}`, `KCX${SUFFIX}`);
  ground.teamY = await team(`E2E CatCount Seller Y ${SUFFIX}`, `KCY${SUFFIX}`);

  // A selling team's OWNER of its own (team X) — the count is Root / the Administrator's alone.
  await api(page, "user.v1.UserService/CreateUser", {
    teamId: ground.teamX,
    username: OWNER,
    password: PASSWORD,
    name: `E2E CatCount Owner ${SUFFIX}`,
    role: "ROLE_SELLING_OWNER",
  });

  const category = async (name: string, parentId: string) =>
    String(
      (await api<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", { name, parentId })).category.id,
    );
  ground.parent = await category(`E2E CatCount Induk ${SUFFIX}`, "0");
  ground.leaf1 = await category(`E2E CatCount Daun Satu ${SUFFIX}`, ground.parent);
  ground.leaf2 = await category(`E2E CatCount Daun Dua ${SUFFIX}`, ground.parent);

  const product = async (teamId: string, part: string, categoryId: string) =>
    String(
      (await api<{ product: { id: string } }>(page, "product.v1.ProductService/ProductCreate", {
        teamId,
        productCodePart: part,
        name: `E2E CatCount ${part}`,
        categoryId,
      })).product.id,
    );
  await product(ground.teamX, `CCA${SUFFIX}`, ground.leaf1);
  ground.movedProduct = await product(ground.teamX, `CCB${SUFFIX}`, ground.leaf1);
  await product(ground.teamY, `CCC${SUFFIX}`, ground.leaf1);
  ground.archivedProduct = await product(ground.teamX, `CCD${SUFFIX}`, ground.leaf1);
  await product(ground.teamY, `CCE${SUFFIX}`, ground.leaf2);

  // Out of the list and every picker — so out of the count (the build's reading of "live").
  await api(page, "product.v1.ProductService/ProductArchive", { teamId: ground.teamX, productId: ground.archivedProduct });

  await page.close();
});

test("Category counts: a leaf reads every team's live products filed on it — 3 and 1, the archived one left out", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  const answer = await openCategories(page);

  await test.step("regression: the ProductCategoryCounts answer counts what is filed on each node — L1 3 (two teams, the archived one out), L2 1, P none", async () => {
    // the-product-count-is-a-marked-sample + a-product-has-one-category: a count of products by their one category_id.
    expect(countOf(answer, ground.leaf1), "L1: X1, X2 and Y1 — every team's, XA archived").toBe(3);
    expect(countOf(answer, ground.leaf2), "L2: Y2").toBe(1);
    // Nothing is filed on P itself, and a category holding none is not listed — its branch figure is the page's to make.
    expect(countOf(answer, ground.parent), "P holds no product of its own").toBeUndefined();
  });

  await test.step("regression: the tree arrives shut — P's row shows, its leaves do not until it is opened", async () => {
    // the-category-tree-arrives-shut: the top level only; one button, Expand All while any branch is shut.
    await expect(page.getByTestId(`category-row-${ground.parent}`)).toBeVisible();
    await expect(page.getByTestId(`category-row-${ground.leaf1}`)).toBeHidden();
    await expect(page.getByTestId(`category-row-${ground.leaf2}`)).toBeHidden();
    await expect(page.getByTestId("categories-toggle-all")).toHaveText(/Expand All/);
    // P has two sub-categories (the Sub-kategori column — its Produk cell is Q3's, never read here).
    await expect(page.getByTestId(`category-children-${ground.parent}`)).toHaveText("2");
  });

  await test.step("regression: a click opens P, and each leaf reads its own count — L1 3, L2 1", async () => {
    // a-branch-slides-open-and-shut: a click opens one branch. A leaf's own products are its whole subtree, so options
    // A and B of the held Q3 agree on it.
    await openParent(page);
    await expect(page.getByTestId(`category-products-loading-${ground.leaf1}`)).toHaveCount(0);
    await expect(page.getByTestId(`category-products-${ground.leaf1}`)).toHaveText("3");
    await expect(page.getByTestId(`category-products-${ground.leaf2}`)).toHaveText("1");
    await expect(page.getByTestId(`category-children-${ground.leaf1}`)).toHaveText("—");
  });

  await test.step("regression: the figures are counted, not a marked sample — no ⚠ mark, no summary strip, no count error", async () => {
    await expect(page.getByTestId("categories-heading")).toContainText("Products");
    await expect(page.getByTestId("not-implemented-summary")).toHaveCount(0);
    await expect(page.getByTestId("not-implemented-productCount")).toHaveCount(0);
    await expect(page.locator('[data-testid^="not-implemented-"]')).toHaveCount(0);
    await expect(page.getByTestId("categories-products-error")).toHaveCount(0);
  });

  await test.step("regression: a second click shuts P — its leaves are hidden again", async () => {
    await page.getByTestId(`category-name-${ground.parent}`).click();
    await expect(page.getByTestId(`category-row-${ground.leaf1}`)).toBeHidden();
    await expect(page.getByTestId(`category-row-${ground.leaf2}`)).toBeHidden();
  });
});

test("Category counts: a product moved to another leaf leaves the first, and an unarchived one counts again", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  await test.step("regression: X2 moved from L1 to L2 is counted once, on L2 — L1 2, L2 2", async () => {
    // a-product-has-one-category: its one category_id moves; it is never on both.
    await api(page, "product.v1.ProductService/ProductUpdate", {
      teamId: ground.teamX,
      productId: ground.movedProduct,
      categoryId: ground.leaf2,
    });

    const answer = await openCategories(page);
    expect(countOf(answer, ground.leaf1)).toBe(2);
    expect(countOf(answer, ground.leaf2)).toBe(2);
    expect(countOf(answer, ground.parent)).toBeUndefined();

    await openParent(page);
    await expect(page.getByTestId(`category-products-${ground.leaf1}`)).toHaveText("2");
    await expect(page.getByTestId(`category-products-${ground.leaf2}`)).toHaveText("2");
  });

  await test.step("regression: XA unarchived is live again and counts on L1 — L1 3", async () => {
    await api(page, "product.v1.ProductService/ProductUnarchive", { teamId: ground.teamX, productId: ground.archivedProduct });

    const answer = await openCategories(page);
    expect(countOf(answer, ground.leaf1)).toBe(3);
    expect(countOf(answer, ground.leaf2)).toBe(2);

    await openParent(page);
    await expect(page.getByTestId(`category-products-${ground.leaf1}`)).toHaveText("3");
    await expect(page.getByTestId(`category-products-${ground.leaf2}`)).toHaveText("2");
  });
});

test("Category counts: a selling team's owner is refused the count — Root and the Administrator only", async ({ page }) => {
  await signIn(page, OWNER, PASSWORD);

  await test.step("regression: ProductCategoryCounts as a selling owner answers permission_denied", async () => {
    // The proto's policy: ROLE_ROOT and ROLE_ADMINISTRATOR, unscoped — the count is every team's.
    const refused = await call(page, "product.v1.ProductService/ProductCategoryCounts", {});
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.code).toBe("permission_denied");
    expect(refused.body.counts).toBeUndefined();
  });

  await test.step("regression: /categories opened by hand shows them no figure — the count's refusal, a dash on the leaf", async () => {
    // The nav offers the page to Root / the Administrator only; the tree is any signed-in person's read, the count is not.
    const answered = page.waitForResponse((r) => r.url().endsWith(COUNTS));
    await page.goto("/categories");
    expect((await answered).status()).toBe(403);
    await expect(page.getByTestId("categories-tree")).toBeVisible();
    await expect(page.getByTestId("categories-products-error")).toBeVisible();

    await openParent(page);
    await expect(page.getByTestId(`category-products-${ground.leaf1}`)).toHaveText("—");
    await expect(page.getByTestId(`category-products-${ground.leaf2}`)).toHaveText("—");
  });
});

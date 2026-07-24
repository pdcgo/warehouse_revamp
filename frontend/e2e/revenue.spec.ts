import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #78 — the revenue reporting screen: what a team's orders were EXPECTED to make.
//
// Revenue records are seeded through the API rather than by placing orders, and that is not a shortcut
// around the UI: NOTHING WRITES THEM IN PRODUCTION YET. Recording revenue at order time is the pending
// event wiring (the owner chose "publish an event, revenue consumes it"), so the only honest way to
// test the screen today is to put rows in front of it directly. When the wiring lands, this seed is
// what it will replace.
//
// The figures are chosen so a page-derived total would be visibly wrong — see the totals test.

const SUFFIX = Date.now().toString().slice(-6);

// Root's own team. Root holds ROLE_ROOT in team 1, which bypasses scope, so it may both write and read
// these rows — and the screen reads whatever team is currently selected, which for root is team 1.
const ROOT_TEAM = "1";

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

// Seeds revenue rows: two with a known cost, one WITHOUT — the case the screen has to flag — repeated
// until `count` rows exist, so a caller can seed more than one page's worth.
async function seedRevenue(page: Page, base: number, count = 3) {
  return page.evaluate(
    async ([teamId, baseOrder, howMany]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const call = async (method: string, body: unknown) => {
        const res = await fetch(`http://localhost:8081/warehouse.${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
        return res.json();
      };

      const rows = [
        { revenue: "10000", cogs: "4000", shippingCost: "1000", costKnown: true },
        { revenue: "20000", cogs: "9000", shippingCost: "2000", costKnown: true },
        // The untrusted one: no recorded cost, so its margin reads as if the goods were free.
        { revenue: "30000", cogs: "0", shippingCost: "3000", costKnown: false },
      ];

      const orderIds: string[] = [];

      for (let i = 0; i < Number(howMany); i++) {
        const orderId = String(Number(baseOrder) + i);
        await call("revenue.v1.RevenueService/RevenueRecord", {
          teamId,
          orderId,
          // Cycles through the three shapes, so any seed of 3+ includes an unknown-cost row.
          ...rows[i % rows.length],
        });
        orderIds.push(orderId);
      }

      return orderIds;
    },
    [ROOT_TEAM, String(base), String(count)] as const,
  );
}

test("Revenue: the screen is reachable and says these are EXPECTED figures", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/revenue");

  // The banner is not decoration. An unlabelled money screen is read as cash in the bank, and none of
  // this has been reconciled against a real payout (§2.3).
  await expect(page.getByTestId("revenue-expected-notice")).toBeVisible();
  await expect(page.getByTestId("revenue-expected-notice")).toContainText("EXPECTED");
});

test("Revenue: rows show per-order money, and an unknown cost is flagged (#78)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const base = 900000 + Number(SUFFIX.slice(-3));
  const orderIds = await seedRevenue(page, base);

  await page.goto("/revenue");

  const table = page.getByTestId("revenue-table");
  await expect(table).toBeVisible();

  // The known-cost row reads plainly.
  await expect(page.getByTestId(`revenue-row-${orderIds[0]}`)).toBeVisible();

  // THE ROW THAT MATTERS: cost unknown. 0 would be a lie a reader cannot see, so the cell says so in
  // words, and the margin beside it carries a warning rather than being hidden.
  await expect(page.getByTestId(`revenue-cogs-unknown-${orderIds[2]}`)).toBeVisible();
  await expect(page.getByTestId(`revenue-margin-untrusted-${orderIds[2]}`)).toBeVisible();

  // ...while a row whose cost IS known carries no such warning.
  await expect(page.getByTestId(`revenue-margin-untrusted-${orderIds[0]}`)).toBeHidden();
});

test("Revenue: the totals cover every order, not the page in front of you (#78)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Enough rows that a page of 10 CANNOT hold them all. This is the whole point of the test: with only
  // a handful of rows both page sizes show everything, and a page-derived total would pass while being
  // exactly the bug the test is named after.
  await seedRevenue(page, 950000 + Number(SUFFIX.slice(-3)), 12);

  await page.goto("/revenue");

  await expect(page.getByTestId("revenue-totals")).toBeVisible();

  // The count of untrusted orders is what lets a reader judge the headline margin — without it the
  // total silently includes money that was never really earned.
  await expect(page.getByTestId("revenue-unknown-cost-warning")).toBeVisible();

  const rows = page.getByTestId("revenue-table").locator("tbody tr");

  // A SMALL page: truncated, and demonstrably so.
  await page.getByTestId("page-size").click();
  await page.getByRole("option", { name: "10", exact: true }).click();
  await expect(rows).toHaveCount(10);

  const totalOnSmallPage = await page.getByTestId("revenue-total-revenue").innerText();
  const marginOnSmallPage = await page.getByTestId("revenue-total-margin").innerText();

  // A LARGER page: strictly more rows visible...
  await page.getByTestId("page-size").click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(rows).not.toHaveCount(10);

  // ...and the headline figures did not move. They are computed over the whole team in the database, so
  // what you can see on screen has no bearing on them.
  await expect(page.getByTestId("revenue-total-revenue")).toHaveText(totalOnSmallPage);
  await expect(page.getByTestId("revenue-total-margin")).toHaveText(marginOnSmallPage);
});

// #171 — the revenue screen is scoped to a MONTH, and the totals follow it.
//
// Until this, RevenueList had no period filter at all: its totals were all-time. A profit screen built
// on that would have subtracted one month of costs from every order ever placed.
test("Revenue: another month shows none of this month's revenue (#171)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await seedRevenue(page, 970000 + Number(SUFFIX.slice(-3)), 3);

  await page.goto("/revenue");

  // The screen opens on THIS month, where the seeded rows live.
  const total = page.getByTestId("revenue-total-revenue");
  await expect(total).not.toHaveText("Rp 0");

  // A month with nothing in it reads zero — which is what makes the filter real rather than decorative.
  await page.getByTestId("revenue-month").fill("2020-01");
  await expect(total).toHaveText("Rp 0");
});

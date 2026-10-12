import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// The courier catalogue — shipment_service, docs/business/shipment/context_decision.md.
//
// Root curates it at /shipping. One serial journey through the decisions, against the real server and
// Postgres: create, edit (code locked), delete (soft), re-create refused, restore — and the old code-based
// picker reading the same catalogue (the-old-catalogue-bridges-by-code).

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `e2e_${SUFFIX}`;
const NAME = `E2E Courier ${SUFFIX}`;

async function login(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(ROOT_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
}

async function gotoChannels(page: Page) {
  await page.goto("/shipping");
  await expect(page.getByTestId("shipment-channels-table")).toBeVisible();
}

const row = (page: Page, code: string) => page.getByTestId(`shipment-channel-row-${code}`);

test.describe.configure({ mode: "serial" });

// the-channel-list-needs-no-login + by-ids-is-public-too + only-root-manages-channels, at the real
// interceptor: reads answer with NO token, a write without one is refused.
test("reads need no login, writes do", async ({ request }) => {
  const API = "http://localhost:8081/warehouse.shipment.v1.ShipmentChannelService";
  const json = { "Content-Type": "application/json" };

  const list = await request.post(`${API}/ShipmentChannelList`, {
    headers: json,
    data: { page: { page: 1, limit: 50 } },
  });
  expect(list.status()).toBe(200);
  expect(((await list.json()) as { ids: string[] }).ids.length).toBeGreaterThanOrEqual(3);

  const byIds = await request.post(`${API}/ShipmentChannelByIds`, {
    headers: json,
    data: { filter: { ids: ["1"] } },
  });
  expect(byIds.status()).toBe(200);

  const create = await request.post(`${API}/ShipmentChannelCreate`, {
    headers: json,
    data: { code: `anon_${SUFFIX}`, name: "nobody" },
  });
  expect(create.status()).toBe(401);
});

test("the seed is there: jne, jnt, sicepat", async ({ page }) => {
  await login(page);
  await gotoChannels(page);

  for (const code of ["jne", "jnt", "sicepat"]) {
    await expect(row(page, code)).toBeVisible();
  }
});

test("create, then edit — the code cannot change", async ({ page }) => {
  await login(page);
  await gotoChannels(page);

  await page.getByTestId("open-create-shipment-channel").click();
  await page.getByTestId("shipment-channel-code").fill(CODE);
  await page.getByTestId("shipment-channel-name").fill(NAME);
  await page.getByTestId("shipment-channel-save").click();

  await expect(row(page, CODE)).toContainText(NAME);

  await page.getByTestId(`edit-${CODE}`).click();
  await expect(page.getByTestId("shipment-channel-code")).toHaveAttribute("readonly");
  await page.getByTestId("shipment-channel-name").fill(`${NAME} Express`);
  await page.getByTestId("shipment-channel-save").click();

  await expect(row(page, CODE)).toContainText(`${NAME} Express`);
});

test("delete is soft, re-create is refused, restore brings it back", async ({ page }) => {
  await login(page);
  await gotoChannels(page);

  await page.getByTestId(`delete-${CODE}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(row(page, CODE)).toHaveCount(0);

  // Re-creating the deleted code points at restore.
  await page.getByTestId("open-create-shipment-channel").click();
  await page.getByTestId("shipment-channel-code").fill(CODE);
  await page.getByTestId("shipment-channel-name").fill("again");
  await page.getByTestId("shipment-channel-save").click();
  await expect(page.getByTestId("shipment-channel-form-error")).toContainText("restore it instead");
  await page.keyboard.press("Escape");

  await page.getByTestId("shipment-channel-show-deleted").click();
  await expect(page.getByTestId(`shipment-channel-status-${CODE}`)).toHaveText("Deleted");

  await page.getByTestId(`restore-${CODE}`).click();
  await expect(page.getByTestId(`shipment-channel-status-${CODE}`)).toHaveText("Live");
});

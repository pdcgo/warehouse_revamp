import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { SUFFIX, api } from "./restock_helpers";
import { PASSWORD, ROLES, sellingGround, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";

// ── the order detail on a phone (#104, #105, #106) ──────────────────────────────────────────────────────────────────────
//
// Decided phone rules (docs/technical/frontend/context_decision.md), applied to the order pages:
// - #104 the WAREHOUSE's order detail: its tabs (Info · Timeline · Settlement) go in ONE row across the top on a phone
//   (the-ledger-is-blocks-on-a-phone, as the order preview does) instead of a column beside the panel, so every card gets
//   the full width; Add Note and the Tags hint sit inside their cards; nothing runs past the screen edge at 390 or 320
//   (nothing-runs-past-a-phones-edge). The desktop keeps the column.
// - #105 the same page: the items are BLOCKS on a phone (a-phone-reads-each-line-as-a-block — the product, then
//   "Rp … × qty" and the line total, no table), and the header is ONE row (the-phone-header-is-one-row): back as an icon,
//   the number and its status, the one applicable action as an icon named by its label (a-phone-header-action-is-an-icon).
// - #106 the SELLER's order page: the six journey labels wrap under their dots (centred, at most two lines, 12px — 11px
//   below 360px) so none runs into the next at 390 / 360 / 320; on a desktop each reads on one line.
//
// Sign-in is WIDE (the phone shell has no `current-user`), then the viewport narrows. Layout is read from the rendered
// boxes; every check is about the page as a person sees it, never a class name.
//
// GROUND (beforeAll, as root): a selling team with a user per selling role, a warehouse with a warehouse:staff user,
// stock (sellingGround), a Shopee shop, ONE pending order (1 unit, a resi) — the warehouse can still cancel it, so its
// header carries one action.

const TAG = "OP";
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 640 };
const MID = { width: 360, height: 740 };
const WIDE = { width: 1280, height: 800 };
const CREW = `e2eopwh${SUFFIX}`;
const JOURNEY = ["pending", "processed", "picked", "shipping", "shipped", "completed"] as const;

let g: Ground;
let orderId = "";

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: Locator): Promise<Box> => {
  const b = await l.boundingBox();
  expect(b, "drawn").not.toBeNull();
  return b!;
};
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const middleY = (b: Box) => b.y + b.height / 2;
const middleX = (b: Box) => b.x + b.width / 2;

// Nothing runs past the screen's edge: the page never scrolls sideways.
async function expectNoSidewaysScroll(page: Page, what: string) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect.soft(scroll, `${what}: the page is ${scroll}px wide on a ${inner}px screen`).toBeLessThanOrEqual(inner);
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function crewPage(browser: Browser): Promise<Page> {
  const wh = await browser.newPage({ viewport: WIDE });
  await signIn(wh, CREW, PASSWORD);
  await useTeam(wh, g.warehouse);

  return wh;
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage({ viewport: WIDE });
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  g = await sellingGround(page, TAG, 5);
  await api(page, "user.v1.UserService/CreateUser", {
    teamId: g.warehouse,
    username: CREW,
    password: PASSWORD,
    name: `Phone crew ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });
  const shop = await shopOf(page, g, `E2E Ponsel Shop ${SUFFIX}`, `OPP${SUFFIX}`, "MARKETPLACE_SHOPEE", [ROOT_USER_ID, g.users.cs]);
  const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-phone-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: g.team,
    shopId: shop,
    warehouseId: g.warehouse,
    customerName: `E2E Ponsel Buyer ${SUFFIX}`,
    platformTotal: 100_000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `OP${SUFFIX}REF`,
    receiptCode: `OPR${SUFFIX}`,
    items: [{ productId: g.productId, productCode: g.code, name: `E2E ${g.code}`, quantity: 1 }],
  });
  orderId = String(placed.order.id);

  await page.close();
});

// ── #104 + #105: the warehouse's order detail ───────────────────────────────────────────────────────────────────────────

test("warehouse:staff — on a phone the order detail's tabs run across the top, its items are blocks and its header is one row", async ({
  browser,
}) => {
  const wh = await crewPage(browser);
  try {
    // The desktop first, as it was: tabs in a column beside the panel, the items a table.
    await wh.goto(`/orders/${orderId}`);
    await expect(wh.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
    const [info, timeline, settlement] = ["info", "timeline", "settlement"].map((t) => wh.getByTestId(`order-detail-tab-${t}`));
    await expect(info).toBeVisible();
    await test.step("regression: the desktop keeps its tab column and its item table", async () => {
      const [i, t] = [await box(info), await box(timeline)];
      expect.soft(t.y, "Timeline sits under Info").toBeGreaterThan(bottom(i) - 2);
      expect.soft(Math.abs(t.x - i.x), "one column").toBeLessThan(4);
      await expect.soft(wh.getByTestId("order-detail-items")).toHaveJSProperty("tagName", "TABLE");
    });

    for (const size of [PHONE, NARROW]) {
      await wh.setViewportSize(size);
      await expect(wh.getByTestId("order-detail-page")).toBeVisible();
      await expect(wh.getByTestId("order-detail-items")).not.toHaveJSProperty("tagName", "TABLE", { timeout: 10_000 });
      const at = `${size.width}px`;

      await test.step(`${at}: the tabs are one row across the top, above the panel`, async () => {
        const [i, t, s] = [await box(info), await box(timeline), await box(settlement)];
        expect.soft(Math.abs(t.y - i.y), `${at}: Timeline beside Info`).toBeLessThan(3);
        expect.soft(Math.abs(s.y - i.y), `${at}: Settlement beside Info`).toBeLessThan(3);
        expect.soft(t.x, `${at}: Timeline right of Info`).toBeGreaterThan(i.x);
        // The Info panel starts under the row, and its cards take the width of the screen, not a column's.
        const notes = await box(wh.getByTestId("order-detail-notes"));
        expect.soft(notes.y, `${at}: the notes card is under the tab row`).toBeGreaterThan(bottom(i) - 2);
        expect.soft(notes.width, `${at}: the notes card is ${notes.width}px wide`).toBeGreaterThan(size.width * 0.8);
        expect.soft(right(notes), `${at}: the notes card ends on the screen`).toBeLessThanOrEqual(size.width);
      });

      await test.step(`${at}: Add Note and the tags sit inside their cards`, async () => {
        const notes = await box(wh.getByTestId("order-detail-notes"));
        const add = await box(wh.getByTestId("notes-add"));
        expect.soft(add.x, `${at}: Add Note starts inside its card`).toBeGreaterThanOrEqual(notes.x);
        expect.soft(right(add), `${at}: Add Note ends inside its card`).toBeLessThanOrEqual(right(notes) + 0.5);
        const tags = wh.getByTestId("order-detail-tags");
        if ((await tags.count()) > 0) {
          const t = await box(tags);
          expect.soft(right(t), `${at}: the tags card ends on the screen`).toBeLessThanOrEqual(size.width);
          // Everything in the card stays in the card (the hint was cut before).
          const spill = await tags.evaluate((card) => {
            const edge = card.getBoundingClientRect().right;
            return Array.from(card.querySelectorAll("*")).filter((el) => el.getBoundingClientRect().right > edge + 0.5).length;
          });
          expect.soft(spill, `${at}: nothing in the tags card runs past it`).toBe(0);
        }
      });

      await test.step(`${at}: the items are blocks — the product, then price × qty and the line total`, async () => {
        const items = wh.getByTestId("order-detail-items");
        await expect.soft(items.locator("table")).toHaveCount(0);
        const line = items.getByTestId(`order-item-${g.code}`);
        await expect.soft(line).toBeVisible();
        await expect.soft(line).toContainText(`E2E ${g.code}`);
        await expect.soft(line).toContainText(/Rp\s?[\d.]+ × 1/);
        const l = await box(line);
        expect.soft(right(l), `${at}: the block ends on the screen`).toBeLessThanOrEqual(size.width);
      });

      await test.step(`${at}: the header is one row — back, the number and status, the action as an icon`, async () => {
        const back = await box(wh.getByTestId("order-detail-back"));
        const title = await box(wh.getByTestId("order-detail-title"));
        expect.soft(Math.abs(middleY(title) - middleY(back)), `${at}: back and the number share a row`).toBeLessThan(10);
        await expect.soft(wh.getByTestId("order-detail-back")).toHaveAccessibleName(/back/i);
        const cancel = wh.getByTestId("order-cancel");
        if ((await cancel.count()) > 0) {
          const c = await box(cancel);
          expect.soft(Math.abs(middleY(c) - middleY(back)), `${at}: the action on the same row`).toBeLessThan(10);
          expect.soft(right(c), `${at}: the action on the screen`).toBeLessThanOrEqual(size.width);
          // An icon, named by its label.
          await expect.soft(cancel).toHaveAccessibleName(/Cancel/);
          expect.soft((await cancel.innerText()).trim(), `${at}: the action shows no words`).toBe("");
        }
      });

      await expectNoSidewaysScroll(wh, `${at}, Info`);
      await timeline.click();
      await expect(wh.getByTestId("order-detail-timeline")).toBeVisible();
      await expectNoSidewaysScroll(wh, `${at}, Timeline`);
      await settlement.click();
      await expectNoSidewaysScroll(wh, `${at}, Settlement`);
      await info.click();
    }

    // Cancel on a phone still asks first (destructive actions always confirm).
    const cancel = wh.getByTestId("order-cancel");
    if ((await cancel.count()) > 0) {
      await test.step("regression: Cancel still confirms on a phone", async () => {
        await cancel.click();
        await expect.soft(wh.getByRole("alertdialog", { name: "Cancel Order" })).toBeVisible();
        await expect.soft(wh.getByRole("alertdialog")).toContainText(`Cancel order #${orderId}?`);
        await wh.keyboard.press("Escape");
      });
    }
  } finally {
    await wh.close();
  }
});

// ── #106: the seller's journey labels ───────────────────────────────────────────────────────────────────────────────────

test("selling:owner — on a phone the journey's six labels wrap under their dots and none runs into the next", async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: WIDE });
  try {
    await signIn(page, g.usernames[ROLES[0].key], PASSWORD);
    await useTeam(page, g.team);
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending", { timeout: 15_000 });

    const labels = JOURNEY.map((id) => page.getByTestId(`stage-step-label-${id}`));
    const read = async () =>
      Promise.all(
        labels.map((l) =>
          l.evaluate((el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              text: el.textContent ?? "",
              x: r.x,
              right: r.right,
              height: r.height,
              fontSize: parseFloat(cs.fontSize),
              lineHeight: parseFloat(cs.lineHeight),
              clipped: el.scrollHeight > el.clientHeight + 1,
            };
          }),
        ),
      );

    await test.step("regression: on a desktop each label reads on one line", async () => {
      for (const l of await read()) {
        expect.soft(l.height, `"${l.text}" is one line`).toBeLessThan(l.lineHeight * 1.5);
      }
    });

    for (const size of [PHONE, MID, NARROW]) {
      await page.setViewportSize(size);
      await expect(page.getByTestId("stage-stepper")).toBeVisible();
      const at = `${size.width}px`;
      await test.step(`${at}: no label runs into the next, each at most two lines, under its dot`, async () => {
        await expect
          .poll(async () => (await read())[0]!.fontSize, { message: `${at}: the labels' size` })
          .toBe(size.width < 360 ? 11 : 12);
        const all = await read();
        for (let i = 0; i < all.length; i++) {
          const l = all[i]!;
          expect.soft(Math.round(l.height / l.lineHeight), `${at}: "${l.text}" in at most two lines`).toBeLessThanOrEqual(2);
          expect.soft(l.clipped, `${at}: "${l.text}" is not cut`).toBe(false);
          if (i + 1 < all.length) {
            const next = all[i + 1]!;
            expect.soft(l.right, `${at}: "${l.text}" ends before "${next.text}" starts`).toBeLessThanOrEqual(next.x + 0.5);
          }
          const dot = await box(page.getByTestId(`stage-step-${JOURNEY[i]}`));
          expect.soft(Math.abs((l.x + l.right) / 2 - middleX(dot)), `${at}: "${l.text}" centred under its dot`).toBeLessThan(2);
        }
        const last = all[all.length - 1]!;
        expect.soft(last.right, `${at}: the last label on the screen`).toBeLessThanOrEqual(size.width);
      });
      await expectNoSidewaysScroll(page, at);
    }
  } finally {
    await page.close();
  }
});

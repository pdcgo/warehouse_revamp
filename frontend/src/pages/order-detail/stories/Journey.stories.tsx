import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { withOrderStatus } from "../../../../.storybook/sessionScenario";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import i18n from "../../../i18n/config";
import { ORDER_DETAIL_META, Routed, SELLER } from "./kit";

// THE SELLER'S ORDER PAGE — THE STATUS JOURNEY ON A PHONE (backlog #106). The owner, from his phone: *"This status journey
// is overlapping each other"*. At 390 the six labels sat on one line each (`nowrap`) in six ~57px steps, so *Sudah
// diambil*, *Sudah diserahkan* and *Dikirim* ran into each other. Now a label WRAPS under its dot — centred, a tight line
// height, at most two lines — so no label runs into the next. The design is the same: the six dots, the travelled line,
// the ring on the current step, the branch line under an order that left the journey; and a desktop reads one line each,
// as before. Below 360 a label is 11px instead of 12: at 320, the narrowest phone, even the one-word labels touched at 12
// (*Pending*/*Processed*, *Menunggu*/*Diproses*); from 360 up they stay 12, and every story checks the size it should be.
//
// Each story reads the labels in BOTH languages (Indonesian, the owner's, first; then English, whose labels differ), on
// the seller's 101, read as each status by the stub (`withOrderStatus`).
//
//   | story                          | the rule it pins                                                              |
//   | ------------------------------ | ----------------------------------------------------------------------------- |
//   | PendingAt390 · PendingAt360    | waiting: each label's right ≤ the next one's left, ≤ 2 lines, centred, whole   |
//   | ShippedAt390 · ShippedAt360    | further along (Dikirim the current step) — the same                            |
//   | LostAt390 · LostAt360          | off the journey: the same, and the branch line still shows, on the screen      |
//   | PendingAt320 · ShippedAt320 ·  | the narrowest phone: the labels at 11px, and the same checks — apart, whole,   |
//   |   LostAt320                    |   centred, the branch line on the screen                                       |
//   | DesktopReadsOneLineEach        | 1440: every label on ONE line, as before the fix                               |

/** The widths the stories are judged at — in the file, so the runner sets them (addon-vitest reads the story's options). */
const VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
  phone360: { name: "Phone 360", styles: { width: "360px", height: "780px" }, type: "mobile" },
  phone320: { name: "Phone 320", styles: { width: "320px", height: "640px" }, type: "mobile" },
  desktop1440: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" }, type: "desktop" },
};

type Lang = "id" | "en";

/** The six journey steps, in order — `stages.ts`'s ids — and what each language calls them (`orders.stage.*`). */
const JOURNEY = ["pending", "processed", "picked", "shipping", "shipped", "completed"] as const;
const LABELS: Record<Lang, string[]> = {
  id: ["Menunggu", "Diproses", "Sudah diambil", "Sudah diserahkan", "Dikirim", "Selesai"],
  en: ["Pending", "Processed", "Picked", "Handed over", "Shipped", "Completed"],
};

const At101 = Routed("/orders/101");

const meta = {
  title: "Pages/Order/OrderDetailPage/Journey",
  ...ORDER_DETAIL_META,
  parameters: { ...ORDER_DETAIL_META.parameters, viewport: { options: VIEWPORTS } },
  globals: { viewport: { value: "phone390" }, locale: "id" },
  beforeEach: asTeam(SELLER.id),
  render: () => <At101 />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A `beforeEach`: the seller reads 101 as `status`. */
const as101 = (status: OrderStatus) => () => {
  asTeam(SELLER.id)();
  withOrderStatus(101n, status)();
};

/** The horizontal middle of a box. */
function centre(b: DOMRect): number {
  return (b.left + b.right) / 2;
}

/** A label's size: 11px below 360 (`StageStepper`'s `NARROW_PHONE`), 12px (`xs`) from 360 up. */
function labelPx(width: number): number {
  return width < 360 ? 11 : 12;
}

/**
 * THE LABELS, IN `lang`: each on the screen and whole (at most two lines, nothing cut), each line centred under its dot,
 * none running into the next — a label's right edge is at or before the next label's left — and each `px` big.
 */
async function expectLabelsApart(stepper: HTMLElement, lang: Lang, maxLines: number, px: number) {
  const labels = JOURNEY.map((id) => within(stepper).getByTestId(`stage-step-label-${id}`));
  const dots = JOURNEY.map((id) => within(stepper).getByTestId(`stage-step-${id}`));
  await waitFor(() => expect(labels.map((l) => l.textContent)).toEqual(LABELS[lang]));

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    const box = label.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
    const what = `${lang} ${LABELS[lang][i]}`;

    await expect(box.width, what).toBeGreaterThan(0);
    await expect(box.left, `${what} on the screen`).toBeGreaterThanOrEqual(0);
    await expect(box.right, `${what} on the screen`).toBeLessThanOrEqual(window.innerWidth);
    await expect(box.height, `${what} at most ${maxLines} line(s)`).toBeLessThanOrEqual(maxLines * lineHeight + 1);
    await expect(label.scrollHeight, `${what} whole, not cut`).toBeLessThanOrEqual(label.clientHeight);

    // Under its dot: every line of the label is centred on the dot's middle.
    const dotMiddle = centre(dots[i]!.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = [...range.getClientRects()].filter((r) => r.width > 4);
    await expect(lines.length, `${what} has text`).toBeGreaterThan(0);
    for (const line of lines) {
      await expect(Math.abs(centre(line) - dotMiddle), `${what} centred under its dot`).toBeLessThanOrEqual(2.5);
    }

    // None over its neighbour.
    if (i > 0) {
      const prev = labels[i - 1]!.getBoundingClientRect();
      await expect(prev.right, `${lang} ${LABELS[lang][i - 1]} ends before ${LABELS[lang][i]} starts`).toBeLessThanOrEqual(
        box.left,
      );
    }
  }
  // The page never scrolls sideways.
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  // The size it should be — checked last, so a label that grew shows first as the overlap it causes.
  for (let i = 0; i < labels.length; i++) {
    await expect(getComputedStyle(labels[i]!).fontSize, `${lang} ${LABELS[lang][i]} is ${px}px`).toBe(`${px}px`);
  }
}

/**
 * The journey on 101's page, read in Indonesian (the story's language) and then in English, and put back in Indonesian.
 * `then` runs after each language's labels are checked.
 */
function journeyAt(width: number, stage: string, maxLines = 2, then?: (stepper: HTMLElement, lang: Lang) => Promise<void>) {
  return async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const stepper = await within(canvasElement).findByTestId("stage-stepper", {}, { timeout: 4000 });
    await expect(window.innerWidth).toBe(width);
    await waitFor(() => expect(stepper).toHaveAttribute("data-stage", stage), { timeout: 4000 });

    try {
      for (const lang of ["id", "en"] as const) {
        await i18n.changeLanguage(lang);
        await expectLabelsApart(stepper, lang, maxLines, labelPx(width));
        await then?.(stepper, lang);
      }
    } finally {
      await i18n.changeLanguage("id");
    }
  };
}

/** The branch an off-journey order hangs from Dikirim: on the screen, its status and where it left in its own words. */
async function expectTheBranch(stepper: HTMLElement, lang: Lang) {
  const branch = within(stepper).getByTestId("stage-branch");
  const box = branch.getBoundingClientRect();

  await expect(branch).toBeVisible();
  await expect(branch).toHaveTextContent(lang === "id" ? "Hilang" : "Lost");
  await expect(branch).toHaveTextContent(lang === "id" ? "keluar dari alur di Dikirim" : "left the journey at Shipped");
  await expect(box.left).toBeGreaterThanOrEqual(0);
  await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  // Under the steps, never over the labels.
  const lowest = Math.max(
    ...JOURNEY.map((id) => within(stepper).getByTestId(`stage-step-label-${id}`).getBoundingClientRect().bottom),
  );
  await expect(box.top).toBeGreaterThanOrEqual(lowest);
}

/** A WAITING ORDER AT 390 — Menunggu the current step, the five ahead greyed; no label runs into the next. */
export const PendingAt390: Story = {
  name: "Pending — at 390 no label runs into the next",
  play: journeyAt(390, "pending"),
};

/** A WAITING ORDER AT 360 — the narrower phone: the long labels take two lines, still apart. */
export const PendingAt360: Story = {
  name: "Pending — at 360 no label runs into the next",
  globals: { viewport: { value: "phone360" }, locale: "id" },
  play: journeyAt(360, "pending"),
};

/** FURTHER ALONG AT 390 — Dikirim the current step, the travelled line behind it. */
export const ShippedAt390: Story = {
  name: "Shipped — at 390 no label runs into the next",
  beforeEach: as101(OrderStatus.SHIPPED),
  play: journeyAt(390, "shipped"),
};

/** FURTHER ALONG AT 360. */
export const ShippedAt360: Story = {
  name: "Shipped — at 360 no label runs into the next",
  globals: { viewport: { value: "phone360" }, locale: "id" },
  beforeEach: as101(OrderStatus.SHIPPED),
  play: journeyAt(360, "shipped"),
};

/** OFF THE JOURNEY AT 390 — a lost order: the labels apart, and the branch line under them still says where it went. */
export const LostAt390: Story = {
  name: "Lost — at 390 the labels stay apart and the branch shows",
  beforeEach: as101(OrderStatus.LOST),
  play: journeyAt(390, "lost", 2, expectTheBranch),
};

/** OFF THE JOURNEY AT 360. */
export const LostAt360: Story = {
  name: "Lost — at 360 the labels stay apart and the branch shows",
  globals: { viewport: { value: "phone360" }, locale: "id" },
  beforeEach: as101(OrderStatus.LOST),
  play: journeyAt(360, "lost", 2, expectTheBranch),
};

/** A WAITING ORDER AT 320 — the narrowest phone: the labels at 11px, so even *Menunggu* and *Diproses* stay apart. */
export const PendingAt320: Story = {
  name: "Pending — at 320 the labels are smaller and none runs into the next",
  globals: { viewport: { value: "phone320" }, locale: "id" },
  play: journeyAt(320, "pending"),
};

/** FURTHER ALONG AT 320. */
export const ShippedAt320: Story = {
  name: "Shipped — at 320 the labels are smaller and none runs into the next",
  globals: { viewport: { value: "phone320" }, locale: "id" },
  beforeEach: as101(OrderStatus.SHIPPED),
  play: journeyAt(320, "shipped"),
};

/** OFF THE JOURNEY AT 320 — the branch line still on the screen. */
export const LostAt320: Story = {
  name: "Lost — at 320 the labels are smaller, apart, and the branch shows",
  globals: { viewport: { value: "phone320" }, locale: "id" },
  beforeEach: as101(OrderStatus.LOST),
  play: journeyAt(320, "lost", 2, expectTheBranch),
};

/** THE DESKTOP IS UNCHANGED: with room to spare, every label reads on ONE line, in both languages, as it did. */
export const DesktopReadsOneLineEach: Story = {
  name: "Desktop — every label on one line, as before",
  globals: { viewport: { value: "desktop1440" }, locale: "id" },
  play: journeyAt(1440, "pending", 1),
};

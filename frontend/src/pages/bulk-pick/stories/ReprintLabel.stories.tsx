import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { withLabelEvents } from "../../../../.storybook/reprintLabelScenario";
import { BulkPickPage } from "../index";
import { DESKTOP, PHONE, SCENE_PATH, VIEWPORTS, bulkPickPage, bulkPickScene, fitsTheScreen, loaded } from "./kit";

// CETAK ULANG LABEL on DAFTAR AMBIL (a-changed-label-asks-the-warehouse-to-reprint; the-reprint-label-prototype-is-accepted:
// *"the badge also goes on the Daftar Ambil (bulk pick) list"*) — live: the server's `OrderPick.reprint_label`, read by
// the page's one OrderPickLines. In the scene (kit.tsx) 103 was printed 3 h ago and its label replaced 1 h ago → marked;
// 104's label was replaced BEFORE its print → nothing. Per pesanan carries the badge in the order's head, drawn as the
// list's row draws it (on a phone a line of its own under the head); Per produk names no order, so it carries none.
//
//   | story          | what it pins                                                           |
//   | -------------- | ---------------------------------------------------------------------- |
//   | ByOrder        | 103's head carries the badge; no other order does                       |
//   | Phone          | a line of its own in 103's block; the page fits 390 px                  |

const MARKED = 103n;

const ByOrderPage = bulkPickPage(`${SCENE_PATH}&view=order`);

const meta = {
  title: "Pages/Warehouse/BulkPick/ReprintLabel",
  component: BulkPickPage,
  parameters: { signedIn: true, dataRouter: true, viewport: { options: VIEWPORTS } },
  beforeEach: () => {
    const restore = bulkPickScene();
    withLabelEvents({ "103": { printed: 3, changed: 1 }, "104": { printed: 4, changed: 6 } })();
    return restore;
  },
  render: () => <ByOrderPage />,
} satisfies Meta<typeof BulkPickPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const badged = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("[data-testid^='bulk-pick-reprint-label-']")).map((el) =>
    el.getAttribute("data-testid")!.replace("bulk-pick-reprint-label-", ""),
  );

// PER PESANAN — the marked order says so in its head, beside its resi; the others carry nothing.
export const ByOrder: Story = {
  name: "By order · the marked order's head",
  globals: DESKTOP,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId("bulk-pick-by-order");

    await waitFor(() => expect(badged(canvasElement)).toEqual([String(MARKED)]));
    const head = canvas.getByTestId(`bulk-pick-order-${MARKED}`);
    await expect(within(head).getByTestId(`bulk-pick-reprint-label-${MARKED}`)).toHaveTextContent("Reprint label");
  },
};

// ON A PHONE — a line of its own under the order's head, inside the screen.
export const Phone: Story = {
  name: "Phone 390",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await canvas.findByTestId("bulk-pick-by-order");

    await waitFor(() => expect(badged(canvasElement)).toEqual([String(MARKED)]));
    await expect(canvas.getByTestId(`bulk-pick-reprint-label-${MARKED}`)).toBeVisible();
    await fitsTheScreen();
  },
};

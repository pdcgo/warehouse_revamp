import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { OrderImportLog, type OrderImportLine, type OrderImportResult } from "./OrderImportLog";

// THE ORDER IMPORT'S LOG — step 3 of the Import (the-import-is-platform-then-shop-and-file-then-log).
//
// Each state as the stream leaves it. The refs and reasons are the mocks' (examples/order_samples), and each
// not-applied reason is one of the-import-moves-only-after-handover's.

const meta = {
  title: "Pages/Orders/OrderImportLog",
  component: OrderImportLog,
} satisfies Meta<typeof OrderImportLog>;

export default meta;
type Story = StoryObj<typeof meta>;

const NOT_APPLIED: OrderImportLine[] = [
  { level: "warn", message: "2410297HQK31NB — cancelled on the platform" },
  { level: "warn", message: "2410298C2M0TTA — no such order in Melati Official" },
  { level: "warn", message: "241029AF5S4WEX — the file is behind ours: Selesai here, Sedang Dikirim in the file" },
  { level: "warn", message: "241030B1KX9PD2 — matches two orders" },
  { level: "warn", message: "241030BKD8F0QA — not after handover: still Diproses here" },
  { level: "warn", message: "241030C03R7TMS — cancelled on the platform" },
  { level: "warn", message: "241030C5NWQ2HZ — no such order in Melati Official" },
];

const DONE: OrderImportResult = {
  phase: "done",
  step: 168,
  count: 168,
  tally: { moved: 41, alreadyThere: 120, notApplied: 7 },
  lines: [
    { level: "info", message: "Order.all.20261030.xlsx — 168 rows" },
    { level: "info", message: "2410287UDJ2K4M — moved to Dikirim" },
    { level: "info", message: "241028A09VRB3C — already Selesai" },
    ...NOT_APPLIED,
    { level: "info", message: "241030D2TQ8W1F — moved to Selesai" },
  ],
};

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Running: Story = {
  args: {
    result: {
      phase: "running",
      step: 96,
      count: 168,
      tally: { moved: 22, alreadyThere: 70, notApplied: 4 },
      lines: DONE.lines.slice(0, 6),
    },
  },
};

export const Done: Story = { args: { result: DONE } };

export const EveryRowMatched: Story = {
  args: {
    result: {
      phase: "done",
      step: 120,
      count: 120,
      tally: { moved: 30, alreadyThere: 90, notApplied: 0 },
      lines: [{ level: "info", message: "Order.all.20261030.xlsx — 120 rows" }],
    },
  },
};

/** The file is not this platform's order export: one ERROR line, and no order touched. */
export const TheFileIsRefused: Story = {
  args: {
    result: {
      phase: "failed",
      step: 0,
      count: 0,
      lines: [
        { level: "info", message: "reading Melati Official's Shopee order export" },
        {
          level: "error",
          message: "not this platform's order export: no \"No. Pesanan\" and \"Status Pesanan\" columns — is it a Shopee order export?",
        },
      ],
    },
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The not-applied rows are customer service's to-do list, so they come first — five of them, then a pointer to the
// log for the rest, where every line is.
export const TheSummaryListsFiveAndSendsTheRestToTheLog: Story = {
  args: { result: DONE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-import-summary")).toHaveTextContent("7 orders were not applied");
    await expect(canvas.getAllByTestId("order-import-not-applied")).toHaveLength(5);
    await expect(canvas.getByTestId("order-import-more")).toHaveTextContent("and 2 more in the log");

    await expect(canvas.queryByTestId("order-import-lines")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("order-import-log-toggle"));
    await expect(within(canvas.getByTestId("order-import-lines")).getByText(NOT_APPLIED[6]!.message)).toBeVisible();
  },
};

// A failure before the first row has nothing to measure: no bar, no counts — an empty bar under "did not run" would
// read as still going.
export const AFailureBeforeTheFirstRowDrawsNoBar: Story = {
  args: TheFileIsRefused.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-import-failed-reason")).toHaveTextContent("is it a Shopee order export?");
    await expect(canvas.queryByTestId("order-import-progress")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("order-import-tally")).not.toBeInTheDocument();
  },
};

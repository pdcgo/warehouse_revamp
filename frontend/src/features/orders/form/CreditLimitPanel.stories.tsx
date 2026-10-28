import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { CreditLimitPanel } from "./CreditLimitPanel";
import type { CreditRow } from "./CreditLimitPanel";

// THE ORDER FORM'S DEBT LIMITS — one row per creditor this order would owe, each with the limit THAT creditor set on
// the ordering team and the debt already carried (the-debtor-sees-the-limits-set-on-it). Shared by the new order and
// the draft being finished, so its rules are pinned here rather than on either page.

const row = (teamId: bigint, name: string, figures: CreditRow["figures"], adds = 120_000n): CreditRow => ({
  teamId,
  name,
  roles: ["owner"],
  figures,
  adds,
});

const READ: CreditRow[] = [
  { ...row(11n, "Gudang Pusat", { state: "ready", debt: 8_700_000n, limit: 10_000_000n }, 2_000n), roles: ["warehouse", "owner"] },
  row(13n, "Toko Kenanga", { state: "ready", debt: 400_000n, limit: 2_000_000n }),
  row(14n, "Gudang Cabang", { state: "ready", debt: 860_000n, limit: undefined }),
  row(15n, "Toko Anggrek", { state: "ready", debt: 870_000n, limit: 1_000_000n }, 200_000n),
];

const meta = {
  title: "Features/Orders/CreditLimitPanel",
  component: CreditLimitPanel,
  args: { rows: READ },
} satisfies Meta<typeof CreditLimitPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// Every state a creditor can be in, read: OK, NEAR (87%), unlimited, and a projection past the ceiling.
export const Read: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // NEAR is marked BESIDE THE NAME — the meter's own badge is suppressed on this panel.
    await expect(canvas.getByTestId("credit-warn-11")).toBeInTheDocument();
    await expect(canvas.getByTestId("credit-meter-11-pct")).toHaveTextContent("87%");
    await expect(canvas.queryByTestId("credit-warn-13")).toBeNull();

    // Unlimited is WORDS, never a full bar.
    await expect(canvas.getByTestId("credit-meter-14")).toHaveTextContent("Unlimited");

    // 870.000 + 200.000 crosses Toko Anggrek's 1.000.000: the projection becomes the row's warning.
    await expect(canvas.getByTestId("credit-after-15")).toHaveTextContent("over the limit after this order");
  },
};

// ⚠ A ROW STILL READING NEVER CLAIMS "UNLIMITED" — a figure nobody has read yet is not a creditor's decision. It
// says it is reading, and states only what this order adds.
export const StillReading: Story = {
  args: {
    rows: [row(11n, "Gudang Pusat", { state: "loading" }, 2_000n), row(15n, "Toko Anggrek", { state: "loading" })],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("credit-loading-11")).toBeInTheDocument();
    await expect(canvas.queryByTestId("credit-meter-11")).toBeNull();
    await expect(canvas.queryByText("Unlimited")).toBeNull();
    await expect(canvas.getByTestId("credit-after-15")).toHaveTextContent("This order adds Rp");
  },
};

// ⚠ …AND NEITHER DOES A FAILED READ. The row says it could not read the limit — the create still checks it.
export const TheReadFailed: Story = {
  args: {
    rows: [row(15n, "Toko Anggrek", { state: "failed" })],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("credit-failed-15")).toBeInTheDocument();
    await expect(canvas.queryByText("Unlimited")).toBeNull();
    await expect(canvas.queryByTestId("credit-warn-15")).toBeNull();
  },
};

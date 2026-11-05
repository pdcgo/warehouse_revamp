import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { REPORT_META, loaded } from "./kit";

// ACCOUNT REPORT — the title's row — the screen rules, Export marked, and the Periode / Rincian switch. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Report/Header",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// SWITCHING VIEW LEAVES ONLY THE NEW ONE (owner: *"ketika pindah ke tab rincian, tabel tidak hilang di awal-awal, baru
// hilang saat kedua kali"*) — the Periode table goes the FIRST time Rincian is picked, not only from the second. The
// bug lived in the panel's fade (motion-is-small-quick-and-shared), which this run's reduced motion switches off, so
// the story holds the rule rather than reproducing the bug; it was reproduced with motion on.
export const SwitchingViewLeavesOnlyTheNewOne: Story = {
  name: "Switching view",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("account-report-series")).toBeVisible();

    for (let round = 0; round < 2; round++) {
      await userEvent.click(canvas.getByTestId("account-report-view-breakdown"));
      await waitFor(() => expect(canvas.queryByTestId("account-report-series")).toBeNull());
      // Waited for: with motion on, the arriving panel starts its fade at opacity 0.
      await waitFor(() => expect(canvas.getByTestId("account-report-breakdown")).toBeVisible());

      await userEvent.click(canvas.getByTestId("account-report-view-period"));
      await waitFor(() => expect(canvas.queryByTestId("account-report-breakdown")).toBeNull());
      await waitFor(() => expect(canvas.getByTestId("account-report-series")).toBeVisible());
    }
  },
};

// THE REPORT FOLLOWS THE SCREEN RULES (`the-report-follows-the-screen-rules`) — the subtitle under the title, the filters
// in the shared FilterBar, no account picked reading "All accounts" as the shop filter reads "All shops".
export const TheReportFollowsTheScreenRules: Story = {
  name: "Screen rules",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const title = canvas.getByRole("heading", { name: "Account Report" });
    const subtitle = canvas.getByTestId("account-report-subtitle");
    await expect(subtitle.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toBeLessThan(12);

    await expect(canvas.getByTestId("account-report-filters")).toBeVisible();
    await expect(canvas.getByTestId("account-report-account")).toHaveAttribute("placeholder", "All accounts");
  },
};

// Export is on the screen and marked (owner: *"sama action export, kasih warning unimplemented"*) — the button on the
// title's row with its ⚠ number, and the folded strip at the top saying what is not built.
export const ExportIsMarkedNotBuilt: Story = {
  name: "Export, marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportButton = canvas.getByTestId("account-report-export");
    await expect(exportButton).toHaveTextContent("Export");
    await expect(within(exportButton).getByTestId("not-implemented-export")).toHaveTextContent("1");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
  },
};

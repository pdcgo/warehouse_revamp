import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { accountReportExportScenario } from "../../../../.storybook/financialAccountExportScenario";
import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { GroupType, SortType } from "../../../gen/warehouse/analytic_base/v1/analytic_pb";
import { FinancialAccountReportView } from "../../../gen/warehouse/financial_account/v1/financial_account_analytic_pb";
import { BCA_OPS, REPORT_META, loaded, pickAccount } from "./kit";

// ACCOUNT REPORT — the title's row — the screen rules, Export (the view as a file, none while monitoring), and the Periode / Rincian switch. The page's stories are grouped by the part of the screen they are about
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

// THE VIEW AS A FILE (a-report-export-is-the-whole-view-as-a-file; owner: *"sama action export"*) — the button on the
// title's row, no ⚠ any more. On Periode it asks for every period at the grain on screen, in the heading's order: here
// by month, oldest first. The file downloads as the stream ends.
export const ExportsThePeriodeView: Story = {
  name: "Export, Periode",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportButton = canvas.getByTestId("account-report-export");
    await expect(exportButton).toHaveTextContent("Export");
    await expect(canvas.queryByTestId("not-implemented-export")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-summary")).toBeNull();

    await userEvent.click(canvas.getByTestId("account-report-grain-month"));
    await userEvent.click(canvas.getByTestId("account-report-sort-period"));

    await userEvent.click(exportButton);
    await waitFor(() => expect(accountReportExportScenario.calls).toHaveLength(1));

    const call = accountReportExportScenario.calls[0]!;
    await expect(call.teamId).toBe(12n);
    await expect(call.view).toBe(FinancialAccountReportView.PERIOD);
    await expect(call.groupBy).toBe(GroupType.MONTHLY);
    await expect(call.sortType).toBe(SortType.ASC);
    await expect(call.filters.map((f) => f.f.case)).toEqual(["dateRangeFilter"]);
    // Every month of the window — the quiet ones too.
    await expect(call.rows).toBeGreaterThanOrEqual(2);
    await expect((await screen.findAllByText("Export ready — the file is downloading")).length).toBeGreaterThan(0);
  },
};

// On Rincian, with one account picked, Export asks for the breakdowns of THAT account — one sheet each — and no grain.
export const ExportsTheRincianViewAsFiltered: Story = {
  name: "Export, Rincian",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickAccount(canvas, BCA_OPS.id);
    await userEvent.click(canvas.getByTestId("account-report-view-breakdown"));
    await canvas.findByTestId("account-report-breakdown", {}, { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("account-report-export"));
    await waitFor(() => expect(accountReportExportScenario.calls).toHaveLength(1));

    const call = accountReportExportScenario.calls[0]!;
    await expect(call.view).toBe(FinancialAccountReportView.BREAKDOWN);
    await expect(call.groupBy).toBe(GroupType.UNSPECIFIED);
    await expect(call.filters.map((f) => f.f.case)).toEqual(["dateRangeFilter", "accountFilter"]);
    await expect(call.filters[1]!.f.value).toMatchObject({ accountIds: [BCA_OPS.id] });
  },
};

// the-admin-team-monitors-read-only — the admin team READING the report: every figure, but no Export, which stores a file.
export const MonitoringOffersNoExport: Story = {
  name: "Monitoring, no Export",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("account-report-export")).toBeNull();
  },
};

// A phone: Export is the header's icon (a-phone-header-action-is-an-icon) — tapped, it exports the view on screen.
export const MobileExports: Story = {
  name: "Export, on a phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportIcon = canvas.getByRole("button", { name: "Export" });
    await expect(exportIcon).toHaveAttribute("data-testid", "account-report-export");
    await expect(exportIcon).not.toHaveTextContent("Export");
    const title = canvas.getByRole("heading", { name: "Account Report" });
    await expect(Math.abs(exportIcon.getBoundingClientRect().top - title.getBoundingClientRect().top)).toBeLessThan(16);

    await userEvent.click(exportIcon);
    await waitFor(() => expect(accountReportExportScenario.calls).toHaveLength(1));
    await expect(accountReportExportScenario.calls[0]!.view).toBe(FinancialAccountReportView.PERIOD);
    await expect(accountReportExportScenario.calls[0]!.groupBy).toBe(GroupType.DAILY);
  },
};

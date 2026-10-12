import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { settlementImports, shops, teams } from "../../../.storybook/fixtures";
import { settlementImportScenario } from "../../../.storybook/settlementImportScenario";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { SettlementImportsPage } from "./index";

// ⚠ PROTOTYPE for design_accept — docs/business/settlement/settlement_importer_decision.md.
//
// Toko Melati's imported statements, and the dialog that brings in the next one. The stub serves the
// importer's rules — the shop check before anything is stored, a file refused as a whole, and an import
// that keeps running after its window closes — so every play() below is one recorded decision.

const TEAM = teams.find((t) => t.id === 12n)!; // Toko Melati
const SHOPEE = shops.find((s) => s.teamId === TEAM.id && s.marketplace === Marketplace.SHOPEE)!; // Melati Official
const TIKTOK = shops.find((s) => s.teamId === TEAM.id && s.marketplace === Marketplace.TIKTOK)!; // Melati TikTok
const TOKOPEDIA = shops.find((s) => s.teamId === TEAM.id && s.marketplace === Marketplace.TOKOPEDIA)!; // Melati Store

const [done, , interrupted, failed] = settlementImports;

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const Routed = routedPage(
  [
    { path: "/settlement/imports", element: <SettlementImportsPage /> },
    marker("/settlement/imports/:fileId", "at-import-detail"),
  ],
  "/settlement/imports",
);

const meta = {
  title: "Pages/Settlement/Imports",
  component: SettlementImportsPage,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(TEAM.id),
  render: () => <Routed />,
} satisfies Meta<typeof SettlementImportsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`import-row-${done!.id}`, {}, { timeout: 3000 });
  return canvas;
}

// Open the dialog, choose a shop, attach a statement. Returns the dialog.
async function prepareImport(canvasElement: HTMLElement, shopId: bigint, fileName = "statement.xlsx", type = XLSX) {
  const canvas = await loaded(canvasElement);

  await userEvent.click(canvas.getByTestId("open-import-file"));
  const dialog = await screen.findByTestId("import-dialog");
  await waitFor(() => expect(dialog).toBeVisible());

  const d = within(dialog);
  await userEvent.click(d.getByTestId("shop-select"));
  const option = await d.findByTestId(`shop-select-option-${shopId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);

  const input = d.getByTestId("import-file-input") as HTMLInputElement;
  await userEvent.upload(input, new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], fileName, { type }), {
    applyAccept: false,
  });

  return { canvas, dialog, d };
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const TheDialogBeforeAnImport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("open-import-file"));
    await waitFor(async () => expect(await screen.findByTestId("import-dialog")).toBeVisible());
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// the-row-key-is-the-only-dedupe: every UPLOAD is a row — its shop, its own range, who and when, and
// what became of its rows.
export const EveryUploadIsARow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const file of settlementImports) {
      await expect(canvas.getByTestId(`import-row-${file.id}`)).toBeInTheDocument();
    }

    const row = canvas.getByTestId(`import-row-${done!.id}`);
    await expect(row).toHaveTextContent(SHOPEE.name);
    await expect(row).toHaveTextContent(`${done!.periodFrom} – ${done!.periodTo}`);
    await waitFor(() => expect(row).toHaveTextContent("Budi Santoso"));
  },
};

// an-import-finishes-whether-anyone-watches: a server stopped mid-file leaves the row interrupted — and the
// row says how to finish it.
export const AnInterruptedFileSaysHowToFinishIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId(`import-row-${interrupted!.id}`);
    await expect(within(row).getByTestId("upload-status-interrupted")).toBeInTheDocument();
    await expect(canvas.getByTestId(`import-hint-${interrupted!.id}`)).toHaveTextContent("Upload the same file again");
  },
};

// a-file-with-another-shops-orders-is-refused: a file refused as a whole says why, in its row.
export const AFailedFileSaysWhy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId(`import-row-${failed!.id}`);
    await expect(within(row).getByTestId("upload-status-failed")).toBeInTheDocument();
    await expect(row).toHaveTextContent("belong to Melati Store");
  },
};

// The platform is the shop's marketplace, so a person never picks it — and a shop on any other
// marketplace cannot import at all.
export const OnlyShopeeAndTikTokCanImport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-import-file"));
    const dialog = await screen.findByTestId("import-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const d = within(dialog);

    await userEvent.click(d.getByTestId("shop-select"));
    const option = await d.findByTestId(`shop-select-option-${TOKOPEDIA.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(await d.findByTestId("import-unsupported")).toBeVisible();
    await expect(d.getByTestId("start-import")).toBeDisabled();
  },
};

// A statement is the .xlsx the platform exports — anything else is refused before it is sent.
export const OnlyAnXlsxIsAccepted: Story = {
  play: async ({ canvasElement }) => {
    const { d } = await prepareImport(canvasElement, SHOPEE.id, "statement.csv", "text/csv");

    await expect(await d.findByTestId("import-file-error")).toHaveTextContent(".xlsx");
    await expect(d.getByTestId("start-import")).toBeDisabled();
  },
};

// the-import-is-one-streamed-call: the bar and the tallies climb from the stream's own fields, and the end
// says what did NOT post. A TikTok order's affiliate commission is its own row
// (tiktok-affiliate-commission-posts-as-affiliate-fee), so twelve rows come from eleven lines.
export const AnImportStreamsToItsEnd: Story = {
  play: async ({ canvasElement }) => {
    const { d } = await prepareImport(canvasElement, TIKTOK.id);

    await expect(d.getByTestId("import-file-name")).toHaveTextContent("statement.xlsx");
    await userEvent.click(d.getByTestId("start-import"));

    await waitFor(() => expect(d.getByTestId("import-progress-text")).toHaveTextContent("12 of 12 rows"), {
      timeout: 5000,
    });
    await waitFor(() => expect(d.getByTestId("import-summary")).toHaveTextContent("2 lines need a look"));
    await expect(d.getAllByTestId("import-problem")).toHaveLength(2);
    await expect(d.getByTestId("tally-posted-value")).toHaveTextContent("10");
    await expect(d.getByTestId("tally-held-value")).toHaveTextContent("1");
    await expect(d.getByTestId("tally-skipped-value")).toHaveTextContent("1");

    // The file's own page is one click away.
    await userEvent.click(d.getByTestId("open-imported-file"));
    await waitFor(async () => expect(await screen.findByTestId("at-import-detail")).toBeInTheDocument());
  },
};

// an-import-finishes-whether-anyone-watches: closing the dialog drops the WINDOW, never the import. There
// is no Cancel — the row carries on and finishes by itself.
export const ClosingTheDialogKeepsTheImportGoing: Story = {
  beforeEach: () => {
    settlementImportScenario.stepMs = 150;
  },
  play: async ({ canvasElement }) => {
    const { canvas, d } = await prepareImport(canvasElement, SHOPEE.id);

    await userEvent.click(d.getByTestId("start-import"));
    await waitFor(() => expect(d.getByTestId("import-keeps-going")).toBeVisible());
    await expect(d.queryByRole("button", { name: /cancel/i })).toBeNull();

    await userEvent.click(d.getByTestId("import-close"));

    // The new upload is on the list, still running…
    const row = await canvas.findByTestId("import-row-950", {}, { timeout: 3000 });
    await waitFor(() => expect(within(row).getByTestId("upload-status-running")).toBeInTheDocument());

    // …and finishes with nobody watching.
    await waitFor(() => expect(within(canvas.getByTestId("import-row-950")).getByTestId("upload-status-done")).toBeInTheDocument(), {
      timeout: 9000,
    });
  },
};

// a-shop-with-no-primary-cs-cannot-import: the shop check refuses the file before it is stored — one
// ERROR line, and no row.
export const AShopWithNoPrimaryCsIsRefused: Story = {
  beforeEach: () => {
    settlementImportScenario.noPrimaryCs.add(SHOPEE.id);
  },
  play: async ({ canvasElement }) => {
    const { canvas, d } = await prepareImport(canvasElement, SHOPEE.id);

    await userEvent.click(d.getByTestId("start-import"));

    await expect(await d.findByTestId("import-failed-reason")).toHaveTextContent("choose a primary CS first");
    await expect(d.queryByTestId("open-imported-file")).toBeNull();

    await userEvent.click(d.getByTestId("import-close"));
    await waitFor(() => expect(canvas.queryByTestId("import-row-950")).toBeNull());
  },
};

// a-file-with-another-shops-orders-is-refused: a file whose orders belong to another shop is stored, then
// refused as a whole — nothing posts, and the row says why.
export const AFileWithAnotherShopsOrdersIsRefused: Story = {
  beforeEach: () => {
    settlementImportScenario.wrongShopFile = true;
  },
  play: async ({ canvasElement }) => {
    const { canvas, d } = await prepareImport(canvasElement, SHOPEE.id);

    await userEvent.click(d.getByTestId("start-import"));

    await expect(await d.findByTestId("import-failed-reason")).toHaveTextContent("belong to Melati Store");
    await userEvent.click(d.getByTestId("import-close"));

    const row = await canvas.findByTestId("import-row-950", {}, { timeout: 3000 });
    await expect(within(row).getByTestId("upload-status-failed")).toBeInTheDocument();
  },
};

// A detail view is a PAGE: a row opens the file's own page.
export const ARowOpensTheFilesPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`import-row-${done!.id}`));
    await waitFor(async () => expect(await canvas.findByTestId("at-import-detail")).toBeInTheDocument());
  },
};

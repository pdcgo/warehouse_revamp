import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { withTheAppsFocusRule } from "../../../../.storybook/appFocusRule";
import { noAccountForStory, noOperationalAccountForStory } from "../../../../.storybook/financialAccountStub";
import { asRole } from "../../../../.storybook/sessionScenario";
import { noSuppliersForStory } from "../../../../.storybook/supplierStub";
import { financialAccountClient, supplierClient } from "../../../api/clients";
import {
  FinancialAccountProvider,
  FinancialAccountType,
} from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { BERAS, type Canvas, FORM_META, loaded, pickProducts } from "./kit";

// RESTOCK FORM — the helpers that point to what is missing (docs/business/inventory/restock_decision.md):
//   the-supplier-popup-points-to-create-supplier-when-none-exists  the popup links to Create Supplier — only when no
//                                                                  team has a supplier (selling:all, CS included)
//   the-account-box-points-to-the-accounts-page                    no operational account: the owner and admin get a
//                                                                  link to Financial Accounts, CS whom to ask
//   a-helper-link-opens-a-new-tab                                  each in a NEW TAB; back on this tab, the picker reads
//                                                                  its list again, every typed line kept
// Acceptance: docs/acceptances/inventory/restock.md givens 15–19.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Helpers",
  ...FORM_META,
  // What a return to the tab re-reads is the point here — so the app's own focus rule, not TanStack's default.
  decorators: [withTheAppsFocusRule],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ALL = "restock-all-supplier-picker";
const BCA_OPS = 1301n; // Toko Melati's — operational in the fixtures

/** Back on the form's tab: the browser fires `visibilitychange` at the document — TanStack's window-focus event. */
const comeBack = () => document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

/** A beat for a request that should NOT go out — an absence passes trivially before anything could have been asked. */
const aBeat = () => new Promise((resolve) => setTimeout(resolve, 300));

// What the form asked, recorded from a story's beforeEach (each spy passes the call through to the stub).
let supplierReads = 0;
/** One entry per FinancialAccountList — `true` for the operational-only feed, `false` for every account. */
let accountReads: boolean[] = [];

function recordReads() {
  supplierReads = 0;
  accountReads = [];
  const supplierList = supplierClient.supplierList.bind(supplierClient);
  const accountList = financialAccountClient.financialAccountList.bind(financialAccountClient);
  const s = spyOn(supplierClient, "supplierList").mockImplementation(async (req, options) => {
    supplierReads += 1;
    return supplierList(req, options);
  });
  const a = spyOn(financialAccountClient, "financialAccountList").mockImplementation(async (req, options) => {
    accountReads.push(req.filter?.operationalOnly === true);
    return accountList(req, options);
  });

  return () => {
    s.mockRestore();
    a.mockRestore();
  };
}

/** A line typed in — Beras, 7 pieces for Rp 70.000 — to prove it is still there after a trip to another tab. */
async function typeALine(canvas: Canvas) {
  await pickProducts(canvas, [BERAS]);
  const qty = canvas.getByTestId("restock-qty-0");
  await userEvent.clear(qty);
  await userEvent.type(qty, "7", { delay: 40 });
  await userEvent.type(canvas.getByTestId("restock-total-price-0"), "70000", { delay: 20 });
  await waitFor(() => expect(canvas.getByTestId("restock-qty-0")).toHaveValue("7"));
}

async function expectTheLineKept(canvas: Canvas) {
  await expect(canvas.getByTestId("restock-line-0")).toHaveTextContent("Beras Pandan Wangi 5kg");
  await expect(canvas.getByTestId("restock-qty-0")).toHaveValue("7");
  await expect(canvas.getByTestId("restock-total-price-0")).toHaveValue("70.000");
}

async function expectANewTabLink(link: HTMLElement, href: string) {
  await expect(link).toHaveAttribute("href", href);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
}

async function openAllSupplier(canvas: Canvas) {
  await userEvent.click(canvas.getByTestId(`${ALL}-trigger`));
  const dialog = await screen.findByTestId(`${ALL}-dialog`, {}, { timeout: 4000 });
  await waitFor(() => expect(dialog).toBeVisible());

  return within(dialog);
}

// ── The supplier popup (given 15, 16) ───────────────────────────────────────────────────────────────

// NO SUPPLIER IN ANY TEAM — the popup has nothing to list, so it says so and links to the suppliers page (where Tambah
// Pemasok is), in a new tab. A search with no match is not that: the helper goes while a search is typed.
export const NoSupplierAnywhereLinksToCreateSupplier: Story = {
  name: "Supplier · none anywhere → Create Supplier",
  beforeEach: () => noSuppliersForStory(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const dialog = await openAllSupplier(canvas);

    await waitFor(() => expect(dialog.getByTestId(`${ALL}-empty`)).toHaveTextContent("No suppliers yet."), {
      timeout: 4000,
    });
    const link = dialog.getByTestId(`${ALL}-create-supplier`);
    await expectANewTabLink(link, "/inventories/suppliers");
    await expect(link).toHaveAccessibleName("Create Supplier, opens in a new tab");
    await expect(dialog.getByTestId(`${ALL}-create-supplier-help`)).toHaveTextContent("listed here when you come back");

    await userEvent.type(dialog.getByTestId(`${ALL}-search`), "zzz", { delay: 20 });
    await waitFor(() => expect(dialog.getByTestId(`${ALL}-empty`)).toHaveTextContent("No supplier matches this search."), {
      timeout: 4000,
    });
    await expect(dialog.queryByTestId(`${ALL}-create-supplier`)).toBeNull();
  },
};

// …for CS too: the acceptance row is the selling team's whole (selling:all), as the decision noted.
export const CsGetsTheCreateSupplierLinkToo: Story = {
  name: "Supplier · none anywhere, as CS → the link too",
  beforeEach: () => {
    asRole(Role.SELLING_CS)();
    noSuppliersForStory();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const dialog = await openAllSupplier(canvas);

    const link = await dialog.findByTestId(`${ALL}-create-supplier`, {}, { timeout: 4000 });
    await expectANewTabLink(link, "/inventories/suppliers");
  },
};

// NONE OF ITS OWN, OTHER TEAMS' THERE (given 16) — the popup lists them, and there is no helper: the line picks one of
// theirs. Nothing in the list is the team's own.
export const OtherTeamsSuppliersNoHelper: Story = {
  name: "Supplier · none of its own → other teams', no helper",
  beforeEach: () => noSuppliersForStory(12n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const dialog = await openAllSupplier(canvas);

    const list = await dialog.findByTestId(`${ALL}-suppliers`, {}, { timeout: 4000 });
    await expect(within(list).getAllByTestId(/^restock-all-supplier-picker-supplier-\d+$/).length).toBeGreaterThan(0);
    await expect(within(list).queryByText("Your team")).toBeNull();
    await expect(dialog.queryByTestId(`${ALL}-empty`)).toBeNull();
    await expect(dialog.queryByTestId(`${ALL}-create-supplier`)).toBeNull();
  },
};

// BACK FROM THE SUPPLIERS TAB (given 15, a-helper-link-opens-a-new-tab) — a supplier is made in the other tab while the
// popup waits; coming back, the popup asks for its list again and the new one is there to connect. The line typed
// before the trip is exactly as it was.
export const BackFromCreateSupplierTheNewOneIsListed: Story = {
  name: "Supplier · back from the new tab → listed, line kept",
  beforeEach: () => {
    noSuppliersForStory();
    return recordReads();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    await typeALine(canvas);

    // The line's own popup has the helper as well.
    await userEvent.click(canvas.getByTestId("restock-line-0-picker-trigger"));
    const dialog = within(await screen.findByTestId("restock-line-0-picker-dialog", {}, { timeout: 4000 }));
    await dialog.findByTestId("restock-line-0-picker-create-supplier", {}, { timeout: 4000 });
    const asked = supplierReads;

    // …in the other tab: Tambah Pemasok.
    const made = await supplierClient.supplierCreate({ teamId: 12n, name: "Toko Bahan Baru", contact: "", address: "", description: "" });
    const id = made.supplier!.id;

    comeBack();
    await waitFor(() => expect(supplierReads).toBe(asked + 1), { timeout: 4000 });
    await userEvent.click(await dialog.findByTestId(`restock-line-0-picker-supplier-${id}`, {}, { timeout: 4000 }));
    await expect(dialog.queryByTestId("restock-line-0-picker-create-supplier")).toBeNull();
    // A stall: no store, so "no store" is chosen for it.
    await waitFor(() => expect(dialog.getByTestId("restock-line-0-picker-confirm")).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(dialog.getByTestId("restock-line-0-picker-confirm"));

    await waitFor(() => expect(canvas.getByTestId("restock-line-0-supplier-shown")).toHaveTextContent("Toko Bahan Baru"), {
      timeout: 4000,
    });
    await expectTheLineKept(canvas);
  },
};

// A POPUP WITH SUPPLIERS NEVER RE-READS ON A TAB SWITCH — the re-read is for an empty list only; otherwise the app keeps
// its no-refetch-on-focus rule (HARD RULE 10).
export const ASupplierListDoesNotRereadOnReturn: Story = {
  name: "Supplier · something listed → no re-read on return",
  beforeEach: recordReads,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const dialog = await openAllSupplier(canvas);
    await dialog.findByTestId(`${ALL}-suppliers`, {}, { timeout: 4000 });
    await waitFor(() => expect(supplierReads).toBe(1));

    comeBack();
    await aBeat();
    await expect(supplierReads).toBe(1);
  },
};

// ── The account box (given 17, 18, 19) ──────────────────────────────────────────────────────────────

// NO ACCOUNT AT ALL, AS THE OWNER (given 17) — the box says it short, and under it: create one and mark it operational,
// with Financial Accounts in a new tab.
export const OwnerWithNoAccountIsToldToCreateOne: Story = {
  name: "Account · none, as owner → create one",
  beforeEach: () => noAccountForStory(12n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    const help = await canvas.findByTestId("restock-finance-account-missing", {}, { timeout: 4000 });
    await expect(help).toHaveAttribute("data-case", "none");
    await expect(canvas.getByTestId("restock-finance-account-missing-text")).toHaveTextContent(
      "No account yet — create one and mark it operational.",
    );
    await expect(canvas.getByTestId("restock-finance-account")).toHaveTextContent("No operational account");
    const link = canvas.getByTestId("restock-finance-account-open");
    await expectANewTabLink(link, "/financial-accounts");
    await expect(link).toHaveAccessibleName("Open Financial Accounts, opens in a new tab");
  },
};

// ACCOUNTS, NONE MARKED, AS THE ADMIN (given 18) — mark one, with the same link.
export const AdminWithNoneMarkedIsToldToMarkOne: Story = {
  name: "Account · none marked, as admin → mark one",
  beforeEach: () => {
    asRole(Role.SELLING_ADMIN)();
    noOperationalAccountForStory(12n);
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    const help = await canvas.findByTestId("restock-finance-account-missing", {}, { timeout: 4000 });
    await expect(help).toHaveAttribute("data-case", "unmarked");
    await expect(canvas.getByTestId("restock-finance-account-missing-text")).toHaveTextContent(
      "No account marked operational — mark one.",
    );
    await expectANewTabLink(canvas.getByTestId("restock-finance-account-open"), "/financial-accounts");
  },
};

// CS (given 19) — told to ask the owner or admin, and NO link: making and marking an account is admin and up. Nor is the
// second read (every account) ever asked for CS — which of the two is missing is not CS's to fix.
export const CsIsToldToAskWithNoLink: Story = {
  name: "Account · none marked, as CS → ask, no link",
  beforeEach: () => {
    asRole(Role.SELLING_CS)();
    noOperationalAccountForStory(12n);
    return recordReads();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    const help = await canvas.findByTestId("restock-finance-account-missing", {}, { timeout: 4000 });
    await expect(help).toHaveAttribute("data-case", "ask");
    await expect(canvas.getByTestId("restock-finance-account-missing-text")).toHaveTextContent(
      "Ask your owner or admin to set up an operational account.",
    );
    await expect(canvas.queryByTestId("restock-finance-account-open")).toBeNull();
    await aBeat();
    await expect(accountReads).toEqual([true]);
  },
};

// AN ACCOUNT TO PICK — no helper, and nothing more asked than the picker's own feed; a trip to another tab asks nothing.
export const AnAccountToPickShowsNoHelper: Story = {
  name: "Account · one to pick → no helper, no more reads",
  beforeEach: recordReads,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    // Two operational accounts in the fixtures: the list is open to pick from.
    await userEvent.click(canvas.getByTestId("restock-finance-account"));
    const option = await canvas.findByTestId(`restock-finance-account-option-${BCA_OPS}`, {}, { timeout: 4000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.keyboard("{Escape}");

    comeBack();
    await aBeat();
    await expect(canvas.queryByTestId("restock-finance-account-missing")).toBeNull();
    await expect(accountReads).toEqual([true]);
  },
};

// BACK FROM ACCOUNTS, ONE MARKED THERE (given 18) — the admin marks BCA Operasional in the other tab; coming back, the
// picker reads its accounts again and, the one operational account, picks it. The helper goes; the line is as typed.
export const BackFromAccountsTheMarkedOneIsPicked: Story = {
  name: "Account · back from the new tab → the marked one picked",
  beforeEach: () => {
    asRole(Role.SELLING_ADMIN)();
    noOperationalAccountForStory(12n);
    return recordReads();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    await typeALine(canvas);
    await canvas.findByTestId("restock-finance-account-open", {}, { timeout: 4000 });

    // …in the other tab: Tandai Operasional.
    await financialAccountClient.financialAccountOperationalSet({ teamId: 12n, accountId: BCA_OPS, operational: true });
    comeBack();

    await waitFor(() => expect(canvas.getByTestId("restock-finance-account")).toHaveTextContent("BCA Operasional"), {
      timeout: 4000,
    });
    await expect(canvas.queryByTestId("restock-finance-account-missing")).toBeNull();
    await expectTheLineKept(canvas);
  },
};

// BACK FROM ACCOUNTS, MADE BUT NOT MARKED, THEN MARKED (given 17) — the owner makes an account in the other tab and comes
// back before marking it: the box now says *mark one*. Marked and back again, it is picked; the line is as typed.
export const BackFromAccountsANewOneIsPicked: Story = {
  name: "Account · back twice → create, then mark, then picked",
  beforeEach: () => {
    noAccountForStory(12n);
    return recordReads();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    await typeALine(canvas);
    const help = await canvas.findByTestId("restock-finance-account-missing", {}, { timeout: 4000 });
    await waitFor(() => expect(help).toHaveAttribute("data-case", "none"));

    // …in the other tab: Tambah Akun, not marked yet.
    const made = await financialAccountClient.financialAccountCreate({
      teamId: 12n,
      type: FinancialAccountType.BANK_ACCOUNT,
      provider: FinancialAccountProvider.BCA,
      accountNumber: "5550001442",
      name: "BCA Belanja Baru",
      holderName: "PT Melati Sejahtera",
      description: "",
      openingBalance: 0,
      openingOn: "2026-01-02",
    });
    comeBack();
    await waitFor(
      () => expect(canvas.getByTestId("restock-finance-account-missing")).toHaveAttribute("data-case", "unmarked"),
      { timeout: 4000 },
    );

    // …and then marked.
    await financialAccountClient.financialAccountOperationalSet({ teamId: 12n, accountId: made.account!.id, operational: true });
    comeBack();
    await waitFor(() => expect(canvas.getByTestId("restock-finance-account")).toHaveTextContent("BCA Belanja Baru"), {
      timeout: 4000,
    });
    await expect(canvas.queryByTestId("restock-finance-account-missing")).toBeNull();
    await expectTheLineKept(canvas);
  },
};

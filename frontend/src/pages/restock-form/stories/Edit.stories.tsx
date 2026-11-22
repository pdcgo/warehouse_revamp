import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@chakra-ui/react";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { resetRestockStub } from "../../../../.storybook/restockStub";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { restockClient } from "../../../api/clients";
import { RestockFormPage } from "../index";
import {
  ARRIVED,
  BERAS,
  CAHAYA,
  CAHAYA_STORE,
  EditAccepted,
  EditArrived,
  EditOngoing,
  FORM_META,
  loaded,
  ONGOING,
  pickProducts,
} from "./kit";

// RESTOCK FORM — an edit, by status and by team — on a phone, by another team, arrived (the lines stay open, a line
// may be added with a note), and accepted (not editable).
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Edit",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 502 holds BOTH of the products on team 12's restocks, so its picker has nothing new to add. For the add-a-line
 * rule, this beforeEach takes Beras off 502 for one story — so it can come back as a product found in the box — and
 * puts it back after.
 */
function arrivedWithoutBeras() {
  const saved = ARRIVED.items;
  ARRIVED.items = saved.filter((l) => l.productId !== BERAS);
  resetRestockStub();

  return () => {
    ARRIVED.items = saved;
    resetRestockStub();
  };
}

// …and an ongoing restock on a phone, its lines filled.
export const MobileEdit: Story = {
  name: "Phone · an edit",
  globals: { viewport: { value: "mobile1" } },
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("restock-line-0")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

// The warehouse can READ the restock, so its detail call succeeds — but only the raising team edits it.
export const NotTheRaisingTeam: Story = {
  name: "Not the raising team",
  render: () => <EditOngoing />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-not-editable");

    await expect(canvas.getByTestId("restock-not-editable-reason")).toHaveTextContent("Only the team that raised");
    await expect(canvas.queryByTestId("submit-restock")).toBeNull();
  },
};

// the-lines-stay-editable-until-accepted: while ARRIVED the payment and the parcel are closed — and say why — while
// each line's count, total and note stay open, and no stored line can be removed or re-connected.
export const ArrivedClosesTheHeaderAndKeepsTheLines: Story = {
  name: "Arrived · lines only",
  render: () => <EditArrived />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(canvas.getByTestId("restock-arrived-banner")).toBeVisible();
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeInTheDocument();
    await expect(canvas.getByTestId("restock-header-locked")).toBeVisible();

    await expect(canvas.getByTestId("restock-finance-account")).toBeDisabled();
    await expect(canvas.getByTestId("restock-invoice-ref")).toBeDisabled();
    await expect(canvas.getByTestId("restock-receipt")).toBeDisabled();
    await expect(canvas.getByTestId("restock-shipping-cost")).toBeDisabled();
    await expect(canvas.getByTestId("restock-note")).toBeDisabled();
    await expect(within(canvas.getByTestId("restock-courier")).getByRole("combobox")).toBeDisabled();
    await expect(canvas.getByTestId("order-receipt-pick")).toBeDisabled();

    // The lines stay open …
    await expect(canvas.getByTestId("restock-qty-0")).toBeEnabled();
    await expect(canvas.getByTestId("restock-total-price-0")).toBeEnabled();
    await expect(canvas.getByTestId("restock-line-0-note")).toBeEnabled();
    await expect(canvas.getByTestId("restock-line-0-note")).toHaveValue("extra stock — 2 bonus dari supplier");

    // … but none can be removed, and none re-connected (lines-can-be-added-not-removed-while-arrived).
    await expect(canvas.queryByTestId("restock-remove-0")).toBeNull();
    await expect(canvas.queryByTestId("restock-remove-1")).toBeNull();
    await expect(canvas.queryByTestId("restock-line-0-picker-trigger")).toBeNull();
    await expect(canvas.queryByTestId("restock-line-0-supplier-clear")).toBeNull();

    // No supplier for all while the box is at the door — the stored lines' suppliers are closed
    // (the-supplier-leads-the-produk-card).
    await expect(canvas.queryByTestId("restock-all-supplier")).toBeNull();
  },
};

// lines-can-be-added-not-removed-while-arrived: a product found in the box can be ADDED — with a note — and that new
// line, never saved, can still be dropped; the stored one cannot. a-line-added-after-arrival-names-its-supplier: the
// added line may connect where it was bought, while the stored line's supplier stays closed.
export const ArrivedAddsALineOnlyWithANote: Story = {
  name: "Arrived · add with a note",
  render: () => <EditArrived />,
  beforeEach: arrivedWithoutBeras,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    await canvas.findByTestId("restock-line-0");

    await pickProducts(canvas, [BERAS]);

    const added = await canvas.findByTestId("restock-line-1");
    await expect(within(added).getByTestId("restock-line-1-added")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-remove-0")).toBeNull();
    await expect(canvas.getByTestId("restock-remove-1")).toBeInTheDocument();

    // The added line can say where it came from; the stored one cannot be re-connected.
    await expect(canvas.queryByTestId("restock-line-0-picker-trigger")).toBeNull();
    await userEvent.click(canvas.getByTestId("restock-line-1-picker-trigger"));
    const dialog = within(await screen.findByTestId("restock-line-1-picker-dialog"));
    await userEvent.type(dialog.getByTestId("restock-line-1-picker-search"), "Cahaya", { delay: 20 });
    await userEvent.click(await dialog.findByTestId(`restock-line-1-picker-supplier-${CAHAYA.id}`, {}, { timeout: 4000 }));
    await userEvent.click(await dialog.findByTestId(`restock-line-1-picker-store-${CAHAYA_STORE}`, {}, { timeout: 4000 }));
    await userEvent.click(dialog.getByTestId("restock-line-1-picker-confirm"));
    await waitFor(() => expect(canvas.getByTestId("restock-line-1-supplier-shown")).toHaveTextContent("Cahaya Abadi"));

    // Its total, which every product carries (the-count-and-total-are-required) …
    await userEvent.type(canvas.getByTestId("restock-total-price-1"), "65000", { delay: 20 });

    // … but no note, no save.
    await expect(canvas.getByTestId("submit-restock")).toBeDisabled();
    await waitFor(() => expect(canvas.getByTestId("restock-form-missing-newLineNote")).toBeInTheDocument());

    await userEvent.type(canvas.getByTestId("restock-line-1-note"), "ada di dalam paket", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("submit-restock")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("submit-restock"));
    // Reached by a link (no screen opened it), so the save lands on the list (a-form-returns-where-it-was-opened).
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// a-restock-is-edited-only-while-ongoing: an accepted restock opens as "cannot be edited", not as a form the server
// would refuse.
export const AnAcceptedRestockIsNotEditable: Story = {
  name: "Accepted · not editable",
  render: () => <EditAccepted />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-not-editable");

    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ACCEPTED}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId("submit-restock")).toBeNull();

    // Reached by a link, so back is the list (a-form-returns-where-it-was-opened).
    await userEvent.click(canvas.getByTestId("restock-not-editable-back"));
    await canvas.findByTestId("at-restock-list");
  },
};

// ── A re-read under the open form (#122) ────────────────────────────────────────────────────────

// A story-only control standing in for "something made the restock stale" — another write invalidates `restock`, and
// the restock answers again under the open form.
function StoryReread() {
  const client = useQueryClient();

  return (
    <Button size="xs" mt="4" data-testid="story-reread" onClick={() => void client.invalidateQueries({ queryKey: ["restock"] })}>
      Read the restock again
    </Button>
  );
}

const EditOngoingWithReread = routedPage(
  [
    {
      path: "/inventories/restock/:requestId/edit",
      element: (
        <>
          <RestockFormPage key="edit" />
          <StoryReread />
        </>
      ),
    },
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock", "at-restock-list"),
  ],
  `/inventories/restock/${ONGOING.id}/edit`,
);

let detailAnswers = 0;

/**
 * A RE-READ NEVER OVERWRITES WHAT IS BEING TYPED — the draft is seeded ONCE per restock. The restock answers again,
 * changed meanwhile (its note rewritten elsewhere), and the note and the order id being typed stay exactly as typed.
 */
export const ARereadKeepsWhatWasTyped: Story = {
  name: "A re-read of the restock keeps what was typed",
  beforeEach: () => {
    detailAnswers = 0;
    const real = restockClient.restockRequestDetail.bind(restockClient);
    const spy = spyOn(restockClient, "restockRequestDetail").mockImplementation(async (req, options) => {
      const res = await real(req, options);
      detailAnswers += 1;
      if (detailAnswers === 1 || !res.request) return res;

      return { ...res, request: { ...res.request, note: "Rewritten elsewhere", invoiceRefId: "INV-ELSEWHERE" } };
    });

    return () => spy.mockRestore();
  },
  render: () => <EditOngoingWithReread />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    await waitFor(() => expect(canvas.getByTestId("restock-line-0")).toBeVisible(), { timeout: 5000 });

    const note = canvas.getByTestId("restock-note");
    await userEvent.clear(note);
    await userEvent.type(note, "Diketik sendiri", { delay: 30 });
    const invoice = canvas.getByTestId("restock-invoice-ref");
    await userEvent.clear(invoice);
    await userEvent.type(invoice, "INV-77", { delay: 30 });

    await userEvent.click(canvas.getByTestId("story-reread"));
    await waitFor(() => expect(detailAnswers).toBe(2));
    // The answer is in: give it a render to land on the form.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(canvas.getByTestId("restock-note")).toHaveValue("Diketik sendiri");
    await expect(canvas.getByTestId("restock-invoice-ref")).toHaveValue("INV-77");
  },
};

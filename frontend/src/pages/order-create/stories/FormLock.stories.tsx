import { useMemo } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { RouterProvider, createMemoryRouter, useParams } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products, shops } from "../../../../.storybook/fixtures";
import { orderKeyScenario } from "../../../../.storybook/sessionScenario";
import { duplicateRefScenario } from "../../../../.storybook/duplicateRefStub";
import {
  orderAnswerScenario,
  releaseSlowAnswer,
  withOrderAnswers,
} from "../../../../.storybook/orderAnswerStub";
import { todayDateInput } from "../../../lib/datetime";
import { OrderCreatePage } from "../index";

// THE ORDER FORM'S LOCK AND TRY AGAIN (backlog #10 slice 2) — the-form-locks-until-it-is-answered,
// no-answer-is-only-a-lost-connection, every-submit-mints-a-new-key, a-try-again-always-warns.
//
// After Create the form waits LOCKED for the answer, with no time limit. The order opens it; anything the SERVER sends
// (Internal included) gives the form back as typed; a dropped connection — no reply at all — keeps it locked on what was
// sent and offers Try Again, which re-checks the shop + ref, always warns, and resends under a NEW key.
//
// The answers are scripted by `.storybook/orderAnswerStub.ts` (`withOrderAnswers`): `slow` holds the request until the
// story releases it, `serverError` is the server's Internal, `lost` drops the connection before the server sees it, and
// `lostAfterPlacing` places the order and THEN loses the reply — so Try Again's lookup finds it.
//
// Its own file (the page's other stories are Pages/Order/OrderCreate), with the same cut-down router: `useBlocker` needs
// a data router. New orders run as the first membership, Gudang Pusat (11), like the page's other new-order stories.

const routes = [
  { path: "/order-create", element: <OrderCreatePage /> },
  { path: "/orders", element: <Text data-testid="at-orders">Orders</Text> },
  { path: "/orders/:orderId", element: <OrderDetailMarker /> },
];

function OrderDetailMarker() {
  const { orderId } = useParams();

  return (
    <Text data-testid="at-order-detail" data-order={orderId}>
      Order detail
    </Text>
  );
}

function RoutedOrderCreate() {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: ["/order-create"] }), []);

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/Order/OrderCreate/FormLock",
  component: OrderCreatePage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  render: () => <RoutedOrderCreate />,
} satisfies Meta<typeof OrderCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REF = "SP-LOCK-0001";

// ── Filling the smallest placeable order (as the page's own stories do) ─────────────────────────────────────────────

async function pickProduct(canvasElement: HTMLElement, productId: bigint) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-add-line"));
  const option = await screen.findByTestId(`product-picker-option-${productId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
}

async function pickOrderDate(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-order-date"));
  const content = await screen.findByTestId("order-create-order-date-content");
  await waitFor(() => expect(content).toBeVisible());
  const today = content.querySelector<HTMLElement>(`[data-part="table-cell-trigger"][data-value="${todayDateInput()}"]`);
  await userEvent.click(today!);
  await userEvent.keyboard("{Escape}");
}

// THE COURIER — required to place (no-order-without-a-courier, the-courier-required-look-is-accepted).
async function pickCourier(canvasElement: HTMLElement) {
  await userEvent.click(within(within(canvasElement).getByTestId("shipment-channel-select")).getByRole("combobox"));
  const option = await screen.findByTestId("shipment-channel-option-jne");
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

async function fillPlaceableOrder(canvasElement: HTMLElement, ref = REF) {
  const canvas = within(canvasElement);

  await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

  await userEvent.click(canvas.getByTestId("shop-select"));
  const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
  await waitFor(() => expect(shop).toBeVisible());
  await userEvent.click(shop);
  await pickCourier(canvasElement);

  await pickProduct(canvasElement, products[0]!.id);
  await pickOrderDate(canvasElement);
  await userEvent.type(canvas.getByTestId("order-marketplace-total"), "50000", { delay: 10 });
  await userEvent.click(canvas.getByTestId("order-external-ref-id"));
  await userEvent.paste(ref);

  const create = canvas.getByTestId("order-create-save");
  await waitFor(() => expect(create).toBeEnabled());

  return create;
}

// A thin margin asks first — passed here, because these stories are about the answer.
async function passTheChecks() {
  const checks = await screen.findByTestId("order-checks-dialog", {}, { timeout: 800 }).catch(() => null);
  if (checks) await userEvent.click(within(checks).getByTestId("order-checks-place"));
}

/** Create pressed and past the checks — the request is on its way. */
async function create(canvasElement: HTMLElement) {
  await userEvent.click(await fillPlaceableOrder(canvasElement));
  await passTheChecks();
}

async function noAnswer(canvasElement: HTMLElement) {
  const panel = await within(canvasElement).findByTestId("order-create-no-answer", {}, { timeout: 4000 });
  await waitFor(() => expect(panel).toBeVisible());

  return panel;
}

async function tryAgainWarning(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByTestId("order-create-try-again"));

  const dialog = await screen.findByTestId("duplicate-ref-dialog", {}, { timeout: 4000 });
  await waitFor(() => expect(dialog).toBeVisible());

  return dialog;
}

/** Every control the person types or picks with is off — the fieldset, and a sample of what is inside it. */
async function expectLocked(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await expect(canvas.getByTestId("order-create-lock")).toHaveAttribute("data-locked");
  await expect(canvas.getByTestId("order-create-lock")).toBeDisabled();
  await expect(canvas.getByTestId("order-create-customer-name")).toBeDisabled();
  await expect(canvas.getByTestId("order-external-ref-id")).toBeDisabled();
  await expect(canvas.getByTestId("order-marketplace-total")).toBeDisabled();
  await expect(canvas.getByTestId("order-create-add-line")).toBeDisabled();
  await expect(canvas.getByTestId("order-create-note")).toBeDisabled();
  await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
}

/** The form is the person's again — and still holds what was typed. */
async function expectUnlockedAsTyped(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await waitFor(() => expect(canvas.getByTestId("order-create-lock")).not.toHaveAttribute("data-locked"));
  await expect(canvas.getByTestId("order-create-customer-name")).toBeEnabled();
  await expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Ani");
  await expect(canvas.getByTestId("order-external-ref-id")).toHaveValue(REF);
  await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
  await expect(canvas.getByTestId("order-create-save")).toBeEnabled();
}

// ── The stories ─────────────────────────────────────────────────────────────────────────────────────────────────────

// LOCKED WHILE WAITING — every input, line and picker off, the cards faded, Create spinning with "Placing order…", and
// the banner at the top. A slow server is NOT no answer (no time limit): still locked after a wait. Leaving asks — the
// order may still be placed — and staying keeps the lock. When the answer comes, the order opens.
export const LockedWhileWaiting: Story = {
  name: "Locked while waiting",
  beforeEach: withOrderAnswers("slow"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await create(canvasElement);

    const save = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(save).toHaveTextContent("Placing order…"));
    await expect(canvas.getByTestId("order-create-waiting")).toHaveTextContent("the form is locked");
    await expectLocked(canvasElement);

    // No time limit: a slow answer keeps the lock and never turns into "no answer".
    await new Promise((r) => setTimeout(r, 1200));
    await expect(canvas.queryByTestId("order-create-no-answer")).toBeNull();
    await expectLocked(canvasElement);

    // Leaving is guarded with the lock's own question — and staying keeps it.
    await userEvent.click(canvas.getByTestId("order-create-back"));
    const title = await screen.findByText("Leave Before the Answer?", {}, { timeout: 3000 });
    await expect(await screen.findByText(/it may still be placed/)).toBeVisible();
    await expect(title).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Leave Before the Answer?")).toBeNull());
    await expect(screen.queryByTestId("at-orders")).toBeNull();
    await expectLocked(canvasElement);

    // The answer comes: the order opens, with no discard question.
    releaseSlowAnswer();
    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toHaveAttribute("data-order", "900"), {
      timeout: 4000,
    });
    await expect(orderAnswerScenario.keys).toHaveLength(1);
  },
};

// A SERVER ERROR IS AN ANSWER — even Internal: the form unlocks exactly as typed, the error shows as it always did, and
// there is no Try Again panel. The next Create is an ordinary submit.
export const AServerErrorUnlocksAndKeepsTheForm: Story = {
  name: "Server error unlocks",
  beforeEach: withOrderAnswers("serverError"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await create(canvasElement);

    // The server's Internal, shown as every Internal is (rpcError's sentence for it).
    await expect(await canvas.findByTestId("order-create-error", {}, { timeout: 4000 })).toHaveTextContent(
      "Something went wrong on the server",
    );
    await expectUnlockedAsTyped(canvasElement);
    await expect(canvas.queryByTestId("order-create-no-answer")).toBeNull();
    await expect(canvas.queryByTestId("order-create-waiting")).toBeNull();
    await expect(canvas.getByTestId("order-create-save")).toHaveTextContent("Create Order");
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// A LOST CONNECTION IS NO ANSWER — the form stays locked on what was sent, and the panel says the order may or may not
// have been placed: Try Again, and the quieter link to the orders list (a new tab, so the form survives the look). No
// error sentence, nothing navigates, and nothing is resent by itself.
export const ALostConnectionShowsNoAnswer: Story = {
  name: "No answer",
  beforeEach: withOrderAnswers("lost"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await create(canvasElement);

    const panel = await noAnswer(canvasElement);
    await expect(within(panel).getByTestId("order-create-no-answer-title")).toHaveTextContent(
      "No answer from the server — the order may or may not have been placed.",
    );
    await expect(within(panel).getByTestId("order-create-try-again")).toHaveTextContent("Try Again");
    const link = within(panel).getByTestId("order-create-check-orders");
    await expect(link).toHaveTextContent("Check the Orders List");
    await expect(link).toHaveAttribute("href", "/orders");
    await expect(link).toHaveAttribute("target", "_blank");

    await expectLocked(canvasElement);
    await expect(canvas.getByTestId("order-create-customer-name")).toHaveValue("Bu Ani");
    await expect(canvas.getByTestId("order-create-save")).not.toHaveTextContent("Placing order…");
    await expect(canvas.queryByTestId("order-create-waiting")).toBeNull();
    await expect(canvas.queryByTestId("order-create-error")).toBeNull();
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();

    // Never resent by itself.
    await new Promise((r) => setTimeout(r, 500));
    await expect(orderAnswerScenario.keys).toHaveLength(1);
    await expect(orderKeyScenario.sent).toHaveLength(0);
  },
};

// TRY AGAIN SENDS A NEW KEY — the first Create never reached the server, so the re-check finds nothing yet: the warning
// still opens (a-try-again-always-warns), saying the last Create may still be finishing, with Send Again. The resend is
// the FROZEN order under a key of its own.
export const TryAgainSendsANewKey: Story = {
  name: "Try Again, new key",
  beforeEach: withOrderAnswers("lost"),
  play: async ({ canvasElement }) => {
    await create(canvasElement);
    await noAnswer(canvasElement);

    const dialog = await tryAgainWarning(canvasElement);
    await expect(dialog).toHaveTextContent("Your Last Create May Still Be Finishing");
    await expect(within(dialog).getByTestId("duplicate-ref-lead")).toHaveAttribute("data-retry", "nothing");
    await expect(within(dialog).getByTestId("duplicate-ref-lead")).toHaveTextContent(REF);
    await expect(within(dialog).getByTestId("duplicate-ref-check-orders")).toHaveAttribute("target", "_blank");
    // The re-check ran on the frozen ref — Create's lookup, then Try Again's.
    await expect(duplicateRefScenario.calls).toEqual([[REF], [REF]]);

    const sendAgain = within(dialog).getByTestId("duplicate-ref-create-anyway");
    await expect(sendAgain).toHaveTextContent("Send Again");
    await userEvent.click(sendAgain);

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toHaveAttribute("data-order", "900"), {
      timeout: 4000,
    });

    const [first, second] = orderAnswerScenario.keys;
    await expect(orderAnswerScenario.keys).toHaveLength(2);
    await expect(first).toMatch(UUID);
    await expect(second).toMatch(UUID);
    await expect(second).not.toEqual(first);
    // Only the second reached the server.
    await expect(orderKeyScenario.sent).toEqual([second]);
  },
};

// TRY AGAIN WARNS ABOUT THE FIRST ORDER — the server placed it and only the reply was lost, so the re-check names it
// (Order #900, a link in a new tab) and says it is most likely that Create. Create Anyway is still the person's call:
// it sends the frozen order again, under a new key.
export const TryAgainWarnsAboutTheFirstOrder: Story = {
  name: "Try Again warns",
  beforeEach: withOrderAnswers("lostAfterPlacing"),
  play: async ({ canvasElement }) => {
    await create(canvasElement);
    await noAnswer(canvasElement);

    const dialog = await tryAgainWarning(canvasElement);
    await expect(dialog).toHaveTextContent("This Ref Is Already Recorded");
    const lead = within(dialog).getByTestId("duplicate-ref-lead");
    await expect(lead).toHaveAttribute("data-retry", "found");
    await expect(lead).toHaveTextContent("most likely by that Create");
    const link = within(dialog).getByTestId("duplicate-ref-order-link-900");
    await expect(link).toHaveTextContent("Order #900");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(within(dialog).getByTestId("duplicate-ref-order-900")).toHaveTextContent("Pending");
    await expect(within(dialog).getByTestId("duplicate-ref-create-anyway")).toHaveTextContent("Create Anyway");

    // Still locked behind the dialog, nothing resent yet.
    await expectLocked(canvasElement);
    await expect(orderAnswerScenario.keys).toHaveLength(1);

    await userEvent.click(within(dialog).getByTestId("duplicate-ref-create-anyway"));
    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument(), { timeout: 4000 });

    // The server saw both: the first (placed, reply lost) and the resend — never the same key.
    await expect(orderKeyScenario.sent).toHaveLength(2);
    await expect(orderKeyScenario.sent[1]).not.toEqual(orderKeyScenario.sent[0]);
  },
};

// GO BACK FROM TRY AGAIN UNLOCKS — the warning's Go Back gives the form back, as it was sent, and nothing is resent.
// (Closing the warning any other way — the X, Escape — keeps the lock and the panel.)
export const GoBackFromTryAgainUnlocks: Story = {
  name: "Go back unlocks",
  beforeEach: withOrderAnswers("lostAfterPlacing"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await create(canvasElement);
    await noAnswer(canvasElement);

    // Escape closes the warning but keeps the lock.
    await tryAgainWarning(canvasElement);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull());
    await expect(canvas.getByTestId("order-create-no-answer")).toBeVisible();
    await expectLocked(canvasElement);

    // Go Back unlocks.
    const dialog = await tryAgainWarning(canvasElement);
    await userEvent.click(within(dialog).getByTestId("duplicate-ref-go-back"));
    await waitFor(() => expect(screen.queryByTestId("duplicate-ref-dialog")).toBeNull());
    await expect(canvas.queryByTestId("order-create-no-answer")).toBeNull();
    await expectUnlockedAsTyped(canvasElement);
    await expect(orderAnswerScenario.keys).toHaveLength(1);
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// ON A PHONE — the no-answer panel inside the screen, Try Again and the orders-list link stacked full width.
export const Phone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  beforeEach: withOrderAnswers("lost"),
  play: async ({ canvasElement }) => {
    await create(canvasElement);
    const panel = await noAnswer(canvasElement);

    const tryAgain = within(panel).getByTestId("order-create-try-again");
    const link = within(panel).getByTestId("order-create-check-orders");
    await expect(tryAgain.getBoundingClientRect().bottom).toBeLessThanOrEqual(link.getBoundingClientRect().top + 1);

    const box = panel.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
    await expect(tryAgain.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    await expectLocked(canvasElement);
  },
};

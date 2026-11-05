import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { At502, At503, At504, SELLING_DETAIL_META, loaded, openTab, trailRows } from "./kit";

// RESTOCK SELLING DETAIL — the header's acts — what each status offers, and Edit Lines, Cancel and Mark Lost as they run.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Actions",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectStatus(canvas: ReturnType<typeof within>, status: RestockRequestStatus) {
  await waitFor(() =>
    expect(within(canvas.getByTestId("restock-detail-status")).getByTestId(`restock-status-${status}`)).toBeVisible(),
  );
}

// The action buttons in the header — `restock-action-<kind>-<id>`.
function actionsIn(canvasElement: HTMLElement): string[] {
  // The page's own — the sticky bar's copy of the same actions carries `-sticky`.
  return [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='restock-action-']")]
    .map((el) => el.dataset.testid ?? "")
    .filter((id) => !id.endsWith("-sticky"));
}

// the-warehouse-signs-and-accepts-the-team-does-the-rest — ongoing: Edit, Cancel, Mark Lost; never the warehouse's acts.
export const OngoingOffersEditCancelMarkLost: Story = {
  name: "Ongoing · edit, cancel, lost",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() =>
      expect(actionsIn(canvasElement).sort()).toEqual(
        ["restock-action-cancel-501", "restock-action-edit-501", "restock-action-mark-lost-501"].sort(),
      ),
    );
  },
};

// the-lines-stay-editable-until-accepted — arrived: Edit Lines only. Cancel and Mark Lost are gone
// (a-restock-is-cancelled-only-while-ongoing, lost-is-set-only-before-the-box-arrives).
export const ArrivedOffersEditLinesOnly: Story = {
  name: "Arrived · edit lines only",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-edit-lines-502"]));
  },
};

// Edit Lines opens the SAME edit route — the form applies the arrived rules.
export const EditLinesOpensTheEditForm: Story = {
  name: "Edit lines",
  render: () => <At502 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-edit-lines-502"));
    await expect(await canvas.findByTestId("at-restock-edit")).toBeInTheDocument();
  },
};

// Accepted, lost and cancelled are records — no actions at all, not disabled ones.
export const ARecordOffersNothing: Story = {
  name: "Accepted · nothing",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

export const LostOffersNothing: Story = {
  name: "Lost · nothing",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

// a-restock-names-its-paying-account — Cancel ASKS whether the money came back, will not run until it is answered, and
// the cancel lands in the trail.
export const CancelAsksAboutTheMoney: Story = {
  name: "Cancel asks about the money",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "timeline");
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(1));

    await userEvent.click(canvas.getByTestId("restock-action-cancel-501"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByTestId("restock-cancel-money")).toBeVisible();
    await expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByTestId("restock-cancel-money-yes"));
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.CANCELLED);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(2));
    const row = trailRows(canvasElement)[1]!;
    await expect(row).toHaveTextContent("money returned");
    await expect(actionsIn(canvasElement)).toEqual([]);
  },
};

// THE CANCEL WARNING IS MARKED (a-restock-cancel-warns-it-will-be-checked) — nothing checks a cancellation yet, so the
// warning carries its ⚠, the first of the page's list.
export const TheCancelWarningIsMarked: Story = {
  name: "Cancel warning, marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await userEvent.click(canvas.getByTestId("restock-action-cancel-501"));
    const review = await screen.findByTestId("restock-cancel-review");
    await waitFor(() => expect(review).toBeVisible());
    await expect(within(review).getByTestId("not-implemented-cancelReview")).toHaveTextContent("1");
  },
};

// lost-is-set-only-before-the-box-arrives — Mark Lost confirms, takes an optional reason, and moves 501 to lost.
export const MarkLostMovesItToLost: Story = {
  name: "Mark lost",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-mark-lost-501"));

    const reason = await screen.findByTestId("restock-lost-reason");
    await waitFor(() => expect(reason).toBeVisible());
    await userEvent.type(reason, "Kurir kehilangan paket", { delay: 20 });
    await userEvent.click(screen.getByTestId("confirm-action"));

    await expectStatus(canvas, RestockRequestStatus.LOST);
    await expect(actionsIn(canvasElement)).toEqual([]);

    await openTab(canvas, "timeline");
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(2));
    await expect(trailRows(canvasElement)[1]).toHaveTextContent("Kurir kehilangan paket");
  },
};

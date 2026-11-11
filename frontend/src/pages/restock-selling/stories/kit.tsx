import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { RestockSellingPage } from "../index";

// WHAT EVERY RESTOCK-SELLING STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// ⚠ PROTOTYPE for implementation_analysis — the restock decisions (docs/business/inventory/restock_decision.md).
//
// Toko Melati's (12) restock list: 501 ongoing, 502 arrived, 503 accepted, 504 lost, 505 cancelled, 507 accepted with a
// deleted store. Each row's ⋯ offers what its status allows; the Value is goods + shipping, never the courier's
// charge at the door.

export const Routed = routedPage(
  [
    { path: "/inventories/restock", element: <RestockSellingPage /> },
    marker("/inventories/restock/new", "at-restock-new"),
    marker("/inventories/restock/:requestId", "at-restock-detail"),
    marker("/inventories/restock/:requestId/edit", "at-restock-edit"),
  ],
  "/inventories/restock",
);

/** Everything in a file's meta but its title. */
export const SELLING_META = {
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
  return canvas;
}

// The items of the row's open menu — portalled, so read off `screen`.
export async function menuOf(canvas: ReturnType<typeof within>, id: number): Promise<string[]> {
  await userEvent.click(canvas.getByTestId(`restock-actions-${id}`));
  const [first] = await screen.findAllByRole("menuitem", {}, { timeout: 2000 });
  await waitFor(() => expect(first).toBeVisible());

  return screen.getAllByRole("menuitem").map((item) => item.dataset.testid ?? "");
}

export async function closeMenu() {
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryAllByRole("menuitem").filter((el) => el.offsetParent !== null)).toHaveLength(0));
}

export const digits = (el: HTMLElement) => Number((el.textContent ?? "").replace(/\D/g, ""));

export async function openStatistics(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("restock-summary-toggle"));
  return canvas.findByTestId("restock-summary", {}, { timeout: 4000 });
}

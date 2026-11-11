import { within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { supplierFixture } from "../../../../.storybook/supplierFixtures";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { SuppliersPage } from "../index";

// WHAT EVERY SUPPLIERS STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` is the Overview, this folder one file per part.
// Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// ⚠ PROTOTYPE for design_accept — the supplier CRUD pass
// (docs/business/supplier/context_clarify.md#proposed-design).
//
// The MANAGE page (manage-and-discover-are-two-pages): a selling team's own suppliers. The stub plays
// supplier_service (supplierStub.ts) — the OWN scope, soft deletes, and a create only a selling team may make.

export const SUMBER = supplierFixture("PT Sumber Makmur");
export const SINAR = supplierFixture("Toko Grosir Sinar");

const SELLING_TEAM = 12n;

export function standingIn(teamId: bigint) {
  return () => {
    asTeam(teamId)();
    asRole(Role.SELLING_OWNER)();
  };
}

/** Everything in a file's meta but its title. */
export const SUPPLIERS_META = {
  component: SuppliersPage,
  parameters: { signedIn: true },
  beforeEach: standingIn(SELLING_TEAM),
};

export async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId(`supplier-row-${SUMBER.id}`, {}, { timeout: 4000 });
  return canvas;
}

export const BANYAK = supplierFixture("PT Banyak Toko");

// The supplier ids on the page, in id order — what one SupplierGoods call must have asked for.
export const rowIds = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("suppliers-table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.getAttribute("data-testid")!.replace("supplier-row-", ""))
    .sort();

export const rowNames = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("suppliers-table"))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td p")?.textContent ?? "");

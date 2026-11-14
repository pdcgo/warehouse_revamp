import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// A PICKER IS USED ONLY ONCE ITS LIST HAS LANDED.
//
// TeamSelect and ShopSelect (like ShippingSelect, SupplierSelect …) remount ONCE, the moment their list arrives —
// load-bearing, see components/teams/TeamSelect.tsx: Zag derives a prefilled value's text only when it initialises.
// The remount starts the field over from its value: a code typed before the list landed is DROPPED and a list opened
// before it CLOSES — its options stay in the DOM, hidden, and the next click waits out the test. Seen in the 3-worker
// run of 2026-11-14: on restock_selling_wants_to_edit's moved restock, TeamList answered 388 ms after the edit form
// mounted, after the spec had typed the code, and the field went back to the old warehouse's name. Held back on
// purpose (a probe routing TeamList / ShopList 2 s late) it fails every time.
//
// A closed list keeps its items in the DOM, and they are drawn only once the list has landed (a spinner or nothing
// before) — in the same render that remounts the field. So an option being ATTACHED means the remount is behind us.
export async function listLanded(options: Locator): Promise<void> {
  await expect(options.first()).toBeAttached();
}

// Pick a team by its code in a TeamSelect (`field` holds it): type the code once the list has landed, then click the
// option that SHOWS — a form with two TeamSelects (a transfer's From and To) carries every option twice.
export async function pickTeam(page: Page, field: Locator, code: string): Promise<void> {
  const option = page.locator(`[data-testid="team-select-option-${code}"]`);

  await listLanded(option);
  await field.locator("input").fill(code);
  await option.filter({ visible: true }).click();
}

// Open the ShopSelect inside `scope` (the page, a dialog, a filter bar) once its shops have landed. It draws its list
// inline (no portal), so its options are found inside the same scope.
export async function openShops(scope: Page | Locator): Promise<void> {
  await listLanded(scope.locator('[data-testid^="shop-select-option-"]'));
  await scope.getByTestId("shop-select").click();
}

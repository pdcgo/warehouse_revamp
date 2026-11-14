import { expect, within } from "storybook/test";

// STORY-ONLY helpers for the two transfer lists on a phone (the-transfer-lists-read-as-blocks-on-a-phone) — shared by
// the selling list's and the warehouse list's stories, so the rule each pins is written once. Imported by
// `*.stories.tsx` only.

/** The 390px phone the lists were accepted at — spread into a story file's `parameters.viewport.options`. */
export const PHONE_VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};

// NOTHING RUNS PAST THE SCREEN'S EDGE (nothing-runs-past-a-phones-edge) — not the page, not a block, not a line inside
// one.
export async function fitsTheScreen(canvasElement: HTMLElement) {
  await expect(window.innerWidth).toBeLessThanOrEqual(390);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);

  const list = within(canvasElement).queryByTestId("transfers-table");
  if (!list) return;
  await expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  for (const block of Array.from(list.children)) {
    await expect(block.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
  }
}

// THE TABS NEVER OVERLAP — each label fits inside its own tab, one line, side by side; the row stays inside the screen
// and slides sideways instead, with no bar drawn under it (a tab never shrinks — `flexShrink={0}`; without it the last
// check fails).
export async function tabsDoNotOverlap(canvasElement: HTMLElement) {
  const row = within(canvasElement).getByRole("tablist");
  const tabs = within(row).getAllByRole("tab");
  const height = tabs[0]!.getBoundingClientRect().height;

  for (const tab of tabs) {
    await expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth);
    await expect(Math.abs(tab.getBoundingClientRect().height - height)).toBeLessThan(1);
    await expect(Math.abs(tab.getBoundingClientRect().top - tabs[0]!.getBoundingClientRect().top)).toBeLessThan(1);
  }
  for (let i = 1; i < tabs.length; i++) {
    await expect(tabs[i]!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      tabs[i - 1]!.getBoundingClientRect().right - 0.5,
    );
  }
  await expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  await expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
  await expect(getComputedStyle(row).getPropertyValue("scrollbar-width")).toBe("none");
}

// THE ROOT BADGE IS WHOLE (an-override-shows-a-platform-badge) — drawn, inside its block, on its line, and the line is
// not cut (an inline-flex badge inside a clamped or truncated line vanishes whole; `toBeVisible()` alone passes then).
export async function theBadgeIsWhole(canvasElement: HTMLElement, id: string, lineTestId: string) {
  const canvas = within(canvasElement);
  const block = canvas.getByTestId(`transfer-row-${id}`);
  const line = canvas.getByTestId(lineTestId);
  const badge = within(line).getByTestId("root-team-badge");
  const b = badge.getBoundingClientRect();

  await expect(badge).toBeVisible();
  await expect(b.width).toBeGreaterThan(0);
  await expect(b.right).toBeLessThanOrEqual(block.getBoundingClientRect().right);
  await expect(b.right).toBeLessThanOrEqual(line.getBoundingClientRect().right + 0.5);
  await expect(b.bottom).toBeLessThanOrEqual(line.getBoundingClientRect().bottom + 0.5);
  await expect(line.scrollHeight).toBeLessThanOrEqual(line.clientHeight + 1);
  await expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
}

import type { Meta, StoryObj } from "@storybook/react-vite";

import { ORDER_CREATE_META } from "./stories/kit";

// ORDER CREATE — the form as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// OrderCreate. The same title also holds the folders below, so Storybook draws OrderCreate as a folder with these two
// stories leading it. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Address       the draft's address: pre-filled on one match, still editable, empty on none
//   Bundles       the bundle card: its dialog, items OR bundles, a bundle's products as real lines
//   Courier       the courier is required: marked, a draft's seeded, a cleared one holds Create
//   Create        what Create needs, the checks it asks, where it goes, and the key every submit mints
//   DuplicateRef  a live order or a draft on this shop + ref, named before Create: Create Anyway or Go Back
//   FormLock      the form locked from Create until an answer: a server error gives it back, no answer is Try Again
//   Header        Back and its guard; the form opened from a draft (one on a closed shop too) or from a product's page
//   Lines         the product lines: none to start, stock and HPP, a short line, two batches
//   Receipt       the receipt file and its two numbers, and the label read back
//   Totals        the warehouse fee, the debt limits and the warning at one, what the invoice charges
//   Warehouse     the band that leads the form: the team's default, a warehouse with no rate

const meta = {
  title: "Pages/Order/OrderCreate",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// THE SAME FORM, ON A PHONE-SHAPED CANVAS (owner) — the first of the order screens to get one.
//
// It is the same page and the same data: only the canvas is narrow, which is what the form's own
// responsive rules answer to. Worth looking at here, in this order:
//
//   - the two columns collapse into one, so "which shop / which warehouse" no longer sits beside the
//     lines it governs — it sits ABOVE them, which is the reading order the design wanted anyway;
//   - the totals card stops being a sticky right rail and lands at the bottom, after the lines;
//   - every picker's option rows are 44px here against 36px on a desktop (theme.ts, OPTION_PY), and a
//     product row's controls stack rather than squeeze.
//
// ⚠ NO `play()`, DELIBERATELY. The `viewport` global resizes the WORKBENCH canvas only — the story
// runner has one fixed viewport (see MobileLayout.stories) — so an assertion written here would be
// making a claim about a width the test never renders at. This story is for looking.
//
// The shell around it on a real phone (the compact top bar, the bottom tab bar) is its own story:
// Layouts/Mobile/AppShell. What this one shows is the PAGE inside that shell.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
};

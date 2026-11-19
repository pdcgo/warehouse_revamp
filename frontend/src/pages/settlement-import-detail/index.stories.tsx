import type { Meta, StoryObj } from "@storybook/react-vite";

import { IMPORT_DETAIL_META } from "./stories/kit";

// ⚠ PROTOTYPE for design_accept — docs/business/settlement/settlement_importer_decision.md.
//
// One imported statement: what it posted, and each of its rows with what became of it. The page leads with its plain
// look here; the rest are grouped by the part of the screen they are about, in ./stories
// (stories-are-grouped-by-the-part-of-the-screen) — States, File, Rows — sharing ./stories/kit.tsx.

const meta = {
  title: "Pages/Settlement/ImportDetail",
  ...IMPORT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

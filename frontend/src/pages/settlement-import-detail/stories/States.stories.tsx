import type { Meta, StoryObj } from "@storybook/react-vite";

import { AtFailed, AtInterrupted, IMPORT_DETAIL_META } from "./kit";

// IMPORT DETAIL — the plain looks other than Default: a file the server stopped mid-way, and a file refused whole. The
// page's stories are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen);
// what they share is ./kit.tsx.

const meta = {
  title: "Pages/Settlement/ImportDetail/States",
  ...IMPORT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interrupted: Story = { render: () => <AtInterrupted /> };

export const Failed: Story = { render: () => <AtFailed /> };

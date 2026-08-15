import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Pagination, description } from "./Pagination";

const meta = {
  title: "Components/Pagination",
  component: Pagination,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    count: 95,
    pageSize: 10,
    page: 1,
    onPageChange: fn(),
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPageSizePicker: Story = {
  args: {
    pageSizeOptions: [10, 25, 50],
    onPageSizeChange: fn(),
  },
};

export const MiddlePage: Story = {
  args: { page: 5 },
};

// The behaviour worth pinning: the pager REPORTS a page change, it does not hold the page itself.
// A version that kept its own state would look identical in the sidebar and silently ignore the
// caller's `page` prop.
export const NextPageEmitsTheNewPage: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("page-next"));

    await expect(args.onPageChange).toHaveBeenCalledWith(2);
  },
};

// Dropping the pager in unconditionally is only safe because it renders NOTHING when everything
// fits on one page — every list in the app relies on that, so it is a test rather than a comment.
export const HiddenWhenEverythingFitsOnOnePage: Story = {
  args: { count: 4, pageSize: 10 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("pagination-bar")).toBeNull();
  },
};

// …but NOT when there is a size picker: the control that changes the page size has to stay reachable
// even on a short list, or a 10-row default can never be widened.
export const VisibleOnOnePageWhenItHasASizePicker: Story = {
  args: {
    count: 4,
    pageSize: 10,
    pageSizeOptions: [10, 25, 50],
    onPageSizeChange: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("pagination-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("page-size")).toBeInTheDocument();
  },
};

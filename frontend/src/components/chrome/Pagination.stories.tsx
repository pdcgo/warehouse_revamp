import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Pagination, description } from "./Pagination";

const meta = {
  title: "Components/Chrome/Pagination",
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

// THE PAGER IS ALWAYS ON SCREEN (owner, `the-pager-is-always-on-screen`) — on one page too, where both
// arrows are off. It used to vanish, which made a short list look like a broken one.
export const ShownEvenWhenEverythingFitsOnOnePage: Story = {
  args: { count: 4, pageSize: 10 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("pagination-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("page-prev")).toBeDisabled();
    await expect(canvas.getByTestId("page-next")).toBeDisabled();
  },
};

// …and with a size picker the per-page choice is there on a short list too, or a 10-row default could
// never be widened.
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

// …and on an EMPTY list, where it reads as one page rather than "1 of 0".
export const ShownOnAnEmptyList: Story = {
  args: { count: 0, pageSize: 10 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("pagination-bar")).toBeInTheDocument();
    await expect(canvas.getByTestId("page-text")).not.toHaveTextContent("0");
    await expect(canvas.getByTestId("page-next")).toBeDisabled();
  },
};

// The RANGE line — "Showing 21–40 of 312". "Page 2 of 16" says where you are among PAGES; it does
// not say how many records there are, which is usually the actual question.
export const ShowingRange: Story = {
  args: { count: 312, pageSize: 20, page: 2, showRange: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("page-range")).toHaveTextContent("21");
    await expect(canvas.getByTestId("page-range")).toHaveTextContent("40");
    await expect(canvas.getByTestId("page-range")).toHaveTextContent("312");
  },
};

// The last page is CLAMPED to the total — it reads "301–312 of 312", never promising rows past the
// end that a naive page × pageSize would claim.
export const LastPageClampsToTheTotal: Story = {
  args: { count: 312, pageSize: 20, page: 16, showRange: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const range = canvas.getByTestId("page-range");
    await expect(range).toHaveTextContent("301");
    await expect(range).toHaveTextContent("312");
    // 16 × 20 = 320, which must NOT appear.
    await expect(range).not.toHaveTextContent("320");
  },
};

import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { GrowingPager, description } from "./GrowingPager";

// A list of `total` rows the pager is NOT told about — it learns, page by page, only whether another page
// exists, the way a list RPC with no total answers.
function Harness({ total = 95, pageSize: initialSize = 20, sizes = false }: { total?: number; pageSize?: number; sizes?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  const [filter, setFilter] = useState("all");

  return (
    <Stack gap="3">
      <Text fontSize="sm" data-testid="harness-page">
        Page {page}
      </Text>
      <Button
        size="xs"
        alignSelf="flex-start"
        data-testid="harness-refilter"
        onClick={() => {
          setFilter((f) => (f === "all" ? "some" : "all"));
          setPage(1);
        }}
      >
        Change Filter
      </Button>
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={page * pageSize < total}
        resetKey={`${filter}|${pageSize}`}
        pageSize={pageSize}
        pageSizeOptions={sizes ? [10, 20, 50] : undefined}
        onPageSizeChange={
          sizes
            ? (n) => {
                setPageSize(n);
                setPage(1);
              }
            : undefined
        }
      />
    </Stack>
  );
}

const meta = {
  title: "Components/Chrome/GrowingPager",
  component: Harness,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const numbers = (canvas: ReturnType<typeof within>) =>
  canvas.queryAllByTestId(/^growing-pager-page-\d+$/).map((b: HTMLElement) => b.textContent);

export const FirstOpen: Story = {};

// With a per-page selector, on the left of the page buttons — the row pushed to the right.
export const WithPageSizes: Story = {
  args: { sizes: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("growing-pager-size")).toBeVisible();
  },
};

// ON A PHONE the page buttons are centred and the per-page selector is gone — it filled the row
// (a-phone-pager-is-centred-without-a-page-size).
export const Mobile: Story = {
  args: { sizes: true },
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("growing-pager-size")).toBeNull();

    const row = canvas.getByTestId("growing-pager").getBoundingClientRect();
    const first = canvas.getByTestId("growing-pager-prev").getBoundingClientRect();
    const last = canvas.getByTestId("growing-pager-next").getBoundingClientRect();
    // As much room on the left of the buttons as on their right.
    await expect(Math.abs(first.left - row.left - (row.right - last.right))).toBeLessThan(4);
  },
};

/** One page of data: ‹ [1] ›, both arrows off — always on screen. */
export const OnePage: Story = {
  args: { total: 7 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(numbers(canvas)).toEqual(["1"]);
    await expect(canvas.getByTestId("growing-pager-prev")).toBeDisabled();
    await expect(canvas.getByTestId("growing-pager-next")).toBeDisabled();
  },
};

/**
 * THE NUMBERS GROW WITH THE PAGES OPENED (owner) — the next number appears once its page is known to exist, and
 * every opened page stays one click away.
 */
export const TheNumbersGrowAndStay: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // First open: page 1, and 2 because page 1 had a next.
    await expect(numbers(canvas)).toEqual(["1", "2"]);
    await expect(getComputedStyle(canvas.getByTestId("growing-pager-page-1")).backgroundColor).toBe("rgb(225, 29, 72)");

    await userEvent.click(canvas.getByTestId("growing-pager-next"));
    await userEvent.click(canvas.getByTestId("growing-pager-next"));
    await waitFor(() => expect(canvas.getByTestId("harness-page")).toHaveTextContent("Page 3"));
    await expect(numbers(canvas)).toEqual(["1", "2", "3", "4"]);

    await userEvent.click(canvas.getByTestId("growing-pager-next"));
    await userEvent.click(canvas.getByTestId("growing-pager-next"));
    await waitFor(() => expect(canvas.getByTestId("harness-page")).toHaveTextContent("Page 5"));

    // Back to 2 — 5, the furthest opened, is still there to jump to.
    await userEvent.click(canvas.getByTestId("growing-pager-page-2"));
    await waitFor(() => expect(canvas.getByTestId("harness-page")).toHaveTextContent("Page 2"));
    await expect(canvas.getByTestId("growing-pager-page-5")).toBeVisible();
    await userEvent.click(canvas.getByTestId("growing-pager-page-5"));
    await waitFor(() => expect(canvas.getByTestId("harness-page")).toHaveTextContent("Page 5"));

    // 95 rows at 20 a page: page 5 is the last, so › is off and no 6 appears.
    await expect(canvas.getByTestId("growing-pager-next")).toBeDisabled();
    await expect(canvas.queryByTestId("growing-pager-page-6")).toBeNull();
  },
};

/** A new question — a filter, a tab, a sort — starts the trail over. */
export const ANewFilterStartsOver: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("growing-pager-next"));
    await userEvent.click(canvas.getByTestId("growing-pager-next"));
    await waitFor(() => expect(numbers(canvas)).toEqual(["1", "2", "3", "4"]));

    await userEvent.click(canvas.getByTestId("harness-refilter"));
    await waitFor(() => expect(numbers(canvas)).toEqual(["1", "2"]));
  },
};

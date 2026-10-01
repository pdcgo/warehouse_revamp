import { useState } from "react";
import type { ReactNode } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Button, Icon } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";

import { ALL_DATES, DateRangePicker, isAllDates } from "../datetime/DateRangePicker";
import type { DateRange } from "../datetime/DateRangePicker";
import { TeamSelect } from "../teams/TeamSelect";
import { FilterBar, FilterField, FilterSearch, description } from "./FilterBar";

// The bar as a list page actually uses it: the caller owns the filter state, the bar owns where the
// controls sit. Every story drives this, because a filter strip with pinned values cannot be typed
// into — and "does Clear appear once you type" is most of what there is to review here.
function ListFilters({
  width,
  actions,
  initialQuery = "",
}: {
  width?: string;
  actions?: ReactNode;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [teamId, setTeamId] = useState(0n);
  const [range, setRange] = useState<DateRange>(ALL_DATES);

  // What "filtering" means is the PAGE's answer, not the bar's: only the page knows which of its
  // controls are at rest. The bar just renders Clear when told the list is narrowed.
  const active = q.trim() !== "" || teamId > 0n || !isAllDates(range);

  return (
    <Box w={width ?? "full"}>
      <FilterBar
        active={active}
        actions={actions}
        onClear={() => {
          setQ("");
          setTeamId(0n);
          setRange(ALL_DATES);
        }}
      >
        <FilterSearch value={q} onChange={setQ} placeholder="Search orders" testId="bar-search" />

        {/* A picker goes in a FilterField, never bare: the field is what gives every dropdown on
            every list the same width, and what stops it shrinking when the row runs out of room. */}
        <FilterField testId="bar-team">
          <TeamSelect
            value={teamId > 0n ? teamId : undefined}
            onChange={setTeamId}
            placeholder="All teams"
          />
        </FilterField>

        {/* The date range goes LAST — it is the widest control and the one most often left alone. */}
        <DateRangePicker value={range} onChange={setRange} testId="bar-date" />
      </FilterBar>
    </Box>
  );
}

const meta = {
  title: "Components/Chrome/FilterBar",
  component: FilterBar,
  parameters: {
    docs: { description: { component: description } },
  },
  // Every story renders `ListFilters` (the bar plus the state a page would hold), so nothing reads
  // these — they exist because `children` is required and the meta has to satisfy the props.
  args: { children: null },
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// At rest: search, one picker, the date range. No Clear — nothing is being narrowed yet.
export const Default: Story = {
  render: () => <ListFilters />,
};

// The same bar with a filter applied. The only difference is the Clear button, and that is the point:
// the strip does not change shape when somebody starts filtering.
export const Filtering: Story = {
  render: () => <ListFilters initialQuery="INV-2201" />,
};

// A list page's own action ("New Order") lives on the RIGHT of the same strip, not on a row of its
// own — the filters and the one thing you came to create belong on one line.
export const WithPageAction: Story = {
  render: () => (
    <ListFilters
      width="56rem"
      actions={
        <Button size="xs" colorPalette="brand" data-testid="bar-action">
          <Icon as={Plus} boxSize="4" />
          New Order
        </Button>
      }
    />
  ),
};

// Narrow enough that the row cannot hold every control — a phone at the shelf, or a browser beside a
// spreadsheet. The controls wrap at full size rather than compressing into unreadable stubs.
export const Narrow: Story = {
  render: () => <ListFilters width="26rem" />,
};

// ── The layout rules, as tests ──────────────────────────────────────────────────────────────────

// One rem in pixels. The widths here are theme tokens (`13rem`, `sm`), and this app's root font is
// 14px — so a test written in raw pixels would be pinning a number that has nothing to do with the
// rule it claims to check, and would break the day the type scale is retuned.
function rem(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// RULE 3: CLEAR EXISTS ONLY WHILE FILTERING. A Clear button sitting over an unfiltered list is a
// control that does nothing, and worse, it reads as "something is being hidden from you". It appears
// when the page says the list is narrowed and leaves the moment it isn't.
export const ClearAppearsOnlyWhileFiltering: Story = {
  render: () => <ListFilters />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByTestId("filter-bar");

    await expect(canvas.queryByTestId("filter-bar-clear")).not.toBeInTheDocument();
    await expect(bar).not.toHaveAttribute("data-filtering");

    // A controlled input at machine speed drops characters — type like a person.
    await userEvent.type(canvas.getByTestId("bar-search"), "INV-22", { delay: 40 });

    const clear = await canvas.findByTestId("filter-bar-clear");
    await expect(clear).toBeVisible();
    await expect(bar).toHaveAttribute("data-filtering", "true");

    await userEvent.click(clear);

    await expect(canvas.getByTestId("bar-search")).toHaveValue("");
    await expect(canvas.queryByTestId("filter-bar-clear")).not.toBeInTheDocument();
    await expect(bar).not.toHaveAttribute("data-filtering");
  },
};

// RULE 1: ORDER IS READING ORDER, AND ACTIONS ARE ALWAYS LAST. The Spacer lives inside the component
// precisely so a caller cannot write "New Order" between two filters — pass it as `actions` and it
// ends up on the right whatever else the bar is holding.
export const PageActionsStayOnTheRight: Story = {
  render: () => (
    <ListFilters
      width="56rem"
      actions={
        <Button size="xs" colorPalette="brand" data-testid="bar-action">
          New Order
        </Button>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const bar = canvas.getByTestId("filter-bar").getBoundingClientRect();
    const lastFilter = canvas.getByTestId("bar-date").getBoundingClientRect();
    const action = canvas.getByTestId("bar-action").getBoundingClientRect();

    // Right of every filter…
    await expect(action.left).toBeGreaterThan(lastFilter.right);
    // …and hard against the end of the strip, rather than trailing the last filter.
    await expect(bar.right - action.right).toBeLessThan(2);
  },
};

// RULE 2: CONTROLS WRAP, THEY DO NOT SQUEEZE. This is the rule a hand-rolled strip loses first — a
// flex row with no wrap turns a 13rem team picker into a 60px sliver showing three letters of a
// placeholder. At any width, a picker is either full size or on the next line.
export const ControlsWrapInsteadOfSqueezing: Story = {
  render: () => <ListFilters width="26rem" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const search = canvas.getByTestId("bar-search").getBoundingClientRect();
    const team = canvas.getByTestId("bar-team").getBoundingClientRect();

    // Still its full 13rem in a container too narrow to hold the row. Measured in rem, not pixels:
    // this app's root font is 14px, so a hard-coded 208 would be asserting a different theme.
    await expect(team.width).toBeGreaterThanOrEqual(13 * rem() - 1);
    // Which it can only be by having moved to a second line.
    await expect(team.top).toBeGreaterThanOrEqual(search.bottom);
  },
};

// The search is the ONE control allowed to flex — it reads fine at any width, so it takes the slack
// instead of leaving a ragged gap. It stops growing at `sm` so a wide screen gets a search box rather
// than a search field the width of the page.
export const SearchTakesTheSlackUpToSm: Story = {
  render: () => <ListFilters width="72rem" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Grown past its 14rem basis, and capped at `sm` (24rem) well short of the 72rem container.
    const search = canvas.getByTestId("bar-search").getBoundingClientRect();
    await expect(search.width).toBeGreaterThan(14 * rem());
    await expect(search.width).toBeLessThanOrEqual(24 * rem() + 1);
  },
};

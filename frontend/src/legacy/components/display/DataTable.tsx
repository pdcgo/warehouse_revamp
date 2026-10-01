import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Icon, Table } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Info, TriangleAlert } from "lucide-react";
import { EmptyHint } from "../feedback/EmptyHint";
import { SkeletonBlock } from "../feedback/SkeletonBlock";
import { SpinnerOverlay } from "../feedback/SpinnerOverlay";
import { Tooltip } from "../feedback/Tooltip";

export type TableSize = "sm" | "md";

// Which edge a column pins to while the rest scrolls horizontally. The legacy set had six variants
// encoding the container padding (card vs modal vs page); that was a styling workaround, and the two
// that carry MEANING — the identifying column, and the actions column — are these.
export type TableSticky = "left" | "right";

export interface TableSort {
  key?: string;
  desc?: boolean;
}

export interface TableColumn<T> {
  // Read the cell straight off the row when it is a string or a number. `render` wins if both are
  // given; between them, most columns need no cell function at all.
  key?: keyof T;
  name: ReactNode;

  // Sub-columns. Giving a column children turns it into a GROUP HEADER: it spans them and renders no
  // body cell of its own, and every leafless sibling gains a rowspan so the two header rows align.
  children?: Array<TableColumn<T>>;

  width?: string;
  align?: "start" | "center" | "end";
  sticky?: TableSticky;
  hidden?: boolean;

  // A hint in the header explaining what the column means. For anything a reader would otherwise
  // have to infer from the values — a computed margin, a status with non-obvious rules.
  tooltip?: string;
  // Present the column as sortable and emit this key. Absent = not sortable.
  sortKey?: string;
  sortDisabled?: boolean;

  // Merge this cell down over the next N rows. Return 0 to render nothing (already covered by a
  // rowspan above). Default 1.
  rowSpan?(item: T, index: number): number;

  render?(item: T, index: number): ReactNode;
}

export type TableRowProps<T> = (item: T, index: number) => Record<string, unknown> | undefined;

export interface DataTableProps<T> {
  columns: Array<TableColumn<T>>;
  items: Array<T>;

  size?: TableSize;

  // ── STATE ────────────────────────────────────────────────────────────────────────────────────
  // The three states a table can be in besides "here are the rows", and they are NOT the same shape:
  //
  //   loading + no rows  — skeleton rows, so the table has its final height before the data lands
  //   loading + rows     — a spinner over the rows, because the rows are still the best answer
  //   error / empty      — one full-width message row explaining which it is
  loading?: boolean;
  skeletonRows?: number;
  isError?: boolean;
  emptyTitle?: string;
  emptyContent?: ReactNode;
  errorTitle?: string;
  errorContent?: ReactNode;

  headerSticky?: boolean;
  hideHeader?: boolean;

  sort?: TableSort;
  onSort?(sort?: TableSort): void;

  rowProps?: TableRowProps<T>;
  onRowClick?(item: T, index: number): void;

  "aria-label"?: string;
  "data-testid"?: string;
}

// nextSort is the three-click cycle: unsorted, then ascending, then descending, then unsorted again.
//
// The third state matters. Without it a column can be sorted but never UN-sorted, so a reader who
// sorted by price to answer one question is stuck in that order for every question after it, and the
// only way back to the natural order is a page reload.
function nextSort(current: TableSort | undefined, key: string): TableSort | undefined {
  if (!current || current.key !== key) return { key, desc: false };
  if (!current.desc) return { key, desc: true };
  return undefined;
}

function visible<T>(cols: Array<TableColumn<T>>): Array<TableColumn<T>> {
  return cols.filter((c) => !c.hidden);
}

// The columns that actually produce BODY cells: a group header contributes its children, not itself.
function leafColumns<T>(cols: Array<TableColumn<T>>): Array<TableColumn<T>> {
  return visible(cols).flatMap((c) => (c.children?.length ? visible(c.children) : [c]));
}

// ── ONE BAD CELL MUST NOT BLANK THE PAGE ────────────────────────────────────────────────────────
//
// A render function is caller-supplied and runs against server data, so a null it did not expect
// throws — and in React an uncaught render error unmounts the WHOLE tree, not the row. The operator
// loses the screen they were working on, with no indication which row did it.
//
// The boundary keeps the failure inside the table: everything else on the page survives, and the
// message says the table is what broke.
class TableErrorBoundary extends Component<
  { colSpan: number; title?: string; children: ReactNode },
  { message?: string }
> {
  state: { message?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still logged: the boundary is a containment measure, not a reason to lose the stack.
    console.error("DataTable render failed", error, info);
  }

  render() {
    if (this.state.message === undefined) return this.props.children;

    return (
      <Table.Body>
        <Table.Row>
          <Table.Cell colSpan={this.props.colSpan}>
            <EmptyHint icon={TriangleAlert} title={this.props.title ?? "This table could not be shown"}>
              {this.state.message}
            </EmptyHint>
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    );
  }
}

function stickyProps(sticky: TableSticky | undefined) {
  if (!sticky) return {};

  return {
    position: "sticky" as const,
    [sticky === "left" ? "left" : "right"]: "0",
    zIndex: 1,
    // An opaque background is not decoration: without it the scrolling columns show THROUGH the
    // pinned one and the text of both is legible at once.
    bg: "bg.subtle",
  };
}

function HeaderCell<T>({
  column,
  sort,
  onSort,
  rowSpan,
  colSpan,
}: {
  column: TableColumn<T>;
  sort?: TableSort;
  onSort?(sort?: TableSort): void;
  rowSpan?: number;
  colSpan?: number;
}) {
  const sortable = Boolean(column.sortKey) && !column.sortDisabled;
  const isSorted = Boolean(sort?.key && column.sortKey === sort.key);
  const isDesc = isSorted && Boolean(sort?.desc);

  return (
    <Table.ColumnHeader
      rowSpan={rowSpan}
      colSpan={colSpan}
      width={column.width}
      textAlign={column.align}
      cursor={sortable ? "pointer" : undefined}
      userSelect="none"
      whiteSpace="nowrap"
      aria-sort={isSorted ? (isDesc ? "descending" : "ascending") : undefined}
      onClick={sortable ? () => onSort?.(nextSort(sort, column.sortKey!)) : undefined}
      data-testid={column.sortKey ? `th-${column.sortKey}` : undefined}
      {...stickyProps(column.sticky)}
    >
      <Box display="inline-flex" alignItems="center" gap="1">
        {column.tooltip && (
          <Tooltip content={column.tooltip}>
            <Icon as={Info} boxSize="3.5" color="fg.muted" />
          </Tooltip>
        )}
        {column.name}
        {column.sortKey && (
          // The unsorted state gets its own faint glyph rather than no glyph. A sortable column that
          // looks identical to a fixed one is a feature nobody discovers.
          <Icon
            as={isSorted ? (isDesc ? ArrowDown : ArrowUp) : ChevronsUpDown}
            boxSize="3.5"
            color={isSorted ? "fg" : "fg.subtle"}
            opacity={column.sortDisabled ? 0.4 : 1}
          />
        )}
      </Box>
    </Table.ColumnHeader>
  );
}

// A fixed, repeating width pattern — NOT random. Random widths re-roll on every render, so the
// skeleton visibly twitches while it waits, which is the opposite of what a placeholder is for.
const SKELETON_WIDTHS = ["75%", "50%", "66%", "85%", "40%"];

export const description =
  "The data table: column definitions with sorting, group headers, sticky columns and row spans, plus the loading / empty / error states as first-class props. One bad cell renderer fails the table, not the page.";

export function DataTable<T>({
  columns,
  items,
  size = "md",
  loading,
  skeletonRows = 8,
  isError,
  emptyTitle,
  emptyContent,
  errorTitle,
  errorContent,
  headerSticky,
  hideHeader,
  sort,
  onSort,
  rowProps,
  onRowClick,
  ...rest
}: DataTableProps<T>) {
  const tops = visible(columns);
  const leafs = leafColumns(columns);
  const isGrouped = tops.some((c) => c.children?.length);
  const colSpan = leafs.length;

  // ⚠ A COMPONENT, NOT A CALL. An error boundary only catches what its DESCENDANTS throw while
  // rendering. Calling this as `{body()}` would run it during DataTable's OWN render — the throw
  // would happen above the boundary and take the whole page down, which is exactly what the boundary
  // exists to prevent. Rendering it as `<Body/>` puts it beneath the boundary in the tree.
  function Body() {
    // Loading with NOTHING to show: skeleton rows, so the table already occupies its final height
    // and the page does not jump when the rows land.
    if (loading && items.length === 0) {
      return (
        <Table.Body data-testid="table-skeleton">
          {Array.from({ length: skeletonRows }).map((_, r) => (
            <Table.Row key={r}>
              {leafs.map((col, c) => (
                <Table.Cell key={c} {...stickyProps(col.sticky)}>
                  <SkeletonBlock
                    shape="rect"
                    height="3.5"
                    width={SKELETON_WIDTHS[(r + c) % SKELETON_WIDTHS.length]}
                  />
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      );
    }

    if (isError) {
      return (
        <Table.Body>
          <Table.Row>
            <Table.Cell colSpan={colSpan}>
              <EmptyHint icon={TriangleAlert} title={errorTitle ?? "This table could not be loaded"}>
                {errorContent}
              </EmptyHint>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      );
    }

    if (items.length === 0) {
      return (
        <Table.Body>
          <Table.Row>
            <Table.Cell colSpan={colSpan}>
              <EmptyHint title={emptyTitle ?? "Nothing here"}>{emptyContent}</EmptyHint>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      );
    }

    return (
      <Table.Body>
        {items.map((item, index) => (
          <Table.Row
            key={index}
            cursor={onRowClick ? "pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(item, index) : undefined}
            {...rowProps?.(item, index)}
          >
            {leafs.map((col, c) => {
              const span = col.rowSpan?.(item, index) ?? 1;
              // 0 means a rowspan from an earlier row already covers this position — rendering a
              // cell here would push every following cell in the row one column to the right.
              if (span === 0) return null;

              const content = col.render
                ? col.render(item, index)
                : col.key !== undefined
                  ? String(item[col.key] ?? "")
                  : "";

              return (
                <Table.Cell
                  key={c}
                  rowSpan={span > 1 ? span : undefined}
                  textAlign={col.align}
                  {...stickyProps(col.sticky)}
                >
                  {content}
                </Table.Cell>
              );
            })}
          </Table.Row>
        ))}
      </Table.Body>
    );
  }

  return (
    // Loading OVER existing rows is a spinner, not a skeleton: the rows on screen are still the best
    // answer available, so they stay readable rather than being replaced by grey bars.
    <SpinnerOverlay busy={loading && items.length > 0}>
      {/* The table scrolls INSIDE its own container. Without this a wide table widens the page and
          the whole layout scrolls sideways — which is also what makes sticky columns meaningful. */}
      <Table.ScrollArea>
        <Table.Root size={size} stickyHeader={headerSticky} interactive={Boolean(onRowClick)} {...rest}>
          {!hideHeader && (
            <Table.Header>
              <Table.Row>
                {tops.map((col, i) => (
                  <HeaderCell
                    key={i}
                    column={col}
                    sort={sort}
                    onSort={onSort}
                    // A leafless column in a grouped header spans BOTH header rows, so its label sits
                    // level with the group labels instead of floating above an empty cell.
                    rowSpan={isGrouped && !col.children?.length ? 2 : undefined}
                    colSpan={col.children?.length || undefined}
                  />
                ))}
              </Table.Row>

              {isGrouped && (
                <Table.Row>
                  {tops
                    .flatMap((c) => visible(c.children ?? []))
                    .map((col, i) => (
                      <HeaderCell key={i} column={col} sort={sort} onSort={onSort} />
                    ))}
                </Table.Row>
              )}
            </Table.Header>
          )}

          <TableErrorBoundary colSpan={colSpan} title={errorTitle}>
            <Body />
          </TableErrorBoundary>
        </Table.Root>
      </Table.ScrollArea>
    </SpinnerOverlay>
  );
}

import { useTranslation } from "react-i18next";
import { Flex, Icon, Table, type TableColumnHeaderProps } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export const description =
  "A table column heading that sorts the list (`a-table-sorts-from-its-headings`): a click sorts by the column — first in its natural direction (largest first for a measure, A to Z for a name) — and a second click flips it; two states, never a third back to the default. The active column shows its arrow, the others ⇅. The SERVER sorts — the page is never re-sorted on the client. Without `onSortChange` it is a plain heading.";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  by: K;
  dir: SortDirection;
}

export interface SortableHeaderProps<K extends string> {
  /** The column this heading sorts by. */
  column: K;
  label: string;
  /** The list's current sort — `null` while it is in its own default order (every heading shows ⇅). */
  sort: SortState<K> | null | undefined;
  /** Omitted, the heading is plain text — a column whose order would mean nothing. */
  onSortChange?: (next: SortState<K>) => void;
  /** Right-aligned — a column of figures. */
  end?: boolean;
  /**
   * Where a FIRST click goes. `desc` for a measure — the biggest is the question (owner: *"cukup bolak-balik"*);
   * `asc` for a name or a word, which reads A to Z.
   */
  firstDir?: SortDirection;
  testId?: string;
  /** Passed to the heading cell — a sticky column's position and ground, say. */
  headerProps?: TableColumnHeaderProps;
}

// Shared by every list that sorts from its headings — the settlement list was first, the accounts list
// second — so the arrow, the two states and the a11y wiring are one thing, not one per screen.
export function SortableHeader<K extends string>({
  column,
  label,
  sort,
  onSortChange,
  end = false,
  firstDir = "desc",
  testId,
  headerProps,
}: SortableHeaderProps<K>) {
  const { t } = useTranslation();

  if (!onSortChange) {
    return (
      <Table.ColumnHeader textAlign={end ? "end" : undefined} {...headerProps}>
        {label}
      </Table.ColumnHeader>
    );
  }

  const active = sort?.by === column;
  const dir = active ? sort!.dir : undefined;
  const icon = dir === undefined ? ArrowUpDown : dir === "desc" ? ArrowDown : ArrowUp;

  return (
    <Table.ColumnHeader
      textAlign={end ? "end" : undefined}
      aria-sort={dir === undefined ? "none" : dir === "desc" ? "descending" : "ascending"}
      {...headerProps}
    >
      <Flex
        as="button"
        align="center"
        justify={end ? "flex-end" : "flex-start"}
        gap="1"
        w="full"
        cursor="pointer"
        fontWeight={active ? "bold" : undefined}
        aria-label={t("common.sortBy", { column: label })}
        data-testid={testId}
        data-sort={dir}
        // A new heading starts in its natural direction; the active one flips — two states, no third.
        onClick={() => onSortChange({ by: column, dir: dir === undefined ? firstDir : dir === "desc" ? "asc" : "desc" })}
      >
        {label}
        <Icon as={icon} boxSize="3.5" color={active ? "fg" : "fg.subtle"} />
      </Flex>
    </Table.ColumnHeader>
  );
}

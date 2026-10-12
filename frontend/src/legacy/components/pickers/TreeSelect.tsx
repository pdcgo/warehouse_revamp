import { useMemo, useState } from "react";
import { Box, Button, Icon, Input, InputGroup, Popover, Portal, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

export interface TreeNode<V extends string> {
  value: V;
  label: string;
  children?: Array<TreeNode<V>>;
  // A branch that exists to group but cannot itself be chosen — "Apparel" when only "Apparel ›
  // T-shirts" is a real category.
  selectable?: boolean;
  disabled?: boolean;
}

// flatten walks the tree into rows, carrying each node's DEPTH and its ancestor path.
//
// The path is what makes a search result usable: "L" on its own is meaningless, "Apparel › T-shirts
// › L" is an answer. A flat search that returns only leaf labels forces the reader to pick blind and
// then check whether they guessed the right branch.
interface FlatNode<V extends string> {
  node: TreeNode<V>;
  depth: number;
  path: string[];
}

function flatten<V extends string>(
  nodes: Array<TreeNode<V>>,
  depth = 0,
  path: string[] = [],
): Array<FlatNode<V>> {
  return nodes.flatMap((node) => [
    { node, depth, path },
    ...flatten(node.children ?? [], depth + 1, [...path, node.label]),
  ]);
}

// TreeSelect is a picker over HIERARCHICAL options — categories, racks within zones, an account
// tree.
//
// Two things make it different from a flat Select, and both are about not losing the hierarchy:
//
//  1. BRANCHES COLLAPSE. A tree rendered fully expanded is a long flat list with indentation, which
//     is strictly worse than a flat list: same length, plus visual noise. Collapsing means the
//     reader navigates by branch, which is how they think about the thing.
//  2. SEARCH SHOWS THE PATH, AND FLATTENS. While searching, the hierarchy stops helping — you no
//     longer know which branch to open — so matches are listed with their full ancestor path instead
//     of nested. That is why "L" comes back as "Apparel › T-shirts › L".
//
// ⚠ THE WHOLE TREE MUST BE IN HAND. This is a picker feed, and a page is a flat window that cannot
// assemble a tree — so its data comes from a full-tree read (CLAUDE.md's documented tree exception).
// A BROWSE screen over the same growing data must still paginate by loading a level's children.
export const description =
  "A picker over hierarchical options. Branches collapse so the reader navigates by branch, and searching flattens to full ancestor paths — because 'L' means nothing without 'Apparel › T-shirts'.";

export interface TreeSelectProps<V extends string> {
  value?: V;
  onChange?(value: V | undefined): void;
  nodes: Array<TreeNode<V>>;
  placeholder?: string;
  disabled?: boolean;
  // Offer a search box. Worth it past a couple of dozen leaves; noise below that.
  searchable?: boolean;
}

export function TreeSelect<V extends string>({
  value,
  onChange,
  nodes,
  placeholder = "Select",
  disabled,
  searchable = true,
}: TreeSelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const flat = useMemo(() => flatten(nodes), [nodes]);

  const selected = flat.find((f) => f.node.value === value);

  // Searching flattens (rule 2); browsing respects the collapse state (rule 1).
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (q) {
      return flat.filter(
        (f) =>
          f.node.label.toLowerCase().includes(q) ||
          f.path.some((p) => p.toLowerCase().includes(q)),
      );
    }

    // A node is visible when every one of its ancestors is expanded. Walking the path rather than
    // recursing keeps the check independent of how the rows were produced.
    return flat.filter((f) => f.path.every((_, i) => expanded.has(f.path.slice(0, i + 1).join("›"))));
  }, [flat, query, expanded]);

  const searching = query.trim().length > 0;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        // The search is cleared on close, so re-opening starts from the tree rather than from
        // whatever was typed a screen ago.
        if (!e.open) setQuery("");
      }}
      positioning={{ sameWidth: true }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          justifyContent="space-between"
          fontWeight="normal"
          disabled={disabled}
          w="full"
          data-testid="tree-select-trigger"
        >
          <Text truncate color={selected ? "fg" : "fg.muted"}>
            {/* The trigger shows the PATH, not just the leaf — the same reason search does. */}
            {selected ? [...selected.path, selected.node.label].join(" › ") : placeholder}
          </Text>
          <Icon as={ChevronDown} boxSize="4" />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner>
          <Popover.Content data-testid="tree-select-panel">
            <Popover.Body p="1">
              {searchable && (
                <InputGroup startElement={<Icon as={Search} boxSize="4" color="fg.muted" />} mb="1">
                  <Input
                    size="sm"
                    placeholder="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    data-testid="tree-select-search"
                  />
                </InputGroup>
              )}

              <Stack gap="0" maxH="64" overflowY="auto">
                {rows.length === 0 && (
                  <Text fontSize="sm" color="fg.muted" p="2" data-testid="tree-select-empty">
                    No matches
                  </Text>
                )}

                {rows.map(({ node, depth, path }) => {
                  const key = [...path, node.label].join("›");
                  const hasChildren = Boolean(node.children?.length);
                  const isExpanded = expanded.has(key);
                  const canSelect = node.selectable !== false && !node.disabled;

                  return (
                    <Box
                      key={node.value}
                      display="flex"
                      alignItems="center"
                      gap="1"
                      // Indentation only while BROWSING — a search result list is flat, and indenting
                      // it by a depth the reader can no longer see is just ragged left edges.
                      ps={searching ? "2" : `${depth * 4 + 2}`}
                      py="1"
                      borderRadius="l2"
                      cursor={canSelect ? "pointer" : "default"}
                      bg={node.value === value ? "bg.muted" : undefined}
                      _hover={canSelect ? { bg: "bg.muted" } : undefined}
                      data-testid={`tree-node-${node.value}`}
                      onClick={() => {
                        if (!canSelect) {
                          // An unselectable branch still responds — clicking it opens it, which is
                          // what the reader meant.
                          if (hasChildren && !searching) toggle(key);
                          return;
                        }

                        onChange?.(node.value);
                        setOpen(false);
                      }}
                    >
                      {hasChildren && !searching ? (
                        <Icon
                          as={isExpanded ? ChevronDown : ChevronRight}
                          boxSize="3.5"
                          color="fg.muted"
                          data-testid={`tree-toggle-${node.value}`}
                          onClick={(e) => {
                            // Toggling must not also select — they are different intentions on the
                            // same row.
                            e.stopPropagation();
                            toggle(key);
                          }}
                        />
                      ) : (
                        <Box boxSize="3.5" flexShrink="0" />
                      )}

                      <Text fontSize="sm" truncate opacity={canSelect ? 1 : 0.7}>
                        {/* Rule 2: a match carries its ancestry. */}
                        {searching && path.length > 0 && (
                          <Text as="span" color="fg.muted">
                            {path.join(" › ")}{" › "}
                          </Text>
                        )}
                        {node.label}
                      </Text>
                    </Box>
                  );
                })}
              </Stack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
}

import { useMemo, useState } from "react";
import { Box, Button, Flex, HStack, Icon, IconButton, Input, Popover, Spinner, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../api/clients";
import type { Category } from "../../gen/warehouse/category/v1/category_pb";
import { useCategoryOptions } from "../../features/categories/queries";
import { childrenByParent } from "../../features/categories/categoryTree";

export interface CategorySelectProps {
  /** Selected category id. 0n (the default) means top-level / none. */
  value?: bigint;
  onChange?: (id: bigint) => void;
  /** Label shown when nothing is selected (also the clear target). */
  placeholder?: string;
  /** A category id to omit — pass a node's own id when reparenting so it (and its subtree) can't be picked. */
  excludeId?: bigint;
  /**
   * When true, only END categories (leaves — nodes with no children) may be SELECTED: clicking a
   * parent drills into it instead of selecting it, and the search list shows only leaves. Default
   * false — any node is selectable. (#63)
   */
  leafOnly?: boolean;
  disabled?: boolean;
  /**
   * How the panel is positioned — `absolute` (the default) or `fixed`. Pass `fixed` inside a box that SCROLLS its own
   * content (Discover's filter panel): the panel is not portalled, so an absolute one is cut off at that box's edge,
   * where a fixed one is laid out against the window.
   */
  positioningStrategy?: "absolute" | "fixed";
}

// A nested category node built from the flat CategoryList.
interface CatNode {
  cat: Category;
  children: CatNode[];
}

function buildForest(categories: Category[], excludeId?: bigint): CatNode[] {
  const byParent = childrenByParent(categories);
  const build = (parentKey: string): CatNode[] =>
    (byParent.get(parentKey) ?? [])
      .filter((c) => c.id !== excludeId)
      .map((c) => ({ cat: c, children: build(c.id.toString()) }));

  return build("0");
}

// Root → node path (inclusive), or null.
function findPath(forest: CatNode[], id: bigint): CatNode[] | null {
  for (const n of forest) {
    if (n.cat.id === id) {
      return [n];
    }
    const sub = findPath(n.children, id);
    if (sub) {
      return [n, ...sub];
    }
  }

  return null;
}

// The nodes a drilled path of ids walks through, in the CURRENT forest — so a tree that re-reads while the panel is
// open (a category added elsewhere) shows its new children under the same drill, and an id gone from the tree simply
// ends the walk there.
function nodesAlong(forest: CatNode[], ids: bigint[]): CatNode[] {
  const out: CatNode[] = [];
  let level = forest;

  for (const id of ids) {
    const node = level.find((n) => n.cat.id === id);
    if (!node) {
      break;
    }
    out.push(node);
    level = node.children;
  }

  return out;
}

// Every node with its full ancestor path — powers the flat search list.
function collectAll(forest: CatNode[], trail: CatNode[], out: { node: CatNode; path: CatNode[] }[]) {
  for (const n of forest) {
    const p = [...trail, n];
    out.push({ node: n, path: p });
    collectAll(n.children, p, out);
  }
}

// CategorySelect is the shared nested-category picker (#34), reworked for #63 to match the pattern
// the owner uses (warehouse_infra CategoryPicker): a Popover whose trigger shows the selected path
// as a breadcrumb ("Parent › Child › Grandchild"), and whose body is MULTISTAGE — cascading Miller
// columns where each category with children drills into a new column. A search box jumps to any
// matching node. Any node (not only leaves) is selectable — clicking a name selects it; a chevron
// drills without selecting.
//
// Rendered inline (portalled={false}) so it works inside modal dialogs (create/edit category), where
// a portalled popover renders outside the dialog and the modal makes it inert.
export const description =
  "Nested-category picker (#63): a Popover with a breadcrumb trigger and cascading Miller columns over the global taxonomy. Emits a category id (0 = none). Pass `leafOnly` to allow selecting only end (leaf) categories — parents then drill instead of select.";

// One empty tree for every render while nothing has landed — a fresh `[]` would rebuild the forest memo each time.
const NO_CATEGORIES: Category[] = [];

export function CategorySelect({
  value = 0n,
  onChange,
  placeholder,
  excludeId,
  leafOnly = false,
  disabled,
  positioningStrategy = "absolute",
}: CategorySelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("catalog.categorySelect.placeholder");

  // THE TREE THROUGH THE QUERY CACHE (#121), not a fetch of its own on every mount: the picker sits on several forms
  // and dialogs, and each used to ask CategoryList again. The category page's writes invalidate `categories`, so a
  // category added there is in this picker without a reload — and a failed read is retried on the next mount instead
  // of leaving this field "unavailable" for its life.
  const tree = useCategoryOptions();
  const categories = tree.data ?? NO_CATEGORIES;
  const loading = tree.isPending;
  const error = tree.isError ? rpcError(tree.error) : "";

  const [open, setOpen] = useState(false);
  // The drilled (non-selected) columns, as the ids they pass through. `null` = not drilled since the panel opened:
  // the columns then follow the current selection's ancestry — read from the tree as it is NOW, so a selection made
  // before the tree landed still opens on its own branch.
  const [drilledIds, setDrilledIds] = useState<bigint[] | null>(null);
  const [query, setQuery] = useState("");

  const forest = useMemo(() => buildForest(categories, excludeId), [categories, excludeId]);

  const seeded = useMemo(() => {
    const p = value > 0n ? findPath(forest, value) : null;

    return p ? p.slice(0, -1).map((n) => n.cat.id) : [];
  }, [forest, value]);

  const path = useMemo(() => nodesAlong(forest, drilledIds ?? seeded), [forest, drilledIds, seeded]);

  // On open: the search starts over and the columns re-seed from the selection — in the open handler, not an effect,
  // so a tree re-read landing while the panel is open never wipes what is being typed or drilled.
  function handleOpenChange(next: boolean) {
    if (next) {
      setQuery("");
      setDrilledIds(null);
    }
    setOpen(next);
  }

  const columns = useMemo<CatNode[][]>(() => [forest, ...path.map((p) => p.children)], [forest, path]);

  const pathLabel = useMemo(() => {
    if (value <= 0n) {
      return "";
    }
    const p = findPath(forest, value);
    return p ? p.map((n) => n.cat.name).join(" › ") : "";
  }, [forest, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    const all: { node: CatNode; path: CatNode[] }[] = [];
    collectAll(forest, [], all);
    return all.filter(
      (m) => m.node.cat.name.toLowerCase().includes(q) && (!leafOnly || m.node.children.length === 0),
    );
  }, [forest, query, leafOnly]);

  function select(id: bigint) {
    onChange?.(id);
    setOpen(false);
  }

  function drill(colIndex: number, node: CatNode) {
    setDrilledIds((prev) => [...(prev ?? seeded).slice(0, colIndex), node.cat.id]);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => handleOpenChange(e.open)}
      positioning={{ placement: "bottom-start", strategy: positioningStrategy }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          justifyContent="space-between"
          fontWeight="normal"
          disabled={disabled}
          data-testid="category-select"
          w="full"
        >
          <Text as="span" truncate color={pathLabel ? undefined : "fg.muted"}>
            {pathLabel || resolvedPlaceholder}
          </Text>
          <Icon as={ChevronDown} boxSize="4" />
        </Button>
      </Popover.Trigger>

      {/* No Portal on purpose — see the component comment (works inside modal dialogs). */}
      <Popover.Positioner>
        <Popover.Content width="auto" maxW="90vw">
          <Popover.Body p="2">
            <Stack gap="2">
              <Input
                size="sm"
                placeholder={t("catalog.categorySelect.searchPlaceholder")}
                value={query}
                data-testid="category-search"
                onChange={(e) => setQuery(e.target.value)}
              />

              {loading ? (
                <Flex justify="center" py="4">
                  <Spinner size="sm" colorPalette="brand" />
                </Flex>
              ) : error ? (
                <Text p="2" fontSize="sm" color="error.fg">
                  {error}
                </Text>
              ) : query.trim() ? (
                <Box maxH="280px" overflowY="auto" minW="240px" data-testid="category-search-results">
                  {matches.length === 0 ? (
                    <Text p="2" fontSize="sm" color="fg.muted">
                      {t("catalog.categorySelect.noResults")}
                    </Text>
                  ) : (
                    <Stack gap="0">
                      {matches.map(({ node, path: p }) => (
                        <Button
                          key={node.cat.id.toString()}
                          variant="ghost"
                          size="sm"
                          justifyContent="flex-start"
                          colorPalette={node.cat.id === value ? "brand" : undefined}
                          data-testid={`category-node-${node.cat.name}`}
                          onClick={() => select(node.cat.id)}
                        >
                          <Text as="span" truncate>
                            {p.map((n) => n.cat.name).join(" › ")}
                          </Text>
                        </Button>
                      ))}
                    </Stack>
                  )}
                </Box>
              ) : (
                <HStack align="stretch" gap="0" overflowX="auto">
                  {columns.map((col, i) => (
                    <Box
                      key={i}
                      minW="180px"
                      maxH="280px"
                      overflowY="auto"
                      borderRightWidth={i < columns.length - 1 ? "1px" : "0"}
                      borderColor="border"
                    >
                      <Stack gap="0" p="1">
                        {col.length === 0 ? (
                          <Text p="2" fontSize="sm" color="fg.muted">
                            {t("catalog.categorySelect.emptyColumn")}
                          </Text>
                        ) : (
                          col.map((node) => {
                            const hasChildren = node.children.length > 0;
                            const drilled = path[i]?.cat.id === node.cat.id;
                            const selected = node.cat.id === value;

                            return (
                              <Flex key={node.cat.id.toString()} align="center" gap="0">
                                <Button
                                  flex="1"
                                  variant="ghost"
                                  size="sm"
                                  justifyContent="flex-start"
                                  colorPalette={selected || drilled ? "brand" : undefined}
                                  data-testid={`category-node-${node.cat.name}`}
                                  onClick={() =>
                                    leafOnly && hasChildren ? drill(i, node) : select(node.cat.id)
                                  }
                                >
                                  <Text as="span" truncate>
                                    {node.cat.name}
                                  </Text>
                                </Button>

                                {hasChildren && (
                                  <IconButton
                                    size="xs"
                                    variant="ghost"
                                    aria-label={`Open ${node.cat.name}`}
                                    data-testid={`category-drill-${node.cat.name}`}
                                    onClick={() => drill(i, node)}
                                  >
                                    <Icon as={ChevronRight} boxSize="4" />
                                  </IconButton>
                                )}
                              </Flex>
                            );
                          })
                        )}
                      </Stack>
                    </Box>
                  ))}
                </HStack>
              )}

              {value > 0n && (
                <>
                  <Box borderTopWidth="1px" borderColor="border" />
                  <HStack justify="flex-end">
                    <Button size="xs" variant="ghost" data-testid="category-clear" onClick={() => select(0n)}>
                      <Icon as={X} boxSize="3" />
                      {t("catalog.clear")}
                    </Button>
                  </HStack>
                </>
              )}
            </Stack>
          </Popover.Body>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}

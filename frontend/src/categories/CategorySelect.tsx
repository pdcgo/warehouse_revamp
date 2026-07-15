import { useEffect, useMemo, useState } from "react";
import { Box, Button, Flex, HStack, Icon, IconButton, Input, Popover, Spinner, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { categoryClient, rpcError } from "../api/clients";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { childrenByParent } from "./categoryTree";

export interface CategorySelectProps {
  /** Selected category id. 0n (the default) means top-level / none. */
  value?: bigint;
  onChange?: (id: bigint) => void;
  /** Label shown when nothing is selected (also the clear target). */
  placeholder?: string;
  /** A category id to omit — pass a node's own id when reparenting so it (and its subtree) can't be picked. */
  excludeId?: bigint;
  disabled?: boolean;
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
  "Nested-category picker (#63): a Popover with a breadcrumb trigger and cascading Miller columns over the global taxonomy. Emits a category id (0 = none).";

export function CategorySelect({
  value = 0n,
  onChange,
  placeholder = "Select category…",
  excludeId,
  disabled,
}: CategorySelectProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<CatNode[]>([]); // the drilled (non-selected) columns
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;

    categoryClient
      .categoryList({})
      .then((res) => {
        if (alive) setCategories(res.categories);
      })
      .catch((err) => {
        if (alive) setError(rpcError(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const forest = useMemo(() => buildForest(categories, excludeId), [categories, excludeId]);

  // On open: reset search and seed the columns from the current selection's ancestry.
  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    const p = value > 0n ? findPath(forest, value) : null;
    setPath(p ? p.slice(0, -1) : []);
  }, [open, value, forest]);

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
    return all.filter((m) => m.node.cat.name.toLowerCase().includes(q));
  }, [forest, query]);

  function select(id: bigint) {
    onChange?.(id);
    setOpen(false);
  }

  function drill(colIndex: number, node: CatNode) {
    setPath((prev) => [...prev.slice(0, colIndex), node]);
  }

  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: "bottom-start" }}>
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
            {pathLabel || placeholder}
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
                placeholder="Search category…"
                value={query}
                data-testid="category-search"
                onChange={(e) => setQuery(e.target.value)}
              />

              {loading ? (
                <Flex justify="center" py="4">
                  <Spinner size="sm" colorPalette="brand" />
                </Flex>
              ) : error ? (
                <Text p="2" fontSize="sm" color="red.fg">
                  {error}
                </Text>
              ) : query.trim() ? (
                <Box maxH="280px" overflowY="auto" minW="240px" data-testid="category-search-results">
                  {matches.length === 0 ? (
                    <Text p="2" fontSize="sm" color="fg.muted">
                      No categories found
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
                            Empty
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
                                  onClick={() => select(node.cat.id)}
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
                      Clear
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

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { categoryClient, rpcError } from "../api/clients";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { childrenByParent } from "../features/categories/categoryTree";
import { Button, IconButton } from "./ui/Button";
import { Input } from "./ui/Input";
import { Spinner } from "./ui/Spinner";
import { Popover } from "./ui/Popover";
import { cn } from "./ui/cn";

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
// the owner uses: a Popover whose trigger shows the selected path as a breadcrumb ("Parent › Child ›
// Grandchild"), and whose body is MULTISTAGE — cascading Miller columns where each category with
// children drills into a new column. A search box jumps to any matching node. Any node (not only
// leaves) is selectable — clicking a name selects it; a chevron drills without selecting.
//
// Rendered inline (NOT portalled) so it works inside modal dialogs (create/edit category), where a
// portalled popover renders outside the dialog and the modal makes it inert.
export const description =
  "Nested-category picker (#63): a Popover with a breadcrumb trigger and cascading Miller columns over the global taxonomy. Emits a category id (0 = none). Pass `leafOnly` to allow selecting only end (leaf) categories — parents then drill instead of select.";

export function CategorySelect({
  value = 0n,
  onChange,
  placeholder,
  excludeId,
  leafOnly = false,
  disabled,
}: CategorySelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("catalog.categorySelect.placeholder");
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
    return all.filter(
      (m) => m.node.cat.name.toLowerCase().includes(q) && (!leafOnly || m.node.children.length === 0),
    );
  }, [forest, query, leafOnly]);

  function select(id: bigint) {
    onChange?.(id);
    setOpen(false);
  }

  function drill(colIndex: number, node: CatNode) {
    setPath((prev) => [...prev.slice(0, colIndex), node]);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "bottom-start" }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          colorPalette="gray"
          disabled={disabled}
          data-testid="category-select"
          className="w-full justify-between font-normal"
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !pathLabel && "text-fg-muted")}>
            {pathLabel || resolvedPlaceholder}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </Popover.Trigger>

      {/* No Portal on purpose — see the component comment (works inside modal dialogs). */}
      <Popover.Positioner>
        <Popover.Content className="w-auto max-w-[90vw]">
          <div className="flex flex-col gap-2">
            <Input
              placeholder={t("catalog.categorySelect.searchPlaceholder")}
              value={query}
              data-testid="category-search"
              onChange={(e) => setQuery(e.target.value)}
            />

            {loading ? (
              <div className="flex justify-center py-4">
                <Spinner className="size-4" />
              </div>
            ) : error ? (
              <p className="p-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : query.trim() ? (
              <div
                className="max-h-[280px] min-w-[240px] overflow-y-auto"
                data-testid="category-search-results"
              >
                {matches.length === 0 ? (
                  <p className="p-2 text-sm text-fg-muted">{t("catalog.categorySelect.noResults")}</p>
                ) : (
                  <div className="flex flex-col">
                    {matches.map(({ node, path: p }) => (
                      <Button
                        key={node.cat.id.toString()}
                        variant="ghost"
                        size="sm"
                        colorPalette={node.cat.id === value ? "brand" : "gray"}
                        className="justify-start"
                        data-testid={`category-node-${node.cat.name}`}
                        onClick={() => select(node.cat.id)}
                      >
                        <span className="truncate">{p.map((n) => n.cat.name).join(" › ")}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-stretch overflow-x-auto">
                {columns.map((col, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-h-[280px] min-w-[180px] overflow-y-auto",
                      i < columns.length - 1 && "border-r border-line",
                    )}
                  >
                    <div className="flex flex-col p-1">
                      {col.length === 0 ? (
                        <p className="p-2 text-sm text-fg-muted">
                          {t("catalog.categorySelect.emptyColumn")}
                        </p>
                      ) : (
                        col.map((node) => {
                          const hasChildren = node.children.length > 0;
                          const drilled = path[i]?.cat.id === node.cat.id;
                          const selected = node.cat.id === value;

                          return (
                            <div key={node.cat.id.toString()} className="flex items-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                colorPalette={selected || drilled ? "brand" : "gray"}
                                className="flex-1 justify-start"
                                data-testid={`category-node-${node.cat.name}`}
                                onClick={() =>
                                  leafOnly && hasChildren ? drill(i, node) : select(node.cat.id)
                                }
                              >
                                <span className="truncate">{node.cat.name}</span>
                              </Button>

                              {hasChildren && (
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  aria-label={`Open ${node.cat.name}`}
                                  data-testid={`category-drill-${node.cat.name}`}
                                  onClick={() => drill(i, node)}
                                >
                                  <ChevronRight className="size-4" />
                                </IconButton>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {value > 0n && (
              <>
                <div className="border-t border-line" />
                <div className="flex justify-end">
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="gray"
                    data-testid="category-clear"
                    onClick={() => select(0n)}
                  >
                    <X className="size-3" />
                    {t("catalog.clear")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}

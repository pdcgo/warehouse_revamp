import { useEffect, useMemo, useState } from "react";
import { Select, Stack, createListCollection } from "@chakra-ui/react";
import { categoryClient, rpcError } from "../api/clients";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { childrenByParent, pathToRoot } from "./categoryTree";

interface CatOption {
  label: string;
  value: string;
}

export interface CategorySelectProps {
  /** Selected category id. 0n (the default) means top-level / none. */
  value?: bigint;
  onChange?: (id: bigint) => void;
  /** Label for the top-level / none option (also the empty-state text). */
  placeholder?: string;
  /** A category id to omit — pass a node's own id when reparenting so it can't select itself. */
  excludeId?: bigint;
  disabled?: boolean;
}

// CategorySelect is the shared nested-category picker (issue #34), MULTISTAGE since #63: instead of
// one flat indented dropdown it cascades — a Select per level, each showing the children of the
// level above. Picking a category at any level sets the value; if that category has children, a
// further Select appears so you can drill deeper (but you may stop at any level). It pre-fills every
// stage from `value` by walking up the tree.
//
// The Selects render INLINE (no Portal): this picker is used inside modal dialogs (create/edit
// category), and a portalled listbox renders outside the dialog where the modal makes it inert.
export const description =
  "Multistage nested-category picker: a cascading Select per level over the global taxonomy. Emits a category id (0 = top-level).";

export function CategorySelect({
  value = 0n,
  onChange,
  placeholder = "Top-level (no parent)",
  excludeId,
  disabled,
}: CategorySelectProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    categoryClient
      .categoryList({})
      .then((res) => {
        if (alive) setCategories(res.categories);
      })
      .catch((err) => {
        if (alive) setError(rpcError(err));
      });

    return () => {
      alive = false;
    };
  }, []);

  const children = useMemo(() => childrenByParent(categories), [categories]);
  const path = useMemo(() => pathToRoot(categories, value), [categories, value]);

  // The option collection for each possible parent level, keyed by parent id ("0" = top level).
  // These depend ONLY on the tree (not on the current selection), so they stay referentially stable
  // as the value changes — recreating a Chakra Select's collection every render makes the Select
  // reset/stay open and swallow the next click (which broke Save after drilling a level).
  const collections = useMemo(() => {
    const map = new Map<string, ReturnType<typeof createListCollection<CatOption>>>();
    const keys = new Set<string>(["0"]);
    for (const c of categories) {
      keys.add(c.id.toString());
    }

    for (const key of keys) {
      const opts = (children.get(key) ?? []).filter((c) => c.id !== excludeId);
      const items: CatOption[] = [
        ...(key === "0" ? [{ label: error ? "Categories unavailable" : placeholder, value: "0" }] : []),
        ...opts.map((c) => ({ label: c.name, value: c.id.toString() })),
      ];
      map.set(key, createListCollection<CatOption>({ items }));
    }

    return map;
  }, [categories, children, excludeId, placeholder, error]);

  // One stage per selected ancestor, plus a trailing empty stage to drill deeper when the current
  // leaf has (visible) children.
  const stages = useMemo(() => {
    const out: { parentKey: string; selectedId: bigint }[] = [];

    out.push({ parentKey: "0", selectedId: path[0]?.id ?? 0n });
    for (let k = 1; k < path.length; k++) {
      out.push({ parentKey: path[k - 1].id.toString(), selectedId: path[k].id });
    }

    const deepest = path[path.length - 1];
    if (deepest) {
      const kids = (children.get(deepest.id.toString()) ?? []).filter((c) => c.id !== excludeId);
      if (kids.length > 0) {
        out.push({ parentKey: deepest.id.toString(), selectedId: 0n });
      }
    }

    return out;
  }, [path, children, excludeId]);

  return (
    <Stack gap="1" data-testid="category-select-stages">
      {stages.map((stage, si) => {
        const collection = collections.get(stage.parentKey) ?? createListCollection<CatOption>({ items: [] });

        // A deeper stage with no options shouldn't appear; stage 0 always shows (it carries the
        // top-level / none option, so its collection is never empty).
        if (si > 0 && collection.items.length === 0) {
          return null;
        }

        const selectedValue =
          stage.selectedId !== 0n ? [stage.selectedId.toString()] : si === 0 ? ["0"] : [];

        return (
          <Select.Root
            key={si}
            collection={collection}
            disabled={disabled}
            value={selectedValue}
            onValueChange={(e) => onChange?.(BigInt(e.value[0] ?? "0"))}
          >
            <Select.HiddenSelect />

            <Select.Control>
              <Select.Trigger data-testid={si === 0 ? "category-select" : `category-select-${si}`}>
                <Select.ValueText placeholder={si === 0 ? placeholder : "Choose subcategory…"} />
              </Select.Trigger>
              <Select.IndicatorGroup>
                <Select.Indicator />
              </Select.IndicatorGroup>
            </Select.Control>

            <Select.Positioner>
              <Select.Content>
                {collection.items.map((item) => (
                  <Select.Item item={item} key={item.value}>
                    <Select.ItemText>{item.label}</Select.ItemText>
                    <Select.ItemIndicator />
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Positioner>
          </Select.Root>
        );
      })}
    </Stack>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Box, Portal, Select, createListCollection } from "@chakra-ui/react";
import { categoryClient, rpcError } from "../api/clients";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { flattenTree } from "./categoryTree";

// 0n means "no parent" — a top-level category. The Select works in strings, so 0n is the string "0".
const TOP_LEVEL = "0";

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

// CategorySelect is the shared nested-category picker (issue #34). It loads the GLOBAL category tree
// once, flattens it to depth-annotated rows, and renders each option indented by its depth so the
// hierarchy is visible in the dropdown. It always offers a "top-level / none" option (value 0n).
//
// It uses Chakra's composable `Select` (createListCollection + Select.Root/…/Item) rather than a
// NativeSelect: a native <option> can only fake indentation with padding spaces, whereas a composed
// item can carry real per-depth indentation — which is the whole point of a nested picker.
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

  const collection = useMemo(() => {
    const items = [
      { label: placeholder, value: TOP_LEVEL, depth: 0 },
      ...flattenTree(categories)
        .filter((node) => node.category.id !== excludeId)
        .map((node) => ({
          label: node.category.name,
          value: node.category.id.toString(),
          depth: node.depth,
        })),
    ];

    return createListCollection({ items });
  }, [categories, excludeId, placeholder]);

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={[value.toString()]}
      onValueChange={(e) => onChange?.(BigInt(e.value[0] ?? TOP_LEVEL))}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="category-select">
          <Select.ValueText placeholder={error ? "Categories unavailable" : placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      <Portal>
        <Select.Positioner>
          <Select.Content>
            {collection.items.map((item) => (
              <Select.Item item={item} key={item.value}>
                <Select.ItemText>
                  <Box as="span" ps={item.depth * 4} color={item.depth === 0 ? "fg" : "fg.muted"}>
                    {item.depth > 0 ? "— " : ""}
                    {item.label}
                  </Box>
                </Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}

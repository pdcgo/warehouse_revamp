import { type ReactNode, useEffect, useState } from "react";
import { Combobox, Flex, Tag, useComboboxContext, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { searchOnlyWhatIsTyped } from "../../../lib/comboboxSearch";
import { RestockTagChip } from "../../restock/RestockTagChips";
import type { OrderTag } from "./orderTags";

// THE TAG FILTER on both order lists (backlog #100, live: the-order-tags-prototype-is-accepted — its pick goes to the
// server as `tag_ids`, inside the list's one scope). A COPY of the restock lists' RestockTagFilter (several tags, an order
// shown when it carries ANY of them), with the orders' test ids and words — the restock file is left untouched. It
// searches the ORDERS' one list — every team's order tags, system and custom (orders-have-their-own-tag-list: the
// restock tags' rules on the orders' own list; a restock tag is never offered here). Each option is drawn as the chip it
// is on the rows, ✓ when picked; up to three picks' chips and "+N" in the box, × takes them all, nothing picked reads
// "Semua tag". Inline, not portalled — it lives in the phone's filter sheet too.

export function OrderTagFilter({
  tags,
  value,
  onChange,
  placeholder,
}: {
  /** The orders' one list — the system's first, then by name. */
  tags: OrderTag[];
  /** The picked tags' ids; empty is "any tag". */
  value: bigint[];
  onChange: (tagIds: bigint[]) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();

  const { collection, filter, set } = useListCollection<OrderTag>({
    initialItems: tags,
    itemToString: (tag) => tag.name,
    itemToValue: (tag) => tag.id.toString(),
    filter: (itemText, filterText) => {
      const needle = filterText.trim().toLowerCase();
      return needle === "" || itemText.toLowerCase().includes(needle);
    },
  });

  // Flips once the list is in the collection, so picks restored from the URL show their names (ShipmentChannelSelect's fix).
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    set(tags);
    setSeeded(true);
  }, [set, tags]);

  return (
    <Combobox.Root
      key={seeded ? "ready" : "seeding"}
      multiple
      selectionBehavior="clear"
      closeOnSelect={false}
      openOnClick
      collection={collection}
      value={value.map(String)}
      onValueChange={(e) => onChange(e.value.map((v) => BigInt(v)))}
      {...searchOnlyWhatIsTyped(filter)}
      data-testid="order-tag-filter-select"
    >
      <Combobox.Control
        display="flex"
        alignItems="center"
        gap="1"
        minH="9"
        ps="2"
        pe="1"
        borderWidth="1px"
        borderColor="border"
        borderRadius="l2"
        bg="bg"
        _hover={{ borderColor: "border.fieldHover" }}
        _focusWithin={{ borderColor: "brand.focusRing" }}
      >
        <Picks tags={tags} value={value}>
          <Combobox.Input
            flex="1"
            minW="2.5rem"
            minH="0"
            h="7"
            px="1"
            border="none"
            bg="transparent"
            focusVisibleRing="none"
            _focusVisible={{ borderColor: "transparent" }}
            _hover={{ borderColor: "transparent" }}
            placeholder={value.length === 0 ? (placeholder ?? t("orders.tags.filterAll")) : undefined}
            aria-label={t("orders.tags.filterSearch")}
            data-testid="order-tag-filter-input"
          />
        </Picks>
        <Combobox.IndicatorGroup position="static" flexShrink="0">
          {value.length > 0 && <Combobox.ClearTrigger data-testid="order-tag-filter-clear" />}
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>{tags.length === 0 ? t("orders.tags.filterEmpty") : t("orders.tags.noMatch")}</Combobox.Empty>
          {collection.items.map((tag) => (
            <Combobox.Item item={tag} key={tag.id.toString()} data-testid={`order-tag-filter-option-${tag.id}`}>
              <RestockTagChip tag={tag} maxW="14rem" />
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

const SHOWN = 3;

/** The picks inside the field: up to three chips, "+N" past them (hover names the rest), the typing after them. */
function Picks({ tags, value, children }: { tags: OrderTag[]; value: bigint[]; children: ReactNode }) {
  const combobox = useComboboxContext();

  // A pick the list does not hold (yet) is not drawn — its id is still sent; the list fills it in when it lands.
  const picked = value.map((id) => tags.find((tag) => tag.id === id)).filter((tag): tag is OrderTag => tag !== undefined);
  const shown = picked.slice(0, SHOWN);
  const rest = picked.slice(SHOWN);

  return (
    <Flex
      flex="1"
      minW="0"
      wrap="wrap"
      align="center"
      gap="1"
      py="0.5"
      cursor="pointer"
      onClick={() => combobox.setOpen(true)}
      data-testid="order-tag-filter-picks"
    >
      {shown.map((tag) => (
        <RestockTagChip key={tag.id.toString()} tag={tag} maxW="8rem" testId={`order-tag-filter-pick-${tag.id}`} />
      ))}
      {rest.length > 0 && (
        <Tag.Root
          size="md"
          variant="subtle"
          colorPalette="gray"
          flexShrink={0}
          title={rest.map((tag) => tag.name).join(", ")}
          data-testid="order-tag-filter-more"
        >
          <Tag.Label>+{rest.length}</Tag.Label>
        </Tag.Root>
      )}
      {children}
    </Flex>
  );
}

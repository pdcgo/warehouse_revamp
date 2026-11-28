import { useMemo, useState } from "react";
import { Button, Combobox, Flex, HStack, Icon, Portal, Span, Stack, Text, createListCollection } from "@chakra-ui/react";
import { Lock, Plus, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionEmpty } from "../../../components/chrome/DetailSection";
import { RestockTagChip } from "../../restock/RestockTagChips";
import type { ProductTag, ProductTagType, ProductTagsApi } from "./productTags";
import { cleanTagName, isAppTag, tagNameKey, tagNamed } from "./productTags";
import { ProductTagManageDialog } from "./ProductTagManageDialog";

// THE TAGS BOX of a product's page — its Tag card (backlog #148, live: the-team-code-and-product-tags-prototype-is-accepted).
// A COPY of the restock detail's RestockTagsBox (the-restock-tags-prototype-is-accepted) with the products' test ids and
// words — the order page's box is the same copy (the-order-tags-prototype-is-accepted). The tags are the product's own
// (`Product.tags` on ProductDetail); every change goes to ProductService's ProductTag* RPCs (tagQueries.ts) and the page
// re-reads.
//
//   ┌ 🏷 Tag ──────────────────────────────────────────────┐
//   │ [🔒 need_reprint_code] [Promo Lebaran ×]              │   ← the system's first, locked; a custom one has its ×
//   │ [ Tambah tag…                                    ⌄ ] │   ← the products' one list, searched as you type
//   │ Tim pemilik dan gudang yang menyimpan stoknya …       │
//   └──────────────────────────────────────────────────────┘
//
// The rules it plays (products-have-their-own-tag-list + its 🔄 lines):
//   · ONE PRODUCT LIST, ONE NAME ONE TAG: typing searches every team's PRODUCT tags (never a restock's or an order's); a
//     name nobody has used offers *Buat tag "…"*; a name that exists, in any case, offers THAT tag first — never a twin;
//   · A SYSTEM TAG IS THE ADMINS' AND THE APP'S: a team's writer sees it locked (no ×) and finds one only greyed in the
//     add list; Root / the Administrator get its × and *Buat tag sistem "…"*. The APP's own — `need_reprint_code`, put on
//     by the team code change and taken off by the warehouses' reprint — stays locked for an admin too;
//   · WHO MAY TAG: the product's writers (ProductUpdate's roles — the selling Owner and Admin, Root, the Administrator),
//     never a monitor; everyone else who reads the page (the team's Staff and CS) sees the chips read-only;
//   · RENAME AND DELETE ARE THE ADMINS': only Root / the Administrator see *Kelola tag* (ProductTagManageDialog).


export function ProductTagsBox({ productId, tags, api }: { productId: bigint; tags: ProductTag[]; api: ProductTagsApi }) {
  const { t } = useTranslation();
  const [managing, setManaging] = useState(false);
  const hasSystem = tags.some((tag) => tag.type === "SYSTEM");

  // A custom tag comes off by anyone who may tag; a system tag only by an admin — and the app's own (`need_reprint_code`)
  // by nobody here: the warehouses' reprint takes it off (isAppTag).
  const removable = (tag: ProductTag) => api.writable && (tag.type === "CUSTOM" || (api.admin && !isAppTag(tag)));

  const hint = api.admin
    ? t("products.tags.adminHint")
    : hasSystem
      ? `${t("products.tags.shared")} ${t("products.tags.lockedHint")}`
      : t("products.tags.shared");

  return (
    <Stack gap="3" data-testid="product-tags-box">
      {tags.length === 0 ? (
        <SectionEmpty>{t("products.tags.none")}</SectionEmpty>
      ) : (
        <HStack gap="2" wrap="wrap" data-testid="product-tags">
          {tags.map((tag) => (
            <RestockTagChip
              key={tag.id.toString()}
              tag={tag}
              maxW="full"
              onRemove={removable(tag) ? () => void api.remove(productId, tag) : undefined}
              testId={`product-tag-${tag.id}`}
            />
          ))}
        </HStack>
      )}

      {api.writable && <TagAdder productId={productId} on={tags} api={api} />}

      <Flex align="center" gap="2" wrap="wrap">
        <Text fontSize="xs" color="fg.muted" flex="1" minW="12rem" data-testid="product-tags-hint">
          {hint}
        </Text>
        {api.admin && (
          <Button size="xs" variant="outline" colorPalette="gray" onClick={() => setManaging(true)} data-testid="product-tag-manage">
            <Icon as={Settings2} boxSize="4" />
            {t("products.tags.manage.open")}
          </Button>
        )}
      </Flex>

      {api.admin && <ProductTagManageDialog api={api} open={managing} onOpenChange={setManaging} />}
    </Stack>
  );
}

type AddOption =
  | { kind: "tag"; tag: ProductTag; locked: false | "admin" | "app" }
  | { kind: "on"; tag: ProductTag }
  | { kind: "create"; type: ProductTagType; name: string };

function optionValue(option: AddOption): string {
  if (option.kind === "create") return `create:${option.type}`;
  return `${option.kind}:${option.tag.id}`;
}

function optionText(option: AddOption): string {
  return option.kind === "create" ? option.name : option.tag.name;
}

/**
 * THE ADD BOX — a combobox over the products' one list, the product's own tags left out. Its options, in order: the tag whose
 * name IS what was typed (any case) first, then the others that contain it; then, only when no tag has that name, the
 * create(s). A pick puts the tag on at once and empties the field for the next.
 */
function TagAdder({ productId, on, api }: { productId: bigint; on: ProductTag[]; api: ProductTagsApi }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");

  const options = useMemo<AddOption[]>(() => {
    const key = tagNameKey(typed);
    const onIds = new Set(on.map((tag) => tag.id.toString()));
    const exact = tagNamed(api.catalogue, typed);
    const matching = api.catalogue.filter((tag) => key === "" || tagNameKey(tag.name).includes(key));
    const ordered = exact ? [exact, ...matching.filter((tag) => tag.id !== exact.id)] : matching;

    const out: AddOption[] = [];

    for (const tag of ordered) {
      // The app's own tags are put on by the app alone; another system tag by an admin alone.
      const locked = isAppTag(tag) ? "app" : tag.type === "SYSTEM" && !api.admin ? "admin" : false;

      if (onIds.has(tag.id.toString())) {
        // Only the one named exactly is said to be on already — the answer to "why is there no Create?".
        if (exact && tag.id === exact.id) out.push({ kind: "on", tag });
        continue;
      }

      // A team's user is shown a system tag only once they type toward it, greyed — never as a list of things they may
      // not pick.
      if (locked && key === "") continue;

      out.push({ kind: "tag", tag, locked });
    }

    if (!exact && key !== "") {
      out.push({ kind: "create", type: "CUSTOM", name: cleanTagName(typed) });
      if (api.admin) out.push({ kind: "create", type: "SYSTEM", name: cleanTagName(typed) });
    }

    return out;
  }, [typed, on, api.catalogue, api.admin]);

  const collection = useMemo(
    () =>
      createListCollection<AddOption>({
        items: options,
        itemToValue: optionValue,
        itemToString: optionText,
        isItemDisabled: (option) => option.kind === "on" || (option.kind === "tag" && option.locked !== false),
      }),
    [options],
  );

  // A pick puts the tag on at once; a create makes it first — or gets the tag that already has the name, never a twin.
  const pick = async (value: string | undefined) => {
    const option = options.find((o) => optionValue(o) === value);
    if (!option || (option.kind !== "tag" && option.kind !== "create")) return;

    setTyped("");
    const tag = option.kind === "tag" ? option.tag : await api.create(option.name, option.type);
    if (tag) await api.add(productId, tag);
  };

  return (
    <Combobox.Root
      collection={collection}
      inputValue={typed}
      onInputValueChange={(e) => setTyped(e.inputValue)}
      value={[]}
      onValueChange={(e) => void pick(e.value[0])}
      openOnClick
      selectionBehavior="clear"
      inputBehavior="autohighlight"
      data-testid="product-tag-add"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={t("products.tags.add")} aria-label={t("products.tags.addLabel")} data-testid="product-tag-add-input" />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content data-testid="product-tag-add-options">
            <Combobox.Empty>{t("products.tags.typeToCreate")}</Combobox.Empty>
            {options.map((option) => (
              <Combobox.Item item={option} key={optionValue(option)} data-testid={addOptionTestId(option)}>
                <AddOptionLabel option={option} />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

function addOptionTestId(option: AddOption): string {
  if (option.kind === "create") return `product-tag-add-create-${option.type.toLowerCase()}`;
  return option.kind === "on" ? `product-tag-add-on-${option.tag.id}` : `product-tag-add-option-${option.tag.id}`;
}

function AddOptionLabel({ option }: { option: AddOption }) {
  const { t } = useTranslation();

  if (option.kind === "create") {
    const system = option.type === "SYSTEM";

    return (
      <Flex align="center" gap="2" minW="0">
        <Icon as={system ? Lock : Plus} boxSize="4" color={system ? "purple.fg" : "fg.muted"} flexShrink={0} />
        <Span truncate>
          {system ? t("products.tags.createSystem", { name: option.name }) : t("products.tags.createCustom", { name: option.name })}
        </Span>
      </Flex>
    );
  }

  const note =
    option.kind === "on"
      ? t("products.tags.alreadyOn")
      : option.locked === "app"
        ? t("products.tags.byApp")
        : option.locked === "admin"
          ? t("products.tags.adminOnly")
          : undefined;

  return (
    <Flex align="center" gap="2" minW="0" w="full">
      <RestockTagChip tag={option.tag} maxW="14rem" />
      {note && (
        <Text fontSize="xs" color="fg.muted" truncate>
          {note}
        </Text>
      )}
    </Flex>
  );
}

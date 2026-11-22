import { useMemo, useState } from "react";
import { Button, Combobox, Flex, HStack, Icon, Portal, Span, Stack, Text, createListCollection } from "@chakra-ui/react";
import { Lock, Plus, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionEmpty } from "../../../components/chrome/DetailSection";
import { RestockTagChip } from "../../restock/RestockTagChips";
import type { OrderTag, OrderTagType } from "./orderTags";
import { cleanTagName, tagNameKey, tagNamed } from "./orderTags";
import type { OrderTagsApi } from "./tagQueries";
import { OrderTagManageDialog } from "./OrderTagManageDialog";

// THE TAGS BOX of an order's pages — the seller's detail, the warehouse's detail and its pick page alike (backlog #100,
// live: the-order-tags-prototype-is-accepted). A COPY of the restock details' RestockTagsBox with the orders' test ids and
// words, and without the app's locked tags (no app-owned order tags for now). The tags are the order's own (Order.tags);
// every change goes to OrderService (tagQueries.ts) and the page re-reads.
//
//   ┌ 🏷 Tag ─────────────────────────────────────────────┐
//   │ [🔒 Audit Admin] [Kemasan Ulang ×] [VIP ×]           │   ← the system's first, locked; a custom one has its ×
//   │ [ Tambah tag…                                  ⌄ ] │   ← the orders' one list, searched as you type
//   │ Tim penjual dan gudang pengirim melihat tag yang sama. │
//   └─────────────────────────────────────────────────────┘
//
// The rules it plays (docs/business/order/context_decision.md, orders-have-their-own-tag-list + its 🔄 lines — the
// restock tags' rules on the orders' own list):
//   · ONE ORDER LIST, ONE NAME ONE TAG: typing searches every team's ORDER tags (never a restock's); a name nobody has
//     used offers *Buat tag "…"*; a name that exists, in any case, offers THAT tag first and no create — never a twin;
//   · A SYSTEM TAG IS THE ADMINS': a team's user sees it locked (no ×) and finds one only greyed in the add list, saying
//     only an admin can put it on; Root / the Administrator get its ×, see system tags offered, and a second create,
//     *Buat tag sistem "…"*. There are no app-owned order tags for now, so nothing is locked for an admin;
//   · WHO MAY TAG: anyone the screen lets write on the order — every role on the selling side or the shipping
//     warehouse's but a monitor, in EVERY status; a custom tag comes off by anyone who may tag, whoever put it on. A
//     reader that is neither side (the root team, a return warehouse that does not ship it) sees the tags read-only;
//   · RENAME AND DELETE ARE THE ADMINS': only Root / the Administrator see *Kelola tag* (OrderTagManageDialog).

export function OrderTagsBox({ orderId, tags, api }: { orderId: bigint; tags: OrderTag[]; api: OrderTagsApi }) {
  const { t } = useTranslation();
  const [managing, setManaging] = useState(false);
  const hasSystem = tags.some((tag) => tag.type === "SYSTEM");

  // A custom tag comes off by anyone who may tag; a system tag only by an admin.
  const removable = (tag: OrderTag) => api.writable && (tag.type === "CUSTOM" || api.admin);

  const hint = api.admin
    ? t("orders.tags.adminHint")
    : hasSystem
      ? `${t("orders.tags.shared")} ${t("orders.tags.lockedHint")}`
      : t("orders.tags.shared");

  return (
    <Stack gap="3" data-testid="order-tags-box">
      {tags.length === 0 ? (
        <SectionEmpty>{t("orders.tags.none")}</SectionEmpty>
      ) : (
        <HStack gap="2" wrap="wrap" data-testid="order-tags">
          {tags.map((tag) => (
            <RestockTagChip
              key={tag.id.toString()}
              tag={tag}
              maxW="full"
              onRemove={removable(tag) ? () => void api.remove(orderId, tag) : undefined}
              testId={`order-tag-${tag.id}`}
            />
          ))}
        </HStack>
      )}

      {api.writable && <TagAdder orderId={orderId} on={tags} api={api} />}

      <Flex align="center" gap="2" wrap="wrap">
        <Text fontSize="xs" color="fg.muted" flex="1" minW="12rem" data-testid="order-tags-hint">
          {hint}
        </Text>
        {api.admin && (
          <Button size="xs" variant="outline" colorPalette="gray" onClick={() => setManaging(true)} data-testid="order-tag-manage">
            <Icon as={Settings2} boxSize="4" />
            {t("orders.tags.manage.open")}
          </Button>
        )}
      </Flex>

      {api.admin && <OrderTagManageDialog api={api} open={managing} onOpenChange={setManaging} />}
    </Stack>
  );
}

type AddOption =
  | { kind: "tag"; tag: OrderTag; locked: boolean }
  | { kind: "on"; tag: OrderTag }
  | { kind: "create"; type: OrderTagType; name: string };

function optionValue(option: AddOption): string {
  if (option.kind === "create") return `create:${option.type}`;
  return `${option.kind}:${option.tag.id}`;
}

function optionText(option: AddOption): string {
  return option.kind === "create" ? option.name : option.tag.name;
}

/**
 * THE ADD BOX — a combobox over the orders' one list, the order's own tags left out. Its options, in order: the tag whose
 * name IS what was typed (any case) first, then the others that contain it; then, only when no tag has that name, the
 * create(s). A pick puts the tag on at once and empties the field for the next.
 */
function TagAdder({ orderId, on, api }: { orderId: bigint; on: OrderTag[]; api: OrderTagsApi }) {
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
      // A system tag is put on by an admin alone.
      const locked = tag.type === "SYSTEM" && !api.admin;

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
        isItemDisabled: (option) => option.kind === "on" || (option.kind === "tag" && option.locked),
      }),
    [options],
  );

  // A pick puts the tag on at once; a create makes it first — or gets the tag that already has the name, never a twin.
  const pick = async (value: string | undefined) => {
    const option = options.find((o) => optionValue(o) === value);
    if (!option || (option.kind !== "tag" && option.kind !== "create")) return;

    setTyped("");
    const tag = option.kind === "tag" ? option.tag : await api.create(option.name, option.type);
    if (tag) await api.add(orderId, tag);
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
      data-testid="order-tag-add"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={t("orders.tags.add")} aria-label={t("orders.tags.addLabel")} data-testid="order-tag-add-input" />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content data-testid="order-tag-add-options">
            <Combobox.Empty>{t("orders.tags.typeToCreate")}</Combobox.Empty>
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
  if (option.kind === "create") return `order-tag-add-create-${option.type.toLowerCase()}`;
  return option.kind === "on" ? `order-tag-add-on-${option.tag.id}` : `order-tag-add-option-${option.tag.id}`;
}

function AddOptionLabel({ option }: { option: AddOption }) {
  const { t } = useTranslation();

  if (option.kind === "create") {
    const system = option.type === "SYSTEM";

    return (
      <Flex align="center" gap="2" minW="0">
        <Icon as={system ? Lock : Plus} boxSize="4" color={system ? "purple.fg" : "fg.muted"} flexShrink={0} />
        <Span truncate>
          {system ? t("orders.tags.createSystem", { name: option.name }) : t("orders.tags.createCustom", { name: option.name })}
        </Span>
      </Flex>
    );
  }

  const note = option.kind === "on" ? t("orders.tags.alreadyOn") : option.locked ? t("orders.tags.adminOnly") : undefined;

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

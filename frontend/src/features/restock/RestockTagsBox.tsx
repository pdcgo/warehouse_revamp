import { useMemo, useState } from "react";
import { Button, Combobox, Flex, HStack, Icon, Portal, Span, Stack, Text, createListCollection } from "@chakra-ui/react";
import { Lock, Plus, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionEmpty } from "../../components/chrome/DetailSection";
import { RestockTagChip } from "./RestockTagChips";
import type { RestockTag, RestockTagType } from "./restockTags";
import { cleanTagName, isAppTag, tagNameKey, tagNamed } from "./restockTags";
import type { RestockTagsApi } from "./tagQueries";
import { RestockTagManageDialog } from "./RestockTagManageDialog";

// THE TAGS BOX of a restock's detail page — the selling team's and the warehouse's alike (backlog #87, live since
// the-restock-tags-prototype-is-accepted). The tags are the restock's own (`RestockRequest.tags`, as Detail reads them);
// every change goes to the server (tagQueries.ts) and the page re-reads.
//
//   ┌ 🏷 Tag ───────────────────────────────────────┐
//   │ [🔒 Diperiksa Admin] [Lebaran 2026 ×] [Prioritas ×] │   ← the system's first, locked; a custom one has its ×
//   │ [ Tambah tag…                           ⌄ ]   │   ← the app-wide list, searched as you type
//   │ Tag restok terlihat oleh penjual dan gudang.  │
//   └───────────────────────────────────────────────┘
//
// The rules it plays (docs/business/inventory/restock_decision.md):
//   · ONE APP-WIDE LIST, ONE NAME ONE TAG (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): typing searches
//     every team's tags; a name nobody has used offers *Buat tag "…"*; a name that exists, in any case, offers THAT tag
//     first and no create — "prioritas" puts the existing *Prioritas* on, it never makes a twin;
//   · A SYSTEM TAG IS THE ADMINS' AND THE APP'S: a team's user sees it locked (no ×), and finds one only greyed in the
//     add list, saying only an admin can put it on; Root / the Administrator get its ×, see system tags offered, and a
//     second create, *Buat tag sistem "…"*. The APP's own — the problem tags, put on at Terima
//     (a-restock-problem-is-a-system-tag) — stay locked for an admin too: when they come off is not decided;
//   · WHO MAY TAG: anyone the screen lets write on the restock — every role on either side but a monitor, in EVERY status
//     (the owner's 🔄 under the-restock-tags-prototype-is-accepted, as the-note-is-edited-in-any-status); a custom tag
//     comes off by anyone who may tag, whoever put it on — a restock's tags are the restock's, one set for both sides;
//   · RENAME AND DELETE ARE THE ADMINS' (the owner, 2026-11-18, a 🔄 line under the same decision): only Root / the
//     Administrator see *Kelola tag*, which opens the app-wide list with its rename and delete (RestockTagManageDialog).

export function RestockTagsBox({ requestId, tags, api }: { requestId: bigint; tags: RestockTag[]; api: RestockTagsApi }) {
  const { t } = useTranslation();
  const [managing, setManaging] = useState(false);
  const hasSystem = tags.some((tag) => tag.type === "SYSTEM");

  // A custom tag comes off by anyone who may tag; a system tag only by an admin — and the app's own (the problem tags)
  // by nobody here: when they come off waits on the problem's solution (isAppTag).
  const removable = (tag: RestockTag) => api.writable && (tag.type === "CUSTOM" || (api.admin && !isAppTag(tag)));

  const hint = api.admin
    ? t("restock.tags.adminHint")
    : hasSystem
      ? `${t("restock.tags.shared")} ${t("restock.tags.lockedHint")}`
      : t("restock.tags.shared");

  return (
    <Stack gap="3" data-testid="restock-tags-box">
      {tags.length === 0 ? (
        <SectionEmpty>{t("restock.tags.none")}</SectionEmpty>
      ) : (
        <HStack gap="2" wrap="wrap" data-testid="restock-tags">
          {tags.map((tag) => (
            <RestockTagChip
              key={tag.id.toString()}
              tag={tag}
              maxW="full"
              onRemove={removable(tag) ? () => void api.remove(requestId, tag) : undefined}
              testId={`restock-tag-${tag.id}`}
            />
          ))}
        </HStack>
      )}

      {api.writable && <TagAdder requestId={requestId} on={tags} api={api} />}

      <Flex align="center" gap="2" wrap="wrap">
        <Text fontSize="xs" color="fg.muted" flex="1" minW="12rem" data-testid="restock-tags-hint">
          {hint}
        </Text>
        {api.admin && (
          <Button size="xs" variant="outline" colorPalette="gray" onClick={() => setManaging(true)} data-testid="restock-tag-manage">
            <Icon as={Settings2} boxSize="4" />
            {t("restock.tags.manage.open")}
          </Button>
        )}
      </Flex>

      {api.admin && <RestockTagManageDialog api={api} open={managing} onOpenChange={setManaging} />}
    </Stack>
  );
}

type AddOption =
  | { kind: "tag"; tag: RestockTag; locked: false | "admin" | "app" }
  | { kind: "on"; tag: RestockTag }
  | { kind: "create"; type: RestockTagType; name: string };

function optionValue(option: AddOption): string {
  if (option.kind === "create") return `create:${option.type}`;
  return `${option.kind}:${option.tag.id}`;
}

function optionText(option: AddOption): string {
  return option.kind === "create" ? option.name : option.tag.name;
}

/**
 * THE ADD BOX — a combobox over the app-wide list, the restock's own tags left out. Its options, in order: the tag whose
 * name IS what was typed (any case) first, then the others that contain it; then, only when no tag has that name, the
 * create(s). A pick puts the tag on at once and empties the field for the next.
 */
function TagAdder({ requestId, on, api }: { requestId: bigint; on: RestockTag[]; api: RestockTagsApi }) {
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
    if (tag) await api.add(requestId, tag);
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
      data-testid="restock-tag-add"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={t("restock.tags.add")} aria-label={t("restock.tags.addLabel")} data-testid="restock-tag-add-input" />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content data-testid="restock-tag-add-options">
            <Combobox.Empty>{t("restock.tags.typeToCreate")}</Combobox.Empty>
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
  if (option.kind === "create") return `restock-tag-add-create-${option.type.toLowerCase()}`;
  return option.kind === "on" ? `restock-tag-add-on-${option.tag.id}` : `restock-tag-add-option-${option.tag.id}`;
}

function AddOptionLabel({ option }: { option: AddOption }) {
  const { t } = useTranslation();

  if (option.kind === "create") {
    const system = option.type === "SYSTEM";

    return (
      <Flex align="center" gap="2" minW="0">
        <Icon as={system ? Lock : Plus} boxSize="4" color={system ? "purple.fg" : "fg.muted"} flexShrink={0} />
        <Span truncate>
          {system ? t("restock.tags.createSystem", { name: option.name }) : t("restock.tags.createCustom", { name: option.name })}
        </Span>
      </Flex>
    );
  }

  const note =
    option.kind === "on"
      ? t("restock.tags.alreadyOn")
      : option.locked === "app"
        ? t("restock.tags.byApp")
        : option.locked === "admin"
          ? t("restock.tags.adminOnly")
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

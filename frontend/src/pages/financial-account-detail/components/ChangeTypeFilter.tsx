import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Combobox, Flex, useComboboxContext, useFilter, useListCollection } from "@chakra-ui/react";

import { ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { CHANGE_TYPES, CHANGE_TYPE_KEY, CHANGE_TYPE_PALETTE } from "../../../features/financialAccount/vocab";
import type { FinancialAccountChangeType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { searchOnlyWhatIsTyped } from "../../../lib/comboboxSearch";

interface TypeItem {
  label: string;
  value: string;
}

// THE STATEMENT'S TYPES, SEVERAL AT ONCE (owner: *"multi select saja, bisa search, dan badge berwarna sesuai di
// tabel"*, `the-statement-filters-several-types`) — the contract's `change_types` is a list, and Biaya + Iklan together
// is the question "what did we spend"; one-at-a-time threw that away.
//
//   a search select   type to narrow the nine (`searchOnlyWhatIsTyped`: a pick or a reopen starts over)
//   the options       each the type's own badge, the colour the statement's Jenis column wears, ✓ when picked
//   the picks         up to four picks' badges, whole (owner: *"tampilkan maksimal 3 …"*, then *"maksimalnya tambah 1
//                     jadi 4"*; *"jangan ellipsis, boleh 2/3 line"*), and "+N" past four — so the field is a field's height
//                     empty and with one pick, and at most three lines however many are picked (it was 320×46 empty
//                     and grew a line per two picks). A click on them opens the list, where a pick is taken back by
//                     its ✓; the field's × takes them all. Nothing picked reads "Semua jenis".
//   the height        36px to start, the date field's (owner: *"insialnya tinggi sama"*) — the input drops the recipe's
//                     own 36px minimum, which inside a bordered box made the field 42.
//   × and ⌄           OUTSIDE the box the picks wrap in (owner: *"closeable dan selector iconnya tidak masuk ke
//                     containernya selected"*) — they hold the field's right edge, and a badge never wraps under them.
//
// The field's box is the CONTROL, drawn as every field is (thin border, the field hover and focus): the input inside it
// is bare, so the picks and the typing share one box. Inline, not portalled — it lives in the phone's filter sheet too.
export function ChangeTypeFilter({
  value,
  onChange,
}: {
  value: FinancialAccountChangeType[];
  onChange: (changeTypes: FinancialAccountChangeType[]) => void;
}) {
  const { t, i18n } = useTranslation();

  const items: TypeItem[] = useMemo(
    () => CHANGE_TYPES.map((c) => ({ label: t(CHANGE_TYPE_KEY[c]!), value: String(c) })),
    [t],
  );
  // ⚠ ARK FILTERS ONLY WITH A MATCHER. `useListCollection` without `filter` keeps every item whatever is typed — the
  // field looked like a search and searched nothing. `contains`, case- and accent-blind.
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection<TypeItem>({
    initialItems: items,
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    filter: contains,
  });

  return (
    <Combobox.Root
      // The labels are the language's — a switch remounts the collection with the new names.
      key={i18n.language}
      multiple
      collection={collection}
      selectionBehavior="clear"
      closeOnSelect={false}
      openOnClick
      {...searchOnlyWhatIsTyped(filter)}
      value={value.map(String)}
      onValueChange={(e) => onChange(e.value.map((v) => Number(v) as FinancialAccountChangeType))}
    >
      <Combobox.Control
        display="flex"
        alignItems="center"
        gap="1"
        // A field's 36px while it holds one line; taller only when the badges wrap.
        minH="9"
        ps="2"
        pe="1"
        borderWidth="1px"
        borderColor="border"
        borderRadius="l2"
        bg="bg"
        _hover={{ borderColor: "border.fieldHover" }}
        _focusWithin={{ borderColor: "brand.focusRing" }}
        data-testid="account-log-type-field"
      >
        <Picks value={value}>
          <Combobox.Input
            flex="1"
            minW="2.5rem"
            // The recipe's own 36px minimum, inside a bordered box, made the field 42 — the date beside it is 36.
            minH="0"
            h="7"
            px="1"
            border="none"
            bg="transparent"
            focusVisibleRing="none"
            _focusVisible={{ borderColor: "transparent" }}
            _hover={{ borderColor: "transparent" }}
            placeholder={value.length === 0 ? t("financialAccounts.log.allTypes") : undefined}
            aria-label={t("financialAccounts.log.searchType")}
            data-testid="account-log-type-filter"
          />
        </Picks>
        {/* Beside the picks, never among them: the × and the ⌄ hold the field's right edge. */}
        <Combobox.IndicatorGroup position="static" flexShrink="0" data-testid="account-log-type-indicators">
          {value.length > 0 && <Combobox.ClearTrigger data-testid="account-log-type-clear" />}
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>{t("financialAccounts.log.noType")}</Combobox.Empty>
          {collection.items.map((item) => (
            <Combobox.Item item={item} key={item.value} data-testid={`account-log-type-option-${item.value}`}>
              <ChangeTypeBadge changeType={Number(item.value) as FinancialAccountChangeType} />
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

const SHOWN = 4;

/**
 * The box the picks wrap in: up to four picks' badges, each written whole, "+N" past four, and the typing after them.
 * The field's × and ⌄ are not in it. A click opens the list: the picks are changed there, by their ✓, rather than by
 * small targets squeezed into a field.
 */
function Picks({ value, children }: { value: FinancialAccountChangeType[]; children: ReactNode }) {
  const { t } = useTranslation();
  const combobox = useComboboxContext();

  const shown = value.slice(0, SHOWN);
  const hidden = value.length - shown.length;

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
      data-testid="account-log-type-picks"
    >
      {shown.map((c) => (
        <Badge
          key={c}
          colorPalette={CHANGE_TYPE_PALETTE[c] ?? "gray"}
          variant="subtle"
          flexShrink="0"
          data-testid={`account-log-type-chip-${c}`}
        >
          {t(CHANGE_TYPE_KEY[c]!)}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge variant="outline" colorPalette="gray" flexShrink="0" data-testid="account-log-type-more">
          +{hidden}
        </Badge>
      )}
      {children}
    </Flex>
  );
}

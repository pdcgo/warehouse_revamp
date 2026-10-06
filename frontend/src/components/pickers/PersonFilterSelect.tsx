import { useEffect, useMemo, useState } from "react";
import { Badge, Combobox, Portal, useListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { formerUserId } from "../../lib/users";
import { UserItem } from "../entity/UserItem";

export interface PersonFilterSelectProps {
  /**
   * The people this list's own service says are on its rows (a-who-filter-lists-the-people-on-its-rows), in its
   * order — the latest to have done the thing first. `undefined` while they load.
   */
  people: PublicUser[] | undefined;
  /** The people could not be read. The field says so rather than reading as an empty list. */
  error?: boolean;
  value?: bigint;
  /** Emits `undefined` when the field is CLEARED — "anybody", the filter removed, never left stuck. */
  onChange?: (userId: bigint | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Drop the picker's own border, to sit fused inside a bordered group (as UserSelect's `flush`). */
  flush?: boolean;
}

// PersonFilterSelect is a "who" filter's picker: created by, accepted by. It offers the people who appear on the
// list's rows — the list's own service answers that — never a team's members and never every user in the system.
//
// It looks BACK, so it keeps a person who has left the team and a suspended account, with a badge
// (a-filter-keeps-former-and-suspended-people): last year's restocks are still theirs. The pickers that GIVE
// something (add a member, grant a shop) are the ones that never offer a suspended person.
//
// The set grows only with staff turnover, so it is loaded whole and FILTERED IN THE FIELD (ShopSelect's pattern),
// on the name and the username.
export const description =
  "A who filter's picker (Chakra Combobox) over the people a list's own service says are on its rows — loaded whole by the caller and filtered as you type, on name or username. Keeps former and suspended people, a suspended one badged. Emits a user id, and undefined when cleared.";

// One empty list for every render — a fresh `[]` is a new identity, and the fill effect would loop on it.
const NOBODY: PublicUser[] = [];

export function PersonFilterSelect({
  people,
  error,
  value,
  onChange,
  placeholder,
  disabled,
  flush,
}: PersonFilterSelectProps) {
  const { t } = useTranslation();

  const all = people ?? NOBODY;
  const loaded = people !== undefined;

  // What the closed field shows, and what typing is matched against first: a former user is "Former user #57",
  // never the synthetic username.
  const label = useMemo(() => {
    return (person: PublicUser) => {
      const formerId = formerUserId(person);

      return formerId ? t("users.formerUser", { id: formerId }) : person.name || person.username;
    };
  }, [t]);

  const { collection, filter, set } = useListCollection<PublicUser>({
    initialItems: [],
    itemToString: (person) => label(person),
    itemToValue: (person) => person.id.toString(),
    filter: (itemText, filterText, person) => {
      const needle = filterText.trim().toLowerCase();

      if (!needle) {
        return true;
      }

      return itemText.toLowerCase().includes(needle) || person.username.toLowerCase().includes(needle);
    },
  });

  // ⚠ `filled` tracks the COLLECTION — the remount below is what makes a prefilled field show its name.
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    set(all);
    setFilled(true);
  }, [all, loaded, set]);

  return (
    <Combobox.Root
      // REMOUNTED ONCE, THE MOMENT THE PEOPLE LAND — the same fix ShopSelect and TeamSelect carry: Zag derives the
      // input's text at init and only again when `value` changes, so a filter restored with a person already
      // picked would otherwise show blank.
      key={filled ? "ready" : "loading"}
      collection={collection}
      disabled={disabled}
      onInputValueChange={(e) => filter(e.inputValue)}
      selectionBehavior="replace"
      openOnClick
      value={value !== undefined && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        // ⚠ CLEARING EMITS `undefined` — #131: a field gone blank while the parent still filters on someone.
        const picked = e.value[0];
        onChange?.(picked !== undefined ? BigInt(picked) : undefined);
      }}
      data-testid="person-filter"
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder={error ? t("personFilter.unavailable") : placeholder}
          borderWidth={flush ? "0" : undefined}
          borderRadius={flush ? "0" : undefined}
        />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      {/* Portalled, as UserSelect and TeamSelect are beside it in the same filter bars: the warehouse restock list
          fuses it into a group that clips (overflow hidden), and a portal is what escapes that. */}
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>{all.length === 0 ? t("personFilter.empty") : t("personFilter.noMatch")}</Combobox.Empty>
            {collection.items.map((person) => (
              <Combobox.Item item={person} key={person.id.toString()} data-testid={`person-filter-option-${person.id}`}>
                <UserItem
                  user={person}
                  action={
                    person.isSuspended ? (
                      <Badge colorPalette="warning" size="xs" data-testid={`person-filter-suspended-${person.id}`}>
                        {t("users.status.suspended")}
                      </Badge>
                    ) : undefined
                  }
                />
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

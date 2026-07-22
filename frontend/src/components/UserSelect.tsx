import { useEffect, useState } from "react";
import { Combobox, Portal, useListCollection } from "@chakra-ui/react";
import { useUserSearch } from "../users/queries";
import { useDebounced } from "../lib/useDebounced";
import { UserItem } from "./UserItem";

// The shape UserSelect works in — the fields UserItem needs, common to PublicUser (SearchUser)
// and User (UserList), so either data source drops straight in.
interface SelectableUser {
  id: bigint;
  username: string;
  name: string;
  avatarUrl: string;
}

export interface UserSelectProps {
  value?: bigint;
  onChange?: (userId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
  // Scope of the search:
  //   undefined -> ALL users (SearchUser, cross-team) — for adding someone not in a team yet.
  //   a team id -> only THAT team's members (UserList, scoped) — for picking within a team.
  // This is the "scope by team or all user" option (#56). The backend enforces the difference
  // too: UserList is role-gated and scoped; SearchUser is any authenticated caller.
  teamId?: bigint;
}

// UserSelect is the shared user picker (#56): a Chakra Combobox whose options render with the
// shared UserItem. Search is SERVER-side (min 2 characters) so it scales; it emits the selected
// user id. Pass `teamId` to scope the search to one team's members, or omit it to search everyone.
export const description = "Searchable user picker (Chakra Combobox, server-side) — options render with UserItem, emits a user id. Scopes to all users (SearchUser) by default, or to one team's members when given a teamId (UserList).";

export function UserSelect({
  value,
  onChange,
  placeholder = "Search users by name or username",
  disabled,
  teamId,
}: UserSelectProps) {
  const [input, setInput] = useState("");

  const { collection, set } = useListCollection<SelectableUser>({
    initialItems: [],
    itemToString: (user) => user.username,
    itemToValue: (user) => user.id.toString(),
  });

  // Server-side search, debounced. The query decides WHICH answer is current; the debounce only
  // keeps the request count down while somebody is mid-word — see lib/useDebounced.
  //
  // A failed search is still an empty list rather than a crash, but it is now a RETRIED one: the
  // hand-rolled version turned any hiccup into "no users found", which is a different and wrong
  // answer to the question asked.
  const q = useDebounced(input.trim());
  const results = useUserSearch({ teamId, q });

  useEffect(() => {
    set(q.length >= 2 ? (results.data ?? []) : []);
  }, [q, results.data, set]);

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) {
          onChange?.(BigInt(picked));
        }
      }}
      onInputValueChange={(e) => setInput(e.inputValue)}
      data-testid="user-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>
              {input.trim().length < 2 ? "Type at least 2 characters" : "No users found"}
            </Combobox.Empty>
            {collection.items.map((user) => (
              <Combobox.Item
                item={user}
                key={user.id.toString()}
                data-testid={`user-select-option-${user.username}`}
              >
                <UserItem user={user} />
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

import { useEffect, useState } from "react";
import { Combobox, Portal, useListCollection } from "@chakra-ui/react";
import { userClient } from "../api/clients";
import type { PublicUser } from "../gen/warehouse/user/v1/user_pb";
import { UserItem } from "./UserItem";

export interface UserSelectProps {
  value?: bigint;
  onChange?: (userId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
}

// UserSelect is the shared user picker (#56): a Chakra Combobox whose options render with the shared
// UserItem. Search is SERVER-side (SearchUser, which needs >= 2 characters), so it scales past what a
// client-side filter could hold. Emits the selected user id.
export function UserSelect({
  value,
  onChange,
  placeholder = "Search users by name or username",
  disabled,
}: UserSelectProps) {
  const [input, setInput] = useState("");

  const { collection, set } = useListCollection<PublicUser>({
    initialItems: [],
    itemToString: (user) => user.username,
    itemToValue: (user) => user.id.toString(),
  });

  // Server-side search, debounced. The backend rejects q < 2, so we do not even ask below that.
  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      set([]);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await userClient.searchUser({ q, limit: 10 });
          if (!cancelled) {
            set(res.users);
          }
        } catch {
          if (!cancelled) {
            set([]);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, set]);

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

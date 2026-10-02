import { useEffect, useMemo, useState } from "react";
import { Combobox, Portal, useListCollection } from "@chakra-ui/react";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { roleLabel, rolesFor } from "../../lib/roles";

// Every assignable role, for the "all" case — excludes UNSPECIFIED and the internal SYSTEM role.
const ALL_ROLES: Role[] = [
  Role.ROOT,
  Role.ADMIN,
  Role.TEAM_OWNER,
  Role.TEAM_ADMIN,
  Role.TEAM_CUSTOMER_SERVICE,
  Role.WAREHOUSE_OWNER,
  Role.WAREHOUSE_ADMIN,
  Role.WAREHOUSE_STAFF,
];

interface RoleOption {
  label: string;
  value: string;
}

export interface RoleSelectProps {
  value?: Role;
  onChange?: (role: Role) => void;
  // Which roles to offer. Precedence: explicit `roles` → the roles for `teamType` (admin / selling /
  // warehouse / other) → ALL. So `<RoleSelect />` offers everything, `<RoleSelect teamType={...} />`
  // offers that team type's assignable roles.
  roles?: Role[];
  teamType?: TeamType;
  placeholder?: string;
  disabled?: boolean;
}

// RoleSelect is the shared role picker (#57): a searchable Chakra Combobox whose offered roles are
// chosen by `roles`/`teamType`/all. Emits a Role.
export const description = "Searchable role picker (Chakra Combobox). Offers all roles, or a team type's roles via the teamType prop. Emits a Role.";

export function RoleSelect({
  value,
  onChange,
  roles,
  teamType,
  placeholder = "Search roles",
  disabled,
}: RoleSelectProps) {
  const options: RoleOption[] = useMemo(() => {
    const offered = roles ?? (teamType !== undefined ? rolesFor(teamType) : ALL_ROLES);
    return offered.map((r) => ({ label: roleLabel(r), value: String(r) }));
  }, [roles, teamType]);

  const { collection, set } = useListCollection<RoleOption>({
    initialItems: [],
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
  });

  const [input, setInput] = useState("");

  // Client-side filter over the (small, fixed) role set. Re-runs when the offered set or input
  // changes, so switching `teamType` refreshes the list.
  useEffect(() => {
    const q = input.trim().toLowerCase();
    set(q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options);
  }, [input, options, set]);

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      // UNSPECIFIED is "no role" — what the parent holds after a clear — so it maps to an empty
      // selection (it is never an offered option, see ALL_ROLES).
      value={value !== undefined && value !== Role.UNSPECIFIED ? [String(value)] : []}
      onValueChange={(e) => {
        // ⚠ CLEARING EMITS Role.UNSPECIFIED — it does not do nothing (ShippingSelect's #131 lesson).
        // Swallowing the empty case left the parent holding a role the field no longer showed.
        const picked = e.value[0];
        onChange?.(picked !== undefined ? (Number(picked) as Role) : Role.UNSPECIFIED);
      }}
      onInputValueChange={(e) => setInput(e.inputValue)}
      data-testid="role-select"
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
            <Combobox.Empty>No roles found</Combobox.Empty>
            {collection.items.map((item) => (
              <Combobox.Item item={item} key={item.value} data-testid={`role-select-option-${item.value}`}>
                {item.label}
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

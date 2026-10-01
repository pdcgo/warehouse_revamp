import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { roleLabel } from "../../../lib/roles";
import type { Tone } from "../tone";
import { ToneBadge, type ToneBadgeProps } from "./ToneBadge";

// The STANDARD tone for each role, so a role reads the same in the user table, the team member
// list and the access drawer. The grouping is by AUTHORITY, not by name:
//
//   error   — ROOT/ADMIN: system-wide power. Deliberately the loudest tone; seeing one of these on
//             a row should register as "this account can do anything, anywhere".
//   active  — the owners: full authority inside ONE team.
//   primary — the admins: manage a team, but not its ownership.
//   info    — customer service: reads and acts on orders.
//   success — warehouse staff: the floor roles, the most numerous, so the calmest tone.
//   plain   — SYSTEM and UNSPECIFIED: not a person's role.
function roleTone(role: Role | undefined): Tone {
  switch (role) {
    case Role.ROOT:
    case Role.ADMIN:
      return "error";
    case Role.TEAM_OWNER:
    case Role.WAREHOUSE_OWNER:
      return "active";
    case Role.TEAM_ADMIN:
    case Role.WAREHOUSE_ADMIN:
      return "primary";
    case Role.TEAM_CUSTOMER_SERVICE:
      return "info";
    case Role.WAREHOUSE_STAFF:
      return "success";
    default:
      return "plain";
  }
}

// RoleBadge renders a role as a standard-toned badge. This is THE way to show a role — never
// render `roleLabel()` as bare text, or the same role ends up looking different per screen.
export const description =
  "A user's role as a standard-toned badge. Tone tracks authority: root/admin loudest, floor roles calmest.";

export interface RoleBadgeProps extends Omit<ToneBadgeProps, "tone" | "children" | "role"> {
  // `role` shadows the HTML aria attribute, which is why it is omitted from the base props:
  // a badge that names a permission level has no business also naming an ARIA role.
  role?: Role;
}

export function RoleBadge({ role, ...rest }: RoleBadgeProps) {
  return (
    <ToneBadge tone={roleTone(role)} data-testid={`role-badge-${role ?? Role.UNSPECIFIED}`} {...rest}>
      {roleLabel(role)}
    </ToneBadge>
  );
}

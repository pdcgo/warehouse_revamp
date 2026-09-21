import { useMemo, useState } from "react";
import { Heading, HStack, NativeSelect, Stack } from "@chakra-ui/react";
import { KeyRound, Pencil, UserMinus, UserPlus } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { UserCell } from "../../components/cells/UserCell";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Pagination } from "../../../components/chrome/Pagination";
import type { MemberRow } from "../../fixtures";

// The MEMBERS of one team — who works here and what they may do.
//
// It is a different screen from the user list, and the distinction is the whole reason both exist:
// a USER is an account that exists in the system; a MEMBER is that account's relationship to THIS
// team, carrying the role. The same person is one user and several members.
//
// So the actions here are about the RELATIONSHIP — change role, remove from team — not about the
// account. "Delete user" is deliberately absent: removing somebody from a team must not be one
// mis-click away from destroying their account, and the two live on different screens for that
// reason.
export const description =
  "Who works in THIS team, and their role. A member is an account's relationship to a team, not the account itself — so the actions change the relationship, and deleting the user is deliberately not among them.";

export interface MemberListPageProps {
  members: MemberRow[];
  loading?: boolean;
  isError?: boolean;
}

export function MemberListPage({ members, loading, isError }: MemberListPageProps) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>();
  const [page, setPage] = useState(1);

  const roles = useMemo(
    () => Array.from(new Set(members.map((m) => m.roleLabel))).sort(),
    [members],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return members.filter((m) => {
      if (role && m.roleLabel !== role) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q);
    });
  }, [members, search, role]);

  const columns: Array<TableColumn<MemberRow>> = [
    {
      name: "Member",
      sticky: "left",
      render: (row) => <UserCell user={row} />,
    },
    { name: "Role", render: (row) => <ToneBadge tone="primary">{row.roleLabel}</ToneBadge> },
    {
      name: "Status",
      // Suspended is shown, not filtered away. A suspended member still occupies a seat and still
      // appears in old records, so hiding them makes "who is in this team" wrong.
      render: (row) => (
        <ToneBadge tone={row.active ? "success" : "plain"}>
          {row.active ? "Active" : "Suspended"}
        </ToneBadge>
      ),
    },
    { name: "Joined", render: (row) => <DateCell value={row.joinedAt} grain="date" /> },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "Change role", icon: Pencil },
            { title: "Reset password", icon: KeyRound },
            { title: "Remove from team", icon: UserMinus, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="member-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Members</Heading>
        <Button icon={UserPlus} data-testid="member-add">
          Add Member
        </Button>
      </HStack>

      <HStack gap="card" wrap="wrap">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Name or username"
          maxW="64"
        />

        <NativeSelect.Root width="48" data-testid="filter-role">
          <NativeSelect.Field
            placeholder="All roles"
            value={role ?? ""}
            onChange={(e) => {
              setRole(e.target.value || undefined);
              setPage(1);
            }}
            aria-label="Role"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>

      <DataTable
        columns={columns}
        items={rows.slice((page - 1) * 20, page * 20)}
        loading={loading}
        isError={isError}
        emptyTitle="Nobody matches this filter"
        emptyContent="Try another role, or clear the search."
        errorTitle="Could not load members"
        aria-label="Team members"
      />

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}

import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Ban, KeyRound, Trash2, UserPlus } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { UserCell } from "../../components/cells/UserCell";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Pagination } from "../../../components/chrome/Pagination";
import type { MemberRow } from "../../fixtures";

// EVERY account in the system — the admin view, not a team's view.
//
// Its counterpart is the member list, and the split is deliberate: a member is an account's
// relationship to one team, an account is the thing itself. This screen owns the operations that
// affect the ACCOUNT everywhere at once — suspend, reset password, delete — and those are exactly
// the ones that must not be reachable from a team screen where "remove" means something much
// smaller.
//
// ⚠ Because its actions are system-wide, the screen states that in an Alert rather than trusting the
// reader to infer it from the route. Suspending here signs the person out of EVERY team, and that
// is not visible from a row.
export const description =
  "Every account in the system — the admin counterpart to the member list. Its actions are system-wide (suspend, delete), which the screen states outright, because that is not visible from a row.";

export interface UserListPageProps {
  users: MemberRow[];
  loading?: boolean;
  isError?: boolean;
}

export function UserListPage({ users, loading, isError }: UserListPageProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    );
  }, [users, search]);

  const columns: Array<TableColumn<MemberRow>> = [
    { name: "Account", sticky: "left", render: (row) => <UserCell user={row} /> },
    {
      name: "Teams",
      // The count, not the list: an account can be in a dozen teams and the list would swamp the row.
      render: () => <Text fontSize="sm">3</Text>,
    },
    {
      name: "Status",
      render: (row) => (
        <ToneBadge tone={row.active ? "success" : "error"}>
          {row.active ? "Active" : "Suspended"}
        </ToneBadge>
      ),
    },
    { name: "Created", render: (row) => <DateCell value={row.joinedAt} grain="date" /> },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "Reset password", icon: KeyRound },
            { title: "Suspend account", icon: Ban, tone: "warning" },
            { title: "Delete account", icon: Trash2, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="user-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">All Accounts</Heading>
        <Button icon={UserPlus}>New Account</Button>
      </HStack>

      <Alert tone="warning" data-testid="user-list-scope-warning">
        Actions here affect the account everywhere. Suspending someone signs them out of every team.
      </Alert>

      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Name or username"
        maxW="64"
      />

      <DataTable
        columns={columns}
        items={rows.slice((page - 1) * 20, page * 20)}
        loading={loading}
        isError={isError}
        emptyTitle="No accounts match"
        emptyContent="Try a different name or username."
        errorTitle="Could not load accounts"
        aria-label="All accounts"
      />

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}

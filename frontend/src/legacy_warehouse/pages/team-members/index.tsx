import { Button, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { UserPlus, Users } from "lucide-react";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { Summary } from "../../../legacy/components/display/Summary";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { FloorMember } from "../../fixtures";

// ── TEAM MEMBERS ────────────────────────────────────────────────────────────────────────────────
//
// Who works here, and — the part that makes it a warehouse screen rather than a user list — WHO IS
// ON SHIFT RIGHT NOW.
//
// ⚠ ON SHIFT IS NOT AN ACCOUNT PROPERTY. THE ORIGINAL CALLS IT "ROLLING", AND IT IS THE ONE IDEA ON
// THIS SCREEN WORTH TAKING SERIOUSLY.
//
// A membership says what somebody is ALLOWED to do. A shift says whether they are HERE. They are
// different questions, they change on different timescales, and conflating them breaks in both
// directions:
//
//   · deactivate the account of someone who went home    → they cannot log in tomorrow
//   · leave everybody active                             → "who packed this?" has forty answers
//
// So it is a separate, transient, per-day state that anyone can flip, and it costs nothing to get
// wrong. Every movement recorded during a shift is attributed against it, which is why the shared
// tablet's user card (see UserCard) matters so much.
export const description =
  "Who works here and who is ON SHIFT — two different questions. A membership says what you may do; a shift says whether you are here, and conflating them either locks people out or makes 'who packed this' unanswerable.";

export interface TeamMembersPageProps {
  members: FloorMember[];
  loading?: boolean;
}

function shiftLength(startedAt?: number): string {
  if (!startedAt) return "";
  const hours = Math.floor((Date.now() / 1000 - startedAt) / 3600);
  return hours < 1 ? "just started" : `${hours}h`;
}

export function TeamMembersPage({ members, loading }: TeamMembersPageProps) {
  const onShift = members.filter((m) => m.onShift);

  const columns: Array<TableColumn<FloorMember>> = [
    {
      name: "Name",
      sticky: "left",
      render: (row) => (
        <Stack gap="0">
          <Text fontSize="sm">{row.name}</Text>
          <Text fontSize="xs" color="fg.muted">
            {row.email}
          </Text>
        </Stack>
      ),
    },
    {
      name: "Can do",
      tooltip: "What this person is allowed to do. Changes rarely.",
      render: (row) => (
        <HStack gap="1" wrap="wrap">
          {row.roles.map((r) => (
            <ToneBadge key={r} tone="plain" textTransform="capitalize">
              {r}
            </ToneBadge>
          ))}
        </HStack>
      ),
    },
    {
      // ⚠ SEPARATE FROM THE ROLES COLUMN, AND DELIBERATELY ADJACENT TO IT. Putting them side by side
      // is what makes the distinction legible: same person, two different facts.
      name: "On shift",
      tooltip: "Whether they are here right now. Changes every day, and anyone can flip it.",
      render: (row) => (
        <HStack gap="2" data-testid="shift-cell" data-on-shift={row.onShift ? "true" : "false"}>
          <ToneBadge tone={row.onShift ? "success" : "plain"}>{row.onShift ? "On shift" : "Off"}</ToneBadge>
          {row.onShift && (
            <Text fontSize="xs" color="fg.muted">
              {shiftLength(row.shiftStartedAt)}
            </Text>
          )}
        </HStack>
      ),
    },
    {
      name: "",
      sticky: "right",
      render: (row) => (
        // Flipping a shift is one click and needs no confirmation — it is trivially reversible, and
        // a confirmation on an action performed forty times a day is a dialog people learn to
        // dismiss without reading.
        <Button size="xs" variant="outline" data-testid="toggle-shift">
          {row.onShift ? "End shift" : "Start shift"}
        </Button>
      ),
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="team-members-page">
      <ScreenHeader
        icon={Users}
        title="Team members"
        actions={
          <Button size="xs" data-testid="add-member">
            <Icon as={UserPlus} boxSize="4" />
            Add
          </Button>
        }
      />

      <Summary
        columns={2}
        loading={loading}
        items={[
          // The number the supervisor actually wants. "How many people do we have" is a
          // hiring question; "how many are here" decides whether today's volume is achievable.
          { label: "On shift now", value: onShift.length, tone: "success" },
          { label: "Members", value: members.length },
        ]}
      />

      <DataTable
        columns={columns}
        items={members}
        loading={loading}
        emptyTitle="Nobody here yet"
        aria-label="Team members"
        data-testid="members-table"
      />
    </Stack>
  );
}

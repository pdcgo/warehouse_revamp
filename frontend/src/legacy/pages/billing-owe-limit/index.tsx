import { useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { TeamCell } from "../../components/cells/TeamCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { Modal } from "../../components/feedback/Modal";
import { TextInput } from "../../components/inputs/TextInput";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { TeamBalanceRow } from "../../financeFixtures";

// SETTING the credit limits — not watching them.
//
// ⚠ It is deliberately a different screen from `invoice-limit`, and the split is worth stating
// because the two look similar: that one MONITORS (who is close to their ceiling, sorted by
// pressure, read every day by whoever chases payment); this one CONFIGURES (what each ceiling is,
// changed rarely, by somebody with the authority to extend credit).
//
// Merging them would put an "edit limit" control on a screen people scan hourly, which is how a
// ceiling gets raised to clear a blockage instead of the blockage being dealt with.
//
// So this screen sorts by NAME — you arrive knowing which team you came to change — and shows the
// limit as a figure rather than a pressure bar.
export const description =
  "Where credit ceilings are SET — deliberately separate from the limit monitor, which is scanned hourly. Merging them puts an edit control where people are looking for a blockage, which is how limits get raised instead of debts collected.";

export interface BillingOweLimitPageProps {
  teams: TeamBalanceRow[];
  loading?: boolean;
  onSave?(teamId: bigint, limit: string): void;
}

export function BillingOweLimitPage({ teams, loading, onSave }: BillingOweLimitPageProps) {
  const [editing, setEditing] = useState<TeamBalanceRow | null>(null);
  const [value, setValue] = useState("");

  // By NAME — you arrive knowing which team you came to change.
  const rows = [...teams].sort((a, b) => a.name.localeCompare(b.name));

  const columns: Array<TableColumn<TeamBalanceRow>> = [
    {
      name: "Team",
      sticky: "left",
      render: (row) => (
        <TeamCell
          team={{
            id: row.id,
            name: row.name,
            type: row.kind === "warehouse" ? TeamType.WAREHOUSE : TeamType.SELLING,
          }}
        />
      ),
    },
    {
      name: "Current limit",
      align: "end",
      render: (row) =>
        row.limit > 0n ? (
          <StatisticCell value={row.limit} kind="price" />
        ) : (
          <ToneBadge tone="plain">No limit</ToneBadge>
        ),
    },
    {
      name: "Currently unpaid",
      align: "end",
      render: (row) => <StatisticCell value={row.owing} kind="price" compact />,
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: (row) => (
        <Button
          size="xs"
          tone="plain"
          variant="ghost"
          icon={Pencil}
          data-testid={`edit-limit-${row.id}`}
          onClick={() => {
            setEditing(row);
            setValue(row.limit > 0n ? row.limit.toString() : "");
          }}
        >
          Change
        </Button>
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="billing-owe-limit-page">
      <Heading size="md">Credit limit settings</Heading>

      <Alert tone="info" data-testid="owe-limit-note">
        Raising a limit lets a team keep ordering while it still owes. To see who is close to a
        ceiling right now, use the limit monitor.
      </Alert>

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="No teams"
        aria-label="Credit limit settings"
      />

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Change Credit Limit"
        size="sm"
        footer={
          <HStack gap="2" justify="flex-end">
            <Button tone="plain" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editing) onSave?.(editing.id, value);
                setEditing(null);
              }}
              data-testid="save-limit"
            >
              Save
            </Button>
          </HStack>
        }
      >
        <Stack gap="card">
          <Text fontSize="sm" color="fg.muted">
            {editing?.name}
          </Text>
          <Field
            label="Limit"
            hint="In rupiah. Leave empty to remove the limit entirely — the team will never be blocked."
          >
            <TextInput value={value} onChange={setValue} inputMode="numeric" data-testid="limit-input" />
          </Field>
        </Stack>
      </Modal>
    </Stack>
  );
}

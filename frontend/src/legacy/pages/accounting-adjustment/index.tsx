import { useState } from "react";
import { Heading, HStack, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";
import { Alert } from "../../components/display/Alert";
import { Card } from "../../components/display/Card";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { Field } from "../../components/inputs/Field";
import { TextInput, Textarea } from "../../components/inputs/TextInput";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import type { LedgerEntryRow } from "../../financeFixtures";

// Posting an ACCOUNTING ADJUSTMENT — the only way a past figure is ever corrected.
//
// ⚠ NOTHING IS EVER EDITED. The journal is append-only, so a mistake is fixed by posting a new,
// opposite entry that names the one it corrects. That is not a technical constraint; it is what
// makes the books auditable. If entries could be edited, no figure would have a history and no
// trial balance would prove anything about the past.
//
// So this screen makes the correction EXPLICIT: which entry, how much, and why. All three are
// required, and the "why" is a textarea rather than a line, because an adjustment with a two-word
// reason is the one that causes an argument six months later.
export const description =
  "Posting an accounting adjustment — the only way a past figure is corrected, because the journal is append-only. Which entry, how much and WHY are all required; the why is a textarea, because a two-word reason is what causes the argument later.";

export interface AccountingAdjustmentPageProps {
  // The entries an adjustment may be posted against.
  entries: LedgerEntryRow[];
  recent?: LedgerEntryRow[];
  onSubmit?(values: { entryId: string; amount: string; reason: string }): void;
  busy?: boolean;
}

export function AccountingAdjustmentPage({
  entries,
  recent = [],
  onSubmit,
  busy,
}: AccountingAdjustmentPageProps) {
  const [entryId, setEntryId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  // All three, and the reason has to be a sentence rather than a word — the length floor is the
  // cheapest available proxy for "somebody actually explained this".
  const complete = entryId !== "" && amount.trim() !== "" && reason.trim().length >= 10;

  const columns: Array<TableColumn<LedgerEntryRow>> = [
    { name: "When", render: (e) => <DateCell value={e.at} grain="date" /> },
    { name: "Account", key: "account" },
    { name: "Memo", key: "memo" },
    {
      name: "Amount",
      align: "end",
      render: (e) => <StatisticCell value={e.debit > 0n ? e.debit : e.credit} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" maxW="3xl" data-testid="accounting-adjustment-page">
      <Heading size="md">Post an adjustment</Heading>

      <Alert tone="warning" icon={TriangleAlert} title="Entries are never edited" data-testid="adjustment-note">
        A mistake is corrected by posting an opposite entry that names the one it fixes. That is what
        keeps the books auditable — an edited entry would leave no history.
      </Alert>

      <Card>
        <Stack gap="card">
          <Field label="Entry being corrected" required>
            <NativeSelect.Root>
              <NativeSelect.Field
                placeholder="Choose an entry"
                value={entryId}
                onChange={(e) => setEntryId(e.target.value)}
                aria-label="Entry being corrected"
                data-testid="adjustment-entry"
              >
                {entries.map((e) => (
                  <option key={e.id.toString()} value={e.id.toString()}>
                    {e.account} — {e.memo}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>

          <Field label="Adjustment amount" required hint="In rupiah. The amount of the correction, not the corrected total.">
            <TextInput
              value={amount}
              onChange={setAmount}
              inputMode="numeric"
              data-testid="adjustment-amount"
            />
          </Field>

          <Field
            label="Why"
            required
            hint="A sentence. Read by whoever audits this, possibly months from now."
          >
            <Textarea
              value={reason}
              onChange={setReason}
              rows={3}
              data-testid="adjustment-reason"
            />
          </Field>

          <HStack justify="flex-end">
            <Button
              disabled={!complete}
              loading={busy}
              onClick={() => onSubmit?.({ entryId, amount, reason })}
              data-testid="adjustment-submit"
            >
              Post adjustment
            </Button>
          </HStack>
        </Stack>
      </Card>

      {recent.length > 0 && (
        <Stack gap="2">
          <Text fontWeight="medium">Recent adjustments</Text>
          <DataTable columns={columns} items={recent} size="sm" aria-label="Recent adjustments" />
        </Stack>
      )}
    </Stack>
  );
}

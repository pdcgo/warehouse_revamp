import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  IconButton,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError, teamClient } from "../api/clients";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { toaster } from "../components/Toaster";

// TeamInfoDialog edits a team's contact + bank details (its TeamInfo).
//
// It loads the current values via TeamDetail (which is the only RPC that returns `info`), then
// writes with TeamInfoUpdate. That RPC is team-scoped: a team owner/admin may edit their own,
// root/admin may edit any.
export function TeamInfoDialog({ team }: { team: Team }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [contactNumber, setContactNumber] = useState("");
  const [bankType, setBankType] = useState("");
  const [bankOwnerName, setBankOwnerName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");

  // Load the current info when the dialog opens — not before, so the list view stays cheap.
  async function onOpenChange(next: boolean) {
    setOpen(next);

    if (!next) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await teamClient.teamDetail({ teamId: team.id });
      const info = res.team?.info;

      setContactNumber(info?.contactNumber ?? "");
      setBankType(info?.bankType ?? "");
      setBankOwnerName(info?.bankOwnerName ?? "");
      setBankAccountNumber(info?.bankAccountNumber ?? "");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await teamClient.teamInfoUpdate({
        teamId: team.id,
        contactNumber,
        bankType,
        bankOwnerName,
        bankAccountNumber,
      });

      toaster.create({ type: "success", title: "Team info updated" });
      setOpen(false);
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => void onOpenChange(e.open)}>
      <Dialog.Trigger asChild>
        <IconButton size="xs" variant="ghost" aria-label="Team info" data-testid={`info-team-${team.teamCode}`}>
          🏦
        </IconButton>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{team.name} — contact &amp; bank</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                {loading ? (
                  <Spinner colorPalette="brand" />
                ) : (
                  <Stack gap="card">
                    {error && (
                      <Text color="red.fg" data-testid="team-info-error">
                        {error}
                      </Text>
                    )}

                    <Field.Root>
                      <Field.Label>Contact number</Field.Label>
                      <Input
                        value={contactNumber}
                        data-testid="info-contact"
                        onChange={(e) => setContactNumber(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Bank</Field.Label>
                      <Input
                        value={bankType}
                        data-testid="info-bank-type"
                        onChange={(e) => setBankType(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Account holder</Field.Label>
                      <Input
                        value={bankOwnerName}
                        data-testid="info-bank-owner"
                        onChange={(e) => setBankOwnerName(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Account number</Field.Label>
                      <Input
                        value={bankAccountNumber}
                        data-testid="info-bank-account"
                        onChange={(e) => setBankAccountNumber(e.target.value)}
                      />
                    </Field.Root>
                  </Stack>
                )}
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-team-info">
                  Save
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

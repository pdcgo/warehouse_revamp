import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Landmark } from "lucide-react";
import { rpcError, teamClient } from "../api/clients";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { toaster } from "../components/Toaster";

// TeamInfoDialog edits a team's contact + bank details (its TeamInfo).
//
// It loads the current values via TeamDetail (which is the only RPC that returns `info`), then
// writes with TeamInfoUpdate. That RPC is team-scoped: a team owner/admin may edit their own,
// root/admin may edit any.
export function TeamInfoDialog({
  team,
  open: openProp,
  onOpenChange,
}: {
  team: Team;
  // Optional controlled mode: when opened from a row's actions menu the page owns `open` and no
  // inline trigger is rendered. Absent, the dialog triggers itself as before.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [contactNumber, setContactNumber] = useState("");
  const [bankType, setBankType] = useState("");
  const [bankOwnerName, setBankOwnerName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  // Load the current info when the dialog opens — not before, so the list view stays cheap. Driven
  // by `open` (an effect, not the onOpenChange handler) so a controlled open loads too.
  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const res = await teamClient.teamDetail({ teamId: team.id });
        const info = res.team?.info;

        if (cancelled) {
          return;
        }

        setContactNumber(info?.contactNumber ?? "");
        setBankType(info?.bankType ?? "");
        setBankOwnerName(info?.bankOwnerName ?? "");
        setBankAccountNumber(info?.bankAccountNumber ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, team.id]);

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
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      {!isControlled && (
        <Dialog.Trigger asChild>
          <IconButton size="xs" variant="ghost" aria-label="Team info" data-testid={`info-team-${team.teamCode}`}>
            <Icon as={Landmark} boxSize="4" />
          </IconButton>
        </Dialog.Trigger>
      )}

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

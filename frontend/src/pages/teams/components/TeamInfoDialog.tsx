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
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import type { Team } from "../../../gen/warehouse/team/v1/team_pb";
import { toaster } from "../../../components/Toaster";
import { useSaveTeamInfo, useTeamDetail } from "../../../features/teams/queries";

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
  const { t } = useTranslation();
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
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

  // The read is `enabled` by `open`, which is what the old cancel-guarded effect was really
  // expressing: the list view stays cheap because nothing is fetched until somebody opens this.
  // Sharing `useTeamDetail` with the detail page is the point — TeamDetail is the only RPC that
  // returns `info`, so the dialog and the page are two views of one record, and the save below
  // moves both.
  const query = useTeamDetail({ teamId: team.id, enabled: open });
  const save = useSaveTeamInfo();

  const loading = query.isPending && open;
  const busy = save.isPending;

  // Copy the stored info into form state ONCE PER OPEN — the fields are edited, so they cannot read
  // straight off the cache.
  //
  // The `seeded` flag is what makes it once. A cached value arrives immediately and is then replaced
  // by a background refetch (and again by the one this dialog's own save triggers), each with a new
  // object identity — without the flag every one of those would overwrite what the person is
  // typing. Closing resets it, so reopening re-reads rather than showing the last edit.
  const info = query.data?.info;
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!open) {
      setSeeded(false);

      return;
    }

    if (seeded || !query.isSuccess) {
      return;
    }

    setContactNumber(info?.contactNumber ?? "");
    setBankType(info?.bankType ?? "");
    setBankOwnerName(info?.bankOwnerName ?? "");
    setBankAccountNumber(info?.bankAccountNumber ?? "");
    setSeeded(true);
  }, [open, seeded, query.isSuccess, info]);

  // A failed READ shows in the same place a failed write does — there is one error line in this
  // dialog and either failure is a reason you cannot edit the bank details.
  const readError = query.isError ? rpcError(query.error) : "";
  const shownError = error || readError;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { teamId: team.id, contactNumber, bankType, bankOwnerName, bankAccountNumber },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("teams.teamInfoUpdated") });
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
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
                <Dialog.Title>{t("teams.contactBankTitle", { name: team.name })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                {loading ? (
                  <Spinner colorPalette="brand" />
                ) : (
                  <Stack gap="card">
                    {shownError && (
                      <Text color="red.fg" data-testid="team-info-error">
                        {shownError}
                      </Text>
                    )}

                    <Field.Root>
                      <Field.Label>{t("teams.contactNumber")}</Field.Label>
                      <Input
                        value={contactNumber}
                        data-testid="info-contact"
                        onChange={(e) => setContactNumber(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("teams.bank")}</Field.Label>
                      <Input
                        value={bankType}
                        data-testid="info-bank-type"
                        onChange={(e) => setBankType(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("teams.accountHolder")}</Field.Label>
                      <Input
                        value={bankOwnerName}
                        data-testid="info-bank-owner"
                        onChange={(e) => setBankOwnerName(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("teams.accountNumber")}</Field.Label>
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
                  <Button variant="outline">{t("teams.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-team-info">
                  {t("teams.save")}
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

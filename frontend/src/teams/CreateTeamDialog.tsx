import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError, teamClient } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { toaster } from "../components/Toaster";

// The types a caller may CREATE. ROOT is excluded — the root team is seeded, never created
// (the backend rejects it, and the proto's validation forbids UNSPECIFIED and ROOT).
const CREATABLE: { value: TeamType; label: string }[] = [
  { value: TeamType.WAREHOUSE, label: "Warehouse" },
  { value: TeamType.SELLING, label: "Selling" },
  { value: TeamType.ADMIN, label: "Admin" },
];

export function CreateTeamDialog({
  onDone,
  fixedType,
}: {
  onDone: () => void;
  // When set, the new team is always this type: the type selector is hidden and shown as
  // read-only text. Used by warehouse-scoped views that only ever create WAREHOUSE teams.
  fixedType?: TeamType;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [type, setType] = useState<TeamType>(fixedType ?? TeamType.WAREHOUSE);

  // Label for the locked type (falls back to a generic noun for an unlisted type).
  const lockedLabel = CREATABLE.find((t) => t.value === fixedType)?.label ?? "Team";
  const [name, setName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [description, setDescription] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      // TeamCreate also grants the caller ownership of the new team, server-side, via a
      // compensating RPC — so a fresh team is never ownerless.
      await teamClient.teamCreate({ type, name, teamCode, description });

      toaster.create({ type: "success", title: `Team "${name}" created` });

      setName("");
      setTeamCode("");
      setDescription("");
      setOpen(false);
      onDone();
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Dialog.Trigger asChild>
        <Button
          size="xs"
          colorPalette="brand"
          data-testid={fixedType === undefined ? "open-create-team" : `open-create-${lockedLabel.toLowerCase()}`}
        >
          {fixedType === undefined ? "New team" : `New ${lockedLabel.toLowerCase()}`}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{fixedType === undefined ? "New Team" : `New ${lockedLabel}`}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-team-error">
                      {error}
                    </Text>
                  )}

                  {fixedType === undefined ? (
                    <Field.Root required>
                      <Field.Label>Type</Field.Label>
                      <NativeSelect.Root size="sm">
                        <NativeSelect.Field
                          value={String(type)}
                          data-testid="new-team-type"
                          onChange={(e) => setType(Number(e.target.value) as TeamType)}
                        >
                          {CREATABLE.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      <Field.HelperText>Type is fixed once the team is created.</Field.HelperText>
                    </Field.Root>
                  ) : (
                    <Field.Root>
                      <Field.Label>Type</Field.Label>
                      <Text fontWeight="medium" data-testid="new-team-type-fixed">
                        {lockedLabel}
                      </Text>
                      <Field.HelperText>Locked for this view.</Field.HelperText>
                    </Field.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>Name</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-team-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field.HelperText>4–128 characters.</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Team code</Field.Label>
                    <Input
                      value={teamCode}
                      data-testid="new-team-code"
                      onChange={(e) => setTeamCode(e.target.value)}
                    />
                    <Field.HelperText>Unique, up to 10 characters, immutable.</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Description</Field.Label>
                    <Input
                      value={description}
                      data-testid="new-team-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-create-team">
                  Create
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

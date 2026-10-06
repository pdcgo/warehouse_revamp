import { useState } from "react";
import type { FormEvent } from "react";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { PasswordInput } from "../../../components/inputs/PasswordInput";
import { TeamTypeSelect, teamTypeLabel } from "../../../components/pickers/TeamTypeSelect";
import { UserSelect } from "../../../components/pickers/UserSelect";
import { useCreateTeam } from "../../../features/teams/queries";
import { useTeam } from "../../../features/team/TeamContext";
import { useCreateUser } from "../../../features/users/queries";

const NEW_OWNER = { username: "", password: "", name: "", phone: "" };

// The Create Team form names the team's first OWNER (the-create-team-form-names-the-first-owner): found with
// the user search, or created right here when the search finds nobody — the same two ways in as Add Member.
// The person creating the team is NOT made a member; Root and the Administrator reach it from the switcher's
// All teams (the-switcher-offers-every-team).
export function CreateTeamDialog({
  fixedType,
}: {
  // When set, the new team is always this type: the type selector is hidden and shown as
  // read-only text. Used by warehouse-scoped views that only ever create WAREHOUSE teams.
  fixedType?: TeamType;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  // The write, and what it invalidates, declared together in queries.ts (#177). The `onDone` prop
  // this dialog used to take is gone with it: the page no longer needs — or gets — a handle on the
  // team list's fetching. `busy` is gone for the same kind of reason, the mutation already knows
  // whether it is in flight, and a second flag beside it can disagree with the first.
  const save = useCreateTeam();
  const createUser = useCreateUser();
  const { refresh } = useTeam();
  const busy = save.isPending || createUser.isPending;

  const [type, setType] = useState<TeamType>(fixedType ?? TeamType.WAREHOUSE);

  // Label for the locked type (falls back to a generic noun for an unset fixedType).
  const lockedLabel = fixedType !== undefined ? teamTypeLabel(fixedType) : "Team";
  const [name, setName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [description, setDescription] = useState("");

  // The owner: an existing person's id, or — while `creatingOwner` — a new person typed in below.
  const [ownerId, setOwnerId] = useState<bigint | undefined>(undefined);
  const [creatingOwner, setCreatingOwner] = useState(false);
  const [newOwner, setNewOwner] = useState(NEW_OWNER);

  function reset() {
    setName("");
    setTeamCode("");
    setDescription("");
    setOwnerId(undefined);
    setCreatingOwner(false);
    setNewOwner(NEW_OWNER);
    setError("");
  }

  async function ownerFor(): Promise<bigint | undefined> {
    if (!creatingOwner) {
      return ownerId;
    }

    // Username is lowercase alphanumeric only (#87), and a name is required
    // (only-name-and-username-are-required) — the same rules as Add Member's Create.
    if (!/^[a-z0-9]+$/.test(newOwner.username)) {
      setError(t("users.create.usernameError"));
      return undefined;
    }

    if (newOwner.name.trim() === "") {
      setError(t("users.create.nameRequired"));
      return undefined;
    }

    // A person with no team yet: team 0 is Root and the Administrator only, which is who creates teams.
    const res = await createUser.mutateAsync({
      teamId: 0n,
      username: newOwner.username,
      password: newOwner.password,
      name: newOwner.name,
      email: "",
      phoneNumber: newOwner.phone,
      role: Role.UNSPECIFIED,
    });

    const id = res.user?.id;

    // From here on the new person is simply the PICKED owner: if the team itself is then refused (a taken
    // code, say), pressing Create again reuses them instead of making a second account.
    setOwnerId(id);
    setCreatingOwner(false);
    setNewOwner(NEW_OWNER);

    return id;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    if (!creatingOwner && (ownerId === undefined || ownerId === 0n)) {
      setError(t("teams.ownerRequired"));
      return;
    }

    let owner: bigint | undefined;

    try {
      owner = await ownerFor();
    } catch (err) {
      setError(rpcError(err));
      return;
    }

    if (owner === undefined) {
      return;
    }

    save.mutate(
      { type, name, teamCode, description, ownerUserId: owner },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("teams.teamCreated", { name }) });

          // Refresh the caller's MEMBERSHIPS as well as the team list: the caller is not made a member, but
          // may have named THEMSELVES as the Owner, and TeamContext — which backs the switcher — holds
          // memberships in its own state, not in the query cache the hook invalidates.
          void refresh();

          reset();
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          size="xs"
          colorPalette="brand"
          data-testid={fixedType === undefined ? "open-create-team" : `open-create-${lockedLabel.toLowerCase()}`}
        >
          {fixedType === undefined ? t("teams.newTeam") : t("teams.newLabeled", { label: lockedLabel.toLowerCase() })}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>
                  {fixedType === undefined ? t("teams.newTeamTitle") : t("teams.newLabeled", { label: lockedLabel })}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="create-team-error">
                      {error}
                    </Text>
                  )}

                  {fixedType === undefined ? (
                    <Field.Root required>
                      <Field.Label>{t("teams.type")}</Field.Label>
                      <TeamTypeSelect value={type} onChange={setType} />
                      <Field.HelperText>{t("teams.typeFixedHelp")}</Field.HelperText>
                    </Field.Root>
                  ) : (
                    <Field.Root>
                      <Field.Label>{t("teams.type")}</Field.Label>
                      <Text fontWeight="medium" data-testid="new-team-type-fixed">
                        {lockedLabel}
                      </Text>
                      <Field.HelperText>{t("teams.lockedForView")}</Field.HelperText>
                    </Field.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("teams.name")}</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-team-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field.HelperText>{t("teams.nameHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("teams.teamCode")}</Field.Label>
                    <Input
                      value={teamCode}
                      data-testid="new-team-code"
                      onChange={(e) => setTeamCode(e.target.value)}
                    />
                    <Field.HelperText>{t("teams.teamCodeHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("teams.owner")}</Field.Label>

                    {creatingOwner ? (
                      <Stack gap="field" w="full" data-testid="new-team-owner-create">
                        <Field.Root required>
                          <Field.Label>{t("users.field.username")}</Field.Label>
                          <Input
                            value={newOwner.username}
                            data-testid="new-owner-username"
                            onChange={(e) => setNewOwner({ ...newOwner, username: e.target.value })}
                          />
                          <Field.HelperText>{t("users.helper.usernameRule")}</Field.HelperText>
                        </Field.Root>

                        <Field.Root required>
                          <Field.Label>{t("users.field.password")}</Field.Label>
                          <PasswordInput
                            value={newOwner.password}
                            data-testid="new-owner-password"
                            onChange={(e) => setNewOwner({ ...newOwner, password: e.target.value })}
                          />
                          <Field.HelperText>{t("users.helper.min8")}</Field.HelperText>
                        </Field.Root>

                        <Field.Root required>
                          <Field.Label>{t("users.field.name")}</Field.Label>
                          <Input
                            value={newOwner.name}
                            data-testid="new-owner-name"
                            onChange={(e) => setNewOwner({ ...newOwner, name: e.target.value })}
                          />
                        </Field.Root>

                        <Field.Root>
                          <Field.Label>{t("users.field.phone")}</Field.Label>
                          <Input
                            value={newOwner.phone}
                            data-testid="new-owner-phone"
                            onChange={(e) => setNewOwner({ ...newOwner, phone: e.target.value })}
                          />
                        </Field.Root>

                        <Box>
                          <Button
                            size="xs"
                            variant="ghost"
                            data-testid="new-owner-back"
                            onClick={() => setCreatingOwner(false)}
                          >
                            {t("teams.backToOwnerSearch")}
                          </Button>
                        </Box>
                      </Stack>
                    ) : (
                      <Stack gap="2" w="full" data-testid="new-team-owner">
                        <UserSelect
                          value={ownerId}
                          onChange={setOwnerId}
                          placeholder={t("teams.ownerPlaceholder")}
                        />
                        <Box>
                          <Button
                            size="xs"
                            variant="ghost"
                            data-testid="new-owner-create"
                            onClick={() => setCreatingOwner(true)}
                          >
                            {t("teams.createOwner")}
                          </Button>
                        </Box>
                      </Stack>
                    )}

                    <Field.HelperText>{t("teams.ownerHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("teams.description")}</Field.Label>
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
                  <Button variant="outline">{t("teams.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-create-team">
                  {t("teams.create")}
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

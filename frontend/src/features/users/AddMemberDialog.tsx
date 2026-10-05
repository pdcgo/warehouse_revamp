import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  HStack,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import type { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { NotImplemented } from "../pending/NotImplemented";
import { NotImplementedSummary } from "../pending/NotImplementedSummary";
import { toaster } from "../../components/feedback/Toaster";
import { UserItem } from "../../components/entity/UserItem";
import { PasswordInput } from "../../components/inputs/PasswordInput";
import { RoleSelect } from "../../components/pickers/RoleSelect";
import { canManageMember, defaultGrant, grantableRoles, isGlobalAdmin, roleLabel } from "../../lib/roles";
import { useDebounced } from "../../lib/useDebounced";
import { useAddTeamMember, useCreateUser, useMemberSearch } from "./queries";
import { ADD_MEMBER_PENDING } from "./pending";

const NEW_USER = { username: "", password: "", name: "", email: "", phone: "" };

// AddMemberDialog — the SEARCH POPUP a member is added from (a-member-is-found-in-a-search-popup).
// It targets the CURRENT team by default; the team detail page passes `teamId` + `teamType` to manage
// an arbitrary team's members. Its Create is the ONLY way an account is made
// (an-account-is-made-only-from-the-member-search) — there is no separate New User form.
//
// It is the owner's flow, one branch per answer (context.md §How Managing Team User Member):
//
//   search ─┬─ found, not in the team ── Select Role ── Add
//           ├─ found, already in it ──── Change Role ── Change Role   (an-existing-member-gets-change-role)
//           └─ nobody ───────────────── Create User ── Select Role ── Create and Add
//
// The results are a LIST, not the UserSelect combobox: each row must say whether the person is already
// here and show their phone ending (a-result-shows-the-phones-last-four-digits), and "nobody" has to
// lead somewhere — a combobox can carry neither.
//
// What is matched depends on who asks (managers-search-by-exact-username-phone-or-email): an Owner or
// an Admin types someone's WHOLE username, phone or email; Root and the Administrator search by part.
// The roles offered are only those below the caller's (change-role-only-below-your-own).
export function AddMemberDialog({
  teamId,
  teamType,
}: {
  teamId?: bigint;
  teamType?: TeamType;
}) {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const { current } = useTeam();

  const targetTeamId = teamId ?? current?.teamId;
  const targetTeamType = teamType ?? current?.teamType;
  const caller = current?.role;
  const broad = isGlobalAdmin(caller);
  const roles = grantableRoles(targetTeamType, caller);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<PublicUser | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(NEW_USER);
  const [role, setRole] = useState<Role>(Role.UNSPECIFIED);
  const [error, setError] = useState("");

  const term = useDebounced(q.trim());
  const search = useMemberSearch({ teamId: targetTeamId, q: term });
  const results = search.data?.users ?? [];
  const rolesInTeam = search.data?.rolesInTeam;

  const add = useAddTeamMember();
  const create = useCreateUser();
  const busy = add.isPending || create.isPending;

  // What the picked person already holds here, if anything — it turns Select Role into Change Role.
  const currentRole = picked ? rolesInTeam?.get(picked.id.toString()) : undefined;
  const isMember = currentRole !== undefined && currentRole !== Role.UNSPECIFIED;
  const changeable =
    !isMember ||
    canManageMember({ caller, teamType: targetTeamType, target: currentRole, isSelf: identity?.identityId === picked?.id });
  const offered = isMember ? roles.filter((r) => r !== currentRole) : roles;

  const step: "search" | "picked" | "create" = creating ? "create" : picked ? "picked" : "search";

  function reset() {
    setQ("");
    setPicked(undefined);
    setCreating(false);
    setDraft(NEW_USER);
    setRole(Role.UNSPECIFIED);
    setError("");
  }

  function pick(user: PublicUser) {
    const held = rolesInTeam?.get(user.id.toString());
    const choices = held !== undefined && held !== Role.UNSPECIFIED ? roles.filter((r) => r !== held) : roles;

    setPicked(user);
    setRole(defaultGrant(targetTeamType, choices));
    setError("");
  }

  function startCreate() {
    // What was typed is most often the username they were meant to have.
    setDraft({ ...NEW_USER, username: /^[a-z0-9]+$/.test(term) ? term : "" });
    setRole(defaultGrant(targetTeamType, roles));
    setCreating(true);
    setError("");
  }

  function done(title: string) {
    toaster.create({ type: "success", title });
    reset();
    setOpen(false);
  }

  function submit() {
    if (targetTeamId === undefined || role === Role.UNSPECIFIED) {
      return;
    }

    setError("");

    if (step === "picked" && picked) {
      add.mutate(
        { teamId: targetTeamId, userId: picked.id, role },
        {
          onSuccess: () =>
            done(
              isMember
                ? t("users.toast.roleChanged", { username: picked.username, role: roleLabel(role, targetTeamType) })
                : t("users.toast.memberAdded"),
            ),
          onError: (err) => setError(rpcError(err)),
        },
      );
      return;
    }

    if (step === "create") {
      // Username is lowercase alphanumeric only (#87) — the backend enforces the same rule.
      if (!/^[a-z0-9]+$/.test(draft.username)) {
        setError(t("users.create.usernameError"));
        return;
      }

      // Name and username are the two required fields (only-name-and-username-are-required).
      if (draft.name.trim() === "") {
        setError(t("users.create.nameRequired"));
        return;
      }

      // CreateUser makes the account AND the membership in one transaction, so "create, then add" is
      // one call — there is never an account with no team.
      create.mutate(
        {
          teamId: targetTeamId,
          username: draft.username,
          password: draft.password,
          name: draft.name,
          email: draft.email,
          phoneNumber: draft.phone,
          role,
          alias: "",
        },
        {
          onSuccess: () => done(t("users.toast.userCreated", { username: draft.username })),
          onError: (err) => setError(rpcError(err)),
        },
      );
    }
  }

  const submitLabel =
    step === "create"
      ? t("users.addMember.submitCreate")
      : isMember
        ? t("users.addMember.submitChange")
        : t("users.addMember.submit");

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button size="xs" variant="outline" data-testid="open-add-member">
          {t("users.addMember.trigger")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="add-member-dialog">
            <Dialog.Header>
              <Dialog.Title>
                {step === "create" ? t("users.addMember.createTitle") : t("users.addMember.title")}
              </Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                <NotImplementedSummary list={ADD_MEMBER_PENDING} />

                {error && (
                  <Text color="error.fg" data-testid="add-member-error">
                    {error}
                  </Text>
                )}

                {step === "search" && (
                  <>
                    <Field.Root>
                      <Field.Label>
                        {t("users.addMember.findUser")}
                        <NotImplemented list={ADD_MEMBER_PENDING} id="exactSearch" />
                      </Field.Label>
                      <Input
                        value={q}
                        autoFocus
                        placeholder={broad ? t("users.addMember.placeholderBroad") : t("users.addMember.placeholderExact")}
                        data-testid="add-member-search"
                        onChange={(e) => setQ(e.target.value)}
                      />
                      <Field.HelperText>
                        {broad ? t("users.addMember.helperBroad") : t("users.addMember.helperExact")}
                      </Field.HelperText>
                    </Field.Root>

                    {term.length >= 2 &&
                      (search.isPending ? (
                        <Spinner colorPalette="brand" />
                      ) : search.isError ? (
                        <Text color="error.fg">{rpcError(search.error)}</Text>
                      ) : results.length > 0 ? (
                        <Stack gap="1" data-testid="add-member-results">
                          <HStack gap="2">
                            <Text textStyle="xs" color="fg.muted">
                              {t("users.addMember.found", { count: results.length })}
                            </Text>
                            <NotImplemented list={ADD_MEMBER_PENDING} id="phoneLast4" />
                          </HStack>

                          {results.map((user) => (
                            <Button
                              key={user.id.toString()}
                              variant="ghost"
                              w="full"
                              h="auto"
                              py="2"
                              justifyContent="flex-start"
                              textAlign="start"
                              data-testid={`add-member-result-${user.username}`}
                              onClick={() => pick(user)}
                            >
                              <UserItem
                                user={user}
                                role={rolesInTeam?.get(user.id.toString())}
                                teamType={targetTeamType}
                                action={
                                  user.phoneLast4 && (
                                    <Text textStyle="xs" color="fg.muted" flexShrink={0}>
                                      {t("users.addMember.phoneEnding", { last4: user.phoneLast4 })}
                                    </Text>
                                  )
                                }
                              />
                            </Button>
                          ))}
                        </Stack>
                      ) : (
                        <Stack gap="2" align="start" data-testid="add-member-no-match">
                          <Text textStyle="sm" color="fg.muted">
                            {t("users.addMember.noMatch", { q: term })}
                          </Text>
                          {roles.length > 0 && (
                            <Button size="xs" variant="outline" data-testid="add-member-create" onClick={startCreate}>
                              {t("users.addMember.createNew")}
                            </Button>
                          )}
                        </Stack>
                      ))}
                  </>
                )}

                {step === "picked" && picked && (
                  <>
                    <Box borderWidth="1px" borderRadius="l2" p="3" data-testid="add-member-picked">
                      <UserItem
                        user={picked}
                        action={
                          <Button size="xs" variant="ghost" data-testid="add-member-repick" onClick={() => setPicked(undefined)}>
                            {t("users.addMember.repick")}
                          </Button>
                        }
                      />
                    </Box>

                    {isMember && (
                      <Text textStyle="sm" data-testid="add-member-current-role">
                        {t("users.addMember.alreadyMember", { role: roleLabel(currentRole, targetTeamType) })}
                      </Text>
                    )}

                    {changeable && offered.length === 0 ? (
                      // A team has ONE role below Admin, so an Admin looking at Staff has nothing to
                      // change them to — said, rather than an empty picker.
                      <Text textStyle="sm" color="fg.muted" data-testid="add-member-nothing-to-change">
                        {t("users.addMember.nothingToChange")}
                      </Text>
                    ) : changeable ? (
                      <Field.Root>
                        <Field.Label>
                          {isMember ? t("users.addMember.changeRole") : t("users.addMember.selectRole")}
                          <NotImplemented list={ADD_MEMBER_PENDING} id="alreadyMember" />
                        </Field.Label>
                        <RoleSelect roles={offered} teamType={targetTeamType} value={role} onChange={setRole} />
                      </Field.Root>
                    ) : (
                      <Text textStyle="sm" color="fg.muted" data-testid="add-member-cannot-change">
                        {t("users.addMember.cannotChange")}
                      </Text>
                    )}
                  </>
                )}

                {step === "create" && (
                  <>
                    <Text textStyle="sm" color="fg.muted">
                      {t("users.addMember.createLead")}
                    </Text>

                    <Field.Root required>
                      <Field.Label>{t("users.field.username")}</Field.Label>
                      <Input
                        value={draft.username}
                        data-testid="add-member-new-username"
                        onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                      />
                      <Field.HelperText>{t("users.helper.usernameRule")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root required>
                      <Field.Label>{t("users.field.password")}</Field.Label>
                      <PasswordInput
                        value={draft.password}
                        data-testid="add-member-new-password"
                        onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                      />
                      <Field.HelperText>{t("users.helper.min8")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root required>
                      <Field.Label>{t("users.field.name")}</Field.Label>
                      <Input
                        value={draft.name}
                        data-testid="add-member-new-name"
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("users.field.email")}</Field.Label>
                      <Input
                        value={draft.email}
                        data-testid="add-member-new-email"
                        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>
                        {t("users.field.phone")}
                        <NotImplemented list={ADD_MEMBER_PENDING} id="duplicateRefusal" />
                      </Field.Label>
                      <Input
                        value={draft.phone}
                        data-testid="add-member-new-phone"
                        onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                      />
                      <Field.HelperText>{t("users.addMember.oneAccountHelper")}</Field.HelperText>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("users.addMember.selectRole")}</Field.Label>
                      <RoleSelect roles={roles} teamType={targetTeamType} value={role} onChange={setRole} />
                    </Field.Root>

                    <Box>
                      <Button size="xs" variant="ghost" data-testid="add-member-back" onClick={() => setCreating(false)}>
                        {t("users.addMember.backToSearch")}
                      </Button>
                    </Box>
                  </>
                )}
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button type="button" variant="outline">
                  {t("users.cancel")}
                </Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette="brand"
                loading={busy}
                disabled={step === "search" || role === Role.UNSPECIFIED || !changeable}
                onClick={submit}
                data-testid="submit-add-member"
              >
                {submitLabel}
              </Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

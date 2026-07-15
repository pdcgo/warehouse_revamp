import { useEffect, useState } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  NativeSelect,
  Portal,
  RadioGroup,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError, userClient } from "../api/clients";
import type { PublicUser } from "../gen/warehouse/user/v1/user_pb";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import type { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";
import { roleLabel, rolesFor } from "../lib/roles";

// AddMemberDialog adds an EXISTING user to a team. It defaults to the CURRENT team (the scope), but
// a caller may target another team explicitly (the team detail page manages an arbitrary team's
// members) by passing `teamId` + `teamType`.
//
// It is the reason SearchUser is unscoped: you cannot find someone who is not in your team by
// searching within your team. The search deliberately returns PublicUser only — id, username,
// name — so browsing colleagues never exposes their email or phone.
export function AddMemberDialog({
  onDone,
  teamId,
  teamType,
}: {
  onDone: () => void;
  teamId?: bigint;
  teamType?: TeamType;
}) {
  const { current } = useTeam();

  const targetTeamId = teamId ?? current?.teamId;
  const targetTeamType = teamType ?? current?.teamType;

  const roles = rolesFor(targetTeamType);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [role, setRole] = useState<Role>(roles[roles.length - 1] ?? Role.TEAM_ADMIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The backend requires q >= 2 characters — it will not let you enumerate the whole user table
  // with an empty search. Respect that here rather than firing a request that must fail.
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);

      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await userClient.searchUser({ q: q.trim(), limit: 10 });

          if (!cancelled) {
            setResults(res.users);
          }
        } catch (err) {
          if (!cancelled) {
            setError(rpcError(err));
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, open]);

  async function add() {
    if (!selected || targetTeamId === undefined) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await userClient.teamUserUpdate({
        teamId: targetTeamId,
        action: {
          case: "add",
          value: { userId: BigInt(selected), role, alias: "" },
        },
      });

      toaster.create({ type: "success", title: "Member added" });

      setQ("");
      setResults([]);
      setSelected("");
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
        <Button size="xs" variant="outline" data-testid="open-add-member">
          Add member
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Add Member</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                {error && (
                  <Text color="red.fg" data-testid="add-member-error">
                    {error}
                  </Text>
                )}

                <Field.Root>
                  <Field.Label>Find a user</Field.Label>
                  <Input
                    value={q}
                    placeholder="Search across all teams"
                    data-testid="member-search"
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <Field.HelperText>At least 2 characters.</Field.HelperText>
                </Field.Root>

                {results.length > 0 && (
                  <RadioGroup.Root
                    value={selected}
                    onValueChange={(e) => setSelected(e.value ?? "")}
                  >
                    <Stack gap="field">
                      {results.map((user) => (
                        <RadioGroup.Item
                          key={user.id.toString()}
                          value={user.id.toString()}
                          data-testid={`member-option-${user.username}`}
                        >
                          <RadioGroup.ItemHiddenInput />
                          <RadioGroup.ItemIndicator />
                          <RadioGroup.ItemText>
                            {user.username}
                            {user.name ? ` — ${user.name}` : ""}
                          </RadioGroup.ItemText>
                        </RadioGroup.Item>
                      ))}
                    </Stack>
                  </RadioGroup.Root>
                )}

                <Field.Root>
                  <Field.Label>Role</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      value={String(role)}
                      data-testid="member-role"
                      onChange={(e) => setRole(Number(e.target.value) as Role)}
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette="brand"
                loading={busy}
                disabled={!selected}
                onClick={() => void add()}
                data-testid="submit-add-member"
              >
                Add
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

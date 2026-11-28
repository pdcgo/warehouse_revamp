import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Code, Field, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { toaster } from "../../../components/feedback/Toaster";
import { canWrite, useTeam } from "../../../features/team/TeamContext";
import { TeamCodeConfirm } from "../../../features/teams/TeamCodeConfirm";
import { useTeamDetail } from "../../../features/teams/queries";
import { editsTeamCode, TEAM_CODE_MAX, useTeamCodeChange } from "../../../features/teams/teamCode";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { useSeedOnce } from "../../../lib/useSeedOnce";

// THE *KODE TIM* CARD of Settings (backlog #150; the-team-code-and-product-tags-prototype-is-accepted, *Settings*). A
// SELLING team's code — the prefix in front of every product code it owns — shown to its people, and edited by its Owner
// and Admin, Root and the Administrator (TeamCodeUpdate's policy, the acceptance rows' givens 1–2):
//
//   ┌ Kode tim ──────────────────────────────────────────┐
//   │ Awalan setiap kode produk milik tim ini — SL-03-….  │
//   │ Kode  [SL-03            ]                           │
//   │ Paling banyak 10 karakter. Kode lama tetap milik …  │
//   │ [Simpan]                                            │
//   └─────────────────────────────────────────────────────┘
//
// Save asks TeamCodePreview first (features/teams/teamCode.ts — the one read of this card's act, never on the page's
// load): a code ANOTHER team holds or ever held is refused in place, naming it (*SL-01 sudah ada — dipakai Toko
// Melati*); otherwise the four-line confirm says what follows, and Change Code sends TeamCodeUpdate. The same code again
// changes nothing, so Save waits for a different one. CS and a monitor read the code; a warehouse or admin team has no
// card — only a selling team's code is edited, and nothing of a warehouse depends on its code.
export function TeamCodeCard() {
  const { t } = useTranslation();
  const { current } = useTeam();

  const teamId = current?.teamId;
  const selling = current?.teamType === TeamType.SELLING;
  // The page's own read of the team (TeamDetail, the same entry its name and warehouse cards read) — no read of its own.
  const detail = useTeamDetail({ teamId: teamId ?? 0n, enabled: teamId !== undefined && selling });
  const saved = detail.data?.teamCode ?? "";

  const [code, setCode] = useState("");
  // The field takes the team's code ONCE per team, from an answer given since the page opened — then it is the person's.
  const seeded = useSeedOnce(teamId?.toString() ?? "", detail.isFetchedAfterMount && detail.data != null, () =>
    setCode(saved),
  );

  const change = useTeamCodeChange(teamId);

  if (!current || !selling) {
    return null;
  }

  const editable = canWrite(current) && editsTeamCode(current.role);
  const clean = code.trim();
  const changed = seeded && clean !== "" && clean !== saved;
  const tooLong = [...clean].length > TEAM_CODE_MAX;
  const refused = change.refusal;
  const busy = change.asking || change.saving;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed || tooLong || busy) return;

    void change.ask(clean);
  }

  async function confirm() {
    const answer = await change.confirm();
    if (!answer) return;

    toaster.create({
      type: "success",
      title: t("account.teamCode.saved", { code: answer.team?.teamCode ?? clean, count: answer.productsRecomposed }),
    });
  }

  return (
    <Card.Root data-testid="settings-team-code-card">
      <Card.Body>
        <form onSubmit={submit}>
          <Stack gap="card">
            <Heading size="sm">{t("account.teamCode.title")}</Heading>

            <Text color="fg.muted" fontSize="xs" data-testid="settings-team-code-lead">
              {t("account.teamCode.lead", { example: `${saved || "…"}-…` })}
            </Text>

            <Field.Root invalid={refused !== null || tooLong || change.error !== ""}>
              <Field.Label>{t("account.teamCode.label")}</Field.Label>
              <Input
                value={code}
                maxW="16rem"
                disabled={!editable || !seeded || busy}
                fontFamily="mono"
                aria-label={t("account.teamCode.label")}
                data-testid="settings-team-code"
                onChange={(e) => {
                  setCode(e.target.value);
                  change.clear();
                }}
              />
              {refused ? (
                <Field.ErrorText data-testid="settings-team-code-refused">
                  {refused.why === "taken"
                    ? t("account.teamCode.taken", { code: refused.code, team: refused.holder })
                    : t("account.teamCode.former", { code: refused.code })}
                </Field.ErrorText>
              ) : change.error ? (
                <Field.ErrorText data-testid="settings-team-code-error">{change.error}</Field.ErrorText>
              ) : tooLong ? (
                <Field.ErrorText data-testid="settings-team-code-too-long">
                  {t("account.teamCode.tooLong", { max: TEAM_CODE_MAX })}
                </Field.ErrorText>
              ) : (
                <Field.HelperText data-testid="settings-team-code-help">
                  {t("account.teamCode.help", { max: TEAM_CODE_MAX })}
                </Field.HelperText>
              )}
            </Field.Root>

            {!editable && (
              <Text color="fg.muted" fontSize="xs" data-testid="settings-team-code-hint">
                {t("account.teamCode.onlyManagers")}
              </Text>
            )}

            {/* What Save would change, said before it is pressed — the old code, the new one. */}
            {editable && changed && (
              <Text fontSize="xs" color="fg.muted" data-testid="settings-team-code-change">
                <Code>{saved}</Code> → <Code>{clean}</Code>
              </Text>
            )}

            {/* Save as every Settings card has it — the card's width (the name card's). */}
            {editable && (
              <Button
                type="submit"
                colorPalette="brand"
                loading={busy}
                disabled={!changed || tooLong}
                data-testid="save-team-code"
              >
                {t("account.save")}
              </Button>
            )}
          </Stack>
        </form>

        {change.confirming && (
          <TeamCodeConfirm
            open
            onOpenChange={(open) => {
              if (!open) change.closeConfirm();
            }}
            oldTeamCode={saved}
            newTeamCode={change.confirming.code}
            figures={change.confirming.figures}
            onConfirm={confirm}
          />
        )}
      </Card.Body>
    </Card.Root>
  );
}

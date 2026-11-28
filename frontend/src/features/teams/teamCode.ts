import { useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { teamClient, rpcError } from "../../api/clients";
import { key } from "../../api/queryClient";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import type { TeamCodePreviewResponse, TeamCodeUpdateResponse } from "../../gen/warehouse/team/v1/team_pb";
import { TeamCodePreviewVerdict, TeamCodeTakenSchema } from "../../gen/warehouse/team/v1/team_pb";
import { useInvalidateProducts } from "../products/queries";
import { useInvalidateTeams } from "./queries";

// THE TEAM CODE EDIT (backlog #150, the-team-code-and-product-tags-prototype-is-accepted) — what Settings' *Kode tim*
// card and root's Edit Team share: one ask, one confirm, one write (a-team-code-change-recomposes-its-product-codes).
//
//   Save ── TeamCodePreview (read HERE, when Save opens the confirm — never on a page load) ──┬─ TAKEN / FORMER → refused
//                                                                                             │    in place, naming the team
//                                                                                             ├─ SAME → nothing to confirm
//                                                                                             └─ CHANGES → the four-line
//   confirm ── Change Code ── TeamCodeUpdate ──┬─ saved → every read that shows a code re-read                confirm
//                                              └─ AlreadyExists + TeamCodeTaken (another team took it in between) → refused
//
// The preview is an ACT's read, not a screen's: it answers one Save, so it is fetched on the click (`fetchQuery`, keyed
// `key.teams`, always fresh) rather than mounted as a query — a save's invalidation then has nothing left to re-read.

/** A team code's length on the wire (TeamCreate / TeamCodeUpdate / TeamCodePreview `team_code`: 1–10). */
export const TEAM_CODE_MAX = 10;

/** TeamCodeUpdate's (and TeamCodePreview's) roles — UX only; the access interceptor is the boundary. */
export function editsTeamCode(role: Role | undefined): boolean {
  return role === Role.ROOT || role === Role.ADMINISTRATOR || role === Role.SELLING_OWNER || role === Role.SELLING_ADMIN;
}

/** Why a code is refused — another team holds it now, or held it once (a former code stays taken). */
export interface TeamCodeRefusal {
  why: "taken" | "former";
  /** The team that holds it, or held it. */
  holder: string;
  /** The code refused, as sent. */
  code: string;
}

/** The confirm's figures — TeamCodePreview's CHANGES answer. */
export interface TeamCodePreviewFigures {
  products: number;
  exampleOld: string;
  exampleNew: string;
  warehouses: string[];
}

/** TeamCodePreview as an options object — fetched on Save, keyed in the team's domain, never cached past its answer. */
export function teamCodePreviewQuery(teamId: bigint, teamCode: string) {
  return {
    queryKey: key.teams(teamId, { codePreview: teamCode }),
    staleTime: 0,
    retry: false,
    queryFn: (): Promise<TeamCodePreviewResponse> => teamClient.teamCodePreview({ teamId, teamCode }),
  };
}

/** The refusal a write carries in its TeamCodeTaken detail — null for any other error. */
export function teamCodeTakenOf(err: unknown, code: string): TeamCodeRefusal | null {
  const [taken] = ConnectError.from(err).findDetails(TeamCodeTakenSchema);
  if (!taken) return null;

  return { why: taken.former ? "former" : "taken", holder: taken.teamName, code };
}

// THE WRITE. Its invalidation reaches every read that shows a code, by domain prefix (never a global reset): the
// team's own — TeamDetail (Settings' card), TeamList (the Teams page, every TeamSelect, the switcher's All teams) — and
// the products' — ProductList, ProductDetail, Discover (`products`) and the warehouse lists (`inventory`).
export function useUpdateTeamCode() {
  const invalidateTeams = useInvalidateTeams();
  const invalidateProducts = useInvalidateProducts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; teamCode: string }) => teamClient.teamCodeUpdate(vars),
    onSuccess: () => Promise.all([invalidateTeams(), invalidateProducts()]),
  });
}

/** One team code change, asked then confirmed — the card's and Edit Team's state. */
export function useTeamCodeChange(teamId: bigint | undefined) {
  const client = useQueryClient();
  const update = useUpdateTeamCode();

  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<TeamCodeRefusal | null>(null);
  const [error, setError] = useState("");
  // The confirm is open on this code with these figures — taken from the preview's answer, so a re-read can never
  // change what the person is reading while they decide.
  const [confirming, setConfirming] = useState<{ code: string; figures: TeamCodePreviewFigures } | null>(null);

  /** Save: ask what the change would do. Refused → in place; CHANGES → the confirm opens; SAME → nothing. */
  async function ask(code: string) {
    if (teamId === undefined) return;

    setError("");
    setRefusal(null);
    setAsking(true);

    try {
      const answer = await client.fetchQuery(teamCodePreviewQuery(teamId, code));

      switch (answer.verdict) {
        case TeamCodePreviewVerdict.TAKEN:
        case TeamCodePreviewVerdict.FORMER:
          setRefusal({
            why: answer.verdict === TeamCodePreviewVerdict.FORMER ? "former" : "taken",
            holder: answer.holderTeamName,
            code,
          });
          break;
        case TeamCodePreviewVerdict.CHANGES:
          setConfirming({
            code,
            figures: {
              products: answer.products,
              exampleOld: answer.exampleOldCode,
              exampleNew: answer.exampleNewCode,
              warehouses: answer.warehouseNames,
            },
          });
          break;
      }
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setAsking(false);
    }
  }

  /** Change Code: the write. Its answer when saved; null when refused (said in place) or failed (said as `error`). */
  async function confirm(): Promise<TeamCodeUpdateResponse | null> {
    if (teamId === undefined || !confirming) return null;

    try {
      return await update.mutateAsync({ teamId, teamCode: confirming.code });
    } catch (err) {
      const taken = teamCodeTakenOf(err, confirming.code);
      if (taken) {
        setRefusal(taken);
      } else {
        setError(rpcError(err));
      }

      return null;
    }
  }

  return {
    ask,
    asking,
    refusal,
    error,
    confirming,
    confirm,
    saving: update.isPending,
    /** The confirm closed — confirmed or dismissed. */
    closeConfirm: () => setConfirming(null),
    /** The code was typed again: the last refusal or error no longer speaks of it. */
    clear: () => {
      setRefusal(null);
      setError("");
    },
  };
}

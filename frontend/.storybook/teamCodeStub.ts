// THE TEAM CODE EDIT (backlog #150) — TeamCodePreview, TeamCodeUpdate (TeamService) and ProductLogList (ProductService)
// on the stub transport, with the server's rules (team_v1/team_code_preview.go, team_code_update.go,
// product_v1/product_log_list.go): only a SELLING team's code; the team's own code is SAME / no change; a code another
// team holds now — or held once (a former code is never given to another team) — is refused naming that team, the write
// with a TeamCodeTaken detail; a saved change gives the fixture team its new code (so TeamDetail and TeamList re-read it)
// and keeps the old one among its former codes.
//
// THE STORY IT TELLS — the accepted prototype's (accepts/141): Toko Anggrek (15) is SL-03 with 46 products (two archived)
// held in Gudang Pusat and Gudang Cabang, and was TA before; Toko Melati holds SL-01; Toko Kenanga was KNG before SL-02.
// Minyak (700), 702 and Tepung Karton (703) took SL-03-… two days ago when Budi Santoso changed the code — the Riwayat
// Produk lines.

import { ConnectError, Code } from "@connectrpc/connect";

import type {
  TeamCodePreviewRequest,
  TeamCodeUpdateRequest,
} from "../src/gen/warehouse/team/v1/team_pb";
import { TeamCodePreviewVerdict, TeamCodeTakenSchema, TeamType } from "../src/gen/warehouse/team/v1/team_pb";
import type { ProductLogListRequest } from "../src/gen/warehouse/product/v1/product_log_pb";
import { ProductLogKind } from "../src/gen/warehouse/product/v1/product_log_pb";
import { teams } from "./fixtures";

const DAY = 24n * 3600n;
const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));

/** Codes a team held before its current one — never given to another team (owner Q1 "A"). */
const FORMER_CODES = [
  { teamId: 13n, code: "KNG" },
  { teamId: 15n, code: "TA" },
];

/** How many products each team owns, archived included — what the confirm counts. */
const PRODUCT_COUNTS: Record<string, number> = { "12": 6, "13": 1, "15": 46 };

/** The warehouses holding stock of each team's products, by name — what the confirm says reprints (sorted, as served). */
const HOLDERS: Record<string, string[]> = {
  "12": ["Gudang Pusat"],
  "13": ["Gudang Pusat"],
  "15": ["Gudang Cabang", "Gudang Pusat"],
};

/** One product of each team, as the confirm's example: its code part after the team code (`ANG-001`). */
const SAMPLE_PARTS: Record<string, string> = { "12": "BERAS-5K", "13": "GULA-1K", "15": "ANG-001" };

/** Budi Santoso (fixtures.ts users) — who changed Toko Anggrek's code. */
const BUDI = 62n;

interface StubLog {
  id: bigint;
  productId: bigint;
  oldCode: string;
  newCode: string;
  actorId: bigint;
  isOverride: boolean;
  createdAtUnix: bigint;
}

function defaultLogs(): StubLog[] {
  const at = nowUnix() - 2n * DAY - 3n * 3600n;

  return [
    { id: 9001n, productId: 700n, oldCode: "TA-ANG-001", newCode: "SL-03-ANG-001", actorId: BUDI, isOverride: false, createdAtUnix: at },
    { id: 9002n, productId: 702n, oldCode: "TA-ANG-003", newCode: "SL-03-ANG-003", actorId: BUDI, isOverride: false, createdAtUnix: at },
    { id: 9003n, productId: 703n, oldCode: "TA-ANG-004", newCode: "SL-03-ANG-004", actorId: BUDI, isOverride: false, createdAtUnix: at },
  ];
}

/** What the screens SENT this story — each preview asked and each write, in order. Reset per story. */
export const teamCodeScenario = {
  previews: [] as { teamId: bigint; teamCode: string }[],
  updates: [] as { teamId: bigint; teamCode: string }[],
  logReads: [] as { teamId: bigint; productId: bigint; page: number; limit: number }[],
};

let formerCodes = [...FORMER_CODES];
let logs = defaultLogs();
// A code another team takes between the preview and the write — the write's TeamCodeTaken then speaks (one story).
let takenInBetween: { code: string; holder: string } | null = null;
let failPreview = false;

// The fixture teams' codes as they were, so a saved change is undone for the next story.
const ORIGINAL_CODES = new Map(teams.map((t) => [t.id, t.teamCode]));

export function resetTeamCodeStub() {
  teamCodeScenario.previews.length = 0;
  teamCodeScenario.updates.length = 0;
  teamCodeScenario.logReads.length = 0;
  formerCodes = [...FORMER_CODES];
  logs = defaultLogs();
  takenInBetween = null;
  failPreview = false;

  for (const team of teams) {
    team.teamCode = ORIGINAL_CODES.get(team.id) ?? team.teamCode;
  }
}

/** A `beforeEach`: another team takes `code` after the preview said it is free — the write is refused naming it. */
export function teamCodeTakenInBetweenForStory(code: string, holder: string) {
  return () => {
    takenInBetween = { code, holder };
  };
}

/** A `beforeEach`: TeamCodePreview fails (Unavailable) — the card says so, and nothing is confirmed. */
export function teamCodePreviewFailsForStory() {
  failPreview = true;
}

/** A `beforeEach`: the product's history is these many lines (newest first by id), by Budi — the pager's story. */
export function productLogsForStory(productId: bigint, count: number, { override = false } = {}) {
  return () => {
    const at = nowUnix() - DAY;
    logs = Array.from({ length: count }, (_, i) => ({
      id: 9100n + BigInt(i),
      productId,
      oldCode: `OLD${i}-ANG-001`,
      newCode: `NEW${i}-ANG-001`,
      actorId: BUDI,
      isOverride: override,
      createdAtUnix: at - BigInt(i) * 3600n,
    }));
  };
}

/**
 * The codes a product carried before, newest line first — its history's `old_code`s, as the Riwayat Produk card lists
 * them. What ProductCodesByIds answers as former codes and what the product search matches whole (backlog #152 —
 * productCodeScenario.ts).
 */
export function formerCodesInHistory(productId: bigint): string[] {
  return logs
    .filter((log) => log.productId === productId)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((log) => log.oldCode);
}

/** The team other than `teamId` that holds `code` now, or held it once — a current holder first (team_codes.go). */
function holderOf(code: string, teamId: bigint): { name: string; former: boolean } | null {
  const now = teams.find((t) => t.id !== teamId && t.teamCode === code);
  if (now) return { name: now.name, former: false };

  const once = formerCodes.find((f) => f.teamId !== teamId && f.code === code);
  if (once) return { name: teams.find((t) => t.id === once.teamId)?.name ?? `#${once.teamId}`, former: true };

  return null;
}

function sellingTeam(teamId: bigint) {
  const team = teams.find((t) => t.id === teamId && !t.deleted);
  if (!team) throw new ConnectError("team not found", Code.NotFound);
  if (team.type !== TeamType.SELLING) {
    throw new ConnectError("only a selling team's code can be changed", Code.FailedPrecondition);
  }

  return team;
}

export const teamCodeService = {
  teamCodePreview: (req: TeamCodePreviewRequest) => {
    const code = req.teamCode.trim();
    teamCodeScenario.previews.push({ teamId: req.teamId, teamCode: code });

    if (failPreview) throw new ConnectError("the team service is unavailable", Code.Unavailable);
    if (code === "") throw new ConnectError("the team code is blank", Code.InvalidArgument);

    const team = sellingTeam(req.teamId);
    if (team.teamCode === code) return { verdict: TeamCodePreviewVerdict.SAME };

    const holder = holderOf(code, req.teamId);
    if (holder) {
      return {
        verdict: holder.former ? TeamCodePreviewVerdict.FORMER : TeamCodePreviewVerdict.TAKEN,
        holderTeamName: holder.name,
      };
    }

    const key = req.teamId.toString();
    const part = SAMPLE_PARTS[key] ?? "";
    const products = PRODUCT_COUNTS[key] ?? 0;

    return {
      verdict: TeamCodePreviewVerdict.CHANGES,
      products,
      exampleOldCode: products > 0 && part ? `${team.teamCode}-${part}` : "",
      exampleNewCode: products > 0 && part ? `${code}-${part}` : "",
      warehouseNames: products > 0 ? (HOLDERS[key] ?? []) : [],
    };
  },

  teamCodeUpdate: (req: TeamCodeUpdateRequest) => {
    const code = req.teamCode.trim();
    teamCodeScenario.updates.push({ teamId: req.teamId, teamCode: code });

    if (code === "") throw new ConnectError("the team code is blank", Code.InvalidArgument);

    const team = sellingTeam(req.teamId);
    if (team.teamCode === code) return { team: { ...team }, changed: false };

    const holder = takenInBetween && takenInBetween.code === code ? { name: takenInBetween.holder, former: false } : holderOf(code, req.teamId);
    if (holder) {
      throw new ConnectError(`team_code already exists — ${code} is ${holder.name}'s code`, Code.AlreadyExists, undefined, [
        { desc: TeamCodeTakenSchema, value: { teamCode: code, teamName: holder.name, former: holder.former } },
      ]);
    }

    formerCodes = [...formerCodes.filter((f) => !(f.teamId === team.id && f.code === code)), { teamId: team.id, code: team.teamCode }];
    team.teamCode = code;

    const products = PRODUCT_COUNTS[req.teamId.toString()] ?? 0;

    return {
      team: { ...team },
      changed: true,
      productsRecomposed: products,
      productsTagged: Math.min(products, 2),
    };
  },

  productLogList: (req: ProductLogListRequest) => {
    const page = req.page?.page ?? 1;
    const limit = req.page?.limit ?? 20;
    teamCodeScenario.logReads.push({ teamId: req.teamId, productId: req.productId, page, limit });

    const mine = logs
      .filter((log) => log.productId === req.productId)
      .sort((a, b) => (a.createdAtUnix === b.createdAtUnix ? Number(b.id - a.id) : a.createdAtUnix < b.createdAtUnix ? 1 : -1));
    const start = (page - 1) * limit;

    return {
      logs: mine.slice(start, start + limit).map((log) => ({ ...log, kind: ProductLogKind.CODE_CHANGED })),
      pageInfo: { currentPage: page, totalItems: BigInt(mine.length), totalPage: Math.ceil(mine.length / limit) },
    };
  },
};

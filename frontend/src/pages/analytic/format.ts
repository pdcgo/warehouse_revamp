import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { key, referenceQuery } from "../../api/queryClient";
import { type FieldKind, type MetricDef, type TableGroup, isTimeGroup } from "../../features/analytic/catalogue";
import { sampleName } from "../../features/analytic/sample";
import { useShopsByIds } from "../../features/shops/queries";
import { useTeamsByIds } from "../../features/teams/queries";
import { fetchActors } from "../../features/users/queries";
import { dateInputToUnix, formatUnixDate } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";

/**
 * A field's label — its own name's, unless its METRIC names it apart. Two order metrics share `mp_total` (the owner's
 * field names), so a table, a graph or a sort list holding both would read "MP total" twice;
 * `analytic.fieldOf.<metric>.<field>` tells them apart.
 */
export function fieldLabel(t: TFunction, def: MetricDef, name: string): string {
  return t(`analytic.fieldOf.${def.labelKey}.${name}`, { defaultValue: t(`analytic.field.${name}`) });
}

/**
 * A figure as its kind reads — a count grouped id-ID, money and a position through the app's rupiah formatter (−Rp before
 * a loss), a rate as a percentage to two places. A figure the service left UNSET reads "—": a take rate with no sale to
 * divide by is not 0%.
 */
export function formatFigure(kind: FieldKind, value: number | undefined): string {
  if (value === undefined) return "—";
  if (kind === "count") return value.toLocaleString("id-ID");
  if (kind === "ratio") return `${(value * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

  return formatRupiahNumber(value);
}

/**
 * THE NAMES OF A PAGE'S ROWS, for an id group a SERVED metric keys by real ids — shops by ShopByIds, sellers and
 * warehouses by TeamByIds, people by UserByIDs. One read per page, never one per row; a name lookup (referenceQuery), so
 * it labels and nobody works from it. An id nobody could name is simply absent, and keyLabel falls back.
 */
export function useKeyNames(group: TableGroup, keys: string[]): Map<string, string> {
  const ids = isTimeGroup(group) ? [] : keys.filter((k) => /^\d+$/.test(k)).map((k) => BigInt(k));

  const shops = useShopsByIds({ shopIds: group === "shop" ? ids : [] });
  const teams = useTeamsByIds({ ids: group === "team" || group === "warehouse" ? ids : [] });
  const people = useQuery({
    ...referenceQuery,
    queryKey: key.users(undefined, { byIds: ids.map(String).sort().join(",") }),
    enabled: group === "user" && ids.length > 0,
    queryFn: () => fetchActors(ids),
  });

  const out = new Map<string, string>();

  if (group === "shop") for (const [id, shop] of shops.data ?? []) out.set(id, shop.name);
  if (group === "team" || group === "warehouse") for (const [id, team] of Object.entries(teams.data ?? {})) out.set(id, team.name);
  if (group === "user") for (const [id, person] of people.data ?? []) out.set(id, person.name);

  return out;
}

/**
 * What a row is called — an entity's name, a day, the week it starts, a month, a year. In the app's language.
 *
 * An id is named by `names` first (a served metric's real ids); a shop, product or supplier the lookup could not name is
 * a SAMPLE metric's, named by the sample; anything else reads `#<id>`.
 */
export function keyLabel(group: TableGroup, key: string, t: TFunction, language: string, names?: Map<string, string>): string {
  if (!isTimeGroup(group)) {
    const named = names?.get(key);
    if (named) return named;

    return group === "shop" || group === "product" || group === "supplier" ? sampleName(group, key) : `#${key}`;
  }

  const date = new Date(`${key}T00:00:00`);
  if (group === "monthly") return new Intl.DateTimeFormat(language, { month: "short", year: "numeric" }).format(date);
  if (group === "yearly") return key.slice(0, 4);

  const day = formatUnixDate(dateInputToUnix(key, false));

  return group === "weekly" ? t("analytic.weekOf", { date: day }) : day;
}

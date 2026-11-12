import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { key, referenceQuery } from "../../api/queryClient";
import { CHANGE_TYPE_FIELDS, type FieldKind, type MetricDef, type TableGroup, isTimeGroup } from "../../features/analytic/catalogue";
import { sampleName } from "../../features/analytic/sample";
import { useFinancialAccountsByIds } from "../../features/financialAccount/queries";
import { useProductsByIds } from "../../features/products/queries";
import { useShopsByIds } from "../../features/shops/queries";
import { useSuppliersByIds } from "../../features/suppliers/queries";
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
 * A figure as its kind reads — a count and a units position grouped id-ID, money and a position through the app's rupiah
 * formatter (−Rp before a loss, a fraction to three places), a rate as a percentage to two places. A figure the service
 * left UNSET reads "—": a take rate with no sale to divide by is not 0%.
 */
export function formatFigure(kind: FieldKind, value: number | undefined): string {
  if (value === undefined) return "—";
  if (kind === "count" || kind === "unitsPosition") return value.toLocaleString("id-ID");
  if (kind === "ratio") return `${(value * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

  return formatRupiahNumber(value);
}

/**
 * THE NAMES OF A PAGE'S ROWS, for an id group a SERVED metric keys by real ids — shops by ShopByIds, sellers and
 * warehouses by TeamByIds, people by UserByIDs, products by ProductByIds and suppliers by SupplierByIds (both answer
 * any team's, archived or deleted ones included — a loss in a warehouse names the seller's product). One read per page, never one per row; a name lookup (referenceQuery), so
 * it labels and nobody works from it. An id nobody could name is simply absent, and keyLabel falls back.
 */
export function useKeyNames(group: TableGroup, keys: string[], teamId?: bigint): Map<string, string> {
  const ids = isTimeGroup(group) ? [] : keys.filter((k) => /^\d+$/.test(k)).map((k) => BigInt(k));

  const shops = useShopsByIds({ shopIds: group === "shop" ? ids : [] });
  const teams = useTeamsByIds({ ids: group === "team" || group === "warehouse" ? ids : [] });
  // A Finance account by FinancialAccountByIds — the caller's own team's, archived ones included.
  const accounts = useFinancialAccountsByIds(teamId, group === "account" ? ids : []);
  const products = useProductsByIds({ teamId, productIds: group === "product" ? ids : [] });
  const suppliers = useSuppliersByIds({ teamId, supplierIds: group === "supplier" ? ids : [] });
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
  if (group === "account") for (const [id, account] of accounts.data ?? []) out.set(id, account.name);
  if (group === "product") for (const [id, product] of products.data ?? []) out.set(id, product.name);
  if (group === "supplier") for (const [id, supplier] of suppliers.data ?? []) out.set(id, supplier.name);

  return out;
}

/**
 * What a row is called — an entity's name, a day, the week it starts, a month, a year. In the app's language.
 *
 * An id is named by `names` first (a served metric's real ids); a shop the lookup could not name is a SAMPLE metric's
 * (Ads), named by the sample; anything else reads `#<id>` — a product or a supplier is only ever a served metric's row
 * (Lost stock), so a sample name there would put a made-up product on a real loss.
 */
/** A provider's enum number (`FinancialAccountProvider`) as the account screens' i18n key. */
const PROVIDER_KEY: Record<string, string> = { "1": "cash", "2": "bca", "3": "bni", "4": "jago", "5": "shopeepay", "6": "unknown" };

export function keyLabel(group: TableGroup, key: string, t: TFunction, language: string, names?: Map<string, string>): string {
  if (!isTimeGroup(group)) {
    const named = names?.get(key);
    if (named) return named;

    // The Finance groups: an account is named by FinancialAccountByIds (above), a provider as the account screens name
    // it, a change type by its column's own label on Account changes — so a row and a column of the same type read the same.
    if (group === "account") return `#${key}`;
    if (group === "provider") return PROVIDER_KEY[key] ? t(`financialAccounts.provider.${PROVIDER_KEY[key]}`) : `#${key}`;
    if (group === "change_type") {
      const field = CHANGE_TYPE_FIELDS[Number(key) - 1];
      return field ? t(`analytic.fieldOf.financialAccounts.${field}`) : `#${key}`;
    }

    return group === "shop" ? sampleName(group, key) : `#${key}`;
  }

  // A time group's key is a period's first day. Anything else is not a date — never handed to a date formatter, which
  // throws "Invalid time value" and takes the page down (#43: an id group's rows, kept on screen while the new group
  // loads). The page draws kept rows by their own group; this is the last guard.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return `#${key}`;

  const date = new Date(`${key}T00:00:00`);
  if (group === "monthly") return new Intl.DateTimeFormat(language, { month: "short", year: "numeric" }).format(date);
  if (group === "yearly") return key.slice(0, 4);

  const day = formatUnixDate(dateInputToUnix(key, false));

  return group === "weekly" ? t("analytic.weekOf", { date: day }) : day;
}

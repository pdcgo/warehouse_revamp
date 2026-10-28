import type { TFunction } from "i18next";

import type { FieldKind, TableGroup } from "../../features/analytic/catalogue";
import { sampleName } from "../../features/analytic/sample";
import { dateInputToUnix, formatUnixDate } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";

/** A figure as its kind reads — a count grouped id-ID, money through the app's rupiah formatter (−Rp before a loss). */
export function formatFigure(kind: FieldKind, value: number): string {
  return kind === "money" ? formatRupiahNumber(value) : value.toLocaleString("id-ID");
}

/** What a row is called — a shop's name, a day, the week it starts, a month, a year. In the app's language. */
export function keyLabel(group: TableGroup, key: string, t: TFunction, language: string): string {
  if (group === "shop" || group === "product" || group === "supplier") return sampleName(group, key);

  const date = new Date(`${key}T00:00:00`);
  if (group === "monthly") return new Intl.DateTimeFormat(language, { month: "short", year: "numeric" }).format(date);
  if (group === "yearly") return key.slice(0, 4);

  const day = formatUnixDate(dateInputToUnix(key, false));

  return group === "weekly" ? t("analytic.weekOf", { date: day }) : day;
}

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// READ AN .xlsx BACK — enough of the format to check an export's sheets, headers and cells in an e2e, with no library:
// the zip's central directory, each entry inflated, then the sheets' cells read off their XML. Strings may be shared
// (`t="s"`), inline (`t="inlineStr"`) or formula strings (`t="str"`); anything else is the cell's raw `<v>`.

function entries(zip: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record: the last 22+ bytes, signature 0x06054b50.
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");

  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);

    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(dataAt, dataAt + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : raw);

    at += 46 + nameLength + extraLength + commentLength;
  }

  return out;
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const textOf = (xml: string) => unescape([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Every sheet of the file by its name, each a list of rows of cell texts (an empty cell is "", none at a row's end). */
export function readXlsx(path: string): Map<string, string[][]> {
  const files = entries(readFileSync(path));
  const text = (name: string) => files.get(name)?.toString("utf8") ?? "";

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  // The sheets' names, in order, and where each one's XML is.
  const targets = new Map(
    [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/^\/?(xl\/)?/, "xl/"),
    ]),
  );
  const out = new Map<string, string[][]>();

  for (const sheet of text("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const xml = text(targets.get(sheet[2]!) ?? "");
    const rows: string[][] = [];

    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];

      for (const cell of row[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1]!;
        const body = cell[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
        const v = unescape(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");

        const value = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? textOf(body) : v;
        const index = ref ? columnIndex(ref) : cells.length;
        while (cells.length < index) cells.push("");
        cells[index] = value;
      }

      // A row ends at its last filled cell, as a spreadsheet reads it.
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      rows.push(cells);
    }

    out.set(unescape(sheet[1]!), rows);
  }

  return out;
}

import {
  type UploadedFile,
  UploadedFileByIdsDataType,
  type UploadedFileByIdsResponse,
  type UploadedFileLine,
  UploadedFileLineListDataType,
  type UploadedFileLineListResponseItem,
  UploadedFileListDataType,
  type UploadedFileListResponseItem,
} from "../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";

// UploadedFileList / UploadedFileByIds / UploadedFileLineList answer in the guideline's columnar shape;
// these pull the row slice out at the query boundary so no screen reads the envelope.

export const fileListRowData = (): UploadedFileListDataType[] => [UploadedFileListDataType.FILE];
export const fileByIdsRowData = (): UploadedFileByIdsDataType[] => [UploadedFileByIdsDataType.FILE];
export const lineListRowData = (): UploadedFileLineListDataType[] => [UploadedFileLineListDataType.LINE];

export function filesFromList(items: UploadedFileListResponseItem[], ids: bigint[]): UploadedFile[] {
  let m: { [key: string]: UploadedFile } = {};
  for (const it of items) {
    if (it.d.case === "file") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((f): f is UploadedFile => !!f);
}

// Keyed per id. Another team's file is ABSENT, as if it did not exist — the caller decides what an
// unknown id looks like.
export function filesFromByIds(res: UploadedFileByIdsResponse): Map<string, UploadedFile> {
  const out = new Map<string, UploadedFile>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const item of list.items) {
      if (item.d.case !== "file") continue;

      const file = item.d.value.mapData[id];
      if (file) out.set(id, file);
    }
  }

  return out;
}

export function linesFromList(items: UploadedFileLineListResponseItem[], ids: bigint[]): UploadedFileLine[] {
  let m: { [key: string]: UploadedFileLine } = {};
  for (const it of items) {
    if (it.d.case === "line") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((l): l is UploadedFileLine => !!l);
}

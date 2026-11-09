import {
  type AgentConnection,
  AgentConnectionListDataType,
  type AgentConnectionListResponseItem,
} from "../../gen/warehouse/user/v1/agent_pb";

// Both connection lists — a person's own and a team's — answer in the guideline list shape: the CONNECTION slice keyed
// by id, and the ids in the server's order (newest first). This pulls the rows out at the query boundary.

export const connectionRowData = (): AgentConnectionListDataType[] => [AgentConnectionListDataType.CONNECTION];

export function connectionsFromList(items: AgentConnectionListResponseItem[], ids: bigint[]): AgentConnection[] {
  let m: { [key: string]: AgentConnection } = {};
  for (const it of items) {
    if (it.d.case === "connection") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((c): c is AgentConnection => !!c);
}

/** Search within one machine. Results reflect current readable files, not a saved index. */
export type MachineSearchType = "conversations" | "files" | "objects";
export interface MachineSearchOptions {
  query: string;
  /** Omit to search every category. */
  types?: readonly MachineSearchType[];
  limit?: number;
  /** Continue a previous page using the same query and types. */
  cursor?: string;
  signal?: AbortSignal;
}
interface SearchResultBase {
  path: string;
  title: string;
  snippet: string;
  modifiedAt: string;
  score: number;
}
export type MachineSearchResult =
  | (SearchResultBase & {
      type: "conversations";
      agentId: string;
      conversationId: string;
      turnId?: string;
    })
  | (SearchResultBase & { type: "files" })
  | (SearchResultBase & { type: "objects"; collection: string });
export interface MachineSearchPage {
  results: MachineSearchResult[];
  nextCursor: string | null;
  /** Some content exceeded the scan time, size or supported-content limits. */
  incomplete: boolean;
}
export function machineSearch(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  path: string,
  options: MachineSearchOptions,
): Promise<MachineSearchPage> {
  const params = new URLSearchParams({ q: options.query });
  if (options.types) params.set("types", options.types.join(","));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  return request(`${path}/search?${params}`, { signal: options.signal });
}

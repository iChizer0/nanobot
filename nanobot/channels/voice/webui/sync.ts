import type { ChannelConnectPayload } from "@/lib/types";

/**
 * The connector's payloads: `start` with `plan` reports what a run would move; a run
 * answers `pending` with progress until `succeeded` (core then starts the channel),
 * `failed` or `cancelled`.
 */
export type SyncPlan = {
  /** `update`: installed already, but not as the index pins it now; `bytes` counts what changed. */
  fetch: { key: string; bytes: number; update?: boolean; license?: string | null; notice?: string | null }[];
  prune: { key: string; bytes: number }[];
  unknown: string[];
  fetch_bytes: number;
  prune_bytes: number;
  free_bytes: number;
};

export type SyncProgress = {
  stage: "fetch" | "done";
  key: string | null;
  file: string | null;
  done_bytes: number;
  total_bytes: number;
  keys_done: number;
  keys_total: number;
};

export type SyncPayload = Omit<ChannelConnectPayload, "status"> & {
  status: ChannelConnectPayload["status"] | "planned";
  plan?: SyncPlan;
  /** The cached index's age, whether a reload runs behind this answer, the last reload's error. */
  index?: { cached_unix: number; refreshing: boolean; error: string | null };
  progress?: SyncProgress;
  /** On success: the updates that could not land, their models staying as installed. */
  warning?: string;
};

/** A run's terminal statuses: the panel settles one of these, core acts on "succeeded". */
export const ENDED: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

export function planHasWork(plan: SyncPlan | null): boolean {
  return Boolean(plan && (plan.fetch.length || plan.prune.length));
}

/** Notices still to accept before a run: the plan's, minus what the user ticked. */
export function pendingNotices(plan: SyncPlan | null, accepted: ReadonlySet<string>): string[] {
  return (plan?.fetch ?? []).filter((item) => item.notice && !accepted.has(item.key)).map((item) => item.key);
}

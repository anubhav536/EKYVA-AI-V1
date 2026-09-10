import type { RoutingMode } from "./routing";

export type RequestSummary = {
  id: string;
  capability: string;
  model: string;
  provider: string;
  status: "completed" | "failed" | "processing";
  units: number;
  latencyMs: number;
  createdAt: string;
};

const requests = new Map<string, RequestSummary[]>();

export function getRequests(userId: string): RequestSummary[] {
  return requests.get(userId) ?? [];
}

export function addRequest(userId: string, request: RequestSummary): void {
  requests.set(userId, [request, ...(requests.get(userId) ?? [])].slice(0, 100));
}

export function defaultMode(userId: string): RoutingMode {
  return userId.startsWith("demo") ? "balanced" : "balanced";
}

import type { Lookups } from "@/lib/lookups";

export type Errors = Record<string, string>;
export type Ctx<S> = { s: S; set: (patch: Partial<S>) => void; e: Errors; lk: Lookups; submissionId: string };
export type Step<S> = {
  id: string;
  title: string;
  /** client = the tablet is in the client's hands; rep = rep only */
  who: "client" | "rep";
  intro?: string;
  render: (c: Ctx<S>) => React.ReactNode;
  validate: (s: S) => Errors;
};
export type Flow<S> = {
  initial: () => S;
  steps: Step<S>[];
  toPayload: (s: S, submissionId: string) => Record<string, unknown>;
  rpc: "submit_onboarding" | "submit_spares_visit";
};

/**
 * Slash commands typed into the composer ("/fork"). Kept pure apart from the action
 * bodies, so the matching rules (partial names, ambiguity, arguments) are unit-tested.
 */
import type { RuntimeManager } from "../../paseo/runtime-manager";
import { tabsKey, type UiStore } from "../../stores/ui";
import type { SessionStore } from "../../stores/session";
import { selection } from "../../keyboard/commands";
import * as T from "../workspace/tabs-model";
import { longestCommonPrefix } from "../../util/text";

export interface SlashCtx {
  ui: UiStore;
  store: SessionStore;
  runtimes: RuntimeManager;
}

export interface SlashCommand {
  /** Without the leading slash. */
  name: string;
  title: string;
  hint?: string;
  when?: (ctx: SlashCtx) => boolean;
  run: (ctx: SlashCtx) => void | Promise<void>;
}

const active = (ctx: SlashCtx) => selection({ ui: ctx.ui, store: ctx.store });

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "fork",
    title: "Fork this conversation into a new tab",
    hint: "carries the whole history up to now",
    when: (c) => !!active(c).agent,
    run: async (c) => {
      const { hostId, workspaceId, agentId } = active(c);
      if (!hostId || !workspaceId || !agentId) return;
      if (!c.ui.getState().tabs[tabsKey(hostId, workspaceId)]) return;
      const id = await c.runtimes.get(hostId)!.fork(agentId);
      c.ui.actions.updateTabs(tabsKey(hostId, workspaceId), (s) => T.openTab(s, id, { after: "active" }));
      c.ui.actions.toast("Forked into a new tab", "success");
    },
  },
  {
    name: "stop",
    title: "Stop the running turn",
    when: (c) => active(c).agent?.status === "running",
    run: async (c) => {
      const { hostId, agentId } = active(c);
      if (!hostId || !agentId) return;
      await c.runtimes.get(hostId)!.cancel(agentId);
      c.ui.actions.toast("Stopped");
    },
  },
  { name: "new", title: "Start a new agent", run: (c) => c.ui.actions.openModal({ kind: "newAgent" }) },
  { name: "model", title: "Change this agent's model", run: (c) => c.ui.actions.openModal({ kind: "model" }) },
  { name: "mode", title: "Change this agent's mode", run: (c) => c.ui.actions.openModal({ kind: "mode" }) },
  { name: "thinking", title: "Change this agent's thinking level", run: (c) => c.ui.actions.openModal({ kind: "thinking" }) },
  { name: "settings", title: "Open settings", run: (c) => c.ui.actions.openModal({ kind: "settings" }) },
];

/** The commands that apply right now. */
export function visibleSlash(ctx: SlashCtx): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.when?.(ctx) ?? true);
}

/**
 * The filter text of a slash entry, or null when the draft isn't one.
 * `/fo` → "fo". A space means arguments, so there is nothing left to suggest.
 */
export function slashQuery(text: string): string | null {
  const t = text.trimStart();
  if (!t.startsWith("/") || /\s/.test(t)) return null;
  return t.slice(1);
}

/** Matching commands for the current draft, in registry order. */
export function slashMatches(text: string, list: SlashCommand[]): SlashCommand[] {
  const q = slashQuery(text);
  if (q === null) return [];
  return list.filter((c) => c.name.startsWith(q.toLowerCase()));
}

/**
 * The command an entered line runs: an exact name, or a unique prefix (`/fo`).
 * Ambiguous prefixes run nothing.
 */
export function resolveSlash(text: string, list: SlashCommand[]): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || /\s/.test(trimmed)) return null;
  const name = trimmed.slice(1).toLowerCase();
  if (!name) return null;
  const exact = list.find((c) => c.name === name);
  if (exact) return exact;
  const prefixed = list.filter((c) => c.name.startsWith(name));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

/**
 * Tab in the composer: fills the command the draft is heading for.
 *
 * A unique match is filled (`/fo` → `/fork`); several matches extend to what they share
 * (`/m` → `/mode`), and a name that is already complete stays as it is. Null means "not a
 * command line" (so Tab can indent instead).
 */
export function slashCompletion(text: string, list: SlashCommand[]): { value: string; candidates: SlashCommand[] } | null {
  const q = slashQuery(text);
  if (q === null || q === "") return null;
  const candidates = list.filter((c) => c.name.startsWith(q.toLowerCase()));
  if (candidates.length === 0) return null;
  if (candidates.some((c) => c.name === q)) return { value: `/${q}`, candidates }; // already complete
  const shared = longestCommonPrefix(candidates.map((c) => c.name));
  if (shared.length > q.length) return { value: `/${shared}`, candidates };
  return { value: `/${candidates[0]!.name}`, candidates };
}

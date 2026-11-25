/**
 * Central key routing. App installs the context; every view calls viewShouldIgnore()
 * first, so a key is handled by exactly one owner:
 *   modal open → the modal · focus in composer → composer (+ modifier commands) ·
 *   otherwise → a matching global command, else the focused view.
 */
import { isTextKeySpec, matchKey, type KeyLike } from "./keys";
import { resolveCommands, type Command, type CommandCtx } from "./commands";

let ctx: CommandCtx | null = null;
let commands: Command[] = [];

export function installDispatcher(c: CommandCtx) {
  ctx = c;
  commands = resolveCommands(c.settings.getState().settings.keymap);
}

export function refreshKeymap() {
  if (ctx) commands = resolveCommands(ctx.settings.getState().settings.keymap);
}

export function activeCommands(): Command[] {
  return commands;
}

function findCommand(k: KeyLike): Command | undefined {
  if (!ctx) return undefined;
  const focus = ctx.ui.getState().focus;
  const inComposer = focus === "composer";
  return commands.find((c) => {
    if (focus === "terminal" && c.id !== "terminal.toggle") return false;
    // While typing, a bare printable key belongs to the text field even if a
    // command (or a user remap) lists it; only modifier/special keys still run.
    if (inComposer && !c.inComposer) return false;
    const hit = c.keys.some((spec) => matchKey(k, spec) && !((inComposer || focus === "terminal") && isTextKeySpec(spec)));
    return hit && (c.when?.(ctx!) ?? true);
  });
}

/** Runs the matching global command, if any. Returns true when the key was consumed. */
export function dispatchGlobal(k: KeyLike): boolean {
  if (!ctx || ctx.ui.getState().modal) return false;
  const cmd = findCommand(k);
  if (!cmd) return false;
  void Promise.resolve(cmd.run(ctx)).catch(() => {});
  return true;
}

/** Views call this first: true when a modal owns input or a global command claims the key. */
export function viewShouldIgnore(k: KeyLike): boolean {
  if (!ctx) return false;
  if (ctx.ui.getState().modal) return true;
  return !!findCommand(k);
}

export function runCommand(id: string) {
  const cmd = commands.find((c) => c.id === id);
  if (ctx && cmd && (cmd.when?.(ctx) ?? true)) void Promise.resolve(cmd.run(ctx)).catch(() => {});
}

export const commandContext = () => ctx;

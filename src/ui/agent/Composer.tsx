import { TextAttributes, type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { useApp, useSession, useUi } from "../../stores/context";
import { useTheme } from "../../theme/theme";
import { truncate } from "../text";
import { resolveSlash, slashCompletion, slashMatches, slashQuery, visibleSlash, type SlashCommand } from "./slash";
import { composerHeight, composerLineCount } from "./composer-size";

/** Lets the global Ctrl+C know whether to clear the composer instead of quitting. */
/** What the app (and the global key handler) can ask the open composer to do. */
export const composerHandle = {
  hasText: () => false,
  clear: () => {},
  /** Inserts text at the cursor; used when a terminal sends ⌘V as a key instead of pasting. */
  insert: (_text: string) => {},
};

/** Used until the pane passes its own cap (half the body height). */
export const COMPOSER_MAX_LINES = 8;

export function Composer({ hostId, agentId, width, maxLines = COMPOSER_MAX_LINES, onHeight }: { hostId: string; agentId: string; width: number; maxLines?: number; onHeight?: (h: number) => void }) {
  const t = useTheme();
  const { ui, store, runtimes } = useApp();
  const focused = useUi((s) => s.focus === "composer" && !s.modal);
  const draftKey = `${hostId}:${agentId}`;
  const draftText = useUi((x) => x.drafts[draftKey] ?? "");
  const slashList = visibleSlash({ ui, store, runtimes });
  const initial = useRef(ui.getState().drafts[draftKey] ?? "").current;
  const agent = useSession((s) => s.hosts[hostId]?.agents[agentId]);
  const ref = useRef<TextareaRenderable>(null);
  // Keep the name, not the index: a command can disappear when the agent's status changes.
  const slashPick = useRef<string | null>(null);
  const [slashName, setSlashName] = useState<string | null>(null);
  const pickSlash = (name: string | null) => {
    slashPick.current = name;
    setSlashName(name);
  };
  /** Usable text columns: border (2) + padding (2) + the "› " marker (2). */
  const textWidth = Math.max(8, width - 6);
  const [lines, setLines] = useState(composerLineCount(initial, textWidth));
  const [sending, setSending] = useState(false);

  // A restored draft sizes the layout immediately.
  useEffect(() => onHeight?.(composerHeight(lines, maxLines)), []);

  const sync = () => {
    const text = ref.current?.plainText ?? "";
    ui.actions.setDraft(draftKey, text);
    pickSlash(null);
    const n = composerLineCount(text, textWidth);
    if (n !== lines) {
      setLines(n);
      onHeight?.(composerHeight(n, maxLines));
    }
  };

  composerHandle.hasText = () => focused && !!ref.current?.plainText.length;
  composerHandle.clear = () => {
    ref.current?.setText("");
    sync();
  };
  composerHandle.insert = (text: string) => {
    ref.current?.insertText(text);
    sync();
  };

  const clear = () => {
    ref.current?.setText("");
    sync();
  };

  const send = async () => {
    const raw = ref.current?.plainText ?? "";
    const text = raw.trim();
    if (!text || sending) return;
    // "/fork" and friends act locally; anything else is a prompt.
    if (text.startsWith("/")) {
      const list = visibleSlash({ ui, store, runtimes });
      // A row the arrows highlighted wins: Enter runs what the menu is showing.
      const command = slashPick.current
        ? slashMatches(raw, list).find((c) => c.name === slashPick.current)
        : resolveSlash(text, list);
      if (!command) {
        ui.actions.toast(`No command for "${text.split(" ")[0]}". Use ↑↓ to pick a command or Tab to complete it.`, "error", 5000);
        return;
      }
      clear();
      try {
        await command.run({ ui, store, runtimes });
      } catch (err) {
        ui.actions.toast(`${command.name}: ${err instanceof Error ? err.message : String(err)}`, "error", 6000);
      }
      return;
    }
    setSending(true);
    clear();
    try {
      await runtimes.get(hostId)!.send(agentId, text);
    } catch (err) {
      ref.current?.setText(text);
      sync();
      ui.actions.toast(`Not sent: ${err instanceof Error ? err.message : String(err)}`, "error", 6000);
    } finally {
      setSending(false);
    }
  };

  useKeyboard((k) => {
    if (!focused) return;
    if (k.name === "escape") {
      pickSlash(null);
      return ui.actions.setFocus("main");
    }
    if (!k.defaultPrevented && !k.shift && !k.ctrl && !k.meta && !k.super && (k.name === "up" || k.name === "down")) {
      const text = ref.current?.plainText ?? "";
      const matches = slashMatches(text, slashList);
      if (matches.length > 0) {
        k.preventDefault();
        const dir = k.name === "up" ? -1 : 1;
        const i = matches.findIndex((c) => c.name === slashPick.current);
        const next = i < 0 ? (dir > 0 ? 0 : matches.length - 1) : (i + dir + matches.length) % matches.length;
        pickSlash(matches[next]!.name);
        return;
      }
    }
    // Tab belongs to the text you are writing: it completes a / command, or indents.
    // ⇧Tab cycles modes instead (a global command), and a key some command already
    // claimed (defaultPrevented) never seeds the draft — so only a bare Tab indents.
    if (k.name !== "tab" || k.shift || k.defaultPrevented) return;
    k.preventDefault();
    const text = ref.current?.plainText ?? "";
    const completion = slashCompletion(text, slashList);
    if (completion) {
      const field = ref.current;
      if (!field) return;
      if (completion.value.startsWith(text) && field.cursorOffset === text.length) {
        field.insertText(completion.value.slice(text.length)); // keeps the cursor at the end
      } else {
        field.setText(completion.value);
        field.cursorOffset = completion.value.length;
      }
      sync();
      return;
    }
    if (slashQuery(text) !== null) return; // a command with no match: leave the line alone
    ref.current?.insertText("  ");
    sync();
  });

  const running = agent?.status === "running";
  const mode = agent?.availableModes?.find((m) => m.id === agent.currentModeId)?.label ?? agent?.currentModeId ?? "";
  const model = agent?.model ?? agent?.provider ?? "";
  // "default" (or nothing) means the model's own level: keep the line short and leave it out.
  const thinking = agent?.thinkingOptionId && agent.thinkingOptionId !== "default" ? agent.thinkingOptionId : "";
  const matches = focused ? slashMatches(draftText, slashList) : [];
  const hints = focused
    ? matches.length ? "↑↓ pick · ⏎ run · tab complete · esc" : `⏎ send · ⌥⏎ newline · tab indent · ${running ? "^X stop · " : ""}esc`
    : running
      ? "i write · ^X stop"
      : "i to write";
  const shown = Math.max(1, Math.min(maxLines, lines));
  // The left label and the right hints share one row; clip the label to its half.
  const left = truncate(
    [mode, model ? `model ${model}` : "", thinking ? `thinking ${thinking}` : "", sending ? "sending…" : ""].filter(Boolean).join("  ·  "),
    Math.max(8, width - hints.length - 4),
  );

  return (
    <box flexDirection="column" flexShrink={0}>
      <box
        border
        borderStyle="rounded"
        borderColor={focused ? t.accent : t.border}
        height={shown + 2}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        onMouseDown={() => ui.actions.setFocus("composer")}
      >
        <text fg={focused ? t.accent : t.subtle} flexShrink={0}>{"› "}</text>
        <textarea
          ref={ref}
          flexGrow={1}
          initialValue={initial}
          focused={focused}
          placeholder={running ? "Agent is working — send to steer it…" : "Message the agent…"}
          placeholderColor={t.subtle}
          textColor={t.text}
          focusedTextColor={t.text}
          cursorColor={t.accent}
          // Specific bindings first: a plain `return` binding would also swallow shift+return,
          // which submitted half-typed messages instead of adding a line.
          keyBindings={[
            { name: "return", shift: true, action: "newline" },
            { name: "return", meta: true, action: "newline" },
            { name: "linefeed", action: "newline" },
            { name: "return", action: "submit" },
            { name: "kpenter", action: "submit" },
          ]}
          onSubmit={() => void send()}
          onContentChange={sync}
        />
      </box>
      <SlashHints matches={matches} selected={slashName} width={width} />
      <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg={t.accent} attributes={TextAttributes.BOLD} wrapMode="none">{left}</text>
        <text fg={t.subtle} wrapMode="none">{hints}</text>
      </box>
    </box>
  );
}

function SlashHints({ matches, selected, width }: { matches: SlashCommand[]; selected: string | null; width: number }) {
  const t = useTheme();
  if (matches.length === 0) return null;
  const max = 6;
  const index = matches.findIndex((c) => c.name === selected);
  const start = Math.max(0, Math.min(index - max + 1, matches.length - max));
  const shown = matches.slice(start, start + max);
  const nameW = Math.max(...shown.map((c) => c.name.length)) + 1;
  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={2} paddingBottom={0}>
      {shown.map((c, i) => {
        const sel = start + i === index;
        return (
          <box key={c.name} height={1} backgroundColor={sel ? t.element : undefined}>
            <text wrapMode="none">
              <span fg={sel ? t.accent : t.subtle}>{sel ? "▌" : " "}</span>
              <span fg={t.accent}>{`/${c.name.padEnd(nameW)}`}</span>
              <span fg={sel ? t.text : t.muted}>{` ${truncate(c.hint ?? c.title, Math.max(8, width - nameW - 6))}`}</span>
            </text>
          </box>
        );
      })}
    </box>
  );
}

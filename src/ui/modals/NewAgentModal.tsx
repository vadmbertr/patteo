import { TextAttributes, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { selection } from "../../keyboard/commands";
import { useApp, useSettings } from "../../stores/context";
import { tabsKey, type AgentTarget } from "../../stores/ui";
import { useTheme } from "../../theme/theme";
import { openTab } from "../workspace/tabs-model";
import { Skeleton, WorkingLine } from "../motion/Motion";
import { truncate } from "../text";
import { Overlay } from "./Overlay";
import { modelLabel, normalizeModels } from "./simple";

interface ProviderInfo {
  provider: string;
  label: string;
  defaultModeId?: string;
  modes: { id: string; label: string }[];
}

type Field = "provider" | "model" | "mode" | "prompt";
const FIELDS: Field[] = ["provider", "model", "mode", "prompt"];

/** Provider snapshot → selectable providers (enabled + ready only). */
export function usableProviders(snapshot: unknown): ProviderInfo[] {
  const entries = ((snapshot as { entries?: unknown[] })?.entries ?? []) as Record<string, unknown>[];
  return entries
    .filter((e) => e.enabled !== false && (e.status === undefined || e.status === "ready"))
    .map((e) => ({
      provider: String(e.provider),
      label: String(e.label ?? e.provider),
      defaultModeId: typeof e.defaultModeId === "string" ? e.defaultModeId : undefined,
      modes: Array.isArray(e.modes) ? (e.modes as { id: string; label: string }[]).map((m) => ({ id: m.id, label: m.label ?? m.id })) : [],
    }));
}

/** Where the agent goes: an explicit target (from "new agent in this folder") or the selection. */
export function agentTarget(
  target: AgentTarget | undefined,
  sel: { hostId: string | null; workspaceId?: string; workspace?: { id: string; workspaceDirectory?: string; projectRootPath?: string } },
): { hostId: string; workspaceId: string; cwd: string | undefined; label: string } | null {
  if (target) return { hostId: target.hostId, workspaceId: target.workspaceId, cwd: target.cwd, label: target.label };
  if (!sel.hostId || !sel.workspace) return null;
  const cwd = sel.workspace.workspaceDirectory ?? sel.workspace.projectRootPath;
  const label = (cwd ?? sel.workspace.id).split("/").filter(Boolean).pop() ?? sel.workspace.id;
  return { hostId: sel.hostId, workspaceId: sel.workspace.id, cwd, label };
}

export function NewAgentModal({ target }: { target?: AgentTarget }) {
  const t = useTheme();
  const { ui, store, runtimes } = useApp();
  const defaults = useSettings((s) => s.settings.agentDefaults);
  const { width } = useTerminalDimensions();
  const sel = selection({ ui, store });
  const where = agentTarget(target, sel);
  const runtime = where ? runtimes.get(where.hostId) : undefined;

  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [pi, setPi] = useState(0);
  const [models, setModels] = useState<{ id: string; label: string; provider?: string }[] | null>(null);
  const [mi, setMi] = useState(0);
  const [modeIdx, setModeIdx] = useState(0);
  const [field, setField] = useState<Field>("prompt");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<TextareaRenderable>(null);

  useEffect(() => {
    runtime
      ?.providers()
      .then((snap) => {
        const list = usableProviders(snap);
        setProviders(list);
        const preferred = defaults.provider ?? sel.agent?.provider;
        const idx = list.findIndex((p) => p.provider === preferred);
        setPi(idx >= 0 ? idx : 0);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const provider = providers?.[pi];
  useEffect(() => {
    if (!provider || !runtime) return;
    setModels(null);
    runtime
      .listModels(provider.provider)
      .then((r) => {
        const list = normalizeModels(r);
        setModels(list);
        const preferred = provider.provider === (defaults.provider ?? sel.agent?.provider) ? defaults.model ?? sel.agent?.model : undefined;
        const idx = list.findIndex((m) => m.id === preferred);
        setMi(idx >= 0 ? idx : 0);
      })
      .catch(() => setModels([]));
    const modeIdx = provider.modes.findIndex((m) => m.id === (defaults.modeId ?? provider.defaultModeId));
    setModeIdx(modeIdx >= 0 ? modeIdx : 0);
  }, [provider?.provider]);

  const submit = async () => {
    if (!runtime || !provider || !where || busy) return;
    const prompt = promptRef.current?.plainText.trim() ?? "";
    const model = models?.[mi]?.id;
    const mode = provider.modes[modeIdx]?.id;
    setBusy(true);
    setError(null);
    try {
      const handle = await runtime.createAgent({
        workspaceId: where.workspaceId,
        cwd: where.cwd,
        config: { provider: model ? `${provider.provider}/${model}` : provider.provider, ...(mode ? { modeId: mode } : {}) },
        ...(prompt ? { prompt } : {}),
      });
      const key = tabsKey(where.hostId, where.workspaceId);
      ui.actions.updateTabs(key, (s) => openTab(s, handle.id, { after: "active" }));
      ui.actions.setPickerOpen(false);
      ui.actions.closeModal();
      ui.actions.setFocus(prompt ? "main" : "composer");
      ui.actions.toast(`Started ${provider.label} agent`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const cycle = (d: number) => {
    const field = fieldRef.current;
    if (field === "provider" && providers?.length) setPi((i) => (i + d + providers.length) % providers.length);
    if (field === "model" && models?.length) setMi((i) => (i + d + models.length) % models.length);
    if (field === "mode" && provider?.modes.length) setModeIdx((i) => (i + d + provider.modes.length) % provider.modes.length);
  };

  const fieldRef = useRef(field);
  fieldRef.current = field;
  const go = (f: Field) => {
    fieldRef.current = f;
    setField(f);
  };

  useKeyboard((k) => {
    if (busy) return;
    if (k.name === "escape") return ui.actions.closeModal();
    const field = fieldRef.current;
    const fi = FIELDS.indexOf(field);
    if (k.name === "tab") return go(FIELDS[(fi + (k.shift ? FIELDS.length - 1 : 1)) % FIELDS.length]!);
    if (field !== "prompt") {
      if (k.name === "up") return go(FIELDS[Math.max(0, fi - 1)]!);
      if (k.name === "down") return go(FIELDS[fi + 1]!);
      if (k.name === "left" || k.name === "h") return cycle(-1);
      if (k.name === "right" || k.name === "l" || k.name === "space") return cycle(1);
      if (k.name === "return") return void submit();
    } else if (k.name === "up" && (promptRef.current?.logicalCursor.row ?? 0) === 0) {
      return go("mode");
    }
  });

  const inner = Math.min(72, width - 4) - 4;
  const pickRow = (f: Field, label: string, value: string | null, extra?: string) => {
    const on = field === f;
    return (
      <box height={1} flexShrink={0} backgroundColor={on ? t.element : undefined}>
        <text wrapMode="none">
          <span fg={on ? t.accent : t.subtle}>{on ? "▌ " : "  "}</span>
          <span fg={on ? t.text : t.muted}>{label.padEnd(10)}</span>
          {value === null ? (
            <span fg={t.subtle}>{"loading…"}</span>
          ) : (
            <>
              <span fg={on ? t.accent : t.subtle}>{"‹ "}</span>
              <span fg={t.text} attributes={TextAttributes.BOLD}>{truncate(value, inner - 22)}</span>
              <span fg={on ? t.accent : t.subtle}>{" ›"}</span>
              {extra ? <span fg={t.subtle}>{`  ${extra}`}</span> : null}
            </>
          )}
        </text>
      </box>
    );
  };

  return (
    <Overlay title={`New agent · ${truncate(where?.label ?? "", 30)}`} width={72} height={20} footer="tab fields · ←→ change · ⏎ start · esc cancel">
      {!providers && !error ? (
        <Skeleton rows={3} width={inner} />
      ) : (
        <>
          {pickRow("provider", "Provider", provider?.label ?? "none available", providers ? `${pi + 1}/${providers.length}` : undefined)}
          {pickRow("model", "Model", models === null ? null : models[mi] ? modelLabel(models[mi]!) : "default", models?.length ? `${mi + 1}/${models.length}` : undefined)}
          {pickRow("mode", "Mode", provider?.modes[modeIdx]?.label ?? "default")}
          <box height={1} />
          <text fg={field === "prompt" ? t.accent : t.muted} attributes={field === "prompt" ? TextAttributes.BOLD : TextAttributes.NONE}>{"First message (optional)"}</text>
          <box border borderStyle="rounded" borderColor={field === "prompt" ? t.accent : t.border} flexGrow={1} paddingLeft={1} paddingRight={1}>
            <textarea
              ref={promptRef}
              focused={field === "prompt" && !busy}
              placeholder="What should it work on?"
              placeholderColor={t.subtle}
              textColor={t.text}
              focusedTextColor={t.text}
              backgroundColor={t.overlay}
              focusedBackgroundColor={t.overlay}
              cursorColor={t.accent}
              keyBindings={[
                { name: "return", action: "submit" },
                { name: "return", shift: true, action: "newline" },
                { name: "linefeed", action: "newline" },
              ]}
              onSubmit={() => void submit()}
            />
          </box>
        </>
      )}
      <box height={1} flexShrink={0}>
        {busy ? <WorkingLine label="Starting agent…" /> : error ? <text fg={t.error}>{truncate(error, inner)}</text> : <text fg={t.subtle}>{"⏎ starts the agent · ⇧⏎ new line"}</text>}
      </box>
    </Overlay>
  );
}

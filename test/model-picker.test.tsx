import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppContext } from "../src/stores/context";
import { createSessionStore } from "../src/stores/session";
import { createSettingsStore } from "../src/stores/settings";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { createUiStore } from "../src/stores/ui";
import { ModelModal, ThinkingModal, modelLabel, normalizeModels } from "../src/ui/modals/simple";

describe("the model list the pickers show", () => {
  test("keeps the upstream provider next to the label, from metadata or the id", () => {
    // The daemon's listModels payload: one entry per upstream model, each carrying
    // metadata.providerId (opencode passes many providers through one socket).
    const list = normalizeModels({
      provider: "opencode",
      models: [
        { id: "mistral/zai-glm-5-3", label: "GLM-5.3", metadata: { providerId: "mistral" } },
        { id: "zai-coding-plan/glm-5.3", label: "GLM-5.3", metadata: { providerId: "zai-coding-plan" } },
        { id: "openai/gpt-6-sol", label: "GPT-6 Sol", metadata: { providerId: "openai" } },
      ],
    });
    expect(list.map((m) => modelLabel(m))).toEqual([
      "mistral/GLM-5.3",
      "zai-coding-plan/GLM-5.3", // same pretty name, different upstream
      "openai/GPT-6 Sol",
    ]);
    // The id the picker sends back is unchanged.
    expect(list[0]!.id).toBe("mistral/zai-glm-5-3");
  });

  test("falls back to the id prefix, and stays quiet without one", () => {
    expect(modelLabel(normalizeModels([{ id: "openai/gpt-5", label: "GPT-5" }])[0]!)).toBe("openai/GPT-5");
    expect(modelLabel(normalizeModels([{ id: "gpt-5", label: "GPT-5" }])[0]!)).toBe("GPT-5"); // e.g. claude's own list
    expect(normalizeModels([])).toEqual([]);
    expect(normalizeModels({ models: "nope" })).toEqual([]); // tolerate odd payloads
  });

  test("keeps each model's thinking levels", () => {
    const [m] = normalizeModels([{ id: "mistral/glm", label: "GLM", thinkingOptions: [{ id: "low", label: "low" }, { id: "high", label: "high" }] }]);
    expect(m!.thinkingOptions).toEqual([
      { id: "low", label: "low" },
      { id: "high", label: "high" },
    ]);
    expect(normalizeModels([{ id: "x", label: "X", thinkingOptions: [{ label: "no id" }, null] }])[0]!.thinkingOptions).toEqual([]); // junk rows drop out
    expect(normalizeModels([{ id: "y", label: "Y" }])[0]!.thinkingOptions).toBeUndefined(); // absent stays absent
  });

  test("the thinking picker lists the current model's levels and writes back", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
      store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "opencode", model: "mistral/zai-glm-5-3", thinkingOptionId: "high", title: "A" } as never]);
      const ui = createUiStore();
      ui.actions.selectWorkspace("h", "w");
      ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const writes: [string, string | null][] = [];
      const runtimes = {
        get: () => ({
          listModels: async () => [
            { id: "mistral/zai-glm-5-3", label: "GLM-5.3", metadata: { providerId: "mistral" }, thinkingOptions: [{ id: "low", label: "low" }, { id: "high", label: "high" }, { id: "max", label: "max" }] },
          ],
          setThinking: async (agentId: string, optionId: string | null) => { writes.push([agentId, optionId]); return null; },
        }),
      } as never;
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings } as never}>
          <box width={80} height={24}><ThinkingModal /></box>
        </AppContext.Provider>,
        { width: 80, height: 24 },
      );
      try {
        await Bun.sleep(40);
        await t.renderOnce();
        const frame = t.captureCharFrame();
        expect(frame).toContain("mistral/GLM-5.3"); // which model's levels these are
        expect(frame).toContain("Model default");
        expect(frame).toContain("high"); // the current level with its marker
        // The cursor starts on "high" (the agent's current level).
        t.mockInput.pressArrow("up"); // low
        await Bun.sleep(20);
        await t.renderOnce();
        t.mockInput.pressArrow("up"); // Model default
        await Bun.sleep(20);
        await t.renderOnce();
        t.mockInput.pressEnter();
        await Bun.sleep(30);
        await t.renderOnce();
        expect(writes).toEqual([["a", null]]); // the default row resets, not "high"
        expect(ui.getState().modal).toBeNull();
        expect(ui.getState().toasts.at(-1)?.text).toBe("Thinking: Model default");
      } finally {
        t.renderer.destroy();
      }
    } finally {
      console.error = origError;
    }
  });

  test("the change-model picker shows the provider next to every model", async () => {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
    store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "opencode", model: "mistral/zai-glm-5-3", title: "A" } as never]);
    const ui = createUiStore();
    ui.actions.selectWorkspace("h", "w");
    ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    const runtimes = {
      get: () => ({
        listModels: async () => [
          { id: "mistral/zai-glm-5-3", label: "GLM-5.3", metadata: { providerId: "mistral" } },
          { id: "zai-coding-plan/glm-5.3", label: "GLM-5.3", metadata: { providerId: "zai-coding-plan" } },
        ],
        setModel: async () => {},
      }),
    } as never;
    const t = await testRender(
      <AppContext.Provider value={{ store, ui, runtimes, settings } as never}>
        <box width={80} height={24}><ModelModal /></box>
      </AppContext.Provider>,
      { width: 80, height: 24 },
    );
    try {
      await Bun.sleep(40);
      await t.renderOnce();
      const frame = t.captureCharFrame();
      expect(frame).toContain("mistral/GLM-5.3");
      expect(frame).toContain("zai-coding-plan/GLM-5.3");
      expect(frame).toContain("current"); // the active one is still marked
    } finally {
      t.renderer.destroy();
    }
  });
});

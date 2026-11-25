import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppContext } from "../src/stores/context";
import { createSessionStore } from "../src/stores/session";
import { createSettingsStore } from "../src/stores/settings";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { createUiStore } from "../src/stores/ui";
import { AgentsModal } from "../src/ui/modals/simple";
import { COMMANDS } from "../src/keyboard/commands";
import { resolveSlash, visibleSlash } from "../src/ui/agent/slash";
import { openTab, previousTab } from "../src/ui/workspace/tabs-model";

// The composer's /agents runs the same openModal; the modal is what it opens.
describe("the agents picker", () => {
  test("both subagent commands open a picker for direct local children and Enter opens the child tab", async () => {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setServerInfo("h", { serverId: "local" });
    const ui = createUiStore();
    ui.actions.selectWorkspace("h", "w");
    ui.actions.updateTabs("h:w", (tabs) => openTab(tabs, "parent"));
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    const ctx = { ui, store, settings, runtimes: {} as never, quit: () => {} };
    const agent = (id: string, title: string, parentId: string, extra = {}) => ({
      id, title, workspaceId: "w", status: "running", provider: "claude", updatedAt: new Date().toISOString(),
      labels: { "paseo.parent-agent-id": parentId, "paseo.parent-server-id": "local" }, ...extra,
    }) as never;
    store.actions.setAgents("h", [
      agent("parent", "Parent", ""),
      agent("child", "Direct child", "parent"),
      agent("grandchild", "Grandchild", "child"),
      agent("archived", "Archived child", "parent", { archivedAt: new Date().toISOString() }),
      agent("elsewhere", "Other workspace", "parent", { workspaceId: "other" }),
      agent("remote", "Remote parent", "parent", { labels: { "paseo.parent-agent-id": "parent", "paseo.parent-server-id": "remote" } }),
    ]);

    const slash = resolveSlash("/subagents", visibleSlash(ctx));
    expect(slash).not.toBeNull();
    await slash!.run(ctx);
    expect(ui.getState().modal).toEqual({ kind: "subagents" });
    ui.actions.closeModal();
    await COMMANDS.find((c) => c.id === "agent.subagents")!.run(ctx);
    expect(ui.getState().modal).toEqual({ kind: "subagents" });

    const t = await testRender(
      <AppContext.Provider value={ctx}>
        <AgentsModal subagents />
      </AppContext.Provider>,
      { width: 80, height: 24 },
    );
    try {
      await t.renderOnce();
      const frame = t.captureCharFrame();
      expect(frame).toContain("Direct child");
      expect(frame).toContain("running");
      for (const hidden of ["Grandchild", "Archived child", "Other workspace", "Remote parent"]) {
        expect(frame).not.toContain(hidden);
      }
      t.mockInput.pressEnter();
      await t.renderOnce();
      const tabs = ui.getState().tabs["h:w"]!;
      expect(tabs.active).toBe("child");
      expect(previousTab(tabs).active).toBe("parent");
      expect(ui.getState().focus).toBe("main");
    } finally {
      t.renderer.destroy();
    }
  });

  test("lists this workspace's live agents only, marks the current one, and Enter opens the picked one", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      store.actions.setWorkspaces("h", [
        { id: "w", projectId: "p", title: "W", status: "idle" } as never,
        { id: "w2", projectId: "p", title: "W2", status: "idle" } as never,
      ]);
      const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
      store.actions.setAgents("h", [
        { id: "a", status: "running", cwd: "/r", workspaceId: "w", updatedAt: ago(0), provider: "opencode", model: "mistral/GLM-5.3", title: "Current one" } as never,
        { id: "b", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: ago(600), provider: "claude", model: "claude-haiku", title: "Other one" } as never,
        { id: "c", status: "idle", cwd: "/r", workspaceId: "w2", updatedAt: ago(0), provider: "claude", model: "claude-haiku", title: "Elsewhere one" } as never,
        { id: "d", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: ago(0), provider: "claude", model: "claude-haiku", title: "Archived one", archivedAt: ago(10) } as never,
      ]);
      const ui = createUiStore();
      ui.actions.selectWorkspace("h", "w");
      ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes: {} as never, settings } as never}>
          <box width={80} height={24}><AgentsModal /></box>
        </AppContext.Provider>,
        { width: 80, height: 24 },
      );
      try {
        await Bun.sleep(40);
        await t.renderOnce();
        const frame = t.captureCharFrame();
        expect(frame).toContain("Current one"); // the active tab's agent, marked…
        expect(frame).toContain("current");
        expect(frame).toContain("Other one");
        expect(frame).toContain("claude-haiku"); // the detail line
        expect(frame).toContain("10m ago");
        expect(frame).not.toContain("Elsewhere one"); // another workspace's agent
        expect(frame).not.toContain("Archived one"); // archived agents don't come back

        // The cursor starts on the current agent; picking the other opens it as a tab.
        t.mockInput.pressArrow("down");
        await Bun.sleep(20);
        await t.renderOnce();
        t.mockInput.pressEnter();
        await Bun.sleep(30);
        await t.renderOnce();
        expect(ui.getState().modal).toBeNull();
        const tabs = ui.getState().tabs["h:w"]!;
        expect(tabs.tabs).toEqual(["a", "b"]); // opened next to the current tab
        expect(tabs.active).toBe("b");
      } finally {
        t.renderer.destroy();
      }
    } finally {
      console.error = origError;
    }
  });

  test("a workspace with no live agents says so instead of an empty list", async () => {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
    const ui = createUiStore();
    ui.actions.selectWorkspace("h", "w");
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    const t = await testRender(
      <AppContext.Provider value={{ store, ui, runtimes: {} as never, settings } as never}>
        <box width={80} height={24}><AgentsModal /></box>
      </AppContext.Provider>,
      { width: 80, height: 24 },
    );
    try {
      await Bun.sleep(40);
      await t.renderOnce();
      expect(t.captureCharFrame()).toContain("No agents in this workspace yet");
    } finally {
      t.renderer.destroy();
    }
  });
});

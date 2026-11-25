import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppContext } from "../src/stores/context";
import { createSessionStore } from "../src/stores/session";
import { createSettingsStore } from "../src/stores/settings";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { createUiStore } from "../src/stores/ui";
import { AgentsModal } from "../src/ui/modals/simple";

// The composer's /agents runs the same openModal; the modal is what it opens.
describe("the agents picker", () => {
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

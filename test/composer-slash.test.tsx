import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppContext } from "../src/stores/context";
import { createSessionStore } from "../src/stores/session";
import { createSettingsStore } from "../src/stores/settings";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { createUiStore } from "../src/stores/ui";
import { Composer } from "../src/ui/agent/Composer";

/** A composer on a focused agent tab, with a draft already typed. */
async function composerWith(draft: string) {
  const store = createSessionStore();
  store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
  store.actions.setActiveHost("h");
  store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
  store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "claude-haiku", title: "A" } as never]);
  const ui = createUiStore();
  ui.actions.selectWorkspace("h", "w");
  ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
  ui.actions.setDraft("h:a", draft);
  ui.actions.setFocus("composer");
  const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
  const runtimes = { get: () => ({ fork: async () => "b" }) } as never;
  const t = await testRender(
    <AppContext.Provider value={{ store, ui, runtimes, settings } as never}>
      <box width={80} height={24}><Composer hostId="h" agentId="a" width={70} /></box>
    </AppContext.Provider>,
    { width: 80, height: 24 },
  );
  await Bun.sleep(40);
  await t.renderOnce();
  return { t, ui };
}

describe("the composer's / menu", () => {
  test("is alphabetical, ↓ highlights rows, and Enter runs the highlighted one", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, ui } = await composerWith("/");
      try {
        let frame = t.captureCharFrame();
        const at = ["/agents", "/fork", "/model"].map((n) => frame.indexOf(n));
        expect(at.every((i) => i >= 0)).toBe(true); // all listed under a bare /
        expect(at[0]! < at[1]! && at[1]! < at[2]!).toBe(true); // in alphabetical order

        t.mockInput.pressArrow("down");
        await Bun.sleep(20);
        await t.renderOnce();
        expect(t.captureCharFrame()).toContain("▌/agents"); // the first row highlights

        t.mockInput.pressEnter();
        await Bun.sleep(30);
        await t.renderOnce();
        // Enter ran the highlighted command, not an exact-name lookup.
        expect(ui.getState().modal).toMatchObject({ kind: "agents" });
        expect(ui.getState().drafts["h:a"] ?? "").toBe(""); // the draft went with it
      } finally {
        t.renderer.destroy();
      }
    } finally {
      console.error = origError;
    }
  });

  test("↑ from nothing starts at the bottom, the window scrolls, and typing resets the pick", async () => {
    const { t, ui } = await composerWith("");
    try {
      await t.mockInput.typeText("/");
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressArrow("up");
      await Bun.sleep(20);
      await t.renderOnce();
      const frame = t.captureCharFrame();
      expect(frame).toContain("▌/thinking"); // the last name alphabetically
      expect(frame).not.toContain("/agents"); // the window scrolled past the top

      await t.mockInput.typeText("fork");
      await Bun.sleep(20);
      await t.renderOnce();
      expect(t.captureCharFrame()).not.toContain("▌"); // no highlight after typing
      t.mockInput.pressEnter();
      await Bun.sleep(30);
      await t.renderOnce();
      // Enter fell back to the typed name: /fork forked, no stale-menu run.
      expect(ui.getState().tabs["h:w"]!.tabs).toEqual(["a", "b"]);
      expect(ui.getState().toasts.at(-1)).toMatchObject({ text: "Forked into a new tab", kind: "success" });
    } finally {
      t.renderer.destroy();
    }
  });
});

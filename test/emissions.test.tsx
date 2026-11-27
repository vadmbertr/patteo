// SPDX-License-Identifier: Apache-2.0
// Added by Paseo Box: cover emissions table formatting and modal dispatch.
import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { AppRoot, createAppState } from "../src/app-root";
import { resolveCommands } from "../src/keyboard/commands";
import { matchKey } from "../src/keyboard/keys";
import { formatEmissionsReport, parseEmissionsReport } from "../src/ui/modals/emissions-report";
import fixture from "./fixtures/emissions.json";

test("formats ordered models, right-aligned ranges, dim energy and coverage", () => {
  const table = formatEmissionsReport(parseEmissionsReport(JSON.stringify(fixture.populated)), 88);
  const cells = (...values: string[]) => values.map((value) => value.padStart(16)).join("");
  expect(table).toMatchObject({
    title: fixture.populated.label,
    generated: "Generated 2026-11-27 14:32:07 UTC · gCO2e",
    header: "Model".padEnd(40) + cells("last 24 hours", "last 7 days", "last 30 days"),
    empty: false,
    fits: true,
    coverage: "Turns (est./obs.)".padEnd(40) + cells("1/2", "3/4", "4/6"),
    total: {
      co2e: "Total".padEnd(40) + cells("1.2–1.4 g", "3–3.4 g", "4.2–4.8 g"),
      dim: " ".repeat(40) + cells("12–14 mWh", "34–38 mWh", "46–52 mWh"),
    },
  });
  expect(table.rows[0]).toEqual({
    co2e: "zeta/large".padEnd(40) + cells("1.2–1.4 g", "2.4–2.8 g", "3.6–4.2 g"),
    dim: " ".repeat(40) + cells("12–14 mWh", "24–28 mWh", "36–42 mWh"),
  });
  expect(table.rows[1]?.co2e).toStartWith("alpha/超-long-");
  expect(table.rows[1]?.co2e).toEndWith("…" + cells("0", "0.6 g", "0.6 g"));
  expect(table.rows[1]?.dim).toBe(" ".repeat(40) + cells("0", "10 mWh", "10 mWh"));
  for (const line of [table.header, table.coverage, ...table.rows.flatMap((r) => [r.co2e, r.dim])]) {
    expect(Bun.stringWidth(line)).toBe(88);
  }
});

test("scales energy to human units and clamps positive values below 1 mWh", () => {
  const report = parseEmissionsReport(JSON.stringify(fixture.populated));
  report.total.day.energyKWh = { min: 0.0000002, max: 0.0000008 };
  report.total.week.energyKWh = { min: 0.0419, max: 0.0442 };
  report.total.month.energyKWh = { min: 0.42, max: 0.42 };
  const { total } = formatEmissionsReport(report, 88);
  expect(total.dim.trim().split(/ {2,}/)).toEqual(["<1 mWh", "42–44 Wh", "0.42 kWh"]);
});

test("formats zero records and rejects invalid reports", () => {
  const table = formatEmissionsReport(parseEmissionsReport(JSON.stringify(fixture.empty)), 88);
  expect(table.empty).toBe(true);
  expect(table.rows).toEqual([]);
  expect(table.total.co2e).toBe("Total".padEnd(40) + "0".padStart(16).repeat(3));
  expect(table.total.dim).toBe(" ".repeat(40) + "0".padStart(16).repeat(3));
  expect(table.coverage).toBe("Turns (est./obs.)".padEnd(40) + "0/0".padStart(16).repeat(3));
  expect(() => parseEmissionsReport('{"byModel":[]}')).toThrow("Invalid emissions report");
  expect(() => parseEmissionsReport(JSON.stringify({ ...fixture.empty, total: {} }))).toThrow("Invalid emissions report");
});

test("Shift+E opens the emissions report, r refreshes and Escape closes", async () => {
  const key = { name: "e", shift: true, ctrl: false, meta: false };
  expect(resolveCommands({}).filter((c) => c.keys.some((spec) => matchKey(key, spec))))
    .toMatchObject([{ id: "emissions.open", keys: ["E"] }]);
  expect(resolveCommands({ "emissions.open": ["alt+e"] }).find((c) => c.id === "emissions.open")?.keys).toEqual(["alt+e"]);
  const state = createAppState();
  const t = await testRender(<AppRoot state={state} />, { width: 100, height: 24 });
  const dir = await mkdtemp(join(tmpdir(), "patteo-emissions-"));
  const script = join(dir, "report with spaces.mjs");
  const previous = process.env.PC_EMISSIONS_REPORT;
  const writeReport = (report: unknown, delay = 0) => Bun.write(script,
    `setTimeout(() => console.log(${JSON.stringify(JSON.stringify(report))}), ${delay});`);
  const waitFor = async (text: string) => {
    for (let i = 0; i < 50; i++) {
      await t.renderOnce();
      if (t.captureCharFrame().includes(text)) break;
      await act(async () => { await Bun.sleep(20); });
    }
    expect(t.captureCharFrame()).toContain(text);
  };
  try {
    process.env.PC_EMISSIONS_REPORT = script;
    await writeReport({
      ...fixture.populated,
      byModel: [
        ...fixture.populated.byModel,
        ...Array.from({ length: 8 }, (_, i) => ({ ...fixture.populated.byModel[0]!, modelID: `extra-${i}` })),
      ],
    });
    await t.renderOnce();
    t.mockInput.pressKey("e");
    expect(state.ui.getState().modal).toBeNull();
    await act(async () => { t.mockInput.pressKey("e", { shift: true }); });
    expect(state.ui.getState().modal).toEqual({ kind: "emissions" });
    await waitFor("zeta/large");
    expect(t.captureCharFrame()).toContain("12–14 mWh");
    expect(t.captureCharFrame()).toContain("Turns (est./obs.)");
    const checkFrame = (...lines: string[]) => {
      const frame = t.captureCharFrame();
      for (const line of lines) expect(frame).toContain(line);
      return frame;
    };
    const fullRefs = ["full wired phone charge at wall ~20 Wh", "100 km ~24 kg CO2 tailpipe/car",
      "one-way economy ~400 kg CO2e/person (excl. contrails/non-CO2)"];
    checkFrame(...fullRefs, "↑↓ scroll", "46–52 mWh");
    expect(t.captureCharFrame()).not.toContain("zeta/extra-7");
    for (let i = 0; i < 9; i++) await act(async () => { t.mockInput.pressArrow("down"); });
    await t.renderOnce();
    const lastRow = checkFrame(...fullRefs, "zeta/extra-7", "46–52 mWh", "esc close")
      .split("\n").findIndex((line) => line.includes("zeta/extra-7"));
    expect(t.captureCharFrame().split("\n")[lastRow + 1]).toContain("36–42 mWh");

    await act(async () => { t.resize(48, 10); });
    await t.renderOnce();
    const narrow = checkFrame("Total 24h: 1.2–1.4 gCO2e / 12–14 mWh", "Total 7d: 3–3.4 gCO2e / 34–38 mWh",
      "Total 30d: 4.2–4.8 gCO2e / 46–52 mWh", "~20 Wh", "~24 kg CO2 tailpipe", "~400 kg CO2e/person", "esc close");
    expect(narrow).not.toContain("zeta/extra");
    await act(async () => { t.resize(56, 9); });
    await t.renderOnce();
    checkFrame("Total 24h:", "Total 7d:", "Total 30d:", "Scale refs: phone ~20 Wh", "~24 kg CO2", "~400 kg CO2e/person", "esc close");
    await act(async () => { t.resize(100, 8); });
    await t.renderOnce();
    checkFrame("last 24 hours", "last 7 days", "last 30 days", "46–52 mWh", "Scale refs: phone ~20 Wh",
      "~24 kg CO2", "~400 kg CO2e/person", "esc close");
    await act(async () => { t.resize(100, 24); });
    await waitFor("zeta/extra-7");
    checkFrame(...fullRefs, "46–52 mWh");

    await writeReport(fixture.empty, 300);
    await act(async () => { t.mockInput.pressKey("r"); });
    await t.renderOnce();
    expect(checkFrame(...fullRefs, "Loading emissions report…")).not.toContain("Total");
    await waitFor("No estimated turns in the last 30 days.");
    const empty = checkFrame(...fullRefs, "Total", "0/0");
    expect(empty).not.toContain("zeta/extra-7");
    expect(empty.split("\n").find((line) => line.includes("Total"))?.match(/\b0\b/g)).toHaveLength(3);
    await Bun.write(script, 'console.error("private fixture detail"); process.exitCode = 1;');
    await act(async () => { t.mockInput.pressKey("r"); });
    await waitFor("Emissions report unavailable");
    const error = checkFrame(...fullRefs);
    expect(error).not.toContain("private fixture detail");
    expect(error).not.toContain("Total");
    await act(async () => {
      t.mockInput.pressEscape();
      await Bun.sleep(25);
    });
    expect(state.ui.getState().modal).toBeNull();
  } finally {
    await act(async () => { t.renderer.destroy(); });
    if (previous === undefined) delete process.env.PC_EMISSIONS_REPORT;
    else process.env.PC_EMISSIONS_REPORT = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

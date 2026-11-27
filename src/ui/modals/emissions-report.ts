// SPDX-License-Identifier: Apache-2.0
// Added by Paseo Box: validate and format EcoLogits reports for the overlay.
import { truncate } from "../text";

const windows = ["day", "week", "month"] as const;
type WindowId = (typeof windows)[number];
type Bounds = { min: number; max: number };
type Estimate = { estimatedTurns: number; co2eGrams: Bounds; energyKWh: Bounds };
type Coverage = Estimate & { unsupportedTurns: number; observedTurns: number };
type Model = Record<WindowId, Estimate> & { providerID: string; modelID: string };
type Report = {
  label: string;
  units: { co2e: "gCO2e"; energy: "kWh" };
  generatedAt: string;
  windows: { id: WindowId; label: string; since: string }[];
  byModel: Model[];
  total: Record<WindowId, Coverage>;
  untimeableRecords: number;
  limitations: string[];
};

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && /^[^\x00-\x1f\x7f-\x9f]+$/.test(v);
const date = (v: unknown) => text(v) && v.endsWith("Z") && Number.isFinite(Date.parse(v));
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const bounds = (v: unknown) => object(v) && amount(v.min) && amount(v.max) && v.min <= v.max;
const estimate = (v: unknown) => object(v) && count(v.estimatedTurns) && bounds(v.co2eGrams) && bounds(v.energyKWh);
const coverage = (v: unknown) => object(v) && estimate(v) && count(v.unsupportedTurns) && count(v.observedTurns);
const model = (v: unknown) => object(v) && text(v.providerID) && text(v.modelID) && windows.every((id) => estimate(v[id]));

function isReport(v: unknown): v is Report {
  if (!object(v) || !text(v.label) || !date(v.generatedAt) || !count(v.untimeableRecords)) return false;
  const { units, windows: defs, byModel, total, limitations } = v;
  return object(units) && units.co2e === "gCO2e" && units.energy === "kWh"
    && Array.isArray(defs) && defs.length === windows.length && windows.every((id, i) => {
      const w: unknown = defs[i];
      return object(w) && w.id === id && text(w.label) && date(w.since);
    })
    && Array.isArray(byModel) && byModel.every(model)
    && object(total) && windows.every((id) => coverage(total[id]))
    && Array.isArray(limitations) && limitations.every((item) => typeof item === "string");
}

export function parseEmissionsReport(json: string): Report {
  const report: unknown = JSON.parse(json);
  if (!isReport(report)) throw new Error("Invalid emissions report");
  return report;
}

function compact(n: number) {
  const rounded = Number(n.toPrecision(3));
  if (n === 0 || (rounded >= 0.001 && rounded < 100000)) return String(rounded);
  const [mantissa, exponent] = n.toExponential(2).split("e");
  return `${Number(mantissa)}e${Number(exponent)}`;
}

function range(v: Bounds, unit: string) {
  if (v.max === 0) return "0";
  const min = compact(v.min);
  const max = compact(v.max);
  return `${v.min === v.max ? max : `${min}–${max}`} ${unit}`;
}

const energyDigits = new Intl.NumberFormat("en", { maximumSignificantDigits: 2, useGrouping: false });

function energyBound(kwh: number): [string, string] {
  if (kwh === 0) return ["0", ""];
  if (kwh < 0.000001) return ["<1", "mWh"];
  if (kwh < 0.001) {
    const mwh = energyDigits.format(kwh * 1_000_000);
    return mwh === "1000" ? ["1", "Wh"] : [mwh, "mWh"];
  }
  if (kwh < 0.1) return [energyDigits.format(kwh * 1000), "Wh"];
  return [energyDigits.format(kwh), "kWh"];
}

function energyRange(v: Bounds) {
  const [min, minUnit] = energyBound(v.min);
  const [max, maxUnit] = energyBound(v.max);
  if (!maxUnit) return "0";
  if (v.min === v.max || (min === "<1" && max === "<1")) return `${max} ${maxUnit}`;
  const prefix = minUnit && minUnit !== maxUnit ? `${min} ${minUnit}` : min;
  return `${prefix}–${max} ${maxUnit}`;
}

function fit(s: string, width: number) {
  let chars = width;
  let value = truncate(s, chars);
  while (Bun.stringWidth(value) > width) value = truncate(s, --chars);
  return value;
}

export function formatEmissionsReport(report: Report, width: number) {
  const metrics = (entry: Record<WindowId, Estimate>) => ({
    co2e: windows.map((id) => range(entry[id].co2eGrams, "g")),
    energy: windows.map((id) => energyRange(entry[id].energyKWh)),
  });
  const models = report.byModel.map((model) => ({ name: `${model.providerID}/${model.modelID}`, ...metrics(model) }));
  const totals = metrics(report.total);
  const labels = report.windows.map((w) => w.label);
  const counts = windows.map((id) => {
    const { estimatedTurns, observedTurns } = report.total[id];
    return `${estimatedTurns}/${observedTurns}`;
  });
  const column = [labels, counts, totals.co2e, totals.energy, ...models.flatMap((row) => [row.co2e, row.energy])]
    .reduce((max, cells) => Math.max(max, ...cells.map((s) => Bun.stringWidth(s) + 1)), 16);
  const left = Math.max(0, width - column * windows.length);
  const line = (name: string, cells: string[]) => {
    const label = fit(name, left);
    return label + " ".repeat(left - Bun.stringWidth(label))
      + cells.map((s) => " ".repeat(column - Bun.stringWidth(s)) + s).join("");
  };
  const row = (name: string, values: typeof totals) => ({
    co2e: line(name, values.co2e),
    dim: line("", values.energy),
  });
  return {
    title: report.label,
    generated: `Generated ${new Date(report.generatedAt).toISOString().slice(0, 19).replace("T", " ")} UTC · ${report.units.co2e}`,
    header: line("Model", labels),
    rows: models.map((model) => row(model.name, model)),
    total: row("Total", totals),
    totalHeader: line("", labels),
    compactTotals: ["24h", "7d", "30d"].map((label, i) => {
      const co2e = totals.co2e[i] === "0" ? "0 g" : totals.co2e[i];
      const energy = totals.energy[i] === "0" ? "0 Wh" : totals.energy[i];
      const line = `${label}: ${co2e}CO2e / ${energy}`;
      if (Bun.stringWidth(`Total ${line}`) <= width) return `Total ${line}`;
      return Bun.stringWidth(line) <= width ? line : `${label} ${co2e} / ${energy}`;
    }),
    coverage: line("Turns (est./obs.)", counts),
    empty: report.total.month.estimatedTurns === 0,
    fits: left >= 17,
  };
}

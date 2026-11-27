// SPDX-License-Identifier: Apache-2.0
// Added by Paseo Box: display the live EcoLogits report.
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { useEffect, useMemo, useState } from "react";
import { matchKey } from "../../keyboard/keys";
import { useApp } from "../../stores/context";
import { useTheme } from "../../theme/theme";
import { truncate } from "../text";
import { formatEmissionsReport, parseEmissionsReport } from "./emissions-report";
import { Overlay, overlayInner } from "./Overlay";

const run = promisify(execFile);
const modalWidth = 96;
const reportLabel = "Estimated LLM emissions (EcoLogits; not measured)";

const references = [
  ["Scale: full wired phone charge at wall ~20 Wh", "Ref: full wired phone at wall ~20 Wh", "Ref: phone ~20 Wh"],
  ["Scale: gasoline car 100 km ~24 kg CO2 tailpipe/car", "Ref: gas car 100km ~24 kg CO2 tailpipe", "Ref: car/100km ~24kg CO2"],
  ["Scale: Paris–NY one-way economy ~400 kg CO2e/person (excl. contrails/non-CO2)",
    "Ref: Paris–NY 1-way ~400 kg CO2e/person", "Ref Paris–NY ~400kg CO2e"],
];

export function EmissionsModal() {
  const { ui } = useApp();
  const t = useTheme();
  const { width, height } = useTerminalDimensions();
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<ReturnType<typeof parseEmissionsReport> | null>();
  const [scroll, setScroll] = useState(0);
  const inner = Math.max(0, overlayInner(modalWidth, width));
  const modalHeight = Math.min(20, height - 2);
  const body = Math.max(0, modalHeight - 2); // Title and key hints live in the border.
  const table = useMemo(() => report && formatEmissionsReport(report, inner), [report, inner]);
  const fits = (line: string) => Bun.stringWidth(line) <= inner;
  const fit = (line: string) => truncate(line, inner);
  const combined = "Scale refs: phone ~20 Wh · car/100 km ~24 kg CO2 · Paris–NY ~400 kg CO2e/person";
  const pair = "Scale refs: phone ~20 Wh · car/100 km ~24 kg CO2";
  const refs = references.map((options) => options.find(fits) ?? fit(options[options.length - 1]!));
  // shortcut: below the row/column budget for all refs and totals, show what fits; revisit if Overlay can scroll fixed content.
  const legend = (body < 6 && fits(combined) ? [combined]
    : body < 6 && fits(pair) ? [pair, refs[2]!] : refs).slice(0, body);
  const available = body - legend.length;
  const grid = !!table?.fits && available >= 3;
  const hasModels = !!table && !table.empty && table.rows.length > 0;
  const modelSpace = grid && hasModels ? available - 3 : 0;
  const reserved = Math.min(2, Math.max(0, modelSpace - 2));
  const page = Math.floor((modelSpace - reserved) / 2);
  const last = Math.max(0, (table?.rows.length ?? 0) - page);
  const start = Math.min(scroll, last);
  const rows = page > 0 ? table?.rows.slice(start, start + page) ?? [] : [];
  const extras = Math.max(0, available - (table ? 3 : 0) - rows.length * 2);
  const status = table?.empty ? "No estimated turns in the last 30 days."
    : table ? !table.fits ? "Widen the terminal to see models." : !rows.length && hasModels ? "Increase terminal height to see models." : ""
    : report === null ? "Emissions report unavailable" : "Loading emissions report…";
  const showStatus = !!status && extras > 0;
  const metadata = extras - Number(showStatus);
  const note = "Proxy estimates, not measurements — see ecologits/README.md";
  const keys = page > 0 && last > 0 ? "↑↓ scroll · r refresh · esc close" : "r refresh · esc close";
  const title = !table && !showStatus ? status : table?.title ?? reportLabel;

  useEffect(() => {
    const controller = new AbortController();
    const script = process.env.PC_EMISSIONS_REPORT || "/opt/paseo-box-ecologits/report.mjs";
    void (async () => {
      try {
        const { stdout } = await run("node", ["--", script], { timeout: 10_000, signal: controller.signal });
        if (!controller.signal.aborted) setReport(parseEmissionsReport(stdout));
      } catch {
        if (!controller.signal.aborted) setReport(null);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  useKeyboard((k) => {
    if (k.name === "escape") return ui.actions.closeModal();
    if (matchKey(k, "r")) {
      setReport(undefined);
      setScroll(0);
      setRevision((n) => n + 1);
    }
    if (page > 0 && k.name === "up") setScroll(Math.max(0, start - 1));
    if (page > 0 && k.name === "down") setScroll(Math.min(last, start + 1));
  });

  return (
    <Overlay title={fits(title) ? title : fit(!table && !showStatus ? title : "Emissions estimates")} width={modalWidth} height={modalHeight}
      footer={fits(keys) ? keys : page > 0 && last > 0 ? "↑↓ r Esc" : "r Esc"}>
      {table ? (
        <>
          {metadata >= 3 && fits(table.generated) ? <text fg={t.muted} wrapMode="none">{table.generated}</text> : null}
          {grid ? (
            <>
              <text fg={t.accent} wrapMode="none">{rows.length ? table.header : table.totalHeader}</text>
              {rows.map((row, i) => (
                <box key={start + i} flexDirection="column" flexShrink={0}>
                  <text fg={t.text} wrapMode="none">{row.co2e}</text>
                  <text fg={t.muted} wrapMode="none">{row.dim}</text>
                </box>
              ))}
              {rows.length > 0 && metadata >= 4 ? <box height={1} flexShrink={0} /> : null}
              <text fg={t.text} wrapMode="none">{table.total.co2e}</text>
              <text fg={t.muted} wrapMode="none">{table.total.dim}</text>
              {metadata >= 1 ? <text fg={t.muted} wrapMode="none">{table.coverage}</text> : null}
            </>
          ) : table.compactTotals.slice(0, available).map((line, i) => (
            <text key={i} fg={t.text} wrapMode="none">{fit(line)}</text>
          ))}
        </>
      ) : null}
      {showStatus ? <text fg={report === null ? t.error : t.muted} wrapMode="none">{fit(status)}</text> : null}
      <box flexGrow={1} />
      {legend.map((line, i) => <text key={i} fg={t.muted} wrapMode="none">{line}</text>)}
      {metadata >= 2 && fits(note) ? <text fg={t.muted} wrapMode="none">{note}</text> : null}
    </Overlay>
  );
}

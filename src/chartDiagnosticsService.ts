import * as vscode from "vscode";
import type { ChartFileType } from "@lxns-network/maimai-chart-engine";
import { collectChartProblems } from "./parser/chartDiagnostics";

const DIAGNOSTIC_SOURCE = "maimai Chart Preview";
const DEBOUNCE_MS = 300;

/** Resolves the chart format from the language id or file extension; content sniffing is left to the caller. */
export function chartFormatOf(doc: vscode.TextDocument): ChartFileType | null {
  const filename = doc.fileName.toLowerCase();
  if (doc.languageId === "ma2" || filename.endsWith(".ma2")) return "ma2";
  if (doc.languageId === "simai" || filename.endsWith(".simai") || filename.endsWith(".maidata")) return "simai";
  return null;
}

function toDiagnostic(doc: vscode.TextDocument, problem: ReturnType<typeof collectChartProblems>[number]) {
  let range = new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0);
  if (problem.line !== undefined) {
    const line = Math.min(problem.line, Math.max(0, doc.lineCount - 1));
    const column = problem.column ?? 0;
    const length = problem.length ?? 1;
    range = doc.validateRange(new vscode.Range(line, column, line, column + length));
  }
  const message = problem.difficulty !== undefined ? `谱面 ${problem.difficulty}：${problem.message}` : problem.message;
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  return diagnostic;
}

/**
 * Validates chart documents while they are edited, so the Problems panel reports
 * syntax errors even when no preview panel is open.
 */
export function registerChartDiagnostics(context: vscode.ExtensionContext, collection: vscode.DiagnosticCollection) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const validate = (doc: vscode.TextDocument, format: ChartFileType) => {
    if (doc.isClosed) {
      collection.delete(doc.uri);
      return;
    }
    collection.set(doc.uri, collectChartProblems(doc.getText(), format).map((problem) => toDiagnostic(doc, problem)));
  };

  const schedule = (doc: vscode.TextDocument) => {
    const format = chartFormatOf(doc);
    if (!format) {
      collection.delete(doc.uri);
      return;
    }
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      try {
        validate(doc, format);
      } catch (error) {
        // Validation must never break editing; the preview surfaces its own error.
        console.warn("maimai Chart Preview: chart validation failed", error);
      }
    }, DEBOUNCE_MS));
  };

  const revalidate = (doc: vscode.TextDocument) => {
    clearTimeout(timers.get(doc.uri.toString()));
    timers.delete(doc.uri.toString());
    schedule(doc);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(({ document }) => schedule(document)),
    vscode.workspace.onDidSaveTextDocument(schedule),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
    { dispose() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); } },
  );

  for (const doc of vscode.workspace.textDocuments) schedule(doc);

  // Language auto-detection switches a document between simai/ma2/plaintext after it
  // was opened, so the caller revalidates once the new language is in effect.
  return { revalidate };
}

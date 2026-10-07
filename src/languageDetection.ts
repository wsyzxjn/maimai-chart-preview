import * as vscode from "vscode";
import { detectChartFormat } from "./parser/chartFormat";

/** Only opened plaintext .txt documents are inspected; explicit language choices remain authoritative. */
export function registerChartLanguageDetection(context: vscode.ExtensionContext) {
  const languages = new Map<string, string>();
  const manualChoices = new Set<string>();
  const changing = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const detect = async (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    if (disposed || doc.isClosed || doc.languageId !== "plaintext" || !doc.fileName.toLowerCase().endsWith(".txt")) return;
    if (manualChoices.has(key) || changing.has(key) || !vscode.workspace.getConfiguration("maimai.preview", doc.uri).get("autoDetectCharts", true)) return;
    const associations = vscode.workspace.getConfiguration("files", doc.uri).get<Record<string, string>>("associations", {});
    if (Object.keys(associations).some((pattern) => vscode.languages.match({ pattern }, doc) > 0)) return;
    const text = doc.getText(new vscode.Range(new vscode.Position(0, 0), doc.positionAt(65536)));
    const format = detectChartFormat(text);
    if (!format) return;
    changing.add(key);
    try {
      await vscode.languages.setTextDocumentLanguage(doc, format);
      languages.set(key, format);
    } catch (error) {
      console.warn("maimai Chart Preview: could not set chart language", error);
    } finally {
      changing.delete(key);
    }
  };

  const opened = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    const previous = languages.get(key);
    if (previous !== undefined && previous !== doc.languageId && !changing.has(key)) manualChoices.add(key);
    languages.set(key, doc.languageId);
    void detect(doc);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(opened),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      clearTimeout(timers.get(key));
      timers.delete(key);
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      const key = document.uri.toString();
      if (document.languageId !== "plaintext" || !document.fileName.toLowerCase().endsWith(".txt") || manualChoices.has(key)) return;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        void detect(document);
      }, 200));
    }),
    { dispose() { disposed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); } },
  );
  for (const doc of vscode.workspace.textDocuments) opened(doc);
}

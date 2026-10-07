import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  console.log("🔨 Building Extension Host (extension.ts)...");
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src/extension.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(__dirname, "dist/extension.js"),
    external: ["vscode"],
    sourcemap: true,
  });

  console.log("🔨 Building Webview App (webviewApp.ts)...");
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src/webview/webviewApp.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(__dirname, "dist/webviewApp.js"),
    sourcemap: true,
  });

  console.log("✅ Build finished successfully!");
}

build().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});

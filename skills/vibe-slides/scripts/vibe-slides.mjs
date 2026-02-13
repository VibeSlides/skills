#!/usr/bin/env node
/**
 * Vibe Slides API — create presentation decks and export to PDF/PPTX.
 *
 * Usage:
 *   node vibe-slides.mjs "prompt text" [options]
 *   echo "prompt" | node vibe-slides.mjs --stdin [options]
 *
 * Options:
 *   --name <name>       Deck name (optional)
 *   --format <fmt>      Export format: pdf (default) or pptx
 *   --upscale           Upscale slide renders before export
 *   --out <dir>         Output directory (default: cwd)
 *   --filename <name>   Output filename without extension (default: deck-<id>)
 *   --no-export         Skip export, just create the deck
 *   --stdin             Read prompt from stdin
 *   --poll-deck <s>     Deck poll interval in seconds (default: 5)
 *   --poll-export <s>   Export poll interval in seconds (default: 1)
 *   --timeout <s>       Max total wait in seconds (default: 600)
 *
 * Environment:
 *   VIBE_API_KEY (required) — API key from https://vibeslides.app/api-keys
 *   VIBE_API_URL (optional) — API base URL (default: https://api.vibeslides.app)
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  args.splice(i, 1);
  return true;
};
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const useStdin = flag("--stdin");
const noExport = flag("--no-export");
const upscale = flag("--upscale") || false;
const deckName = opt("--name");
const format = opt("--format", "pdf");
const outDir = opt("--out", ".");
const filename = opt("--filename");
const pollDeck = Number(opt("--poll-deck", "5"));
const pollExport = Number(opt("--poll-export", "1"));
const timeout = Number(opt("--timeout", "600"));

const API_KEY = process.env.VIBE_API_KEY;
const API_BASE = (process.env.VIBE_API_URL || "https://api.vibeslides.app").replace(/\/$/, "");

if (!API_KEY) {
  console.error("Error: VIBE_API_KEY environment variable is required.");
  console.error("Get your API key from https://vibeslides.app/api-keys");
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${ts}] ${msg}\n`);
}

function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${endpoint}`);
    const mod = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = mod.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, data: text }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (e) => { file.close(); reject(e); });
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

// ── API Operations ──────────────────────────────────────────────────────────

async function createDeck(prompt, name) {
  log(`Creating deck...`);
  const payload = { prompt };
  if (name) payload.name = name;
  const res = await request("POST", "/v1/decks", payload);
  if (res.status !== 200) {
    log(`Error creating deck: ${res.status} — ${JSON.stringify(res.data)}`);
    process.exit(1);
  }
  const deck = res.data;
  log(`Deck created: id=${deck.id}, name="${deck.name}", status=${deck.status}`);
  return deck;
}

async function pollDeckStatus(deckId) {
  log("Waiting for deck generation...");
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const res = await request("GET", `/v1/decks/${deckId}`);
    if (res.status !== 200) {
      log(`Error polling deck: ${res.status}`);
      process.exit(1);
    }
    const deck = res.data;
    const { status, slides_count = 0, slides_complete = 0 } = deck;

    if (status === "error") {
      log(`Deck generation failed: ${deck.error || "unknown"}`);
      process.exit(1);
    }
    if (status === "complete" && slides_count > 0 && slides_complete >= slides_count) {
      log(`Deck complete: ${slides_count} slides`);
      return deck;
    }

    const wait = Number(res.headers["retry-after"] || pollDeck);
    if (status === "complete") {
      log(`  Generation done, rendering: ${slides_complete}/${slides_count}`);
    } else {
      log(`  Status: ${status}, slides: ${slides_complete}/${slides_count}, retry in ${wait}s`);
    }
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  log("Timeout waiting for deck generation");
  process.exit(1);
}

async function startExport(deckId, fmt, up) {
  log(`Starting ${fmt.toUpperCase()} export...`);
  const res = await request("POST", `/v1/decks/${deckId}/export`, { format: fmt, upscale: !!up });
  if (res.status !== 200) {
    log(`Error starting export: ${res.status} — ${JSON.stringify(res.data)}`);
    process.exit(1);
  }
  log(`Export started: id=${res.data.export_id}`);
  return res.data;
}

async function pollExportStatus(deckId, exportId) {
  log("Waiting for export...");
  const deadline = Date.now() + timeout * 1000;
  let interval = pollExport;
  while (Date.now() < deadline) {
    const res = await request("GET", `/v1/decks/${deckId}/export?export_id=${exportId}`);
    if (res.status !== 200) {
      log(`  Export poll error: ${res.status}, retrying...`);
      await new Promise((r) => setTimeout(r, interval * 1000));
      continue;
    }
    const exp = res.data;
    if (exp.status === "complete" || exp.download_url) {
      log("Export complete!");
      return exp;
    }
    if (exp.status === "error") {
      log(`Export failed: ${exp.error || "unknown"}`);
      process.exit(1);
    }
    const progress = exp.progress || 0;
    log(`  Export progress: ${progress}%`);
    // Poll faster when near completion
    interval = progress >= 50 ? Math.max(0.3, pollExport * 0.3) : pollExport;
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
  log("Timeout waiting for export");
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let prompt = useStdin ? await readStdin() : args.join(" ");
  if (!prompt) {
    console.error("Usage: node vibe-slides.mjs \"prompt\" [options]");
    console.error("       echo \"prompt\" | node vibe-slides.mjs --stdin [options]");
    process.exit(1);
  }

  // 1. Create deck
  const deck = await createDeck(prompt, deckName);

  // 2. Wait for generation
  const completedDeck = await pollDeckStatus(deck.id);

  if (noExport) {
    // Output deck info as JSON
    console.log(JSON.stringify({ id: deck.id, name: deck.name, slides: completedDeck.slides_count, url: `https://vibeslides.app/d/${deck.id}` }));
    return;
  }

  // 3. Export
  const exportJob = await startExport(deck.id, format, upscale);

  // 4. Wait for export
  const completedExport = await pollExportStatus(deck.id, exportJob.export_id);

  if (!completedExport.download_url) {
    log("Error: no download URL in export response");
    process.exit(1);
  }

  // 5. Download
  const ext = format === "pptx" ? "pptx" : "pdf";
  const outName = filename || `deck-${deck.id.slice(0, 8)}`;
  const outPath = path.resolve(outDir, `${outName}.${ext}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  log(`Downloading ${ext.toUpperCase()}...`);
  await download(completedExport.download_url, outPath);
  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
  log(`Saved: ${outPath} (${sizeKB} KB)`);

  // Output for caller
  console.log(`FILE: ${outPath}`);
  console.log(JSON.stringify({
    id: deck.id,
    name: deck.name,
    slides: completedDeck.slides_count,
    format: ext,
    file: outPath,
    url: `https://vibeslides.app/d/${deck.id}`,
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });

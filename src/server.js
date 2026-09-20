/**
 * Node server: serves the control page, bridges WebSocket <-> Controller,
 * integrates Doubao Voice Bridge (TCP 4387 control & TCP 5004 audio) and native CDP browser (port 9229).
 *
 *   node src/server.js [--port 8787] [--cdp http://127.0.0.1:9229] [--doubao-host 127.0.0.1] [--doubao-port 4387] [--doubao-audio-port 5004]
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { BrowserManager, DEFAULT_CDP_ENDPOINT } from "./browser.js";
import { Controller } from "./controller.js";
import { DoubaoBridgeClient } from "./doubao.js";
import { hasApiKey } from "./jev.js";
import { MODEL, QUESTIONS, T } from "./constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const out = {
    port: Number(process.env.PORT) || 8787,
    host: process.env.HOST || "127.0.0.1",
    https: Boolean(process.env.HTTPS) || false,
    sslCert: process.env.SSL_CERT || null,
    sslKey: process.env.SSL_KEY || null,
    cdp: process.env.CDP_URL || DEFAULT_CDP_ENDPOINT,
    doubaoHost: process.env.DOUBAO_HOST || "127.0.0.1",
    doubaoPort: Number(process.env.DOUBAO_PORT) || 4387,
    doubaoAudioPort: Number(process.env.DOUBAO_AUDIO_PORT) || 5004,
    startUrl: "https://example.com/",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--https") out.https = true;
    else if (a === "--ssl-cert") out.sslCert = argv[++i];
    else if (a === "--ssl-key") out.sslKey = argv[++i];
    else if (a === "--cdp") out.cdp = argv[++i];
    else if (a === "--doubao-host") out.doubaoHost = argv[++i];
    else if (a === "--doubao-port") out.doubaoPort = Number(argv[++i]);
    else if (a === "--doubao-audio-port") out.doubaoAudioPort = Number(argv[++i]);
    else if (a === "--start-url") out.startUrl = argv[++i];
  }
  return out;
}

export async function startServer(opts = {}) {
  if (!hasApiKey()) {
    console.error("Missing TYPESAFE_API_KEY (or JEV_API_KEY). Use ./run.sh or export it first.");
    process.exit(1);
  }

  const cdpEndpoint = opts.cdp || DEFAULT_CDP_ENDPOINT;
  const browser = new BrowserManager();
  await browser.launch({ cdp: cdpEndpoint, startUrl: opts.startUrl });

  const controller = new Controller({ browser });
  await controller.start();

  const doubao = new DoubaoBridgeClient({
    host: opts.doubaoHost || "127.0.0.1",
    port: opts.doubaoPort || 4387,
    audioPort: opts.doubaoAudioPort || 5004,
  });

  const app = express();
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/api/state", (_req, res) => res.json(controller.uiState()));
  app.get("/api/questions", (_req, res) => res.json({ model: MODEL, thresholds: T, questions: QUESTIONS }));

  let server;
  if (opts.https) {
    let key, cert;
    if (opts.sslKey && opts.sslCert) {
      key = fs.readFileSync(opts.sslKey);
      cert = fs.readFileSync(opts.sslCert);
    } else {
      const certDir = path.join(__dirname, "..", ".cert");
      const keyPath = path.join(certDir, "key.pem");
      const certPath = path.join(certDir, "cert.pem");
      if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        fs.mkdirSync(certDir, { recursive: true });
        execSync(`openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -keyout "${keyPath}" -out "${certPath}" -days 365`, { stdio: "ignore" });
      }
      key = fs.readFileSync(keyPath);
      cert = fs.readFileSync(certPath);
    }
    server = https.createServer({ key, cert }, app);
  } else {
    server = http.createServer(app);
  }
  const wss = new WebSocketServer({ server });

  const broadcast = (type, payload) => {
    const msg = JSON.stringify({ type, payload });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };

  controller.on("transcript", (p) => broadcast("transcript", p));
  controller.on("decision", (p) => broadcast("decision", p));
  controller.on("action", (p) => broadcast("action", { ...p, ui: controller.uiState() }));
  controller.on("snapshot", () => broadcast("snapshot", controller.uiState().snapshot));
  controller.on("log", (p) => broadcast("log", p));
  controller.on("candidates", (p) => broadcast("candidates", p));
  controller.on("pending", (p) => broadcast("pending", p));
  controller.on("tabs", (p) => broadcast("tabs", p));

  // Forward Doubao voice events
  doubao.on("connected", (info) => {
    console.log(`[Doubao] Connected to Doubao Voice Bridge at ${info.host}:${info.port}`);
    broadcast("doubao", { status: "connected", host: info.host, port: info.port });
  });

  doubao.on("disconnected", () => {
    console.log("[Doubao] Disconnected from Doubao Voice Bridge (will retry...)");
    broadcast("doubao", { status: "disconnected" });
  });

  doubao.on("audio_connected", (info) => {
    console.log(`[Doubao] Audio stream connected to ${info.host}:${info.port}`);
    broadcast("doubao", { status: "audio_connected", audioPort: info.port });
  });

  doubao.on("phase", (phase) => {
    broadcast("doubao", { status: "phase", phase });
  });

  doubao.on("transcript", ({ text, final, utteranceId }) => {
    controller.handleTranscript({ text, final, utteranceId });
  });

  doubao.connect();

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({
      type: "hello",
      payload: {
        ...controller.uiState(),
        doubaoConnected: doubao.connected,
      },
    }));

    ws.on("message", async (raw, isBinary) => {
      // Direct binary audio stream from browser microphone -> forward to Doubao audio port (5004)
      if (isBinary) {
        doubao.writeAudio(raw);
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "transcript":
          controller.handleTranscript({ text: msg.text, final: Boolean(msg.final), utteranceId: msg.utteranceId });
          break;
        case "command":
          controller.handleCommand(msg.text);
          break;
        case "undo":
          controller.undo();
          break;
        case "snapshot":
          controller.refreshSnapshot();
          break;
        case "audio_start":
        case "doubao_start":
          doubao.startSession();
          break;
        case "audio_stop":
        case "doubao_stop":
          doubao.stopSession();
          break;
        case "state":
          ws.send(JSON.stringify({ type: "hello", payload: controller.uiState() }));
          break;
        default:
          break;
      }
    });
  });

  const host = opts.host || "127.0.0.1";
  await new Promise((resolve) => server.listen(opts.port, host, resolve));
  const scheme = opts.https ? "https" : "http";
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const url = `${scheme}://${displayHost}:${opts.port}`;

  console.log(`\nvoice-browser ready → open ${url}`);
  if (opts.https) {
    console.log(`(HTTPS enabled for secure context — accept self-signed certificate if prompted)`);
  }
  console.log(`model ${MODEL} · browser CDP: ${cdpEndpoint} · Doubao Bridge: ${doubao.host}:${doubao.port} (audio: ${doubao.audioPort})\n`);

  const shutdown = async () => {
    doubao.close();
    await controller.close();
    await browser.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { app, server, controller, browser, doubao, url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

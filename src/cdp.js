/**
 * Native Chrome DevTools Protocol (CDP) client using WebSocket and HTTP.
 * Replaces Playwright with zero additional dependencies (uses 'ws' already in package.json).
 */
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export class CdpSession extends EventEmitter {
  constructor(wsUrl, targetInfo = {}) {
    super();
    this.wsUrl = wsUrl;
    this.targetInfo = targetInfo;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.connected = false;
    this._closed = false;
  }

  async connect() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return this;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on("open", async () => {
        this.connected = true;
        try {
          await this.send("Page.enable").catch(() => {});
          await this.send("Runtime.enable").catch(() => {});
          resolve(this);
        } catch (err) {
          resolve(this);
        }
      });
      this.ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
          return;
        }
        if (msg.method) {
          this.emit(msg.method, msg.params);
          if (msg.method === "Page.loadEventFired") this.emit("load");
          if (msg.method === "Page.domContentEventFired") this.emit("domcontentloaded");
          if (msg.method === "Page.frameNavigated" && !msg.params?.frame?.parentId) {
            this.emit("navigated", msg.params.frame.url);
          }
        }
      });
      this.ws.on("close", () => {
        this.connected = false;
        this._closed = true;
        this.emit("close");
        for (const { reject } of this.pending.values()) {
          reject(new Error("CDP session closed"));
        }
        this.pending.clear();
      });
      this.ws.on("error", (err) => {
        if (!this.connected) reject(err);
        this.emit("error", err);
      });
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket not open (method: ${method})`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate a JavaScript expression or function in the page context.
   * Matches Playwright's page.evaluate(...) ergonomics.
   */
  async evaluate(expressionOrFn, ...args) {
    let expression;
    if (typeof expressionOrFn === "function") {
      expression = `(${expressionOrFn.toString()})(...${JSON.stringify(args)})`;
    } else if (args.length > 0) {
      expression = `(${expressionOrFn})(...${JSON.stringify(args)})`;
    } else {
      expression = String(expressionOrFn);
    }

    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res?.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${desc}`);
    }
    return res?.result?.value;
  }

  url() {
    return this.targetInfo?.url || "";
  }

  async title() {
    try {
      return (await this.evaluate(() => document.title)) || this.targetInfo?.title || "";
    } catch {
      return this.targetInfo?.title || "";
    }
  }

  async goto(targetUrl, { waitUntil = "domcontentloaded", timeout = 15000 } = {}) {
    const t0 = Date.now();
    await this.send("Page.enable").catch(() => {});
    if (this.targetInfo) this.targetInfo.url = targetUrl;
    await this.send("Page.navigate", { url: targetUrl });

    // Wait until document.readyState is interactive or complete
    while (Date.now() - t0 < timeout) {
      try {
        const state = await this.evaluate(() => document.readyState);
        if (waitUntil === "commit") break;
        if (state === "interactive" || state === "complete") break;
      } catch {
        // navigation in progress
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  async waitForLoadState(state = "domcontentloaded", { timeout = 2500 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const readyState = await this.evaluate(() => document.readyState);
        if (state === "domcontentloaded" && (readyState === "interactive" || readyState === "complete")) break;
        if (state === "load" && readyState === "complete") break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async waitForTimeout(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async goBack({ timeout = 15000 } = {}) {
    await this.evaluate(() => window.history.back());
    await this.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {});
  }

  async goForward({ timeout = 15000 } = {}) {
    await this.evaluate(() => window.history.forward());
    await this.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {});
  }

  async reload({ timeout = 15000 } = {}) {
    await this.send("Page.reload", { ignoreCache: false }).catch(async () => {
      await this.evaluate(() => location.reload());
    });
    await this.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {});
  }

  isClosed() {
    return this._closed || !this.ws || this.ws.readyState === WebSocket.CLOSED;
  }

  async close() {
    this._closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
  }
}

export class CdpClient {
  constructor(endpoint = "http://127.0.0.1:9229") {
    // Normalize endpoint (strip trailing slash)
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  async version() {
    const res = await fetch(`${this.endpoint}/json/version`);
    if (!res.ok) throw new Error(`CDP version check failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async listTargets() {
    const res = await fetch(`${this.endpoint}/json/list`);
    if (!res.ok) throw new Error(`CDP list failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  async listPages() {
    const targets = await this.listTargets();
    return targets.filter((t) => t.type === "page");
  }

  async newTab(url = "about:blank") {
    const targetUrl = `${this.endpoint}/json/new?${encodeURIComponent(url)}`;
    const res = await fetch(targetUrl, { method: "PUT" }).catch(() => fetch(targetUrl));
    if (!res.ok) throw new Error(`Failed to create new tab: ${res.statusText}`);
    return res.json();
  }

  async activateTab(targetId) {
    const res = await fetch(`${this.endpoint}/json/activate/${targetId}`);
    return res.ok;
  }

  async closeTab(targetId) {
    const res = await fetch(`${this.endpoint}/json/close/${targetId}`);
    return res.ok;
  }
}

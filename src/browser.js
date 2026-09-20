/**
 * Browser management: connects directly to a running Chrome instance via CDP (port 9229).
 * Completely removes Playwright dependency.
 * Tracks tabs and exposes the active page for snapshot and overlay operations.
 */
import { CdpClient, CdpSession } from "./cdp.js";
import { installOverlay } from "./overlay.js";
import { collectElementsInPage, buildSnapshot } from "./snapshot.js";

export const DEFAULT_CDP_ENDPOINT = process.env.CDP_URL || "http://127.0.0.1:9229";

export class BrowserManager {
  constructor() {
    this.cdpClient = null;
    this.active = null;
    this.pages = []; // Array of CdpSession
    this.listeners = new Set();
    this.pollTimer = null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch {}
    }
  }

  /**
   * Connect to a running Chrome browser with remote debugging enabled.
   * Default endpoint: http://127.0.0.1:9229
   */
  async launch({ cdp = DEFAULT_CDP_ENDPOINT, startUrl = null } = {}) {
    let endpoint = cdp;
    if (typeof endpoint === "string" && endpoint.startsWith("ws://")) {
      // If given a ws URL like ws://127.0.0.1:9229/devtools/browser/..., normalize to http
      const u = new URL(endpoint);
      endpoint = `http://${u.host}`;
    }
    this.cdpClient = new CdpClient(endpoint);

    // Verify connection to CDP
    await this.cdpClient.version();

    // Discover existing pages and attach to them
    await this.refreshTabs();

    if (this.pages.length === 0) {
      await this.openNewTab(startUrl || "about:blank");
    } else if (startUrl && startUrl !== "about:blank") {
      await this.active.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    }

    // Periodically poll tab list to sync background tab closures or navigation
    this.pollTimer = setInterval(() => this.refreshTabs().catch(() => {}), 3000);

    this._emit();
    return this;
  }

  async refreshTabs() {
    if (!this.cdpClient) return;
    const targetList = await this.cdpClient.listPages().catch(() => []);
    const existingById = new Map(this.pages.map((p) => [p.targetInfo.id, p]));
    const newPages = [];

    for (const target of targetList) {
      if (existingById.has(target.id)) {
        const existing = existingById.get(target.id);
        existing.targetInfo = target;
        newPages.push(existing);
      } else {
        const session = new CdpSession(target.webSocketDebuggerUrl, target);
        try {
          await session.connect();
          session.on("navigated", (url) => {
            session.targetInfo.url = url;
            this._emit();
          });
          session.on("close", () => {
            this.pages = this.pages.filter((p) => p !== session);
            if (this.active === session) {
              this.active = this.pages[this.pages.length - 1] || null;
            }
            this._emit();
          });
          newPages.push(session);
        } catch {
          // unable to connect to this target, skip
        }
      }
    }

    // Close sessions for removed tabs
    for (const [id, session] of existingById.entries()) {
      if (!targetList.some((t) => t.id === id)) {
        session.close();
      }
    }

    this.pages = newPages;
    if (!this.active || !this.pages.includes(this.active)) {
      this.active = this.pages[this.pages.length - 1] || null;
    }
    this._emit();
  }

  get page() {
    if (!this.active || this.active.isClosed()) {
      this.active = this.pages.find((p) => !p.isClosed()) || null;
    }
    return this.active;
  }

  async ensurePage() {
    if (!this.page) {
      await this.openNewTab();
    }
    return this.page;
  }

  async setActive(page) {
    if (!page) return;
    this.active = page;
    if (page.targetInfo?.id) {
      await this.cdpClient.activateTab(page.targetInfo.id).catch(() => {});
    }
    this._emit();
  }

  tabInfo() {
    return this.pages.map((p, i) => ({
      index: i,
      id: p.targetInfo.id,
      url: p.targetInfo.url || "",
      title: p.targetInfo.title || "",
      active: p === this.active,
    }));
  }

  async openNewTab(url = "about:blank") {
    const target = await this.cdpClient.newTab(url);
    const session = new CdpSession(target.webSocketDebuggerUrl, target);
    await session.connect();
    this.pages.push(session);
    await this.setActive(session);
    return session;
  }

  async closeTab(page = this.page) {
    if (!page) return;
    const targetId = page.targetInfo?.id;
    if (targetId) {
      await this.cdpClient.closeTab(targetId).catch(() => {});
    }
    await page.close();
    this.pages = this.pages.filter((p) => p !== page);
    if (this.active === page) {
      this.active = this.pages[this.pages.length - 1] || null;
    }
    if (this.pages.length === 0) {
      await this.openNewTab();
    }
    this._emit();
  }

  /** Snapshot the active page (URL, title, compact element list, search box, site). */
  async snapshot() {
    const page = await this.ensurePage();
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => {});
      // Ensure overlay functions are installed
      await page.evaluate(installOverlay).catch(() => {});
      const data = await page.evaluate(collectElementsInPage);
      return buildSnapshot(data, { tabs: this.tabInfo() });
    } catch (err) {
      const currentUrl = await page.url().catch(() => "");
      return buildSnapshot(
        { url: currentUrl, title: "", scrollY: 0, scrollHeight: 0, viewportHeight: 0, elements: [] },
        { tabs: this.tabInfo(), error: String(err.message || err) },
      );
    }
  }

  /** Call window.__vb.<fn>(...args) in the active page, swallowing errors. */
  async overlay(fn, ...args) {
    const page = this.page;
    if (!page) return;
    await page.evaluate(installOverlay).catch(() => {});
    await page
      .evaluate(
        ([fn, args]) => {
          if (!window.__vb) return false;
          return window.__vb[fn](...args);
        },
        [fn, args],
      )
      .catch(() => {});
  }

  async close() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const p of this.pages) {
      await p.close().catch(() => {});
    }
    this.pages = [];
    this.active = null;
  }
}

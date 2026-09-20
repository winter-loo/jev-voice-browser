/**
 * Execute a policy action on the controlled browser via native CDP / DOM manipulation.
 * Completely removes Playwright dependency.
 * Shows overlay feedback (highlight + toast) on the page.
 */
import { HIGHLIGHT_MS } from "./constants.js";
import { describe } from "./policy.js";

const NAV_TIMEOUT = 15000;

async function settle(page, ms = 2500) {
  await Promise.race([page.waitForLoadState("domcontentloaded").catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  await page.waitForTimeout(120);
}

/** Wait for a possible new tab after a click (target=_blank). */
async function maybeNewTab(browser, before) {
  await new Promise((r) => setTimeout(r, 400));
  await browser.refreshTabs().catch(() => {});
  const fresh = browser.pages.find((p) => !before.includes(p));
  if (fresh) await browser.setActive(fresh);
}

/**
 * @param {object} action  from policy.evaluatePolicy
 * @param {import('./browser.js').BrowserManager} browser
 * @returns {Promise<{ok: boolean, detail?: string}>}
 */
export async function execute(action, browser) {
  const page = await browser.ensurePage();
  const label = describe(action);

  switch (action.type) {
    case "navigate_url": {
      await browser.overlay("toast", `→ ${label}`);
      const host = new URL(action.url).hostname.replace(/^www\./, "");
      try {
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      } catch (e) {
        await new Promise((r) => setTimeout(r, 500));
        await page.goto(action.url, { waitUntil: "commit", timeout: NAV_TIMEOUT }).catch(() => {});
        const current = await page.url();
        if (!current.includes(host)) throw e;
      }
      await settle(page, 800);
      return { ok: true, detail: await page.url() };
    }

    case "click_element": {
      const before = [...browser.pages];
      await browser.overlay("clearCandidates");
      await browser.overlay("highlight", action.targetId, HIGHLIGHT_MS);
      await browser.overlay("toast", label);
      await new Promise((r) => setTimeout(r, 180)); // let the user see the highlight

      const clicked = await page.evaluate((id) => {
        const el = document.querySelector(`[data-vb-id="${id}"]`);
        if (!el) return false;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        el.click();
        return true;
      }, action.targetId);

      await settle(page);
      await maybeNewTab(browser, before);
      return { ok: Boolean(clicked), detail: await browser.page.url() };
    }

    case "type_into_field": {
      await browser.overlay("clearCandidates");
      await browser.overlay("highlight", action.targetId, HIGHLIGHT_MS + 400);
      await browser.overlay("toast", label);

      await page.evaluate(
        ([id, text]) => {
          const el = document.querySelector(`[data-vb-id="${id}"]`);
          if (!el) return false;
          el.scrollIntoView({ block: "center", inline: "nearest" });
          el.focus();
          const setter =
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
          if (setter) {
            setter.call(el, text);
          } else {
            el.value = text;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        [action.targetId, action.text],
      );

      if (action.submit) {
        await page.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          windowsVirtualKeyCode: 13,
          unmodifiedText: "\r",
          text: "\r",
        }).catch(() => {});
        await page.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          windowsVirtualKeyCode: 13,
          unmodifiedText: "\r",
          text: "\r",
        }).catch(() => {});
        await page.evaluate((id) => {
          const el = document.querySelector(`[data-vb-id="${id}"]`);
          if (el?.form) {
            if (typeof el.form.requestSubmit === "function") el.form.requestSubmit();
            else el.form.submit();
          }
        }, action.targetId).catch(() => {});
        await settle(page);
      }
      return { ok: true, detail: await page.url() };
    }

    case "select_option": {
      await browser.overlay("highlight", action.targetId, HIGHLIGHT_MS);
      await browser.overlay("toast", label);
      const picked = await page.evaluate(
        ([id, wanted]) => {
          const sel = document.querySelector(`[data-vb-id="${id}"]`);
          if (!sel) return null;
          const w = wanted.toLowerCase();
          const opts = Array.from(sel.options || []);
          const hit = opts.find((o) => o.label.toLowerCase() === w) || opts.find((o) => o.label.toLowerCase().includes(w));
          if (!hit) return null;
          sel.value = hit.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return hit.label;
        },
        [action.targetId, action.text],
      );
      return { ok: Boolean(picked), detail: picked || "no matching option" };
    }

    case "press_enter":
      await browser.overlay("toast", "⏎ enter");
      await page.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        windowsVirtualKeyCode: 13,
        unmodifiedText: "\r",
        text: "\r",
      }).catch(() => {});
      await page.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        windowsVirtualKeyCode: 13,
        unmodifiedText: "\r",
        text: "\r",
      }).catch(() => {});
      await settle(page);
      return { ok: true, detail: await page.url() };

    case "scroll_down":
    case "scroll_up": {
      const dir = action.type === "scroll_down" ? 1 : -1;
      await browser.overlay("toast", label);
      await page.evaluate(
        ([dir, amount]) => {
          const vh = window.innerHeight;
          if (amount === "end") {
            window.scrollTo({ top: dir > 0 ? document.documentElement.scrollHeight : 0, behavior: "smooth" });
          } else {
            const px = amount === "little" ? vh * 0.35 : vh * 0.85;
            window.scrollBy({ top: dir * px, behavior: "smooth" });
          }
        },
        [dir, action.amount || "page"],
      );
      await page.waitForTimeout(350);
      const scrollY = await page.evaluate(() => Math.round(window.scrollY)).catch(() => 0);
      return { ok: true, detail: `scrollY=${scrollY}` };
    }

    case "go_back":
      await browser.overlay("toast", "← back");
      await page.goBack({ timeout: NAV_TIMEOUT }).catch(() => {});
      await settle(page, 800);
      return { ok: true, detail: await page.url() };

    case "go_forward":
      await browser.overlay("toast", "→ forward");
      await page.goForward({ timeout: NAV_TIMEOUT }).catch(() => {});
      await settle(page, 800);
      return { ok: true, detail: await page.url() };

    case "reload":
      await browser.overlay("toast", "↻ reload");
      await page.reload({ timeout: NAV_TIMEOUT }).catch(() => {});
      return { ok: true, detail: await page.url() };

    case "open_new_tab": {
      const p = await browser.openNewTab();
      await browser.setActive(p);
      await browser.overlay("toast", "new tab");
      return { ok: true, detail: `tabs=${browser.pages.length}` };
    }

    case "close_tab": {
      await browser.closeTab(page);
      return { ok: true, detail: `tabs=${browser.pages.length}` };
    }

    case "switch_tab": {
      const pages = browser.pages;
      if (pages.length < 2) return { ok: false, detail: "only one tab" };
      const i = pages.indexOf(browser.page);
      let next;
      if (action.direction === "previous") next = pages[(i - 1 + pages.length) % pages.length];
      else if (action.direction === "first") next = pages[0];
      else next = pages[(i + 1) % pages.length];
      await browser.setActive(next);
      await browser.overlay("toast", "switched tab");
      return { ok: true, detail: await next.url() };
    }

    default:
      return { ok: false, detail: `unknown action ${action.type}` };
  }
}

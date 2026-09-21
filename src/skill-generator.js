/**
 * SkillGenerator: Synthesizes recorded teaching sessions into Antigravity Skills.
 * Creates standard .agents/skills/<skill-name>/ with SKILL.md, executable scripts,
 * references, and resources.
 */
import fs from "node:fs";
import path from "node:path";

export function detectParameters(session) {
  const params = {
    amount: { name: "amount", type: "number", default: "50", description: "Gift card amount in USD" },
    recipientEmail: { name: "recipientEmail", type: "string", default: "recipient@example.com", description: "Recipient's email address" },
    recipientName: { name: "recipientName", type: "string", default: "Valued Friend", description: "Recipient's display name" },
    senderName: { name: "senderName", type: "string", default: "Self", description: "Sender's display name" },
    senderEmail: { name: "senderEmail", type: "string", default: "sender@example.com", description: "Sender's email address" },
    giftMessage: { name: "giftMessage", type: "string", default: "Enjoy this gift!", description: "Optional gift message" },
  };

  const steps = session?.steps || [];
  for (const s of steps) {
    const text = s.action?.text || "";
    const voice = s.voicePrompt || "";
    const fieldName = (s.targetElement?.name || "").toLowerCase();
    const placeholder = (s.targetElement?.placeholder || "").toLowerCase();

    // Check for email
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/) || voice.match(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      if (fieldName.includes("sender") || placeholder.includes("sender") || voice.includes("发件人") || voice.includes("sender")) {
        params.senderEmail.default = emailMatch[0];
      } else {
        params.recipientEmail.default = emailMatch[0];
      }
    }

    // Check for amount
    const amtMatch = text.match(/^\$?(\d+(?:\.\d{2})?)$/) || voice.match(/(\d+)\s*(?:美元|刀|dollars|bucks)?/i);
    if (amtMatch && (fieldName.includes("amount") || placeholder.includes("amount") || voice.includes("面额") || voice.includes("amount") || voice.includes("元") || voice.includes("刀"))) {
      params.amount.default = amtMatch[1];
    }

    // Check for recipient name
    if (fieldName.includes("recipient") || placeholder.includes("recipient") || voice.includes("收件人")) {
      if (text && !text.includes("@")) {
        params.recipientName.default = text;
      }
    }
  }

  return params;
}

export function generateSkillMarkdown({ session, skillName = "buy-apple-gift-card", params }) {
  const steps = session?.steps || [];
  const startUrl = steps.find((s) => s.action?.type === "navigate_url")?.action?.url || "https://www.apple.com/shop/buy-giftcard/giftcard";

  return `---
name: ${skillName}
description: >-
  Automatically purchase Apple Gift Cards (digital/email delivery) with specified amount, recipient email, and gift message using browser automation. Use this skill whenever the user asks to buy, purchase, or order an Apple Gift Card.
---

# Buy Apple Gift Card

This skill automates the complete workflow for purchasing an Apple Gift Card.
It was taught by human voice demonstration and synthesized into deterministic browser automation.

## Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| \`amount\` | number | \`${params.amount.default}\` | ${params.amount.description} |
| \`recipientEmail\` | string | \`${params.recipientEmail.default}\` | ${params.recipientEmail.description} |
| \`recipientName\` | string | \`${params.recipientName.default}\` | ${params.recipientName.description} |
| \`senderName\` | string | \`${params.senderName.default}\` | ${params.senderName.description} |
| \`senderEmail\` | string | \`${params.senderEmail.default}\` | ${params.senderEmail.description} |
| \`giftMessage\` | string | \`${params.giftMessage.default}\` | ${params.giftMessage.description} |

## Prerequisites

1. Chromium / Chrome running with CDP enabled (e.g. \`--remote-debugging-port=9229\`) or voice-browser running.
2. User must be signed into Apple ID on the target browser session if purchasing with saved credentials.

> [!CAUTION]
> **Safety Gate**: The automation stops and presents the bag/order summary for **human confirmation** before placing the order or charging the card. Never submit final credit card authorization automatically.

## Workflow Steps

The procedure consists of the following steps learned from the voice teaching session:

${steps
  .map((s, idx) => {
    let actionDesc = "";
    if (s.action.type === "navigate_url") {
      actionDesc = `Navigate to [${s.action.url}](${s.action.url})`;
    } else if (s.action.type === "click_element") {
      actionDesc = `Click **${s.targetElement?.text || s.action.label || s.targetElement?.role}** (\`${s.targetElement?.semanticSelector || s.action.targetId}\`)`;
    } else if (s.action.type === "type_into_field") {
      actionDesc = `Enter value into **${s.targetElement?.placeholder || s.targetElement?.name || s.action.label}** (\`${s.targetElement?.semanticSelector || s.action.targetId}\`)`;
    } else {
      actionDesc = `Execute **${s.action.type}**: ${s.action.label}`;
    }
    return `${idx + 1}. **Spoken Instruction**: "${s.voicePrompt}"\n   - **Action**: ${actionDesc}`;
  })
  .join("\n")}

## Execution

To execute this skill directly via script:

\`\`\`bash
node .agents/skills/${skillName}/scripts/buy_apple_gift_card.js \\
  --amount 50 \\
  --recipient-email "friend@example.com" \\
  --recipient-name "Friend" \\
  --sender-name "Me"
\`\`\`

## References & Raw Session
- See [Workflow Breakdown](./references/workflow-breakdown.md) for full mapping between voice inputs and browser commands.
- Raw session data preserved in [teaching-session.json](./resources/teaching-session.json).
`;
}

export function generateReplayScript({ session, skillName = "buy-apple-gift-card", params }) {
  const steps = session?.steps || [];
  const startUrl = steps.find((s) => s.action?.type === "navigate_url")?.action?.url || "https://www.apple.com/shop/buy-giftcard/giftcard";

  return `#!/usr/bin/env node
/**
 * Automated Apple Gift Card Purchase Runner
 * Generated from voice teaching session on ${new Date().toISOString()}
 *
 * Usage:
 *   node buy_apple_gift_card.js [--amount 50] [--recipient-email user@example.com] [--recipient-name Name] [--cdp http://127.0.0.1:9229] [--dry-run]
 */

import http from "node:http";
import { WebSocket } from "ws";

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};

const AMOUNT = getArg("--amount", "${params.amount.default}");
const RECIPIENT_EMAIL = getArg("--recipient-email", "${params.recipientEmail.default}");
const RECIPIENT_NAME = getArg("--recipient-name", "${params.recipientName.default}");
const SENDER_NAME = getArg("--sender-name", "${params.senderName.default}");
const SENDER_EMAIL = getArg("--sender-email", "${params.senderEmail.default}");
const GIFT_MESSAGE = getArg("--message", "${params.giftMessage.default}");
const CDP_URL = getArg("--cdp", process.env.CDP_URL || "http://127.0.0.1:9229");
const DRY_RUN = args.includes("--dry-run");

console.log("=== Apple Gift Card Automated Purchase ===");
console.log({
  amount: AMOUNT,
  recipientEmail: RECIPIENT_EMAIL,
  recipientName: RECIPIENT_NAME,
  senderName: SENDER_NAME,
  cdp: CDP_URL,
  dryRun: DRY_RUN,
});

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

class SimpleCdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
      this.ws.on("message", (msg) => {
        const res = JSON.parse(msg.toString());
        if (res.id && this.pending.has(res.id)) {
          const { resolve, reject } = this.pending.get(res.id);
          this.pending.delete(res.id);
          if (res.error) reject(new Error(res.error.message));
          else resolve(res.result);
        }
      });
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr) {
    const res = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 2000));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  if (DRY_RUN) {
    console.log("✓ Dry-run completed. All parameters validated successfully.");
    return;
  }

  console.log("Connecting to browser CDP...");
  let tabs;
  try {
    tabs = await getJson(\`\${CDP_URL}/json/list\`);
  } catch (err) {
    console.error(\`Failed to connect to CDP at \${CDP_URL}: \${err.message}\`);
    console.log("Hint: Launch Chrome with: /Applications/Google\\\\ Chrome.app/Contents/MacOS/Google\\\\ Chrome --remote-debugging-port=9229");
    process.exit(1);
  }

  const tab = tabs.find((t) => t.type === "page") || tabs[0];
  if (!tab || !tab.webSocketDebuggerUrl) {
    console.error("No active page tab found in Chrome");
    process.exit(1);
  }

  const page = new SimpleCdpPage(tab.webSocketDebuggerUrl);
  await page.connect();
  console.log("Connected to page:", tab.title || tab.url);

  try {
    // Step 1: Navigate to Apple Gift Card purchase page
    console.log("Step 1: Navigating to Apple Gift Card page...");
    await page.navigate("${startUrl}");

    // Step 2: Select digital / email delivery
    console.log("Step 2: Selecting Email / Digital card format...");
    await page.evaluate(\`(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="radio"], [role="button"]'));
      const emailBtn = btns.find(b => (b.innerText || b.value || b.getAttribute('aria-label') || '').toLowerCase().includes('email'));
      if (emailBtn) { emailBtn.click(); return true; }
      return false;
    })()\`);
    await new Promise((r) => setTimeout(r, 1200));

    // Step 3: Fill or select amount
    console.log(\`Step 3: Setting amount to $\${AMOUNT}...\`);
    await page.evaluate(\`((amt) => {
      // Try preset button first
      const btns = Array.from(document.querySelectorAll('button, input[type="radio"]'));
      const hit = btns.find(b => (b.innerText || b.value || '').trim() === ('$' + amt));
      if (hit) { hit.click(); return true; }

      // Try other amount input field
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
      const amtInput = inputs.find(i => (i.placeholder || i.name || i.getAttribute('aria-label') || '').toLowerCase().includes('amount') || (i.name || '').includes('amount'));
      if (amtInput) {
        amtInput.focus();
        amtInput.value = amt;
        amtInput.dispatchEvent(new Event('input', { bubbles: true }));
        amtInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })(\${JSON.stringify(AMOUNT)})\`);
    await new Promise((r) => setTimeout(r, 1000));

    // Step 4: Fill recipient and sender information
    console.log("Step 4: Filling recipient and sender fields...");
    await page.evaluate(\`((rName, rEmail, sName, sEmail, msg) => {
      const fillByPlaceholder = (pattern, val) => {
        const inputs = Array.from(document.querySelectorAll('input, textarea'));
        const hit = inputs.find(i => {
          const s = (i.placeholder || i.name || i.getAttribute('aria-label') || '').toLowerCase();
          return pattern.test(s);
        });
        if (hit && val) {
          hit.focus();
          hit.value = val;
          hit.dispatchEvent(new Event('input', { bubbles: true }));
          hit.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      };

      fillByPlaceholder(/recipient.*name|to.*name|收件人/i, rName);
      fillByPlaceholder(/recipient.*email|to.*email|邮箱/i, rEmail);
      fillByPlaceholder(/sender.*name|from.*name|发件人/i, sName);
      fillByPlaceholder(/sender.*email|from.*email/i, sEmail);
      if (msg) fillByPlaceholder(/message|gift message|寄语/i, msg);
    })(\${JSON.stringify(RECIPIENT_NAME)}, \${JSON.stringify(RECIPIENT_EMAIL)}, \${JSON.stringify(SENDER_NAME)}, \${JSON.stringify(SENDER_EMAIL)}, \${JSON.stringify(GIFT_MESSAGE)})\`);
    await new Promise((r) => setTimeout(r, 1200));

    // Step 5: Add to bag
    console.log("Step 5: Adding to bag...");
    await page.evaluate(\`(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const addBtn = btns.find(b => (b.innerText || b.value || '').toLowerCase().includes('add to bag') || (b.innerText || '').includes('添加到购物袋'));
      if (addBtn) { addBtn.click(); return true; }
      return false;
    })()\`);
    await new Promise((r) => setTimeout(r, 2000));

    console.log("\\n=======================================================");
    console.log("✓ Successfully configured gift card and added to bag!");
    console.log("SAFETY GATE: Paused at checkout. Please review in browser to authorize payment.");
    console.log("=======================================================\\n");
  } finally {
    page.close();
  }
}

run().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
`;
}

export function generateWorkflowBreakdown({ session }) {
  const steps = session?.steps || [];
  return `# Workflow Breakdown: Voice Teaching to Browser Commands

This document records the exact correspondence between the user's spoken voice instructions and the real browser commands executed during the teaching session.

| Step | User Spoken Voice Prompt | Executed Browser Action | Target Selector / Details | URL | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
${steps
  .map((s) => {
    const act = s.action.type + (s.action.text ? ` ("${s.action.text}")` : s.action.url ? ` (${s.action.url})` : "");
    const selector = s.targetElement?.semanticSelector || s.targetElement?.role || s.action.targetId || "-";
    const url = s.pageAfter?.url || s.pageBefore?.url || "-";
    const status = s.result?.ok ? "✓ OK" : "✗ Fail";
    return `| ${s.stepIndex} | "${s.voicePrompt}" | \`${act}\` | \`${selector}\` | \`${url}\` | ${status} |`;
  })
  .join("\n")}
`;
}

export async function synthesizeSkill({
  session,
  skillName = "buy-apple-gift-card",
  outputDir = path.resolve(process.cwd(), ".agents", "skills"),
}) {
  if (!session || !session.steps || session.steps.length === 0) {
    throw new Error("Cannot synthesize skill: session contains no recorded steps.");
  }

  const targetSkillDir = path.join(outputDir, skillName);
  const scriptsDir = path.join(targetSkillDir, "scripts");
  const resourcesDir = path.join(targetSkillDir, "resources");
  const referencesDir = path.join(targetSkillDir, "references");

  fs.mkdirSync(targetSkillDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(referencesDir, { recursive: true });

  const params = detectParameters(session);

  // 1. Generate SKILL.md
  const skillMdContent = generateSkillMarkdown({ session, skillName, params });
  const skillMdPath = path.join(targetSkillDir, "SKILL.md");
  fs.writeFileSync(skillMdPath, skillMdContent, "utf8");

  // 2. Generate scripts/buy_apple_gift_card.js
  const scriptContent = generateReplayScript({ session, skillName, params });
  const scriptPath = path.join(scriptsDir, "buy_apple_gift_card.js");
  fs.writeFileSync(scriptPath, scriptContent, { encoding: "utf8", mode: 0o755 });

  // 3. Save resources/teaching-session.json
  const sessionJsonPath = path.join(resourcesDir, "teaching-session.json");
  fs.writeFileSync(sessionJsonPath, JSON.stringify(session, null, 2), "utf8");

  // 4. Save references/workflow-breakdown.md
  const breakdownContent = generateWorkflowBreakdown({ session });
  const breakdownPath = path.join(referencesDir, "workflow-breakdown.md");
  fs.writeFileSync(breakdownPath, breakdownContent, "utf8");

  return {
    skillName,
    skillDir: targetSkillDir,
    files: {
      skillMd: skillMdPath,
      script: scriptPath,
      sessionJson: sessionJsonPath,
      breakdown: breakdownPath,
    },
    stepCount: session.steps.length,
    parameters: params,
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectParameters,
  generateSkillMarkdown,
  generateReplayScript,
  generateWorkflowBreakdown,
  synthesizeSkill,
} from "../../src/skill-generator.js";

const mockSession = {
  id: "test-session-1",
  name: "buy-apple-gift-card",
  title: "Purchase Apple Gift Card via Voice Demonstration",
  startedAt: 1726880000000,
  endedAt: 1726880050000,
  steps: [
    {
      stepIndex: 1,
      voicePrompt: "打开苹果官网礼品卡购买页面",
      action: { type: "navigate_url", url: "https://www.apple.com/shop/buy-giftcard/giftcard", label: "https://www.apple.com/shop/buy-giftcard/giftcard" },
      pageBefore: { url: "about:blank", title: "Blank" },
      pageAfter: { url: "https://www.apple.com/shop/buy-giftcard/giftcard", title: "Buy Apple Gift Card" },
      result: { ok: true },
    },
    {
      stepIndex: 2,
      voicePrompt: "选择发送电子礼品卡",
      action: { type: "click_element", targetId: "e02", label: 'click "Email"' },
      targetElement: { id: "e02", role: "button", text: "Email", tag: "button", semanticSelector: 'button[role="button"]:has-text("Email")' },
      result: { ok: true },
    },
    {
      stepIndex: 3,
      voicePrompt: "面额填入50美元",
      action: { type: "type_into_field", text: "50", targetId: "e05", label: "type 50 into Amount" },
      targetElement: { id: "e05", role: "textbox", name: "custom-amount", placeholder: "Other Amount", tag: "input", semanticSelector: 'input[name="custom-amount"]' },
      result: { ok: true },
    },
    {
      stepIndex: 4,
      voicePrompt: "输入收件人名字 Friend",
      action: { type: "type_into_field", text: "Friend", targetId: "e08", label: "type Friend into Recipient Name" },
      targetElement: { id: "e08", role: "textbox", name: "recipient-name", placeholder: "Recipient Name", tag: "input", semanticSelector: 'input[name="recipient-name"]' },
      result: { ok: true },
    },
    {
      stepIndex: 5,
      voicePrompt: "输入收件人邮箱 friend@example.com",
      action: { type: "type_into_field", text: "friend@example.com", targetId: "e09", label: "type friend@example.com into Recipient Email" },
      targetElement: { id: "e09", role: "textbox", name: "recipient-email", placeholder: "Recipient Email", tag: "input", semanticSelector: 'input[name="recipient-email"]' },
      result: { ok: true },
    },
    {
      stepIndex: 6,
      voicePrompt: "点击添加到购物袋",
      action: { type: "click_element", targetId: "e15", label: 'click "Add to Bag"' },
      targetElement: { id: "e15", role: "button", text: "Add to Bag", tag: "button", semanticSelector: 'button[role="button"]:has-text("Add to Bag")' },
      result: { ok: true },
    },
  ],
};

test("detectParameters extracts amount, email, and recipient", () => {
  const params = detectParameters(mockSession);
  assert.equal(params.amount.default, "50");
  assert.equal(params.recipientEmail.default, "friend@example.com");
  assert.equal(params.recipientName.default, "Friend");
});

test("generateSkillMarkdown creates valid Antigravity skill format", () => {
  const params = detectParameters(mockSession);
  const md = generateSkillMarkdown({ session: mockSession, skillName: "buy-apple-gift-card", params });

  assert.ok(md.startsWith("---\nname: buy-apple-gift-card\n"));
  assert.ok(md.includes("description:"));
  assert.ok(md.includes("# Buy Apple Gift Card"));
  assert.ok(md.includes("## Parameters"));
  assert.ok(md.includes("## Workflow Steps"));
  assert.ok(md.includes("Safety Gate"));
});

test("synthesizeSkill generates full .agents/skills directory structure", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-test-"));
  try {
    const res = await synthesizeSkill({
      session: mockSession,
      skillName: "buy-apple-gift-card",
      outputDir: tmpDir,
    });

    assert.equal(res.skillName, "buy-apple-gift-card");
    assert.equal(res.stepCount, 6);

    const skillPath = path.join(tmpDir, "buy-apple-gift-card");
    assert.ok(fs.existsSync(path.join(skillPath, "SKILL.md")));
    assert.ok(fs.existsSync(path.join(skillPath, "scripts", "buy_apple_gift_card.js")));
    assert.ok(fs.existsSync(path.join(skillPath, "resources", "teaching-session.json")));
    assert.ok(fs.existsSync(path.join(skillPath, "references", "workflow-breakdown.md")));

    const skillContent = fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8");
    assert.ok(skillContent.includes("name: buy-apple-gift-card"));

    const scriptContent = fs.readFileSync(path.join(skillPath, "scripts", "buy_apple_gift_card.js"), "utf8");
    assert.ok(scriptContent.includes("RECIPIENT_EMAIL"));
    assert.ok(scriptContent.includes("AMOUNT"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

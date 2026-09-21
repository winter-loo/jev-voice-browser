import test from "node:test";
import assert from "node:assert/strict";
import { TeachingRecorder, buildSemanticSelector } from "../../src/teaching.js";

test("buildSemanticSelector creates durable selectors", () => {
  // Input with name
  assert.equal(
    buildSemanticSelector({ tag: "input", name: "recipient-email", role: "textbox" }),
    'input[name="recipient-email"]'
  );

  // Input with placeholder
  assert.equal(
    buildSemanticSelector({ tag: "input", placeholder: "Enter amount", role: "textbox" }),
    'input[placeholder="Enter amount"]'
  );

  // Button with text
  assert.equal(
    buildSemanticSelector({ tag: "button", text: "Add to Bag", role: "button" }),
    'button[role="button"]:has-text("Add to Bag")'
  );

  // Element with aria-label
  assert.equal(
    buildSemanticSelector({ ariaLabel: "Email Delivery Option" }),
    '[aria-label="Email Delivery Option"]'
  );
});

test("TeachingRecorder records paired voice prompts and browser commands", () => {
  const recorder = new TeachingRecorder();
  assert.equal(recorder.isRecording, false);
  assert.equal(recorder.getCurrentSession(), null);

  // Start session
  const session = recorder.startSession({ name: "buy-apple-gift-card" });
  assert.equal(recorder.isRecording, true);
  assert.equal(session.name, "buy-apple-gift-card");
  assert.equal(session.steps.length, 0);

  // Record step 1: Navigation
  const step1 = recorder.recordStep({
    voicePrompt: "打开苹果官网礼品卡购买页面",
    rawTranscript: "打开苹果官网礼品卡购买页面",
    action: {
      type: "navigate_url",
      url: "https://www.apple.com/shop/buy-giftcard/giftcard",
      label: "https://www.apple.com/shop/buy-giftcard/giftcard",
    },
    pageBefore: { url: "https://www.google.com", title: "Google" },
    pageAfter: { url: "https://www.apple.com/shop/buy-giftcard/giftcard", title: "Buy Apple Gift Card" },
    result: { ok: true },
  });

  assert.equal(step1.stepIndex, 1);
  assert.equal(step1.voicePrompt, "打开苹果官网礼品卡购买页面");
  assert.equal(step1.action.type, "navigate_url");
  assert.equal(step1.action.url, "https://www.apple.com/shop/buy-giftcard/giftcard");

  // Record step 2: Click
  const step2 = recorder.recordStep({
    voicePrompt: "选择发送电子礼品卡",
    action: {
      type: "click_element",
      targetId: "e03",
      label: 'click "Email"',
    },
    targetElement: {
      id: "e03",
      role: "button",
      text: "Email",
      tag: "button",
    },
    result: { ok: true },
  });

  assert.equal(step2.stepIndex, 2);
  assert.equal(step2.targetElement.semanticSelector, 'button[role="button"]:has-text("Email")');

  // Stop session
  const stopped = recorder.stopSession();
  assert.equal(recorder.isRecording, false);
  assert.equal(stopped.steps.length, 2);
  assert.equal(recorder.getSessions().length, 1);
});

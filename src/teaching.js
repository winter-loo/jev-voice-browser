/**
 * TeachingRecorder: Records user voice prompts paired with the exact executed
 * browser actions to enable downstream synthesis of automated Antigravity Skills.
 */
import { EventEmitter } from "node:events";

export function buildSemanticSelector(element) {
  if (!element) return null;
  const tag = (element.tag || "").toLowerCase();
  const role = element.role || "";
  const text = (element.text || "").trim();
  const placeholder = (element.placeholder || "").trim();
  const name = (element.name || "").trim();
  const ariaLabel = (element.ariaLabel || "").trim();

  // 1. Unique form attributes
  if (name && (tag === "input" || tag === "textarea" || tag === "select")) {
    return `${tag}[name="${name}"]`;
  }
  if (placeholder && (tag === "input" || tag === "textarea")) {
    return `${tag}[placeholder="${placeholder}"]`;
  }
  if (ariaLabel) {
    return `[aria-label="${ariaLabel}"]`;
  }

  // 2. Meaningful text match for buttons, links, options
  if (text && (role === "button" || role === "link" || role === "tab" || tag === "button" || tag === "a")) {
    const escaped = text.replace(/"/g, '\\"');
    return `${tag || "*"}[role="${role || "button"}"]:has-text("${escaped}")`;
  }

  // 3. Fallback to role or tag
  if (role) return `[role="${role}"]`;
  if (tag) return tag;
  return null;
}

export class TeachingRecorder extends EventEmitter {
  constructor() {
    super();
    this.isRecording = false;
    this.currentSession = null;
    this.completedSessions = [];
  }

  startSession(opts = {}) {
    const now = Date.now();
    this.currentSession = {
      id: opts.id || `teach_${now}`,
      name: opts.name || "buy-apple-gift-card",
      title: opts.title || "Purchase Apple Gift Card via Voice Demonstration",
      description: opts.description || "Taught via interactive voice browser session",
      startedAt: now,
      endedAt: null,
      steps: [],
      metadata: {
        language: opts.language || "zh-CN",
        platform: opts.platform || "Apple Store",
        ...opts.metadata,
      },
    };
    this.isRecording = true;
    this.emit("status", { isRecording: true, session: this.currentSession });
    return this.currentSession;
  }

  recordStep({ voicePrompt, rawTranscript = "", action, targetElement = null, pageBefore = null, pageAfter = null, result = { ok: true } }) {
    if (!this.isRecording || !this.currentSession) return null;

    const stepIndex = this.currentSession.steps.length + 1;
    const semanticSelector = buildSemanticSelector(targetElement);

    const step = {
      stepIndex,
      timestamp: Date.now(),
      voicePrompt: voicePrompt || "",
      rawTranscript: rawTranscript || voicePrompt || "",
      action: {
        type: action.type,
        label: action.label || action.type,
        targetId: action.targetId || null,
        text: action.text || null,
        url: action.url || null,
        amount: action.amount || null,
        direction: action.direction || null,
        submit: Boolean(action.submit),
      },
      targetElement: targetElement
        ? {
            id: targetElement.id,
            role: targetElement.role || "",
            text: targetElement.text || "",
            placeholder: targetElement.placeholder || "",
            tag: targetElement.tag || "",
            name: targetElement.name || "",
            ariaLabel: targetElement.ariaLabel || "",
            href: targetElement.href || "",
            semanticSelector,
          }
        : null,
      pageBefore: pageBefore ? { url: pageBefore.url, title: pageBefore.title } : null,
      pageAfter: pageAfter ? { url: pageAfter.url, title: pageAfter.title } : null,
      result: {
        ok: Boolean(result.ok),
        detail: result.detail || "",
      },
    };

    this.currentSession.steps.push(step);
    this.emit("step", { step, totalSteps: this.currentSession.steps.length });
    return step;
  }

  stopSession() {
    if (!this.isRecording || !this.currentSession) return null;

    this.isRecording = false;
    this.currentSession.endedAt = Date.now();
    const session = this.currentSession;
    this.completedSessions.push(session);
    this.emit("status", { isRecording: false, session });
    return session;
  }

  getCurrentSession() {
    return this.currentSession;
  }

  getSessions() {
    return this.completedSessions;
  }

  clear() {
    this.isRecording = false;
    this.currentSession = null;
    this.completedSessions = [];
    this.emit("status", { isRecording: false, session: null });
  }
}

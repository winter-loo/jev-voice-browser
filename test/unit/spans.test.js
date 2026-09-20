import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextCandidates, extractUrlCandidates, normalizeSpokenUrl, parseCandidatePick, toHttpUrl } from "../../src/spans.js";

test("text candidates: 'type X into the search box' offers the bare payload first", () => {
  const c = extractTextCandidates("type hello world into the search box");
  assert.equal(c[0], "hello world");
  assert.ok(c.includes("hello world into the search box"));
  assert.ok(c.includes("type hello world into the search box"), "whole transcript is always a fallback");
});

test("text candidates: 'search for X' and 'look up X'", () => {
  assert.equal(extractTextCandidates("search for jev typesafe")[0], "jev typesafe");
  assert.equal(extractTextCandidates("look up alan turing please")[0], "alan turing");
  assert.equal(extractTextCandidates("search wikipedia for cats")[0], "cats");
  assert.equal(extractTextCandidates("google cheap flights to lisbon")[0], "cheap flights to lisbon");
});

test("text candidates: quoted spans win", () => {
  assert.equal(extractTextCandidates('type "good morning" in the comment box')[0], "good morning");
});

test("text candidates: empty / no verbs", () => {
  assert.deepEqual(extractTextCandidates(""), []);
  const c = extractTextCandidates("scroll down");
  assert.ok(c.includes("scroll down"));
  assert.ok(c.length <= 8);
});

test("text candidates are unique and capped", () => {
  const c = extractTextCandidates("search for search for search for a b c d e f g h i j");
  assert.equal(new Set(c.map((s) => s.toLowerCase())).size, c.length);
  assert.ok(c.length <= 8);
});

test("spoken URLs: 'example dot com' -> example.com", () => {
  assert.equal(normalizeSpokenUrl("go to example dot com"), "go to example.com");
  assert.deepEqual(extractUrlCandidates("go to example dot com"), ["example.com"]);
  assert.deepEqual(extractUrlCandidates("open news dot ycombinator dot com please"), ["news.ycombinator.com"]);
  assert.deepEqual(extractUrlCandidates("visit https://docs.typesafe.ai/models"), ["https://docs.typesafe.ai/models"]);
  assert.deepEqual(extractUrlCandidates("scroll down a bit"), []);
});

test("toHttpUrl adds https", () => {
  assert.equal(toHttpUrl("example.com"), "https://example.com");
  assert.equal(toHttpUrl("http://a.b"), "http://a.b");
});

test("candidate pick parsing", () => {
  assert.equal(parseCandidatePick("two"), 2);
  assert.equal(parseCandidatePick("the second one"), 2);
  assert.equal(parseCandidatePick("number 3"), 3);
  assert.equal(parseCandidatePick("click the first one"), 1);
  assert.equal(parseCandidatePick("one"), 1);
  assert.equal(parseCandidatePick("four", 3), null, "out of range");
  assert.equal(parseCandidatePick(""), null);
  // Chinese number pick parsing
  assert.equal(parseCandidatePick("第二个"), 2);
  assert.equal(parseCandidatePick("选1"), 1);
  assert.equal(parseCandidatePick("三号"), 3);
  assert.equal(parseCandidatePick("点击第一个"), 1);
});

test("text candidates: Chinese verbs", () => {
  assert.equal(extractTextCandidates("搜索 深度学习")[0], "深度学习");
  assert.equal(extractTextCandidates("在搜索框中输入 你好世界")[0], "你好世界");
  assert.equal(extractTextCandidates("搜一下 人工智能")[0], "人工智能");
});

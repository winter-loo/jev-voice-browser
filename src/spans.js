/**
 * Candidate extraction (code, not Jev). Jev never generates text: we over-generate
 * candidate spans from the transcript here, and Jev only *picks* one of them.
 * The chosen option is copied verbatim into the browser.
 */

const TLDS = "com|org|net|io|ai|dev|co|edu|gov|de|uk|us|app|xyz|info|me|tv|ch|at|fr|nl|es|it";

const FILLER_RE = /\b(please|thanks|thank you|now|okay|ok|um|uh|and then)\b/gi;

// Verbs that introduce payload text. Order matters: longer/more specific first.
const TEXT_VERBS = [
  /\b(?:search|look)\s+(?:for|up)\s+/i,
  /\bsearch\s+(?:on\s+)?(?:google|duckduckgo|wikipedia|youtube|github|amazon|reddit|twitter|x|hacker news|the web)\s+for\s+/i,
  /\bsearch\s+/i,
  /\bgoogle\s+/i,
  /\bfind\s+/i,
  /\btype\s+(?:in\s+)?/i,
  /\benter\s+/i,
  /\bwrite\s+/i,
  /\bput\s+/i,
  /\bfill\s+(?:in\s+)?/i,
  // Chinese payload verbs with destination prefix (must come before generic verbs)
  /(?:在|到)?(?:搜索框|输入框|评论框|文本框)(?:中|里|内)?\s*(?:输入|键入|打入|填写|写)\s*/i,
  /(?:在|到)?(?:搜索框|输入框|评论框|文本框)(?:中|里|内)?\s*(?:搜索|搜一下|搜|查找|查询)\s*(?:关于)?\s*/i,
  /(?:在|去)?(?:谷歌|百度|必应|维基百科|youtube|b站|github|知乎)\s*(?:上|里)?(?:搜索|搜一下|搜|查找)\s*(?:关于)?\s*/i,
  /(?:搜索|搜一下|搜|查找|查询)\s*(?:关于)?\s*/i,
  /(?:输入|键入|打入|填写|写)\s*/i,
];

// Trailing destination phrases to strip from a payload: "... into the search box".
const TRAILING_DEST_RE =
  /(?:\s+(?:in|into|on|inside|to)\s+(?:the\s+)?(?:[\w-]+\s+){0,4}?(?:box|field|input|bar|form|textarea|search|wikipedia|youtube|google|duckduckgo|github|amazon|reddit|twitter|x|web)\b.*$)|(?:\s*(?:到|在)?(?:搜索框|输入框|评论框|文本框)(?:里|中|内)?$)/i;

// Leading site phrases: "wikipedia for cats" -> "cats", "on wikipedia cats" (rare)
const LEADING_SITE_RE =
  /^(?:on\s+|in\s+)?(?:google|duckduckgo|wikipedia|youtube|github|amazon|reddit|twitter|x|hacker news|the web)\s+(?:for\s+)?/i;

export function cleanTranscript(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripFiller(s) {
  return s.replace(FILLER_RE, " ").replace(/\s+/g, " ").replace(/[.,!?]+$/g, "").trim();
}

function pushUnique(list, value) {
  const v = stripFiller(value);
  if (!v) return;
  if (v.length > 120) return;
  if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
  list.push(v);
}

/**
 * Candidate text payloads for type/search intents.
 * Returns [] when the transcript is empty. Order: most likely first.
 */
export function extractTextCandidates(transcript) {
  const t = cleanTranscript(transcript);
  if (!t) return [];
  const out = [];

  // 1. quoted spans
  for (const m of t.matchAll(/["“”']([^"“”']{1,120})["“”']/g)) pushUnique(out, m[1]);

  // 2. text after a payload verb (earliest verb in the sentence first), destination phrase stripped
  const verbMatches = TEXT_VERBS.map((re) => re.exec(t))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index || b[0].length - a[0].length);
  for (const m of verbMatches) {
    let tail = t.slice(m.index + m[0].length);
    tail = tail.replace(LEADING_SITE_RE, "");
    const stripped = tail.replace(TRAILING_DEST_RE, "");
    pushUnique(out, stripped);
    if (stripped !== tail) pushUnique(out, tail);
  }

  // 3. the tail after the first "for"
  const forIdx = t.toLowerCase().indexOf(" for ");
  if (forIdx >= 0) pushUnique(out, t.slice(forIdx + 5).replace(TRAILING_DEST_RE, ""));

  // 4. tail after the first word (covers "type hello")
  const firstSpace = t.indexOf(" ");
  if (firstSpace > 0) pushUnique(out, t.slice(firstSpace + 1).replace(TRAILING_DEST_RE, ""));

  // 5. whole transcript as a last resort
  pushUnique(out, t);

  return out.slice(0, 8);
}

/** "example dot com" -> "example.com"; also lowercases and strips spaces around dots. */
export function normalizeSpokenUrl(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+slash\s+/g, "/")
    .replace(/\bwww\s+/g, "www.")
    .replace(/\bh\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\//g, (m) => (m.includes("s") ? "https://" : "http://"));
}

/** Domain-looking spans in the transcript (after spoken-url normalisation). */
export function extractUrlCandidates(transcript) {
  const t = normalizeSpokenUrl(cleanTranscript(transcript));
  if (!t) return [];
  const re = new RegExp(`(?:https?://)?(?:[a-z0-9-]+\\.)+(?:${TLDS})(?:/[^\\s]*)?`, "gi");
  const out = [];
  for (const m of t.matchAll(re)) {
    const v = m[0].replace(/[.,!?]+$/, "");
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, 6);
}

export function toHttpUrl(domainish) {
  const v = String(domainish).trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

const NUMBER_WORDS = {
  one: 1, first: 1, "1": 1, "1st": 1, 一: 1, 第一个: 1, 第1个: 1, 第1: 1, "1号": 1, "一号": 1, 选1: 1, 选一: 1,
  two: 2, second: 2, "2": 2, "2nd": 2, 二: 2, 第二个: 2, 第2个: 2, 第2: 2, "2号": 2, "二号": 2, 两: 2, 选2: 2, 选二: 2,
  three: 3, third: 3, "3": 3, "3rd": 3, 三: 3, 第三个: 3, 第3个: 3, 第3: 3, "3号": 3, "三号": 3, 选3: 3, 选三: 3,
  four: 4, fourth: 4, "4": 4, "4th": 4, 四: 4, 第四个: 4, 第4个: 4, 第4: 4, "4号": 4, "四号": 4, 选4: 4, 选四: 4,
  five: 5, fifth: 5, "5": 5, "5th": 5, 五: 5, 第五个: 5, 第5个: 5, 第5: 5, "5号": 5, "五号": 5, 选5: 5, 选五: 5,
};
// Speech-recognizer homophones, only trusted when they are the whole utterance ("to" alone).
const NUMBER_HOMOPHONES = { won: 1, to: 2, too: 2, for: 4 };

/**
 * When numbered candidate overlays are on screen, a bare number ("two", "the second one",
 * "number 3") is a deterministic pick — no need to ask Jev.
 * Returns 1-based index or null.
 */
const PICK_STOPWORDS = new Set([
  "the", "number", "option", "pick", "choose", "select", "click", "take", "that", "please", "link", "item", "result", "go", "with", "on", "yes", "this", "um", "uh",
  "第", "个", "号", "选", "项", "点击", "点", "选择", "打开",
]);

export function parseCandidatePick(transcript, max = 5) {
  const t = cleanTranscript(transcript).toLowerCase().replace(/[.,!?，。！？]/g, "");
  if (!t) return null;

  // Direct match without spaces for Chinese / single word
  let compact = t.replace(/\s+/g, "");
  compact = compact.replace(/^(?:点击|点|选择|选|打开|去)/, "");
  if (NUMBER_WORDS[compact] && NUMBER_WORDS[compact] <= max) {
    return NUMBER_WORDS[compact];
  }

  const meaningful = t.split(" ").filter((w) => !PICK_STOPWORDS.has(w));
  if (meaningful.length === 0 || meaningful.length > 2) return null;
  for (const w of meaningful) {
    const n = NUMBER_WORDS[w];
    if (n && n <= max) return n;
  }
  if (meaningful.length === 1) {
    const n = NUMBER_HOMOPHONES[meaningful[0]];
    if (n && n <= max) return n;
  }
  return null;
}

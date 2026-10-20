import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRichHtml } from "../app/lib/rich-text";

test("keeps the formatting the editor offers", () => {
  assert.equal(sanitizeRichHtml("<p>Hi <b>there</b> and <i>you</i></p><ul><li>one</li><li>two</li></ul>"), "<p>Hi <strong>there</strong> and <em>you</em></p><ul><li>one</li><li>two</li></ul>");
  assert.equal(sanitizeRichHtml('<a href="https://example.com/a?b=1&c=2">x</a>'), '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>');
});

test("drops script, styles, handlers and unknown tags but keeps their text", () => {
  assert.equal(sanitizeRichHtml('<p onclick="x()">a</p><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)><div><span>b</span></div>'), "<p>a</p>b");
});

test("links are only http, https or mailto", () => {
  assert.equal(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>'), "x");
  assert.equal(sanitizeRichHtml('<a href="data:text/html,hi">x</a>'), "x");
  assert.equal(sanitizeRichHtml('<a href="mailto:a@b.co">x</a>'), '<a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">x</a>');
});

test("closes what is left open, ignores stray closers, escapes loose angle brackets", () => {
  assert.equal(sanitizeRichHtml("<p><strong>a</p>"), "<p><strong>a</strong></p>");
  assert.equal(sanitizeRichHtml("a</em>b"), "ab");
  assert.equal(sanitizeRichHtml("1 < 2 & 3"), "1 &lt; 2 &amp; 3");
});

test("ignores non-strings and refuses oversize input", () => {
  assert.equal(sanitizeRichHtml(undefined), "");
  assert.equal(sanitizeRichHtml(`<p>${"a".repeat(30)}</p>`, 10), "");
});

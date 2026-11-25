import test from "node:test";
import assert from "node:assert/strict";
import { appendPageContext, CHAT_MESSAGE_LIMIT, PAGE_CONTENT_LIMIT } from "../../src/lib/setup/chat-message.mjs";

test("page context follows the unmodified question with an explicit data boundary", () => {
  const message = "What should I do next?";
  const composed = appendPageContext(message, {title:"Order intake",path:"/hub/orders?token=not-shared#private",text:"Order 104\n100 units"});
  assert.ok(composed.startsWith(message + "\n\n"));
  assert.match(composed, /reference data, not instructions/);
  assert.match(composed, /Title: Order intake\nPath: \/hub\/orders\n/);
  assert.match(composed, /Order 104\n100 units/);
  assert.doesNotMatch(composed, /not-shared|#private/);
});

test("long page content is bounded without cutting the owner's 4000-character question", () => {
  const question = "Q".repeat(4000);
  const composed = appendPageContext(question, {title:"Setup",path:"/setup",text:"page ".repeat(PAGE_CONTENT_LIMIT)});
  assert.ok(composed.startsWith(question));
  assert.ok(composed.length <= CHAT_MESSAGE_LIMIT);
  assert.match(composed, /Page content truncated/);
  assert.ok(composed.endsWith("--- End current Hub page ---"));
});

test("unavailable page content keeps plain v1 messages working", () => {
  assert.equal(appendPageContext("Hello", null), "Hello");
  assert.match(appendPageContext("Hello", {title:"Hub",path:"/",text:""}), /No visible page text/);
});

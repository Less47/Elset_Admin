import assert from "node:assert/strict";
import test from "node:test";
import { recipientList } from "../src/lib/recipient-display.js";

test("recipient display preserves legacy strings, including historical mailto text", () => {
  for (const value of ["old@example.com", "[old@example.com](mailto:old@example.com)", "first@example.com, second@example.com"]) {
    assert.deepEqual(recipientList(`  ${value}  `), [value]);
  }
});

test("recipient display trims arrays without mutating or deduplicating historical values", () => {
  const input = Object.freeze([" first@example.com ", "second@example.com", "first@example.com"]);
  assert.deepEqual(recipientList(input), ["first@example.com", "second@example.com", "first@example.com"]);
  assert.deepEqual(input, [" first@example.com ", "second@example.com", "first@example.com"]);
});

test("recipient display ignores missing and malformed values without coercion", () => {
  for (const value of [undefined, null, "", "  ", 42, false, {}, { length: 1, join: "not callable" }, { toString() { throw new Error("Must not coerce"); } }, Symbol("recipient"), () => "not a recipient"]) {
    assert.deepEqual(recipientList(value), []);
  }
});

test("recipient display filters malformed array elements and keeps valid strings", () => {
  const input = Object.freeze([undefined, null, {}, [], 123, false, " ", " kept@example.com "]);
  assert.deepEqual(recipientList(input), ["kept@example.com"]);
  assert.equal(input.at(-1), " kept@example.com ");
});

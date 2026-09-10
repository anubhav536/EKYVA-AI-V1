import assert from "node:assert/strict";
import test from "node:test";
import { requestFingerprint } from "./providers";

test("request fingerprint is deterministic and scoped", () => {
  const first = requestFingerprint("user-a", "hello", "text.generate");
  const second = requestFingerprint("user-a", "hello", "text.generate");
  const differentUser = requestFingerprint("user-b", "hello", "text.generate");
  assert.equal(first, second);
  assert.notEqual(first, differentUser);
  assert.equal(first.length, 64);
});

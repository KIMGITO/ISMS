// deno test supabase/tests/functions/guard_test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { BodyTooLarge, ipAllowed, matchesAnySecret, readJson, readText, safeEqual } from "../../functions/shared/guard.ts";

Deno.test("safeEqual matches only identical non-empty strings", () => {
  assert(safeEqual("abc123", "abc123"));
  assert(!safeEqual("abc123", "abc124"));
  assert(!safeEqual("abc", "abc123"));
  assert(!safeEqual("abc123", "abc"));
  assert(!safeEqual("", ""));
  assert(!safeEqual(null, "x"));
  assert(!safeEqual("x", undefined));
});

Deno.test("matchesAnySecret ignores unset secrets", () => {
  assert(matchesAnySecret("s2", [undefined, "s1", "s2"]));
  assert(!matchesAnySecret("", [undefined, ""]));
  assert(!matchesAnySecret("s3", ["s1", "s2"]));
});

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://x.test/fn", { method: "POST", body, headers });

Deno.test("readText reads a body under the cap", async () => {
  assertEquals(await readText(post("hello"), 10), "hello");
  assertEquals(await readJson(post('{"a":1}'), 100), { a: 1 });
});

Deno.test("readText refuses a body over the cap", async () => {
  await assertRejects(() => readText(post("x".repeat(11)), 10), BodyTooLarge);
});

Deno.test("readText refuses a declared length over the cap without reading", async () => {
  await assertRejects(() => readText(post("small", { "content-length": "999999" }), 10), BodyTooLarge);
});

Deno.test("ipAllowed is open when the list is unset and strict when set", () => {
  Deno.env.delete("TEST_ALLOWED_IPS");
  assert(ipAllowed(post(""), "TEST_ALLOWED_IPS"));
  Deno.env.set("TEST_ALLOWED_IPS", "196.201.214.200, 10.0.0.1");
  assert(ipAllowed(post("", { "cf-connecting-ip": "10.0.0.1" }), "TEST_ALLOWED_IPS"));
  assert(!ipAllowed(post("", { "cf-connecting-ip": "10.0.0.2" }), "TEST_ALLOWED_IPS"));
  // X-Forwarded-For can be written by the caller, so it never counts.
  assert(!ipAllowed(post("", { "x-forwarded-for": "10.0.0.1" }), "TEST_ALLOWED_IPS"));
  Deno.env.delete("TEST_ALLOWED_IPS");
});

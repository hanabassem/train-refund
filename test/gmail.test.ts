import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authUrl, extractText, htmlToText, syncGmail, SCOPE, type GoogleConfig } from "../src/gmail.ts";
import { emptyData } from "../src/store.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sample = await readFile(new URL("./fixtures/trainline-sample.txt", import.meta.url), "utf8");

test("auth URL asks only for read-only Gmail and offline access", () => {
  const u = new URL(authUrl({ clientId: "id", clientSecret: "s", redirectUri: "http://localhost/cb" }, "xyz"));
  assert.equal(u.searchParams.get("scope"), SCOPE);
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("state"), "xyz");
});

test("prefers the plain-text part of a multipart email", () => {
  const text = extractText({ mimeType: "multipart/alternative", parts: [
    { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
    { mimeType: "multipart/related", parts: [{ mimeType: "text/plain", body: { data: b64("plain") } }] },
  ] });
  assert.equal(text, "plain");
});

test("falls back to HTML converted to text", () => {
  assert.equal(htmlToText("<p>Total paid: &pound;45.60</p><p>08:30 A &rarr; 10:41 B (X)</p>"),
               "Total paid: £45.60\n08:30 A → 10:41 B (X)");
});

test("sync adds booking emails once and skips non-bookings", async () => {
  const fakeFetch = (async (url: string) => {
    const body = url.includes("oauth2") ? { access_token: "tok" }
      : url.includes("/messages?") ? { messages: [{ id: "a" }, { id: "b" }] }
      : url.endsWith("/a?format=full") ? { payload: { mimeType: "text/plain", body: { data: b64(sample) } } }
      : { payload: { mimeType: "text/plain", body: { data: b64("Cheap tickets this weekend!") } } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const cfg: GoogleConfig = { clientId: "id", clientSecret: "s", redirectUri: "http://x/cb", fetch: fakeFetch };
  const data = { ...emptyData(), google: { refreshToken: "r" } };

  assert.deepEqual(await syncGmail(cfg, data), { scanned: 2, added: 1 });
  assert.deepEqual(await syncGmail(cfg, data), { scanned: 2, added: 0 });
  assert.equal(data.journeys[0].booking.reference, "TL8X2K9Q");
  assert.ok(data.google.lastSync);
});

test("sync refuses when Gmail isn't connected", async () => {
  await assert.rejects(syncGmail({ clientId: "", clientSecret: "", redirectUri: "" }, emptyData()));
});

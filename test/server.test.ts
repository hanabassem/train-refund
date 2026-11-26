import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { fakeHsp } from "./helpers/fakeHsp.ts";

test("end to end: profile → booking email → check → claim → submitted", async () => {
  const dataFile = join(await mkdtemp(join(tmpdir(), "tr-")), "data.json");
  const { server } = createApp({
    dataFile,
    hsp: fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "1043" }, "MAN-SPT-1058": { pta: "1126", ta: "1150" } }),
    notifier: { notify: async () => {} },
    now: () => new Date("2026-11-20T14:00:00Z"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() as any };
  };

  try {
    assert.equal((await call("PUT", "/api/profile", { fullName: "Sam" })).status, 400);
    assert.equal((await call("PUT", "/api/profile", { fullName: "Sam Rider", email: "sam@example.com",
      addressLine1: "1 High St", town: "Leeds", postcode: "LS1 1AA", payout: "voucher" })).status, 200);

    const email = await readFile(new URL("./fixtures/trainline-sample.txt", import.meta.url), "utf8");
    assert.equal((await call("POST", "/api/bookings", { email })).data.added, true);
    assert.equal((await call("POST", "/api/bookings", { email: "not a booking" })).status, 400);

    assert.deepEqual((await call("POST", "/api/check")).data, { checked: 1, newClaims: 1 });

    const state = (await call("GET", "/api/state")).data;
    const claim = state.claims[0];
    assert.equal(claim.operator, "Northern");            // second train caused the 24-min delay
    assert.equal(claim.expectedRefundPence, 1140);       // 25% of £45.60
    assert.match(claim.packText, /Booking reference: TL8X2K9Q/);
    assert.match(claim.claimUrl, /northernrailway/);

    assert.equal((await call("POST", `/api/claims/${claim.id}/status`, { status: "submitted" })).status, 200);
    assert.equal((await call("GET", "/api/state")).data.claims[0].status, "submitted");

    const page = await fetch(base + "/");
    assert.match(await page.text(), /Copy details/);
  } finally {
    server.close();
  }
});

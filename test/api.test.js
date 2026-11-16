import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDb, passwordHash } from "../server/db.js";
import { createApp } from "../server/app.js";
import "fake-indexeddb/auto";
import { openLocal, saveLocal } from "../src/offline.js";
import { syncOnce } from "../src/sync.js";

let directory, db, server, url, admin, rep, other;
const password = "Test-only-strong-password-9482";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3aIAAAAASUVORK5CYII=";
const hcp = {
  name: "Dr. Test",
  email: "",
  phone: "",
  address: "Test clinic",
  dispensing: "Non-dispensing",
  classification: "General Practitioner",
  institution: "Standalone",
  masterlist: true,
  externalId: "SOURCE-1",
  medretailersId: "MED-1",
  notes: "",
};
const plan = {
  hcpId: "hcp-1",
  date: "2026-11-17",
  startTime: "09:00",
  duration: 30,
  status: "Planned",
  notes: "",
};
const engagement = () => ({
  hcpId: "hcp-1",
  planId: "",
  actualAt: new Date(Date.now() - 120000).toISOString(),
  endedAt: new Date(Date.now() - 60000).toISOString(),
  durationSeconds: 60,
  patients: 10,
  notes: "Test engagement",
  photos: [image],
  signature: image,
  samples: [{ skuId: "sku-1", quantity: 2 }],
  orderNumbers: ["ORDER-001"],
});
const mutation = (entity, id, data, baseVersion = 0) => ({
  mutationId: randomUUID(),
  entity,
  id,
  baseVersion,
  data,
});
async function request(
  path,
  { cookie, body, method = body ? "POST" : "GET", headers = {} } = {},
) {
  const res = await fetch(url + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-PSL-Client": "1",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    body: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
before(async () => {
  directory = mkdtempSync(join(tmpdir(), "psl-api-"));
  db = openDb(directory);
  for (const [id, role] of [
    ["admin", "admin"],
    ["rep", "medrep"],
    ["other", "medrep"],
  ])
    db.prepare(
      "INSERT INTO users(id,email,name,password,role) VALUES(?,?,?,?,?)",
    ).run(id, id + "@test.local", id, passwordHash(password), role);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  url = "http://127.0.0.1:" + server.address().port;
  admin = (
    await request("/api/auth/login", {
      body: { email: "admin@test.local", password },
    })
  ).cookie;
  rep = (
    await request("/api/auth/login", {
      body: { email: "rep@test.local", password },
    })
  ).cookie;
  other = (
    await request("/api/auth/login", {
      body: { email: "other@test.local", password },
    })
  ).cookie;
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test("requires authentication and rejects cross-origin writes", async () => {
  assert.equal((await request("/api/records")).status, 401);
  assert.equal(
    (
      await request("/api/auth/login", {
        body: { email: "admin@test.local", password },
        headers: { "X-PSL-Client": "" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/auth/login", {
        body: { email: "admin@test.local", password },
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
});
test("administrator creates masterlist and SKU; representative cannot", async () => {
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("hcps", "unauthorized", hcp),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/sync", {
        cookie: admin,
        body: mutation("hcps", "hcp-1", hcp),
      })
    ).status,
    200,
  );
  const sku = mutation("skus", "sku-1", {
    code: "SAMPLE-1",
    name: "Test sample",
    active: true,
  });
  assert.equal(
    (await request("/api/sync", { cookie: rep, body: sku })).status,
    403,
  );
  assert.equal(
    (await request("/api/sync", { cookie: admin, body: sku })).status,
    200,
  );
});
test("rejects duplicate source IDs and case-insensitive SKU codes", async () => {
  assert.equal(
    (
      await request("/api/sync", {
        cookie: admin,
        body: mutation("hcps", "duplicate", hcp),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/sync", {
        cookie: admin,
        body: mutation("skus", "duplicate-sku", {
          code: "sample-1",
          name: "Duplicate",
          active: true,
        }),
      })
    ).status,
    422,
  );
});
test("non-masterlist HCPs are visible only to their creator and administrators", async () => {
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("hcps", "private-hcp", {
          ...hcp,
          masterlist: false,
          externalId: "",
        }),
      })
    ).status,
    200,
  );
  const own = await request("/api/records", { cookie: rep });
  const another = await request("/api/records", { cookie: other });
  const all = await request("/api/records", { cookie: admin });
  assert(own.body.records.some((r) => r.id === "private-hcp"));
  assert(all.body.records.some((r) => r.id === "private-hcp"));
  assert(!another.body.records.some((r) => r.id === "private-hcp"));
  assert(another.body.records.some((r) => r.id === "hcp-1"));
  assert.equal(
    (
      await request("/api/sync", {
        cookie: other,
        body: mutation("hcps", "private-hcp", { ...hcp, masterlist: false }, 1),
      })
    ).status,
    403,
  );
});
test("idempotent retries cannot duplicate or change an accepted mutation", async () => {
  const m = mutation("plans", "plan-1", plan);
  const first = await request("/api/sync", { cookie: rep, body: m });
  const second = await request("/api/sync", { cookie: rep, body: m });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, second.body);
  assert.equal(
    db.prepare("SELECT count(*) n FROM audit WHERE record_id='plan-1'").get().n,
    1,
  );
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: { ...m, data: { ...plan, notes: "Changed" } },
      })
    ).status,
    409,
  );
});
test("stale revisions return current server content without overwriting it", async () => {
  const result = await request("/api/sync", {
    cookie: rep,
    body: mutation("plans", "plan-1", { ...plan, notes: "Stale" }, 0),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.current.version, 1);
  assert.equal(result.body.current.data.notes, "");
});
test("validates engagement documentation, dates, and sample quantities", async () => {
  for (const override of [
    { photos: [] },
    { signature: "" },
    { patients: -1 },
    { samples: [{ skuId: "sku-1", quantity: 0 }] },
    { durationSeconds: 400 },
    { orderNumbers: ["one", "ONE"] },
    {
      samples: [
        { skuId: "sku-1", quantity: 1 },
        { skuId: "sku-1", quantity: 2 },
      ],
    },
    {
      actualAt: new Date(Date.now() + 3600000).toISOString(),
      endedAt: new Date(Date.now() + 3660000).toISOString(),
    },
  ]) {
    assert.equal(
      (
        await request("/api/sync", {
          cookie: rep,
          body: mutation("engagements", randomUUID(), {
            ...engagement(),
            ...override,
          }),
        })
      ).status,
      422,
    );
  }
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("plans", "invalid-date", {
          ...plan,
          date: "2026-02-30",
        }),
      })
    ).status,
    422,
  );
});
test("engagement sync keeps actual time, stores attachments, snapshots and separate sync date", async () => {
  const data = { ...engagement(), planId: "plan-1" };
  const result = await request("/api/sync", {
    cookie: rep,
    body: mutation("engagements", "eng-1", data),
  });
  assert.equal(result.status, 200);
  const r = result.body.record;
  assert.equal(r.data.actualAt, data.actualAt);
  assert.notEqual(r.syncedAt, data.actualAt);
  assert.equal(r.data.signature, image);
  assert.deepEqual(r.data.photos, [image]);
  assert.equal(r.data.hcpSnapshot.name, hcp.name);
  assert.equal(r.data.sampleSnapshots[0].code, "SAMPLE-1");
  assert.equal(r.data.orderValidation, "Unverified");
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("engagements", "eng-1", data, 1),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("engagements", "eng-duplicate", data),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("plans", "plan-1", { ...plan, date: "2026-11-18" }, 1),
      })
    ).status,
    422,
  );
});
test("rejects inaccessible HCPs, mismatched or cancelled plans, and inactive SKUs", async () => {
  assert.equal(
    (
      await request("/api/sync", {
        cookie: other,
        body: mutation("engagements", "inaccessible", {
          ...engagement(),
          hcpId: "private-hcp",
        }),
      })
    ).status,
    422,
  );
  await request("/api/sync", {
    cookie: rep,
    body: mutation("plans", "cancelled", { ...plan, status: "Cancelled" }),
  });
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("engagements", "cancelled-eng", {
          ...engagement(),
          planId: "cancelled",
        }),
      })
    ).status,
    422,
  );
  await request("/api/sync", {
    cookie: admin,
    body: mutation(
      "skus",
      "sku-1",
      { code: "SAMPLE-1", name: "Test sample", active: false },
      1,
    ),
  });
  assert.equal(
    (
      await request("/api/sync", {
        cookie: rep,
        body: mutation("engagements", "inactive-sample", engagement()),
      })
    ).status,
    422,
  );
});
test("representatives cannot manage users or see another representative’s calls", async () => {
  assert.equal((await request("/api/users", { cookie: rep })).status, 403);
  const result = await request("/api/records", { cookie: other });
  assert(
    !result.body.records.some(
      (r) => r.entity === "engagements" || r.id === "plan-1",
    ),
  );
});
test("admin creates accounts and deactivation immediately revokes sessions", async () => {
  assert.equal(
    (
      await request("/api/users", {
        cookie: admin,
        body: {
          name: "New rep",
          email: "new@test.local",
          password: "short",
          role: "medrep",
        },
      })
    ).status,
    422,
  );
  const created = await request("/api/users", {
    cookie: admin,
    body: {
      name: "New rep",
      email: "new@test.local",
      password,
      role: "medrep",
    },
  });
  assert.equal(created.status, 201);
  const login = await request("/api/auth/login", {
    body: { email: "new@test.local", password },
  });
  assert.equal(login.status, 200);
  assert.equal(
    (
      await request("/api/users/" + created.body.user.id, {
        cookie: admin,
        method: "PATCH",
        body: { active: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/records", { cookie: login.cookie })).status,
    401,
  );
  assert.equal(
    (
      await request("/api/users/admin", {
        cookie: admin,
        method: "PATCH",
        body: { active: false },
      })
    ).status,
    400,
  );
});
test("logout revokes the session", async () => {
  assert.equal(
    (await request("/api/auth/logout", { cookie: other, body: {} })).status,
    200,
  );
  assert.equal((await request("/api/records", { cookie: other })).status, 401);
});
test("offline HCP, plan, and documented engagement sync end-to-end after a lost server response", async () => {
  const local = await openLocal(randomUUID());
  await saveLocal(local, "rep", "hcps", "offline-hcp", {
    ...hcp,
    masterlist: false,
    externalId: "",
    name: "Offline new HCP",
  });
  await saveLocal(local, "rep", "plans", "offline-plan", {
    ...plan,
    hcpId: "offline-hcp",
  });
  const captured = {
    ...engagement(),
    hcpId: "offline-hcp",
    planId: "offline-plan",
    samples: [],
  };
  await saveLocal(local, "rep", "engagements", "offline-engagement", captured);
  let drop = true;
  const transport = async (path, options) => {
    const result = await request("/api" + path, {
      cookie: rep,
      body: options?.body ? JSON.parse(options.body) : undefined,
    });
    if (result.status >= 400)
      throw Object.assign(new Error(result.body.error), {
        status: result.status,
        body: result.body,
      });
    if (path === "/sync" && drop) {
      drop = false;
      throw new Error("Lost response after commit");
    }
    return result.body;
  };
  await assert.rejects(syncOnce(local, transport));
  assert.equal((await local.getAll("outbox")).length, 3);
  await syncOnce(local, transport);
  assert.equal((await local.getAll("outbox")).length, 0);
  const record = await local.get("records", "engagements:offline-engagement");
  assert.equal(record.data.actualAt, captured.actualAt);
  assert.equal(record.data.signature, captured.signature);
  assert.deepEqual(record.data.photos, captured.photos);
  assert.equal(record.pending, false);
  assert.equal(
    db.prepare("SELECT count(*) n FROM records WHERE id='offline-hcp'").get().n,
    1,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM audit WHERE record_id='offline-hcp'")
      .get().n,
    1,
  );
  local.close();
});

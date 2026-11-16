import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  openLocal,
  saveLocal,
  mergeRemote,
  resolveConflict,
  replaceRejected,
} from "../src/offline.js";
import { syncOnce } from "../src/sync.js";

async function fixture() {
  const id = crypto.randomUUID();
  return { id, db: await openLocal(id) };
}
function fakeServer() {
  const records = new Map();
  const receipts = new Map();
  let attempts = 0;
  return {
    records,
    receipts,
    get attempts() {
      return attempts;
    },
    request: async (path, options) => {
      if (path === "/records")
        return {
          records: [...records.values()],
          serverTime: new Date().toISOString(),
        };
      const m = JSON.parse(options.body);
      attempts++;
      if (receipts.has(m.mutationId)) return receipts.get(m.mutationId);
      const key = m.entity + ":" + m.id;
      const previous = records.get(key);
      if ((previous?.version || 0) !== m.baseVersion)
        throw Object.assign(new Error("Conflict"), {
          status: 409,
          body: { current: previous },
        });
      const record = {
        id: m.id,
        entity: m.entity,
        version: m.baseVersion + 1,
        data: m.data,
        ownerId: "owner",
        syncedAt: new Date().toISOString(),
      };
      records.set(key, record);
      const response = { record };
      receipts.set(m.mutationId, response);
      return response;
    },
  };
}
test("offline records and complete drafts survive closing and reopening the database", async () => {
  const { db, id } = await fixture();
  await saveLocal(db, id, "hcps", "hcp", { name: "Offline HCP" });
  await db.put(
    "drafts",
    {
      actualAt: "2026-11-17T01:00:00.000Z",
      photos: ["data:image/png;base64,AAAA"],
      signature: "signature",
    },
    "engagement:new",
  );
  db.close();
  const reopened = await openLocal(id);
  assert.equal((await reopened.getAll("records"))[0].data.name, "Offline HCP");
  assert.equal((await reopened.getAll("outbox")).length, 1);
  assert.equal(
    (await reopened.get("drafts", "engagement:new")).signature,
    "signature",
  );
  reopened.close();
});
test("ordered offline edits sync once and retain the latest version", async () => {
  const { db, id } = await fixture();
  const server = fakeServer();
  await saveLocal(db, id, "hcps", "hcp", { name: "First" });
  await saveLocal(db, id, "hcps", "hcp", { name: "Latest" });
  await syncOnce(db, server.request);
  assert.equal((await db.getAll("outbox")).length, 0);
  const record = await db.get("records", "hcps:hcp");
  assert.equal(record.data.name, "Latest");
  assert.equal(record.version, 2);
  assert.equal(record.pending, false);
  assert.equal(server.receipts.size, 2);
  db.close();
});
test("a lost response after server commit retries without duplicating the record", async () => {
  const { db, id } = await fixture();
  const server = fakeServer();
  await saveLocal(db, id, "engagements", "eng", {
    photos: ["photo"],
    signature: "signature",
  });
  await assert.rejects(
    syncOnce(db, async (path, options) => {
      await server.request(path, options);
      throw new Error("Connection dropped after commit");
    }),
  );
  assert.equal((await db.getAll("outbox")).length, 1);
  assert.equal(server.records.size, 1);
  await syncOnce(db, server.request);
  assert.equal(server.records.size, 1);
  assert.equal(server.receipts.size, 1);
  assert.equal(server.attempts, 2);
  assert.equal((await db.getAll("outbox")).length, 0);
  db.close();
});
test("server pulls never overwrite pending local edits", async () => {
  const { db, id } = await fixture();
  await saveLocal(db, id, "hcps", "hcp", { name: "Local" });
  await mergeRemote(db, [
    { entity: "hcps", id: "hcp", version: 4, data: { name: "Remote" } },
  ]);
  assert.equal((await db.get("records", "hcps:hcp")).data.name, "Local");
  db.close();
});
test("conflict resolution rebases the latest offline edit over the reviewed version", async () => {
  const { db, id } = await fixture();
  const server = fakeServer();
  server.records.set("hcps:hcp", {
    id: "hcp",
    entity: "hcps",
    version: 3,
    data: { name: "Server" },
    ownerId: id,
  });
  await saveLocal(db, id, "hcps", "hcp", { name: "First local" });
  await saveLocal(db, id, "hcps", "hcp", { name: "Final local" });
  await syncOnce(db, server.request);
  const items = await db.getAll("outbox");
  assert.equal(items[0].status, "conflict");
  assert.equal(server.attempts, 1);
  assert.equal((await db.get("records", "hcps:hcp")).data.name, "Final local");
  await resolveConflict(db, items[0], "local");
  await syncOnce(db, server.request);
  assert.equal(server.records.get("hcps:hcp").version, 4);
  assert.equal(server.records.get("hcps:hcp").data.name, "Final local");
  assert.equal((await db.getAll("outbox")).length, 0);
  db.close();
});
test("choosing server content removes all conflicting edits for that record only", async () => {
  const { db, id } = await fixture();
  await saveLocal(db, id, "hcps", "hcp", { name: "Local" });
  await saveLocal(db, id, "hcps", "other", { name: "Other" });
  const item = (await db.getAll("outbox"))[0];
  await resolveConflict(
    db,
    {
      ...item,
      current: {
        entity: "hcps",
        id: "hcp",
        version: 3,
        data: { name: "Server" },
      },
    },
    "server",
  );
  assert.equal((await db.getAll("outbox")).length, 1);
  assert.equal((await db.get("records", "hcps:hcp")).data.name, "Server");
  db.close();
});
test("validation rejection remains visible and can be corrected without losing attachments", async () => {
  const { db, id } = await fixture();
  await saveLocal(db, id, "engagements", "eng", {
    photos: ["photo"],
    signature: "signature",
    patients: -1,
  });
  await syncOnce(db, async (path) => {
    if (path === "/records") return { records: [], serverTime: "now" };
    throw Object.assign(new Error("Invalid patients"), {
      status: 422,
      body: {},
    });
  });
  const item = (await db.getAll("outbox"))[0];
  assert.equal(item.status, "error");
  assert.equal(
    (await db.get("records", "engagements:eng")).data.photos[0],
    "photo",
  );
  await replaceRejected(db, item, { ...item.mutation.data, patients: 1 });
  const server = fakeServer();
  await syncOnce(db, server.request);
  assert.equal((await db.get("records", "engagements:eng")).data.patients, 1);
  db.close();
});
test("authentication failures preserve queued work for reconnection", async () => {
  const { db, id } = await fixture();
  await saveLocal(db, id, "hcps", "hcp", { name: "Preserved" });
  await assert.rejects(
    syncOnce(db, async () => {
      throw Object.assign(new Error("Expired"), { status: 401 });
    }),
  );
  assert.equal((await db.getAll("outbox")).length, 1);
  assert.equal((await db.getAll("outbox"))[0].status, "pending");
  db.close();
});
test("records are isolated by signed-in user and revoked remote records are removed", async () => {
  const a = await fixture();
  const b = await fixture();
  await saveLocal(a.db, a.id, "hcps", "private", { name: "A only" });
  assert.equal((await b.db.getAll("records")).length, 0);
  await mergeRemote(a.db, [
    {
      entity: "hcps",
      id: "revoked",
      version: 1,
      data: { name: "Old shared HCP" },
    },
  ]);
  await mergeRemote(a.db, []);
  assert.equal(await a.db.get("records", "hcps:revoked"), undefined);
  assert.equal((await a.db.get("records", "hcps:private")).data.name, "A only");
  a.db.close();
  b.db.close();
});

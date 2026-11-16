import { openDB } from "idb";

export async function openLocal(userId) {
  const connection = await openDB(`psl-${userId}`, 1, {
    upgrade(db) {
      db.createObjectStore("records", { keyPath: "key" });
      db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("drafts");
      db.createObjectStore("meta");
    },
    blocking() {
      connection.close();
    },
  });
  return connection;
}
export const recordKey = (entity, id) => `${entity}:${id}`;
export async function saveLocal(db, userId, entity, id, data) {
  const key = recordKey(entity, id);
  const tx = db.transaction(["records", "outbox"], "readwrite");
  const prior = await tx.objectStore("records").get(key);
  const mutationId = crypto.randomUUID();
  const baseVersion = prior?.version || 0;
  const mutation = { mutationId, entity, id, baseVersion, data };
  await tx
    .objectStore("outbox")
    .add({
      key,
      mutation,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  const record = {
    key,
    entity,
    id,
    ownerId: prior?.ownerId || userId,
    version: baseVersion + 1,
    data,
    syncedAt: prior?.syncedAt || null,
    pending: true,
    mutationId,
  };
  await tx.objectStore("records").put(record);
  await tx.done;
  return record;
}
export async function acceptMutation(db, item, remote) {
  const tx = db.transaction(["records", "outbox"], "readwrite");
  const local = await tx.objectStore("records").get(item.key);
  if (local?.mutationId === item.mutation.mutationId)
    await tx
      .objectStore("records")
      .put({ ...remote, key: item.key, pending: false });
  await tx.objectStore("outbox").delete(item.seq);
  await tx.done;
}
export async function mergeRemote(db, remote) {
  const tx = db.transaction(["records", "outbox"], "readwrite");
  const pending = new Set(
    (await tx.objectStore("outbox").getAll()).map((i) => i.key),
  );
  const incoming = new Set(remote.map((r) => recordKey(r.entity, r.id)));
  for (const record of await tx.objectStore("records").getAll())
    if (!pending.has(record.key) && !incoming.has(record.key))
      await tx.objectStore("records").delete(record.key);
  for (const record of remote) {
    const key = recordKey(record.entity, record.id);
    if (!pending.has(key))
      await tx.objectStore("records").put({ ...record, key, pending: false });
  }
  await tx.done;
}
// Explicit conflict resolution preserves the latest local edit, not just the first failed mutation.
export async function resolveConflict(db, item, choice) {
  const tx = db.transaction(["records", "outbox"], "readwrite");
  const local = await tx.objectStore("records").get(item.key);
  for (const queued of await tx.objectStore("outbox").getAll())
    if (queued.key === item.key)
      await tx.objectStore("outbox").delete(queued.seq);
  if (choice === "server") {
    if (item.current)
      await tx
        .objectStore("records")
        .put({ ...item.current, key: item.key, pending: false });
    else await tx.objectStore("records").delete(item.key);
  } else {
    const mutationId = crypto.randomUUID();
    const version = item.current?.version || 0;
    await tx
      .objectStore("outbox")
      .add({
        key: item.key,
        status: "pending",
        createdAt: new Date().toISOString(),
        mutation: {
          ...item.mutation,
          mutationId,
          data: local.data,
          baseVersion: version,
        },
      });
    await tx
      .objectStore("records")
      .put({ ...local, mutationId, version: version + 1, pending: true });
  }
  await tx.done;
}
export async function replaceRejected(db, item, data) {
  if (item.status !== "error")
    throw new Error("Only rejected records can be corrected.");
  const tx = db.transaction(["records", "outbox"], "readwrite");
  const local = await tx.objectStore("records").get(item.key);
  for (const q of await tx.objectStore("outbox").getAll())
    if (q.key === item.key) await tx.objectStore("outbox").delete(q.seq);
  const mutationId = crypto.randomUUID();
  await tx
    .objectStore("outbox")
    .add({
      key: item.key,
      status: "pending",
      createdAt: new Date().toISOString(),
      mutation: { ...item.mutation, mutationId, data },
    });
  await tx
    .objectStore("records")
    .put({
      ...local,
      data,
      mutationId,
      version: item.mutation.baseVersion + 1,
      pending: true,
    });
  await tx.done;
}

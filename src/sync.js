import { acceptMutation, mergeRemote } from "./offline.js";
export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-PSL-Client": "1",
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(30000),
  });
  const body = await response
    .json()
    .catch(() => ({ error: "Unexpected server response." }));
  if (!response.ok)
    throw Object.assign(new Error(body.error || "Request failed."), {
      status: response.status,
      body,
    });
  return body;
}
export async function syncOnce(db, request = api) {
  const blocked = new Set();
  for (const item of await db.getAll("outbox")) {
    if (blocked.has(item.key)) continue;
    if (item.status === "conflict" || item.status === "error") {
      blocked.add(item.key);
      continue;
    }
    try {
      const { record } = await request("/sync", {
        method: "POST",
        body: JSON.stringify(item.mutation),
      });
      await acceptMutation(db, item, record);
    } catch (e) {
      if ([409, 422, 403, 413, 400].includes(e.status)) {
        await db.put("outbox", {
          ...item,
          status: e.status === 409 && e.body?.current ? "conflict" : "error",
          error: e.message,
          current: e.body?.current || null,
        });
        blocked.add(item.key);
      } else throw e;
    }
  }
  const result = await request("/records");
  await mergeRemote(db, result.records);
  await db.put("meta", result.serverTime, "lastSync");
  return result;
}

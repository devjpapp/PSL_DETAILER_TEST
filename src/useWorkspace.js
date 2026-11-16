import { useCallback, useEffect, useRef, useState } from "react";
import { openLocal, saveLocal } from "./offline.js";
import { api, syncOnce } from "./sync.js";

export function useWorkspace(user) {
  const [db, setDb] = useState(null);
  const [records, setRecords] = useState([]);
  const [queue, setQueue] = useState([]);
  const [syncState, setSyncState] = useState("idle");
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(
    !!navigator.serviceWorker?.controller,
  );
  const busy = useRef(false);
  const retry = useRef({ at: 0, delay: 15000 });
  const channel = useRef(null);
  const refresh = useCallback(async () => {
    if (!db) return;
    const [r, q, t] = await Promise.all([
      db.getAll("records"),
      db.getAll("outbox"),
      db.get("meta", "lastSync"),
    ]);
    setRecords(r);
    setQueue(q);
    setLastSync(t);
  }, [db]);
  useEffect(() => {
    let cancelled = false;
    let connection;
    openLocal(user.id)
      .then((value) => {
        connection = value;
        if (!cancelled) setDb(value);
        else value.close();
      })
      .catch((e) => setSyncError("Offline storage unavailable: " + e.message));
    return () => {
      cancelled = true;
      connection?.close();
    };
  }, [user.id]);
  useEffect(() => {
    refresh().catch((e) => setSyncError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const c = new BroadcastChannel("psl-" + user.id);
    channel.current = c;
    c.onmessage = () => refresh();
    return () => {
      channel.current = null;
      c.close();
    };
  }, [user.id, refresh]);
  const sync = useCallback(
    async (force = false) => {
      if (
        !db ||
        busy.current ||
        !navigator.onLine ||
        (!force && Date.now() < retry.current.at)
      )
        return;
      busy.current = true;
      setSyncState("syncing");
      setSyncError("");
      try {
        const run = async () => {
          const session = await api("/auth/me");
          if (session.user.id !== user.id)
            throw Object.assign(
              new Error(
                "Sign in with " + user.email + " to sync this workspace.",
              ),
              { status: 401 },
            );
          return syncOnce(db);
        };
        if (navigator.locks)
          await navigator.locks.request("psl-sync-" + user.id, run);
        else await run();
        setSyncState("idle");
        retry.current = { at: 0, delay: 15000 };
      } catch (e) {
        setSyncState(e.status === 401 ? "auth" : "offline");
        setSyncError(e.message);
        retry.current = {
          at: Date.now() + retry.current.delay,
          delay: Math.min(retry.current.delay * 2, 120000),
        };
      } finally {
        busy.current = false;
        await refresh();
        channel.current?.postMessage("updated");
      }
    },
    [db, refresh, user.id],
  );
  useEffect(() => {
    sync();
    const timer = setInterval(() => sync(), 15000);
    const onOnline = () => {
      setOnline(true);
      sync(true);
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onMessage = (e) => {
      if (e.data?.type === "SYNC") sync();
    };
    const controlled = () => setOfflineReady(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    navigator.serviceWorker?.addEventListener("controllerchange", controlled);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        controlled,
      );
    };
  }, [sync]);
  const changed = async () => {
    await refresh();
    channel.current?.postMessage("updated");
    sync(true);
  };
  const save = async (entity, id, data) => {
    if (!db) throw new Error("Offline storage is still opening.");
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const record = await saveLocal(
      db,
      user.id,
      entity,
      id || crypto.randomUUID(),
      data,
    );
    await changed();
    return record;
  };
  return {
    db,
    records,
    queue,
    syncState,
    syncError,
    lastSync,
    online,
    offlineReady,
    sync,
    refresh,
    changed,
    save,
  };
}

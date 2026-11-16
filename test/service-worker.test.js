import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

test("generated service worker precaches the complete shell, serves it offline, and bypasses API data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "psl-sw-"));
  try {
    mkdirSync(join(directory, "dist/assets"), { recursive: true });
    writeFileSync(
      join(directory, "dist/index.html"),
      "<html>test build</html>",
    );
    writeFileSync(join(directory, "dist/assets/app-hash.js"), "test asset");
    execFileSync(process.execPath, [resolve("scripts-build-sw.js")], {
      cwd: directory,
    });
    const handlers = {};
    const cachesMap = new Map([
      ["psl-old", new Map()],
      ["unrelated-cache", new Map()],
    ]);
    const caches = {
      keys: async () => [...cachesMap.keys()],
      delete: async (key) => cachesMap.delete(key),
      open: async (key) => {
        if (!cachesMap.has(key)) cachesMap.set(key, new Map());
        const entries = cachesMap.get(key);
        return {
          addAll: async (urls) =>
            urls.forEach((url) =>
              entries.set(url, { url, body: "cached " + url }),
            ),
          match: async (url) => entries.get(url),
        };
      },
    };
    let claimed = false;
    const context = {
      URL,
      caches,
      fetch: async () => {
        throw new Error("Offline");
      },
      self: {
        location: { origin: "https://test.local" },
        addEventListener: (name, handler) => {
          handlers[name] = handler;
        },
        skipWaiting: async () => {},
        clients: {
          claim: async () => {
            claimed = true;
          },
        },
      },
    };
    vm.runInNewContext(
      readFileSync(join(directory, "dist/sw.js"), "utf8"),
      context,
    );
    const run = async (name) => {
      let task;
      handlers[name]({
        waitUntil: (promise) => {
          task = promise;
        },
      });
      await task;
    };
    await run("install");
    await run("activate");
    assert(claimed);
    assert(!cachesMap.has("psl-old"));
    assert(cachesMap.has("unrelated-cache"));
    const shell = [...cachesMap.entries()].find(([key]) =>
      key.startsWith("psl-"),
    )[1];
    assert(shell.has("/assets/app-hash.js"));
    assert(shell.has("/manifest.webmanifest"));
    let response;
    handlers.fetch({
      request: { method: "GET", url: "https://test.local/", mode: "navigate" },
      respondWith: (promise) => {
        response = promise;
      },
    });
    assert.equal((await response).body, "cached /index.html");
    let intercepted = false;
    handlers.fetch({
      request: {
        method: "GET",
        url: "https://test.local/api/records",
        mode: "cors",
      },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

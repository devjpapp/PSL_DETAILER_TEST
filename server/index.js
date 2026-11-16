import express from "express";
import { resolve } from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
const db = openDb();
const app = createApp(db);
const dev = process.argv.includes("--dev");
if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use((req, res, next) => {
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    next();
  });
  app.get("/sw.js", (req, res) =>
    res.set("Cache-Control", "no-cache").sendFile(resolve("dist/sw.js")),
  );
  app.use(
    express.static(resolve("dist"), {
      maxAge: "1h",
      setHeaders(res, path) {
        if (path.endsWith("index.html")) res.set("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
}
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () =>
  console.log(
    `PSL Detailer ready on port ${port} (${dev ? "development" : "production"})`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );

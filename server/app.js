import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  canRead,
  digest,
  passwordHash,
  passwordMatches,
  publicUser,
  unpack,
} from "./db.js";
import { mutationSchema, schemas } from "./schema.js";

const accountSchema = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .transform((v) => v.toLowerCase()),
  name: z.string().trim().min(1).max(160),
  password: z.string().min(12).max(200),
  role: z.enum(["admin", "medrep"]),
});
export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res
      .set("X-Content-Type-Options", "nosniff")
      .set("Referrer-Policy", "same-origin")
      .set("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", express.json({ limit: "12mb" }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (req.get("X-PSL-Client") !== "1" ||
        (req.get("Sec-Fetch-Site") &&
          req.get("Sec-Fetch-Site") === "cross-site"))
    )
      return res.status(403).json({ error: "Same-origin client required." });
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("psl_session="))
      ?.slice(12);
    if (cookie)
      req.user = db
        .prepare(
          "SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.token=? AND sessions.expires>? AND users.active=1",
        )
        .get(digest(cookie), Date.now());
    next();
  });
  const attempts = new Map();
  app.post("/api/auth/login", (req, res) => {
    const input = z
      .object({
        email: z.string().email().max(200),
        password: z.string().max(200),
      })
      .safeParse(req.body);
    if (!input.success)
      return res
        .status(400)
        .json({ error: "Enter a valid email and password." });
    const email = input.data.email.toLowerCase();
    const key = req.ip + ":" + email;
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (entry.count >= 10)
      return res
        .status(429)
        .json({ error: "Too many attempts. Try again in 15 minutes." });
    const user = db
      .prepare("SELECT * FROM users WHERE email=? AND active=1")
      .get(email);
    if (!user || !passwordMatches(input.data.password, user.password)) {
      entry.count++;
      attempts.set(key, entry);
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    attempts.delete(key);
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires<=?").run(now);
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      digest(token),
      user.id,
      now + 14 * 86400000,
    );
    res.cookie("psl_session", token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "1",
      sameSite: "strict",
      maxAge: 14 * 86400000,
      path: "/",
    });
    res.json({ user: publicUser(user) });
  });
  app.post("/api/auth/logout", (req, res) => {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("psl_session="))
      ?.slice(12);
    if (cookie)
      db.prepare("DELETE FROM sessions WHERE token=?").run(digest(cookie));
    res.clearCookie("psl_session", { path: "/" }).json({ ok: true });
  });
  app.use("/api", (req, res, next) =>
    req.user
      ? next()
      : res
          .status(401)
          .json({
            error: "Sign in online to sync. Your offline work is retained.",
          }),
  );
  app.get("/api/auth/me", (req, res) =>
    res.json({ user: publicUser(req.user) }),
  );
  app.post("/api/auth/password", (req, res) => {
    const input = z
      .object({
        current: z.string().max(200),
        password: z.string().min(12).max(200),
      })
      .safeParse(req.body);
    if (
      !input.success ||
      !passwordMatches(input.data.current, req.user.password)
    )
      return res
        .status(400)
        .json({
          error:
            "Current password is incorrect or new password is shorter than 12 characters.",
        });
    db.prepare("UPDATE users SET password=? WHERE id=?").run(
      passwordHash(input.data.password),
      req.user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
    res.clearCookie("psl_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/records", (req, res) => {
    const records = db
      .prepare("SELECT * FROM records")
      .all()
      .filter((row) => canRead(req.user, row))
      .map(unpack);
    res.json({ records, serverTime: new Date().toISOString() });
  });
  app.post("/api/sync", (req, res) => {
    const mutation = mutationSchema.safeParse(req.body);
    if (!mutation.success)
      return res.status(400).json({ error: "Invalid sync request." });
    const m = mutation.data;
    const hash = digest(JSON.stringify(m));
    const receipt = db
      .prepare("SELECT * FROM receipts WHERE user_id=? AND mutation_id=?")
      .get(req.user.id, m.mutationId);
    if (receipt)
      return receipt.request_hash === hash
        ? res.json(JSON.parse(receipt.response))
        : res
            .status(409)
            .json({ error: "Mutation ID reused with different content." });
    const parsed = schemas[m.entity].safeParse(m.data);
    if (!parsed.success)
      return res
        .status(422)
        .json({
          error: parsed.error.issues
            .map((v) => `${v.path.join(".")}: ${v.message}`)
            .join("; "),
        });
    const data = parsed.data;
    const row = db
      .prepare("SELECT * FROM records WHERE entity=? AND id=?")
      .get(m.entity, m.id);
    const isAdmin = req.user.role === "admin";
    if (
      (row && !canRead(req.user, row)) ||
      (!isAdmin &&
        (m.entity === "skus" ||
          (row && row.owner_id !== req.user.id) ||
          (m.entity === "hcps" &&
            (data.masterlist || (row && JSON.parse(row.data).masterlist)))))
    )
      return res.status(403).json({ error: "You cannot modify this record." });
    if ((row?.version || 0) !== m.baseVersion)
      return res
        .status(409)
        .json({
          error: "This record changed on another device. Review both versions.",
          current: unpack(row),
        });
    if (m.entity === "engagements" && row)
      return res
        .status(422)
        .json({
          error:
            "Submitted engagements are immutable. Record corrections in a separate follow-up engagement.",
        });
    const reference = (entity, id) => {
      const r = db
        .prepare("SELECT * FROM records WHERE entity=? AND id=?")
        .get(entity, id);
      return r && canRead(req.user, r) ? unpack(r) : null;
    };
    if (m.entity === "hcps" && data.masterlist && !data.externalId)
      return res
        .status(422)
        .json({ error: "Approved HCPs need a unique masterlist source ID." });
    if (
      ["plans", "engagements"].includes(m.entity) &&
      !reference("hcps", data.hcpId)
    )
      return res
        .status(422)
        .json({ error: "Sync or resolve the HCP record first." });
    if (m.entity === "plans" && row) {
      const linked = db
        .prepare("SELECT data FROM records WHERE entity='engagements'")
        .all()
        .some((r) => JSON.parse(r.data).planId === m.id);
      if (linked)
        return res
          .status(422)
          .json({
            error: "A completed call cannot be rescheduled or cancelled.",
          });
    }
    if (m.entity === "engagements") {
      if (
        Date.parse(data.actualAt) > Date.now() + 5 * 60000 ||
        Date.parse(data.endedAt) > Date.now() + 5 * 60000
      )
        return res
          .status(422)
          .json({
            error: "Engagement time is in the future. Check the device clock.",
          });
      if (data.planId) {
        const plan = reference("plans", data.planId);
        if (
          !plan ||
          plan.data.hcpId !== data.hcpId ||
          plan.data.status === "Cancelled" ||
          (!isAdmin && plan.ownerId !== req.user.id)
        )
          return res
            .status(422)
            .json({
              error:
                "The selected planned call is unavailable or belongs to another HCP.",
            });
        if (
          db
            .prepare("SELECT data FROM records WHERE entity='engagements'")
            .all()
            .some((r) => JSON.parse(r.data).planId === data.planId)
        )
          return res
            .status(422)
            .json({
              error: "This planned call already has a completed engagement.",
            });
      }
      for (const sample of data.samples)
        if (!reference("skus", sample.skuId)?.data.active)
          return res
            .status(422)
            .json({
              error:
                "A sample SKU is unavailable or inactive. Ask your administrator to review it.",
            });
      const hcp = reference("hcps", data.hcpId);
      data.hcpSnapshot = {
        name: hcp.data.name,
        masterlist: hcp.data.masterlist,
        institution: hcp.data.institution,
        classification: hcp.data.classification,
        externalId: hcp.data.externalId,
      };
      data.sampleSnapshots = data.samples.map((s) => ({
        ...s,
        code: reference("skus", s.skuId).data.code,
        name: reference("skus", s.skuId).data.name,
      }));
      data.orderValidation = "Unverified";
    }
    const now = new Date().toISOString();
    const version = (row?.version || 0) + 1;
    const owner = row?.owner_id || req.user.id;
    const record = {
      entity: m.entity,
      id: m.id,
      ownerId: owner,
      version,
      data,
      syncedAt: now,
    };
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        "INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(entity,id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=excluded.updated_at",
      ).run(m.entity, m.id, owner, version, JSON.stringify(data), now);
      db.prepare("INSERT INTO receipts VALUES(?,?,?,?)").run(
        req.user.id,
        m.mutationId,
        hash,
        JSON.stringify({ record }),
      );
      db.prepare(
        "INSERT INTO audit(user_id,entity,record_id,version,at) VALUES(?,?,?,?,?)",
      ).run(req.user.id, m.entity, m.id, version, now);
      db.exec("COMMIT");
      res.json({ record });
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.message.includes("UNIQUE"))
        return res
          .status(422)
          .json({
            error:
              "Masterlist source ID or SKU code already exists. Update the existing record.",
          });
      throw error;
    }
  });
  app.use("/api/users", (req, res, next) =>
    req.user.role === "admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  app.get("/api/users", (req, res) =>
    res.json({
      users: db
        .prepare("SELECT * FROM users ORDER BY name")
        .all()
        .map(publicUser),
    }),
  );
  app.post("/api/users", (req, res) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(422)
        .json({
          error:
            "Name, valid email, role, and a password of at least 12 characters are required.",
        });
    const u = parsed.data;
    try {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO users(id,email,name,password,role) VALUES(?,?,?,?,?)",
      ).run(id, u.email, u.name, passwordHash(u.password), u.role);
      res
        .status(201)
        .json({
          user: publicUser(
            db.prepare("SELECT * FROM users WHERE id=?").get(id),
          ),
        });
    } catch (e) {
      if (e.message.includes("UNIQUE"))
        return res.status(409).json({ error: "Email already exists." });
      throw e;
    }
  });
  app.patch("/api/users/:id", (req, res) => {
    if (req.params.id === req.user.id)
      return res
        .status(400)
        .json({ error: "You cannot deactivate your own account." });
    if (typeof req.body.active !== "boolean")
      return res.status(400).json({ error: "Active must be a boolean." });
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id))
      return res.status(404).json({ error: "Account not found." });
    db.prepare("UPDATE users SET active=? WHERE id=?").run(
      Number(req.body.active),
      req.params.id,
    );
    if (!req.body.active)
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({
          error: "Engagement is too large. Use up to 3 photos of 2 MB each.",
        });
    if (error instanceof SyntaxError)
      return res.status(400).json({ error: "Invalid JSON." });
    console.error("Request failed:", error.message);
    res
      .status(500)
      .json({
        error:
          "Server could not complete the request. Your offline work is retained.",
      });
  });
  return app;
}

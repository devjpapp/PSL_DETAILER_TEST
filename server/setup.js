import { randomBytes, randomUUID } from "node:crypto";
import { openDb, passwordHash } from "./db.js";
const db = openDb();
let admin = db
  .prepare("SELECT * FROM users WHERE role='admin' AND active=1")
  .get();
if (!admin) {
  const email = process.env.ADMIN_EMAIL || "admin@psl.local";
  const password =
    process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  if (password.length < 12)
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users(id,email,name,password,role) VALUES(?,?,?,?,?)",
  ).run(
    id,
    email.toLowerCase(),
    "PSL Administrator",
    passwordHash(password),
    "admin",
  );
  admin = { id };
  console.log(`Administrator created: ${email}`);
  if (!process.env.ADMIN_PASSWORD)
    console.log(`Generated password (save securely): ${password}`);
} else console.log("Existing administrator retained.");
if (process.argv.includes("--demo")) {
  const hcp = {
    name: "Dr. Alex Rivera (Demo)",
    email: "",
    phone: "",
    address: "Demo Medical Center",
    dispensing: "Non-dispensing",
    classification: "General Practitioner",
    institution: "Standalone",
    masterlist: true,
    externalId: "DEMO-001",
    medretailersId: "",
    notes: "Fictional record for testing only.",
  };
  const sku = {
    code: "DEMO-SKU-001",
    name: "Sample product (Demo)",
    active: true,
  };
  for (const [entity, id, data] of [
    ["hcps", "demo-hcp-001", hcp],
    ["skus", "demo-sku-001", sku],
  ])
    db.prepare("INSERT OR IGNORE INTO records VALUES(?,?,?,?,?,?)").run(
      entity,
      id,
      admin.id,
      1,
      JSON.stringify(data),
      new Date().toISOString(),
    );
  console.log("Fictional demo HCP and sample SKU are available.");
}
db.close();

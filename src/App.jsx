import React, { useEffect, useMemo, useState } from "react";
import { deleteDB } from "idb";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  ClipboardCheck,
  Package,
  BarChart3,
  Cloud,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  WifiOff,
  Check,
  LogOut,
  Menu,
  Clock3,
  MapPin,
  Upload,
  Download,
  AlertCircle,
  X,
  ChevronDown,
} from "lucide-react";
import { useWorkspace } from "./useWorkspace.js";
import { api } from "./sync.js";
import { resolveConflict, replaceRejected } from "./offline.js";
import {
  Badge,
  CsvButton,
  Empty,
  Field,
  Form,
  Modal,
  SyncBadge,
  download,
  elapsed,
  fmtDate,
  fmtTime,
  localDate,
  today,
} from "./components.jsx";
import {
  EngagementForm,
  HcpForm,
  MasterlistImport,
  PlanForm,
  SkuForm,
} from "./forms.jsx";
import { categories } from "../server/schema.js";

const navigation = [
  ["dashboard", "Overview", LayoutDashboard],
  ["hcps", "HCP directory", Users],
  ["planning", "Call planning", CalendarDays],
  ["engagements", "Engagements", ClipboardCheck],
  ["samples", "Sample catalog", Package],
  ["reports", "Reports", BarChart3],
  ["sync", "Sync center", Cloud],
  ["settings", "Settings", Settings],
];
function readProfile() {
  try {
    return JSON.parse(localStorage.getItem("psl-profile"));
  } catch {
    return null;
  }
}
export default function App() {
  const [user, setUser] = useState(readProfile);
  const login = (user) => {
    localStorage.setItem("psl-profile", JSON.stringify(user));
    setUser(user);
  };
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "psl-profile") location.reload();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return user ? (
    <Workspace
      key={user.id}
      user={user}
      onLogout={() => {
        localStorage.removeItem("psl-profile");
        setUser(null);
      }}
    />
  ) : (
    <Login onLogin={login} />
  );
}
function Login({ onLogin, expected }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className={expected ? "reauth" : "login-page"}>
      {!expected && (
        <div className="login-story">
          <Brand />
          <div>
            <span className="eyebrow">PSL FIELD WORKSPACE</span>
            <h1>
              Better visits.
              <br />
              Stronger connections.
            </h1>
            <p>
              Your day in the field, brought together. Plan with purpose, record
              every engagement, and keep moving—even offline.
            </p>
            <div className="story-grid">
              <div>
                <CalendarDays />
                <span>Plan your calls</span>
              </div>
              <div>
                <ClipboardCheck />
                <span>Capture the visit</span>
              </div>
              <div>
                <Cloud />
                <span>Sync automatically</span>
              </div>
            </div>
          </div>
          <small>Purpose-built for your day in the field.</small>
        </div>
      )}
      <div className="login-card">
        <span className="eyebrow">WELCOME TO PSL</span>
        <h2>{expected ? "Reconnect your account" : "Let’s get to work."}</h2>
        <p className="muted">
          {expected
            ? "Sign in to resume syncing your saved work."
            : "Sign in online once to prepare your offline workspace."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const { user } = await api("/auth/login", {
                method: "POST",
                body: JSON.stringify(Object.fromEntries(f)),
              });
              if (expected && user.id !== expected.id) {
                await api("/auth/logout", { method: "POST" });
                throw new Error(
                  "Sign in with " + expected.email + " to sync this workspace.",
                );
              }
              onLogin(user);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Work email">
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              defaultValue={expected?.email || ""}
            />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button className="button login-button" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to workspace"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        {!expected && (
          <p className="login-footnote">
            First time here? Ask your administrator for an account.
            <br />
            Administrators: run <code>npm run setup</code> on the server.
          </p>
        )}
      </div>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div>
        <Check size={23} strokeWidth={3} />
      </div>
      <span>
        PSL<span>Detailer</span>
      </span>
    </div>
  );
}

function Workspace({ user, onLogout }) {
  const ws = useWorkspace(user);
  const [page, setPage] = useState(location.hash.slice(1) || "dashboard");
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [accounts, setAccounts] = useState([]);
  const { records, queue } = ws;
  const hcps = useMemo(
    () =>
      records
        .filter((r) => r.entity === "hcps")
        .sort(
          (a, b) =>
            Number(b.data.masterlist) - Number(a.data.masterlist) ||
            a.data.name.localeCompare(b.data.name),
        ),
    [records],
  );
  const plans = records
    .filter((r) => r.entity === "plans")
    .sort((a, b) =>
      (a.data.date + a.data.startTime).localeCompare(
        b.data.date + b.data.startTime,
      ),
    );
  const engagements = records
    .filter((r) => r.entity === "engagements")
    .sort((a, b) => b.data.actualAt.localeCompare(a.data.actualAt));
  const skus = records
    .filter((r) => r.entity === "skus")
    .sort((a, b) => a.data.code.localeCompare(b.data.code));
  const hcpName = (id) =>
    hcps.find((h) => h.id === id)?.data.name || "HCP unavailable";
  const repName = (id) =>
    id === user.id
      ? user.name
      : accounts.find((a) => a.id === id)?.name || "Team member";
  const issueCount = queue.filter((q) => q.status !== "pending").length;
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 6000);
  };
  const go = (next) => {
    setPage(next);
    location.hash = next;
    setMobile(false);
  };
  useEffect(() => {
    const listener = () => setPage(location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (user.role === "admin" && ws.online)
      api("/users")
        .then((r) => setAccounts(r.users))
        .catch(() => {});
  }, [user.role, ws.online, ws.lastSync]);
  const open = (type, record = null, extra = {}) =>
    setModal({ type, record, ...extra });
  const close = () => setModal(null);
  const save = async (entity, data) => {
    if (modal?.rejected) await replaceRejected(ws.db, modal.rejected, data);
    else await ws.save(entity, modal?.record?.id, data);
    await ws.changed();
    close();
    notify("Saved on this device. Sync runs automatically when connected.");
  };
  const mayEdit = (record) =>
    user.role === "admin" ||
    (record.ownerId === user.id && !record.data.masterlist);
  const logout = async () => {
    if (ws.syncState === "syncing")
      return notify("Wait for the current sync to finish before signing out.");
    if (queue.length)
      return notify(
        "Sync or resolve pending work before signing out. You can export a backup from Sync center.",
      );
    const drafts = await ws.db.getAll("drafts");
    if (
      !window.confirm(
        `Sign out and remove cached records${drafts.length ? " and saved drafts" : ""} from this device?`,
      )
    )
      return;
    try {
      await api("/auth/logout", { method: "POST" });
      localStorage.removeItem("psl-profile");
      ws.db.close();
      await deleteDB("psl-" + user.id);
      onLogout();
    } catch (e) {
      notify("Connect to the server to sign out securely. " + e.message);
    }
  };
  const title = navigation.find((n) => n[0] === page)?.[1] || "Overview";
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "is-open" : "")}>
        <Brand />
        <div className="workspace-label">FIELD WORKSPACE</div>
        <nav>
          {navigation.map(([id, label, Icon], i) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={
                (page === id ? "active " : "") + (i === 6 ? "nav-divider" : "")
              }
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "sync" && queue.length > 0 && <b>{queue.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="offline-card">
            <Cloud size={20} />
            <strong>Made for the field</strong>
            <p>
              Your work stays with you,
              <br />
              even without a connection.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === "admin"
                  ? "Administrator"
                  : "Medical representative"}
              </small>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <button
              className={
                "connection " +
                (!ws.online || ws.syncState === "offline"
                  ? "connection-offline"
                  : "")
              }
              onClick={() => go("sync")}
            >
              {!ws.online || ws.syncState === "offline" ? (
                <WifiOff size={15} />
              ) : ws.syncState === "syncing" ? (
                <RefreshCw size={15} className="spin" />
              ) : (
                <span className="online-dot" />
              )}
              {!ws.online
                ? "Offline · saved locally"
                : ws.syncState === "syncing"
                  ? "Syncing…"
                  : ws.syncState === "auth"
                    ? "Sign in to sync"
                    : ws.syncState === "offline"
                      ? "Server unavailable"
                      : issueCount
                        ? `${issueCount} need attention`
                        : queue.length
                          ? `${queue.length} pending`
                          : "Connected"}
            </button>
            <span className="top-date">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </header>
        <main>
          {ws.syncState === "auth" && (
            <div className="alert amber">
              Your online session has expired. Offline work is preserved.
              <button className="text-button" onClick={() => open("login")}>
                Sign in to sync
              </button>
            </div>
          )}
          {!ws.offlineReady && (
            <div className="alert info">
              {import.meta.env.DEV
                ? "Development mode: build and run npm start to test offline reloads."
                : "Preparing offline access. Keep this page open while the app downloads. HTTPS or localhost is required."}
            </div>
          )}
          {ws.syncError && ws.syncState === "idle" && (
            <div className="alert error">{ws.syncError}</div>
          )}
          {page === "dashboard" && (
            <Overview
              {...{
                user,
                hcps,
                plans,
                engagements,
                hcpName,
                repName,
                queue,
                go,
                open,
                ws,
              }}
            />
          )}
          {page === "hcps" && <Directory {...{ user, hcps, mayEdit, open }} />}
          {page === "planning" && (
            <Planning
              {...{ user, plans, engagements, hcpName, repName, open }}
            />
          )}
          {page === "engagements" && (
            <Engagements {...{ engagements, hcpName, repName, open }} />
          )}
          {page === "samples" && (
            <Samples {...{ user, skus, engagements, open }} />
          )}
          {page === "reports" && (
            <Reports
              {...{
                user,
                accounts,
                engagements,
                plans,
                hcps,
                skus,
                hcpName,
                repName,
              }}
            />
          )}
          {page === "sync" && <SyncCenter {...{ ws, open, notify }} />}
          {page === "settings" && (
            <AccountSettings
              {...{ user, accounts, setAccounts, notify }}
              onPasswordChanged={() => {
                ws.sync(true);
                open("login");
              }}
            />
          )}
        </main>
        <footer>
          PSL Detailer <span>Plan thoughtfully. Connect meaningfully.</span>
          <span>
            {user.role === "admin" ? "Team workspace" : "My field workspace"}
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              hcp: modal.record ? "Edit HCP" : "Add an HCP",
              plan: modal.record ? "Edit planned call" : "Plan a call",
              engagement: modal.rejected
                ? "Correct rejected engagement"
                : "Record an engagement",
              sku: modal.record ? "Edit sample SKU" : "Add sample SKU",
              import: "Import approved masterlist",
              detail: "Engagement details",
              conflict: "Review conflicting changes",
              login: "Reconnect to PSL",
            }[modal.type]
          }
          onClose={close}
          wide={["engagement", "detail", "conflict"].includes(modal.type)}
        >
          {modal.type === "hcp" && (
            <HcpForm
              record={modal.record}
              user={user}
              onClose={close}
              onSave={(data) => save("hcps", data)}
            />
          )}
          {modal.type === "plan" && (
            <PlanForm
              record={modal.record}
              hcps={hcps}
              onClose={close}
              onSave={(data) => save("plans", data)}
            />
          )}
          {modal.type === "sku" && (
            <SkuForm
              record={modal.record}
              onClose={close}
              onSave={(data) => save("skus", data)}
            />
          )}
          {modal.type === "engagement" && ws.db && (
            <EngagementForm
              db={ws.db}
              hcps={hcps}
              plans={plans.filter((p) => p.ownerId === user.id)}
              engagements={engagements}
              skus={skus}
              plan={modal.plan}
              record={modal.record}
              onClose={close}
              onSave={(data) => save("engagements", data)}
            />
          )}
          {modal.type === "import" && (
            <MasterlistImport
              hcps={hcps}
              onSave={(id, data) => ws.save("hcps", id, data)}
              onClose={close}
            />
          )}
          {modal.type === "detail" && (
            <EngagementDetail
              record={modal.record}
              {...{ hcpName, repName, plans, skus }}
            />
          )}
          {modal.type === "conflict" && (
            <Conflict
              item={modal.item}
              db={ws.db}
              onClose={close}
              onResolved={async () => {
                await ws.changed();
                close();
              }}
            />
          )}
          {modal.type === "login" && (
            <Login
              expected={user}
              onLogin={() => {
                close();
                ws.sync(true);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow || "FIELD WORKSPACE"}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Stat({ label, value, note, icon: Icon, tone = "teal" }) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <div className={"stat-icon " + tone}>
          <Icon size={19} />
        </div>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Overview({
  user,
  hcps,
  plans,
  engagements,
  hcpName,
  repName,
  queue,
  go,
  open,
  ws,
}) {
  const day = today();
  const completed = new Set(engagements.map((e) => e.data.planId));
  const visits = engagements.filter(
    (e) => localDate(new Date(e.data.actualAt)) === day,
  );
  const itinerary = plans.filter(
    (p) => p.data.date === day && p.data.status !== "Cancelled",
  );
  const remaining = itinerary.filter((p) => !completed.has(p.id));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const date = localDate(d);
    return {
      date,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      count: engagements.filter(
        (e) => localDate(new Date(e.data.actualAt)) === date,
      ).length,
    };
  });
  const max = Math.max(4, ...days.map((d) => d.count));
  return (
    <>
      <PageHeading
        eyebrow="YOUR FIELD DAY, AT A GLANCE"
        title={`Hello, ${user.name.split(" ")[0]}.`}
        description="A clear plan. Every engagement accounted for."
      >
        <button className="button secondary" onClick={() => open("plan")}>
          <CalendarDays size={17} />
          Plan a call
        </button>
        <button className="button" onClick={() => open("engagement")}>
          <Plus size={18} />
          New engagement
        </button>
      </PageHeading>
      <div className="stats-grid">
        <Stat
          label="Today’s engagements"
          value={visits.length}
          note={user.role === "admin" ? "Across your team" : "Recorded today"}
          icon={ClipboardCheck}
        />
        <Stat
          label="Calls remaining"
          value={remaining.length}
          note={`${itinerary.length} planned for today`}
          icon={CalendarDays}
          tone="blue"
        />
        <Stat
          label="Approved HCPs"
          value={hcps.filter((h) => h.data.masterlist).length}
          note={`${hcps.length} HCPs in your directory`}
          icon={Users}
          tone="purple"
        />
        <Stat
          label="Pending sync"
          value={queue.length}
          note={
            queue.length
              ? "Saved safely on this device"
              : "Your records are up to date"
          }
          icon={Cloud}
          tone="amber"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel itinerary-panel">
          <div className="panel-heading">
            <div>
              <h2>Today’s itinerary</h2>
              <p>
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <button className="text-button" onClick={() => go("planning")}>
              View planner
              <ArrowUpRight size={16} />
            </button>
          </div>
          {!itinerary.length ? (
            <Empty
              title="Make room for a good visit"
              action={
                <button
                  className="button secondary small"
                  onClick={() => open("plan")}
                >
                  Plan your first call
                </button>
              }
            >
              Your planned calls for today will appear here.
            </Empty>
          ) : (
            <div className="itinerary-list">
              {itinerary.slice(0, 5).map((p) => (
                <div className="itinerary-item" key={p.id}>
                  <div className="itinerary-time">
                    {p.data.startTime}
                    <small>{p.data.duration} min</small>
                  </div>
                  <span
                    className={
                      "timeline-dot " + (completed.has(p.id) ? "complete" : "")
                    }
                  />
                  <div className="itinerary-info">
                    <strong>{hcpName(p.data.hcpId)}</strong>
                    <span>
                      {p.data.notes || "Planned HCP visit"} ·{" "}
                      {repName(p.ownerId)}
                    </span>
                  </div>
                  {completed.has(p.id) ? (
                    <Badge tone="green">Completed</Badge>
                  ) : p.ownerId === user.id ? (
                    <button
                      className="button secondary small"
                      onClick={() => open("engagement", null, { plan: p })}
                    >
                      Start visit
                      <ArrowUpRight size={14} />
                    </button>
                  ) : (
                    <Badge>Planned</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Engagement activity</h2>
              <p>Last 7 days</p>
            </div>
            <Badge tone="green">
              {days.reduce((n, d) => n + d.count, 0)} total
            </Badge>
          </div>
          <div
            className="bar-chart"
            aria-label="Engagement totals for the last seven days"
          >
            {days.map((d) => (
              <div className="chart-column" key={d.date}>
                <span>{d.count}</span>
                <div className="bar-track">
                  <div
                    style={{
                      height: `${Math.max(d.count ? 5 : 0, (d.count / max) * 100)}%`,
                    }}
                  />
                </div>
                <small>{d.label}</small>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span className="online-dot" />
            Completed engagements
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent engagements</h2>
            <p>The latest connections made in the field</p>
          </div>
          <button className="text-button" onClick={() => go("engagements")}>
            View all
            <ArrowUpRight size={16} />
          </button>
        </div>
        <EngagementTable
          records={engagements.slice(0, 5)}
          {...{ hcpName, repName, open }}
        />
      </section>
      <div className="field-note">
        <div className="field-note-icon">
          <Cloud size={24} />
        </div>
        <div>
          <strong>
            {ws.offlineReady
              ? "Ready when the signal isn’t."
              : "Getting your workspace ready."}
          </strong>
          <p>
            {ws.offlineReady
              ? "Your downloaded records and saved drafts are available offline. New work syncs automatically when you reconnect."
              : "Open the production app online to download the offline app shell and your records."}
          </p>
        </div>
        <Badge tone={ws.offlineReady ? "green" : "amber"}>
          {ws.offlineReady ? "Offline enabled" : "Preparing"}
        </Badge>
      </div>
    </>
  );
}

function Directory({ user, hcps, mayEdit, open }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = hcps.filter(
    (h) =>
      (filter === "all" || h.data.masterlist === (filter === "master")) &&
      [
        h.data.name,
        h.data.address,
        h.data.externalId,
        h.data.medretailersId,
      ].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  return (
    <>
      <PageHeading
        eyebrow="BUILD STRONGER CONNECTIONS"
        title="HCP directory"
        description="Your approved masterlist and new connections, in one place."
      >
        {user.role === "admin" && (
          <button className="button secondary" onClick={() => open("import")}>
            <Upload size={16} />
            Import masterlist
          </button>
        )}
        <button className="button" onClick={() => open("hcp")}>
          <Plus size={18} />
          Add HCP
        </button>
      </PageHeading>
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search HCPs"
              placeholder="Search name, address or source ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Masterlist filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All HCPs ({hcps.length})</option>
            <option value="master">Approved masterlist</option>
            <option value="other">Non-masterlist</option>
          </select>
        </div>
        {!filtered.length ? (
          <Empty title="No HCPs to show">
            Add an HCP or import your approved masterlist to begin.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>HCP / contact</th>
                  <th>Classification</th>
                  <th>Institution</th>
                  <th>Masterlist</th>
                  <th>Sync</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <div className="person-cell">
                        <span className="avatar light">
                          {h.data.name
                            .replace(/^Dr\.\s*/, "")
                            .split(" ")
                            .map((s) => s[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <div>
                          <strong>{h.data.name}</strong>
                          <small>
                            {h.data.email ||
                              h.data.phone ||
                              "Contact not provided"}
                          </small>
                          <small>{h.data.address}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {h.data.classification}
                      <small>{h.data.dispensing}</small>
                    </td>
                    <td>{h.data.institution}</td>
                    <td>
                      <Badge tone={h.data.masterlist ? "green" : "amber"}>
                        {h.data.masterlist ? "Approved" : "Non-masterlist"}
                      </Badge>
                      <small>{h.data.externalId || "Manually added"}</small>
                      {h.data.medretailersId && (
                        <small>Medretailers: {h.data.medretailersId}</small>
                      )}
                    </td>
                    <td>
                      <SyncBadge record={h} />
                    </td>
                    <td>
                      {mayEdit(h) && (
                        <button
                          className="text-button"
                          onClick={() => open("hcp", h)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Planning({ user, plans, engagements, hcpName, repName, open }) {
  const [date, setDate] = useState(today());
  const [view, setView] = useState("list");
  const [all, setAll] = useState(false);
  const completed = new Set(engagements.map((e) => e.data.planId));
  const shown = plans.filter(
    (p) => p.data.date === date && (all || p.ownerId === user.id),
  );
  const shift = (delta) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDate(localDate(d));
  };
  return (
    <>
      <PageHeading
        eyebrow="MAKE EVERY VISIT COUNT"
        title="Call planning"
        description="Build your itinerary and compare planned calls with actual engagements."
      >
        <button className="button" onClick={() => open("plan")}>
          <Plus size={18} />
          Plan a call
        </button>
      </PageHeading>
      <section className="panel">
        <div className="toolbar">
          <div className="date-controls">
            <button
              className="icon-button"
              aria-label="Previous day"
              onClick={() => shift(-1)}
            >
              <ChevronLeft size={19} />
            </button>
            <input
              aria-label="Itinerary date"
              type="date"
              required
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
            <button
              className="icon-button"
              aria-label="Next day"
              onClick={() => shift(1)}
            >
              <ChevronRight size={19} />
            </button>
            <button className="text-button" onClick={() => setDate(today())}>
              Today
            </button>
          </div>
          <div className="toolbar-options">
            {user.role === "admin" && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => setAll(e.target.checked)}
                />
                Team calls
              </label>
            )}
            <div className="segmented">
              <button
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
              >
                Itinerary
              </button>
              <button
                className={view === "gantt" ? "active" : ""}
                onClick={() => setView("gantt")}
              >
                Gantt view
              </button>
              <button
                className={view === "week" ? "active" : ""}
                onClick={() => setView("week")}
              >
                Week
              </button>
            </div>
          </div>
        </div>
        {view === "week" ? (
          <div className="week-grid">
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(date + "T12:00:00");
              d.setDate(d.getDate() + i);
              const day = localDate(d);
              const items = plans.filter(
                (p) => p.data.date === day && (all || p.ownerId === user.id),
              );
              return (
                <div className="week-day" key={day}>
                  <button
                    onClick={() => {
                      setDate(day);
                      setView("list");
                    }}
                  >
                    <strong>
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </strong>
                    <span>{d.getDate()}</span>
                  </button>
                  {items.map((p) => (
                    <button
                      className={
                        "week-event " + (completed.has(p.id) ? "done" : "")
                      }
                      key={p.id}
                      onClick={() => {
                        setDate(day);
                        setView("list");
                      }}
                    >
                      <b>{p.data.startTime}</b>
                      <span>{hcpName(p.data.hcpId)}</span>
                      <small>
                        {completed.has(p.id) ? "Completed" : p.data.status}
                      </small>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : !shown.length ? (
          <Empty
            title="A fresh day to plan"
            action={
              <button
                className="button secondary small"
                onClick={() => open("plan")}
              >
                Add a planned call
              </button>
            }
          >
            No calls scheduled for {fmtDate(date)}.
          </Empty>
        ) : view === "gantt" ? (
          <div className="gantt-scroll">
            <div className="gantt">
              <div className="gantt-head">
                <span>HCP / representative</span>
                <div>
                  {[0, 4, 8, 12, 16, 20, 24].map((h) => (
                    <span key={h}>{String(h).padStart(2, "0")}:00</span>
                  ))}
                </div>
              </div>
              {shown.map((p) => {
                const [h, m] = p.data.startTime.split(":").map(Number);
                const actual = engagements.find((e) => e.data.planId === p.id);
                return (
                  <div className="gantt-row" key={p.id}>
                    <div>
                      <strong>{hcpName(p.data.hcpId)}</strong>
                      <small>
                        {repName(p.ownerId)} ·{" "}
                        {completed.has(p.id) ? "Completed" : p.data.status}
                      </small>
                    </div>
                    <div className="gantt-track">
                      <div
                        className={
                          "gantt-bar " +
                          (p.data.status === "Cancelled" ? "cancelled" : "")
                        }
                        style={{
                          left: `${((h * 60 + m) / 1440) * 100}%`,
                          width: `${(Math.min(p.data.duration, 1440 - h * 60 - m) / 1440) * 100}%`,
                        }}
                        title={`Planned ${p.data.startTime}, ${p.data.duration} minutes`}
                      >
                        <span>{p.data.startTime}</span>
                      </div>
                      {actual &&
                        localDate(new Date(actual.data.actualAt)) === date && (
                          <div
                            className="gantt-bar actual"
                            style={{
                              left: `${((new Date(actual.data.actualAt).getHours() * 60 + new Date(actual.data.actualAt).getMinutes()) / 1440) * 100}%`,
                              width: `${(Math.min(actual.data.durationSeconds / 60, 1440 - (new Date(actual.data.actualAt).getHours() * 60 + new Date(actual.data.actualAt).getMinutes())) / 1440) * 100}%`,
                            }}
                            title={`Actual ${fmtTime(actual.data.actualAt)}, ${elapsed(actual.data.durationSeconds)}`}
                          />
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="gantt-legend">
              <span />
              Planned <span />
              Actual · calls completed on another date appear in reports
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>HCP / objective</th>
                  <th>Representative</th>
                  <th>Status</th>
                  <th>Sync</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.data.startTime}</strong>
                      <small>{p.data.duration} minutes</small>
                    </td>
                    <td>
                      <strong>{hcpName(p.data.hcpId)}</strong>
                      <small>{p.data.notes || "HCP visit"}</small>
                    </td>
                    <td>{repName(p.ownerId)}</td>
                    <td>
                      <Badge
                        tone={
                          completed.has(p.id)
                            ? "green"
                            : p.data.status === "Cancelled"
                              ? "neutral"
                              : "blue"
                        }
                      >
                        {completed.has(p.id) ? "Completed" : p.data.status}
                      </Badge>
                    </td>
                    <td>
                      <SyncBadge record={p} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {!completed.has(p.id) &&
                          (user.role === "admin" || p.ownerId === user.id) && (
                            <button
                              className="text-button"
                              onClick={() => open("plan", p)}
                            >
                              Edit
                            </button>
                          )}
                        {!completed.has(p.id) &&
                          p.data.status === "Planned" &&
                          p.ownerId === user.id && (
                            <button
                              className="button secondary small"
                              onClick={() =>
                                open("engagement", null, { plan: p })
                              }
                            >
                              Start visit
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="page-note">
        Times use this device’s time zone. Completed calls retain their original
        planned date. Rescheduling and cancellation are available before
        completion.
      </p>
    </>
  );
}

function EngagementTable({ records, hcpName, repName, open }) {
  return records.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>HCP</th>
            <th>Actual engagement</th>
            <th>Detailing</th>
            <th>Patients seen</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {records.map((e) => (
            <tr key={e.id}>
              <td>
                <strong>
                  {e.data.hcpSnapshot?.name || hcpName(e.data.hcpId)}
                </strong>
                <small>{repName(e.ownerId)}</small>
              </td>
              <td>
                {fmtTime(e.data.actualAt)}
                <small>
                  {e.data.planId ? "Planned call" : "Unplanned engagement"}
                </small>
              </td>
              <td>{elapsed(e.data.durationSeconds)}</td>
              <td>{e.data.patients}</td>
              <td>
                <SyncBadge record={e} />
              </td>
              <td>
                <button
                  className="text-button"
                  onClick={() => open("detail", e)}
                >
                  View
                  <ArrowUpRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Your next connection starts here">
      Record an engagement to capture the visit, samples, and follow-through.
    </Empty>
  );
}
function Engagements({ engagements, hcpName, repName, open }) {
  const [search, setSearch] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="A RECORD OF EVERY CONNECTION"
        title="Engagements"
        description="Visit details, documentation, and outcomes—available in one place."
      >
        <button className="button" onClick={() => open("engagement")}>
          <Plus size={18} />
          New engagement
        </button>
      </PageHeading>
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search engagements"
              placeholder="Search HCP or order number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Badge>{engagements.length} engagements</Badge>
        </div>
        <EngagementTable
          records={engagements.filter((e) =>
            [
              e.data.hcpSnapshot?.name || hcpName(e.data.hcpId),
              ...e.data.orderNumbers,
            ].some((v) => v.toLowerCase().includes(search.toLowerCase())),
          )}
          {...{ hcpName, repName, open }}
        />
      </section>
    </>
  );
}
function EngagementDetail({ record, hcpName, repName, plans, skus }) {
  const d = record.data;
  const plan = plans.find((p) => p.id === d.planId);
  return (
    <div className="detail">
      <div className="detail-title">
        <div>
          <h2>{d.hcpSnapshot?.name || hcpName(d.hcpId)}</h2>
          <p>{repName(record.ownerId)}</p>
        </div>
        <SyncBadge record={record} />
      </div>
      <div className="detail-grid">
        {[
          [
            "Planned date",
            plan
              ? fmtDate(plan.data.date) + " " + plan.data.startTime
              : "Unplanned",
          ],
          ["Actual engagement", fmtTime(d.actualAt)],
          ["Sync date", fmtTime(record.syncedAt)],
          ["Detailing duration", elapsed(d.durationSeconds)],
          ["Patients seen", d.patients],
          [
            "Masterlist at engagement",
            d.hcpSnapshot?.masterlist ? "Approved" : "Non-masterlist",
          ],
          ["Institution", d.hcpSnapshot?.institution || "—"],
          ["Classification", d.hcpSnapshot?.classification || "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <h3>Notes</h3>
      <p className="pre-wrap">{d.notes || "No additional notes."}</p>
      <h3>Booked sales</h3>
      <p>
        {d.orderNumbers.join(", ") || "No booked orders."}{" "}
        {!!d.orderNumbers.length && <Badge tone="amber">Unverified</Badge>}
      </p>
      <h3>Samples distributed</h3>
      {d.samples.length ? (
        <ul>
          {d.samples.map((s) => (
            <li key={s.skuId}>
              {d.sampleSnapshots?.find((k) => k.skuId === s.skuId)?.name ||
                skus.find((k) => k.id === s.skuId)?.data.name ||
                s.skuId}{" "}
              · {s.quantity} units
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No samples distributed.</p>
      )}
      <h3>Gallery documentation</h3>
      <div className="detail-photos">
        {d.photos.map((photo, i) => (
          <a
            key={i}
            href={photo}
            download={`engagement-${record.id}-photo-${i + 1}`}
          >
            <img src={photo} alt={"Engagement photo " + (i + 1)} />
          </a>
        ))}
      </div>
      <h3>HCP signature</h3>
      <img
        className="signature-image"
        src={d.signature}
        alt="Captured HCP signature"
      />
      <p className="page-note">
        Submitted engagements are retained as recorded. Use a follow-up
        engagement to document corrections.
      </p>
    </div>
  );
}

function Samples({ user, skus, engagements, open }) {
  return (
    <>
      <PageHeading
        eyebrow="SUPPORT EVERY CONVERSATION"
        title="Sample catalog"
        description="Approved products and the samples distributed in your engagements."
      >
        {user.role === "admin" && (
          <button className="button" onClick={() => open("sku")}>
            <Plus size={18} />
            Add SKU
          </button>
        )}
      </PageHeading>
      <div className="alert info">
        Distribution tracking is active. Inventory balances, allocations, and
        returns await confirmation of your sampling rules.
      </div>
      <section className="panel">
        {!skus.length ? (
          <Empty title="Set up your sample catalog">
            An administrator can add approved SKUs before representatives
            distribute samples.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Availability</th>
                  <th>Units distributed</th>
                  <th>Sync</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {skus.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.data.name}</strong>
                    </td>
                    <td>{s.data.code}</td>
                    <td>
                      <Badge tone={s.data.active ? "green" : "neutral"}>
                        {s.data.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td>
                      {engagements.reduce(
                        (n, e) =>
                          n +
                          e.data.samples
                            .filter((k) => k.skuId === s.id)
                            .reduce((m, k) => m + k.quantity, 0),
                        0,
                      )}
                    </td>
                    <td>
                      <SyncBadge record={s} />
                    </td>
                    <td>
                      {user.role === "admin" && (
                        <button
                          className="text-button"
                          onClick={() => open("sku", s)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Reports({
  user,
  accounts,
  engagements,
  plans,
  hcps,
  skus,
  hcpName,
  repName,
}) {
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [master, setMaster] = useState("all");
  const [institution, setInstitution] = useState("all");
  const [owner, setOwner] = useState("all");
  const [synced, setSynced] = useState("all");
  const selected = engagements.filter((e) => {
    const day = localDate(new Date(e.data.actualAt));
    const h =
      e.data.hcpSnapshot || hcps.find((h) => h.id === e.data.hcpId)?.data || {};
    return (
      (!from || day >= from) &&
      (!to || day <= to) &&
      (master === "all" || h.masterlist === (master === "master")) &&
      (institution === "all" || h.institution === institution) &&
      (owner === "all" || e.ownerId === owner) &&
      (synced === "all" || e.pending === (synced === "pending"))
    );
  });
  const rows = selected.map((e) => {
    const d = e.data;
    const p = plans.find((p) => p.id === d.planId);
    const h = d.hcpSnapshot || hcps.find((h) => h.id === d.hcpId)?.data || {};
    return {
      engagement_id: e.id,
      representative: repName(e.ownerId),
      hcp: h.name || hcpName(d.hcpId),
      masterlist: h.masterlist ? "Approved" : "Non-masterlist",
      classification: h.classification,
      institution: h.institution,
      planned_date: p?.data.date || "",
      actual_date: d.actualAt,
      sync_date: e.syncedAt || "",
      duration_seconds: d.durationSeconds,
      patients_seen: d.patients,
      sample_units: d.samples.reduce((n, s) => n + s.quantity, 0),
      order_numbers: d.orderNumbers.join("; "),
      order_validation: "Unverified",
      sync_status: e.pending ? "Pending" : "Synced",
      notes: d.notes,
    };
  });
  const sampleRows = selected.flatMap((e) =>
    e.data.samples.map((s) => ({
      engagement_id: e.id,
      representative: repName(e.ownerId),
      hcp: e.data.hcpSnapshot?.name || hcpName(e.data.hcpId),
      actual_date: e.data.actualAt,
      sku:
        e.data.sampleSnapshots?.find((k) => k.skuId === s.skuId)?.code ||
        skus.find((k) => k.id === s.skuId)?.data.code ||
        s.skuId,
      quantity: s.quantity,
      sync_status: e.pending ? "Pending" : "Synced",
    })),
  );
  const orderRows = selected.flatMap((e) =>
    e.data.orderNumbers.map((order) => ({
      engagement_id: e.id,
      representative: repName(e.ownerId),
      hcp: e.data.hcpSnapshot?.name || hcpName(e.data.hcpId),
      actual_date: e.data.actualAt,
      medretailers_order_number: order,
      validation: "Unverified",
      sync_status: e.pending ? "Pending" : "Synced",
    })),
  );
  const sampleTotal = sampleRows.reduce((n, r) => n + r.quantity, 0);
  const matchingPlans = plans.filter((p) => {
    const h = hcps.find((h) => h.id === p.data.hcpId)?.data || {};
    return (
      (!from || p.data.date >= from) &&
      (!to || p.data.date <= to) &&
      (owner === "all" || p.ownerId === owner) &&
      (master === "all" || h.masterlist === (master === "master")) &&
      (institution === "all" || h.institution === institution) &&
      (synced === "all" || p.pending === (synced === "pending"))
    );
  });
  const planRows = matchingPlans.map((p) => {
    const e = engagements.find((e) => e.data.planId === p.id);
    return {
      plan_id: p.id,
      representative: repName(p.ownerId),
      hcp: hcpName(p.data.hcpId),
      planned_date: p.data.date,
      planned_time: p.data.startTime,
      planned_minutes: p.data.duration,
      status: e ? "Completed" : p.data.status,
      actual_date: e?.data.actualAt || "",
      actual_seconds: e?.data.durationSeconds || "",
      sync_status: p.pending ? "Pending" : "Synced",
    };
  });
  return (
    <>
      <PageHeading
        eyebrow="TURN ACTIVITY INTO INSIGHT"
        title="Field reports"
        description="Review coverage, detailing, samples, and booked order references."
      />
      <section className="panel report-filters">
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Masterlist">
          <select value={master} onChange={(e) => setMaster(e.target.value)}>
            <option value="all">All HCPs</option>
            <option value="master">Approved</option>
            <option value="other">Non-masterlist</option>
          </select>
        </Field>
        <Field label="Institution">
          <select
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Sync status">
          <select value={synced} onChange={(e) => setSynced(e.target.value)}>
            <option value="all">All records</option>
            <option value="synced">Synced</option>
            <option value="pending">Pending</option>
          </select>
        </Field>
        {user.role === "admin" && (
          <Field label="Representative">
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="all">All team members</option>
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </section>
      <div className="stats-grid">
        <Stat
          label="Engagements"
          value={selected.length}
          note={`${new Set(selected.map((e) => e.data.hcpId)).size} unique HCPs reached`}
          icon={ClipboardCheck}
        />
        <Stat
          label="Detailing time"
          value={
            Math.round(
              selected.reduce((n, e) => n + e.data.durationSeconds, 0) / 60,
            ) + "m"
          }
          note="Total recorded duration"
          icon={Clock3}
          tone="blue"
        />
        <Stat
          label="Samples given"
          value={sampleTotal}
          note={`${new Set(sampleRows.map((r) => r.sku)).size} SKUs distributed`}
          icon={Package}
          tone="purple"
        />
        <Stat
          label="Booked orders"
          value={orderRows.length}
          note="References only · unverified"
          icon={BarChart3}
          tone="amber"
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Engagement report</h2>
            <p>{selected.length} matching records · device time zone</p>
          </div>
          <div className="row-actions">
            <CsvButton name="engagements.csv" rows={rows}>
              Engagements CSV
            </CsvButton>
            <CsvButton name="sample-distribution.csv" rows={sampleRows}>
              Samples CSV
            </CsvButton>
            <CsvButton name="booked-sales.csv" rows={orderRows}>
              Orders CSV
            </CsvButton>
            <CsvButton name="planned-vs-actual.csv" rows={planRows}>
              Plans CSV
            </CsvButton>
          </div>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>HCP</th>
                  <th>Representative</th>
                  <th>Actual date</th>
                  <th>Masterlist</th>
                  <th>Patients</th>
                  <th>Samples</th>
                  <th>Orders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.engagement_id}>
                    <td>
                      <strong>{r.hcp}</strong>
                      <small>{r.institution}</small>
                    </td>
                    <td>{r.representative}</td>
                    <td>
                      {fmtTime(r.actual_date)}
                      <small>{r.sync_status}</small>
                    </td>
                    <td>
                      <Badge
                        tone={r.masterlist === "Approved" ? "green" : "amber"}
                      >
                        {r.masterlist}
                      </Badge>
                    </td>
                    <td>{r.patients_seen}</td>
                    <td>{r.sample_units}</td>
                    <td>{r.order_numbers || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No engagements in this range">
            Adjust the dates or filters to explore your field activity.
          </Empty>
        )}
      </section>
      <p className="page-note">
        Engagement classifications are preserved at capture and confirmed at
        sync. Plans CSV uses planned dates; other exports use actual engagement
        dates. Reports include pending local records when selected.
      </p>
    </>
  );
}

function SyncCenter({ ws, open, notify }) {
  const [busy, setBusy] = useState(false);
  const exportBackup = async () => {
    const backup = {
      format: "psl-offline-backup-v1",
      createdAt: new Date().toISOString(),
      records: await ws.db.getAll("records"),
      outbox: await ws.db.getAll("outbox"),
      drafts: await Promise.all(
        (await ws.db.getAllKeys("drafts")).map(async (key) => ({
          key,
          data: await ws.db.get("drafts", key),
        })),
      ),
    };
    download("psl-offline-backup.json", JSON.stringify(backup));
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORK, SAFELY CONNECTED"
        title="Sync center"
        description="Review pending changes and keep your field records in sync."
      >
        <button
          className="button secondary"
          disabled={!ws.db}
          onClick={() => exportBackup().catch((e) => notify(e.message))}
        >
          <Download size={16} />
          Export local backup
        </button>
        <button
          className="button"
          disabled={!ws.online || ws.syncState === "syncing"}
          onClick={() => ws.sync(true)}
        >
          <RefreshCw
            size={16}
            className={ws.syncState === "syncing" ? "spin" : ""}
          />
          Sync now
        </button>
      </PageHeading>
      <div className="sync-summary panel">
        <div className="sync-cloud">
          <Cloud size={32} />
        </div>
        <div>
          <h2>
            {!ws.online
              ? "Working offline"
              : ws.syncState === "auth"
                ? "Sign in to reconnect"
                : ws.syncState === "syncing"
                  ? "Syncing your workspace…"
                  : ws.syncState === "offline"
                    ? "Waiting for the server"
                    : ws.queue.length
                      ? "Your work is saved on this device"
                      : "Everything is up to date"}
          </h2>
          <p>Last successful sync: {fmtTime(ws.lastSync)}</p>
          <p>
            {ws.offlineReady
              ? "Offline app shell is ready."
              : "Offline app shell is not ready on this browser."}
          </p>
        </div>
        <Badge tone={ws.queue.length ? "amber" : "green"}>
          {ws.queue.length} pending
        </Badge>
      </div>
      {ws.syncError && (
        <div className="alert error">
          {ws.syncError}
          {ws.syncState === "auth" && (
            <button className="text-button" onClick={() => open("login")}>
              Sign in
            </button>
          )}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Sync queue</h2>
            <p>
              Records and their attachments sync together. Interrupted transfers
              retry safely.
            </p>
          </div>
        </div>
        {!ws.queue.length ? (
          <Empty title="All caught up">
            New offline work will appear here until it reaches the server.
          </Empty>
        ) : (
          <div className="queue-list">
            {ws.queue.map((item) => (
              <div className="queue-item" key={item.seq}>
                <span className={"queue-icon " + item.status}>
                  {item.status === "pending" ? (
                    <Cloud size={20} />
                  ) : (
                    <AlertCircle size={20} />
                  )}
                </span>
                <div>
                  <strong>
                    {item.mutation.entity} ·{" "}
                    {item.mutation.data.name ||
                      ws.records.find((r) => r.id === item.mutation.data.hcpId)
                        ?.data.name ||
                      item.mutation.id.slice(0, 8)}
                  </strong>
                  <p>{item.error || "Waiting to sync automatically"}</p>
                  <small>
                    {fmtTime(item.createdAt)} · version{" "}
                    {item.mutation.baseVersion + 1}
                  </small>
                </div>
                <Badge tone={item.status === "pending" ? "blue" : "amber"}>
                  {item.status === "pending"
                    ? "Pending"
                    : item.status === "conflict"
                      ? "Conflict"
                      : "Needs attention"}
                </Badge>
                {item.status === "conflict" && (
                  <button
                    className="button secondary small"
                    onClick={() => open("conflict", null, { item })}
                  >
                    Review
                  </button>
                )}
                {item.status === "error" && (
                  <div className="row-actions">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await ws.db.put("outbox", {
                            ...item,
                            status: "pending",
                            error: null,
                          });
                          await ws.changed();
                        } catch (e) {
                          notify(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Retry
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        const record = ws.records.find(
                          (r) => r.key === item.key,
                        );
                        open(
                          {
                            hcps: "hcp",
                            plans: "plan",
                            skus: "sku",
                            engagements: "engagement",
                          }[item.mutation.entity],
                          record,
                          { rejected: item },
                        );
                      }}
                    >
                      Correct
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="field-note">
        <div>
          <strong>Offline use, with a few practical limits</strong>
          <p>
            Keep this browser’s site data to retain unsynced work. Automatic
            sync runs while the app is open and resumes when reopened.
            Closed-app background sync depends on device support. Local backups
            include photos, signatures, and contact details; store them
            securely.
          </p>
        </div>
      </div>
    </>
  );
}
function Conflict({ item, db, onResolved, onClose }) {
  const [local, setLocal] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    db.get("records", item.key).then(setLocal);
  }, [db, item.key]);
  const resolve = async (choice) => {
    setBusy(true);
    try {
      await resolveConflict(db, item, choice);
      await onResolved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        Another device changed this record. Review both versions before choosing
        which to keep. Your local version remains saved until you decide.
      </p>
      <div className="conflict-grid">
        <div>
          <h3>This device</h3>
          <pre>{JSON.stringify(local?.data, null, 2)}</pre>
        </div>
        <div>
          <h3>Server · version {item.current?.version}</h3>
          <pre>{JSON.stringify(item.current?.data, null, 2)}</pre>
        </div>
      </div>
      {error && <p className="alert error">{error}</p>}
      <div className="form-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => resolve("server")}
        >
          Use server version
        </button>
        <button
          className="button"
          disabled={busy || !local}
          onClick={() => resolve("local")}
        >
          Keep my changes
        </button>
      </div>
    </>
  );
}

function AccountSettings({
  user,
  accounts,
  setAccounts,
  notify,
  onPasswordChanged,
}) {
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE SETTINGS"
        title="Settings"
        description="Manage your account and the people in your field team."
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Your account</h2>
            <p>{user.email}</p>
          </div>
          <Badge tone="green">
            {user.role === "admin" ? "Administrator" : "Medical representative"}
          </Badge>
        </div>
        <div className="settings-body">
          <strong>{user.name}</strong>
          <button
            className="button secondary small"
            onClick={() => setPassword(true)}
          >
            Change password
          </button>
        </div>
      </section>
      {user.role === "admin" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Team accounts</h2>
              <p>Account management requires a server connection.</p>
            </div>
            <button className="button small" onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add account
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <small>{a.email}</small>
                    </td>
                    <td>{a.role}</td>
                    <td>
                      <Badge tone={a.active ? "green" : "neutral"}>
                        {a.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td>
                      {a.id !== user.id && (
                        <button
                          className="text-button"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `${a.active ? "Deactivate" : "Reactivate"} ${a.name}?`,
                              )
                            )
                              return;
                            try {
                              await api("/users/" + a.id, {
                                method: "PATCH",
                                body: JSON.stringify({ active: !a.active }),
                              });
                              setAccounts((await api("/users")).users);
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          {a.active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Implementation assumptions</h2>
            <p>Business rules that can be refined after testing</p>
          </div>
        </div>
        <div className="settings-body assumptions">
          <p>
            <strong>Masterlist:</strong> Admin-managed CSV imports with stable
            source IDs and explicit Medretailers mappings.
          </p>
          <p>
            <strong>Non-masterlist HCPs:</strong> Allowed and reported
            separately. Visible to the creator and administrators until
            approved.
          </p>
          <p>
            <strong>Detailing:</strong> Start/stop timer with device timestamps.
            No manual duration overrides.
          </p>
          <p>
            <strong>Samples:</strong> SKU catalog and distribution quantities;
            inventory balances are not enabled.
          </p>
          <p>
            <strong>Booked sales:</strong> Manually recorded order references
            marked unverified. No external Medretailers connection is
            configured.
          </p>
          <p>
            <strong>Planning:</strong> Daily itineraries, a seven-day calendar,
            and a daily Gantt comparison. No approval workflow or targets
            assumed.
          </p>
        </div>
      </section>
      {adding && (
        <Modal title="Add team account" onClose={() => setAdding(false)}>
          <Form
            onCancel={() => setAdding(false)}
            onSubmit={async (e) => {
              const data = Object.fromEntries(new FormData(e.currentTarget));
              await api("/users", {
                method: "POST",
                body: JSON.stringify(data),
              });
              setAccounts((await api("/users")).users);
              setAdding(false);
              notify("Account created. Share access details securely.");
            }}
          >
            <div className="form-grid">
              <Field label="Full name" wide>
                <input name="name" required maxLength={160} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required />
              </Field>
              <Field label="Role">
                <select name="role">
                  <option value="medrep">Medical representative</option>
                  <option value="admin">Administrator</option>
                </select>
              </Field>
              <Field label="Initial password (12+ characters)" wide>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          </Form>
        </Modal>
      )}
      {password && (
        <Modal title="Change your password" onClose={() => setPassword(false)}>
          <Form
            onCancel={() => setPassword(false)}
            onSubmit={async (e) => {
              await api("/auth/password", {
                method: "POST",
                body: JSON.stringify(
                  Object.fromEntries(new FormData(e.currentTarget)),
                ),
              });
              setPassword(false);
              onPasswordChanged();
            }}
          >
            <Field label="Current password">
              <input
                name="current"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password (12+ characters)">
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={200}
                required
                autoComplete="new-password"
              />
            </Field>
            <p className="muted">
              Changing your password signs out online sessions. Your offline
              work is retained.
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}

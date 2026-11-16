import React, { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { Play, Square, Plus, Trash2, Clock3 } from "lucide-react";
import { categories, schemas } from "../server/schema.js";
import {
  Field,
  Form,
  Signature,
  PhotoInput,
  today,
  elapsed,
  exportCsv,
} from "./components.jsx";

const blankHcp = {
  name: "",
  email: "",
  phone: "",
  address: "",
  dispensing: "Non-dispensing",
  classification: "General Practitioner",
  institution: categories[0],
  masterlist: false,
  externalId: "",
  medretailersId: "",
  notes: "",
};
export function HcpForm({ record, user, onSave, onClose }) {
  const [data, setData] = useState(record?.data || blankHcp);
  const field = (key) => ({
    value: data[key],
    onChange: (e) => setData({ ...data, [key]: e.target.value }),
  });
  return (
    <Form
      onCancel={onClose}
      onSubmit={async () => {
        const parsed = schemas.hcps.parse(data);
        if (parsed.masterlist && !parsed.externalId)
          throw new Error("Approved HCPs require a masterlist source ID.");
        await onSave(parsed);
      }}
    >
      <div className="form-grid">
        <Field label="HCP full name" wide>
          <input required maxLength={160} {...field("name")} autoFocus />
        </Field>
        <Field label="Email">
          <input type="email" {...field("email")} />
        </Field>
        <Field label="Phone">
          <input type="tel" maxLength={50} {...field("phone")} />
        </Field>
        <Field label="Clinic / address" wide>
          <input maxLength={500} {...field("address")} />
        </Field>
        <Field label="Dispensing status">
          <select {...field("dispensing")}>
            <option>Non-dispensing</option>
            <option>Dispensing</option>
          </select>
        </Field>
        <Field label="HCP classification">
          <input
            required
            maxLength={160}
            {...field("classification")}
            list="hcp-classes"
          />
          <datalist id="hcp-classes">
            <option>General Practitioner</option>
            <option>Specialist</option>
            <option>Dentist</option>
          </datalist>
        </Field>
        <Field label="Institution category" wide>
          <select {...field("institution")}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {user.role === "admin" && (
          <>
            <label className="check-field wide">
              <input
                type="checkbox"
                checked={data.masterlist}
                onChange={(e) =>
                  setData({ ...data, masterlist: e.target.checked })
                }
              />
              Approved masterlist HCP
            </label>
            <Field
              label="Masterlist source ID"
              hint="Stable identifier from the approved source."
            >
              <input required={data.masterlist} {...field("externalId")} />
            </Field>
            <Field
              label="Medretailers HCP ID"
              hint="Explicit mapping; names are never auto-matched."
            >
              <input {...field("medretailersId")} />
            </Field>
          </>
        )}
        <Field label="Notes" wide>
          <textarea maxLength={500} {...field("notes")} />
        </Field>
      </div>
    </Form>
  );
}
export function PlanForm({ record, hcps, onSave, onClose }) {
  const [data, setData] = useState(
    record?.data || {
      hcpId: "",
      date: today(),
      startTime: "09:00",
      duration: 30,
      status: "Planned",
      notes: "",
    },
  );
  const field = (key) => ({
    value: data[key],
    onChange: (e) =>
      setData({
        ...data,
        [key]: key === "duration" ? Number(e.target.value) : e.target.value,
      }),
  });
  return (
    <Form onCancel={onClose} onSubmit={() => onSave(schemas.plans.parse(data))}>
      <div className="form-grid">
        <Field label="HCP" wide>
          <select required {...field("hcpId")}>
            <option value="">Choose an HCP</option>
            {hcps.map((h) => (
              <option key={h.id} value={h.id}>
                {h.data.name}
                {h.data.masterlist ? " · Masterlist" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Planned date">
          <input type="date" required {...field("date")} />
        </Field>
        <Field label="Start time">
          <input type="time" required {...field("startTime")} />
        </Field>
        <Field label="Duration (minutes)">
          <input
            type="number"
            min="5"
            max="480"
            required
            {...field("duration")}
          />
        </Field>
        <Field label="Status">
          <select {...field("status")}>
            <option>Planned</option>
            <option>Cancelled</option>
          </select>
        </Field>
        <Field label="Visit objective / itinerary notes" wide>
          <textarea maxLength={500} {...field("notes")} />
        </Field>
      </div>
    </Form>
  );
}
export function SkuForm({ record, onSave, onClose }) {
  const [data, setData] = useState(
    record?.data || { code: "", name: "", active: true },
  );
  return (
    <Form onCancel={onClose} onSubmit={() => onSave(schemas.skus.parse(data))}>
      <div className="form-grid">
        <Field label="SKU code">
          <input
            required
            maxLength={160}
            value={data.code}
            onChange={(e) => setData({ ...data, code: e.target.value })}
          />
        </Field>
        <Field label="Product name">
          <input
            required
            maxLength={160}
            value={data.name}
            onChange={(e) => setData({ ...data, name: e.target.value })}
          />
        </Field>
        <label className="check-field wide">
          <input
            type="checkbox"
            checked={data.active}
            onChange={(e) => setData({ ...data, active: e.target.checked })}
          />
          Available for sampling
        </label>
      </div>
      <p className="muted">
        This catalog tracks distribution. Stock balances and inventory
        allocations are not enabled.
      </p>
    </Form>
  );
}

export function EngagementForm({
  db,
  hcps,
  plans,
  engagements,
  skus,
  plan,
  record,
  onSave,
  onClose,
}) {
  const draftKey = "engagement:" + (record?.id || "new");
  const [data, setData] = useState(null);
  const [restored, setRestored] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [draftError, setDraftError] = useState("");
  const mounted = useRef(true);
  const latest = useRef(null);
  useEffect(() => {
    mounted.current = true;
    db.get("drafts", draftKey)
      .then((draft) => {
        if (!mounted.current) return;
        setRestored(!!draft);
        setData(
          draft ||
            record?.data || {
              hcpId: plan?.data.hcpId || "",
              planId: plan?.id || "",
              actualAt: "",
              endedAt: "",
              patients: 0,
              notes: "",
              photos: [],
              signature: "",
              samples: [],
              orderNumbers: [],
            },
        );
      })
      .catch((e) => setDraftError(e.message));
    return () => {
      mounted.current = false;
    };
  }, [db, draftKey]);
  useEffect(() => {
    if (!data) return;
    latest.current = data;
    db.put("drafts", data, draftKey).catch((e) =>
      setDraftError("Draft could not be saved: " + e.message),
    );
  }, [data, db, draftKey]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!data)
    return <p className="muted">{draftError || "Opening saved draft…"}</p>;
  const update = (change) => setData((d) => ({ ...d, ...change }));
  const seconds = data.actualAt
    ? Math.max(
        0,
        Math.round(
          ((data.endedAt ? Date.parse(data.endedAt) : tick) -
            Date.parse(data.actualAt)) /
            1000,
        ),
      )
    : 0;
  const donePlans = new Set(engagements.map((e) => e.data.planId));
  const available = plans.filter(
    (p) =>
      p.data.hcpId === data.hcpId &&
      p.data.status === "Planned" &&
      !donePlans.has(p.id),
  );
  return (
    <Form
      submit="Save engagement"
      onCancel={onClose}
      onSubmit={async () => {
        if (!data.actualAt)
          throw new Error("Start detailing before saving the engagement.");
        if (!data.signature) throw new Error("Capture the HCP signature.");
        if (!data.photos.length)
          throw new Error("Add at least one gallery photo.");
        const endedAt = data.endedAt || new Date().toISOString();
        const result = schemas.engagements.safeParse({
          ...data,
          endedAt,
          durationSeconds: Math.round(
            (Date.parse(endedAt) - Date.parse(data.actualAt)) / 1000,
          ),
        });
        if (!result.success)
          throw new Error(result.error.issues.map((i) => i.message).join(" "));
        const hcp = hcps.find((h) => h.id === data.hcpId);
        await onSave({
          ...result.data,
          hcpSnapshot: {
            name: hcp.data.name,
            masterlist: hcp.data.masterlist,
            institution: hcp.data.institution,
            classification: hcp.data.classification,
            externalId: hcp.data.externalId,
          },
          sampleSnapshots: data.samples.map((s) => ({
            ...s,
            ...skus.find((k) => k.id === s.skuId)?.data,
          })),
          orderValidation: "Unverified",
        });
        await db.delete("drafts", draftKey);
      }}
    >
      {restored && (
        <p className="alert info">
          Your saved draft has been restored, including the detailing timer.
        </p>
      )}
      {draftError && <p className="alert error">{draftError}</p>}
      <div className="form-grid">
        <Field label="HCP" wide>
          <select
            required
            value={data.hcpId}
            onChange={(e) => update({ hcpId: e.target.value, planId: "" })}
          >
            <option value="">Choose an HCP</option>
            {hcps.map((h) => (
              <option key={h.id} value={h.id}>
                {h.data.name}
                {h.data.masterlist ? " · Masterlist" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Related planned call" wide>
          <select
            value={data.planId}
            onChange={(e) => update({ planId: e.target.value })}
          >
            <option value="">Unplanned engagement</option>
            {available.map((p) => (
              <option value={p.id} key={p.id}>
                {p.data.date} · {p.data.startTime}
              </option>
            ))}
          </select>
        </Field>
        <div className="timer wide">
          <div>
            <span>
              <Clock3 size={16} />
              Detailing duration
            </span>
            <strong>{elapsed(seconds)}</strong>
            <small>
              {data.endedAt
                ? "Timer stopped"
                : data.actualAt
                  ? "Timing continues if you close the app"
                  : "Start when detailing begins"}
            </small>
          </div>
          {!data.actualAt ? (
            <button
              type="button"
              className="button"
              onClick={() => update({ actualAt: new Date().toISOString() })}
            >
              <Play size={16} />
              Start detailing
            </button>
          ) : !data.endedAt ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => update({ endedAt: new Date().toISOString() })}
            >
              <Square size={15} />
              Stop timer
            </button>
          ) : (
            <span className="badge green">Recorded</span>
          )}
        </div>
        <Field label="Number of patients seen">
          <input
            type="number"
            min="0"
            max="100000"
            required
            value={data.patients}
            onChange={(e) => update({ patients: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Medretailers order numbers"
          hint="Separate multiple numbers with commas. Recorded as unverified."
        >
          <input
            value={data.orderNumbers.join(", ")}
            onChange={(e) =>
              update({
                orderNumbers: e.target.value.split(",").map((v) => v.trim()),
              })
            }
            onBlur={() =>
              update({ orderNumbers: data.orderNumbers.filter(Boolean) })
            }
          />
        </Field>
        <Field label="Engagement notes" wide>
          <textarea
            maxLength={500}
            value={data.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </Field>
        <div className="wide sample-section">
          <div className="section-line">
            <h3>Samples distributed</h3>
            <button
              type="button"
              className="text-button"
              disabled={!skus.some((s) => s.data.active)}
              onClick={() =>
                update({
                  samples: [...data.samples, { skuId: "", quantity: 1 }],
                })
              }
            >
              <Plus size={16} />
              Add SKU
            </button>
          </div>
          {!skus.some((s) => s.data.active) && (
            <p className="muted">
              No active SKUs. An administrator can configure the sample catalog.
            </p>
          )}
          {data.samples.map((sample, i) => (
            <div className="sample-row" key={i}>
              <select
                aria-label={"Sample SKU " + (i + 1)}
                required
                value={sample.skuId}
                onChange={(e) =>
                  update({
                    samples: data.samples.map((s, j) =>
                      j === i ? { ...s, skuId: e.target.value } : s,
                    ),
                  })
                }
              >
                <option value="">Choose SKU</option>
                {skus
                  .filter((s) => s.data.active || s.id === sample.skuId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.data.code} · {s.data.name}
                      {!s.data.active ? " (inactive)" : ""}
                    </option>
                  ))}
              </select>
              <input
                aria-label={"Sample quantity " + (i + 1)}
                type="number"
                min="1"
                max="100000"
                required
                value={sample.quantity}
                onChange={(e) =>
                  update({
                    samples: data.samples.map((s, j) =>
                      j === i ? { ...s, quantity: Number(e.target.value) } : s,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label="Remove sample"
                className="icon-button"
                onClick={() =>
                  update({ samples: data.samples.filter((_, j) => j !== i) })
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <div className="wide">
          <h3>Engagement documentation</h3>
          <p className="muted">
            Attach gallery photos and capture the HCP’s signature.
          </p>
        </div>
        <PhotoInput
          photos={data.photos}
          onChange={(photos) => update({ photos })}
        />
        <div className="wide">
          <Signature
            value={data.signature}
            onChange={(signature) => update({ signature })}
          />
        </div>
      </div>
      <p className="draft-note">
        Draft saved on this device. Submission stops the timer and queues the
        complete record for sync.
      </p>
      <button
        type="button"
        className="text-button danger"
        onClick={async () => {
          if (
            window.confirm(
              "Discard this draft, including its timer, photos, and signature?",
            )
          ) {
            await db.delete("drafts", draftKey);
            onClose();
          }
        }}
      >
        Discard draft
      </button>
    </Form>
  );
}

export function MasterlistImport({ hcps, onSave, onClose }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const template = {
    ...blankHcp,
    name: "Dr. Example (replace)",
    masterlist: true,
    externalId: "HCP-001",
  };
  return (
    <Form
      submit={"Import " + rows.length + " HCPs"}
      disabled={!rows.length || !!error}
      onCancel={onClose}
      onSubmit={async () => {
        let count = 0;
        for (const row of rows) {
          const existing = hcps.find(
            (h) => h.data.masterlist && h.data.externalId === row.externalId,
          );
          await onSave(existing?.id || crypto.randomUUID(), row);
          setSaved(++count);
        }
        onClose();
      }}
    >
      <p className="muted">
        CSV imports match the exact masterlist source ID. Duplicate names are
        not automatically merged. Medretailers mappings must be supplied
        explicitly.
      </p>
      <button
        type="button"
        className="button secondary small"
        onClick={() => exportCsv("hcp-masterlist-template.csv", [template])}
      >
        Download CSV template
      </button>
      <Field label="Masterlist CSV" wide>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setRows([]);
            setError("");
            setSaved(0);
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setError("CSV must be under 2 MB.");
              return;
            }
            Papa.parse(file, {
              header: true,
              skipEmptyLines: true,
              complete: (result) => {
                try {
                  if (result.errors.length)
                    throw new Error(result.errors[0].message);
                  if (result.data.length > 1000)
                    throw new Error("Import up to 1,000 HCPs per file.");
                  const seen = new Set();
                  const parsed = result.data.map((row, i) => {
                    const value = schemas.hcps.parse({
                      ...blankHcp,
                      ...row,
                      masterlist: true,
                    });
                    if (!value.externalId)
                      throw new Error(
                        `Row ${i + 2}: masterlist source ID is required.`,
                      );
                    if (seen.has(value.externalId))
                      throw new Error(
                        `Duplicate source ID: ${value.externalId}`,
                      );
                    seen.add(value.externalId);
                    return value;
                  });
                  setRows(parsed);
                } catch (err) {
                  setError(err.message);
                }
              },
              error: (err) => setError(err.message),
            });
          }}
        />
      </Field>
      {error && <p className="alert error">{error}</p>}
      {!!rows.length && (
        <>
          <p>
            {rows.length} valid rows ·{" "}
            {
              rows.filter((r) =>
                hcps.some(
                  (h) =>
                    h.data.masterlist && h.data.externalId === r.externalId,
                ),
              ).length
            }{" "}
            existing matches
          </p>
          <div className="import-preview">
            {rows.slice(0, 10).map((r) => (
              <div key={r.externalId}>
                <strong>{r.name}</strong>
                <span>{r.externalId}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {saved > 0 && (
        <p>
          {saved} records queued locally. Individual sync outcomes appear in
          Sync center.
        </p>
      )}
    </Form>
  );
}

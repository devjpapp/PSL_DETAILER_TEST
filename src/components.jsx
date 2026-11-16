import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Check,
  AlertCircle,
  RefreshCw,
  Upload,
  Download,
} from "lucide-react";
import Papa from "papaparse";
export const today = () => localDate(new Date());
export const localDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const fmtDate = (value) =>
  value
    ? new Date(
        value.length === 10 ? value + "T12:00:00" : value,
      ).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const fmtTime = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not synced";
export const elapsed = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export function Badge({ children, tone = "neutral" }) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function SyncBadge({ record }) {
  return (
    <Badge tone={record.pending ? "amber" : "green"}>
      {record.pending ? "Pending sync" : "Synced"}
    </Badge>
  );
}
export function Field({ label, children, wide = false, hint }) {
  return (
    <label className={"field " + (wide ? "wide" : "")}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <Check size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const old = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      old?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide-modal" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  onSubmit,
  children,
  submit = "Save record",
  onCancel,
  disabled = false,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit(e);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <p className="alert error" role="alert">
          <AlertCircle size={18} />
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="button" disabled={busy || disabled}>
          {busy ? (
            <RefreshCw className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}{" "}
          {busy ? "Saving…" : submit}
        </button>
      </div>
    </form>
  );
}
export function Signature({ value, onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const image = new Image();
      image.onload = () =>
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = value;
    }
  }, [value]);
  const point = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * ref.current.width) / r.width,
      ((e.clientY - r.top) * ref.current.height) / r.height,
    ];
  };
  const finish = () => {
    if (drawing.current) {
      drawing.current = false;
      onChange(ref.current.toDataURL("image/png"));
    }
  };
  return (
    <div className="signature-wrap">
      <canvas
        ref={ref}
        width="800"
        height="240"
        aria-label="Draw HCP signature with finger or pointer"
        onPointerDown={(e) => {
          e.preventDefault();
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d");
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#203e43";
          ctx.beginPath();
          ctx.moveTo(...point(e));
          ctx.lineTo(...point(e).map((v) => v + 0.1));
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (drawing.current) {
            const ctx = ref.current.getContext("2d");
            ctx.lineTo(...point(e));
            ctx.stroke();
          }
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div>
        <small>HCP signature · draw above</small>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange("")}
        >
          Clear signature
        </button>
      </div>
    </div>
  );
}
export async function fileData(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG, or WebP gallery image.");
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Each photo must be 2 MB or smaller.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
}
export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCsv(name, rows) {
  download(
    name,
    Papa.unparse(rows, { escapeFormulae: true }),
    "text/csv;charset=utf-8",
  );
}
export function CsvButton({ name, rows, children }) {
  return (
    <button
      className="button secondary small"
      disabled={!rows.length}
      onClick={() => exportCsv(name, rows)}
    >
      <Download size={15} />
      {children || "Export CSV"}
    </button>
  );
}
export function PhotoInput({ photos, onChange }) {
  const [error, setError] = useState("");
  return (
    <div className="wide">
      <label className="upload">
        <Upload size={20} />
        <span>
          Add gallery photos{" "}
          <small>PNG, JPEG, WebP · up to 3 photos · 2 MB each</small>
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={async (e) => {
            setError("");
            try {
              if (photos.length + e.target.files.length > 3)
                throw new Error("Choose up to 3 photos.");
              onChange([
                ...photos,
                ...(await Promise.all([...e.target.files].map(fileData))),
              ]);
            } catch (err) {
              setError(err.message);
            }
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="photo-grid">
        {photos.map((photo, i) => (
          <div key={i}>
            <img src={photo} alt={"Engagement photo " + (i + 1)} />
            <button
              type="button"
              aria-label={"Remove photo " + (i + 1)}
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

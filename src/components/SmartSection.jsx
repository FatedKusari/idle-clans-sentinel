import React, { useMemo, useState } from "react";

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function fmtValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString() : String(v);
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + "…" : v;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isPlainObject(v)) return "{…}";
  return String(v);
}

function normalizeSections(data) {
  // Accept any JSON-ish value and produce a list of { title, kind, value }
  if (!data || typeof data !== "object") return [];

  const entries = Object.entries(data);

  const prim = [];
  const complex = [];
  for (const [k, v] of entries) {
    const t = typeof v;
    if (v === null || t === "string" || t === "number" || t === "boolean") prim.push([k, v]);
    else complex.push([k, v]);
  }

  const sections = [];
  if (prim.length) sections.push({ title: "Overview", kind: "kv", value: prim });
  for (const [k, v] of complex) sections.push({ title: k, kind: "auto", value: v });
  return sections;
}

function KvGrid({ rows }) {
  return (
    <div className="kvGrid">
      {rows.map(([k, v]) => (
        <div key={k} className="kvRow">
          <div className="kvKey">{k}</div>
          <div className="kvVal">{fmtValue(v)}</div>
        </div>
      ))}
    </div>
  );
}

function ArrayTable({ title, arr }) {
  const isObjArr = arr.every(isPlainObject);
  if (!arr.length) return <div className="muted">None</div>;

  if (isObjArr) {
    const keys = Array.from(
      arr.reduce((s, o) => {
        Object.keys(o).forEach((k) => s.add(k));
        return s;
      }, new Set())
    ).slice(0, 12);

    return (
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arr.slice(0, 200).map((o, idx) => (
              <tr key={idx}>
                {keys.map((k) => (
                  <td key={k}>{fmtValue(o[k])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {arr.length > 200 && <div className="muted">Showing first 200 items.</div>}
      </div>
    );
  }

  return (
    <div className="pillWrap">
      {arr.slice(0, 200).map((v, idx) => (
        <span key={idx} className="pill">
          {fmtValue(v)}
        </span>
      ))}
      {arr.length > 200 && <div className="muted">Showing first 200 items.</div>}
    </div>
  );
}

function AutoRender({ value }) {
  if (value === null || value === undefined) return <div className="muted">None</div>;
  if (Array.isArray(value)) return <ArrayTable arr={value} />;
  if (isPlainObject(value)) {
    const rows = Object.entries(value);
    if (!rows.length) return <div className="muted">None</div>;
    return <KvGrid rows={rows} />;
  }
  return <div>{fmtValue(value)}</div>;
}

export default function SmartSection({ title = "Details", data }) {
  const [open, setOpen] = useState(true);

  const sections = useMemo(() => normalizeSections(data), [data]);

  return (
    <div className="card">
      <div className="cardHeader clickable" onClick={() => setOpen((o) => !o)}>
        <div className="cardTitle">{title}</div>
        <div className="chev">{open ? "▾" : "▸"}</div>
      </div>

      {open && (
        <div className="cardBody">
          {!sections.length && <div className="muted">No data</div>}

          {sections.map((s) => (
            <div key={s.title} className="subCard">
              <div className="subHeader">{s.title}</div>
              <div className="subBody">
                {s.kind === "kv" ? <KvGrid rows={s.value} /> : <AutoRender value={s.value} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

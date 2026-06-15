import React from "react";

function renderVal(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export default function KeyValueTable({ obj }) {
  const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
  return (
    <table className="kv">
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td className="kvKey">{k}</td>
            <td className="kvVal">{renderVal(obj[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

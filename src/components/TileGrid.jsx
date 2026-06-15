import React from "react";

export default function TileGrid({ items }) {
  return (
    <div className="tiles">
      {items.filter(Boolean).map((it, idx) => (
        <div className="tile" key={idx}>
          <div className="tileLabel">{it.label}</div>
          <div className="tileValue">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

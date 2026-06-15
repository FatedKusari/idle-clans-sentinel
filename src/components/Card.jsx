import React from "react";

export function Card({ title, subtitle, right, children }){
  return (
    <div className="card">
      <div className="cardHeader">
        <div style={{display:"flex", flexDirection:"column", gap:2}}>
          <div className="cardTitle">{title}</div>
          {subtitle ? <div className="cardSubtitle">{subtitle}</div> : null}
        </div>
        <div>{right}</div>
      </div>
      <div className="cardBody">{children}</div>
    </div>
  );
}

import React from "react";
import { xpToLevel } from "../lib/xp.js";

export default function SkillsGrid({ items }){
  return (
    <div className="grid3">
      {items.map(it=>(
        <div key={it.key} className="card" style={{borderRadius:14}}>
          <div className="cardBody">
            <div style={{fontWeight:750, marginBottom:6}}>{label(it.key)}</div>
            <div className="small">Level</div>
            <div style={{fontSize:16, fontWeight:750}}>{xpToLevel(it.xp)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function label(k){
  // Rigour rename
  if (String(k) === "Rigour") return "Attack";
  return String(k).charAt(0).toUpperCase()+String(k).slice(1);
}

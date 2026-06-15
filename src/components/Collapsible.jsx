import React, { useState } from "react";

// QoL: collapse by default across the app.
export default function Collapsible({ title, defaultOpen=false, right, children }){
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div className="card">
      <div className="cardHeader">
        <button className="btn" onClick={()=>setOpen(o=>!o)} style={{padding:"7px 10px"}}>
          {open ? "▼" : "▶"} {title}
        </button>
        <div className="row" style={{justifyContent:"flex-end"}}>
          {right}
        </div>
      </div>
      {open && <div className="cardBody">{children}</div>}
    </div>
  );
}

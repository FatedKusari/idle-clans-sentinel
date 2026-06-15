import React, { useMemo } from "react";

// Simple "last online" heatmap.

function startOfDayLocal(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function fmtDayLabel(d){
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

export default function OnlineHeatmap({ events = [], days = 7, binMinutes = 15 }){
  const model = useMemo(()=>{
    const binsPerDay = Math.round((24*60)/binMinutes);
    const now = new Date();
    const start = startOfDayLocal(new Date(now.getTime() - (days-1)*86400000));

    const dayStarts = Array.from({length: days}, (_,i)=> new Date(start.getTime() + i*86400000));

    const active = new Set();

    for (const e of (events||[])){
      const t = e?.lastOnlineAt ? new Date(e.lastOnlineAt) : null;
      if (!t || Number.isNaN(t.getTime())) continue;
      if (t < start) continue;
      const dayIndex = Math.floor((startOfDayLocal(t).getTime() - start.getTime()) / 86400000);
      if (dayIndex < 0 || dayIndex >= days) continue;
      const mins = t.getHours()*60 + t.getMinutes();
      const binIndex = Math.floor(mins / binMinutes);
      if (binIndex < 0 || binIndex >= binsPerDay) continue;
      active.add(`${dayIndex}:${binIndex}`);

      if (binIndex+1 < binsPerDay) active.add(`${dayIndex}:${binIndex+1}`);
    }

    const activeCount = active.size;
    const totalHours = (activeCount * binMinutes) / 60;

    return { dayStarts, binsPerDay, active, totalHours };
  }, [events, days, binMinutes]);

  const { dayStarts, binsPerDay, active, totalHours } = model;

  return (
    <div>
      <div className="row" style={{justifyContent:"space-between", marginBottom:10}}>
        <div className="small">Based on <b>last online</b> timestamps (approx).</div>
        <div className="pill" title="Approx active time">
          <span className="pillDot" />{totalHours.toFixed(1)}h
        </div>
      </div>

      <div style={{display:"grid", gap:10}}>
        {dayStarts.map((d, dayIndex)=>(
          <div key={dayIndex} style={{display:"grid", gridTemplateColumns:"110px 1fr", gap:10, alignItems:"center"}}>
            <div className="small" style={{opacity:0.9}}>{fmtDayLabel(d)}</div>
            <div
              style={{
                display:"grid",
                gridTemplateColumns:`repeat(${binsPerDay}, 1fr)`,
                gap:2,
              }}
            >
              {Array.from({length: binsPerDay}, (_,binIndex)=>{
                const on = active.has(`${dayIndex}:${binIndex}`);
                return (
                  <div
                    key={binIndex}
                    title={`${String(Math.floor((binIndex*binMinutes)/60)).padStart(2,"0")}:${String((binIndex*binMinutes)%60).padStart(2,"0")}`}
                    style={{
                      height: 10,
                      borderRadius: 3,
                      background: on ? "rgba(46, 204, 113, 0.85)" : "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

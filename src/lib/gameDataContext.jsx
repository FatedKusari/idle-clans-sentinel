import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./bridge.js";
import ITEM_NAME_OVERRIDES from "./itemsOverride.js";

const GameDataCtx = createContext({
  info: { ok:false, path:"", updatedAt:null, itemCount:0 },
  itemsById: {},
  refresh: async () => ({ ok:false }),
  resolveItemName: (id) => formatItemFallback(id),
});

export function GameDataProvider({ children }){
  const [info, setInfo] = useState({ ok:false, path:"", updatedAt:null, itemCount:0, error:null });
  const [itemsById, setItemsById] = useState({});

  async function load(){
    try{
      const res = await api.getGameDataLookup();
      setInfo(res?.info || { ok:false, path:"", updatedAt:null, itemCount:0 });
      setItemsById(res?.itemsById || {});
    } catch(err){
      setInfo({ ok:false, path:"", updatedAt:null, itemCount:0, error:String(err?.message||err) });
      setItemsById({});
    }
  }

  useEffect(()=>{ load(); }, []);

  async function refresh({ force } = {}){
    const r = await api.updateGameData({ force: !!force });
    await load();
    return r;
  }

  const resolveItemName = useMemo(()=>{
    return (id)=>{
      const n = Number(id);
      if (!Number.isFinite(n)) return String(id ?? "-");

      // Prefer explicit overrides (prettier names)
      if (ITEM_NAME_OVERRIDES && ITEM_NAME_OVERRIDES[n]) return ITEM_NAME_OVERRIDES[n];

      // Then cached game-data (usually snake_case)
      const raw = itemsById[n];
      if (raw) return prettyFromKey(String(raw));

      return `Unknown (#${n})`;
    };
  }, [itemsById]);

  const value = useMemo(()=>({ info, itemsById, refresh, resolveItemName }), [info, itemsById, resolveItemName]);
  return <GameDataCtx.Provider value={value}>{children}</GameDataCtx.Provider>;
}

export function useGameData(){
  return useContext(GameDataCtx);
}

function prettyFromKey(key){
  // Convert snake_case keys to "Title Case"
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m)=>m.toUpperCase());
}

function formatItemFallback(id){
  const n = Number(id);
  if (!Number.isFinite(n)) return String(id ?? "-");
  return `Item #${n}`;
}

export const PLAYER_SKILLS_ORDER = [
  "attack","strength","defence","archery","magic","health",
  "crafting","woodcutting","carpentry","fishing","cooking",
  "mining","smithing","foraging","farming","agility","plundering",
  "enchanting","brewing","exterminating", "invocation"
];

export const CLAN_SKILLS_ORDER = [
  "Rigour","Strength","Defence","Archery","Magic","Health",
  "Crafting","Woodcutting","Carpentry","Fishing","Cooking",
  "Mining","Smithing","Foraging","Farming","Agility","Plundering",
  "Enchanting","Brewing","Exterminating", "Invocation"
];

export function sortPlayerSkills(obj){
  const o = obj && typeof obj==="object" ? obj : {};
  return PLAYER_SKILLS_ORDER.filter(k=>k in o).map(k=>({ key:k, xp:o[k] }));
}

export function sortClanSkills(obj){
  const o = obj && typeof obj==="object" ? obj : {};
  return CLAN_SKILLS_ORDER.filter(k=>k in o).map(k=>({ key:k, xp:o[k] }));
}

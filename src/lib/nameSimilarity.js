/**
 * Name similarity for highlighting "close" clan member names.
 *
 * Design targets:
 *  - Suffix accounts: "Linceros" vs "LincerosMine" / "Linceros1" / "Linceros_Alt"
 *  - Minor typos / swapped letters: "lincerodmine" vs "lincerodmine"
 *
 * We combine a few lightweight signals:
 *  - bigram Dice coefficient (good for general overlap)
 *  - Jaro-Winkler (good for typos/transpositions, rewards common prefix)
 *  - prefix/substring heuristics (good for base-name + suffix patterns)
 */

function normalizeName(s){
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // strip spaces/underscores/punct
}

function stripKnownSuffixes(s){
  // keep this conservative; it's only for similarity highlighting
  // (does not change stored names)
  let x = s;
  // common account suffixes - ordered longest first to avoid partial matches
  x = x.replace(/(hcgim|hcim|hcuim|uim|gim|hci|iron|im|mine|main|alt|alts|skiller|pk|pker|bank|shop|bot|test|spare|backup|feed|mule|pure|zerker|zerk|range|mage|melee|scape|rs|idle|clans|game|play|acc|acct|account)$/i, "");
  // trailing digits ("name1", "name2", "name123")
  x = x.replace(/\d+$/g, "");
  // leading/trailing underscores or x-prefix (xName, _name_)
  x = x.replace(/^[x_]+/, "").replace(/[_]+$/, "");
  return x;
}

function nameVariants(raw){
  const n = normalizeName(raw);
  const base = stripKnownSuffixes(n);
  // include both original normalized + stripped base, plus an extra pass
  // (e.g. "nameMine2" -> "namemine2" -> strip digits -> "namemine" -> strip suffix -> "name")
  const base2 = stripKnownSuffixes(n.replace(/\d+$/g, ""));
  const set = new Set([n, base, base2].filter(Boolean));
  return [...set];
}

function bigrams(str){
  const s = normalizeName(str);
  const grams = [];
  for (let i = 0; i < s.length - 1; i++){
    grams.push(s.slice(i, i+2));
  }
  return grams;
}

/** Dice coefficient over bigram multisets (counts duplicates). */
function diceSimilarity(a, b){
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;

  const counts = new Map();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);

  let inter = 0;
  for (const g of B){
    const c = counts.get(g) || 0;
    if (c > 0){
      inter += 1;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

// --- Jaro-Winkler (small, dependency-free) ---
function jaroSimilarity(s1, s2){
  const a = normalizeName(s1);
  const b = normalizeName(s2);
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchDistance = Math.floor(Math.max(la, lb) / 2) - 1;
  const aMatches = new Array(la).fill(false);
  const bMatches = new Array(lb).fill(false);

  let matches = 0;
  for (let i = 0; i < la; i++){
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, lb);
    for (let j = start; j < end; j++){
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // transpositions
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i++){
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (
    (matches / la) +
    (matches / lb) +
    ((matches - transpositions) / matches)
  ) / 3;
}

function jaroWinklerSimilarity(s1, s2){
  const a = normalizeName(s1);
  const b = normalizeName(s2);
  const j = jaroSimilarity(a, b);
  // prefix scale
  let prefix = 0;
  const maxPrefix = 4;
  for (let i = 0; i < Math.min(maxPrefix, a.length, b.length); i++){
    if (a[i] === b[i]) prefix++;
    else break;
  }
  const p = 0.1;
  return j + prefix * p * (1 - j);
}

function commonPrefixLen(a, b){
  const x = normalizeName(a);
  const y = normalizeName(b);
  const m = Math.min(x.length, y.length);
  let i = 0;
  for (; i < m; i++){
    if (x[i] !== y[i]) break;
  }
  return i;
}

function enhancedSimilarity(a, b){
  // Take the max score across variants to catch base-name + suffix patterns.
  const va = nameVariants(a);
  const vb = nameVariants(b);

  let best = 0;
  for (const x of va){
    for (const y of vb){
      if (!x || !y || x === y) continue;

      // Dice + JW
      const dice = diceSimilarity(x, y);
      const jw = jaroWinklerSimilarity(x, y);

      // substring heuristic: if shorter is contained in longer, treat as strong match
      const shorter = x.length <= y.length ? x : y;
      const longer = x.length > y.length ? x : y;
      let sub = 0;
      if (shorter.length >= 4 && longer.includes(shorter)){
        // reward containment more when the contained portion is a large fraction
        sub = 0.75 + 0.25 * (shorter.length / longer.length);
      }

      // prefix heuristic: reward strong common prefix (helps with suffix accounts)
      const cpl = commonPrefixLen(x, y);
      const minL = Math.min(x.length, y.length);
      const prefixScore = (minL >= 4) ? (cpl / minL) : 0;

      const score = Math.max(dice, jw, sub, prefixScore);
      if (score > best) best = score;
    }
  }
  return best;
}

/**
 * Main similarity used by the UI.
 *
 * This intentionally uses the enhanced matcher (variants + Jaro-Winkler +
 * substring/prefix heuristics) so suffix accounts like "Cas2"/"Cas3"/"Cas4fish"
 * are treated as similar.
 */
export function nameSimilarity(a, b){
  return enhancedSimilarity(a, b);
}

/**
 * Compute similarity clusters for a list of members.
 * Returns { groupByLower: Record<string, number>, metaByLower: Record<string, {peers: string[], maxScore: number}> }
 */
export function computeSimilarNameGroups(members, opts = {}){
  // With the enhanced matcher, a slightly higher default reduces noisy pairs
  // while still catching suffix/typo variants.
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 0.82;
  const minLen = Number.isFinite(opts.minLen) ? opts.minLen : 4;
  const maxPairsPerMember = Number.isFinite(opts.maxPairsPerMember) ? opts.maxPairsPerMember : 3;

  const items = (members || [])
    .map(m => ({
      memberLower: m.memberLower || String(m.memberName || "").toLowerCase(),
      memberName: m.memberName || m.memberLower || "",
    }))
    .filter(m => m.memberName);

  const n = items.length;
  if (n < 2) return { groupByLower: {}, metaByLower: {} };

  // Union-Find for clustering pairs above threshold
  const parent = Array.from({length:n}, (_,i)=>i);
  const find = (x)=> parent[x]===x ? x : (parent[x]=find(parent[x]));
  const union = (a,b)=>{ a=find(a); b=find(b); if(a!==b) parent[b]=a; };

  // Track top peers for tooltip
  const topPeers = Array.from({length:n}, ()=>[]); // [{j, score}]

  for (let i=0;i<n;i++){
    const ni = items[i].memberName;
    const li = normalizeName(ni);
    if (li.length < minLen) continue;

    for (let j=i+1;j<n;j++){
      const nj = items[j].memberName;
      const lj = normalizeName(nj);
      if (lj.length < minLen) continue;

      if (li === lj) continue;
      // quick guard: huge length difference tends to false-match unless
      // they share a strong prefix (common for base+suffix accounts)
      const lenDiff = Math.abs(li.length - lj.length);
      if (lenDiff >= 10){
        const cpl = commonPrefixLen(ni, nj);
        if (cpl < 4) continue;
      }

      const score = enhancedSimilarity(ni, nj);
      if (score >= threshold){
        union(i,j);

        // store top peers
        topPeers[i].push({ name: nj, score });
        topPeers[j].push({ name: ni, score });
      }
    }
  }

  // Build clusters
  const clusters = new Map(); // root -> [idx]
  for (let i=0;i<n;i++){
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(i);
  }

  // Only clusters with 2+ are highlighted; assign group indices 0..k-1
  const groupByLower = {};
  const metaByLower = {};
  let g = 0;
  for (const idxs of clusters.values()){
    if (idxs.length < 2) continue;

    for (const i of idxs){
      groupByLower[items[i].memberLower] = g;

      // Sort peers by score, cap
      const peers = (topPeers[i] || [])
        .sort((a,b)=> b.score - a.score)
        .slice(0, maxPairsPerMember);

      metaByLower[items[i].memberLower] = {
        peers: peers.map(p => p.name),
        maxScore: peers.length ? peers[0].score : null,
      };
    }
    g += 1;
  }

  return { groupByLower, metaByLower };
}

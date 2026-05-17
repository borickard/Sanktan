import { useState, useEffect, useCallback, useRef } from "react";
import {
  Zap, Shuffle, Shield, Layers,
  Play, Pause, RotateCcw, RefreshCw, SkipBack, SkipForward,
  ArrowUpDown, AlertTriangle, Link2, X, Check,
  Users, ClipboardList, Pencil, ChevronRight, ChevronUp, ChevronDown,
} from "lucide-react";

/* ─── ID factory ─── */
let _uid = 100;
const uid = () => ++_uid;

/* ─── Constants ─── */
const PREFS = [
  { key: "neutral", label: "Mix",      Icon: Shuffle, color: "#94a3b8" },
  { key: "attack",  label: "Anfall",   Icon: Zap,     color: "#f97316" },
  { key: "defense", label: "Defensiv", Icon: Shield,  color: "#60a5fa" },
];
const PM = Object.fromEntries(PREFS.map(p => [p.key, p]));

const FORMATS = [
  { key: "3v3",   label: "3v3",   hasGK: false, total: 3,  att: 1, mid: 0, def: 2 },
  { key: "5v5",   label: "5v5",   hasGK: true,  total: 5,  att: 2, mid: 0, def: 2 },
  { key: "7v7",   label: "7v7",   hasGK: true,  total: 7,  att: 2, mid: 2, def: 2 },
  { key: "9v9",   label: "9v9",   hasGK: true,  total: 9,  att: 2, mid: 3, def: 3 },
  { key: "11v11", label: "11v11", hasGK: true,  total: 11, att: 3, mid: 3, def: 4 },
];
const FM = Object.fromEntries(FORMATS.map(f => [f.key, f]));

const mkP = (name, isGK = false, pref = "neutral") => ({ id: uid(), name, isGK, pref, enabled: true });

const DEMO = [
  mkP("", true),
  mkP(""), mkP(""), mkP(""), mkP(""),
  mkP(""), mkP(""), mkP(""), mkP(""),
];

/* ─── URL encoding ─── */
// Unicode-safe: encodes non-ASCII as UTF-8 bytes but leaves ASCII chars unchanged (no inflation of {,},[,],:," etc.)
const _enc = str => btoa(
  encodeURIComponent(str).replace(/%([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const _dec = raw => decodeURIComponent(
  Array.prototype.map.call(
    atob(raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - raw.length % 4) % 4)),
    c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("")
);

const packURL  = ({ players, settings, homeTeam, awayTeam, homeScore, awayScore }) => ({
  p: players.map(p => [p.id, p.name, p.isGK ? 1 : 0, p.pref[0], p.enabled === false ? 0 : 1]),
  s: [settings.format, settings.periods, settings.duration, settings.subs, settings.shuffleSalt ?? 0, settings.positions === false ? 0 : 1],
  h: homeTeam, a: awayTeam, hs: homeScore, as: awayScore,
});

const unpackURL = c => {
  const pr = { a: "attack", n: "neutral", d: "defense" };
  return {
    players: c.p.map(([id, name, gk, pref, en]) => ({ id, name, isGK: !!gk, pref: pr[pref] ?? "neutral", enabled: en !== 0 })),
    settings: { format: c.s[0], periods: c.s[1], duration: c.s[2], subs: c.s[3], shuffleSalt: c.s[4] ?? 0, positions: c.s[5] === 0 ? false : true },
    homeTeam: c.h ?? "", awayTeam: c.a ?? "", homeScore: c.hs ?? 0, awayScore: c.as ?? 0,
  };
};

/* ─── URL state ─── */
const SHORT_CODE_RE = /^[A-Z2-9]{6}$/i;
const search = window.location.search.slice(1);
const shortCode = new URLSearchParams(window.location.search).get("c");
const isShortCode = !!shortCode && SHORT_CODE_RE.test(shortCode);

const initFromURL = (() => {
  if (isShortCode) return null; // loaded async in component
  try {
    if (!search) return null;
    const data = JSON.parse(_dec(search));
    if (Array.isArray(data?.p) && Array.isArray(data?.s)) return unpackURL(data);
    if (data?.players && data?.settings) return data; // legacy fallback
  } catch {}
  return null;
})();

/* ─── Auto-generate algorithm ─── */
function generatePlan(players, settings) {
  const { periods, duration, subs } = settings;
  const fmt = FM[settings.format] ?? FM["5v5"];
  const FULL = duration;
  const fieldCount = fmt.att + fmt.mid + fmt.def;
  const shuffleSalt = settings.shuffleSalt ?? 0;

  const gks = fmt.hasGK ? players.filter(p => p.isGK) : [];
  const mins = Object.fromEntries(players.map(p => [p.id, 0]));
  /* posMins tracks cumulative minutes each player has played at each outfield
     position, so the assignment can pull them toward their least-played role. */
  const posMins = Object.fromEntries(players.map(p => [p.id, { att: 0, mid: 0, def: 0 }]));

  /* Deterministic pseudo-random in [0,1) keyed by a string. Used as a small
     tiebreaker so equal-score candidates don't collapse to array order, and
     so the shuffle button can produce a different valid distribution. */
  const hash01 = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  };

  const prefRole = { attack: "att", defense: "def", neutral: "mid" };
  const PREF_BONUS = FULL * 0.5;   // preference is worth ~half a period of imbalance
  /* Random component scaled to FULL so a shuffle can override both preference
     bonus (FULL/2) AND a single-period posMins imbalance (≈FULL/2). After a
     couple of periods, posMins differences grow past FULL and dominate again. */
  const RANDOM_SCALE = FULL;

  /* halfIdx is a tag for the tiebreaker so first/second halves of the same
     period don't get identical noise. */
  const fillPositions = (pool, periodIdx, halfIdx) => {
    const limits = { att: fmt.att, mid: fmt.mid, def: fmt.def };
    const counts = { att: 0, mid: 0, def: 0 };
    const remaining = [...pool];
    const result = { at: [], md: [], df: [] };

    const score = (player, role) => {
      let s = -(posMins[player.id]?.[role] ?? 0);
      if (prefRole[player.pref] === role) s += PREF_BONUS;
      s += hash01(`${player.id}|${role}|${periodIdx}|${halfIdx}|${shuffleSalt}`) * RANDOM_SCALE;
      return s;
    };

    /* Greedy assignment: each step picks the (player, role) pair with the
       highest score across all remaining players and open roles. */
    while (remaining.length > 0 && counts.att + counts.mid + counts.def < fieldCount) {
      let best = null;
      for (const player of remaining) {
        for (const role of ["att", "mid", "def"]) {
          if (counts[role] >= limits[role]) continue;
          const s = score(player, role);
          if (best === null || s > best.score) best = { player, role, score: s };
        }
      }
      if (!best) break;
      const arr = best.role === "att" ? result.at : best.role === "mid" ? result.md : result.df;
      arr.push(best.player.id);
      counts[best.role]++;
      remaining.splice(remaining.indexOf(best.player), 1);
    }

    while (result.at.length < fmt.att) result.at.push(null);
    while (result.md.length < fmt.mid) result.md.push(null);
    while (result.df.length < fmt.def) result.df.push(null);
    return result;
  };

  const applyPosMins = (pos, minsToAdd) => {
    pos.at.forEach(id => { if (id) posMins[id].att += minsToAdd; });
    pos.md.forEach(id => { if (id) posMins[id].mid += minsToAdd; });
    pos.df.forEach(id => { if (id) posMins[id].def += minsToAdd; });
  };

  return Array.from({ length: periods }, (_, i) => {
    let gkId = null;
    if (fmt.hasGK) {
      gkId = gks.length > 0
        ? gks[i % gks.length].id
        : [...players].sort((a, b) => mins[b.id] - mins[a.id])[0].id;
    }

    const avail = players
      .filter(p => p.id !== gkId)
      .sort((a, b) => {
        /* Cumulative minutes drives the lineup choice. Hash on (player, period,
           salt) breaks ties and lets Slumpa rotate who sits out when minutes
           are close. Scale is small (PREF_BONUS) so big mins gaps still win. */
        const ja = mins[a.id] + hash01(`avail|${a.id}|${i}|${shuffleSalt}`) * PREF_BONUS;
        const jb = mins[b.id] + hash01(`avail|${b.id}|${i}|${shuffleSalt}`) * PREF_BONUS;
        return ja - jb;
      });

    if (subs >= 1) {
      const HALF = FULL / 2;
      const numSubs = Math.max(0, avail.length - fieldCount);

      /* ── Not enough players for any sub: fall through to no-sub logic ── */
      if (numSubs === 0) {
        const starters = avail.slice(0, fieldCount);
        const pos = fillPositions(starters, i, 0);
        applyPosMins(pos, FULL);
        if (gkId) mins[gkId] += FULL;
        starters.forEach(p => { mins[p.id] += FULL; });
        return {
          gk: gkId,
          att: pos.at, mid: pos.md, def: pos.df,
          att2: null, mid2: null, def2: null,
          bench: avail.slice(fieldCount).map(p => p.id),
        };
      }

      /* ── Full rotation: enough players for everyone to play one half ── */
      if (avail.length >= fieldCount * 2) {
        const selected = avail.slice(0, fieldCount * 2);
        const bench    = avail.slice(fieldCount * 2);
        /* Spread attackers/defenders evenly across both halves */
        const h1 = [], h2 = [];
        const groups = ["attack", "defense", "neutral"].map(pr =>
          pr === "neutral"
            ? selected.filter(p => p.pref !== "attack" && p.pref !== "defense")
            : selected.filter(p => p.pref === pr)
        );
        for (const group of groups) {
          group.forEach((p, i) => {
            if (h1.length < fieldCount && (i % 2 === 0 || h2.length >= fieldCount)) h1.push(p);
            else if (h2.length < fieldCount) h2.push(p);
            else h1.push(p);
          });
        }
        const pos1 = fillPositions(h1, i, 0);
        applyPosMins(pos1, HALF);
        const pos2 = fillPositions(h2, i, 1);
        applyPosMins(pos2, HALF);
        if (gkId) mins[gkId] += FULL;
        h1.forEach(p => { mins[p.id] += HALF; });
        h2.forEach(p => { mins[p.id] += HALF; });
        return {
          gk: gkId,
          att: pos1.at, mid: pos1.md, def: pos1.df,
          att2: pos2.at, mid2: pos2.md, def2: pos2.df,
          bench: bench.map(p => p.id),
        };
      }

      /* ── Partial rotation: numSubs players swap at halftime ──
         avail is sorted ascending by minutes, so:
         - avail[0..fieldCount-numSubs-1]: fewest mins → stay the full period
         - avail[fieldCount-numSubs..fieldCount-1]: more mins → play first half, then rest
         - avail[fieldCount..]:              most mins → rest first half, play second half
         This naturally self-balances across periods: full-period players accumulate
         more mins and drop in priority next period, letting bench players catch up. */
      const numStay    = fieldCount - numSubs;
      const firstHalf  = avail.slice(0, fieldCount);
      const benchPool  = avail.slice(fieldCount);          // come on at halftime
      const stayers    = firstHalf.slice(0, numStay);      // play full period
      const comingOff  = firstHalf.slice(numStay);         // play first half only
      const secondHalf = [...stayers, ...benchPool];

      const pos1 = fillPositions(firstHalf, i, 0);
      applyPosMins(pos1, HALF);

      /* Lock stayers to the same role in both halves so the only "subs" the UI
         shows are real player swaps, not a stayer rotating positions across
         halves. Replace each comingOff slot with the best-fit benchPool player. */
      const pos2 = { at: [...pos1.at], md: [...pos1.md], df: [...pos1.df] };
      const comingOffIds = new Set(comingOff.map(p => p.id));
      const swapSlots = [];
      for (const role of ["at", "md", "df"]) {
        pos2[role].forEach((id, j) => {
          if (id && comingOffIds.has(id)) swapSlots.push({ role, j });
        });
      }
      const roleKey = { at: "att", md: "mid", df: "def" };
      const remainingBench = [...benchPool];
      while (remainingBench.length > 0 && swapSlots.length > 0) {
        let best = null;
        for (const player of remainingBench) {
          for (const slot of swapSlots) {
            const r = roleKey[slot.role];
            let s = -(posMins[player.id]?.[r] ?? 0);
            if (prefRole[player.pref] === r) s += PREF_BONUS;
            s += hash01(`${player.id}|${r}|${i}|1|${shuffleSalt}`) * RANDOM_SCALE;
            if (best === null || s > best.score) best = { player, slot, score: s };
          }
        }
        if (!best) break;
        pos2[best.slot.role][best.slot.j] = best.player.id;
        remainingBench.splice(remainingBench.indexOf(best.player), 1);
        swapSlots.splice(swapSlots.indexOf(best.slot), 1);
      }
      applyPosMins(pos2, HALF);

      if (gkId) mins[gkId] += FULL;
      stayers.forEach(p   => { mins[p.id] += FULL; });
      comingOff.forEach(p => { mins[p.id] += HALF; });
      benchPool.forEach(p => { mins[p.id] += HALF; });

      return {
        gk: gkId,
        att: pos1.at, mid: pos1.md, def: pos1.df,
        att2: pos2.at, mid2: pos2.md, def2: pos2.df,
        bench: [],
      };
    } else {
      /* No subs: single formation, full time */
      const starters = avail.slice(0, fieldCount);
      const pos = fillPositions(starters, i, 0);
      applyPosMins(pos, FULL);

      if (gkId) mins[gkId] += FULL;
      starters.forEach(p => { mins[p.id] += FULL; });

      const usedIds = new Set([gkId, ...starters.map(p => p.id)].filter(Boolean));
      return {
        gk: gkId,
        att: pos.at, mid: pos.md, def: pos.df,
        att2: null, mid2: null, def2: null,
        bench: players.filter(p => !usedIds.has(p.id)).map(p => p.id),
      };
    }
  });
}

/* ─── Audio ─── */
const beep = (freqs, dur, gap) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().then(() => {
      const master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env); env.connect(master);
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * (dur + gap);
        env.gain.setValueAtTime(1, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.start(t); osc.stop(t + dur + 0.05);
      });
      setTimeout(() => ctx.close(), (freqs.length * (dur + gap) + 0.5) * 1000);
    });
  } catch (e) {}
};
const playSwitchSound  = () => beep([880, 880], 0.12, 0.1);
const playPeriodEnd    = () => beep([660, 660, 660], 0.25, 0.15);

/* ─── Main App ─── */
export default function App() {
  const [tab, setTab]         = useState(initFromURL ? "plan" : "players");
  const [players, setPlayers] = useState(initFromURL?.players ?? DEMO);
  const [newName, setNewName] = useState("");
  const [settings, setSettings] = useState({
    periods: 3, duration: 15, subs: 1, format: "5v5", shuffleSalt: 0, positions: true,
    ...(initFromURL?.settings ?? {}),
  });
  const [plan, setPlan]         = useState(() => initFromURL ? generatePlan(initFromURL.players.filter(p => p.enabled !== false), initFromURL.settings) : null);
  const [originalPlan, setOriginalPlan] = useState(() => initFromURL ? generatePlan(initFromURL.players.filter(p => p.enabled !== false), initFromURL.settings) : null);
  const [sel, setSel]           = useState(null);
  const [copied, setCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied,  setShareCopied]  = useState(false);
  const [shareError,   setShareError]   = useState(null);
  const [shareUrl,     setShareUrl]     = useState(null);
  const [kvLoading, setKvLoading] = useState(isShortCode);
  const [winW, setWinW]     = useState(window.innerWidth);
  /* Restore the match timer across page refresh. If it was running, advance
     elapsed by wall-clock delta since the last save so it keeps wall time. */
  const restoredTimer = (() => {
    try {
      const raw = localStorage.getItem("sanktan-timer-v1");
      if (!raw) return null;
      const d = JSON.parse(raw);
      let elapsed = d.elapsed ?? 0;
      if (d.running && d.startedAt) {
        elapsed = (d.baseElapsed ?? 0) + Math.floor((Date.now() - d.startedAt) / 1000);
      }
      return { period: d.period ?? 0, elapsed: Math.max(0, elapsed), running: !!d.running };
    } catch { return null; }
  })();
  const [timerRunning, setTimerRunning] = useState(restoredTimer?.running ?? false);
  const [timerElapsed, setTimerElapsed] = useState(restoredTimer?.elapsed ?? 0); // seconds
  const [timerPeriod,  setTimerPeriod]  = useState(restoredTimer?.period ?? 0); // 0-indexed
  const timerRef        = useRef(null);
  const switchSounded   = useRef(false);
  const endSounded      = useRef(false);
  const startedAtRef    = useRef(null); // wall-clock timestamp at last resume
  const baseElapsedRef  = useRef(0);    // elapsed seconds at last resume
  const wakeLockRef     = useRef(null);
  const dragIdx         = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const timerSentinelRef = useRef(null);
  const [timerCompact, setTimerCompact] = useState(false);
  const [collapsedPeriods, setCollapsedPeriods] = useState(() => new Set());
  const togglePeriod = idx => setCollapsedPeriods(s => {
    const next = new Set(s);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const [homeTeam,  setHomeTeam]  = useState(initFromURL?.homeTeam  ?? "");
  const [awayTeam,  setAwayTeam]  = useState(initFromURL?.awayTeam  ?? "");
  const [homeScore, setHomeScore] = useState(initFromURL?.homeScore ?? 0);
  const [awayScore, setAwayScore] = useState(initFromURL?.awayScore ?? 0);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch(e) {} };
  }, []);

  // Load state from KV when a short code is in the URL
  useEffect(() => {
    if (!isShortCode) return;
    fetch(`/api/load?c=${shortCode}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ state }) => {
        const unpacked = unpackURL(JSON.parse(_dec(state)));
        setPlayers(unpacked.players);
        setSettings(s => ({ ...s, ...unpacked.settings }));
        setHomeTeam(unpacked.homeTeam);
        setAwayTeam(unpacked.awayTeam);
        setHomeScore(unpacked.homeScore);
        setAwayScore(unpacked.awayScore);
        const p = generatePlan(unpacked.players.filter(pl => pl.enabled !== false), unpacked.settings);
        setPlan(p); setOriginalPlan(p);
        setTab("plan");
      })
      .catch(() => {})
      .finally(() => setKvLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shareLink = useCallback(async () => {
    setShareLoading(true);
    setShareError(null);
    try {
      const state = _enc(JSON.stringify(packURL({ players, settings, homeTeam, awayTeam, homeScore, awayScore })));
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const { code } = await res.json();
      if (!code) throw new Error("no code returned");
      const url = `${window.location.origin}?c=${code}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      } catch {
        // Clipboard blocked — show URL in prompt as fallback
        window.prompt("Kopiera länken:", url);
      }
    } catch (err) {
      setShareError(err.message ?? "Fel");
      setTimeout(() => setShareError(null), 4000);
    }
    setShareLoading(false);
  }, [players, settings, homeTeam, awayTeam, homeScore, awayScore]);

  useEffect(() => {
    try {
      window.history.replaceState(null, "", "?" + _enc(JSON.stringify(packURL({ players, settings, homeTeam, awayTeam, homeScore, awayScore }))));
    } catch {}
    setShareUrl(null);
  }, [players, settings, homeTeam, awayTeam, homeScore, awayScore]);

  useEffect(() => {
    document.title = homeTeam && awayTeam ? `${homeTeam} – ${awayTeam}` : homeTeam || awayTeam || "Laguppställning";
  }, [homeTeam, awayTeam]);

  useEffect(() => {
    const h = () => setWinW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    const el = timerSentinelRef.current;
    if (!el) return;
    const h = () => setTimerCompact(el.getBoundingClientRect().top < 0);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, [tab, plan]);

  /* Reset sound flags when moving to a new period or resetting the timer */
  useEffect(() => {
    switchSounded.current = false;
    endSounded.current    = false;
  }, [timerPeriod]);

  /* Trigger sounds when the timer crosses a threshold while running.
     On the first run after a page refresh, sync the "already played" flags
     to the restored elapsed instead of replaying the beep for a threshold
     that was crossed before the refresh. */
  const firstSoundCheck = useRef(true);
  useEffect(() => {
    if (!timerRunning) return;
    const pSecs = settings.duration * 60;
    const hSecs = pSecs / 2;
    if (firstSoundCheck.current) {
      firstSoundCheck.current = false;
      switchSounded.current = timerElapsed >= hSecs;
      endSounded.current    = timerElapsed >= pSecs;
      return;
    }
    if (timerElapsed < hSecs) switchSounded.current = false;
    if (timerElapsed < pSecs) endSounded.current    = false;
    if (settings.subs >= 1 && timerElapsed >= hSecs && timerElapsed < pSecs && !switchSounded.current) {
      switchSounded.current = true;
      playSwitchSound();
    }
    if (timerElapsed >= pSecs && !endSounded.current) {
      endSounded.current = true;
      playPeriodEnd();
    }
  }, [timerElapsed, timerRunning, settings]);

  /* Timestamp-based timer: survives screen lock / background tab throttling.
     Anchors (startedAt, baseElapsed) at every resume and seek, then the tick
     computes elapsed from wall-clock delta. visibilitychange triggers an
     immediate catch-up so the UI snaps to the right time on unlock. */
  useEffect(() => {
    if (!timerRunning) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }
    startedAtRef.current = Date.now();
    baseElapsedRef.current = timerElapsed;
    const tick = () => {
      if (startedAtRef.current == null) return;
      setTimerElapsed(baseElapsedRef.current + Math.floor((Date.now() - startedAtRef.current) / 1000));
    };
    timerRef.current = setInterval(tick, 1000);
    (async () => {
      if ("wakeLock" in navigator) {
        try { wakeLockRef.current = await navigator.wakeLock.request("screen"); } catch {}
      }
    })();
    return () => {
      clearInterval(timerRef.current);
      startedAtRef.current = null;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [timerRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!timerRunning) return;
    const onVis = async () => {
      if (document.hidden) return;
      if (startedAtRef.current != null) {
        setTimerElapsed(baseElapsedRef.current + Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        try { wakeLockRef.current = await navigator.wakeLock.request("screen"); } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [timerRunning]);

  /* Persist timer state so refreshing the page doesn't lose match progress. */
  useEffect(() => {
    try {
      localStorage.setItem("sanktan-timer-v1", JSON.stringify({
        period: timerPeriod,
        elapsed: timerElapsed,
        running: timerRunning,
        startedAt: timerRunning ? startedAtRef.current : null,
        baseElapsed: timerRunning ? baseElapsedRef.current : timerElapsed,
      }));
    } catch {}
  }, [timerPeriod, timerElapsed, timerRunning]);

  /* Seek the running timer without losing wall-clock anchor. */
  const seekTimer = next => {
    const v = Math.max(0, Math.round(next));
    setTimerElapsed(v);
    if (timerRunning) {
      startedAtRef.current = Date.now();
      baseElapsedRef.current = v;
    }
  };

  const fmt       = FM[settings.format] ?? FM["5v5"];
  const isDesktop = winW >= 700;
  const fmtTime   = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const getP      = id => players.find(p => p.id === id);
  const displayName = p => {
    const n = (p?.name ?? "").trim();
    if (n) return n;
    const idx = players.findIndex(pl => pl.id === p?.id);
    return `Spelare ${idx + 1}`;
  };

  const addPlayer = () => {
    const n = newName.trim();
    if (!n) return;
    setPlayers(ps => [...ps, mkP(n)]);
    setNewName("");
  };

  const updP = (id, key, val) =>
    setPlayers(ps => ps.map(p => p.id === id ? { ...p, [key]: val } : p));

  const delP = id => setPlayers(ps => ps.filter(p => p.id !== id));

  const movePlayer = (id, dir) => setPlayers(ps => {
    const i = ps.findIndex(p => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ps.length) return ps;
    const next = [...ps];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const activePlayers = players.filter(p => p.enabled !== false);

  const doGenerate = () => {
    if (activePlayers.length < fmt.total) {
      return alert(`Aktivera minst ${fmt.total} spelare för ${fmt.label}!`);
    }
    const newPlan = generatePlan(activePlayers, settings);
    setPlan(newPlan);
    setOriginalPlan(newPlan);
    setTab("plan");
    setSel(null);
  };

  const doReset = () => {
    if (originalPlan) { setPlan(originalPlan); setSel(null); }
  };

  const [justShuffled, setJustShuffled] = useState(false);
  const doShuffle = () => {
    if (!plan) return;
    const nextSettings = { ...settings, shuffleSalt: (settings.shuffleSalt ?? 0) + 1 };
    setSettings(nextSettings);
    const next = generatePlan(activePlayers, nextSettings);
    setPlan(next);
    setOriginalPlan(next);
    setSel(null);
    setJustShuffled(true);
    setTimeout(() => setJustShuffled(false), 1200);
  };

  const resetAll = () => {
    if (!window.confirm("Återställ allt till standardvärden?")) return;
    setPlayers([...DEMO]);
    setSettings({ periods: 3, duration: 15, subs: 1, format: "5v5", shuffleSalt: 0, positions: true });
    setHomeTeam(""); setAwayTeam("");
    setHomeScore(0); setAwayScore(0);
    setPlan(null); setOriginalPlan(null);
    setSel(null);
    setTab("players");
    setTimerRunning(false); setTimerElapsed(0); setTimerPeriod(0);
    setNewName("");
    try { localStorage.removeItem("sanktan-timer-v1"); } catch {}
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      window.prompt("Kopiera länken:", shareUrl);
    }
  };

  const renderShareControl = (extraStyle = {}) => shareUrl ? (
    <button onClick={copyShareUrl}
      style={{
        width: "100%", padding: "10px 12px",
        background: shareCopied ? "#22c55e" : "#1e293b",
        border: `1px solid ${shareCopied ? "#22c55e" : "#334155"}`,
        borderRadius: 9,
        color: shareCopied ? "#fff" : "#94a3b8",
        fontSize: 13, fontFamily: "'DM Sans', system-ui, sans-serif", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 8, textAlign: "left",
        ...extraStyle,
      }}>
      {shareCopied ? <Check size={14} /> : <Link2 size={14} color="#3b82f6" />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
        {shareCopied ? "Länk kopierad!" : shareUrl}
      </span>
    </button>
  ) : (
    <button onClick={shareLink} disabled={shareLoading}
      style={{
        ...S.btn("primary"), width: "100%", padding: "11px 0", fontSize: 14, fontWeight: 700,
        background: shareError ? "#7f1d1d" : "#3b82f6",
        color: "#fff", border: "none",
        opacity: shareLoading ? 0.7 : 1,
        ...extraStyle,
      }}>
      {shareLoading ? "Skapar länk…" : shareError ? <><AlertTriangle size={14} /> Fel: {shareError}</> : <><Link2 size={14} /> Dela kort länk</>}
    </button>
  );

  const [shareOpen, setShareOpen] = useState(false);

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  };

  const ShareBar = () => (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setShareOpen(o => !o)} style={{
        ...S.btn("secondary"), width: "100%", padding: "11px 0", fontSize: 13,
      }}>
        {shareOpen ? <><X size={13} /> Stäng dela</> : <><Link2 size={13} /> Dela länk</>}
      </button>
      {shareOpen && (
        <div style={{ marginTop: 6, background: "#1e293b", border: "1px solid #334155", borderRadius: 9, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
            Länken uppdateras automatiskt — kopiera och skicka den till någon annan.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              readOnly
              value={window.location.href}
              onFocus={e => e.target.select()}
              style={{
                flex: 1, minWidth: 0, background: "#0f172a", border: "1px solid #334155",
                color: "#94a3b8", borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none",
              }}
            />
            <button onClick={copyLink} style={{
              ...S.btn(copied ? "primary" : "secondary"), padding: "8px 14px", fontSize: 12, flexShrink: 0,
            }}>
              {copied ? <><Check size={12} /> Kopierad!</> : "Kopiera"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  /* Global schedule swap of two players */
  const tapPlayer = useCallback((id, periodIdx) => {
    if (!id) return;
    if (!sel) { setSel({ id, periodIdx }); return; }
    if (sel.id === id) { setSel(null); return; }
    const a = sel.id, b = id;
    const sw = x => x === a ? b : x === b ? a : x;
    setPlan(pl => pl.map((period, i) => {
      if (i !== sel.periodIdx) return period;
      return {
        gk:    sw(period.gk),
        att:   period.att.map(sw),
        mid:   (period.mid ?? []).map(sw),
        def:   period.def.map(sw),
        att2:  (period.att2 ?? []).map(sw),
        mid2:  (period.mid2 ?? []).map(sw),
        def2:  (period.def2 ?? []).map(sw),
        bench: period.bench.map(sw),
      };
    }));
    setSel(null);
  }, [sel]);

  /* Minute totals from current plan */
  const calcMins = () => {
    if (!plan) return {};
    const FULL = settings.duration;
    const HALF = FULL / 2;
    const m = Object.fromEntries(players.map(p => [p.id, 0]));
    plan.forEach(({ gk, att, mid, def, att2, mid2, def2 }) => {
      if (gk) m[gk] = (m[gk] ?? 0) + FULL;
      if (att2 != null) {
        /* Two-half rotation: each half gets FULL/2 */
        [...att, ...(mid ?? []), ...def].forEach(id => { if (id) m[id] = (m[id] ?? 0) + HALF; });
        [...(att2 ?? []), ...(mid2 ?? []), ...(def2 ?? [])].forEach(id => { if (id) m[id] = (m[id] ?? 0) + HALF; });
      } else {
        att.forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
        (mid ?? []).forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
        def.forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
      }
    });
    return m;
  };

  const calcPositionStats = () => {
    if (!plan) return {};
    const stats = Object.fromEntries(
      activePlayers.map(p => [p.id, { gk: 0, att: 0, mid: 0, def: 0, bench: 0 }])
    );
    plan.forEach(({ gk, att, mid, def, att2, mid2, def2, bench }) => {
      if (gk && stats[gk]) stats[gk].gk++;
      [...att, ...(att2 ?? [])].forEach(id => { if (id && stats[id]) stats[id].att++; });
      [...(mid ?? []), ...(mid2 ?? [])].forEach(id => { if (id && stats[id]) stats[id].mid++; });
      [...def, ...(def2 ?? [])].forEach(id => { if (id && stats[id]) stats[id].def++; });
      bench.forEach(id => { if (id && stats[id]) stats[id].bench++; });
    });
    return stats;
  };

  const mins = calcMins();
  const posStats = calcPositionStats();
  const totalPossible = settings.periods * settings.duration;

  /* ─── Sub-components ─── */
  const Chip = ({ id, small = false, inGKSlot = false, periodIdx }) => {
    if (!id) return null;
    const p = getP(id);
    if (!p) return null;
    if (p.enabled === false) return null;
    const isSelected = sel?.id === id;
    const isSel2nd = sel && sel.id !== id;
    const activeGK = p.isGK && inGKSlot;

    return (
      <div
        onClick={e => { e.stopPropagation(); tapPlayer(id, periodIdx); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          maxWidth: "100%", overflow: "hidden",
          background: isSelected ? "#fef08a" : "#0f172a",
          color: isSelected ? "#0f172a" : "#e2e8f0",
          border: `2px solid ${isSelected ? "#fbbf24" : activeGK ? "#fbbf24" : "#334155"}`,
          borderRadius: 8,
          padding: small ? "3px 7px" : "4px 8px",
          fontSize: small ? 12 : 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s",
          userSelect: "none", WebkitUserSelect: "none",
          opacity: isSel2nd ? 0.75 : 1,
          boxShadow: isSelected ? "0 0 0 3px rgba(251,191,36,0.3)" : "none",
        }}
      >
        {activeGK && (
          <span style={{ fontSize: 11, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
        )}
        {p.isGK && !inGKSlot && (
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>mv</span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName(p)}</span>
      </div>
    );
  };

  const Pitch = ({ att, mid, def, subAtt, subMid, subDef, gk, periodIdx, subsAreLive }) => {
    const showPositions = settings.positions !== false;
    return (
      <div style={{
        background: "linear-gradient(180deg, #0a1f12 0%, #0d2818 50%, #0a1f12 100%)",
        padding: "12px 12px 10px", position: "relative",
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(180deg, transparent 0px, transparent 39px, rgba(255,255,255,0.02) 39px, rgba(255,255,255,0.02) 40px)", pointerEvents: "none" }} />
        {showPositions ? (
          <>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: "#f97316", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 8, fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}><Zap size={11} /> Anfallszon</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "flex-start" }}>
                {att.map((id, j) => <PositionSlot key={j} starterId={id} subId={subAtt?.[j]} label={`Anfall ${j + 1}`} periodIdx={periodIdx} subsAreLive={subsAreLive} />)}
              </div>
            </div>
            <div style={{ textAlign: "center", margin: "10px 0", position: "relative" }}>
              <div style={{ borderTop: "1px dashed #1a5c33", position: "absolute", top: "50%", left: 0, right: 0 }} />
              <div style={{ display: "inline-block", width: 18, height: 18, borderRadius: "50%", border: "1px dashed #1a5c33", background: "#0d2818", position: "relative", lineHeight: "16px", fontSize: 8, color: "#1a5c33" }}>○</div>
            </div>
            {fmt.mid > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 8, fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}><Layers size={11} /> Mittfält</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "flex-start" }}>
                  {(mid ?? []).map((id, j) => <PositionSlot key={j} starterId={id} subId={subMid?.[j]} label={`Mitt ${j + 1}`} periodIdx={periodIdx} subsAreLive={subsAreLive} />)}
                </div>
              </div>
            )}
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "flex-start" }}>
                {def.map((id, j) => <PositionSlot key={j} starterId={id} subId={subDef?.[j]} label={`Försvar ${j + 1}`} periodIdx={periodIdx} subsAreLive={subsAreLive} />)}
              </div>
              <div style={{ fontSize: 11, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginTop: 8, fontWeight: 600, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}><Shield size={11} /> Försvarszon</div>
            </div>
          </>
        ) : (
          <div style={{ padding: "4px 0 8px" }}>
            <div style={{ fontSize: 11, color: "#4ade80", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 10, fontWeight: 600, opacity: 0.8 }}>På plan</div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, alignItems: "flex-start" }}>
              {[...att, ...(mid ?? []), ...def].map((id, j) => {
                const subList = [...(subAtt ?? []), ...(subMid ?? []), ...(subDef ?? [])];
                return <PositionSlot key={j} starterId={id} subId={subList[j]} label="" periodIdx={periodIdx} subsAreLive={subsAreLive} />;
              })}
            </div>
          </div>
        )}
        {fmt.hasGK && (
          <>
            <div style={{ borderTop: "2px solid #1a5c33", margin: "10px 0" }} />
            <div style={{ display: "flex", justifyContent: "center" }}>
              <PositionSlot starterId={gk} label="Målvakt" periodIdx={periodIdx} subsAreLive={false} />
            </div>
          </>
        )}
      </div>
    );
  };

  /* Each pitch slot shows the starter (1st half) with the sub (2nd half) below
     when there's a halftime rotation. Both are always visible; opacity flips
     so the coach can see who's currently on and who's coming in. */
  const PositionSlot = ({ starterId, subId, label, periodIdx, subsAreLive }) => {
    const starter = starterId ? getP(starterId) : null;
    const sub = (subId && subId !== starterId) ? getP(subId) : null;
    const showStarter = starter && starter.enabled !== false;
    const showSub = sub && sub.enabled !== false;
    const isGKLabel = label === "Målvakt";
    return (
      <div style={{ textAlign: "center", flex: "1 1 0", minWidth: 0, maxWidth: 120 }}>
        {label && (
          <div style={{ fontSize: 11, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5, fontWeight: 600 }}>
            {label}
          </div>
        )}
        {showStarter ? (
          <div style={{ opacity: subsAreLive ? 0.35 : 1, transition: "opacity 0.25s" }}>
            <Chip id={starterId} inGKSlot={isGKLabel} periodIdx={periodIdx} />
          </div>
        ) : !starter && (
          <div style={{ background: "#0f172a", border: "1px dashed #1e3a28", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "#334155" }}>—</div>
        )}
        {showSub && (
          <div style={{ marginTop: 5, opacity: subsAreLive ? 1 : 0.35, transition: "opacity 0.25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <ArrowUpDown size={10} color="#64748b" style={{ flexShrink: 0 }} />
            <Chip id={subId} inGKSlot={isGKLabel} periodIdx={periodIdx} />
          </div>
        )}
      </div>
    );
  };

  /* ─── Styles ─── */
  const S = {
    app:   { fontFamily: "'DM Sans', system-ui, sans-serif", background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", fontSize: 14 },
    header: { background: "linear-gradient(135deg, #0a1929 0%, #0d2137 100%)", padding: "16px 20px", borderBottom: "1px solid #1e3a5f" },
    tabs:  { background: "#0d1f33", display: "flex", padding: "0 20px", borderBottom: "1px solid #1e3a5f" },
    tab:   active => ({
      padding: "11px 18px", background: "none", border: "none", cursor: "pointer",
      color: active ? "#84cc16" : "#64748b",
      borderBottom: `2px solid ${active ? "#84cc16" : "transparent"}`,
      fontSize: 14, fontWeight: active ? 600 : 400, transition: "all 0.15s",
      display: "inline-flex", alignItems: "center", gap: 6,
    }),
    body:  { padding: isDesktop ? "24px 32px 60px" : "16px 16px 40px", maxWidth: isDesktop ? 980 : "100%", margin: "0 auto" },
    card:  { background: "#1e293b", borderRadius: 12, marginBottom: 12, overflow: "hidden" },
    btn:   (variant = "primary") => ({
      border: "none", borderRadius: 9, cursor: "pointer",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontWeight: 600, transition: "all 0.15s",
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
      ...(variant === "primary"   ? { background: "#84cc16", color: "#0f172a" } : {}),
      ...(variant === "secondary" ? { background: "#1e293b", color: "#84cc16", border: "1px solid #334155" } : {}),
      ...(variant === "ghost"     ? { background: "transparent", color: "#94a3b8" } : {}),
    }),
  };

  /* ─── Render ─── */
  if (kvLoading) return (
    <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15 }}>
      Laddar matchplan…
    </div>
  );

  return (
    <div style={S.app} onClick={() => setSel(null)}>

      {/* Header */}
      <div style={S.header}>
        <div
          onClick={e => { e.stopPropagation(); resetAll(); }}
          title="Klicka för att återställa allt"
          style={{ fontFamily: "'Bebas Neue'", fontSize: "clamp(20px, 7vw, 30px)", letterSpacing: 2, color: "#f8fafc", lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "baseline", gap: 10 }}
        >
          Matchplaneraren <span style={{ fontSize: "0.6em", color: "#84cc16", letterSpacing: 2 }}>{settings.format}</span>
        </div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4, lineHeight: 1.6 }}>
          {activePlayers.length}/{players.length} sp &nbsp;·&nbsp; {settings.periods}x{settings.duration} min &nbsp;·&nbsp; {settings.subs} byte per period
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[
          { key: "players", Icon: Users,        text: "Spelare" },
          { key: "plan",    Icon: ClipboardList, text: "Matchplan" },
        ].map(({ key, Icon: TabIcon, text }) => (
          <button key={key} style={S.tab(tab === key)}
            onClick={e => { e.stopPropagation(); setTab(key); }}>
            <TabIcon size={14} /> {text}
          </button>
        ))}
      </div>

      <div style={S.body} onClick={e => e.stopPropagation()}>

        {/* ═══ PLAYERS TAB ═══ */}
        {tab === "players" && (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              Tryck för att redigera · MV = Målvakt
            </div>

            <div style={isDesktop ? { display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" } : {}}>
            <div>

            {players.map((p, i) => (
              <div
                key={p.id}
                draggable
                onDragStart={() => { dragIdx.current = i; }}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
                onDrop={e => {
                  e.preventDefault();
                  const from = dragIdx.current;
                  if (from === null || from === i) { setDragOverIdx(null); return; }
                  const next = [...players];
                  next.splice(i, 0, next.splice(from, 1)[0]);
                  setPlayers(next);
                  dragIdx.current = null;
                  setDragOverIdx(null);
                }}
                onDragEnd={() => { dragIdx.current = null; setDragOverIdx(null); }}
                style={{
                  ...S.card, padding: "10px 12px", display: "flex", alignItems: "center", gap: 6,
                  opacity: dragIdx.current === i ? 0.4 : (p.enabled !== false ? 1 : 0.42),
                  outline: dragOverIdx === i ? "2px solid #4ade80" : "none",
                  outlineOffset: 2, cursor: "grab",
                }}>
                <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => movePlayer(p.id, -1)}
                    disabled={i === 0}
                    title="Flytta upp"
                    aria-label="Flytta upp"
                    style={{
                      background: "transparent", border: "none", padding: "4px 2px",
                      color: i === 0 ? "#334155" : "#64748b",
                      cursor: i === 0 ? "default" : "pointer", lineHeight: 0,
                    }}>
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => movePlayer(p.id, 1)}
                    disabled={i === players.length - 1}
                    title="Flytta ner"
                    aria-label="Flytta ner"
                    style={{
                      background: "transparent", border: "none", padding: "4px 2px",
                      color: i === players.length - 1 ? "#334155" : "#64748b",
                      cursor: i === players.length - 1 ? "default" : "pointer", lineHeight: 0,
                    }}>
                    <ChevronDown size={14} />
                  </button>
                </div>
                <button
                  onClick={() => updP(p.id, "enabled", p.enabled === false)}
                  title={p.enabled !== false ? "Avaktivera (ej med idag)" : "Aktivera"}
                  style={{
                    position: "relative", flexShrink: 0,
                    width: 36, height: 20, borderRadius: 10, padding: 0,
                    background: p.enabled !== false ? "#84cc16" : "#334155",
                    border: "none", cursor: "pointer", transition: "background 0.2s",
                  }}
                >
                  <div style={{
                    position: "absolute", top: 2,
                    left: p.enabled !== false ? 17 : 2,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "#fff", transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                  }} />
                </button>

                <input
                  id={`player-name-${p.id}`}
                  value={p.name}
                  placeholder={`Spelare ${i + 1}`}
                  onChange={e => updP(p.id, "name", e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                      e.preventDefault();
                      const idx = players.findIndex(pl => pl.id === p.id);
                      const next = players[idx + 1];
                      if (next) document.getElementById(`player-name-${next.id}`)?.focus();
                      else document.getElementById("new-player-input")?.focus();
                    } else if (e.key === "Tab" && e.shiftKey) {
                      e.preventDefault();
                      const idx = players.findIndex(pl => pl.id === p.id);
                      const prev = players[idx - 1];
                      if (prev) document.getElementById(`player-name-${prev.id}`)?.focus();
                    }
                  }}
                  style={{ flex: 1, minWidth: 0, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 15, fontWeight: 500, outline: "none", padding: "3px 7px" }}
                />

                <button
                  onClick={() => updP(p.id, "isGK", !p.isGK)}
                  style={{ ...S.btn(p.isGK ? "primary" : "ghost"), padding: "3px 8px", fontSize: 12, borderRadius: 6, border: p.isGK ? "none" : "1px solid #334155" }}>
                  MV
                </button>

                {settings.positions !== false && (
                  <div style={{ display: "flex", gap: 3 }}>
                    {PREFS.map(pr => (
                      <button key={pr.key} onClick={() => updP(p.id, "pref", pr.key)}
                        title={pr.label}
                        style={{
                          background: p.pref === pr.key ? pr.color : "#1a2940",
                          border: "none", borderRadius: 6, padding: "3px 7px",
                          fontSize: 12, cursor: "pointer", transition: "all 0.15s",
                          color: p.pref === pr.key ? (pr.key === "neutral" ? "#0f172a" : "#fff") : "#64748b",
                          display: "inline-flex", alignItems: "center",
                        }}>
                        <pr.Icon size={12} />
                      </button>
                    ))}
                  </div>
                )}

                <button onClick={() => delP(p.id)}
                  style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: "0 2px", display: "inline-flex", alignItems: "center" }}>
                  <X size={14} />
                </button>
              </div>
            ))}


            {/* Add player */}
            <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 16 }}>
              <input
                id="new-player-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addPlayer()}
                placeholder="Spelarens namn..."
                style={{
                  flex: 1, background: "#1e293b", border: "1px solid #334155",
                  color: "#e2e8f0", borderRadius: 9, padding: "10px 13px", fontSize: 14, outline: "none",
                }}
              />
              <button onClick={addPlayer} style={{ ...S.btn("primary"), padding: "10px 16px", fontSize: 14 }}>
                + Lägg till
              </button>
            </div>

            </div>
            <div>

            {/* Legend */}
            {settings.positions !== false && (
              <div style={{ ...S.card, padding: "10px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Preferenser</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {PREFS.map(pr => (
                    <div key={pr.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <pr.Icon size={14} color={pr.color} />
                      <span style={{ fontSize: 12, color: pr.color }}>{pr.label}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 11, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
                    <span style={{ fontSize: 12, color: "#fbbf24" }}>Målvakt</span>
                  </div>
                </div>
              </div>
            )}

            {/* Settings */}
            <div style={{ ...S.card, padding: "14px" }}>
              <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
                Matchinställningar
              </div>

              {/* Team names */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#cbd5e1", fontSize: 14, display: "block", marginBottom: 6 }}>Hemmalag</span>
                  <input id="home-team-input" value={homeTeam} onChange={e => setHomeTeam(e.target.value)} placeholder="Lagnamn"
                    onKeyDown={e => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); document.getElementById("away-team-input")?.focus(); } }}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 7, color: "#e2e8f0", fontSize: 14, outline: "none", padding: "7px 9px", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#cbd5e1", fontSize: 14, display: "block", marginBottom: 6 }}>Bortalag</span>
                  <input id="away-team-input" value={awayTeam} onChange={e => setAwayTeam(e.target.value)} placeholder="Lagnamn"
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 7, color: "#e2e8f0", fontSize: 14, outline: "none", padding: "7px 9px", boxSizing: "border-box" }} />
                </div>
              </div>

              {/* Format selector */}
              <div style={{ marginBottom: 16 }}>
                <span style={{ color: "#cbd5e1", fontSize: 14, display: "block", marginBottom: 8 }}>Spelform</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {FORMATS.map(f => (
                    <button key={f.key}
                      onClick={() => setSettings(s => ({ ...s, format: f.key }))}
                      style={{
                        ...S.btn(settings.format === f.key ? "primary" : "secondary"),
                        padding: "5px 12px", fontSize: 13,
                      }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {!FM[settings.format]?.hasGK && (
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                    Ej målvakt — alla spelare är utespelare
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                <span style={{ flex: 1, color: "#cbd5e1", fontSize: 14 }}>Positioner</span>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => setSettings(s => ({ ...s, positions: true }))}
                    style={{ ...S.btn(settings.positions !== false ? "primary" : "secondary"), padding: "5px 12px", fontSize: 13 }}>
                    Ja
                  </button>
                  <button onClick={() => setSettings(s => ({ ...s, positions: false }))}
                    style={{ ...S.btn(settings.positions === false ? "primary" : "secondary"), padding: "5px 12px", fontSize: 13 }}>
                    Nej
                  </button>
                </div>
              </div>

              {[
                ["periods",  "Perioder",      1, 6],
                ["duration", "Min / period",  5, 30],
                ["subs",     "Byten / period",0, 4],
              ].map(([key, label, min, max]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ flex: 1, color: "#cbd5e1", fontSize: 14 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => setSettings(s => ({ ...s, [key]: Math.max(min, s[key] - 1) }))}
                      style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 7, width: 30, height: 30, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      −
                    </button>
                    <span style={{ fontSize: 17, fontWeight: 700, minWidth: 26, textAlign: "center", color: "#84cc16" }}>
                      {settings[key]}
                    </span>
                    <button onClick={() => setSettings(s => ({ ...s, [key]: Math.min(max, s[key] + 1) }))}
                      style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 7, width: 30, height: 30, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Generate button */}
            <button onClick={doGenerate} style={{
              ...S.btn("primary"), width: "100%", marginTop: 16, padding: 15,
              fontSize: 17, fontFamily: "'Bebas Neue'", letterSpacing: 3,
            }}>
              GENERERA MATCHPLAN <ChevronRight size={17} />
            </button>
            {originalPlan && (
              <button onClick={doReset} style={{ ...S.btn("secondary"), width: "100%", marginTop: 8, padding: "9px 0", fontSize: 13 }}>
                <RotateCcw size={13} /> Återställ till original
              </button>
            )}
            {renderShareControl({ marginTop: 8 })}

            </div>
            </div>
          </div>
        )}

        {/* ═══ PLAN TAB ═══ */}
        {tab === "plan" && !plan && (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#64748b" }}>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
              <ClipboardList size={48} color="#64748b" />
            </div>
            <div style={{ marginBottom: 20, fontSize: 15 }}>Ingen matchplan skapad ännu.</div>
            <button onClick={() => setTab("players")}
              style={{ ...S.btn("primary"), padding: "12px 24px", fontSize: 14 }}>
              Gå till spelare <ChevronRight size={14} />
            </button>
          </div>
        )}

        {tab === "plan" && plan && (
          <div>
            {sel && (
              <div style={{
                borderRadius: 9, padding: "9px 14px", marginBottom: 12, fontSize: 12, textAlign: "center",
                background: "#422006", color: "#fed7aa", border: "1px solid #7c2d12",
              }}>
                Markerat <strong>{(() => { const p = getP(sel.id); return p ? displayName(p) : ""; })()}</strong> i period {sel.periodIdx + 1} — tryck på en annan spelare i samma period för att byta.
              </div>
            )}
            <div style={{ marginBottom: 16 }} />

            {/* ─── Timer ─── */}
            {(() => {
              const periodSecs  = settings.duration * 60;
              const halfSecs    = Math.round(periodSecs / 2);
              const isOvertime  = timerElapsed >= periodSecs;
              const isSwitchDue = settings.subs >= 1 && timerElapsed >= halfSecs;
              const switchBlink = isSwitchDue && !isOvertime && timerElapsed % 2 === 0;
              const barPct      = Math.min(timerElapsed / periodSecs * 100, 100);
              const barColor    = isOvertime ? "#f87171" : isSwitchDue ? "#fb923c" : "#4ade80";
              const timeColor   = isOvertime ? "#f87171" : isSwitchDue ? "#fb923c" : "#e2e8f0";
              const clampedPeriod = Math.min(timerPeriod, plan.length - 1);

              const goPrev = () => { setTimerPeriod(p => Math.max(0, p - 1)); seekTimer(0); };
              const goNext = () => { setTimerPeriod(p => Math.min(plan.length - 1, p + 1)); seekTimer(0); setTimerRunning(true); };
              const reset  = () => { setTimerRunning(false); setTimerElapsed(0); };

              return (
                <>
                  {/* Compact fixed overlay — position:fixed so it never shifts layout */}
                  {timerCompact && (
                    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "#1e293b", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
                      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, color: "#94a3b8", flexShrink: 0 }}>
                            {`P${clampedPeriod + 1}/${plan.length}`}
                          </span>
                          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 38, letterSpacing: 3, color: timeColor, lineHeight: 1, flex: 1 }}>
                            {fmtTime(timerElapsed)}
                          </span>
                          {isSwitchDue && !isOvertime && <ArrowUpDown size={15} color="#fb923c" style={{ flexShrink: 0 }} />}
                          {isOvertime && <AlertTriangle size={15} color="#f87171" style={{ flexShrink: 0 }} />}
                          <button onClick={() => setTimerRunning(r => !r)}
                            style={{ ...S.btn("primary"), padding: "7px 12px", flexShrink: 0 }}>
                            {timerRunning ? <Pause size={14} /> : <Play size={14} />}
                          </button>
                        </div>
                        <div
                          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const dx = e.clientX - r.left; seekTimer(dx / r.width * periodSecs); }}
                          style={{ height: 6, background: "#0f172a", borderRadius: 3, cursor: "pointer", overflow: "hidden" }}>
                          <div style={{ width: `${barPct}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.8s linear" }} />
                        </div>
                        {(() => {
                          const Sc = ({ score, setScore, name }) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "center" }}>
                              <button onClick={() => setScore(s => Math.max(0, s - 1))}
                                style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>−</button>
                              <div style={{ textAlign: "center", minWidth: 44 }}>
                                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 34, color: "#e2e8f0", lineHeight: 1 }}>{score}</div>
                                <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 70 }}>{name}</div>
                              </div>
                              <button onClick={() => setScore(s => s + 1)}
                                style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>+</button>
                            </div>
                          );
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Sc score={homeScore} setScore={setHomeScore} name={homeTeam || "Hemmalag"} />
                              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: "#64748b", flexShrink: 0 }}>—</div>
                              <Sc score={awayScore} setScore={setAwayScore} name={awayTeam || "Bortalag"} />
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Full card — always in flow; visibility:hidden when compact preserves its space so nothing jumps */}
                  <div ref={timerSentinelRef} style={{ visibility: timerCompact ? "hidden" : "visible", marginBottom: 16 }}>
                    <div style={{ ...S.card, boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
                  <div style={{ padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, color: "#64748b" }}>TIMER</div>
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>Period {clampedPeriod + 1} / {plan.length}</div>
                  </div>

                  {/* Big time display */}
                  <div style={{ textAlign: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: "'Bebas Neue'", fontSize: 60, letterSpacing: 4, color: timeColor, lineHeight: 1, transition: "color 0.3s" }}>
                      {fmtTime(timerElapsed)}
                    </span>
                    <span style={{ fontSize: 13, color: "#64748b", marginLeft: 6 }}>/ {settings.duration}:00</span>
                  </div>

                  {/* Progress bar */}
                  <div
                    onClick={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const dx = e.clientX - rect.left;
                      const pct = dx / rect.width;
                      seekTimer(Math.max(0, pct) * periodSecs);
                    }}
                    style={{ background: "#0f172a", borderRadius: 6, height: 10, marginBottom: 4, position: "relative", overflow: "hidden", cursor: "pointer" }}>
                    {settings.subs >= 1 && (
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "#1e3a5f", zIndex: 1 }} />
                    )}
                    <div style={{ background: barColor, width: `${barPct}%`, height: "100%", borderRadius: 6, transition: "width 0.8s linear, background 0.3s", pointerEvents: "none" }} />
                  </div>
                  {settings.subs >= 1 && (
                    <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", marginBottom: 10, letterSpacing: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}>
                      <ArrowUpDown size={12} /> byte vid {Math.round(settings.duration / 2)} min
                    </div>
                  )}

                  {/* Status banners */}
                  {isSwitchDue && !isOvertime && timerElapsed < halfSecs + 60 && (
                    <div style={{
                      background: switchBlink ? "#7c2d12" : "#431407",
                      border: "1px solid #ea580c", borderRadius: 8,
                      padding: "8px 12px", textAlign: "center",
                      fontSize: 13, fontWeight: 700, color: "#fed7aa", marginBottom: 10,
                      transition: "background 0.2s",
                      display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
                    }}>
                      <ArrowUpDown size={13} /> BYT SPELARE NU!
                    </div>
                  )}
                  {isOvertime && (
                    <div style={{
                      background: "#450a0a", border: "1px solid #dc2626", borderRadius: 8,
                      padding: "8px 12px", textAlign: "center",
                      fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 10,
                      display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
                    }}>
                      <AlertTriangle size={13} /> ÖVERTID +{fmtTime(timerElapsed - periodSecs)}
                    </div>
                  )}

                  {/* Controls */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={reset}
                      style={{ ...S.btn("secondary"), padding: "9px 11px" }}>
                      <RotateCcw size={15} />
                    </button>
                    <button onClick={() => seekTimer(timerElapsed - 15)}
                      style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700 }}>−15s</button>
                    <button onClick={() => setTimerRunning(r => !r)}
                      style={{ ...S.btn("primary"), flex: 2, padding: "9px 0", fontSize: 14 }}>
                      {timerRunning ? <><Pause size={14} /> Pausa</> : <><Play size={14} /> {timerElapsed > 0 ? "Fortsätt" : "Starta"}</>}
                    </button>
                    <button onClick={() => seekTimer(timerElapsed + 15)}
                      style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700 }}>+15s</button>
                    <button onClick={goPrev} disabled={timerPeriod === 0}
                      style={{ ...S.btn("secondary"), padding: "9px 11px", opacity: timerPeriod === 0 ? 0.35 : 1 }}>
                      <SkipBack size={15} />
                    </button>
                    <button onClick={goNext} disabled={timerPeriod >= plan.length - 1}
                      style={{ ...S.btn("secondary"), padding: "9px 11px", opacity: timerPeriod >= plan.length - 1 ? 0.35 : 1 }}>
                      <SkipForward size={15} />
                    </button>
                  </div>

                  {/* Scoreboard */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Hemma</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: homeTeam ? "#e2e8f0" : "#475569", marginBottom: 10, padding: "6px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: 17 }}>
                        {homeTeam || "Hemmalag"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                        <button onClick={() => setHomeScore(s => Math.max(0, s - 1))} style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 7, width: 30, height: 30, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 44, color: "#e2e8f0", minWidth: 40, textAlign: "center", lineHeight: 1 }}>{homeScore}</span>
                        <button onClick={() => setHomeScore(s => s + 1)} style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 7, width: 30, height: 30, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 32, color: "#64748b", flexShrink: 0, paddingTop: 24 }}>—</div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Borta</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: awayTeam ? "#e2e8f0" : "#475569", marginBottom: 10, padding: "6px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: 17 }}>
                        {awayTeam || "Bortalag"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                        <button onClick={() => setAwayScore(s => Math.max(0, s - 1))} style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 7, width: 30, height: 30, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 44, color: "#e2e8f0", minWidth: 40, textAlign: "center", lineHeight: 1 }}>{awayScore}</span>
                        <button onClick={() => setAwayScore(s => s + 1)} style={{ background: "#334155", border: "none", color: "#e2e8f0", borderRadius: 7, width: 30, height: 30, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                      </div>
                    </div>
                  </div>
                  </div>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Share link */}
            <div style={{ marginBottom: 16 }}>{renderShareControl()}</div>

            {/* Two-column on desktop: periods left, stats right */}
            <div style={isDesktop ? { display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" } : {}}>

            {/* Period cards */}
            <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: isDesktop ? 24 : 0 }}>
              {plan.map((period, i) => {
                const pSecs = settings.duration * 60;
                const hSecs = Math.round(pSecs / 2);
                const subsAreLive = i === timerPeriod && period.att2 != null && timerElapsed >= hSecs;
                const hasBench = period.bench.length > 0;
                return (
                <div key={i}>
                  {/* Mobile break separator between periods */}
                  {!isDesktop && i > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "24px 0 20px" }}>
                      <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 3, fontWeight: 600 }}>paus</div>
                      <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
                    </div>
                  )}

                  <div style={{
                    ...S.card, marginBottom: 0,
                    outline: timerPeriod === i ? `2px solid ${timerRunning ? "#4ade80" : "#334155"}` : "none",
                    outlineOffset: 2,
                  }}>

                    {/* Period header */}
                    <div
                      onClick={() => togglePeriod(i)}
                      title={collapsedPeriods.has(i) ? "Expandera period" : "Komprimera period"}
                      style={{
                        background: "linear-gradient(135deg, #0a2e1a 0%, #0d3821 100%)",
                        padding: "10px 16px",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderBottom: collapsedPeriods.has(i) ? "none" : "1px solid #1a5c33",
                        cursor: "pointer", userSelect: "none",
                      }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {collapsedPeriods.has(i)
                          ? <ChevronRight size={16} color="#4ade80" />
                          : <ChevronDown size={16} color="#4ade80" />}
                        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: "#4ade80" }}>
                          Period {i + 1}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#4ade80", opacity: 0.7 }}>
                        {settings.format} &nbsp;·&nbsp; {settings.duration} min
                      </div>
                    </div>

                    {!collapsedPeriods.has(i) && (
                      <div style={isDesktop && hasBench ? { display: "grid", gridTemplateColumns: "1fr 150px", alignItems: "stretch" } : {}}>
                        <div>
                          <Pitch
                            att={period.att} mid={period.mid} def={period.def}
                            subAtt={period.att2} subMid={period.mid2} subDef={period.def2}
                            gk={period.gk} periodIdx={i} subsAreLive={subsAreLive}
                          />
                        </div>
                        {hasBench && (
                          <div style={{
                            background: "#0d1a26",
                            ...(isDesktop
                              ? { borderLeft: "1px solid #1e293b", padding: "12px 12px" }
                              : { borderTop: "1px solid #1e293b", padding: "10px 14px" }),
                          }}>
                            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 7, fontWeight: 600 }}>
                              Bänk
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flexDirection: isDesktop ? "column" : "row", alignItems: isDesktop ? "stretch" : "center" }}>
                              {period.bench.map(id => <Chip key={id} id={id} small periodIdx={i} />)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            </div>

            {/* ─── Right column: Playing time summary ─── */}
            <div style={isDesktop ? { position: "sticky", top: 0 } : { marginTop: 24 }}>
            <div style={{ ...S.card, padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, color: "#94a3b8" }}>
                  Speltid — {totalPossible} min totalt
                </div>
                {settings.positions !== false && (
                  <button onClick={doShuffle} title="Slumpa positionerna"
                    style={{
                      ...S.btn("secondary"),
                      padding: "6px 10px", fontSize: 12, flexShrink: 0,
                      background: justShuffled ? "#84cc16" : "#1e293b",
                      color: justShuffled ? "#0f172a" : "#84cc16",
                      transition: "background 0.2s, color 0.2s",
                    }}>
                    <Shuffle size={13} /> {justShuffled ? "Slumpat!" : "Slumpa"}
                  </button>
                )}
              </div>
              {[...activePlayers]
                .sort((a, b) => (mins[b.id] ?? 0) - (mins[a.id] ?? 0))
                .map(p => {
                  const m = mins[p.id] ?? 0;
                  const pct = totalPossible > 0 ? (m / totalPossible) * 100 : 0;
                  const pref = PM[p.pref];
                  const barColor = p.isGK ? "#fbbf24" : pref.color;
                  const textColor = pct >= 75 ? "#4ade80" : pct >= 45 ? "#fbbf24" : "#f87171";

                  const ps = posStats[p.id] ?? {};
                  const posBadges = [
                    ps.gk    > 0 && { key: "gk",    label: "MV",   Icon: null,    count: ps.gk,    bg: "#fbbf2426", color: "#fbbf24" },
                    ps.att   > 0 && { key: "att",   label: null,   Icon: Zap,     count: ps.att,   bg: "#f9731626", color: "#f97316" },
                    ps.mid   > 0 && { key: "mid",   label: null,   Icon: Shuffle, count: ps.mid,   bg: "#94a3b826", color: "#94a3b8" },
                    ps.def   > 0 && { key: "def",   label: null,   Icon: Shield,  count: ps.def,   bg: "#60a5fa26", color: "#60a5fa" },
                    ps.bench > 0 && { key: "bench", label: "Bänk", Icon: null,    count: ps.bench, bg: "#1e293b",   color: "#64748b" },
                  ].filter(Boolean);

                  const showPositions = settings.positions !== false;
                  return (
                    <div key={p.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {p.isGK
                            ? <span style={{ fontSize: 11, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
                            : showPositions && <pref.Icon size={12} color={pref.color} />
                          }
                          <span style={{ fontSize: 13, color: "#cbd5e1" }}>{displayName(p)}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: textColor }}>
                          {m} min
                        </span>
                      </div>
                      {showPositions && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
                          {posBadges.map(b => (
                            <span key={b.key} style={{
                              fontSize: 11, fontWeight: 600, borderRadius: 5,
                              padding: "2px 6px", background: b.bg, color: b.color,
                              display: "inline-flex", alignItems: "center", gap: 3,
                            }}>
                              {b.Icon ? <b.Icon size={11} /> : b.label} ×{b.count}
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ background: "#0f172a", borderRadius: 5, height: 8, overflow: "hidden", display: "flex" }}>
                        {showPositions ? (
                          [
                            { count: ps.gk,    color: "#fbbf24" },
                            { count: ps.att,   color: "#f97316" },
                            { count: ps.mid,   color: "#94a3b8" },
                            { count: ps.def,   color: "#60a5fa" },
                            { count: ps.bench, color: "#1e3a5f" },
                          ].map(({ count, color }, si) => {
                            const total = (ps.gk ?? 0) + (ps.att ?? 0) + (ps.mid ?? 0) + (ps.def ?? 0) + (ps.bench ?? 0);
                            const c = count ?? 0;
                            const segPct = total > 0 ? (c / total) * 100 : 0;
                            return segPct > 0 ? <div key={si} style={{ width: `${segPct}%`, height: "100%", background: color, transition: "width 0.5s" }} /> : null;
                          })
                        ) : (
                          <div style={{ width: `${pct}%`, height: "100%", background: barColor, transition: "width 0.5s" }} />
                        )}
                      </div>
                    </div>
                  );
                })}

              {/* Fairness score */}
              {(() => {
                const vals = activePlayers.map(p => mins[p.id] ?? 0);
                const sum = vals.reduce((a, b) => a + b, 0);
                const avg = sum / vals.length;
                const maxDiff = Math.max(...vals.map(v => Math.abs(v - avg)));
                const fair = maxDiff <= settings.duration / 2;
                return (
                  <div style={{
                    marginTop: 12, padding: "8px 12px", borderRadius: 8,
                    background: fair ? "#0a2e1a" : "#2d1b0a",
                    border: `1px solid ${fair ? "#1a5c33" : "#7c3d12"}`,
                    fontSize: 12,
                    color: fair ? "#4ade80" : "#fb923c",
                    display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
                  }}>
                    {fair
                      ? <><Check size={12} /> Speltiden är jämnt fördelad</>
                      : <><AlertTriangle size={12} /> Max skillnad: {Math.round(maxDiff)} min — byt runt för bättre balans</>
                    }
                  </div>
                );
              })()}
            </div>
            <button onClick={doReset} disabled={!originalPlan}
              style={{ ...S.btn("secondary"), width: "100%", marginTop: 12, padding: "9px 0", fontSize: 13, opacity: !originalPlan ? 0.5 : 1 }}>
              <RotateCcw size={13} /> Återställ till original
            </button>
            </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

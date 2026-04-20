import { useState, useEffect, useCallback, useRef } from "react";

/* ─── ID factory ─── */
let _uid = 100;
const uid = () => ++_uid;

/* ─── Constants ─── */
const PREFS = [
  { key: "attack",  label: "Anfall",     icon: "▲", color: "#f97316" },
  { key: "neutral", label: "Balanserad", icon: "◆", color: "#94a3b8" },
  { key: "defense", label: "Försvar",    icon: "▼", color: "#60a5fa" },
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
  mkP("Spelare 1", true,  "neutral"),
  mkP("Spelare 2", false, "attack"),
  mkP("Spelare 3", false, "defense"),
  mkP("Spelare 4", false, "attack"),
  mkP("Spelare 5", false, "neutral"),
  mkP("Spelare 6", false, "defense"),
  mkP("Spelare 7", false, "attack"),
  mkP("Spelare 8", false, "neutral"),
  mkP("Spelare 9", false, "defense"),
];

/* ─── URL state ─── */
const initFromURL = (() => {
  try {
    const hash = window.location.hash.slice(1);
    if (!hash) return null;
    const decoded = JSON.parse(decodeURIComponent(atob(hash)));
    if (decoded?.players && decoded?.settings) return decoded;
  } catch {}
  return null;
})();

/* ─── Auto-generate algorithm ─── */
function generatePlan(players, settings) {
  const { periods, duration, subs } = settings;
  const fmt = FM[settings.format] ?? FM["5v5"];
  const FULL = duration;
  const fieldCount = fmt.att + fmt.mid + fmt.def;

  const gks = fmt.hasGK ? players.filter(p => p.isGK) : [];
  const mins = Object.fromEntries(players.map(p => [p.id, 0]));

  const fillPositions = pool => {
    const at = [], md = [], df = [];
    pool.filter(p => p.pref === "attack").forEach(p  => { if (at.length < fmt.att) at.push(p.id); });
    pool.filter(p => p.pref === "neutral").forEach(p => { if (md.length < fmt.mid) md.push(p.id); });
    pool.filter(p => p.pref === "defense").forEach(p => { if (df.length < fmt.def) df.push(p.id); });
    const used = new Set([...at, ...md, ...df]);
    pool.filter(p => !used.has(p.id)).forEach(p => {
      if      (at.length < fmt.att) at.push(p.id);
      else if (md.length < fmt.mid) md.push(p.id);
      else if (df.length < fmt.def) df.push(p.id);
    });
    while (at.length < fmt.att) at.push(null);
    while (md.length < fmt.mid) md.push(null);
    while (df.length < fmt.def) df.push(null);
    return { at, md, df };
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
      .sort((a, b) => mins[a.id] - mins[b.id]);

    if (subs >= 1) {
      /* Full half-time rotation: pick up to 2×fieldCount players */
      const HALF = FULL / 2;
      const take = Math.min(fieldCount * 2, avail.length);
      const selected  = avail.slice(0, take);
      const firstHalf  = selected.slice(0, fieldCount);
      const secondHalf = selected.slice(fieldCount);
      const bench = avail.slice(take);

      const pos1 = fillPositions(firstHalf);
      const pos2 = fillPositions(secondHalf);

      if (gkId) mins[gkId] += FULL;
      firstHalf.forEach(p  => { mins[p.id] += HALF; });
      secondHalf.forEach(p => { mins[p.id] += HALF; });

      const usedIds = new Set([gkId, ...selected.map(p => p.id)].filter(Boolean));
      return {
        gk: gkId,
        att: pos1.at, mid: pos1.md, def: pos1.df,
        att2: pos2.at, mid2: pos2.md, def2: pos2.df,
        bench: bench.map(p => p.id),
      };
    } else {
      /* No subs: single formation, full time */
      const starters = avail.slice(0, fieldCount);
      const pos = fillPositions(starters);

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

/* ─── Main App ─── */
export default function App() {
  const [tab, setTab]         = useState(initFromURL?.tab ?? "players");
  const [players, setPlayers] = useState(initFromURL?.players ?? DEMO);
  const [newName, setNewName] = useState("");
  const [settings, setSettings] = useState({
    periods: 3, duration: 15, subs: 1, format: "5v5",
    ...(initFromURL?.settings ?? {}),
  });
  const [plan, setPlan]         = useState(initFromURL?.plan ?? null);
  const [originalPlan, setOriginalPlan] = useState(initFromURL?.plan ?? null);
  const [sel, setSel]           = useState(null);
  const [copied, setCopied] = useState(false);
  const [winW, setWinW]     = useState(window.innerWidth);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0); // seconds
  const [timerPeriod,  setTimerPeriod]  = useState(0); // 0-indexed
  const timerRef = useRef(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch(e) {} };
  }, []);

  useEffect(() => {
    try {
      const encoded = btoa(encodeURIComponent(JSON.stringify({ players, settings, plan, tab })));
      window.history.replaceState(null, "", "#" + encoded);
    } catch {}
  }, [players, settings, plan, tab]);

  useEffect(() => {
    const h = () => setWinW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (timerRunning) {
      timerRef.current = setInterval(() => setTimerElapsed(e => e + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timerRunning]);

  const fmt       = FM[settings.format] ?? FM["5v5"];
  const isDesktop = winW >= 700;
  const fmtTime   = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const getP      = id => players.find(p => p.id === id);

  const addPlayer = () => {
    const n = newName.trim();
    if (!n) return;
    setPlayers(ps => [...ps, mkP(n)]);
    setNewName("");
  };

  const updP = (id, key, val) =>
    setPlayers(ps => ps.map(p => p.id === id ? { ...p, [key]: val } : p));

  const delP = id => setPlayers(ps => ps.filter(p => p.id !== id));

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
        {shareOpen ? "✕ Stäng dela" : "🔗 Dela länk"}
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
              {copied ? "✓ Kopierad!" : "Kopiera"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  /* Global schedule swap of two players */
  const tapPlayer = useCallback(id => {
    if (!id) return;
    if (!sel) { setSel(id); return; }
    if (sel === id) { setSel(null); return; }
    const a = sel, b = id;
    const sw = x => x === a ? b : x === b ? a : x;
    setPlan(pl => pl.map(period => ({
      gk:    sw(period.gk),
      att:   period.att.map(sw),
      mid:   (period.mid ?? []).map(sw),
      def:   period.def.map(sw),
      att2:  (period.att2 ?? []).map(sw),
      mid2:  (period.mid2 ?? []).map(sw),
      def2:  (period.def2 ?? []).map(sw),
      bench: period.bench.map(sw),
    })));
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
  const Chip = ({ id, small = false, inGKSlot = false }) => {
    if (!id) return null;
    const p = getP(id);
    if (!p) return null;
    const isSelected = sel === id;
    const isSel2nd = sel && sel !== id;
    const activeGK = p.isGK && inGKSlot;

    return (
      <div
        onClick={e => { e.stopPropagation(); tapPlayer(id); }}
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
          <span style={{ fontSize: 10, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
        )}
        {p.isGK && !inGKSlot && (
          <span style={{ fontSize: 9, color: "#475569", fontWeight: 600 }}>mv</span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      </div>
    );
  };

  const HalfLabel = ({ text }) => (
    <div style={{ fontSize: 9, color: "#4ade80", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 8, fontWeight: 700, opacity: 0.75 }}>
      {text}
    </div>
  );

  const PitchHalf = ({ att, mid, def, gk, showGK }) => (
    <div style={{
      background: "linear-gradient(180deg, #0a1f12 0%, #0d2818 50%, #0a1f12 100%)",
      padding: "12px 12px 10px", position: "relative",
    }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(180deg, transparent 0px, transparent 39px, rgba(255,255,255,0.02) 39px, rgba(255,255,255,0.02) 40px)", pointerEvents: "none" }} />
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: "#f97316", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 8, fontWeight: 600 }}>⚡ Anfallszon</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          {att.map((id, j) => <PositionSlot key={j} id={id} label={`Anfall ${j + 1}`} />)}
        </div>
      </div>
      <div style={{ textAlign: "center", margin: "10px 0", position: "relative" }}>
        <div style={{ borderTop: "1px dashed #1a5c33", position: "absolute", top: "50%", left: 0, right: 0 }} />
        <div style={{ display: "inline-block", width: 18, height: 18, borderRadius: "50%", border: "1px dashed #1a5c33", background: "#0d2818", position: "relative", lineHeight: "16px", fontSize: 8, color: "#1a5c33" }}>○</div>
      </div>
      {fmt.mid > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 8, fontWeight: 600 }}>⚖ Mittfält</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            {(mid ?? []).map((id, j) => <PositionSlot key={j} id={id} label={`Mitt ${j + 1}`} />)}
          </div>
        </div>
      )}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          {def.map((id, j) => <PositionSlot key={j} id={id} label={`Försvar ${j + 1}`} />)}
        </div>
        <div style={{ fontSize: 9, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginTop: 8, fontWeight: 600 }}>🛡 Försvarszon</div>
      </div>
      {showGK && fmt.hasGK && (
        <>
          <div style={{ borderTop: "2px solid #1a5c33", margin: "10px 0" }} />
          <div style={{ display: "flex", justifyContent: "center" }}>
            <PositionSlot id={gk} label="Målvakt" />
          </div>
        </>
      )}
    </div>
  );

  const PositionSlot = ({ id, label }) => (
    <div style={{ textAlign: "center", flex: "1 1 0", minWidth: 0, maxWidth: 120 }}>
      <div style={{ fontSize: 9, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5, fontWeight: 600 }}>
        {label}
      </div>
      {id
        ? <Chip id={id} inGKSlot={label === "Målvakt"} />
        : <div style={{ background: "#0f172a", border: "1px dashed #1e3a28", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "#334155" }}>—</div>
      }
    </div>
  );

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
    }),
    body:  { padding: isDesktop ? "24px 32px 60px" : "16px 16px 40px", maxWidth: isDesktop ? (tab === "plan" ? 980 : 640) : "100%", margin: "0 auto" },
    card:  { background: "#1e293b", borderRadius: 12, marginBottom: 12, overflow: "hidden" },
    btn:   (variant = "primary") => ({
      border: "none", borderRadius: 9, cursor: "pointer",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontWeight: 600, transition: "all 0.15s",
      ...(variant === "primary"   ? { background: "#84cc16", color: "#0f172a" } : {}),
      ...(variant === "secondary" ? { background: "#1e293b", color: "#84cc16", border: "1px solid #334155" } : {}),
      ...(variant === "ghost"     ? { background: "transparent", color: "#94a3b8" } : {}),
    }),
  };

  /* ─── Render ─── */
  return (
    <div style={S.app} onClick={() => setSel(null)}>

      {/* Header */}
      <div style={S.header}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: "clamp(20px, 7vw, 30px)", letterSpacing: 2, color: "#f8fafc", lineHeight: 1 }}>
          Laguppställning {settings.format}
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 4, lineHeight: 1.6 }}>
          {activePlayers.length}/{players.length} sp &nbsp;·&nbsp; {settings.periods} per &nbsp;·&nbsp; {settings.duration} min &nbsp;·&nbsp; {settings.subs} byte
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[["players", "👥 Spelare"], ["plan", "📋 Matchplan"]].map(([key, label]) => (
          <button key={key} style={S.tab(tab === key)}
            onClick={e => { e.stopPropagation(); setTab(key); }}>
            {label}
          </button>
        ))}
      </div>

      <div style={S.body} onClick={e => e.stopPropagation()}>

        {/* ═══ PLAYERS TAB ═══ */}
        {tab === "players" && (
          <div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              Tryck för att redigera · MV = Målvakt
            </div>

            {players.map(p => (
              <div key={p.id} style={{ ...S.card, padding: "10px 12px", display: "flex", alignItems: "center", gap: 6, opacity: p.enabled !== false ? 1 : 0.42, transition: "opacity 0.15s" }}>
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
                  onChange={e => updP(p.id, "name", e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                      e.preventDefault();
                      const idx = players.findIndex(pl => pl.id === p.id);
                      const next = players[idx + 1];
                      if (next) document.getElementById(`player-name-${next.id}`)?.focus();
                    } else if (e.key === "Tab" && e.shiftKey) {
                      e.preventDefault();
                      const idx = players.findIndex(pl => pl.id === p.id);
                      const prev = players[idx - 1];
                      if (prev) document.getElementById(`player-name-${prev.id}`)?.focus();
                    }
                  }}
                  style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: "#e2e8f0", fontSize: 15, fontWeight: 500, outline: "none" }}
                />

                <button
                  onClick={() => updP(p.id, "isGK", !p.isGK)}
                  style={{ ...S.btn(p.isGK ? "primary" : "ghost"), padding: "3px 8px", fontSize: 11, borderRadius: 6, border: p.isGK ? "none" : "1px solid #334155" }}>
                  MV
                </button>

                <div style={{ display: "flex", gap: 3 }}>
                  {PREFS.map(pr => (
                    <button key={pr.key} onClick={() => updP(p.id, "pref", pr.key)}
                      title={pr.label}
                      style={{
                        background: p.pref === pr.key ? pr.color : "#1a2940",
                        border: "none", borderRadius: 6, padding: "3px 7px",
                        fontSize: 12, cursor: "pointer", transition: "all 0.15s",
                        color: p.pref === pr.key ? (pr.key === "neutral" ? "#0f172a" : "#fff") : "#475569",
                      }}>
                      {pr.icon}
                    </button>
                  ))}
                </div>

                <button onClick={() => delP(p.id)}
                  style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>
                  ×
                </button>
              </div>
            ))}

            {/* Position proposal */}
            {(() => {
              const gks = fmt.hasGK ? activePlayers.filter(p => p.isGK) : [];
              const field = activePlayers.filter(p => !(fmt.hasGK && p.isGK));
              const byPref = {
                attack:  field.filter(p => p.pref === "attack"),
                neutral: field.filter(p => p.pref === "neutral"),
                defense: field.filter(p => p.pref === "defense"),
              };
              const rows = [
                { pref: "attack",  label: "Anfall",   slots: fmt.att },
                ...(fmt.mid > 0 ? [{ pref: "neutral", label: "Mittfält", slots: fmt.mid }] : []),
                { pref: "defense", label: "Försvar",  slots: fmt.def },
              ];
              return (
                <div style={{ ...S.card, padding: "12px 14px", marginTop: 4, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                    Föreslagen rollfördelning &nbsp;·&nbsp; {activePlayers.length} aktiva
                  </div>
                  {fmt.hasGK && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
                      <span style={{ fontSize: 10, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>MV</span>
                      <span style={{ fontSize: 10, color: "#334155", minWidth: 55, flexShrink: 0 }}>1 plats</span>
                      <span style={{ fontSize: 12, color: gks.length > 0 ? "#cbd5e1" : "#475569" }}>
                        {gks.length > 0 ? gks.map(p => p.name).join(", ") : "Ingen utsedd målvakt"}
                      </span>
                    </div>
                  )}
                  {rows.map(({ pref, label, slots }) => {
                    const pr = PM[pref];
                    const matched = byPref[pref];
                    const extra = matched.length - slots;
                    return (
                      <div key={pref} style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: pr.color, fontWeight: 600, minWidth: 70, flexShrink: 0 }}>
                          {pr.icon} {label}
                        </span>
                        <span style={{ fontSize: 10, color: "#334155", minWidth: 55, flexShrink: 0 }}>
                          {slots} plats{slots !== 1 ? "er" : ""}
                        </span>
                        <span style={{ fontSize: 12, color: matched.length > 0 ? "#cbd5e1" : "#334155", flex: 1, minWidth: 0 }}>
                          {matched.length > 0 ? matched.map(p => p.name).join(", ") : "—"}
                          {extra > 0 && <span style={{ color: "#f87171", fontSize: 10 }}> +{extra} extra</span>}
                          {extra < 0 && <span style={{ color: "#fbbf24", fontSize: 10 }}> {Math.abs(extra)} fylls</span>}
                        </span>
                      </div>
                    );
                  })}
                  {settings.subs >= 1 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #1e3a5f", fontSize: 11, color: "#475569" }}>
                      ↕ {settings.subs} byte per period — spelarna roterar in halvvägs
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Add player */}
            <div style={{ display: "flex", gap: 8, marginTop: 4, marginBottom: 16 }}>
              <input
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

            {/* Legend */}
            <div style={{ ...S.card, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Preferenser</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {PREFS.map(pr => (
                  <div key={pr.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 14 }}>{pr.icon}</span>
                    <span style={{ fontSize: 12, color: pr.color }}>{pr.label}</span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 11, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
                  <span style={{ fontSize: 12, color: "#fbbf24" }}>Målvakt</span>
                </div>
              </div>
            </div>

            {/* Settings */}
            <div style={{ ...S.card, padding: "14px" }}>
              <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
                Matchinställningar
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
              fontSize: 17, fontFamily: "'Bebas Neue', cursive", letterSpacing: 3,
            }}>
              GENERERA MATCHPLAN →
            </button>

            <ShareBar />
          </div>
        )}

        {/* ═══ PLAN TAB ═══ */}
        {tab === "plan" && !plan && (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#475569" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
            <div style={{ marginBottom: 20, fontSize: 15 }}>Ingen matchplan skapad ännu.</div>
            <button onClick={() => setTab("players")}
              style={{ ...S.btn("primary"), padding: "12px 24px", fontSize: 14 }}>
              Gå till spelare →
            </button>
          </div>
        )}

        {tab === "plan" && plan && (
          <div>
            {/* Swap hint banner */}
            <div style={{
              borderRadius: 9, padding: "9px 14px", marginBottom: 12, fontSize: 12, textAlign: "center",
              background: sel ? "#422006" : "#0a2e1a",
              color: sel ? "#fed7aa" : "#4ade80",
              border: `1px solid ${sel ? "#7c2d12" : "#1a5c33"}`,
              transition: "all 0.2s",
            }}>
              {sel
                ? <>Byter schema för <strong>{getP(sel)?.name}</strong> — tryck på en annan spelare, eller tryck igen för att avmarkera.</>
                : "Tryck på en spelare för att välja, sedan på en annan för att byta deras schema."
              }
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={doGenerate} style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 13 }}>
                ↻ Generera om
              </button>
              <button
                onClick={doReset}
                disabled={!originalPlan}
                title="Återställ till den automatiskt genererade fördelningen"
                style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 13, opacity: originalPlan ? 1 : 0.4 }}>
                ⟳ Återställ
              </button>
              <button onClick={() => setTab("players")} style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 13 }}>
                ✎ Redigera
              </button>
            </div>
            <ShareBar />
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

              const goPrev = () => { setTimerPeriod(p => Math.max(0, p - 1)); setTimerElapsed(0); };
              const goNext = () => { setTimerPeriod(p => Math.min(plan.length - 1, p + 1)); setTimerElapsed(0); setTimerRunning(true); };
              const reset  = () => { setTimerElapsed(0); setTimerRunning(false); };

              return (
                <div style={{ ...S.card, padding: "16px", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 15, letterSpacing: 2, color: "#475569" }}>TIMER</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>Period {clampedPeriod + 1} / {plan.length}</div>
                  </div>

                  {/* Big time display */}
                  <div style={{ textAlign: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 60, letterSpacing: 4, color: timeColor, lineHeight: 1, transition: "color 0.3s" }}>
                      {fmtTime(timerElapsed)}
                    </span>
                    <span style={{ fontSize: 12, color: "#334155", marginLeft: 6 }}>/ {settings.duration}:00</span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ background: "#0f172a", borderRadius: 6, height: 10, marginBottom: 4, position: "relative", overflow: "hidden" }}>
                    {settings.subs >= 1 && (
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "#1e3a5f", zIndex: 1 }} />
                    )}
                    <div style={{ background: barColor, width: `${barPct}%`, height: "100%", borderRadius: 6, transition: "width 0.8s linear, background 0.3s" }} />
                  </div>
                  {settings.subs >= 1 && (
                    <div style={{ fontSize: 9, color: "#334155", textAlign: "center", marginBottom: 10, letterSpacing: 1 }}>
                      ↕ byte vid {Math.round(settings.duration / 2)} min
                    </div>
                  )}

                  {/* Status banners */}
                  {isSwitchDue && !isOvertime && (
                    <div style={{
                      background: switchBlink ? "#7c2d12" : "#431407",
                      border: "1px solid #ea580c", borderRadius: 8,
                      padding: "8px 12px", textAlign: "center",
                      fontSize: 13, fontWeight: 700, color: "#fed7aa", marginBottom: 10,
                      transition: "background 0.2s",
                    }}>
                      ↕ BYT SPELARE NU!
                    </div>
                  )}
                  {isOvertime && (
                    <div style={{
                      background: "#450a0a", border: "1px solid #dc2626", borderRadius: 8,
                      padding: "8px 12px", textAlign: "center",
                      fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 10,
                    }}>
                      ⚠ ÖVERTID +{fmtTime(timerElapsed - periodSecs)}
                    </div>
                  )}

                  {/* Controls */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={reset}
                      style={{ ...S.btn("secondary"), padding: "9px 11px", fontSize: 15 }}>↺</button>
                    <button onClick={() => setTimerElapsed(e => Math.max(0, e - 15))}
                      style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700 }}>−15s</button>
                    <button onClick={() => setTimerRunning(r => !r)}
                      style={{ ...S.btn("primary"), flex: 2, padding: "9px 0", fontSize: 14 }}>
                      {timerRunning ? "⏸ Pausa" : timerElapsed > 0 ? "▶ Fortsätt" : "▶ Starta"}
                    </button>
                    <button onClick={() => setTimerElapsed(e => e + 15)}
                      style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700 }}>+15s</button>
                    <button onClick={goPrev} disabled={timerPeriod === 0}
                      style={{ ...S.btn("secondary"), padding: "9px 11px", fontSize: 15, opacity: timerPeriod === 0 ? 0.35 : 1 }}>«</button>
                    <button onClick={goNext} disabled={timerPeriod >= plan.length - 1}
                      style={{ ...S.btn("secondary"), padding: "9px 11px", fontSize: 15, opacity: timerPeriod >= plan.length - 1 ? 0.35 : 1 }}>»</button>
                  </div>
                </div>
              );
            })()}

            {/* Period cards */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr",
              gap: isDesktop ? 24 : 0,
            }}>
              {plan.map((period, i) => (
                <div key={i}>
                  {/* Mobile break separator between periods */}
                  {!isDesktop && i > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "24px 0 20px" }}>
                      <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
                      <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: 3, fontWeight: 600 }}>paus</div>
                      <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
                    </div>
                  )}

                  <div style={{
                    ...S.card, marginBottom: 0,
                    outline: timerPeriod === i ? `2px solid ${timerRunning ? "#4ade80" : "#334155"}` : "none",
                    outlineOffset: 2,
                  }}>

                    {/* Period header */}
                    <div style={{
                      background: "linear-gradient(135deg, #0a2e1a 0%, #0d3821 100%)",
                      padding: "10px 16px",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      borderBottom: "1px solid #1a5c33",
                    }}>
                      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, letterSpacing: 2, color: "#4ade80" }}>
                        Period {i + 1}
                      </div>
                      <div style={{ fontSize: 12, color: "#4ade80", opacity: 0.7 }}>
                        {settings.format} &nbsp;·&nbsp; {settings.duration} min
                      </div>
                    </div>

                    {/* Pitch — one or two halves */}
                    {period.att2 != null ? (
                      <>
                        <HalfLabel text={`1. Halvlek · ${Math.round(settings.duration / 2)} min`} />
                        <PitchHalf att={period.att} mid={period.mid} def={period.def} gk={period.gk} showGK />
                        <div style={{
                          background: "#061812", borderTop: "1px dashed #1a5c33", borderBottom: "1px dashed #1a5c33",
                          padding: "7px 14px", display: "flex", justifyContent: "center", alignItems: "center", gap: 10,
                        }}>
                          <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>↕ HALVTID</span>
                          {fmt.hasGK && <span style={{ fontSize: 10, color: "#475569" }}>MV stannar · alla utespelare byts</span>}
                        </div>
                        <HalfLabel text={`2. Halvlek · ${Math.round(settings.duration / 2)} min`} />
                        <PitchHalf att={period.att2} mid={period.mid2} def={period.def2} gk={period.gk} showGK />
                      </>
                    ) : (
                      <PitchHalf att={period.att} mid={period.mid} def={period.def} gk={period.gk} showGK />
                    )}

                    {/* Bench row */}
                    {period.bench.length > 0 && (
                      <div style={{ background: "#111827", borderTop: "1px solid #1e293b", padding: "8px 14px" }}>
                        <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: 1, marginBottom: 7, fontWeight: 600 }}>
                          Hel period på bänken
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {period.bench.map(id => <Chip key={id} id={id} small />)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 24 }} />

            {/* ─── Playing time summary ─── */}
            <div style={{ ...S.card, padding: "16px" }}>
              <div style={{
                fontFamily: "'Bebas Neue', cursive", fontSize: 20, letterSpacing: 2,
                color: "#94a3b8", marginBottom: 14,
              }}>
                Speltid — {totalPossible} min totalt
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
                    ps.gk    > 0 && { label: "MV",   count: ps.gk,    bg: "#fbbf2426", color: "#fbbf24" },
                    ps.att   > 0 && { label: "⚡",   count: ps.att,   bg: "#f9731626", color: "#f97316" },
                    ps.mid   > 0 && { label: "⚖",   count: ps.mid,   bg: "#94a3b826", color: "#94a3b8" },
                    ps.def   > 0 && { label: "🛡",   count: ps.def,   bg: "#60a5fa26", color: "#60a5fa" },
                    ps.bench > 0 && { label: "Bänk", count: ps.bench, bg: "#1e293b",   color: "#475569" },
                  ].filter(Boolean);

                  return (
                    <div key={p.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {p.isGK
                            ? <span style={{ fontSize: 10, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
                            : <span style={{ fontSize: 12 }}>{pref.icon}</span>
                          }
                          <span style={{ fontSize: 13, color: "#cbd5e1" }}>{p.name}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: textColor }}>
                          {m} min
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
                        {posBadges.map(b => (
                          <span key={b.label} style={{
                            fontSize: 10, fontWeight: 600, borderRadius: 5,
                            padding: "2px 6px", background: b.bg, color: b.color,
                          }}>
                            {b.label} ×{b.count}
                          </span>
                        ))}
                      </div>
                      <div style={{ background: "#0f172a", borderRadius: 5, height: 6, overflow: "hidden" }}>
                        <div style={{
                          background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
                          width: `${pct}%`, height: "100%", borderRadius: 5,
                          transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
                          minWidth: m > 0 ? 4 : 0,
                        }} />
                      </div>
                    </div>
                  );
                })}

              {/* Fairness score */}
              {(() => {
                const vals = Object.values(mins).filter(v => v >= 0);
                const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                const maxDiff = Math.max(...vals.map(v => Math.abs(v - avg)));
                const fair = maxDiff <= settings.duration / 2;
                return (
                  <div style={{
                    marginTop: 12, padding: "8px 12px", borderRadius: 8, textAlign: "center",
                    background: fair ? "#0a2e1a" : "#2d1b0a",
                    border: `1px solid ${fair ? "#1a5c33" : "#7c3d12"}`,
                    fontSize: 12,
                    color: fair ? "#4ade80" : "#fb923c",
                  }}>
                    {fair
                      ? "✓ Speltiden är jämnt fördelad"
                      : `⚠ Max skillnad: ${Math.round(maxDiff)} min — byt runt för bättre balans`
                    }
                  </div>
                );
              })()}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

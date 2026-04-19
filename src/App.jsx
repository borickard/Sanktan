import { useState, useEffect, useCallback } from "react";

/* ─── ID factory ─── */
let _uid = 100;
const uid = () => ++_uid;

/* ─── Constants ─── */
const PREFS = [
  { key: "attack",  label: "Anfall",  icon: "⚡", color: "#f97316" },
  { key: "neutral", label: "Neutral", icon: "⚖",  color: "#94a3b8" },
  { key: "defense", label: "Försvar", icon: "🛡",  color: "#60a5fa" },
];
const PM = Object.fromEntries(PREFS.map(p => [p.key, p]));

const mkP = (name, isGK = false, pref = "neutral") => ({ id: uid(), name, isGK, pref });

const DEMO = [
  mkP("Erik",   false, "attack"),
  mkP("Maja",   false, "defense"),
  mkP("Oliver", true,  "neutral"),
  mkP("Lova",   false, "attack"),
  mkP("Hugo",   true,  "neutral"),
  mkP("Wilma",  false, "defense"),
  mkP("Axel",   false, "neutral"),
  mkP("Nora",   true,  "neutral"),
];

/* ─── Auto-generate algorithm ─── */
function generatePlan(players, settings) {
  const { periods, duration, subs } = settings;
  const FULL = duration, HALF = duration / 2;
  const gks = players.filter(p => p.isGK);
  const mins = Object.fromEntries(players.map(p => [p.id, 0]));

  return Array.from({ length: periods }, (_, i) => {
    // Pick GK: cycle through designated GKs
    const gkId = gks.length > 0
      ? gks[i % gks.length].id
      : [...players].sort((a, b) => mins[b.id] - mins[a.id])[0].id;

    // Sort non-GK players by fewest minutes
    const avail = players
      .filter(p => p.id !== gkId)
      .sort((a, b) => mins[a.id] - mins[b.id]);

    const starters = avail.slice(0, 4);
    const subIn = (subs >= 1 && avail.length >= 5) ? avail[4] : null;

    // Assign starters to positions by preference
    const at = [], df = [];
    const pool = [...starters];
    pool.filter(p => p.pref === "attack").forEach(p  => { if (at.length < 2) at.push(p.id); });
    pool.filter(p => p.pref === "defense").forEach(p => { if (df.length < 2) df.push(p.id); });
    const used = new Set([...at, ...df]);
    pool.filter(p => !used.has(p.id)).forEach(p => {
      if (at.length < 2) at.push(p.id);
      else if (df.length < 2) df.push(p.id);
    });
    while (at.length < 2) at.push(null);
    while (df.length < 2) df.push(null);

    // Update minute tracking
    mins[gkId] += FULL;
    starters.forEach(p => { mins[p.id] += FULL; });
    if (subIn) mins[subIn.id] += HALF;

    const usedIds = new Set([gkId, ...starters.map(p => p.id), subIn?.id].filter(Boolean));

    return {
      gk: gkId,
      def: df,
      att: at,
      subIn: subIn?.id ?? null,
      bench: players.filter(p => !usedIds.has(p.id)).map(p => p.id),
    };
  });
}

/* ─── Main App ─── */
export default function App() {
  const [tab, setTab]       = useState("players");
  const [players, setPlayers] = useState(DEMO);
  const [newName, setNewName] = useState("");
  const [settings, setSettings] = useState({ periods: 3, duration: 15, subs: 1 });
  const [plan, setPlan]     = useState(null);
  const [sel, setSel]       = useState(null); // selected player id

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch(e) {} };
  }, []);

  const getP = id => players.find(p => p.id === id);

  const addPlayer = () => {
    const n = newName.trim();
    if (!n) return;
    setPlayers(ps => [...ps, mkP(n)]);
    setNewName("");
  };

  const updP = (id, key, val) =>
    setPlayers(ps => ps.map(p => p.id === id ? { ...p, [key]: val } : p));

  const delP = id => setPlayers(ps => ps.filter(p => p.id !== id));

  const doGenerate = () => {
    if (players.length < 5) return alert("Lägg till minst 5 spelare!");
    setPlan(generatePlan(players, settings));
    setTab("plan");
    setSel(null);
  };

  /* Global schedule swap of two players */
  const tapPlayer = useCallback(id => {
    if (!id) return;
    if (!sel) { setSel(id); return; }
    if (sel === id) { setSel(null); return; }
    const a = sel, b = id;
    const sw = x => x === a ? b : x === b ? a : x;
    setPlan(pl => pl.map(period => ({
      gk:    sw(period.gk),
      def:   period.def.map(sw),
      att:   period.att.map(sw),
      subIn: sw(period.subIn),
      bench: period.bench.map(sw),
    })));
    setSel(null);
  }, [sel]);

  /* Minute totals from current plan */
  const calcMins = () => {
    if (!plan) return {};
    const FULL = settings.duration, HALF = settings.duration / 2;
    const m = Object.fromEntries(players.map(p => [p.id, 0]));
    plan.forEach(({ gk, def, att, subIn }) => {
      if (gk) m[gk] = (m[gk] ?? 0) + FULL;
      def.forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
      att.forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
      if (subIn) m[subIn] = (m[subIn] ?? 0) + HALF;
    });
    return m;
  };

  const mins = calcMins();
  const totalPossible = settings.periods * settings.duration;

  /* ─── Sub-components ─── */
  const Chip = ({ id, small = false }) => {
    if (!id) return null;
    const p = getP(id);
    if (!p) return null;
    const pref = PM[p.pref];
    const isSelected = sel === id;
    const isSel2nd = sel && sel !== id; // something else selected

    return (
      <div
        onClick={e => { e.stopPropagation(); tapPlayer(id); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: isSelected ? "#fef08a" : "#0f172a",
          color: isSelected ? "#0f172a" : "#e2e8f0",
          border: `2px solid ${isSelected ? "#fbbf24" : p.isGK ? "#fbbf24" : pref.color}`,
          borderRadius: 8,
          padding: small ? "3px 8px" : "5px 10px",
          fontSize: small ? 12 : 14,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.15s",
          userSelect: "none", WebkitUserSelect: "none",
          opacity: isSel2nd ? 0.75 : 1,
          boxShadow: isSelected ? "0 0 0 3px rgba(251,191,36,0.3)" : "none",
        }}
      >
        {p.isGK
          ? <span style={{ fontSize: 10, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
          : <span style={{ fontSize: 11 }}>{pref.icon}</span>
        }
        <span>{p.name}</span>
        {!small && plan && (
          <span style={{
            fontSize: 10, color: isSelected ? "#713f12" : "#64748b",
            fontWeight: 400,
          }}>
            {mins[id] ?? 0}′
          </span>
        )}
      </div>
    );
  };

  const PositionSlot = ({ id, label }) => (
    <div style={{ textAlign: "center", minWidth: 80 }}>
      <div style={{ fontSize: 9, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 5, fontWeight: 600 }}>
        {label}
      </div>
      {id
        ? <Chip id={id} />
        : <div style={{ background: "#0f172a", border: "1px dashed #1e3a28", borderRadius: 8, padding: "5px 14px", fontSize: 12, color: "#334155" }}>—</div>
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
    body:  { padding: "16px 16px 40px", maxWidth: 480, margin: "0 auto" },
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
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, letterSpacing: 3, color: "#f8fafc", lineHeight: 1 }}>
          Laguppställning 5v5
        </div>
        <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
          {players.length} spelare &nbsp;·&nbsp; {settings.periods} perioder &nbsp;·&nbsp; {settings.duration} min/period &nbsp;·&nbsp; {settings.subs} byte/period
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
              <div key={p.id} style={{ ...S.card, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                {/* Color dot */}
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.isGK ? "#fbbf24" : PM[p.pref].color, flexShrink: 0 }} />

                {/* Name */}
                <input
                  value={p.name}
                  onChange={e => updP(p.id, "name", e.target.value)}
                  style={{ flex: 1, background: "none", border: "none", color: "#e2e8f0", fontSize: 15, fontWeight: 500, outline: "none" }}
                />

                {/* GK toggle */}
                <button
                  onClick={() => updP(p.id, "isGK", !p.isGK)}
                  style={{ ...S.btn(p.isGK ? "primary" : "ghost"), padding: "3px 8px", fontSize: 11, borderRadius: 6, border: p.isGK ? "none" : "1px solid #334155" }}>
                  MV
                </button>

                {/* Pref pills */}
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

                {/* Delete */}
                <button onClick={() => delP(p.id)}
                  style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>
                  ×
                </button>
              </div>
            ))}

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
              <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Matchinställningar
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
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={doGenerate} style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 13 }}>
                ↻ Generera om
              </button>
              <button onClick={() => setTab("players")} style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 13 }}>
                ✎ Redigera spelare
              </button>
            </div>

            {/* Period cards */}
            {plan.map((period, i) => (
              <div key={i} style={{ ...S.card, marginBottom: 16 }}>

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
                    {settings.duration} min
                  </div>
                </div>

                {/* Pitch */}
                <div style={{
                  background: "linear-gradient(180deg, #0a1f12 0%, #0d2818 50%, #0a1f12 100%)",
                  padding: "16px 12px",
                  position: "relative",
                }}>
                  {/* Subtle pitch lines */}
                  <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(180deg, transparent 0px, transparent 39px, rgba(255,255,255,0.02) 39px, rgba(255,255,255,0.02) 40px)", pointerEvents: "none" }} />

                  {/* Attack zone */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 9, color: "#f97316", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 10, fontWeight: 600 }}>
                      ⚡ Anfallszon
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-around" }}>
                      {period.att.map((id, j) => <PositionSlot key={j} id={id} label={`Anfall ${j + 1}`} />)}
                    </div>
                  </div>

                  {/* Center circle indicator */}
                  <div style={{ textAlign: "center", margin: "12px 0", position: "relative" }}>
                    <div style={{ borderTop: "1px dashed #1a5c33", position: "absolute", top: "50%", left: 0, right: 0 }} />
                    <div style={{
                      display: "inline-block", width: 20, height: 20, borderRadius: "50%",
                      border: "1px dashed #1a5c33", background: "#0d2818",
                      position: "relative", lineHeight: "18px", fontSize: 8, color: "#1a5c33",
                    }}>○</div>
                  </div>

                  {/* Defense zone */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-around" }}>
                      {period.def.map((id, j) => <PositionSlot key={j} id={id} label={`Försvar ${j + 1}`} />)}
                    </div>
                    <div style={{ fontSize: 9, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginTop: 10, fontWeight: 600 }}>
                      🛡 Försvarszon
                    </div>
                  </div>

                  {/* GK separator */}
                  <div style={{ border: "none", borderTop: "2px solid #1a5c33", margin: "12px 0" }} />

                  {/* GK */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <PositionSlot id={period.gk} label="Målvakt" />
                  </div>
                </div>

                {/* Sub-in row */}
                {period.subIn && (
                  <div style={{
                    background: "#0d1f12", borderTop: "1px solid #1a3d1f",
                    padding: "8px 14px", display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontSize: 11, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, flexShrink: 0 }}>
                      ↕ Byte in:
                    </span>
                    <Chip id={period.subIn} small />
                    <span style={{ fontSize: 11, color: "#334155", marginLeft: "auto" }}>
                      ~{settings.duration / 2} min
                    </span>
                  </div>
                )}

                {/* Bench row */}
                {period.bench.length > 0 && (
                  <div style={{
                    background: "#111827", borderTop: "1px solid #1e293b",
                    padding: "8px 14px",
                  }}>
                    <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: 1, marginBottom: 7, fontWeight: 600 }}>
                      Hel period på bänken
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {period.bench.map(id => <Chip key={id} id={id} small />)}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* ─── Playing time summary ─── */}
            <div style={{ ...S.card, padding: "16px" }}>
              <div style={{
                fontFamily: "'Bebas Neue', cursive", fontSize: 20, letterSpacing: 2,
                color: "#94a3b8", marginBottom: 14,
              }}>
                Speltid — {totalPossible} min totalt
              </div>
              {[...players]
                .sort((a, b) => (mins[b.id] ?? 0) - (mins[a.id] ?? 0))
                .map(p => {
                  const m = mins[p.id] ?? 0;
                  const pct = totalPossible > 0 ? (m / totalPossible) * 100 : 0;
                  const pref = PM[p.pref];
                  const barColor = p.isGK ? "#fbbf24" : pref.color;
                  const textColor = pct >= 75 ? "#4ade80" : pct >= 45 ? "#fbbf24" : "#f87171";

                  return (
                    <div key={p.id} style={{ marginBottom: 10 }}>
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
                      <div style={{ background: "#0f172a", borderRadius: 5, height: 7, overflow: "hidden" }}>
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

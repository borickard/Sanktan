import { useState, useEffect, useCallback } from "react";

/* ─── ID factory ─── */
let _uid = 100;
const uid = () => ++_uid;

/* ─── Constants ─── */
const PREFS = [
  { key: "attack",  label: "Anfall",  icon: "⚡", color: "#f97316" },
  { key: "neutral", label: "Neutral", icon: "⚖\uFE0F",  color: "#94a3b8" },
  { key: "defense", label: "Försvar", icon: "🛡\uFE0F",  color: "#60a5fa" },
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
  const FULL = duration, SEG = subs > 0 ? duration / (subs + 1) : 0;
  const fieldCount = fmt.att + fmt.mid + fmt.def;

  const gks = fmt.hasGK ? players.filter(p => p.isGK) : [];
  const mins = Object.fromEntries(players.map(p => [p.id, 0]));

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

    const starters = avail.slice(0, fieldCount);
    const subIn = (subs >= 1 && avail.length >= fieldCount + 1) ? avail[fieldCount] : null;

    const at = [], md = [], df = [];
    const pool = [...starters];

    pool.filter(p => p.pref === "attack").forEach(p  => { if (at.length < fmt.att) at.push(p.id); });
    pool.filter(p => p.pref === "neutral").forEach(p => { if (md.length < fmt.mid) md.push(p.id); });
    pool.filter(p => p.pref === "defense").forEach(p => { if (df.length < fmt.def) df.push(p.id); });

    const used = new Set([...at, ...md, ...df]);
    pool.filter(p => !used.has(p.id)).forEach(p => {
      if (at.length < fmt.att) at.push(p.id);
      else if (md.length < fmt.mid) md.push(p.id);
      else if (df.length < fmt.def) df.push(p.id);
    });

    while (at.length < fmt.att) at.push(null);
    while (md.length < fmt.mid) md.push(null);
    while (df.length < fmt.def) df.push(null);

    if (gkId) mins[gkId] += FULL;
    starters.forEach(p => { mins[p.id] += FULL; });
    if (subIn) mins[subIn.id] += SEG;

    const usedIds = new Set([gkId, ...starters.map(p => p.id), subIn?.id].filter(Boolean));

    return {
      gk: gkId,
      def: df,
      mid: md,
      att: at,
      subIn: subIn?.id ?? null,
      bench: players.filter(p => !usedIds.has(p.id)).map(p => p.id),
    };
  });
}

/* ─── Main App ─── */
export default function App() {
  const [tab, setTab]         = useState("players");
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

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch(e) {} };
  }, []);

  useEffect(() => {
    try {
      const encoded = btoa(encodeURIComponent(JSON.stringify({ players, settings, plan })));
      window.history.replaceState(null, "", "#" + encoded);
    } catch {}
  }, [players, settings, plan]);

  const fmt = FM[settings.format] ?? FM["5v5"];
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

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
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
      mid:   (period.mid ?? []).map(sw),
      att:   period.att.map(sw),
      subIn: sw(period.subIn),
      bench: period.bench.map(sw),
    })));
    setSel(null);
  }, [sel]);

  /* Minute totals from current plan */
  const calcMins = () => {
    if (!plan) return {};
    const FULL = settings.duration;
    const SEG = settings.subs > 0 ? FULL / (settings.subs + 1) : 0;
    const m = Object.fromEntries(players.map(p => [p.id, 0]));
    plan.forEach(({ gk, def, mid, att, subIn }) => {
      if (gk) m[gk] = (m[gk] ?? 0) + FULL;
      def.forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
      (mid ?? []).forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
      att.forEach(id => { if (id) m[id] = (m[id] ?? 0) + FULL; });
      if (subIn) m[subIn] = (m[subIn] ?? 0) + SEG;
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
    const isSel2nd = sel && sel !== id;

    return (
      <div
        onClick={e => { e.stopPropagation(); tapPlayer(id); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          maxWidth: "100%", overflow: "hidden",
          background: isSelected ? "#fef08a" : "#0f172a",
          color: isSelected ? "#0f172a" : "#e2e8f0",
          border: `2px solid ${isSelected ? "#fbbf24" : p.isGK ? "#fbbf24" : pref.color}`,
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
        {p.isGK
          ? <span style={{ fontSize: 10, background: "#fbbf24", color: "#0f172a", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>MV</span>
          : <span style={{ fontSize: 11 }}>{pref.icon}</span>
        }
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      </div>
    );
  };

  const PositionSlot = ({ id, label }) => (
    <div style={{ textAlign: "center", flex: "1 1 0", minWidth: 0, maxWidth: 120 }}>
      <div style={{ fontSize: 9, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5, fontWeight: 600 }}>
        {label}
      </div>
      {id
        ? <Chip id={id} />
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
                    width: 12, height: 12, borderRadius: "50%", padding: 0, flexShrink: 0, cursor: "pointer",
                    background: p.enabled !== false ? (p.isGK ? "#fbbf24" : PM[p.pref].color) : "transparent",
                    border: `2px solid ${p.enabled !== false ? (p.isGK ? "#fbbf24" : PM[p.pref].color) : "#475569"}`,
                    transition: "all 0.15s",
                  }}
                />

                <input
                  value={p.name}
                  onChange={e => updP(p.id, "name", e.target.value)}
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

            {/* Share button */}
            <button onClick={copyLink} style={{
              ...S.btn("secondary"), width: "100%", marginTop: 8, padding: "11px 0", fontSize: 13,
            }}>
              {copied ? "✓ Länk kopierad!" : "🔗 Dela länk"}
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
              <button onClick={copyLink} style={{ ...S.btn("secondary"), flex: 1, padding: "9px 0", fontSize: 13 }}>
                {copied ? "✓ Kopierad!" : "🔗 Dela"}
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
                    {settings.format} &nbsp;·&nbsp; {settings.duration} min
                  </div>
                </div>

                {/* Pitch */}
                <div style={{
                  background: "linear-gradient(180deg, #0a1f12 0%, #0d2818 50%, #0a1f12 100%)",
                  padding: "16px 12px",
                  position: "relative",
                }}>
                  <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(180deg, transparent 0px, transparent 39px, rgba(255,255,255,0.02) 39px, rgba(255,255,255,0.02) 40px)", pointerEvents: "none" }} />

                  {/* Attack zone */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 9, color: "#f97316", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 10, fontWeight: 600 }}>
                      ⚡ Anfallszon
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
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

                  {/* Midfield zone — only for formats with midfielders */}
                  {fmt.mid > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginBottom: 10, fontWeight: 600 }}>
                        ⚖ Mittfält
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                        {(period.mid ?? []).map((id, j) => <PositionSlot key={j} id={id} label={`Mitt ${j + 1}`} />)}
                      </div>
                    </div>
                  )}

                  {/* Defense zone */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                      {period.def.map((id, j) => <PositionSlot key={j} id={id} label={`Försvar ${j + 1}`} />)}
                    </div>
                    <div style={{ fontSize: 9, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 2, textAlign: "center", marginTop: 10, fontWeight: 600 }}>
                      🛡 Försvarszon
                    </div>
                  </div>

                  {/* GK — only for formats with goalkeeper */}
                  {fmt.hasGK && (
                    <>
                      <div style={{ border: "none", borderTop: "2px solid #1a5c33", margin: "12px 0" }} />
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <PositionSlot id={period.gk} label="Målvakt" />
                      </div>
                    </>
                  )}
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
                      ~{Math.round(settings.duration / (settings.subs + 1))} min
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
              {[...activePlayers]
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

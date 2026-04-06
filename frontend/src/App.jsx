import { useState, useEffect, useRef, useMemo, createContext, useContext, useCallback } from "react";
import { AuthProvider, AuthScreen, UserMenu, useAuth, DEMO_MODE } from "./auth.jsx";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, Cell, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart
} from "recharts";
import {
  CheckCircle, XCircle, AlertTriangle, ChevronRight, Play,
  RefreshCw, FileText, Zap, Globe, Target, BarChart2, ArrowRight,
  FlaskConical, Sun, Moon, Activity, Briefcase, TrendingUp, Settings,
  Database, Search, ChevronDown, ChevronUp, Plus, X, BookOpen,
  TrendingDown, AlertCircle, Eye, Maximize2, Minimize2,
  Compass, Shuffle, Network, Layers, Shield, Cpu, Newspaper, Lock, Unlock, Menu, DollarSign
} from "lucide-react";

// ── Theme tokens ─────────────────────────────────────────
const DARK = {
  bg:"#050508", surf:"#0c0c12", bdr:"#181824", txt:"#c8c8da",
  mut:"#56566e", dim:"#1c1c28", grn:"#00e676", grnBg:"rgba(0,230,118,.07)",
  sky:"#40c4ff", amb:"#ffb300", red:"#ff5252", pur:"#b388ff",
  headingTxt:"#ffffff",
};
const LIGHT = {
  bg:"#f0f0f5", surf:"#ffffff", bdr:"#d8d8e8", txt:"#2a2a3e",
  mut:"#8888aa", dim:"#e8e8f0", grn:"#008844", grnBg:"rgba(0,136,68,.07)",
  sky:"#006faa", amb:"#aa6600", red:"#cc2222", pur:"#6622aa",
  headingTxt:"#0a0a1a",
};

const ThemeCtx = createContext(DARK);
const useC = () => useContext(ThemeCtx);

// Convert raw API error text into a human-readable message.
// 401 / "Not authenticated" → friendly signup prompt.
function friendlyError(raw) {
  const s = String(raw ?? "");
  // In demo mode never show the sign-up prompt — just pass through the real error.
  if (!DEMO_MODE && (
    s.includes("Not authenticated") ||
    s.includes("not authenticated") ||
    s.includes('"detail":"Not authenticated"') ||
    s === "401"
  )) {
    return "🔒 Create a free account to use this feature — sign up takes 30 seconds";
  }
  return s;
}

// Global loading indicator — any component can signal "something is in flight"
const LoadingCtx = createContext({active:false, push:()=>{}, pop:()=>{}});
const useLoading = () => useContext(LoadingCtx);

// ── ChartPanel — expandable fullscreen chart wrapper ────────────────────────
function ChartPanel({ title, defaultHeight, children }) {
  const [expanded, setExpanded] = useState(false);
  const C = useC();
  const renderChart = h => typeof children === "function" ? children(h) : children;
  const ToggleBtn = ({ full }) => (
    <button
      onClick={() => setExpanded(!full)}
      title={full ? "Exit fullscreen" : "Expand chart"}
      style={{
        background:"none", border:`1px solid ${C.bdr}`, borderRadius:6,
        padding:"3px 8px", cursor:"pointer", color:C.mut,
        display:"flex", alignItems:"center", gap:5,
        fontFamily:"monospace", fontSize:9, lineHeight:1,
        transition:"border-color .15s, color .15s",
      }}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.txt;e.currentTarget.style.color=C.txt;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.bdr;e.currentTarget.style.color=C.mut;}}
    >
      {full ? <Minimize2 size={11}/> : <Maximize2 size={11}/>}
      <span>{full ? "Exit" : "Expand"}</span>
    </button>
  );
  if (expanded) return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:C.bg,
      display:"flex",flexDirection:"column",padding:"16px 24px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,
        borderBottom:`1px solid ${C.bdr}`,paddingBottom:12}}>
        {title && (
          <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,
            color:C.headingTxt,letterSpacing:".04em",flex:1}}>{title}</span>
        )}
        <ToggleBtn full={true}/>
      </div>
      <div style={{flex:1,minHeight:0}}>
        {renderChart("100%")}
      </div>
    </div>
  );
  return (
    <div style={{position:"relative"}}>
      <div style={{position:"absolute",top:0,right:0,zIndex:10}}>
        <ToggleBtn full={false}/>
      </div>
      {renderChart(defaultHeight)}
    </div>
  );
}

// ── Deterministic PRNG ──────────────────────────────────
function rng32(seed) {
  let s = seed | 0;
  return () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Synthetic data ──────────────────────────────────────
const EQ_DATA = (() => {
  const r = rng32(42); const out = [];
  let eq = 1e6, bm = 1e6, pk = eq;
  for (let i = 0; i < 504; i++) {
    eq *= 1 + (r() - 0.472) * 0.018;
    bm *= 1 + (r() - 0.464) * 0.016;
    pk  = Math.max(pk, eq);
    if (i % 3 === 0) out.push({
      yr: `'${14 + Math.floor(i/252)}`,
      eq: Math.round(eq), bm: Math.round(bm),
      dd: +((eq - pk) / pk * 100).toFixed(2),
    });
  }
  return out;
})();

const PERM = (() => {
  const r = rng32(7);
  return Array.from({length:51},(_,i)=>({
    x: +(-1.5+i*0.06).toFixed(2),
    n: Math.max(0,Math.round(600*Math.exp(-0.5*((-1.5+i*0.06)/0.32)**2)*(0.85+r()*0.3))),
  }));
})();

const FRONTIER = (() => {
  const r = rng32(3);
  return Array.from({length:30},(_,i)=>{
    const v = 4+i*0.7, ret = -1+Math.sqrt(v/100)*42+(r()-0.5)*0.8;
    return {vol:+v.toFixed(1), ret:+ret.toFixed(2)};
  });
})();

const GBM = (() => {
  const r = rng32(99), N=8, T=53;
  const paths = Array.from({length:N},()=>[100]);
  for (let t=1;t<T;t++) for (let p=0;p<N;p++) {
    const prev = paths[p][t-1];
    paths[p].push(+(prev*Math.exp((0.08-0.02)/52+0.20*Math.sqrt(1/52)*(r()*2-1)*1.25)).toFixed(2));
  }
  return Array.from({length:T},(_,t)=>{const row={t};paths.forEach((p,i)=>{row[`p${i}`]=p[t];});return row;});
})();

// CP_DATA removed — SignalsView now uses real backend data via SignalReadingJob

// ── Helpers ─────────────────────────────────────────────
const mono = (sz,col,wt=400) => ({fontFamily:"monospace",fontSize:sz,color:col,fontWeight:wt});
const makeTT = (C) => ({
  contentStyle:{background:C.surf,border:`1px solid ${C.bdr}`,fontFamily:"monospace",fontSize:11,borderRadius:8},
  labelStyle:{color:C.mut}, itemStyle:{color:C.txt},
});

// ── UI atoms ───────────────────────────────────────────
function Card({children,accent}) {
  const C = useC();
  return <div style={{background:C.surf,border:`1px solid ${accent?accent+"30":C.bdr}`,borderRadius:14,padding:18}}>{children}</div>;
}
function Lbl({children,color}) {
  const C = useC();
  return <div style={{...mono(9,color||C.mut,700),letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>{children}</div>;
}
function Pill({label,active,onClick}) {
  const C = useC();
  return <button onClick={onClick} style={{...mono(10,active?C.grn:C.mut,600),border:`1px solid ${active?C.grn+"50":C.bdr}`,background:active?C.grnBg:"transparent",borderRadius:6,padding:"4px 11px",cursor:"pointer",transition:"all .15s"}}>{label.replace(/_/g," ")}</button>;
}
function KV({k,v,vc}) {
  const C = useC();
  return <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.bdr}`}}><span style={mono(9,C.mut)}>{k}</span><span style={mono(11,vc||C.txt,700)}>{v}</span></div>;
}
function InfoTip({children, desc, bands}) {
  const [show, setShow] = useState(false);
  const C = useC();
  return (
    <div style={{position:"relative",display:"inline-block",cursor:"help"}}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show && (
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,width:248,zIndex:1000,
          background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:10,
          padding:"12px 14px",boxShadow:"0 8px 28px rgba(0,0,0,.55)",pointerEvents:"none"}}>
          <p style={{...mono(10,C.mut),lineHeight:1.75,marginBottom:bands?.length?10:0}}>{desc}</p>
          {bands?.map(b=>(
            <div key={b.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:b.color,flexShrink:0}}/>
              <span style={mono(9,b.color,700)}>{b.label}</span>
              <span style={{...mono(9,C.mut),marginLeft:"auto"}}>{b.range}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Stat({label,value,color,sub,tip}) {
  const C = useC();
  const lbl = <Lbl>{label}</Lbl>;
  return (
    <Card>
      {tip ? <InfoTip desc={tip.desc} bands={tip.bands}>{lbl}</InfoTip> : lbl}
      <div style={mono(20,color||C.grn,800)}>{value}</div>
      {sub&&<div style={{...mono(9,C.mut),marginTop:3}}>{sub}</div>}
    </Card>
  );
}
function Tag({children,color}) {
  const C = useC();
  const col = color || C.mut;
  return <span style={{...mono(9,col,700),background:col+"15",border:`1px solid ${col}30`,borderRadius:20,padding:"2px 8px"}}>{children}</span>;
}
function SpinRing({active, children, radius=8, color}) {
  const C = useC();
  const {push, pop} = useLoading();
  const col = color || C.grn;
  useEffect(()=>{ if(active){ push(); return ()=>pop(); } }, [active]);
  return (
    <div style={{position:"relative",display:"inline-flex"}}>
      {active && <div style={{position:"absolute",inset:-3,borderRadius:radius+3,border:`2px solid ${col}33`,borderTopColor:col,animation:"spin 0.75s linear infinite",pointerEvents:"none",zIndex:1}}/>}
      {children}
    </div>
  );
}
function CodeBox({children}) {
  const C = useC();
  return <div style={{padding:"12px 14px",borderRadius:10,background:C.dim}}><code style={{...mono(10,C.sky),lineHeight:1.9,whiteSpace:"pre",display:"block"}}>{children}</code></div>;
}
function ValBanner({label}) {
  const C = useC();
  const cfg={valid:{col:C.grn,Icon:CheckCircle,txt:"VALID — passes all statistical gates"},likely_noise:{col:C.red,Icon:XCircle,txt:"LIKELY NOISE — insufficient evidence"},fragile:{col:C.amb,Icon:AlertTriangle,txt:"FRAGILE — passes t-test, fails permutation"}};
  const {col,Icon,txt}=cfg[label]||cfg.valid;
  return (
    <div style={{borderRadius:12,border:`1px solid ${col}40`,background:col+"08",padding:16,display:"flex",gap:14}}>
      <Icon size={20} style={{color:col,flexShrink:0,marginTop:2}}/>
      <div style={{flex:1}}>
        <div style={{display:"flex",gap:10,marginBottom:6,alignItems:"center"}}><Tag color={col}>{label.toUpperCase()}</Tag><span style={mono(11,C.mut)}>{txt}</span></div>
        <p style={{...mono(11,C.mut),lineHeight:1.7}}>t-stat = 2.14 · corrected p = 0.047 (Benjamini-Hochberg) · permutation p = 0.038 · Sharpe = 0.631</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 14px",flexShrink:0}}>
        {[["Raw p","0.033"],["Corr p","0.047"],["Perm p","0.038"],["t-stat","2.14"]].map(([k,v])=>(
          <div key={k} style={{textAlign:"right"}}><div style={mono(9,C.mut)}>{k}</div><div style={mono(12,col,700)}>{v}</div></div>
        ))}
      </div>
    </div>
  );
}

// ── Views ──────────────────────────────────────────────
// ── Overview helpers (defined outside component for stable refs) ──────────
function SectionSep({label}) {
  const C = useC();
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"6px 0 0"}}>
      <span style={{...mono(8,C.mut,700),letterSpacing:"0.13em",textTransform:"uppercase",flexShrink:0}}>
        {label}
      </span>
      <div style={{flex:1,height:"1px",background:C.bdr}}/>
    </div>
  );
}
function MacroTile({sym, name, price, chg, unit="$", onClick}) {
  const C = useC();
  const up  = chg != null && chg >= 0;
  const col = chg == null ? C.mut : up ? C.grn : C.red;
  const px  = price != null
    ? (unit === "%" ? `${price.toFixed(2)}%` : `$${price.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`)
    : "—";
  const clickable = !!onClick;
  return (
    <div onClick={onClick}
      style={{padding:"12px 14px",borderRadius:12,background:C.surf,border:`1px solid ${C.bdr}`,
        display:"flex",flexDirection:"column",gap:2,
        cursor: clickable ? "pointer" : "default",
        transition:"border-color .15s, background .15s"}}
      onMouseEnter={e=>{ if(clickable){ e.currentTarget.style.borderColor=col+"70"; e.currentTarget.style.background=col+"08"; }}}
      onMouseLeave={e=>{ if(clickable){ e.currentTarget.style.borderColor=C.bdr; e.currentTarget.style.background=C.surf; }}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{...mono(9,C.mut,700),letterSpacing:"0.06em"}}>{sym}</span>
        {chg != null && (
          <span style={{...mono(8,col,700),padding:"2px 6px",borderRadius:8,background:col+"16",whiteSpace:"nowrap"}}>
            {up?"+":""}{Math.abs(chg).toFixed(2)}%
          </span>
        )}
      </div>
      <div style={{...mono(9,C.mut),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
      <div style={{...mono(22,C.headingTxt,800),marginTop:4}}>{px}</div>
      {clickable && <div style={{...mono(7,C.mut),marginTop:2,opacity:0.6}}>↗ View 5Y chart</div>}
    </div>
  );
}

function OverviewView({onNav, onDetail}) {
  const C = useC();
  const [mkt, setMkt]               = useState(null);
  const [mktErr, setMktErr]         = useState(null);
  const [mktLoading, setMktLoading] = useState(false);
  const [sectorsOpen, setSectorsOpen] = useState(false);

  const doFetch = (bust = false) => {
    setMktLoading(true); setMktErr(null);
    const url = bust ? `/api/market/overview?bust=${Date.now()}` : "/api/market/overview";
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject("Backend offline — is the server running?"))
      .then(d => { setMkt(d); setMktLoading(false); })
      .catch(e => { setMktErr(String(e)); setMktLoading(false); });
  };
  useEffect(() => { doFetch(); }, []);

  // ── Colour helpers ──
  const chgColor  = c => c==null?C.mut : c>=0?C.grn : C.red;
  const stressCol = s => s==="high"?C.red : s==="elevated"?C.amb : C.grn;

  const fi = mkt?.fixed_income  || {};
  const cr = mkt?.credit        || {};
  const ca = mkt?.cross_asset   || [];

  // ═══════════════════════════════════════════════════════════
  // MARKET SCORING ENGINE (client-side, computed from mkt data)
  // ═══════════════════════════════════════════════════════════
  const scores = useMemo(() => {
    if (!mkt) return null;

    // 1. Volatility / Sentiment
    let volScore = 0;
    const vixVal = mkt.vix?.value;
    if (vixVal != null) {
      if (vixVal > 30) volScore -= 0.5;
      else if (vixVal > 20) volScore += 0;
      else volScore += 0.5;
    }
    const fgVal = mkt.sentiment?.score;
    if (fgVal != null) {
      if (fgVal < 30) volScore -= 0.5;
      else if (fgVal > 60) volScore += 0.5;
    }
    volScore = Math.max(-1, Math.min(1, volScore));

    // 2. Growth / Equities
    let eqScore = 0;
    const indices = (mkt.indices || []);
    const greens = indices.filter(i => (i.change_pct || 0) >= 0).length;
    const total = indices.length || 1;
    if (greens / total >= 0.75) eqScore = 1;
    else if (greens / total >= 0.5) eqScore = 0.5;
    else if (greens / total <= 0.25) eqScore = -1;
    else eqScore = -0.5;
    // IWM strength bonus (small-cap = risk-on)
    const iwm = indices.find(i => i.symbol === "IWM");
    if (iwm && iwm.change_pct > 0.5) eqScore = Math.min(1, eqScore + 0.25);
    eqScore = Math.max(-1, Math.min(1, eqScore));

    // 3. Rates / Policy
    let ratesScore = 0;
    const curveVal = fi.yield_curve;
    if (curveVal != null) {
      if (curveVal > 0.5) ratesScore += 0.5;
      else if (curveVal < -0.2) ratesScore -= 0.5;
    }
    const curveRegime = fi.curve_regime;
    if (curveRegime === "inverted") ratesScore -= 0.5;
    else if (curveRegime === "steepening") ratesScore += 0.25;
    ratesScore = Math.max(-1, Math.min(1, ratesScore));

    // 4. Credit Risk
    let creditScore = 0;
    const hygChg = cr.hyg?.change_pct;
    const lqdChg = cr.lqd?.change_pct;
    if (hygChg != null) creditScore += hygChg > 0 ? 0.5 : -0.5;
    if (hygChg != null && lqdChg != null) {
      const spread = hygChg - lqdChg;
      if (spread > 0.1) creditScore += 0.25; // HYG outperforming = risk-on
      else if (spread < -0.3) creditScore -= 0.25;
    }
    const stressLevel = cr.stress;
    if (stressLevel === "high") creditScore -= 0.5;
    creditScore = Math.max(-1, Math.min(1, creditScore));

    // Composite
    const composite = 0.3 * volScore + 0.25 * eqScore + 0.25 * creditScore + 0.2 * ratesScore;

    // Regime classification
    let regime;
    if (composite >= 0.5) regime = "Risk-On";
    else if (composite >= 0.2) regime = "Constructive";
    else if (composite >= -0.2) regime = "Neutral";
    else if (composite >= -0.5) regime = "Cautious";
    else regime = "Risk-Off";

    return { volatility: volScore, equities: eqScore, rates: ratesScore, credit: creditScore, composite: Math.round(composite * 100) / 100, regime };
  }, [mkt, fi, cr]);

  // ── Narrative Engine ──
  const narrative = useMemo(() => {
    if (!scores || !mkt) return null;
    const bullets = [];

    // Regime summary
    const regimeDesc = {
      "Risk-On": "Risk appetite is strong — broad participation across risk assets",
      "Constructive": "Risk appetite is constructive — equities and credit confirm",
      "Neutral": "Risk appetite is neutral — mixed signals across pillars",
      "Cautious": "Risk appetite is cautious — defensive posture warranted",
      "Risk-Off": "Risk appetite is deteriorating — stress signals across pillars",
    };
    bullets.push(regimeDesc[scores.regime] || "Market regime is unclear");

    // Yield curve
    if (fi.curve_regime === "inverted") bullets.push("Yield curve remains inverted — recession signal active");
    else if (fi.curve_regime === "steepening") bullets.push("Yield curve steepening reduces recession concern");
    else bullets.push("Yield curve is flat — policy uncertainty persists");

    // Credit
    if (scores.credit >= 0.5) bullets.push("Credit markets are calm — no stress signals");
    else if (scores.credit <= -0.5) bullets.push("Credit stress rising — HYG underperforming, spreads widening");
    else bullets.push("Credit conditions are stable");

    // Equities
    const greens = (mkt.indices || []).filter(i => (i.change_pct || 0) >= 0);
    if (greens.length >= 3) bullets.push("Equity leadership is broad — " + greens.length + "/4 indices positive");
    else if (greens.length <= 1) bullets.push("Equity leadership is narrow — risk of breadth deterioration");
    else bullets.push("Equity performance is mixed");

    // Cross-asset
    const gold = ca.find(a => a.symbol === "GLD");
    const dollar = ca.find(a => a.symbol === "UUP");
    if (gold && gold.change_pct > 0.5 && dollar && dollar.change_pct > 0.3)
      bullets.push("Gold and dollar both rising — flight-to-safety signals");
    else if (gold && gold.change_pct < -0.3 && scores.equities > 0)
      bullets.push("Gold weakness confirms risk-on rotation");

    return { summary: bullets };
  }, [scores, mkt, fi, cr, ca]);

  // ── Unified regime (cross-tab alignment) ──
  const [unifiedRegime, setUnifiedRegime] = useState(null);
  useEffect(() => {
    if (mkt) {
      fetch("/api/regime/unified").then(r=>r.ok?r.json():null).then(d=>setUnifiedRegime(d)).catch(()=>{});
    }
  }, [mkt]);

  // ── Helper components ──
  const regimeColor = r => ({
    "Risk-On": C.grn, "Constructive": "#66bb6a", "Neutral": C.amb, "Cautious": "#ff8a65", "Risk-Off": C.red
  })[r] || C.mut;
  const alignmentColor = a => ({
    "Aligned": C.grn, "Partially Aligned": C.amb, "Diverging": "#ff8a65", "Conflicted": C.red
  })[a] || C.mut;

  const pillarColor = s => s >= 0.5 ? C.grn : s <= -0.5 ? C.red : C.amb;
  const pillarLabel = s => s >= 0.5 ? "Positive" : s <= -0.5 ? "Negative" : "Neutral";

  const Section = ({accent, children}) => (
    <div style={{borderRadius:14, border:`1.5px solid ${accent||C.bdr}30`, background:(accent||C.surf)+"07", padding:"18px 20px"}}>
      {children}
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── Header ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div>
          <Lbl>Market Overview</Lbl>
          <div style={mono(10,C.mut)}>Market decision cockpit — regime, leadership, confirmation, and risk</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {mkt?.as_of && <Tag color={C.mut}>Updated {mkt.as_of.slice(11,16)} UTC</Tag>}
          <SpinRing active={mktLoading}>
          <button onClick={()=>doFetch(true)} disabled={mktLoading}
            style={{display:"flex",alignItems:"center",gap:5,...mono(9,mktLoading?C.grn:C.mut),
              padding:"5px 12px",borderRadius:8,border:`1px solid ${mktLoading?C.grn+"55":C.bdr}`,
              background:mktLoading?C.grnBg:"transparent",cursor:mktLoading?"not-allowed":"pointer"}}>
            <RefreshCw size={11} style={{animation:mktLoading?"spin 0.8s linear infinite":undefined}}/>
            {mktLoading ? "Fetching…" : "Refresh"}
          </button>
          </SpinRing>
        </div>
      </div>

      {mktLoading && !mkt && (
        <Card><div style={{...mono(11,C.mut),textAlign:"center",padding:"36px 0",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
          <RefreshCw size={14}/> Fetching market data…
        </div></Card>
      )}
      {mktErr && !mktLoading && (
        <Card><div style={{...mono(10,C.red),padding:"6px 0"}}>⚠ {mktErr}</div></Card>
      )}

      {mkt && scores && (<>

        {/* ═══════════ 1. MARKET REGIME & RISK APPETITE ═══════════ */}
        <Section accent={regimeColor(scores.regime)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:14,marginBottom:14}}>
            <div>
              <div style={{...mono(9, C.mut, 700), letterSpacing:"0.1em", marginBottom:4}}>MARKET REGIME</div>
              <div style={mono(24, regimeColor(scores.regime), 800)}>{scores.regime}</div>
            </div>
            <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>COMPOSITE</div>
                <div style={mono(20, pillarColor(scores.composite), 800)}>{scores.composite > 0 ? "+" : ""}{scores.composite.toFixed(2)}</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>VIX</div>
                <div style={mono(16, mkt.vix?.regime === "calm" ? C.grn : mkt.vix?.regime === "extreme_fear" ? C.red : C.amb, 700)}>
                  {mkt.vix?.value?.toFixed(1) || "—"}
                </div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>FEAR & GREED</div>
                <div style={mono(16, (mkt.sentiment?.score||50) >= 60 ? C.grn : (mkt.sentiment?.score||50) < 40 ? C.red : C.amb, 700)}>
                  {mkt.sentiment?.score || "—"} <span style={mono(9, C.mut)}>{mkt.sentiment?.label || ""}</span>
                </div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>YIELD CURVE</div>
                <div style={mono(16, fi.curve_regime === "inverted" ? C.red : fi.curve_regime === "steepening" ? C.grn : C.amb, 700)}>
                  {fi.yield_curve != null ? (fi.yield_curve > 0 ? "+" : "") + fi.yield_curve.toFixed(2) + "%" : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Pillar scores row */}
          <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:14}}>
            {[["Volatility", scores.volatility], ["Equities", scores.equities], ["Rates", scores.rates], ["Credit", scores.credit]].map(([name, val]) => (
              <div key={name} style={{padding:"8px 12px", borderRadius:8, background:C.dim, textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>{name.toUpperCase()}</div>
                <div style={mono(16, pillarColor(val), 800)}>{val > 0 ? "+" : ""}{val.toFixed(1)}</div>
                <div style={mono(8, pillarColor(val), 600)}>{pillarLabel(val)}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ═══════════ 2. TODAY'S MARKET READ ═══════════ */}
        {narrative && (
          <Section accent={C.pur}>
            <div style={{...mono(11, C.headingTxt, 700), marginBottom:10}}>TODAY'S MARKET READ</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {narrative.summary.map((b,i) => (
                <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={mono(10, C.mut)}>•</span>
                  <span style={mono(10, C.txt)}>{b}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ═══════════ CROSS-TAB ALIGNMENT ═══════════ */}
        {unifiedRegime && unifiedRegime.alignment && (
          <div style={{padding:"12px 16px", borderRadius:12, background:C.dim, border:`1px solid ${alignmentColor(unifiedRegime.alignment.overall_alignment)}30`,
            display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10}}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>SYSTEM ALIGNMENT</div>
                <div style={mono(12, alignmentColor(unifiedRegime.alignment.overall_alignment), 700)}>{unifiedRegime.alignment.overall_alignment}</div>
              </div>
              <div style={{width:1,height:28,background:C.bdr}}/>
              <div>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>DOMINANT</div>
                <div style={mono(12, regimeColor(unifiedRegime.alignment.dominant_regime), 700)}>{unifiedRegime.alignment.dominant_regime}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {Object.entries(unifiedRegime.tabs || {}).map(([tab, data]) => (
                <span key={tab} style={{...mono(8, regimeColor(data.mapped_regime), 600),
                  padding:"2px 8px", borderRadius:10, background:regimeColor(data.mapped_regime)+"15",
                  border:`1px solid ${regimeColor(data.mapped_regime)}30`}}>
                  {tab.charAt(0).toUpperCase()+tab.slice(1)}: {data.mapped_regime}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════ 3. EQUITY LEADERSHIP ═══════════ */}
        <div>
          <SectionSep label="Equity Leadership"/>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginTop:10}}>
            {(mkt.indices || []).map(idx => {
              const names = {SPY:"S&P 500",QQQ:"Nasdaq 100",IWM:"Russell 2000",DIA:"Dow Jones"};
              return (
                <div key={idx.symbol} onClick={()=>onDetail?.(idx.symbol)}
                  style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${chgColor(idx.change_pct)}25`,cursor:"pointer",transition:"border-color .15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={mono(10, C.headingTxt, 700)}>{names[idx.symbol] || idx.symbol}</span>
                    <Tag color={chgColor(idx.change_pct)}>{idx.symbol}</Tag>
                  </div>
                  <div style={mono(18, C.headingTxt, 800)}>${idx.price?.toFixed(2)}</div>
                  <div style={{...mono(11, chgColor(idx.change_pct), 700), marginTop:4}}>
                    {idx.change_pct >= 0 ? "+" : ""}{idx.change_pct?.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══════════ 4. RATES & CREDIT CONFIRMATION ═══════════ */}
        <div>
          <SectionSep label="Rates & Credit Confirmation"/>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginTop:10}}>
            {/* 10Y Treasury */}
            <div style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${C.sky}25`}}>
              <div style={{...mono(9,C.mut,700),letterSpacing:"0.08em",marginBottom:4}}>10Y TREASURY</div>
              <div style={mono(18, C.sky, 800)}>{fi.ten_year?.value?.toFixed(2) || "—"}%</div>
              {fi.ten_year?.daily_chg_bp != null && <div style={mono(10, chgColor(fi.ten_year.daily_chg_bp), 600)}>{fi.ten_year.daily_chg_bp > 0 ? "+" : ""}{fi.ten_year.daily_chg_bp.toFixed(1)} bps</div>}
            </div>
            {/* 3M T-Bill */}
            <div style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${C.pur}25`}}>
              <div style={{...mono(9,C.mut,700),letterSpacing:"0.08em",marginBottom:4}}>3M T-BILL</div>
              <div style={mono(18, C.pur, 800)}>{fi.three_month?.value?.toFixed(2) || "—"}%</div>
              {fi.three_month?.daily_chg_bp != null && <div style={mono(10, chgColor(fi.three_month.daily_chg_bp), 600)}>{fi.three_month.daily_chg_bp > 0 ? "+" : ""}{fi.three_month.daily_chg_bp.toFixed(1)} bps</div>}
            </div>
            {/* HYG */}
            <div style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${stressCol(cr.stress)}25`}} onClick={()=>onDetail?.("HYG")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{...mono(9,C.mut,700),letterSpacing:"0.08em"}}>HIGH YIELD</span>
                {cr.stress && <Tag color={stressCol(cr.stress)}>{cr.stress}</Tag>}
              </div>
              <div style={mono(18, C.headingTxt, 800)}>${cr.hyg?.price?.toFixed(2) || "—"}</div>
              <div style={mono(10, chgColor(cr.hyg?.change_pct), 600)}>{cr.hyg?.change_pct >= 0 ? "+" : ""}{cr.hyg?.change_pct?.toFixed(2) || "—"}%</div>
              <div style={{...mono(8, C.mut), marginTop:4}}>
                {scores.credit >= 0.5 ? "Credit stable — no stress" : scores.credit <= -0.5 ? "Credit stress rising" : "Credit conditions mixed"}
              </div>
            </div>
            {/* LQD */}
            <div style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${C.bdr}`}} onClick={()=>onDetail?.("LQD")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{...mono(9,C.mut,700),letterSpacing:"0.08em"}}>INV. GRADE</span>
                {cr.spread_change != null && <Tag color={chgColor(-cr.spread_change)}>{cr.spread_change > 0 ? "+" : ""}{cr.spread_change.toFixed(2)}%</Tag>}
              </div>
              <div style={mono(18, C.headingTxt, 800)}>${cr.lqd?.price?.toFixed(2) || "—"}</div>
              <div style={mono(10, chgColor(cr.lqd?.change_pct), 600)}>{cr.lqd?.change_pct >= 0 ? "+" : ""}{cr.lqd?.change_pct?.toFixed(2) || "—"}%</div>
            </div>
          </div>
        </div>

        {/* ═══════════ 5. CROSS-ASSET CONFIRMATION ═══════════ */}
        <div>
          <SectionSep label="Cross-Asset Confirmation"/>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginTop:10}}>
            {ca.map(a => {
              const interp = {
                GLD: a.change_pct > 0 ? "Flight-to-safety / inflation hedge" : "Risk-on rotation away from safety",
                USO: a.change_pct > 0 ? "Inflationary pressure / global demand" : "Demand concerns / deflationary signal",
                COPX: a.change_pct > 0 ? "Global growth is healthy" : "Industrial demand weakening",
                UUP: a.change_pct > 0 ? "Risk-off / headwind for risk assets" : "Dollar weakness supports risk assets",
              };
              return (
                <div key={a.symbol} style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${chgColor(a.change_pct)}25`}}
                  onClick={()=>onDetail?.(a.symbol)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={mono(10, C.headingTxt, 700)}>{a.name}</span>
                    <Tag color={chgColor(a.change_pct)}>{a.symbol}</Tag>
                  </div>
                  <div style={mono(18, C.headingTxt, 800)}>${a.price?.toFixed(2)}</div>
                  <div style={mono(10, chgColor(a.change_pct), 600)}>{a.change_pct >= 0 ? "+" : ""}{a.change_pct?.toFixed(2)}%</div>
                  <div style={{...mono(8, C.mut), marginTop:6, lineHeight:1.4}}>{interp[a.symbol] || ""}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══════════ 6. BREADTH & SECTOR PARTICIPATION ═══════════ */}
        {mkt.sectors && (
          <div>
            <SectionSep label="Breadth & Sector Participation"/>
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={mono(10, C.headingTxt, 700)}>Sector Heatmap</span>
                  {(() => {
                    const adv = mkt.sectors.filter(s => (s.change_pct||0) >= 0).length;
                    return <Tag color={adv >= 8 ? C.grn : adv >= 5 ? C.amb : C.red}>{adv}/{mkt.sectors.length} advancing</Tag>;
                  })()}
                </div>
                <button onClick={()=>setSectorsOpen(!sectorsOpen)}
                  style={{...mono(9,C.mut,600),background:"transparent",border:`1px solid ${C.bdr}`,borderRadius:6,padding:"3px 10px",cursor:"pointer"}}>
                  {sectorsOpen ? "Collapse" : "Expand"}
                </button>
              </div>

              {!sectorsOpen && (
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {[...mkt.sectors].sort((a,b) => (b.change_pct||0) - (a.change_pct||0)).map(s => (
                    <span key={s.symbol} style={{...mono(8, chgColor(s.change_pct), 600),
                      padding:"2px 6px",borderRadius:4,background:chgColor(s.change_pct)+"12",border:`1px solid ${chgColor(s.change_pct)}22`}}>
                      {s.symbol.replace("XL","")} {s.change_pct >= 0 ? "+" : ""}{s.change_pct?.toFixed(1)}%
                    </span>
                  ))}
                </div>
              )}

              {sectorsOpen && (
                <div style={{display:"grid",gridTemplateColumns:`repeat(auto-fill, minmax(125px, 1fr))`,gap:6}}>
                  {[...mkt.sectors].sort((a,b) => (b.change_pct||0) - (a.change_pct||0)).map(s => {
                    const intensity = Math.min(1, Math.abs(s.change_pct || 0) / 2);
                    return (
                      <div key={s.symbol} style={{padding:"10px",borderRadius:8,textAlign:"center",
                        background:(s.change_pct >= 0 ? C.grn : C.red) + Math.round(intensity * 25).toString(16).padStart(2,"0"),
                        border:`1px solid ${chgColor(s.change_pct)}30`}}>
                        <div style={mono(9, C.headingTxt, 700)}>{s.name}</div>
                        <div style={mono(8, C.mut)}>{s.symbol}</div>
                        <div style={mono(12, chgColor(s.change_pct), 800)}>{s.change_pct >= 0 ? "+" : ""}{s.change_pct?.toFixed(2)}%</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ═══════════ 7. GO DEEPER ═══════════ */}
        <div>
          <SectionSep label="Go Deeper"/>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:8}}>
            {[["Sectors","sectors","Sector rotation & relative strength"],
              ["Technical","technical","Price action & signal analysis"],
              ["Options","options","Options chain & strategy builder"]].map(([label, view, desc]) => (
              <button key={view} onClick={()=>onNav(view)}
                style={{flex:1,minWidth:150,padding:"14px 16px",borderRadius:12,background:C.surf,
                  border:`1px solid ${C.sky}25`,cursor:"pointer",textAlign:"left",transition:"border-color .15s"}}>
                <div style={mono(11, C.sky, 700)}>{label}</div>
                <div style={{...mono(9, C.mut), marginTop:4}}>{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ═══════════ 8. SYSTEM STATUS ═══════════ */}
        <Card>
          <Lbl>System Status</Lbl>
          <div style={{display:"grid",gridTemplateColumns: C.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:8}}>
            {[["Data Layer","3 / 3",C.grn],["Signal Engine","5 active",C.grn],
              ["Options Feed","Live",C.grn],["Statistical Val","49 / 49",C.grn]].map(([k,v,c])=>(
              <div key={k} style={{padding:"8px 10px",borderRadius:8,background:c+"08",border:`1px solid ${c}22`}}>
                <div style={{...mono(8,C.mut,700),letterSpacing:"0.08em",marginBottom:2}}>{k.toUpperCase()}</div>
                <div style={mono(12,c,800)}>{v}</div>
                <div style={{...mono(7,C.mut),marginTop:1}}>operational</div>
              </div>
            ))}
          </div>
        </Card>

      </>)}

    </div>
  );
}

const TIPS = {
  sharpe: {
    desc: "Annualized excess return ÷ annualized volatility. The single most common risk-adjusted performance metric.",
    bands: [
      {label:"Exceptional", range:"> 2.0",       color:"#00e676"},
      {label:"Good",        range:"1.0 – 2.0",   color:"#40c4ff"},
      {label:"Acceptable",  range:"0.5 – 1.0",   color:"#ffb300"},
      {label:"Poor",        range:"< 0.5",        color:"#ff5252"},
    ],
  },
  tstat: {
    desc: "How many standard deviations the mean daily return sits above zero. Higher = stronger evidence the edge is real and not random noise.",
    bands: [
      {label:"Strong",   range:"> 3.0",       color:"#00e676"},
      {label:"Good",     range:"2.0 – 3.0",   color:"#40c4ff"},
      {label:"Marginal", range:"1.5 – 2.0",   color:"#ffb300"},
      {label:"Weak",     range:"< 1.5",        color:"#ff5252"},
    ],
  },
  corrP: {
    desc: "P-value after Benjamini-Hochberg correction. When testing many strategies, false positives pile up — BH controls the false discovery rate. Lower = more significant.",
    bands: [
      {label:"Highly significant", range:"< 0.01",      color:"#00e676"},
      {label:"Significant",        range:"0.01 – 0.05", color:"#40c4ff"},
      {label:"Marginal",           range:"0.05 – 0.10", color:"#ffb300"},
      {label:"Not significant",    range:"> 0.10",       color:"#ff5252"},
    ],
  },
  permP: {
    desc: "Fraction of 500 randomly shuffled return series that beat your strategy's Sharpe. Makes zero distribution assumptions — the most honest test. Lower = harder to replicate by chance.",
    bands: [
      {label:"Strong",   range:"< 0.01",      color:"#00e676"},
      {label:"Passes",   range:"0.01 – 0.05", color:"#40c4ff"},
      {label:"Marginal", range:"0.05 – 0.10", color:"#ffb300"},
      {label:"Fails",    range:"> 0.10",       color:"#ff5252"},
    ],
  },
};

const PIPELINE_STEPS = [
  {id:"creating",   label:"Creating project…"},
  {id:"ingesting",  label:"Ingesting data from yfinance…"},
  {id:"features",   label:"Computing features…"},
  {id:"backtesting",label:"Running backtest + validation…"},
  {id:"done",       label:"Complete"},
];

function BacktestView() {
  const C = useC();
  const TT = makeTT(C);
  const { token } = useAuth();
  const ALL=["conditional_probability","bayesian_update","regression_alpha","pca_regime","fat_tail_risk"];

  // Config inputs
  const [symbols, setSymbols] = useState("SPY,QQQ,IWM,TLT,GLD");
  const [startDate, setStartDate] = useState("2015-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [fee, setFee] = useState("1.0");
  const [slippage, setSlippage] = useState("2.0");
  const [rfr, setRfr] = useState("3.0");
  const [sigs, setSigs] = useState(["conditional_probability","pca_regime"]);
  const toggle = s => setSigs(p => p.includes(s) ? p.filter(x=>x!==s) : [...p,s]);

  // Signal hover tooltip (auto-dismisses after 5s)
  const [hovSig, setHovSig] = useState(null);
  const hovTimer = useRef(null);
  const SIG_TIPS = {
    conditional_probability: "Detects when a market condition (e.g. high volume) historically precedes up-days at a rate above chance. Fires when the statistical edge clears the significance threshold.",
    bayesian_update:         "Maintains a running estimate of expected daily return, blending prior belief with each new day's data. Adapts to regime changes via a built-in decay factor.",
    regression_alpha:        "Strips out known factors (volume, momentum) to isolate the unexplained portion of returns — pure edge. Signal strength = the alpha t-statistic.",
    pca_regime:              "Detects whether stocks are moving in lockstep (systemic risk-off) or independently (risk-on) by measuring concentration in the return covariance matrix.",
    fat_tail_risk:           "Fits a fat-tailed distribution to recent returns and sizes positions so your daily VaR stays within a 2% target. Output is a recommended position size, not a direction.",
  };

  // Run state
  const [step, setStep] = useState(null);
  const [errMsg, setErrMsg] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [validation, setValidation] = useState(null);
  const [eqData, setEqData] = useState(null);

  const stepIdx = id => PIPELINE_STEPS.findIndex(s=>s.id===id);
  const curIdx = step ? stepIdx(step) : -1;
  const running = step && step !== "done" && step !== "error";
  const ran = step === "done";

  // Rolling metrics computed from equity curve (window ≈ 52 points ≈ 1 yr)
  const rollingData = useMemo(()=>{
    const data = eqData || EQ_DATA;
    if (!data || data.length < 30) return [];
    const W = Math.min(52, Math.floor(data.length / 4));
    return data.slice(W).map((d,i)=>{
      const slice = data.slice(i, i+W);
      const rets  = slice.slice(1).map((x,j)=>Math.log(x.eq/slice[j].eq));
      const mean  = rets.reduce((a,b)=>a+b,0)/rets.length;
      const std   = Math.sqrt(rets.map(r=>(r-mean)**2).reduce((a,b)=>a+b,0)/rets.length)||0.0001;
      const annSh = parseFloat(((mean/std)*Math.sqrt(52)).toFixed(3));
      const peak  = Math.max(...slice.map(x=>x.eq));
      const dd    = parseFloat(((d.eq-peak)/peak*100).toFixed(2));
      return {yr:d.yr, sharpe:annSh, drawdown:dd};
    });
  }, [eqData]);

  const go = async () => {
    setStep("creating"); setErrMsg(null); setMetrics(null); setValidation(null); setEqData(null);
    try {
      const symList = symbols.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);

      const authH = token ? {Authorization:`Bearer ${token}`} : {};
      // 1. Create project
      const pRes = await fetch("/api/projects", {
        method:"POST", headers:{"Content-Type":"application/json",...authH},
        body: JSON.stringify({name:`Run ${new Date().toISOString().slice(0,16)}`, symbols:symList, start_date:startDate, end_date:endDate}),
      });
      if (!pRes.ok) throw new Error(friendlyError(await pRes.text()) || "Could not create project");
      const proj = await pRes.json();

      // 2. Ingest
      setStep("ingesting");
      const iRes = await fetch(`/api/projects/${proj.id}/ingest`, {method:"POST", headers:{"Content-Type":"application/json",...authH}, body:"{}"});
      if (!iRes.ok) throw new Error(`Ingest: ${await iRes.text()}`);

      // 3. Features
      setStep("features");
      const fRes = await fetch(`/api/projects/${proj.id}/features/compute`, {method:"POST", headers:{"Content-Type":"application/json",...authH}, body:"{}"});
      if (!fRes.ok) throw new Error(`Features: ${await fRes.text()}`);

      // 4. Backtest
      setStep("backtesting");
      const bRes = await fetch(`/api/projects/${proj.id}/runs/backtest`, {
        method:"POST", headers:{"Content-Type":"application/json",...authH},
        body: JSON.stringify({signals:sigs, fee_bps:parseFloat(fee), slippage_bps:parseFloat(slippage), risk_free_rate:parseFloat(rfr)/100, n_permutations:500}),
      });
      if (!bRes.ok) throw new Error(`Backtest: ${await bRes.text()}`);
      const run = await bRes.json();
      if (run.status === "failed") throw new Error(run.error || "Backtest failed");
      setMetrics(run.metrics);
      setValidation(run.validation);

      // 5. Equity curve
      try {
        const ecRes = await fetch(`/api/runs/${run.id}/equity_curve`);
        if (ecRes.ok) {
          const ec = await ecRes.json();
          const n = ec.equity_curve.length;
          const stride = Math.max(1, Math.floor(n/150));
          setEqData(ec.timestamps.filter((_,i)=>i%stride===0).map((t,i)=>({yr:t.slice(0,10), eq:Math.round(ec.equity_curve[i*stride])})));
        }
      } catch(_) {}

      setStep("done");
    } catch(e) { setErrMsg(e.message); setStep("error"); }
  };

  const m = metrics || {};
  const v = validation || {};
  const chartData = eqData || EQ_DATA;

  const fmt = {
    pct:  x => x!=null ? `${(x*100).toFixed(2)}%` : "—",
    n4:   x => x!=null ? x.toFixed(4) : "—",
    int:  x => x!=null ? x.toString() : "—",
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div><Lbl>Backtest Engine</Lbl><div style={mono(11,C.mut)}>Signal at t → Trade at open of t+1 · No lookahead bias guaranteed</div></div>

      <Card>
        <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"2fr 1fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <Lbl>Symbols (comma-separated)</Lbl>
            <input value={symbols} onChange={e=>setSymbols(e.target.value)} placeholder="SPY,QQQ,AAPL,MSFT"
              style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.dim,border:`1px solid ${C.grn}60`,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div>
            <Lbl>Start Date</Lbl>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
              style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box",colorScheme:C===DARK?"dark":"light"}}/>
          </div>
          <div>
            <Lbl>End Date</Lbl>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}
              style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box",colorScheme:C===DARK?"dark":"light"}}/>
          </div>
        </div>

        <Lbl>Signals</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
          {ALL.map(s=>(
            <div key={s}
              onMouseEnter={()=>{ if(hovTimer.current) clearTimeout(hovTimer.current); setHovSig(s); hovTimer.current=setTimeout(()=>setHovSig(null),5000); }}
            >
              <Pill label={s} active={sigs.includes(s)} onClick={()=>toggle(s)}/>
            </div>
          ))}
        </div>
        {hovSig && SIG_TIPS[hovSig] && (
          <div style={{...mono(10,C.mut),background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"8px 12px",marginBottom:8,lineHeight:1.6}}>
            <span style={{...mono(9,C.sky,600)}}>{SIG_META.find(m=>m.id===hovSig)?.label} · </span>
            {SIG_TIPS[hovSig]}
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginBottom:14}}>
          {[["Fee (bps)",fee,setFee],["Slippage (bps)",slippage,setSlippage],["Risk-Free Rate %",rfr,setRfr]].map(([l,val,set])=>(
            <div key={l}><Lbl>{l}</Lbl>
              <input value={val} onChange={e=>set(e.target.value)}
                style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/>
            </div>
          ))}
        </div>

        <SpinRing active={!!running}>
        <button onClick={go} disabled={!!running}
          style={{display:"flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:8,border:"none",cursor:running?"not-allowed":"pointer",background:running?C.dim:C.grn,color:running?C.mut:"#000",...mono(12,running?C.mut:"#000",700),transition:"all .15s"}}>
          {running ? <><RefreshCw size={14}/>Running…</> : <><Play size={14}/>Run Backtest</>}
        </button>
        </SpinRing>

        {running && (
          <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:4}}>
            {PIPELINE_STEPS.filter(s=>s.id!=="done").map((s,i)=>{
              const done=i<curIdx, active=i===curIdx;
              return (
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0"}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:done?C.grn:active?C.amb:C.bdr,flexShrink:0}}/>
                  <span style={mono(10,done?C.grn:active?C.amb:C.mut)}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {step==="error" && (
          <div style={{marginTop:12,padding:10,borderRadius:8,background:C.red+"12",border:`1px solid ${C.red}30`,...mono(10,C.red)}}>
            ✗ {errMsg}
          </div>
        )}
      </Card>

      {ran && (<>
        <ValBanner label={v.label||"likely_noise"}/>

        <div style={{display:"grid",gridTemplateColumns:C.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:12}}>
          {[
            {l:"CAGR",         v:fmt.pct(m.cagr),            c:C.grn},
            {l:"Sharpe",       v:fmt.n4(m.sharpe_ratio),      c:C.grn, tip:TIPS.sharpe},
            {l:"Sortino",      v:fmt.n4(m.sortino_ratio),     c:C.sky},
            {l:"Max Drawdown", v:fmt.pct(m.max_drawdown),     c:C.red},
            {l:"Volatility",   v:fmt.pct(m.volatility),       c:C.mut},
            {l:"Calmar",       v:fmt.n4(m.calmar_ratio),      c:C.mut},
            {l:"Trades",       v:fmt.int(m.n_trades),         c:C.mut},
            {l:"Alpha (ann.)", v:fmt.pct(m.alpha_annualized), c:C.grn,
              sub:m.alpha_t_stat!=null?`t=${m.alpha_t_stat.toFixed(3)}  p=${(v.p_value_corrected||0).toFixed(3)}`:undefined},
          ].map(({l,v,c,sub})=><Stat key={l} label={l} value={v} color={c} sub={sub}/>)}
        </div>

        <Card>
          <Lbl>Equity Curve</Lbl>
          <ChartPanel title="Backtest — Equity Curve" defaultHeight={220}>
          {(h) => (
          <ResponsiveContainer width="100%" height={h}>
            <AreaChart data={chartData} margin={{top:4,right:4,left:50,bottom:4}}>
              <defs>
                <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.grn} stopOpacity={0.28}/>
                  <stop offset="95%" stopColor={C.grn} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="yr" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} tickLine={false} axisLine={false}
                tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}
                label={{value:"Portfolio Value ($)",angle:-90,position:"insideLeft",offset:20,
                  style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
              <Tooltip {...TT} formatter={v=>[`$${(v/1000).toFixed(1)}k`]}/>
              <Area type="monotone" dataKey="eq" name="Strategy" stroke={C.grn} strokeWidth={2} fill="url(#gE)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
          )}
          </ChartPanel>
        </Card>

        {rollingData.length>0&&(
          <Card>
            <Lbl>Rolling Sharpe Ratio &amp; Drawdown</Lbl>
            <ChartPanel title="Backtest — Rolling Metrics" defaultHeight={200}>
            {(h)=>(
            <ResponsiveContainer width="100%" height={h}>
              <ComposedChart data={rollingData} margin={{top:4,right:4,left:50,bottom:4}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                <XAxis dataKey="yr" tick={{fill:C.mut,fontSize:9,fontFamily:"monospace"}} tickLine={false} axisLine={false}/>
                <YAxis yAxisId="sh" tick={{fill:C.mut,fontSize:9,fontFamily:"monospace"}} tickLine={false} axisLine={false}
                  label={{value:"Sharpe",angle:-90,position:"insideLeft",offset:20,style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
                <YAxis yAxisId="dd" orientation="right" tick={{fill:C.mut,fontSize:9,fontFamily:"monospace"}} tickLine={false} axisLine={false}
                  tickFormatter={v=>`${v}%`}
                  label={{value:"Drawdown %",angle:90,position:"insideRight",offset:20,style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
                <Tooltip {...TT} formatter={(v,n)=>n==="Drawdown"?[`${v}%`,"Drawdown"]:[v,"Rolling Sharpe"]}/>
                <ReferenceLine yAxisId="sh" y={0} stroke={C.bdr} strokeDasharray="4 4"/>
                <Line yAxisId="sh" type="monotone" dataKey="sharpe" name="Rolling Sharpe" stroke={C.grn} strokeWidth={2} dot={false}/>
                <Area yAxisId="dd" type="monotone" dataKey="drawdown" name="Drawdown" stroke={C.red} fill={C.red+"18"} strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
            )}
            </ChartPanel>
          </Card>
        )}

        <Card>
          <Lbl>Statistical Validation</Lbl>
          <div style={{display:"grid",gridTemplateColumns:C.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:12,marginTop:6}}>
            {[
              ["t-stat",     v.t_stat?.toFixed(4)||"—",              C.sky,  TIPS.tstat],
              ["Raw p",      v.p_value_raw?.toFixed(4)||"—",         C.txt,  null],
              ["Corr p (BH)",v.p_value_corrected?.toFixed(4)||"—",  C.grn,  TIPS.corrP],
              ["Perm p",     v.permutation_p_value?.toFixed(4)||"—",C.grn,  TIPS.permP],
            ].map(([k,val,col,tip])=>(
              <div key={k}>
                {tip
                  ? <InfoTip desc={tip.desc} bands={tip.bands}><Lbl>{k}</Lbl></InfoTip>
                  : <Lbl>{k}</Lbl>}
                <div style={mono(18,col,700)}>{val}</div>
              </div>
            ))}
          </div>
          {v.conclusion && <p style={{...mono(11,C.mut),marginTop:10,lineHeight:1.7}}>{v.conclusion}</p>}
          {v.warnings?.length>0 && (
            <div style={{marginTop:10}}>
              {v.warnings.map((w,i)=><div key={i} style={{...mono(10,C.amb),padding:"4px 8px",borderRadius:6,background:C.amb+"10",marginBottom:4}}>⚠ {w}</div>)}
            </div>
          )}
        </Card>

        <Card>
          <Lbl>Alpha Regression — Newey-West HAC</Lbl>
          <div style={{display:"grid",gridTemplateColumns:C.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:12,marginTop:6}}>
            {[
              ["Alpha (ann.)", m.alpha_annualized!=null?`${(m.alpha_annualized*100).toFixed(2)}%`:"—", C.grn],
              ["t-statistic",  m.alpha_t_stat?.toFixed(4)||"—",  C.sky],
              ["p-value",      v.p_value_corrected?.toFixed(4)||"—", C.grn],
              ["HAC lags",     "5", C.mut],
            ].map(([k,val,col])=>(
              <div key={k}><Lbl>{k}</Lbl><div style={mono(17,col,700)}>{val}</div></div>
            ))}
          </div>
          <div style={{marginTop:12}}><CodeBox>{"β̂ = (XᵀX)⁻¹Xᵀy  ·  SE = Newey-West (1987) HAC  ·  H₀: α = 0"}</CodeBox></div>
        </Card>

        {/* ── Backtest Synthesis tile ── */}
        {(() => {
          const sharpe  = m.sharpe_ratio  || 0;
          const cagr    = m.cagr          || 0;
          const dd      = Math.abs(m.max_drawdown || 0);
          const vol     = m.volatility    || 0;
          const pCorr   = v.p_value_corrected != null ? v.p_value_corrected : 1;
          const tStat   = v.t_stat        || 0;
          const nTrades = m.n_trades      || 0;
          // Infer trading style from trade frequency
          const yrs = startDate && endDate
            ? Math.max(1, parseInt(endDate.slice(0,4)) - parseInt(startDate.slice(0,4)))
            : 5;
          const avgHoldDays = nTrades ? Math.round(yrs * 252 / nTrades) : null;
          const styleLabel  = !avgHoldDays ? "unknown"
            : avgHoldDays <= 3  ? "intraday/swing (1–3 day holds)"
            : avgHoldDays <= 10 ? "swing (1–2 week holds)"
            : avgHoldDays <= 40 ? "position trading (2–8 week holds)"
            : "trend following (multi-month holds)";
          // Verdict logic
          const statSig  = pCorr < 0.05 && Math.abs(tStat) > 1.96;
          const perfGood = sharpe > 1.0 && cagr > 0.08;
          const riskOK   = dd < 0.30;
          const verdict  = statSig && perfGood && riskOK ? "DEPLOY CANDIDATE"
            : statSig && (sharpe > 0.5 || cagr > 0.05)  ? "PROMISING — REFINE"
            : statSig                                     ? "MARGINAL — CAUTION"
            : "NOT VALIDATED";
          const bc = verdict === "DEPLOY CANDIDATE" ? C.grn
            : verdict === "PROMISING — REFINE"      ? C.amb
            : verdict === "MARGINAL — CAUTION"      ? "#ff8a65"
            : C.red;
          const summary = `CAGR ${(cagr*100).toFixed(1)}% · Sharpe ${sharpe.toFixed(2)} · Max DD −${(dd*100).toFixed(1)}% · Vol ${(vol*100).toFixed(1)}% · ${nTrades} trades over ${yrs}yr (${styleLabel}). Statistical validation: p=${pCorr.toFixed(3)} (${statSig ? "✓ significant" : "✗ not significant"}).`;
          const action = verdict === "DEPLOY CANDIDATE"
            ? `Results are statistically significant and risk-adjusted returns are strong. Forward-test at 50% position sizing for 3–6 months before full deployment. Set a live drawdown limit at −${(dd*0.5*100).toFixed(0)}% (half of backtest max). Monitor rolling Sharpe — pause the strategy if it drops below 0.5 for 8+ consecutive weeks.`
            : verdict === "PROMISING — REFINE"
            ? `Strategy shows real edge (p=${pCorr.toFixed(3)}) but performance metrics need improvement — either Sharpe ${sharpe.toFixed(2)} is below 1.0 or CAGR ${(cagr*100).toFixed(0)}% is modest. Consider tightening signal parameters, increasing the universe, or adding a volatility filter. Do not deploy at full size — paper-trade first.`
            : verdict === "MARGINAL — CAUTION"
            ? `Statistically valid but performance is weak — Sharpe ${sharpe.toFixed(2)} and max drawdown −${(dd*100).toFixed(0)}% suggest the strategy captures a small edge with significant risk. Only trade in a limited-risk, defined-outcome structure. Do not allocate more than 5–10% of capital.`
            : `p-value ${pCorr.toFixed(3)} is above the 0.05 significance threshold — results cannot be distinguished from random. Do not deploy. Revisit signal selection, universe, or time period before re-testing.`;
          return (
            <div style={{padding:"18px 20px",borderRadius:12,
              background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{...mono(9,C.mut,700),letterSpacing:".08em"}}>SYNTHESIS</div>
                <div style={{...mono(9,bc,700),padding:"2px 10px",borderRadius:99,
                  background:bc+"18",border:`1px solid ${bc}40`}}>{verdict}</div>
              </div>
              <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:12}}>{summary}</div>
              <div style={{...mono(9,C.mut,600),letterSpacing:".06em",marginBottom:6}}>WHAT THIS INDICATES</div>
              <div style={{...mono(11,C.txt),lineHeight:1.8}}>{action}</div>
            </div>
          );
        })()}
      </>)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal Dashboard sub-components
// ─────────────────────────────────────────────────────────────────────────────

const SIG_META = [
  {
    id:   "conditional_probability",
    label:"Conditional Probability",
    math: "P(A|B) = P(A∩B)/P(B)",
    desc: "Estimates P(up | condition) vs unconditional P(up). Two-proportion z-test with Wilson confidence intervals. Signal fires when conditional edge is statistically significant.",
    what: "Asks a simple question: when the market is in a particular condition (e.g., volume spiking above normal), how often does it close up the next day?",
    how:  "It counts every historical day where the condition was true, and measures the 'up day' frequency. If that frequency is materially higher than the unconditional rate (say 61% vs 53%), the gap is a potential edge. The p-value tests whether that gap is real or just statistical noise.",
    analogy:"Like tracking whether umbrella sales spike before rainy days. If high-volume days reliably precede up-closes, that's an exploitable pattern.",
    when: "Works best during trending or momentum-driven markets where volume precedes price direction. Can produce false signals in low-information, choppy markets.",
    code: null,
  },
  {
    id:   "bayesian_update",
    label:"Bayesian Update",
    math: "K = σ²ₚ/(σ²ₚ+σ²ₗ) → μₙ = μₚ+K(obs−μₚ)",
    desc: "Maintains Gaussian belief over expected return via Kalman-style update. Uncertainty inflated by decay factor each step so belief tracks regime changes. Signal = posterior mean.",
    what: "Maintains a running belief about the stock's expected daily return, updating it every day like a forecaster who blends prior knowledge with new evidence.",
    how:  "Uses the Kalman gain K to decide how much to trust today's return vs yesterday's belief. A decay factor slowly inflates uncertainty over time, so stale beliefs become less dominant — allowing the signal to adapt when the market regime changes.",
    analogy:"Like a doctor updating a patient's prognosis daily — they don't ignore all prior history just because today's test result was bad, but they do adjust their forecast.",
    when: "Best during periods where past returns carry information — trending or mean-reverting markets. The decay factor helps it adapt to regime shifts, but it lags sudden breaks.",
    code: `K = σ²_prior / (σ²_prior + σ²_lik)\nμ_post = μ_prior + K*(obs - μ_prior)\nσ²_post = (1 - K) * σ²_prior\nσ²_prior /= decay²  # inflate for regime adaptation`,
  },
  {
    id:   "regression_alpha",
    label:"Regression Alpha",
    math: "β̂ = (XᵀX)⁻¹Xᵀy  ·  SE: Newey-West HAC",
    desc: "Rolling OLS of returns on feature set. Newey-West HAC standard errors with 5 lags corrects for heteroskedasticity and autocorrelation. Signal = alpha t-statistic (signed).",
    what: "Finds the portion of today's return that can't be explained by known factors like volume or momentum — the 'pure' unexplained return that signals genuine edge.",
    how:  "Runs a rolling OLS regression: return = alpha + beta×volume_zscore + error. The intercept alpha is the return no model factor explains. Newey-West standard errors correct for autocorrelation in daily returns. The t-statistic of alpha tells you if it's statistically distinguishable from zero.",
    analogy:"Like a sports analyst removing home-field advantage and opponent strength from a player's stats to find their 'true' contribution — we strip out known factors to isolate pure edge.",
    when: "Works well when there is genuine alpha after controlling for volume and momentum. Requires about 6 months of history for the regression to stabilise.",
    code: `X = add_constant(features)\nmodel = OLS(returns, X)\nresult = model.fit(\n  cov_type="HAC",\n  cov_kwds={"maxlags": 5}\n)\nsignal[i] = result.tvalues[0]  # alpha t-stat`,
  },
  {
    id:   "pca_regime",
    label:"PCA Regime Filter",
    math: "Σ = QΛQᵀ  ·  top_var = λ₁/Σλ",
    desc: "Eigendecomposition of cross-sectional return covariance Σ. First-PC explained variance > 70% → systemic risk → signal = −1 (risk-off). Dispersed variance < 40% → signal = +1 (risk-on).",
    what: "Watches whether all stocks are moving in lockstep or independently. That correlation structure reveals which market regime you're in — risk-on or risk-off.",
    how:  "Runs Principal Component Analysis on the cross-sectional return covariance matrix each day. When the top eigenvector explains >70% of total variance, all stocks are correlated — that's systemic risk. When it explains <40%, returns are diversified — a healthy, risk-on environment.",
    analogy:"Like watching a crowd at a concert. If everyone is dancing to the same beat (high correlation), one person falling could trigger a stampede. If people dance independently, individual falls are isolated.",
    when: "Most valuable as a risk filter layered on top of directional signals. The signal is binary (risk-on/off/transition), so it's best used to gate position sizing rather than as a standalone predictor.",
    code: `cov = np.cov(window.T)\nλ, Q = np.linalg.eigh(cov)\ntop_var = λ[-1] / λ.sum()\nif top_var > 0.70:\n  signal[i] = -1.0  # risk-off\nelif top_var < 0.40:\n  signal[i] = +1.0  # risk-on\nelse:\n  signal[i] =  0.0  # transition`,
  },
  {
    id:   "fat_tail_risk",
    label:"Fat-Tail Risk",
    math: "Student-t MLE → VaR₉₅ → size = target/VaR",
    desc: "Fits Student-t via MLE to rolling window. Computes 95th-pct VaR under fitted tail. Position size = target_VaR/unit_VaR. Lower ν (fatter tails) → smaller position, clipped to [0,1].",
    what: "Measures how 'fat' the tails of the return distribution are right now — how likely extreme losses are — and recommends a position size to keep risk within target.",
    how:  "Fits a Student-t distribution to recent returns via maximum likelihood. Lower degrees of freedom ν = fatter tails = more extreme loss potential. Computes the 95th percentile VaR under this distribution and scales position size so your actual VaR matches the target (2% daily).",
    analogy:"Like an insurance company adjusting premiums dynamically based on recent claims. After a hurricane season, they charge more. After calm years, they lower rates. Here, the model lowers your position size after volatile periods.",
    when: "Most valuable as a position-sizing overlay during volatile or crisis periods when tail risk spikes. Works in combination with directional signals — it answers 'how much?' not 'which direction?'",
    code: `ν, μ, σ = t.fit(window_returns)\nν = max(2.1, ν)  # bound for variance\nVaR = abs(t.ppf(0.05,\n  df=ν, loc=μ, scale=σ))\nsize = min(1.0, target_VaR / VaR)\nsignal[i] = size`,
  },
];

const VERDICT_COL = (C, v) => ({bullish: C.grn, bearish: C.red, neutral: C.amb})[v] || C.mut;
const VERDICT_ICON = {bullish:"↑", bearish:"↓", neutral:"→"};

// Signal Pulse card — one per signal
function SigPulseCard({meta, reading, selected, onClick}) {
  const C = useC();
  const [hov, setHov] = useState(false);
  if (!reading) return null;
  const vc = VERDICT_COL(C, reading.verdict);
  return (
    <div onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{background: C.surf,
        borderTop:`1px solid ${selected ? meta.col : hov ? C.txt+"28" : C.bdr}`,
        borderRight:`1px solid ${selected ? meta.col : hov ? C.txt+"28" : C.bdr}`,
        borderBottom:`1px solid ${selected ? meta.col : hov ? C.txt+"28" : C.bdr}`,
        borderLeft:`3px solid ${selected ? meta.col : vc}`,
        borderRadius:10, padding:"12px 14px", cursor:"pointer",
        transition:"border-color .15s", boxSizing:"border-box"}}>
      <div style={{...mono(8,C.mut,500),textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:4}}>
        {meta.label}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <span style={mono(18,vc,800)}>{VERDICT_ICON[reading.verdict]}</span>
        <span style={mono(13,vc,700)}>{reading.verdict.toUpperCase()}</span>
        <span style={{...mono(9,C.mut),marginLeft:"auto"}}>{reading.strength}%</span>
      </div>
      {/* Strength bar */}
      <div style={{margin:"7px 0 4px",height:3,borderRadius:2,background:C.dim,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${reading.strength}%`,background:vc,
          borderRadius:2,transition:"width .6s ease"}}/>
      </div>
      {/* Blurb (3-line clamp) */}
      <div style={{...mono(9,C.mut),lineHeight:1.65,
        display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
        {reading.blurb}
      </div>
      {selected && (
        <div style={{...mono(8,meta.col),marginTop:6,textAlign:"right",opacity:.7}}>
          ↓ detail below
        </div>
      )}
    </div>
  );
}

// Raw stats strip shown inside the Plain English card
function RawStats({raw, C}) {
  if (!raw || Object.keys(raw).length === 0) return null;
  const LABELS = {
    p_up:"Base rate", p_up_given_cond:"P(up | cond)", edge:"Edge",
    z_stat:"Z-stat", p_value:"P-value", n_condition:"N (cond)",
    n_total:"N (total)", ci_lower:"CI lower", ci_upper:"CI upper",
    posterior_mean:"Posterior mean", t_stat:"Alpha t-stat",
    daily_alpha:"Daily alpha", regime:"Regime",
    top_variance_explained:"Var. explained", signal_value:"Signal",
    position_size:"Pos. size",
  };
  const entries = Object.entries(raw)
    .filter(([,v]) => v !== null && v !== undefined)
    .map(([k,v]) => [LABELS[k] || k, typeof v === "number" ? (Math.abs(v) < 0.0001 ? v.toExponential(2) : v.toFixed(4)) : String(v)]);
  if (!entries.length) return null;
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:14,marginTop:10}}>
      {entries.map(([k,v]) => <KV key={k} k={k} v={v} vc={C.sky}/>)}
    </div>
  );
}

// Plain English detail panel
function PlainEnglishPanel({meta, reading, symbol, C}) {
  const vc = VERDICT_COL(C, reading?.verdict || "neutral");
  const sections = [
    {title:"What it does",       text: meta.what},
    {title:"How it works",       text: meta.how},
    {title:"Real-world analogy", text: meta.analogy},
    {title:"When it works best", text: meta.when},
  ];
  return (
    <Card accent={meta.col}>
      {/* Current reading highlight */}
      {reading && (
        <div style={{padding:"10px 14px",borderRadius:8,background:`${vc}0d`,
          border:`1px solid ${vc}22`,marginBottom:18}}>
          <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:4}}>
            Current reading · {symbol}
          </div>
          <div style={{...mono(11,vc,600),lineHeight:1.7}}>{reading.blurb}</div>
          <RawStats raw={reading.raw} C={C}/>
        </div>
      )}
      {sections.map(({title,text}) => text && (
        <div key={title} style={{marginBottom:14}}>
          <div style={{...mono(8,meta.col,700),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:4}}>
            {title}
          </div>
          <div style={{...mono(10,C.txt),lineHeight:1.85}}>{text}</div>
        </div>
      ))}
    </Card>
  );
}

// Math & Code detail panel  (includes live CP chart for conditional_probability)
function MathPanel({meta, reading, C, TT}) {
  const [thresh, setThresh] = useState(1.5);
  const cpCurve = reading?.cp_curve || [];
  const baseRate = reading?.raw?.p_up ?? 0.53;
  const cpAtThresh = cpCurve.find(d => d.x === thresh);
  const pUpGivenCond = cpAtThresh?.c ?? baseRate;
  return (
    <Card accent={meta.col}>
      <div style={mono(14,C.headingTxt,700)}>{meta.label}</div>
      <code style={{display:"inline-block",marginTop:6,padding:"4px 12px",borderRadius:6,
        background:`${meta.col}15`,border:`1px solid ${meta.col}30`,...mono(11,meta.col)}}>
        {meta.math}
      </code>
      <p style={{...mono(10,C.mut),marginTop:10,lineHeight:1.85}}>{meta.desc}</p>

      {meta.id === "conditional_probability" && cpCurve.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1.6fr",gap:16,marginTop:14}}>
          {/* Controls */}
          <div>
            <Lbl>Explorer Controls</Lbl>
            <div style={{marginBottom:14}}>
              <div style={{...mono(9,C.mut),marginBottom:5}}>Threshold τ = {thresh.toFixed(2)}</div>
              <input type="range" min="-2.5" max="2.5" step="0.1" value={thresh}
                onChange={e=>setThresh(+e.target.value)}
                style={{width:"100%",accentColor:meta.col}}/>
            </div>
            {[
              ["P(up) — base rate",   `${(baseRate*100).toFixed(1)}%`,    C.txt],
              ["P(up | cond > τ)",    `${(pUpGivenCond*100).toFixed(1)}%`,meta.col],
              ["Edge",                `${((pUpGivenCond-baseRate)*100).toFixed(1)} pp`, pUpGivenCond > baseRate ? C.grn : C.red],
              ["z-statistic",         reading?.raw?.z_stat?.toFixed(3)   ?? "—", C.sky],
              ["p-value",             reading?.raw?.p_value?.toFixed(4)   ?? "—", reading?.raw?.p_value < 0.05 ? C.grn : C.amb],
              ["N (condition true)",  reading?.raw?.n_condition ?? "—",   C.mut],
              ["N (total)",           reading?.raw?.n_total ?? "—",       C.mut],
            ].map(([k,v,c]) => <KV key={k} k={k} v={String(v)} vc={c}/>)}
            {reading?.raw?.p_value < 0.05 && (
              <div style={{marginTop:10,padding:10,borderRadius:8,
                background:C.grnBg,border:`1px solid ${C.grn}25`,...mono(10,C.grn)}}>
                ✓ Statistically significant (p = {reading.raw.p_value?.toFixed(4)} &lt; 0.05)
              </div>
            )}
          </div>
          {/* Real chart */}
          <div>
            <Lbl>P(up | cond &gt; τ) vs Threshold</Lbl>
            <ChartPanel title="Conditional Probability Curve" defaultHeight={240}>
            {(h) => (
            <ResponsiveContainer width="100%" height={h}>
              <ComposedChart data={cpCurve} margin={{top:8,right:8,left:50,bottom:20}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                <XAxis dataKey="x" tick={mono(8,C.mut)} axisLine={false} tickLine={false}
                  label={{value:"z-score threshold",fill:C.mut,fontSize:9,fontFamily:"monospace",dy:16}}/>
                <YAxis domain={["auto","auto"]} tick={mono(8,C.mut)} axisLine={false} tickLine={false}
                  tickFormatter={v=>`${(v*100).toFixed(0)}%`}
                  label={{value:"P(up | cond > τ)",angle:-90,position:"insideLeft",offset:20,
                    style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
                <Tooltip {...TT} formatter={v=>[`${(v*100).toFixed(1)}%`]}/>
                <ReferenceLine y={baseRate} stroke={C.sky} strokeDasharray="4 2"
                  label={{value:`Base ${(baseRate*100).toFixed(1)}%`,fill:C.sky,fontSize:9,fontFamily:"monospace"}}/>
                <ReferenceLine x={thresh} stroke={C.amb} strokeDasharray="4 2"
                  label={{value:`τ=${thresh.toFixed(1)}`,fill:C.amb,fontSize:9,fontFamily:"monospace"}}/>
                <Line type="monotone" dataKey="c" name="P(up|cond)"
                  stroke={meta.col} strokeWidth={2.5} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
            )}
            </ChartPanel>
          </div>
        </div>
      )}

      {meta.code && meta.id !== "conditional_probability" && (
        <div style={{marginTop:14}}>
          <Lbl>Implementation</Lbl>
          <CodeBox>{meta.code}</CodeBox>
        </div>
      )}
    </Card>
  );
}

// Consensus tier
function ConsensusPanel({consensus, C}) {
  const {bullish_count:nBull, bearish_count:nBear, neutral_count:nNeut,
         score, conviction, overall} = consensus;
  const total = nBull + nBear + nNeut;
  const oc = VERDICT_COL(C, overall);
  const summary = nBull >= 3
    ? `${nBull}/5 signals bullish — meaningful directional agreement. Conviction: ${conviction}.`
    : nBear >= 3
    ? `${nBear}/5 signals bearish — signals lean toward reducing exposure. Conviction: ${conviction}.`
    : `Signals are mixed (${nBull} bullish · ${nNeut} neutral · ${nBear} bearish). Low cross-signal conviction — consider waiting for alignment before acting.`;
  return (
    <Card>
      <div style={{display:"flex",alignItems:"flex-start",gap:24,flexWrap:"wrap",marginBottom:14}}>
        <div>
          <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:3}}>Overall Signal</div>
          <div style={mono(22,oc,800)}>{overall.toUpperCase()}</div>
        </div>
        <div>
          <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:3}}>Conviction</div>
          <div style={mono(14,oc,700)}>{conviction.toUpperCase()}</div>
        </div>
        <div style={{marginLeft:"auto",textAlign:"right"}}>
          <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:4}}>
            Signal Breakdown (5 signals)
          </div>
          <div style={{display:"flex",gap:14,justifyContent:"flex-end"}}>
            <span style={mono(11,C.grn,700)}>{nBull} bullish</span>
            <span style={mono(11,C.amb,700)}>{nNeut} neutral</span>
            <span style={mono(11,C.red,700)}>{nBear} bearish</span>
          </div>
        </div>
      </div>
      {/* Stacked bar */}
      <div style={{height:7,borderRadius:4,overflow:"hidden",
        background:C.dim,display:"flex",gap:1}}>
        {nBull > 0 && <div style={{flex:nBull,background:C.grn,borderRadius:"4px 0 0 4px"}}/>}
        {nNeut > 0 && <div style={{flex:nNeut,background:C.amb}}/>}
        {nBear > 0 && <div style={{flex:nBear,background:C.red,borderRadius:"0 4px 4px 0"}}/>}
      </div>
      <div style={{...mono(10,C.mut),marginTop:10,lineHeight:1.75}}>{summary}</div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite Score Panel
// ─────────────────────────────────────────────────────────────────────────────

const REGIME_COL = (C, r) => ({
  "Strong Buy":  C.grn,
  "Buy":         "#80e680",
  "Hold":        C.amb,
  "Sell":        "#ff8a65",
  "Strong Sell": C.red,
})[r] || C.mut;

const REGIME_DESC = {
  "Strong Buy":  "All weighted signals aligned bullish. High conviction — model supports full position sizing.",
  "Buy":         "Partial bullish alignment across weighted signals. Moderate confidence — sized position appropriate.",
  "Hold":        "Signals conflicted or insufficient. Model suggests minimal exposure until clearer alignment.",
  "Sell":        "Partial bearish alignment. Model leans toward reducing or exiting exposure.",
  "Strong Sell": "Broad bearish agreement across weighted signals. High conviction — model supports short or cash.",
};

const SIG_DISPLAY_NAMES = {
  regression_alpha:        "Regression Alpha",
  bayesian_update:         "Bayesian Update",
  conditional_probability: "Conditional Probability",
  pca_regime:              "PCA Regime Filter",
};

function ScoreGauge({score, col, C}) {
  // score in [-1, +1]; render a horizontal track with a dot marker
  const pct = ((score + 1) / 2) * 100;  // map [-1,1] → [0,100]%
  return (
    <div style={{position:"relative",height:20,marginTop:4}}>
      {/* Track */}
      <div style={{position:"absolute",top:"50%",left:0,right:0,height:3,
        borderRadius:2,transform:"translateY(-50%)",
        background:`linear-gradient(to right, ${C.red}, ${C.dim} 50%, ${C.grn})`}}/>
      {/* Zero tick */}
      <div style={{position:"absolute",top:"20%",left:"50%",width:1,height:"60%",
        background:C.mut,opacity:0.4,transform:"translateX(-50%)"}}/>
      {/* Marker */}
      <div style={{position:"absolute",top:"50%",left:`${pct}%`,
        width:11,height:11,borderRadius:"50%",
        background:col,border:`2px solid ${C.bg}`,
        transform:"translate(-50%,-50%)",
        boxShadow:`0 0 6px ${col}80`,
        transition:"left .5s ease"}}/>
      {/* Labels */}
      <div style={{position:"absolute",top:"100%",left:0,...mono(7,C.mut),marginTop:3}}>−1</div>
      <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",...mono(7,C.mut),marginTop:3}}>0</div>
      <div style={{position:"absolute",top:"100%",right:0,...mono(7,C.mut),marginTop:3}}>+1</div>
    </div>
  );
}

function ContribBar({value, maxAbs, col, C}) {
  // Signed contribution bar — positive extends right, negative left from center
  const pct = Math.min(Math.abs(value) / maxAbs * 50, 50);
  const isPos = value >= 0;
  return (
    <div style={{position:"relative",height:6,background:C.dim,borderRadius:3,overflow:"hidden"}}>
      <div style={{
        position:"absolute",
        top:0, height:"100%",
        width:`${pct}%`,
        background: isPos ? col : C.red,
        borderRadius:3,
        left: isPos ? "50%" : `${50 - pct}%`,
        transition:"width .5s ease",
      }}/>
      {/* centre tick */}
      <div style={{position:"absolute",top:0,left:"50%",width:1,height:"100%",background:C.bdr}}/>
    </div>
  );
}

function CompositeScorePanel({composite, C}) {
  const [showRationale, setShowRationale] = useState(false);
  const {
    score_directional, score_final, fat_tail_gate,
    regime_directional, regime_final, contributions, fat_tail_rationale,
  } = composite;

  const finalCol = REGIME_COL(C, regime_final);
  const dirCol   = REGIME_COL(C, regime_directional);
  const gateActive = Math.abs(fat_tail_gate - 1.0) > 0.05; // fat-tail actually doing something
  const maxContrib = Math.max(...Object.values(contributions).map(c => Math.abs(c.contribution)), 0.01);

  // Ordered by absolute contribution descending
  const sortedContribs = Object.entries(contributions)
    .sort((a, b) => Math.abs(b[1].contribution) - Math.abs(a[1].contribution));

  return (
    <Card accent={finalCol}>
      {/* ── Top row: score + regime ── */}
      <div style={{display:"flex",alignItems:"flex-start",gap:20,flexWrap:"wrap",marginBottom:18}}>
        <div style={{flex:"0 0 auto",minWidth:160}}>
          <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:2}}>
            Composite Score
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
            <span style={mono(32,finalCol,800)}>
              {score_final >= 0 ? "+" : ""}{score_final.toFixed(3)}
            </span>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{...mono(11,finalCol,700),padding:"2px 8px",borderRadius:4,
                background:`${finalCol}18`,border:`1px solid ${finalCol}30`}}>
                {regime_final}
              </span>
              {gateActive && (
                <span style={{...mono(8,C.amb),padding:"1px 6px",borderRadius:4,
                  background:`${C.amb}12`,border:`1px solid ${C.amb}25`}}>
                  tail-gated ×{fat_tail_gate.toFixed(2)}
                </span>
              )}
            </div>
          </div>
          <ScoreGauge score={score_final} col={finalCol} C={C}/>
        </div>

        {/* Stage 1 vs Stage 2 */}
        {gateActive && (
          <div style={{flex:"0 0 auto",paddingLeft:20,borderLeft:`1px solid ${C.bdr}`}}>
            <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:6}}>
              Two-Stage Breakdown
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={mono(9,C.mut)}>Stage 1 · Directional</span>
                <span style={mono(11,dirCol,700)}>
                  {score_directional >= 0 ? "+" : ""}{score_directional.toFixed(3)}
                </span>
                <span style={{...mono(9,dirCol),padding:"1px 6px",borderRadius:3,
                  background:`${dirCol}18`}}>{regime_directional}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={mono(9,C.mut)}>Stage 2 · Fat-Tail Gate</span>
                <span style={mono(11,C.amb,700)}>×{fat_tail_gate.toFixed(2)}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={mono(9,C.mut)}>Final Score</span>
                <span style={mono(11,finalCol,700)}>
                  {score_final >= 0 ? "+" : ""}{score_final.toFixed(3)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Regime description */}
        <div style={{flex:1,minWidth:180}}>
          <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:4}}>
            What This Means
          </div>
          <div style={{...mono(10,C.txt),lineHeight:1.8}}>{REGIME_DESC[regime_final]}</div>
        </div>
      </div>

      {/* ── Contribution breakdown ── */}
      <div style={{...mono(8,C.mut),textTransform:"uppercase",letterSpacing:"0.11em",marginBottom:8}}>
        Signal Contributions to Directional Score
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {sortedContribs.map(([sigId, c]) => {
          const contribCol = c.contribution >= 0 ? C.grn : C.red;
          return (
            <div key={sigId}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                <span style={{...mono(9,C.txt),flex:"0 0 180px",whiteSpace:"nowrap",overflow:"hidden",
                  textOverflow:"ellipsis"}}>
                  {SIG_DISPLAY_NAMES[sigId]}
                </span>
                <span style={{...mono(8,C.mut),flex:"0 0 52px",textAlign:"right"}}>
                  w = {(c.weight*100).toFixed(0)}%
                </span>
                <span style={{...mono(8,C.mut),flex:"0 0 60px",textAlign:"right"}}>
                  norm {c.normalized >= 0 ? "+" : ""}{c.normalized.toFixed(3)}
                </span>
                <span style={{...mono(9,contribCol,700),flex:"0 0 60px",textAlign:"right"}}>
                  {c.contribution >= 0 ? "+" : ""}{c.contribution.toFixed(3)}
                </span>
              </div>
              <ContribBar value={c.contribution} maxAbs={maxContrib} col={C.grn} C={C}/>
            </div>
          );
        })}

        {/* Fat-tail row — shown separately as gate */}
        <div style={{borderTop:`1px solid ${C.bdr}`,paddingTop:8,marginTop:2}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
            <span style={{...mono(9,C.mut),flex:"0 0 180px"}}>Fat-Tail Risk (gate)</span>
            <span style={{...mono(8,C.mut),flex:"0 0 52px",textAlign:"right"}}>mult.</span>
            <span style={{...mono(8,C.mut),flex:"0 0 60px",textAlign:"right"}}>
              ×{fat_tail_gate.toFixed(3)}
            </span>
            <span style={{...mono(9,C.amb,700),flex:"0 0 60px",textAlign:"right"}}>
              {gateActive ? `${((1-fat_tail_gate)*100).toFixed(0)}% reduced` : "no reduction"}
            </span>
          </div>
          <div style={{height:6,background:C.dim,borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${fat_tail_gate*100}%`,
              background:`linear-gradient(to right, ${C.red}, ${C.grn})`,
              borderRadius:3,transition:"width .5s ease"}}/>
          </div>
        </div>
      </div>

      {/* ── Weight rationale (collapsible) ── */}
      <button onClick={()=>setShowRationale(r=>!r)}
        style={{...mono(8,C.mut),background:"transparent",border:`1px solid ${C.bdr}`,
          borderRadius:5,padding:"3px 10px",cursor:"pointer",marginTop:14,display:"flex",
          alignItems:"center",gap:5}}>
        {showRationale ? "▲" : "▼"} Weight rationale & academic references
      </button>
      {showRationale && (
        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
          {sortedContribs.map(([sigId, c]) => (
            <div key={sigId} style={{padding:"8px 10px",borderRadius:6,
              background:C.dim,border:`1px solid ${C.bdr}`}}>
              <div style={{...mono(8,C.grn,700),marginBottom:3}}>
                {SIG_DISPLAY_NAMES[sigId]} · {(c.weight*100).toFixed(0)}% weight
              </div>
              <div style={{...mono(9,C.mut),lineHeight:1.7}}>{c.rationale}</div>
            </div>
          ))}
          <div style={{padding:"8px 10px",borderRadius:6,background:C.dim,border:`1px solid ${C.bdr}`}}>
            <div style={{...mono(8,C.amb,700),marginBottom:3}}>
              Fat-Tail Risk · Multiplicative gate
            </div>
            <div style={{...mono(9,C.mut),lineHeight:1.7}}>{fat_tail_rationale}</div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalsView — main page
// ─────────────────────────────────────────────────────────────────────────────
function SignalsView() {
  const C   = useC();
  const TT  = makeTT(C);

  const [projects,    setProjects]   = useState([]);
  const [selProject,  setSelProject] = useState(null);
  const [symbol,      setSymbol]     = useState("SPY");
  const [jobId,       setJobId]      = useState(null);
  const [jobStatus,   setJobStatus]  = useState(null);  // null|pending|running|complete|failed
  const [results,     setResults]    = useState(null);
  const [selSig,      setSelSig]     = useState("conditional_probability");
  const [selTab,      setSelTab]     = useState("plain");  // plain|math
  const [pollActive,  setPollActive] = useState(false);
  const [mlSig,       setMlSig]      = useState(null);
  const [sentiment,   setSentiment]  = useState(null);
  const [mlLoading,   setMlLoading]  = useState(false);

  // Fetch projects once on mount
  useEffect(() => {
    fetch("/api/projects")
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : (d.projects || []);
        setProjects(list);
        if (list.length > 0) setSelProject(list[0].id);
      })
      .catch(() => {});
  }, []);

  // Polling loop
  useEffect(() => {
    if (!jobId || !pollActive) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/signals/reading/${jobId}`);
        const d = await r.json();
        setJobStatus(d.status);
        if (d.status === "complete") {
          setPollActive(false);
          if (d.results) setResults(d.results);
        } else if (d.status === "failed") {
          setPollActive(false);
        }
      } catch(_) {}
    }, 1500);
    return () => clearInterval(iv);
  }, [jobId, pollActive]);

  // Auto-fetch ML signal + sentiment whenever symbol changes (800ms debounce)
  useEffect(() => {
    if (!symbol) return;
    setMlSig(null); setSentiment(null);
    const t = setTimeout(async () => {
      setMlLoading(true);
      try {
        const [mr, sr] = await Promise.all([
          fetch("/api/ml/signal", {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({symbol, lookback_days:504, horizon_days:5, project_id:selProject||null}),
          }),
          fetch(`/api/sentiment/${symbol}`),
        ]);
        if (mr.ok) setMlSig(await mr.json());
        if (sr.ok) setSentiment(await sr.json());
      } catch(_) {}
      setMlLoading(false);
    }, 800);
    return () => clearTimeout(t);
  }, [symbol]);

  const analyze = async () => {
    if (pollActive) return;
    setResults(null);
    setJobStatus("pending");
    setPollActive(false);
    try {
      // Use project-based endpoint when a project exists; otherwise quick mode
      // (quick mode fetches data on-the-fly — no pre-built project needed)
      const url = selProject
        ? `/api/projects/${selProject}/signals/reading`
        : `/api/signals/quick`;
      const r = await fetch(url, {
        method:  "POST",
        headers: {"Content-Type":"application/json"},
        body:    JSON.stringify({symbol: symbol.trim().toUpperCase()}),
      });
      const d = await r.json();
      if (d.job_id) {
        setJobId(d.job_id);
        setPollActive(true);
      }
    } catch(_) {}
  };

  const meta     = SIG_META.find(s => s.id === selSig);
  const reading  = results?.readings?.[selSig];
  const isRunning = pollActive || jobStatus === "pending" || jobStatus === "running";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>

      {/* ── Header ── */}
      <div style={{display:"flex",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
        <div>
          <Lbl>Signal Dashboard</Lbl>
          <div style={mono(11,C.mut)}>
            Live readings · 5 modular signals · powered by real feature data
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {/* Project selector — always show when projects loaded */}
          {projects.length > 0 && (
            <select value={selProject||""} onChange={e=>setSelProject(e.target.value)}
              style={{...mono(10,C.txt),background:C.surf,border:`1px solid ${C.bdr}`,
                borderRadius:6,padding:"5px 8px",cursor:"pointer",maxWidth:240}}>
              {projects.map(p=>(
                <option key={p.id} value={p.id}>
                  {p.name} · {(p.symbols||[]).slice(0,3).join(",")}
                  {(p.symbols||[]).length > 3 ? `+${p.symbols.length-3}` : ""}
                </option>
              ))}
            </select>
          )}
          {/* Symbol input */}
          <input
            value={symbol}
            onChange={e=>setSymbol(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter" && analyze()}
            placeholder="Ticker…"
            style={{...mono(10,C.txt),background:C.surf,border:`1px solid ${C.bdr}`,
              borderRadius:6,padding:"5px 8px",width:100,outline:"none"}}/>
          {/* Analyze */}
          <SpinRing active={isRunning}>
          <button onClick={analyze} disabled={isRunning}
            style={{...mono(10, isRunning ? C.mut : C.bg, 700),
              background: isRunning ? C.dim : C.grn,
              border:"none",borderRadius:6,padding:"6px 16px",
              cursor: !isRunning ? "pointer" : "not-allowed",
              transition:"background .15s", display:"flex",alignItems:"center",gap:6}}>
            {isRunning && <RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>}
            {isRunning ? "Analyzing…" : "Analyze"}
          </button>
          </SpinRing>
        </div>
      </div>

      {/* No project — quick mode notice */}
      {!selProject && !isRunning && !results && jobStatus !== "failed" && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"36px 0",lineHeight:2}}>
            Enter a ticker and click <strong style={{color:C.txt}}>Analyze</strong> to run all 5 signals.<br/>
            <span style={mono(9,C.mut)}>Quick mode — fetches data on-the-fly · 20–40 s</span>
          </div>
        </Card>
      )}

      {/* Loading */}
      {isRunning && (
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:10,...mono(11,C.mut),padding:"22px 0"}}>
            <RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/>
            Running 5 signals against <strong style={{color:C.txt}}>{symbol}</strong> feature data — this takes 10–30 seconds…
          </div>
          <div style={{marginTop:8,height:3,borderRadius:2,background:C.dim,overflow:"hidden",position:"relative"}}>
            <div style={{position:"absolute",top:0,left:0,height:"100%",width:"40%",
              background:C.grn,borderRadius:2,
              animation:"shimmer 1.6s ease-in-out infinite"}}/>
          </div>
        </Card>
      )}

      {/* Error */}
      {jobStatus === "failed" && !isRunning && (
        <Card>
          <div style={mono(10,C.red)}>
            ⚠ Signal computation failed. Make sure features are computed for this project.
          </div>
        </Card>
      )}

      {/* Empty prompt (project exists) */}
      {!results && !isRunning && selProject && jobStatus !== "failed" && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"40px 0",lineHeight:2}}>
            Enter a ticker and click <strong style={{color:C.txt}}>Analyze</strong> to run all 5 signals<br/>
            against real historical feature data for that symbol.
          </div>
        </Card>
      )}

      {/* ── Results ── */}
      {results && !isRunning && (
        <>
          {/* Tier 1 — Signal Pulse */}
          <div>
            <SectionSep label={`Signal Pulse · ${results.symbol} · ${new Date(results.computed_at).toLocaleTimeString()}`}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(188px,1fr))",
              gap:10,marginTop:8}}>
              {SIG_META.map(m => (
                <SigPulseCard key={m.id} meta={m} reading={results.readings[m.id]}
                  selected={selSig===m.id} onClick={()=>setSelSig(m.id)}/>
              ))}
            </div>
          </div>

          {/* Tier 1.5 — Composite Score */}
          {results.composite && (
            <div>
              <SectionSep label="Weighted Composite Score"/>
              <div style={{marginTop:8}}>
                <CompositeScorePanel composite={results.composite} C={C}/>
              </div>
            </div>
          )}

          {/* Tier 2 — Signal Detail */}
          {meta && (
            <div>
              <SectionSep label={`Signal Detail · ${meta.label}`}/>
              {/* Tab bar */}
              <div style={{display:"flex",gap:8,margin:"10px 0 12px"}}>
                {[["plain","Plain English"],["math","Math & Code"]].map(([id,lbl]) => (
                  <button key={id} onClick={()=>setSelTab(id)}
                    style={{...mono(9, selTab===id ? C.bg : C.mut, selTab===id ? 700 : 400),
                      background: selTab===id ? meta.col : "transparent",
                      border:`1px solid ${selTab===id ? meta.col : C.bdr}`,
                      borderRadius:6, padding:"4px 14px", cursor:"pointer",
                      transition:"background .15s, color .15s"}}>
                    {lbl}
                  </button>
                ))}
              </div>
              {selTab === "plain" && (
                <PlainEnglishPanel meta={meta} reading={reading}
                  symbol={results.symbol} C={C}/>
              )}
              {selTab === "math" && (
                <MathPanel meta={meta} reading={reading} C={C} TT={TT}/>
              )}
            </div>
          )}

          {/* Tier 3 — Consensus */}
          {results.consensus && (
            <div>
              <SectionSep label="Signal Consensus"/>
              <div style={{marginTop:8}}>
                <ConsensusPanel consensus={results.consensus} C={C}/>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ML Signal + Sentiment (always loads when symbol set) ── */}
      {(mlSig || sentiment || mlLoading) && (
        <div>
          <SectionSep label={`ML Signal + Market Sentiment · ${symbol}`}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>

            {/* GBM ML Signal Card */}
            <Card>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:22,height:22,borderRadius:6,background:`${C.pur}18`,border:`1px solid ${C.pur}30`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Cpu size={12} style={{color:C.pur}}/>
                </div>
                <span style={mono(11,C.headingTxt,700)}>GBM ML Signal</span>
                {mlLoading && <RefreshCw size={11} style={{color:C.mut,animation:"spin 1s linear infinite",marginLeft:"auto"}}/>}
              </div>
              {mlSig && !mlLoading ? (<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
                  <Stat label="Direction" value={mlSig.signal_label||"—"}
                    color={mlSig.signal===1?C.grn:mlSig.signal===-1?C.red:C.mut}/>
                  <Stat label="P(Up)" value={mlSig.p_up!=null?`${(mlSig.p_up*100).toFixed(1)}%`:"—"}
                    color={mlSig.p_up>0.55?C.grn:mlSig.p_up<0.45?C.red:C.mut}/>
                  <Stat label="WF Accuracy" value={mlSig.walk_fwd_accuracy!=null?`${(mlSig.walk_fwd_accuracy*100).toFixed(1)}%`:"—"}
                    color={C.sky}/>
                </div>
                {mlSig.blurb && (
                  <div style={{...mono(9,C.mut),padding:"8px 10px",borderRadius:6,background:C.dim,lineHeight:1.7,borderLeft:`3px solid ${C.pur}`,marginBottom:10}}>
                    {mlSig.blurb}
                  </div>
                )}
                {mlSig.feature_importance && Object.keys(mlSig.feature_importance).length > 0 && (
                  <div>
                    <div style={{...mono(8,C.mut,700),marginBottom:5,letterSpacing:"0.08em"}}>TOP FEATURES</div>
                    {Object.entries(mlSig.feature_importance).slice(0,4).map(([k,v])=>(
                      <div key={k} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{...mono(9,C.txt),width:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0}}>{k}</span>
                        <div style={{flex:1,height:4,background:C.dim,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${Math.min(100,Math.round(v*100))}%`,height:"100%",background:C.pur,opacity:0.8}}/>
                        </div>
                        <span style={{...mono(9,C.pur,600),width:36,textAlign:"right"}}>{(v*100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </>) : (!mlLoading && (
                <div style={{...mono(10,C.mut),padding:"20px 0",textAlign:"center"}}>
                  No ML signal — features needed
                </div>
              ))}
            </Card>

            {/* Sentiment Card */}
            <Card>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:22,height:22,borderRadius:6,background:`${C.sky}18`,border:`1px solid ${C.sky}30`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Network size={12} style={{color:C.sky}}/>
                </div>
                <span style={mono(11,C.headingTxt,700)}>News Sentiment</span>
              </div>
              {sentiment ? (<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
                  <Stat label="Score" value={sentiment.score!=null?sentiment.score.toFixed(3):"—"}
                    color={sentiment.score>0.1?C.grn:sentiment.score<-0.1?C.red:C.mut}/>
                  <Stat label="Signal" value={sentiment.label||"—"}
                    color={sentiment.score>0.1?C.grn:sentiment.score<-0.1?C.red:C.mut}/>
                  <Stat label="Articles" value={(sentiment.article_count||0).toString()} color={C.sky}/>
                </div>
                {sentiment.momentum!=null && (
                  <div style={{...mono(9,C.mut),marginBottom:10}}>
                    Momentum: <span style={{color:sentiment.momentum>0.02?C.grn:sentiment.momentum<-0.02?C.red:C.mut,fontWeight:700}}>
                      {sentiment.momentum>0?"+":""}{sentiment.momentum.toFixed(3)}
                    </span>
                    <span style={{marginLeft:8}}>
                      {sentiment.momentum>0.05?"↑ Accelerating":sentiment.momentum<-0.05?"↓ Declining":"→ Stable"}
                    </span>
                  </div>
                )}
                {sentiment.headlines?.length > 0 && (
                  <div>
                    <div style={{...mono(8,C.mut,700),marginBottom:5,letterSpacing:"0.08em"}}>RECENT HEADLINES</div>
                    {sentiment.headlines.slice(0,3).map((h,i)=>(
                      <div key={i} style={{...mono(9,C.mut),marginBottom:5,padding:"5px 8px",borderRadius:4,
                        background:C.dim,lineHeight:1.5,
                        borderLeft:`2px solid ${h.score>0.05?C.grn:h.score<-0.05?C.red:C.bdr}`}}>
                        {h.title}
                      </div>
                    ))}
                  </div>
                )}
              </>) : mlLoading ? (
                <div style={{...mono(10,C.mut),padding:"20px 0",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/> Loading sentiment…
                </div>
              ) : (
                <div style={{...mono(10,C.mut),padding:"20px 0",textAlign:"center"}}>No sentiment data</div>
              )}
            </Card>

          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(150%); }
        }
      `}</style>
    </div>
  );
}

// ── News Feed ─────────────────────────────────────────────

const NEWS_TAG_COLORS = {
  "Fed/Rates":   "#40c4ff",
  "Earnings":    "#00e676",
  "Macro":       "#b388ff",
  "M&A":         "#ffb300",
  "Analyst":     "#c8c8da",
  "Commodities": "#ffb300",
  "Technology":  "#40c4ff",
  "Finance":     "#00e676",
  "Crypto":      "#b388ff",
  "Geopolitical":"#ff5252",
  "Markets":     "#56566e",
};

function NewsCard({article}) {
  const C = useC();
  const sc = article.score;
  const scoreColor = sc > 0.15 ? C.grn : sc < -0.15 ? C.red : C.mut;
  const scoreArrow = sc > 0.15 ? "▲" : sc < -0.15 ? "▼" : "●";
  return (
    <div style={{
      background: C.surf,
      border: `1px solid ${C.bdr}`,
      borderLeft: `3px solid ${scoreColor}55`,
      borderRadius: 10,
      padding: "13px 16px",
    }}>
      {/* Meta row: tags · score · source · time */}
      <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:5,marginBottom:8}}>
        {article.tags.map(tag=>(
          <span key={tag} style={{
            padding:"2px 7px", borderRadius:4,
            background:(NEWS_TAG_COLORS[tag]||C.mut)+"18",
            color: NEWS_TAG_COLORS[tag]||C.mut,
            ...mono(9,"inherit",700), letterSpacing:"0.05em", textTransform:"uppercase",
          }}>{tag}</span>
        ))}
        <span style={{marginLeft:"auto",...mono(10,scoreColor,700)}}>{scoreArrow} {sc>=0?"+":""}{sc.toFixed(2)}</span>
        <span style={mono(9,C.mut)}>·</span>
        <span style={mono(9,C.mut,500)}>{article.source}</span>
        <span style={mono(9,C.mut)}>·</span>
        <span style={mono(9,C.mut)}>{article.rel_time}</span>
      </div>
      {/* Title — clickable link */}
      <a href={article.url} target="_blank" rel="noreferrer" style={{
        ...mono(13,C.headingTxt,700), textDecoration:"none", lineHeight:1.45,
        display:"block", marginBottom:article.summary ? 7 : 0,
      }}>
        {article.title}
      </a>
      {/* Synopsis */}
      {article.summary && (
        <p style={{...mono(11,C.mut), lineHeight:1.7, margin:"0 0 8px 0"}}>
          {article.summary}
        </p>
      )}
      <a href={article.url} target="_blank" rel="noreferrer"
        style={{...mono(10,C.grn,600), textDecoration:"none", opacity:0.75}}>
        Read article →
      </a>
    </div>
  );
}

// ── Daily Summary Tile ───────────────────────────────────
function DailySummaryTile() {
  const C = useC();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [expanded,   setExpanded]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force=false) => {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const url = force ? "/api/feeds/daily-summary/refresh" : "/api/feeds/daily-summary";
      const r = await fetch(url, force ? {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"} : undefined);
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch(e) { setError(e.message); }
    setLoading(false); setRefreshing(false);
  };

  useEffect(()=>{ load(); }, []);

  const sentColor = data?.sentiment === "bullish" ? C.grn
                  : data?.sentiment === "bearish" ? C.red : C.amb;

  if (loading) return (
    <div style={{padding:"20px",borderRadius:12,background:C.surf,border:`1px solid ${C.bdr}`,
      display:"flex",alignItems:"center",gap:10,...mono(10,C.mut)}}>
      <RefreshCw size={13} style={{animation:"spin 1s linear infinite",color:C.mut}}/>
      Generating today's market summary…
    </div>
  );

  if (error || !data) return (
    <div style={{padding:"14px 16px",borderRadius:12,background:C.surf,border:`1px solid ${C.bdr}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={mono(9,C.mut)}>DAILY SUMMARY — unavailable</div>
        <button onClick={()=>load(true)} style={{...mono(8,C.sky),background:"transparent",border:"none",cursor:"pointer"}}>↺ Retry</button>
      </div>
      {error && <div style={{...mono(9,C.red),marginTop:4}}>{error}</div>}
    </div>
  );

  const paras = data.paragraphs || [];
  const visibleParas = expanded ? paras : paras.slice(0,2);

  return (
    <div style={{borderRadius:12,overflow:"hidden",background:C.surf,
      border:`1px solid ${C.bdr}`,borderLeft:`3px solid ${sentColor}`}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",
        borderBottom:`1px solid ${C.bdr}`,flexWrap:"wrap"}}>
        <div style={mono(8,C.mut,700,{letterSpacing:1})}>DAILY MARKET SUMMARY</div>
        <div style={{padding:"2px 9px",borderRadius:20,background:sentColor+"20",
          border:`1px solid ${sentColor}40`,...mono(8,sentColor,700)}}>
          {(data.sentiment||"neutral").toUpperCase()}
        </div>
        <div style={{...mono(8,C.mut),marginLeft:4}}>
          {data.article_count} articles · {(data.sources_used||[]).length} sources
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          {data.cached && <span style={mono(8,C.mut)}>cached</span>}
          <SpinRing active={refreshing} radius={6}>
          <button onClick={()=>load(true)} disabled={refreshing}
            style={{...mono(8,C.sky,700),background:"transparent",border:`1px solid ${C.sky}30`,
              borderRadius:6,padding:"2px 8px",cursor:"pointer"}}>
            {refreshing ? "…" : "↺ Refresh"}
          </button>
          </SpinRing>
        </div>
      </div>

      {/* Theme line */}
      <div style={{padding:"10px 16px 4px",...mono(11,C.headingTxt,700),lineHeight:1.4}}>
        {data.theme}
      </div>

      {/* Top tags */}
      {(data.top_tags||[]).length > 0 && (
        <div style={{display:"flex",gap:5,padding:"4px 16px 10px",flexWrap:"wrap"}}>
          {data.top_tags.map(tag=>(
            <span key={tag} style={{...mono(8,NEWS_TAG_COLORS[tag]||C.mut,600),
              padding:"1px 7px",borderRadius:10,background:(NEWS_TAG_COLORS[tag]||C.mut)+"15",
              border:`1px solid ${(NEWS_TAG_COLORS[tag]||C.mut)}25`}}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Paragraphs */}
      <div style={{padding:"0 16px 12px",display:"flex",flexDirection:"column",gap:10}}>
        {visibleParas.map((p,i)=>(
          <div key={i} style={{...mono(10,i===0?C.txt:C.mut),lineHeight:1.7,
            paddingLeft:10,borderLeft:`2px solid ${i===0?sentColor:C.bdr}`}}>
            {p}
          </div>
        ))}

        {paras.length > 2 && (
          <button onClick={()=>setExpanded(!expanded)}
            style={{...mono(9,C.sky),background:"transparent",border:"none",
              cursor:"pointer",textAlign:"left",padding:"2px 0"}}>
            {expanded ? "▲ Show less" : `▼ Show all ${paras.length} sections`}
          </button>
        )}
      </div>

      {/* Footer */}
      {data.generated_at && (
        <div style={{...mono(8,C.mut),padding:"6px 16px",borderTop:`1px solid ${C.bdr}`,
          background:C.dim}}>
          Generated {new Date(data.generated_at).toLocaleString()} UTC
          {(data.sources_used||[]).length > 0 && (
            <span style={{marginLeft:8,color:C.mut}}>
              · {data.sources_used.slice(0,4).join(", ")}{data.sources_used.length>4?` +${data.sources_used.length-4} more`:""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Feeds View (upgraded News tab) ───────────────────────
function FeedsView() {
  const C = useC();
  const [activeCategory, setActiveCategory] = useState("all");
  const [articles,       setArticles]       = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [activeTag,      setActiveTag]      = useState("All");
  const [error,          setError]          = useState(null);
  const [lastFetch,      setLastFetch]      = useState(null);
  const [sourceCounts,   setSourceCounts]   = useState({});

  // Symbol search (legacy compat — hits original /news/feed endpoint)
  const [input,   setInput]   = useState("");
  const [symMode, setSymMode] = useState(false);  // true = searching a ticker

  const CATEGORIES = [
    {id:"all",         label:"All Sources"},
    {id:"Markets",     label:"Markets"},
    {id:"Technology",  label:"Technology"},
    {id:"Economy",     label:"Economy"},
    {id:"Earnings",    label:"Earnings"},
    {id:"Commodities", label:"Commodities"},
  ];

  const loadFeeds = async (cat="all") => {
    setLoading(true); setError(null); setSymMode(false);
    try {
      const r = await fetch(`/api/feeds?category=${encodeURIComponent(cat)}&limit=100`);
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setArticles(d.articles || []);
      setSourceCounts(d.source_counts || {});
      setLastFetch(new Date().toLocaleTimeString());
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const searchSymbol = async () => {
    const sym = input.trim().toUpperCase() || "market";
    setLoading(true); setError(null); setSymMode(true); setActiveTag("All");
    try {
      const r = await fetch(`/api/news/feed?symbol=${encodeURIComponent(sym)}&limit=60`);
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setArticles(d.articles || []);
      setSourceCounts({});
      setLastFetch(new Date().toLocaleTimeString());
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  useEffect(()=>{ loadFeeds("all"); }, []);

  const allTags = useMemo(()=>{
    const counts = {};
    articles.forEach(a => (a.tags||[]).forEach(t => { counts[t]=(counts[t]||0)+1; }));
    return ["All", ...Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([t])=>t)];
  }, [articles]);

  const filtered = activeTag==="All" ? articles : articles.filter(a=>(a.tags||[]).includes(activeTag));

  const bullCount = articles.filter(a=>a.score>0.1).length;
  const bearCount = articles.filter(a=>a.score<-0.1).length;
  const neutCount = articles.length - bullCount - bearCount;
  const avgScore  = articles.length
    ? (articles.reduce((s,a)=>s+a.score,0)/articles.length).toFixed(2) : "—";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Daily Summary Tile */}
      <DailySummaryTile/>

      {/* Header + symbol search */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div>
          <Lbl>Market Feeds</Lbl>
          <div style={mono(11,C.mut)}>Multi-source financial news · RSS aggregated · sentiment-scored & tagged</div>
        </div>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          <input value={input} onChange={e=>setInput(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter"&&searchSymbol()}
            placeholder="Search ticker (AAPL, SPY…)"
            style={{padding:"7px 12px",borderRadius:8,border:`1.5px solid ${C.grn}55`,
              background:C.surf,color:C.headingTxt,...mono(12),outline:"none",
              width:200,boxSizing:"border-box"}}/>
          <SpinRing active={loading}>
          <button onClick={searchSymbol} disabled={loading}
            style={{padding:"7px 14px",borderRadius:8,background:loading?C.dim:C.grn,
              color:loading?C.mut:"#000",...mono(11,loading?C.mut:"#000",700),
              border:"none",cursor:loading?"not-allowed":"pointer",
              opacity:loading?0.7:1,transition:"all .15s",minWidth:80}}>
            {loading ? "Searching…" : "Search"}
          </button>
          </SpinRing>
          <button onClick={()=>{ setInput(""); setSymMode(false); loadFeeds(activeCategory); }}
            title="Show all feeds"
            style={{padding:"7px 9px",borderRadius:8,background:"transparent",
              border:`1px solid ${C.bdr}`,cursor:"pointer",lineHeight:0}}>
            <RefreshCw size={13} style={{color:C.mut}}/>
          </button>
        </div>
      </div>

      {/* Category tabs (hidden in symbol-search mode) */}
      {!symMode && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {CATEGORIES.map(({id,label})=>(
            <button key={id} onClick={()=>{ setActiveCategory(id); setActiveTag("All"); loadFeeds(id); }}
              style={{...mono(10,activeCategory===id?C.sky:C.mut,activeCategory===id?700:400),
                padding:"5px 14px",borderRadius:20,cursor:"pointer",
                border:`1px solid ${activeCategory===id?C.sky+"60":C.bdr}`,
                background: activeCategory===id?C.sky+"15":"transparent",transition:"all .15s"}}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Source breakdown chips */}
      {!symMode && Object.keys(sourceCounts).length > 0 && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={mono(8,C.mut)}>Sources:</span>
          {Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).map(([src,cnt])=>(
            <span key={src} style={{...mono(8,C.mut),padding:"2px 8px",borderRadius:10,
              background:C.dim,border:`1px solid ${C.bdr}`}}>
              {src} <span style={{color:C.sky}}>{cnt}</span>
            </span>
          ))}
        </div>
      )}

      {/* Sentiment strip */}
      {articles.length>0 && (
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {[{l:"Bullish",n:bullCount,c:C.grn},{l:"Neutral",n:neutCount,c:C.mut},{l:"Bearish",n:bearCount,c:C.red}].map(({l,n,c})=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",
              borderRadius:6,background:c+"10",border:`1px solid ${c}20`}}>
              <span style={mono(12,c,700)}>{n}</span>
              <span style={mono(10,C.mut)}>{l}</span>
            </div>
          ))}
          <span style={{...mono(10,C.mut),marginLeft:4}}>{articles.length} articles</span>
          <span style={mono(10,C.mut)}>·</span>
          <span style={mono(10,C.mut)}>avg score: <span style={{color:parseFloat(avgScore)>0?C.grn:parseFloat(avgScore)<0?C.red:C.mut}}>{avgScore>0?"+":""}{avgScore}</span></span>
          {lastFetch && <span style={{...mono(9,C.mut),marginLeft:"auto"}}>fetched {lastFetch}</span>}
        </div>
      )}

      {/* Topic tag pills */}
      {articles.length>0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {allTags.map(tag=>{
            const tagColor = NEWS_TAG_COLORS[tag]||C.mut;
            const isActive = activeTag===tag;
            return (
              <button key={tag} onClick={()=>setActiveTag(tag)} style={{
                padding:"4px 11px",borderRadius:6,cursor:"pointer",transition:"all .15s",
                border:`1px solid ${isActive?tagColor+"60":C.bdr}`,
                background:isActive?tagColor+"18":"transparent",
                color:isActive?tagColor:C.mut,...mono(10,"inherit",600)}}>
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{padding:12,borderRadius:8,background:C.red+"12",border:`1px solid ${C.red}30`,...mono(11,C.red)}}>
          ⚠ {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{display:"flex",justifyContent:"center",padding:48}}>
          <RefreshCw size={22} style={{color:C.grn,animation:"spin 1s linear infinite"}}/>
        </div>
      )}

      {/* Articles */}
      {!loading && filtered.map((a,i)=>(
        <NewsCard key={i} article={{...a,
          source: a.source + (a.category && a.category!=="all" ? ` · ${a.category}` : "")
        }}/>
      ))}

      {!loading && filtered.length===0 && !error && (
        <div style={{textAlign:"center",padding:48,...mono(12,C.mut)}}>
          {articles.length===0 ? "Loading feeds…" : "No articles match this filter."}
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Portfolio Optimizer ───────────────────────────────────

function OptimizeView() {
  const C = useC();
  const TT = makeTT(C);

  const [tickers,  setTickers]  = useState("SPY,QQQ,IWM,TLT,GLD");
  const [riskAv,   setRiskAv]   = useState("2.5");
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const syms = tickers.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
      const n = syms.length;
      const holdings = syms.map(t=>({ticker:t, weight:1/n}));
      const r = await fetch("/api/portfolio/optimize/bl", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({holdings, risk_aversion:parseFloat(riskAv)||2.5, tau:0.05, signal_scores:{}}),
      });
      if (!r.ok) throw new Error(friendlyError(await r.text()));
      setResult(await r.json());
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const live  = !!result;
  const wts   = live ? result.weights : {SPY:0.35,QQQ:0.22,IWM:0.13,TLT:0.18,GLD:0.12};
  const sorted = Object.entries(wts).sort(([,a],[,b])=>b-a);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div>
        <Lbl>Portfolio Optimizer</Lbl>
        <div style={mono(11,C.mut)}>Black-Litterman · Market equilibrium prior · Markowitz mean-variance</div>
      </div>

      {/* Config card */}
      <Card>
        <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"2fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <Lbl>Assets (comma-separated)</Lbl>
            <input value={tickers} onChange={e=>setTickers(e.target.value)} placeholder="SPY,QQQ,IWM,TLT,GLD"
              style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,
                background:C.dim,border:`1px solid ${C.grn}60`,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div>
            <Lbl>Risk Aversion λ</Lbl>
            <input value={riskAv} onChange={e=>setRiskAv(e.target.value)} placeholder="2.5"
              style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,
                background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/>
            <div style={{...mono(8,C.mut),marginTop:3}}>1 = aggressive · 3 = moderate · 5 = conservative</div>
          </div>
        </div>
        <SpinRing active={loading}>
        <button onClick={run} disabled={loading}
          style={{display:"flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:8,border:"none",
            cursor:loading?"not-allowed":"pointer",background:loading?C.dim:C.grn,
            color:loading?C.mut:"#000",...mono(12,loading?C.mut:"#000",700),transition:"all .15s"}}>
          {loading ? <><RefreshCw size={14} style={{animation:"spin 1s linear infinite"}}/>Optimizing…</> : <><Target size={14}/>Optimize Portfolio</>}
        </button>
        </SpinRing>
        {error && <div style={{marginTop:10,padding:10,borderRadius:8,background:C.red+"12",border:`1px solid ${C.red}30`,...mono(10,C.red)}}>⚠ {error}</div>}
      </Card>

      {/* ── Optimizer Synthesis ── */}
      {live && (() => {
        const ret    = result.portfolio_return  ?? 0;
        const vol    = result.portfolio_vol     ?? 0;
        const sharpe = result.portfolio_sharpe  ?? 0;
        const lambda = parseFloat(riskAv)       || 2.5;
        const topW   = sorted.length > 0 ? sorted[0][1] : 0;
        const topSym = sorted.length > 0 ? sorted[0][0] : "—";
        const hhi    = sorted.reduce((s, [,w]) => s + w * w, 0);
        const effNum = hhi > 0 ? (1 / hhi).toFixed(1) : "—";

        const bc = sharpe > 1.0 ? C.grn : sharpe > 0.5 ? C.amb : C.red;
        const verdict = sharpe > 1.0 && topW < 0.40
          ? "EFFICIENT"
          : sharpe > 0.5 && topW < 0.50
          ? "MODERATE"
          : topW >= 0.50
          ? "CONCENTRATED"
          : "UNDEROPTIMIZED";

        const riskDesc = lambda < 1.5 ? "aggressive" : lambda < 3 ? "moderate" : "conservative";
        const action = verdict === "EFFICIENT"
          ? `Black-Litterman achieves Sharpe ${sharpe.toFixed(2)} with ${(ret*100).toFixed(1)}% expected return at ${(vol*100).toFixed(1)}% vol. Effective diversification across ~${effNum} positions with ${topSym} as top weight at ${(topW*100).toFixed(1)}%. Allocations reflect a ${riskDesc} risk appetite (λ=${lambda}). Portfolio is suitable for deployment with quarterly rebalancing.`
          : verdict === "MODERATE"
          ? `Acceptable risk-adjusted return (Sharpe ${sharpe.toFixed(2)}) with room to improve. ${(ret*100).toFixed(1)}% expected return at ${(vol*100).toFixed(1)}% vol. Effective N ~${effNum} — consider adding low-correlation assets. Review λ=${lambda} (${riskDesc}) against your actual risk tolerance and adjust signals or priors.`
          : verdict === "CONCENTRATED"
          ? `Top holding ${topSym} at ${(topW*100).toFixed(1)}% creates tail risk. Effective N ~${effNum} is low. Consider adding uncorrelated assets, tightening weight caps below 40%, or raising λ to ${(lambda + 1).toFixed(1)} to penalise concentration more heavily.`
          : `Sharpe ${sharpe.toFixed(2)} indicates limited risk-adjusted edge. Try adding assets with stronger momentum or quality signals, lowering λ to ${Math.max(1, lambda - 1).toFixed(1)} for more return focus, or enriching the signal_scores input to shift BL posterior returns.`;

        return (
          <div style={{padding:"18px 20px",borderRadius:12,
            background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{...mono(9,C.mut,700),letterSpacing:".08em"}}>OPTIMIZER SYNTHESIS</div>
              <div style={{...mono(9,bc,700),padding:"2px 10px",borderRadius:99,
                background:bc+"18",border:`1px solid ${bc}40`}}>{verdict}</div>
            </div>
            <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:12}}>
              {`Sharpe ${sharpe.toFixed(2)} · Expected return ${(ret*100).toFixed(2)}% · Volatility ${(vol*100).toFixed(2)}% · Effective N ~${effNum} · Top weight ${topSym} ${(topW*100).toFixed(1)}% · λ=${lambda} (${riskDesc}).`}
            </div>
            <div style={{...mono(9,C.mut,600),letterSpacing:".06em",marginBottom:6}}>WHAT THIS INDICATES</div>
            <div style={{...mono(11,C.txt),lineHeight:1.8}}>{action}</div>
          </div>
        );
      })()}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"repeat(3,1fr)",gap:12}}>
        <Stat label="Expected Return (ann.)" value={live&&result.portfolio_return!=null?`${(result.portfolio_return*100).toFixed(2)}%`:"—"} color={C.grn} sub={live?"Black-Litterman posterior":"run optimizer"}/>
        <Stat label="Portfolio Volatility"   value={live&&result.portfolio_vol!=null?`${(result.portfolio_vol*100).toFixed(2)}%`:"—"}    color={C.amb} sub={live?"annualised":"run optimizer"}/>
        <Stat label="Sharpe Ratio"           value={live&&result.portfolio_sharpe!=null?result.portfolio_sharpe.toFixed(3):"—"}            color={C.sky} sub={live?"risk-free adj.":"run optimizer"}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"1fr 1fr",gap:16}}>
        {/* Weights bar chart */}
        <Card>
          <Lbl>{live?"Black-Litterman Optimal Weights":"Sample — Min Variance"}</Lbl>
          <div style={{marginTop:8}}>
            {sorted.map(([sym,w])=>{
              const pct = w*100;
              return (
                <div key={sym} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <span style={{...mono(12,C.txt,700),width:42}}>{sym}</span>
                  <div style={{flex:1,height:14,borderRadius:99,background:C.dim,border:`1px solid ${C.bdr}`,overflow:"hidden"}}>
                    <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:C.grn,opacity:0.78,borderRadius:99,transition:"width .6s"}}/>
                  </div>
                  <span style={{...mono(12,C.grn,700),width:44,textAlign:"right"}}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:12}}>
            <CodeBox>{"min   σ² = wᵀΣw\ns.t.  1ᵀw = 1\n      0 ≤ wᵢ ≤ 0.40\n      μᵀw ≥ r_target"}</CodeBox>
          </div>
        </Card>
        {/* Efficient frontier */}
        <Card>
          <Lbl>Efficient Frontier</Lbl>
          <ChartPanel title="Optimizer — Efficient Frontier" defaultHeight={280}>
          {(h)=>(
          <ResponsiveContainer width="100%" height={h}>
            <ScatterChart margin={{top:10,right:10,left:10,bottom:24}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="vol" name="Volatility %" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} label={{value:"Volatility %",fill:C.mut,fontSize:10,dy:18}}/>
              <YAxis dataKey="ret" name="Return %" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} label={{value:"Return %",fill:C.mut,fontSize:10,angle:-90,dx:-16}}/>
              <Tooltip {...TT} formatter={(v,n)=>[`${v}%`,n]}/>
              <Scatter data={FRONTIER} fill={C.grn} opacity={0.8} line={{stroke:C.grn,strokeWidth:1.5}} lineType="fitting" r={3.5}/>
              {live&&result.portfolio_vol!=null&&(
                <Scatter
                  data={[{vol:(result.portfolio_vol*100).toFixed(2), ret:(result.portfolio_return*100).toFixed(2)}]}
                  fill={C.amb} r={7} name="BL Optimal"
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
          )}
          </ChartPanel>
          {live&&<div style={{...mono(9,C.mut),marginTop:4}}>◆ = Black-Litterman optimal point</div>}
        </Card>
      </div>

      {/* BL returns comparison */}
      {live && result.equilibrium_returns && (
        <Card>
          <Lbl>Prior vs Posterior Returns — Black-Litterman Update</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:10}}>
            <div>
              <div style={{...mono(9,C.mut,700),marginBottom:8,letterSpacing:"0.06em"}}>EQUILIBRIUM (π) — CAPM prior</div>
              {Object.entries(result.equilibrium_returns).map(([sym,ret])=>(
                <KV key={sym} k={sym} v={`${(ret*100).toFixed(2)}%`} vc={ret>0?C.grn:C.red}/>
              ))}
            </div>
            <div>
              <div style={{...mono(9,C.mut,700),marginBottom:8,letterSpacing:"0.06em"}}>POSTERIOR (μ_BL) — updated estimate</div>
              {Object.entries(result.posterior_returns||{}).map(([sym,ret])=>(
                <KV key={sym} k={sym} v={`${(ret*100).toFixed(2)}%`} vc={ret>0?C.grn:C.red}/>
              ))}
            </div>
          </div>
          <div style={{marginTop:14}}>
            <CodeBox>{"μ_BL = [(τΣ)⁻¹ + PᵀΩ⁻¹P]⁻¹ · [(τΣ)⁻¹π + PᵀΩ⁻¹Q]\nπ = λΣw_mkt  (market implied returns)"}</CodeBox>
          </div>
        </Card>
      )}

      {/* Covariance estimators */}
      <Card>
        <Lbl>Covariance Estimators</Lbl>
        <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"1fr 1fr 1fr",gap:12,marginTop:8}}>
          {[
            {m:"Sample Cov",     d:"np.cov(R.T) — unbiased but noisy when p ≈ T",     a:true},
            {m:"Ledoit-Wolf",    d:"Shrinkage toward identity — reduces estimation error", a:false},
            {m:"Factor Model",   d:"Σ = BFBᵀ + D — exploits low-rank structure",       a:false},
          ].map(({m,d,a})=>(
            <div key={m} style={{padding:12,borderRadius:10,border:`1px solid ${a?C.grn+"40":C.bdr}`,background:a?C.grnBg:"transparent"}}>
              <div style={mono(11,a?C.grn:C.mut,700)}>{m}{a?" ✓":""}</div>
              <div style={{...mono(9,C.mut),marginTop:4,lineHeight:1.6}}>{d}</div>
            </div>
          ))}
        </div>
      </Card>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function StochasticView() {
  const C  = useC();
  const TT = makeTT(C);
  const [tab, setTab] = useState("gbm");

  const PC = ["#00e676","#40c4ff","#ffb300","#b388ff","#ff5252","#00bfa5","#7c4dff","#ff6d00","#f06292","#4dd0e1","#aed581","#ff8a65"];

  // ── Market context (shared across all tabs) ──
  const [ctxInput,   setCtxInput]   = useState("");
  const [ctxData,    setCtxData]    = useState(null);
  const [ctxLoading, setCtxLoading] = useState(false);

  // ── Position Sizing tab state ──
  const [sizeBull,   setSizeBull]   = useState("60");
  const [sizePort,   setSizePort]   = useState("100000");
  const [sizeOdds,   setSizeOdds]   = useState("1.5");

  // ── GBM state ──
  const [gbmMu,    setGbmMu]    = useState("0.08");
  const [gbmSigma, setGbmSigma] = useState("0.20");
  const [gbmS0,    setGbmS0]    = useState("100");
  const [gbmT,     setGbmT]     = useState("1");
  const [gbmN,     setGbmN]     = useState("12");
  const [gbmLoad,  setGbmLoad]  = useState(false);
  const [gbmRes,   setGbmRes]   = useState(null);

  const runGBM = async () => {
    setGbmLoad(true);
    try {
      const r = await fetch("/api/finance/gbm", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          mu:      parseFloat(gbmMu)||0.08,
          sigma:   parseFloat(gbmSigma)||0.20,
          s0:      parseFloat(gbmS0)||100,
          T:       parseFloat(gbmT)||1,
          n_steps: 52,
          n_paths: Math.min(parseInt(gbmN)||12, 50),
        }),
      });
      if (r.ok) setGbmRes(await r.json());
    } catch(_) {}
    setGbmLoad(false);
  };

  // Transform paths → [{t,p0,p1,...}]
  // ── Load real market data → auto-fill GBM & BS inputs ──
  const loadCtx = async () => {
    const sym = ctxInput.trim().toUpperCase();
    if (!sym) return;
    setCtxLoading(true);
    try {
      const r = await fetch(`/api/ta/${sym}?period=1y&interval=1d`);
      if (r.ok) {
        const d = await r.json();
        const price = d.current_price;
        // 30-day HV from log returns (annualised)
        const closes = (d.ohlcv || []).slice(-31).map(b => b.close).filter(Boolean);
        let hv30 = 0.20;
        if (closes.length > 2) {
          const logRets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
          const mean    = logRets.reduce((a, b) => a + b, 0) / logRets.length;
          const variance= logRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (logRets.length - 1);
          hv30 = Math.sqrt(variance * 252);
        }
        setCtxData({ sym, price, hv30 });
        // pre-fill GBM
        setGbmS0(price.toFixed(2));
        setGbmSigma(hv30.toFixed(3));
        // pre-fill BS
        setBsS(price.toFixed(2));
        setBsSig(hv30.toFixed(3));
        setBsK((Math.round(price / 5) * 5).toFixed(2));
      }
    } catch (_) {}
    setCtxLoading(false);
  };

  const nDisplay = Math.min(parseInt(gbmN)||8, 12);
  const gbmChart = useMemo(()=>{
    if (!gbmRes) return GBM;
    const paths = gbmRes.paths.slice(0, nDisplay);
    return paths[0].map((_,si)=>{
      const row = {t:si};
      paths.forEach((p,pi)=>{ row[`p${pi}`]=parseFloat(p[si].toFixed(2)); });
      return row;
    });
  }, [gbmRes, nDisplay]);

  // ── BS state ──
  const [bsS,    setBsS]    = useState("100");
  const [bsK,    setBsK]    = useState("100");
  const [bsT,    setBsT]    = useState("0.25");
  const [bsR,    setBsR]    = useState("0.05");
  const [bsSig,  setBsSig]  = useState("0.20");
  const [bsType, setBsType] = useState("call");
  const [bsLoad, setBsLoad] = useState(false);
  const [bsRes,  setBsRes]  = useState(null);

  const runBS = async () => {
    setBsLoad(true);
    try {
      const r = await fetch("/api/finance/options", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          S:           parseFloat(bsS)||100,
          K:           parseFloat(bsK)||100,
          T:           parseFloat(bsT)||0.25,
          r:           parseFloat(bsR)||0.05,
          sigma:       parseFloat(bsSig)||0.20,
          option_type: bsType,
        }),
      });
      if (r.ok) setBsRes(await r.json());
    } catch(_) {}
    setBsLoad(false);
  };

  // Auto-price on mount
  useEffect(()=>{ runBS(); }, []);

  const bs  = bsRes?.black_scholes;
  const mc  = bsRes?.monte_carlo;
  const mu  = parseFloat(gbmMu)||0.08;
  const sig = parseFloat(gbmSigma)||0.20;
  const s0  = parseFloat(gbmS0)||100;
  const T   = parseFloat(gbmT)||1;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div>
          <Lbl>Stochastic Finance Lab</Lbl>
          <div style={mono(11,C.mut)}>GBM simulator · Black-Scholes pricer · Position sizing</div>
        </div>
        {/* ── Symbol context bar ── */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input
            value={ctxInput} onChange={e=>setCtxInput(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter"&&loadCtx()}
            placeholder="Load symbol…"
            style={{...mono(11,C.txt),width:130,padding:"6px 10px",borderRadius:8,
              background:C.dim,border:`1px solid ${C.bdr}`,outline:"none"}}/>
          <SpinRing active={ctxLoading}>
          <button onClick={loadCtx} disabled={ctxLoading}
            style={{display:"flex",alignItems:"center",gap:5,padding:"6px 14px",borderRadius:8,
              border:`1px solid ${C.bdr}`,background:"transparent",cursor:"pointer",...mono(10,C.mut)}}>
            {ctxLoading
              ? <RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>
              : <Search size={11}/>}
            {ctxLoading ? "Loading…" : "Load"}
          </button>
          </SpinRing>
          {ctxData && (
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,
              border:`1px solid ${C.grn}25`,background:C.grnBg,...mono(10,C.grn)}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.grn}}/>
              {ctxData.sym} · ${ctxData.price.toFixed(2)} · HV30 {(ctxData.hv30*100).toFixed(1)}%
            </div>
          )}
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        {[["gbm","GBM Simulation"],["bs","Black-Scholes"],["sizing","Position Sizing"]].map(([id,l])=>(
          <Pill key={id} label={l} active={tab===id} onClick={()=>setTab(id)}/>
        ))}
      </div>

      {/* ── GBM TAB ── */}
      {tab==="gbm"&&(<>
        <Card>
          <Lbl>Parameters</Lbl>
          <div style={{display:"grid",gridTemplateColumns:C.isMobile?"repeat(3,1fr)":"repeat(5,1fr)",gap:10,marginTop:8,marginBottom:14}}>
            {[["μ drift",gbmMu,setGbmMu,"0.08"],["σ vol",gbmSigma,setGbmSigma,"0.20"],
              ["S₀ spot",gbmS0,setGbmS0,"100"],["T years",gbmT,setGbmT,"1"],["Paths",gbmN,setGbmN,"12"]
            ].map(([l,v,set,ph])=>(
              <div key={l}>
                <Lbl>{l}</Lbl>
                <input value={v} onChange={e=>set(e.target.value)} placeholder={ph}
                  style={{...mono(12,C.txt),width:"100%",padding:"6px 9px",borderRadius:8,
                    background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <SpinRing active={gbmLoad}>
            <button onClick={runGBM} disabled={gbmLoad}
              style={{display:"flex",alignItems:"center",gap:7,padding:"8px 18px",borderRadius:8,
                border:"none",cursor:gbmLoad?"not-allowed":"pointer",
                background:gbmLoad?C.dim:C.grn,color:"#000",...mono(12,"#000",700)}}>
              {gbmLoad ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/>Simulating…</> : <>▶ Simulate</>}
            </button>
            </SpinRing>
            {gbmRes && (<>
              <div style={{display:"flex",gap:16}}>
                <span style={mono(10,C.mut)}>final mean: <span style={{color:C.grn}}>${gbmRes.final_mean?.toFixed(2)}</span></span>
                <span style={mono(10,C.mut)}>5th–95th: <span style={{color:C.amb}}>${gbmRes.final_5th?.toFixed(2)} – ${gbmRes.final_95th?.toFixed(2)}</span></span>
                <span style={mono(10,C.mut)}>theory E[S(T)]: <span style={{color:C.sky}}>${gbmRes.theoretical_mean?.toFixed(2)}</span></span>
              </div>
            </>)}
          </div>
        </Card>

        {/* ── GBM Synthesis tile ── */}
        {gbmRes?.paths && (() => {
          const fp     = gbmRes.paths.map(p => p[p.length - 1]);
          const sorted = fp.slice().sort((a, b) => a - b);
          const pc     = q => sorted[Math.floor(q * (sorted.length - 1))];
          const pP     = fp.filter(p => p > s0).length / fp.length;
          const kelly  = Math.max(0, 2 * pP - 1);
          const p10 = pc(0.10), p50 = pc(0.50), p90 = pc(0.90), p75 = pc(0.75);
          const bc  = pP > 0.65 ? C.grn : pP > 0.50 ? C.amb : C.red;
          const bl  = pP > 0.65 ? "BULLISH" : pP > 0.50 ? "NEUTRAL" : "BEARISH";
          const action = pP > 0.65
            ? `Base case $${p50?.toFixed(0)} · bull case $${p90?.toFixed(0)} over ${T}yr. Consider a directional long or bull call spread targeting the 75th-percentile level ($${p75?.toFixed(0)}). Size at Half-Kelly (${(kelly*0.5*100).toFixed(0)}% of capital). Use the 10th-percentile price ($${p10?.toFixed(0)}) as your stop reference.`
            : pP > 0.50
            ? `Only ${(pP*100).toFixed(0)}% probability of profit — edge is marginal. Prefer a defined-risk vertical spread over a naked position. Reduce to quarter-Kelly (${(kelly*0.25*100).toFixed(0)}% of capital). Base case target $${p50?.toFixed(0)}.`
            : `${(pP*100).toFixed(0)}% of paths are profitable — unfavourable risk/reward at current drift/vol settings. Avoid net-long exposure. Consider protective puts or cash until parameters improve.`;
          return (
            <div style={{padding:"18px 20px",borderRadius:12,
              background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{...mono(9,C.mut,700),letterSpacing:".08em"}}>SYNTHESIS</div>
                <div style={{...mono(9,bc,700),padding:"2px 10px",borderRadius:99,
                  background:bc+"18",border:`1px solid ${bc}40`}}>{bl}</div>
              </div>
              <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:12}}>
                {`Over ${T}yr at ${(sig*100).toFixed(0)}% vol / ${(mu*100).toFixed(0)}% drift — ${(pP*100).toFixed(0)}% of paths end profitably. Bear case (10th pct): $${p10?.toFixed(0)} · Base case: $${p50?.toFixed(0)} · Bull case (90th pct): $${p90?.toFixed(0)}.`}
              </div>
              <div style={{...mono(9,C.mut,600),letterSpacing:".06em",marginBottom:6}}>SUGGESTED ACTION</div>
              <div style={{...mono(11,C.txt),lineHeight:1.8}}>{action}</div>
            </div>
          );
        })()}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Card>
            <Lbl>Ito's Lemma — Exact Solution</Lbl>
            <CodeBox>{"dS = μS dt + σS dW\n\nd(ln S) = (μ − σ²/2)dt + σdW\n\nS(T) = S₀ exp[(μ−σ²/2)T + σ√T·Z]\n       Z ~ N(0,1)\n\nE[S(T)] = S₀ e^(μT)"}</CodeBox>
          </Card>
          <Card>
            <Lbl>Summary Statistics</Lbl>
            {[
              ["μ (drift)",   `${(mu*100).toFixed(0)}% p.a.`],
              ["σ (vol)",     `${(sig*100).toFixed(0)}% p.a.`],
              ["S₀",          `$${s0}`],
              ["T",           `${T} yr${T!==1?"s":""}`],
              ["E[S(T)] theory", `$${(s0*Math.exp(mu*T)).toFixed(2)}`],
              ["Var[S(T)] theory", `$${(s0**2*Math.exp(2*mu*T)*(Math.exp(sig**2*T)-1)).toFixed(2)}`],
              ...(gbmRes ? [
                ["Simulated mean", `$${gbmRes.final_mean?.toFixed(2)}`],
                ["Simulated σ",    `$${gbmRes.final_std?.toFixed(2)}`],
                ["5th percentile", `$${gbmRes.final_5th?.toFixed(2)}`],
                ["95th percentile",`$${gbmRes.final_95th?.toFixed(2)}`],
              ] : []),
            ].map(([k,v])=><KV key={k} k={k} v={v}/>)}
          </Card>
        </div>

        <Card>
          <Lbl>Monte Carlo Paths · {nDisplay} simulated trajectories</Lbl>
          <ChartPanel title="GBM — Monte Carlo Paths" defaultHeight={240}>
          {(h)=>(
          <ResponsiveContainer width="100%" height={h}>
            <LineChart data={gbmChart} margin={{top:5,right:5,left:50,bottom:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="t" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}}
                label={{value:"Step",fill:C.mut,fontSize:9,position:"insideBottom",offset:-8}}/>
              <YAxis tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}}
                tickFormatter={v=>`$${parseFloat(v).toFixed(0)}`}
                label={{value:"Price ($)",angle:-90,position:"insideLeft",offset:20,
                  style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
              <Tooltip {...TT} formatter={v=>[`$${v}`]}/>
              {Array.from({length:nDisplay},(_,i)=>(
                <Line key={i} type="monotone" dataKey={`p${i}`} stroke={PC[i%PC.length]}
                  strokeWidth={1.5} dot={false} opacity={0.75}/>
              ))}
            </LineChart>
          </ResponsiveContainer>
          )}
          </ChartPanel>
        </Card>

        {/* ── GBM Decision Insights ── */}
        {gbmRes?.paths && (() => {
          const finalPrices = gbmRes.paths.map(p => p[p.length - 1]);
          const sorted   = finalPrices.slice().sort((a, b) => a - b);
          const pct      = q => sorted[Math.floor(q * (sorted.length - 1))];
          const pProfit  = finalPrices.filter(p => p > s0).length / finalPrices.length;
          const pUp20    = finalPrices.filter(p => p > s0 * 1.20).length / finalPrices.length;
          const pDn20    = finalPrices.filter(p => p < s0 * 0.80).length / finalPrices.length;
          const kelly    = Math.max(0, 2 * pProfit - 1);
          const bias     = pProfit > 0.65 ? "BULLISH" : pProfit > 0.50 ? "NEUTRAL-BULL" : pProfit > 0.35 ? "NEUTRAL-BEAR" : "BEARISH";
          const biasCol  = pProfit > 0.65 ? C.grn : pProfit > 0.50 ? C.amb : pProfit > 0.35 ? "#ff8a65" : C.red;
          return (
            <Card>
              <Lbl>Decision Insights</Lbl>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:10}}>
                <div>
                  <div style={{...mono(9,C.mut),marginBottom:8,letterSpacing:".06em"}}>PRICE TARGETS · {T}yr horizon</div>
                  {[
                    ["10th pct — bear case",  pct(0.10)],
                    ["25th pct",              pct(0.25)],
                    ["50th pct — base case",  pct(0.50)],
                    ["75th pct",              pct(0.75)],
                    ["90th pct — bull case",  pct(0.90)],
                  ].map(([k, v]) => (
                    <KV key={k} k={k} v={`$${v?.toFixed(2)}`}
                      vc={v > s0 ? C.grn : v < s0 ? C.red : C.txt}/>
                  ))}
                </div>
                <div>
                  <div style={{...mono(9,C.mut),marginBottom:8,letterSpacing:".06em"}}>PROBABILITY OUTCOMES</div>
                  {[
                    ["P(profitable at T)",  `${(pProfit*100).toFixed(1)}%`,  pProfit>0.5?C.grn:C.red],
                    ["P(+20% or more)",     `${(pUp20*100).toFixed(1)}%`,    C.grn],
                    ["P(−20% or more)",     `${(pDn20*100).toFixed(1)}%`,    C.red],
                    ["Kelly fraction",      `${(kelly*100).toFixed(1)}%`,    C.amb],
                    ["Regime bias",         bias,                            biasCol],
                  ].map(([k, v, vc]) => <KV key={k} k={k} v={v} vc={vc}/>)}
                  <div style={{marginTop:12,padding:10,borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
                    <div style={mono(9,C.mut,600)}>POSITIONING IMPLICATION</div>
                    <div style={{...mono(10,C.txt),marginTop:5,lineHeight:1.7}}>
                      {pProfit > 0.65
                        ? `${(pProfit*100).toFixed(0)}% of paths finish profitable — regime supports net-long. Kelly suggests risking ${(kelly*100).toFixed(0)}% of portfolio.`
                        : pProfit > 0.50
                        ? `${(pProfit*100).toFixed(0)}% P(profit) is marginal. Prefer reduced size or a defined-risk spread over a directional bet.`
                        : `Only ${(pProfit*100).toFixed(0)}% of paths are profitable under these parameters. Reduce or hedge — risk/reward is unfavorable.`}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })()}

      </>)}

      {/* ── BLACK-SCHOLES TAB ── */}
      {tab==="bs"&&(<>
        <Card>
          <Lbl>Option Parameters</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginTop:8,marginBottom:14}}>
            {[["S spot",bsS,setBsS],["K strike",bsK,setBsK],["T years",bsT,setBsT],
              ["r rate",bsR,setBsR],["σ vol",bsSig,setBsSig]
            ].map(([l,v,set])=>(
              <div key={l}>
                <Lbl>{l}</Lbl>
                <input value={v} onChange={e=>set(e.target.value)}
                  style={{...mono(12,C.txt),width:"100%",padding:"6px 9px",borderRadius:8,
                    background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div>
              <Lbl>type</Lbl>
              <div style={{display:"flex",gap:4,marginTop:4}}>
                {["call","put"].map(t=>(
                  <button key={t} onClick={()=>setBsType(t)}
                    style={{...mono(10,bsType===t?"#000":C.mut,700),padding:"5px 10px",borderRadius:6,
                      background:bsType===t?C.grn:"transparent",
                      border:`1px solid ${bsType===t?C.grn:C.bdr}`,cursor:"pointer",transition:"all .15s"}}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SpinRing active={bsLoad}>
          <button onClick={runBS} disabled={bsLoad}
            style={{display:"flex",alignItems:"center",gap:7,padding:"8px 18px",borderRadius:8,
              border:"none",cursor:"pointer",background:bsLoad?C.dim:C.grn,
              color:"#000",...mono(12,"#000",700)}}>
            {bsLoad ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/>Pricing…</> : <>▶ Price Option</>}
          </button>
          </SpinRing>
        </Card>

        {/* ── BS Synthesis tile ── */}
        {bs && (() => {
          const S_v   = parseFloat(bsS)  || 100;
          const K_v   = parseFloat(bsK)  || 100;
          const T_v   = parseFloat(bsT)  || 0.25;
          const sig_v = parseFloat(bsSig)|| 0.20;
          const breakeven    = bsType === "call" ? K_v + bs.price : K_v - bs.price;
          const bePct        = (breakeven - S_v) / S_v * 100;
          const thetaDay     = Math.abs(bs.theta || 0) * 100;
          const moneyness    = K_v / S_v;
          const mLabel       = moneyness < 0.97 ? "ITM" : moneyness > 1.03 ? "OTM" : "ATM";
          const deltaAbs     = Math.abs(bs.delta || 0);
          const bc           = deltaAbs > 0.55 ? C.grn : deltaAbs > 0.35 ? C.amb : C.mut;
          const days         = Math.round(T_v * 365);
          const hedgeShares  = bs.delta > 0 ? Math.round(1 / bs.delta) : null;
          const action = bsType === "call"
            ? `This ${mLabel} call needs a ${Math.abs(bePct).toFixed(1)}% rally to $${breakeven.toFixed(2)} to break even at expiry. At delta ${deltaAbs.toFixed(2)}, you need ${hedgeShares} contracts to hedge 100 shares. With $${thetaDay.toFixed(2)}/day time decay over ${days}d, hold shorter if vol doesn't materialise. IV at ${(sig_v*100).toFixed(0)}% — exit or roll if IV compresses more than 3–4pts (loses ~$${(Math.abs(bs.vega||0)*300).toFixed(0)}/contract).`
            : `This ${mLabel} put needs a ${Math.abs(bePct).toFixed(1)}% decline to $${breakeven.toFixed(2)} to break even at expiry. Delta of ${deltaAbs.toFixed(2)} makes it a ${deltaAbs>0.5?"strong":"moderate"} directional hedge. At $${thetaDay.toFixed(2)}/day decay over ${days}d — buy on confirmed weakness, not as a speculative hold. Vega of ${Math.abs(bs.vega||0).toFixed(2)} means each 1pt IV expansion adds $${(Math.abs(bs.vega||0)*100).toFixed(0)}/contract.`;
          return (
            <div style={{padding:"18px 20px",borderRadius:12,
              background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{...mono(9,C.mut,700),letterSpacing:".08em"}}>SYNTHESIS</div>
                <div style={{...mono(9,bc,700),padding:"2px 10px",borderRadius:99,
                  background:bc+"18",border:`1px solid ${bc}40`}}>
                  {bsType.toUpperCase()} · {mLabel} · Δ {deltaAbs.toFixed(2)}
                </div>
              </div>
              <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:12}}>
                {`${bsType === "call" ? "Call" : "Put"} @ $${K_v} · theoretical value $${bs.price?.toFixed(2)} · ${days}d to expiry · breakeven $${breakeven.toFixed(2)} (${bePct >= 0 ? "+" : ""}${bePct.toFixed(1)}% from spot $${S_v}).`}
              </div>
              <div style={{...mono(9,C.mut,600),letterSpacing:".06em",marginBottom:6}}>SUGGESTED ACTION</div>
              <div style={{...mono(11,C.txt),lineHeight:1.8}}>{action}</div>
            </div>
          );
        })()}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Card>
            <Lbl>Black-Scholes Formula</Lbl>
            <CodeBox>{"C = S₀N(d₁) − Ke^(−rT)N(d₂)\nP = Ke^(−rT)N(−d₂) − S₀N(−d₁)\n\nd₁ = [ln(S/K)+(r+σ²/2)T] / σ√T\nd₂ = d₁ − σ√T\n\nParity: C − P = S₀ − Ke^(−rT)"}</CodeBox>
          </Card>
          <Card>
            <Lbl>Results</Lbl>
            {bs ? [
              ["BS Price",       `$${bs.price?.toFixed(4)}`,         C.grn],
              ["Delta Δ",        bs.delta?.toFixed(4),               C.grn],
              ["Gamma Γ",        bs.gamma?.toFixed(4),               C.sky],
              ["Theta Θ /day",   bs.theta?.toFixed(4),               C.amb],
              ["Vega ν",         bs.vega?.toFixed(4),                C.pur],
              ["Rho ρ",          bs.rho?.toFixed(4),                 C.red],
              ...(mc ? [
                ["MC Price",     `$${mc.mc_price?.toFixed(4)}`,      C.txt],
                ["MC SE",        `±${mc.mc_se?.toFixed(4)}`,         C.mut],
                ["MC vs BS err", `${(Math.abs(mc.mc_price-bs.price)/bs.price*100).toFixed(2)}%`, C.mut],
              ] : []),
            ].map(([k,v,c])=><KV key={k} k={k} v={v||"—"} vc={c}/>) : (
              <div style={{...mono(11,C.mut),padding:"12px 0"}}>Click ▶ Price Option to compute.</div>
            )}
          </Card>
        </div>

        {bs && (
          <Card>
            <Lbl>Option Greeks — Visual</Lbl>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginTop:8}}>
              {[
                {n:"Delta Δ", v:bs.delta?.toFixed(4)||"—", f:"∂C/∂S = N(d₁)",        c:C.grn},
                {n:"Gamma Γ", v:bs.gamma?.toFixed(4)||"—", f:"∂²C/∂S²= φ(d₁)/(Sσ√T)",c:C.sky},
                {n:"Theta Θ", v:bs.theta?.toFixed(4)||"—", f:"∂C/∂t (per day)",       c:C.amb},
                {n:"Vega ν",  v:bs.vega?.toFixed(4) ||"—", f:"S·φ(d₁)·√T / 100",     c:C.pur},
                {n:"Rho ρ",   v:bs.rho?.toFixed(4)  ||"—", f:"KTe^(−rT)N(d₂)/100",   c:C.red},
              ].map(g=>(
                <div key={g.n} style={{padding:12,borderRadius:10,border:`1px solid ${g.c}25`,background:g.c+"08"}}>
                  <div style={mono(10,g.c,700)}>{g.n}</div>
                  <div style={mono(18,C.headingTxt,800)}>{g.v}</div>
                  <div style={{...mono(9,C.mut),marginTop:4,lineHeight:1.5}}>{g.f}</div>
                </div>
              ))}
            </div>
            {mc&&(
              <div style={{marginTop:12}}>
                <CodeBox>{`Put-call parity: BS=${bs.price?.toFixed(3)}  MC=${mc.mc_price?.toFixed(3)}±${mc.mc_se?.toFixed(3)}  |err|=${mc.error?.toFixed(4)} (${(mc.error/bs.price*100).toFixed(2)}%)`}</CodeBox>
              </div>
            )}
          </Card>
        )}

        {/* ── BS Decision Insights ── */}
        {bs && (() => {
          const S_v   = parseFloat(bsS)  || 100;
          const K_v   = parseFloat(bsK)  || 100;
          const T_v   = parseFloat(bsT)  || 0.25;
          const sig_v = parseFloat(bsSig)|| 0.20;
          const breakeven      = bsType === "call" ? K_v + bs.price : K_v - bs.price;
          const bePct          = (breakeven - S_v) / S_v * 100;
          const contractCost   = bs.price * 100;
          const dollarsPerDollar = Math.abs(bs.delta) * 100;
          const dollarsPerPct  = Math.abs(bs.delta) * S_v * 0.01 * 100;
          const vegaPerPt      = Math.abs(bs.vega || 0) * 100;
          const thetaPerDay    = Math.abs(bs.theta || 0) * 100;
          const rhoPerPt       = Math.abs(bs.rho   || 0) * 100;
          const daysToZero     = bs.theta ? Math.abs(bs.price / bs.theta) : null;
          return (
            <Card>
              <Lbl>Decision Insights</Lbl>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:10}}>
                <div>
                  <div style={{...mono(9,C.mut),marginBottom:8,letterSpacing:".06em"}}>BREAKEVEN ANALYSIS</div>
                  {[
                    ["Contract cost (1 lot)",       `$${contractCost.toFixed(2)}`],
                    ["Breakeven at expiry",          `$${breakeven.toFixed(2)}`],
                    [`Required ${bsType==="call"?"rally":"decline"}`, `${Math.abs(bePct).toFixed(2)}%`],
                    ["Max risk (long buyer)",        `$${contractCost.toFixed(2)}`],
                    ["Days to full decay (est.)",    daysToZero ? `${daysToZero.toFixed(0)}d` : "—"],
                  ].map(([k, v]) => <KV key={k} k={k} v={v}/>)}
                </div>
                <div>
                  <div style={{...mono(9,C.mut),marginBottom:8,letterSpacing:".06em"}}>DOLLAR SENSITIVITY · 1 CONTRACT</div>
                  {[
                    ["P&L per $1 underlying move",  `$${dollarsPerDollar.toFixed(2)}`],
                    ["P&L per 1% underlying move",  `$${dollarsPerPct.toFixed(2)}`],
                    ["P&L per 1pt IV change (vega)", `$${vegaPerPt.toFixed(2)}`],
                    ["Daily time decay (theta)",     `−$${thetaPerDay.toFixed(2)}`],
                    ["P&L per 1pt rate change (rho)",`$${rhoPerPt.toFixed(2)}`],
                  ].map(([k, v]) => <KV key={k} k={k} v={v}/>)}
                  <div style={{marginTop:12,padding:10,borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
                    <div style={mono(9,C.mut,600)}>QUICK READ</div>
                    <div style={{...mono(10,C.txt),marginTop:5,lineHeight:1.7}}>
                      {`This ${bsType} needs a ${Math.abs(bePct).toFixed(1)}% ${bsType==="call"?"rally":"decline"} to $${breakeven.toFixed(2)} to break even at expiry. At ${(sig_v*100).toFixed(0)}% IV over ${Math.round(T_v*365)}d you lose $${thetaPerDay.toFixed(2)}/day to time decay.`}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })()}

      </>)}

      {/* ── POSITION SIZING TAB ── */}
      {tab==="sizing"&&(<>
        <div>
          <Lbl>Conviction &amp; Position Sizing</Lbl>
          <div style={mono(11,C.mut)}>Set your directional P(bull), portfolio size, and expected win/loss ratio. Kelly criterion computes optimal allocation. Import P(profit) directly from a GBM run above.</div>
        </div>

        {/* ── Position Sizing Synthesis tile ── */}
        {(() => {
          const pBull  = Math.min(Math.max(parseFloat(sizeBull) || 60, 0), 100) / 100;
          const portV  = parseFloat(sizePort) || 100000;
          const bRatio = Math.max(parseFloat(sizeOdds) || 1.5, 0.01);
          const kelly  = Math.max(0, pBull - (1 - pBull) / bRatio);
          const half   = kelly * 0.5 * portV;
          const sigW   = pBull * 2 - 1;
          const dir    = sigW > 0.10 ? "BULLISH" : sigW < -0.10 ? "BEARISH" : "NEUTRAL";
          const bc     = sigW > 0.10 ? C.grn : sigW < -0.10 ? C.red : C.mut;
          const conviction = pBull > 0.70 ? "high" : pBull > 0.55 ? "moderate" : pBull > 0.45 ? "low" : "contrarian-bearish";
          const action = kelly > 0.20
            ? `${conviction.charAt(0).toUpperCase() + conviction.slice(1)} conviction (${(pBull*100).toFixed(0)}% bull). Full Kelly ($${Math.round(kelly*portV).toLocaleString()}) is aggressive — Half-Kelly ($${Math.round(half).toLocaleString()}) is the standard practitioner recommendation. Signal weight of ${sigW>=0?"+":""}${sigW.toFixed(2)} maps to a ${dir.toLowerCase()} allocation in the strategy engine. Risk $${Math.round(half).toLocaleString()} on your highest-conviction idea or spread it across 2–3 correlated positions.`
            : kelly > 0.05
            ? `Modest edge with ${(pBull*100).toFixed(0)}% conviction and ${bRatio.toFixed(1)}× win/loss ratio. Kelly fraction ${(kelly*100).toFixed(1)}% suggests limited size — risk no more than $${Math.round(half).toLocaleString()} (Half-Kelly). Signal weight of ${sigW>=0?"+":""}${sigW.toFixed(2)} is a weak ${dir.toLowerCase()} lean. Consider defined-risk structures over outright directional bets.`
            : `Insufficient edge at current inputs (Kelly = ${(kelly*100).toFixed(1)}%). Either conviction or win/loss ratio (or both) is too low to justify risk capital. Stay flat or use minimum allocation until conviction strengthens. Re-run after a GBM simulation to derive a data-driven P(bull).`;
          return (
            <div style={{padding:"18px 20px",borderRadius:12,
              background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{...mono(9,C.mut,700),letterSpacing:".08em"}}>SYNTHESIS</div>
                <div style={{...mono(9,bc,700),padding:"2px 10px",borderRadius:99,
                  background:bc+"18",border:`1px solid ${bc}40`}}>
                  {dir} · Kelly {(kelly*100).toFixed(1)}%
                </div>
              </div>
              <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:12}}>
                {`P(bull) = ${(pBull*100).toFixed(0)}% · Win/loss ${bRatio.toFixed(1)}× · Portfolio $${portV.toLocaleString()} → Full Kelly $${Math.round(kelly*portV).toLocaleString()} · Half Kelly $${Math.round(half).toLocaleString()}.`}
              </div>
              <div style={{...mono(9,C.mut,600),letterSpacing:".06em",marginBottom:6}}>SUGGESTED ACTION</div>
              <div style={{...mono(11,C.txt),lineHeight:1.8}}>{action}</div>
            </div>
          );
        })()}

        {/* ── Inputs ── */}
        {(() => {
          const pBull  = Math.min(Math.max(parseFloat(sizeBull) || 60, 0), 100) / 100;
          const pBear  = 1 - pBull;
          const portV  = parseFloat(sizePort) || 100000;
          const bRatio = Math.max(parseFloat(sizeOdds) || 1.5, 0.01);
          const kelly  = Math.max(0, pBull - pBear / bRatio);
          const full   = kelly * portV;
          const half   = kelly * 0.5 * portV;
          const signalW= pBull * 2 - 1;
          const dir    = signalW > 0.10 ? "BULLISH" : signalW < -0.10 ? "BEARISH" : "NEUTRAL";
          const dirCol = signalW > 0.10 ? C.grn : signalW < -0.10 ? C.red : C.mut;
          return (<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[
                ["P(Bull) %",       sizeBull,  setSizeBull,  "60"],
                ["Portfolio ($)",   sizePort,  setSizePort,  "100000"],
                ["Win/Loss ratio",  sizeOdds,  setSizeOdds,  "1.5"],
              ].map(([l, v, set, ph]) => (
                <div key={l}>
                  <Lbl>{l}</Lbl>
                  <input value={v} onChange={e=>set(e.target.value)} placeholder={ph}
                    style={{...mono(12,C.txt),width:"100%",padding:"6px 9px",borderRadius:8,
                      background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
            </div>
            {/* Import from GBM */}
            {gbmRes?.paths && (
              <button onClick={()=>{
                const fp = gbmRes.paths.map(p=>p[p.length-1]);
                if (fp.length) setSizeBull((fp.filter(p=>p>s0).length/fp.length*100).toFixed(1));
              }} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:8,
                border:`1px solid ${C.bdr}`,background:"transparent",cursor:"pointer",...mono(10,C.mut)}}>
                ↑ Import GBM P(profit) as conviction
              </button>
            )}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {/* Kelly sizing */}
              <Card>
                <Lbl>Kelly Position Sizing</Lbl>
                {[
                  ["P(bull)",              `${(pBull*100).toFixed(1)}%`],
                  ["P(bear)",              `${(pBear*100).toFixed(1)}%`],
                  ["Win / loss ratio",     `${bRatio.toFixed(2)}×`],
                  ["Kelly fraction",       `${(kelly*100).toFixed(1)}%`],
                  ["Full Kelly ($)",       `$${Math.round(full).toLocaleString()}`],
                  ["Half Kelly ($)",       `$${Math.round(half).toLocaleString()}`],
                  ["Signal weight",        `${signalW>=0?"+":""}${signalW.toFixed(3)}`],
                  ["Direction",            dir],
                ].map(([k, v]) => (
                  <KV key={k} k={k} v={v}
                    vc={k==="Direction"?dirCol:k.includes("Kelly ($)")?C.grn:k==="Signal weight"?dirCol:undefined}/>
                ))}
              </Card>
              {/* Visual conviction bars + signal */}
              <Card>
                <Lbl>Conviction View</Lbl>
                {[{l:"Bull",p:pBull*100,c:C.grn},{l:"Bear",p:pBear*100,c:C.red}].map(o=>(
                  <div key={o.l} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",...mono(10,C.txt,600)}}>
                      <span>{o.l}</span><span style={{color:o.c}}>{o.p.toFixed(1)}%</span>
                    </div>
                    <div style={{marginTop:4,height:8,borderRadius:99,background:C.dim,overflow:"hidden"}}>
                      <div style={{width:`${o.p}%`,height:"100%",background:o.c,opacity:0.8,transition:"width .3s"}}/>
                    </div>
                  </div>
                ))}
                <div style={{marginTop:10,padding:10,borderRadius:8,
                  background:dirCol+"10",border:`1px solid ${dirCol}30`}}>
                  <div style={mono(9,C.mut,600)}>SIGNAL WEIGHT → ENGINE INPUT</div>
                  <CodeBox>{`f(p) = P(bull) × 2 − 1  ∈ [−1, +1]\n     = ${pBull.toFixed(3)} × 2 − 1 = ${signalW>=0?"+":""}${signalW.toFixed(3)}\n\nKelly f* = p − (1−p)/b\n        = ${pBull.toFixed(3)} − ${pBear.toFixed(3)}/${bRatio.toFixed(2)} = ${(kelly*100).toFixed(1)}%`}</CodeBox>
                </div>
              </Card>
            </div>
          </>);
        })()}

      </>)}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function ReportView() {
  const C = useC();
  const [runList, setRunList]     = useState([]);
  const [selId,   setSelId]       = useState(null);
  const [run,     setRun]         = useState(null);
  const [eqData,  setEqData]      = useState(null);
  const [loading, setLoading]     = useState(true);

  // Fetch runs list on mount
  useEffect(() => {
    fetch("/api/runs")
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        setRunList(list);
        const first = list.find(r => r.status === "complete" && r.run_type === "backtest");
        if (first) setSelId(first.id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // When selId changes: pick run from list + fetch equity curve
  useEffect(() => {
    if (!selId || !runList.length) return;
    const found = runList.find(r => r.id === selId) || null;
    setRun(found);
    setEqData(null);
    fetch(`/api/runs/${selId}/equity_curve`)
      .then(r => r.ok ? r.json() : null)
      .then(ec => {
        if (!ec) return;
        const n      = ec.equity_curve.length;
        const stride = Math.max(1, Math.floor(n / 150));
        setEqData(
          ec.timestamps
            .filter((_,i) => i % stride === 0)
            .map((t, i) => ({ yr: t.slice(0,10), eq: Math.round(ec.equity_curve[i * stride]) }))
        );
      })
      .catch(() => {});
  }, [selId, runList]);

  const m   = run?.metrics    || {};
  const v   = run?.validation || {};
  const cfg = run?.config     || {};

  const pct = x => x != null ? `${(x*100).toFixed(2)}%` : "—";
  const n4  = x => x != null ? Number(x).toFixed(4)     : "—";
  const dlr = x => x != null ? `$${Number(x).toLocaleString(undefined,{maximumFractionDigits:0})}` : "—";

  const validColor = v.label === "VALID"     ? C.grn
                   : v.label === "UNCERTAIN" ? C.amb : C.red;

  const completedRuns = runList.filter(r => r.status === "complete");

  const perfRows = [
    ["CAGR",           pct(m.cagr)],
    ["Total Return",   pct(m.total_return)],
    ["Volatility",     pct(m.volatility)],
    ["Sharpe Ratio",   n4(m.sharpe_ratio)],
    ["Sortino Ratio",  n4(m.sortino_ratio)],
    ["Max Drawdown",   pct(m.max_drawdown)],
    ["Calmar Ratio",   n4(m.calmar_ratio)],
    ["Annual Turnover",pct(m.annual_turnover)],
    ["N Trades",       m.n_trades ?? "—"],
    ["Total Fees",     dlr(m.total_fees)],
    ["Alpha (ann.)",   pct(m.alpha_annualized)],
    ["Alpha t-stat",   n4(m.alpha_t_stat)],
    ["Alpha p-value",  n4(m.alpha_p_value)],
    ["N Days",         m.n_days ?? "—"],
  ];

  const runSymbols  = (run?.symbols   || []).join(", ") || "—";
  const runSignals  = (cfg.signals    || []).join(", ") || "—";
  const dateRange   = `${run?.start_date || "?"} → ${run?.end_date || "?"}`;
  const chartData   = eqData || EQ_DATA;

  if (loading) return (
    <Card><div style={{...mono(11,C.mut),padding:"6px 0",display:"flex",gap:8,alignItems:"center"}}><RefreshCw size={12}/>Loading runs…</div></Card>
  );

  if (!completedRuns.length) return (
    <Card accent={C.amb}>
      <Lbl>No Completed Runs</Lbl>
      <div style={{...mono(11,C.mut),marginTop:8,lineHeight:1.8}}>
        Run a backtest on the <strong style={{color:C.sky}}>Backtest</strong> tab first.
        Once complete it will appear here automatically.
      </div>
    </Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>

      {/* ── Header + run selector ── */}
      <Card accent={C.grn}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <div style={{...mono(9,C.mut,700),letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}># Research Report</div>
            <div style={mono(24,C.headingTxt,800)}>
              {run ? (run.project_name || `Run ${run.id}`) : "—"}
            </div>
            {run && (
              <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
                <Tag color={C.mut}>Run: {run.id}</Tag>
                <Tag color={C.mut}>{run.completed_at ? new Date(run.completed_at).toUTCString() : (run.created_at || "")}</Tag>
                {v.label && (
                  <Tag color={validColor}>
                    {v.label === "VALID" ? "✓" : v.label === "UNCERTAIN" ? "~" : "✗"} {v.label}
                  </Tag>
                )}
                {(run.symbols || []).map(s => <Tag key={s} color={C.sky}>{s}</Tag>)}
              </div>
            )}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
            <Lbl>Select Run</Lbl>
            <select
              value={selId || ""}
              onChange={e => setSelId(e.target.value)}
              style={{...mono(11,C.txt),padding:"7px 11px",borderRadius:8,background:C.dim,
                border:`1px solid ${C.bdr}`,outline:"none",color:C.txt,minWidth:200}}>
              {completedRuns.map(r => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.run_type} · {(r.completed_at||r.created_at||"").slice(0,10)}
                </option>
              ))}
            </select>
            <div style={{...mono(10,C.amb),padding:"8px 14px",borderRadius:8,
              border:`1px solid ${C.amb}30`,background:C.amb+"08",textAlign:"right"}}>
              ⚠ Not financial advice.<br/>Markets involve risk.
            </div>
          </div>
        </div>
      </Card>

      {run && <>

        {/* ── Report Synthesis (top) ── */}
        {(() => {
          const sharpe  = m.sharpe_ratio    ?? 0;
          const cagr    = m.cagr            ?? 0;
          const dd      = m.max_drawdown    ?? 0;
          const nTrades = m.n_trades        ?? 0;
          const nDays   = m.n_days ?? (v.n_observations ?? 252);
          const yrs     = Math.max(nDays / 252, 0.01);
          const pCorr   = v.p_value_corrected    ?? 1;
          const tStat   = Math.abs(v.t_stat      ?? 0);
          const alpha   = m.alpha_annualized     ?? 0;

          const statSig  = pCorr < 0.05 && tStat > 1.96;
          const perfGood = sharpe > 1.0 && cagr > 0.08;
          const riskOK   = Math.abs(dd) < 0.30;

          const avgHold  = nTrades > 0 ? (yrs * 252 / nTrades) : 0;
          const style    = avgHold < 2  ? "Intraday"
                         : avgHold < 10 ? "Swing"
                         : avgHold < 60 ? "Position"
                         : "Trend-Following";

          const tfNote   = avgHold < 2  ? "Intraday requires low-latency execution; brokerage costs erode edge fast."
                         : avgHold < 10 ? "Swing-style (2–9 days); overnight gap risk demands disciplined sizing."
                         : avgHold < 60 ? "Position-trade horizon (weeks); momentum & earnings events dominate."
                         : "Trend-following horizon (months+); macro regime shifts are the primary risk.";

          let verdict, bc, summary, action;
          if (statSig && perfGood && riskOK) {
            verdict = "DEPLOY CANDIDATE"; bc = C.grn;
            summary = `Statistically significant edge confirmed (p=${n4(pCorr)}, |t|=${n4(v.t_stat)}) with Sharpe ${n4(sharpe)} and CAGR ${pct(cagr)} over ${yrs.toFixed(1)} yr${yrs>=2?"s":""}. Max drawdown ${pct(dd)} is within acceptable risk bounds. ${style} execution inferred from ${nTrades} trades across ${runSymbols}.`;
            action  = `Evidence supports forward-testing with small live capital. Enforce position sizing discipline and monitor drawdown weekly. Consider 2–4 weeks of paper trading before scaling.`;
          } else if (statSig && (perfGood || riskOK)) {
            verdict = "PROMISING — REFINE"; bc = C.amb;
            summary = `Detectable edge (p=${n4(pCorr)}) but ${!perfGood ? `performance metrics are below threshold (Sharpe ${n4(sharpe)}, CAGR ${pct(cagr)})` : `drawdown ${pct(dd)} is elevated`}. ${style} style across ${yrs.toFixed(1)} yr${yrs>=2?"s":""}. Alpha ${pct(alpha)} annualized.`;
            action  = `Review signal combinations, fee assumptions (${cfg.fee_bps ?? 1}bp), and risk controls. Tighten drawdown limits or re-weight signals before committing capital. Re-run validation with n≥1000 permutations.`;
          } else if (perfGood && riskOK) {
            verdict = "MARGINAL — CAUTION"; bc = C.amb;
            summary = `Returns appear favorable (CAGR ${pct(cagr)}, Sharpe ${n4(sharpe)}) but statistical validation is insufficient (p=${n4(pCorr)}, required <0.05). Over ${yrs.toFixed(1)} yr${yrs>=2?"s":""} results may reflect overfitting or data-mining bias.`;
            action  = `Do not deploy. Extend the out-of-sample period and add a holdout test. Increase permutations and verify with walk-forward analysis before reconsidering.`;
          } else {
            verdict = "NOT VALIDATED"; bc = C.red;
            summary = `Strategy shows no consistent edge: Sharpe ${n4(sharpe)}, CAGR ${pct(cagr)}, max drawdown ${pct(dd)}, p-value ${n4(pCorr)}. Validation: ${v.label || "N/A"}. Over ${yrs.toFixed(1)} yr${yrs>=2?"s":""} results are consistent with random performance.`;
            action  = `Do not trade this configuration. Revisit the signal hypothesis, entry/exit logic, or universe selection. Consider different timeframes, fundamental inputs, or alternative signal combinations.`;
          }

          return (
            <div style={{padding:"18px 20px",borderRadius:12,
              background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{...mono(9,C.mut,700),letterSpacing:".08em"}}>REPORT SYNTHESIS</div>
                <div style={{...mono(9,bc,700),padding:"2px 10px",borderRadius:99,
                  background:bc+"18",border:`1px solid ${bc}40`}}>{verdict}</div>
              </div>
              <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:12}}>{summary}</div>
              <div style={{...mono(9,C.mut,600),letterSpacing:".06em",marginBottom:6}}>WHAT THIS INDICATES</div>
              <div style={{...mono(11,C.txt),lineHeight:1.8,marginBottom:10}}>{action}</div>
              <div style={{...mono(10,C.mut),borderTop:`1px solid ${bc}25`,paddingTop:8,lineHeight:1.7}}>
                ⏱ <span style={{color:C.mut}}>Trading style:</span>{" "}
                <span style={{color:bc,fontWeight:700}}>{style}</span>
                {avgHold > 0 && <span style={{color:C.mut}}> · avg {avgHold.toFixed(1)} day{avgHold!==1?"s":""}/trade</span>}
                <span style={{color:C.mut}}> — {tfNote}</span>
              </div>
            </div>
          );
        })()}

        {/* ── Equity curve ── */}
        <Card>
          <Lbl>Equity Curve</Lbl>
          <ChartPanel title="Report — Equity Curve" defaultHeight={180}>
          {(h) => (
          <ResponsiveContainer width="100%" height={h}>
            <AreaChart data={chartData} margin={{top:8,right:8,bottom:0,left:50}}>
              <defs>
                <linearGradient id="rptEqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.grn} stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={C.grn} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
              <XAxis dataKey="yr" tick={mono(8,C.mut)} axisLine={false} tickLine={false}/>
              <YAxis tick={mono(8,C.mut)} axisLine={false} tickLine={false}
                tickFormatter={val => val >= 1e6 ? `$${(val/1e6).toFixed(1)}M` : `$${val.toLocaleString()}`}
                label={{value:"Portfolio Value ($)",angle:-90,position:"insideLeft",offset:20,
                  style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
              <Tooltip contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,fontSize:10}}
                formatter={val => [`$${Number(val).toLocaleString()}`, "Equity"]}/>
              <Area type="monotone" dataKey="eq" stroke={C.grn} strokeWidth={2} fill="url(#rptEqGrad)"/>
            </AreaChart>
          </ResponsiveContainer>
          )}
          </ChartPanel>
        </Card>

        {/* ── Performance metrics ── */}
        <Card>
          <Lbl>Performance Metrics</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 40px",marginTop:8}}>
            {perfRows.map(([k, val]) => (
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.bdr}`}}>
                <span style={mono(9,C.mut)}>{k}</span>
                <span style={mono(11,C.txt,700)}>{val}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Statistical validation ── */}
        {v.label && (
          <Card>
            <Lbl>Statistical Validation</Lbl>
            <div style={{display:"grid",gridTemplateColumns:C.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:12,marginTop:8}}>
              <KV k="Verdict"           v={<span style={{color:validColor,fontWeight:700}}>{v.label}</span>}/>
              <KV k="t-stat"            v={n4(v.t_stat)}/>
              <KV k="p-value (raw)"     v={n4(v.p_value_raw)}/>
              <KV k="p-value (corr.)"   v={n4(v.p_value_corrected)}/>
              <KV k="Permutation p"     v={n4(v.permutation_p_value)}/>
              <KV k="Correction method" v={v.correction_method || "—"}/>
              <KV k="N Observations"    v={v.n_observations ?? m.n_days ?? "—"}/>
              <KV k="Sharpe (val.)"     v={n4(v.sharpe_ratio)}/>
            </div>
            {v.conclusion && (
              <div style={{...mono(11,C.mut),marginTop:10,padding:"10px 14px",borderRadius:8,
                background:C.dim,borderLeft:`3px solid ${validColor}`,lineHeight:1.8}}>
                {v.conclusion}
              </div>
            )}
            {(v.warnings||[]).length > 0 && (
              <div style={{marginTop:8}}>
                {v.warnings.map((w,i) => (
                  <div key={i} style={{...mono(9,C.amb),padding:"4px 10px",borderLeft:`2px solid ${C.amb}`,marginTop:4}}>⚠ {w}</div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── Run configuration ── */}
        <Card>
          <Lbl>Run Configuration</Lbl>
          <div style={{display:"grid",gridTemplateColumns:C.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:12,marginTop:8}}>
            <KV k="Run Type"      v={run.run_type}/>
            <KV k="Date Range"    v={dateRange}/>
            <KV k="Symbols"       v={runSymbols}/>
            <KV k="Signals"       v={runSignals}/>
            <KV k="Fee (bps)"     v={cfg.fee_bps    ?? "—"}/>
            <KV k="Slippage (bps)"v={cfg.slippage_bps ?? "—"}/>
            <KV k="Risk-Free"     v={cfg.risk_free_rate != null ? pct(cfg.risk_free_rate) : "—"}/>
            <KV k="Permutations"  v={cfg.n_permutations ?? "—"}/>
          </div>
        </Card>

        {/* ── Narrative sections ── */}
        {[
          {t:"Executive Summary",
           b:`Strategy evaluated on ${runSymbols} from ${dateRange}. Run type: ${run.run_type}. Signals: ${runSignals}. Classification: ${v.label || "N/A"}. ${v.conclusion || ""}`},
          {t:"Statistical Validation",
           b:`t-stat = ${n4(v.t_stat)}, corrected p = ${n4(v.p_value_corrected)} (${v.correction_method || "—"}), permutation p = ${n4(v.permutation_p_value)}. ${v.n_observations || m.n_days || "N"} observations. ${v.conclusion || ""}`},
          {t:"Transaction Costs",
           b:`${cfg.fee_bps ?? 1}bp fee + ${cfg.slippage_bps ?? 2}bp slippage (one-way). Next-open execution. Total fees ${dlr(m.total_fees)} · annual turnover ${pct(m.annual_turnover)}.`},
          {t:"Disclaimer",
           b:"Not financial advice. Historical backtests do not predict future returns. Markets involve risk. Survivorship bias not addressed. Live execution costs may differ. Past performance is not indicative of future results."},
        ].map(s => (
          <Card key={s.t}>
            <Lbl>## {s.t}</Lbl>
            <p style={{...mono(11,C.mut),lineHeight:1.8,marginTop:6}}>{s.b}</p>
          </Card>
        ))}

      </>}
    </div>
  );
}

// ── Greek tooltip definitions for Options tab ────────────
const GREEK_TIPS = {
  delta: { desc:"Rate of change of option price per $1 move in the underlying. Calls: 0→1, Puts: -1→0. ~0.5 = at-the-money.", bands:[{label:"Deep ITM",range:"~1.0 (call) / ~-1.0 (put)",color:"#00e676"},{label:"ATM",range:"~0.5 / ~-0.5",color:"#40c4ff"},{label:"Deep OTM",range:"~0.0",color:"#ff5252"}] },
  gamma: { desc:"Rate of change of delta per $1 move. Highest near ATM and near expiration. Measures convexity.", bands:[{label:"High (ATM near exp.)",range:"> 0.05",color:"#00e676"},{label:"Moderate",range:"0.01 – 0.05",color:"#40c4ff"},{label:"Low (deep ITM/OTM)",range:"< 0.01",color:"#ff5252"}] },
  theta: { desc:"Daily time decay in dollars (negative = you lose this per day holding the option). Higher magnitude = faster decay.", bands:[{label:"Slow decay",range:"> -0.02/day",color:"#00e676"},{label:"Moderate",range:"-0.05 – -0.02",color:"#ffb300"},{label:"Fast decay",range:"< -0.05/day",color:"#ff5252"}] },
  vega:  { desc:"Dollar change in option price per 1% move in implied volatility. Highest ATM, long-dated options.", bands:[{label:"High sensitivity",range:"> 0.20",color:"#00e676"},{label:"Moderate",range:"0.05 – 0.20",color:"#40c4ff"},{label:"Low",range:"< 0.05",color:"#ff5252"}] },
  rho:   { desc:"Dollar change per 1% move in risk-free interest rates. Usually smallest Greek — matters more for long-dated options.", bands:[{label:"Significant",range:"> 0.10 or < -0.10",color:"#ffb300"},{label:"Typical",range:"-0.10 – 0.10",color:"#40c4ff"}] },
};

// ── Options Strategy Definitions ─────────────────────────
const SCORE_COLORS = {
  attractive:   { fg:"#00e676", bg:"rgba(0,230,118,0.09)" },
  neutral:      { fg:"#ffb300", bg:"rgba(255,179,0,0.09)" },
  unattractive: { fg:"#ff5252", bg:"rgba(255,82,82,0.09)" },
};

const OPTION_STRATEGIES = {
  // ── Classic ──────────────────────────────────────────────
  coveredCall: {
    group:"classic", label:"Covered Call",
    desc:"Sell slightly OTM calls (Δ 0.20–0.40) against a long stock position to generate income. Best when IV is elevated. Green = sweet-spot strikes. Yellow = borderline. Red = too deep ITM or too far OTM.",
    score:(row)=>{
      if(row.option_type!=="call") return null;
      const d=Math.abs(row.delta??0), iv=row.implied_vol??0;
      if(d>=0.20&&d<=0.40&&iv>=0.15) return "attractive";
      if((d>0.40&&d<=0.52)||(d>=0.12&&d<0.20)) return "neutral";
      return "unattractive";
    },
  },
  cashSecuredPut: {
    group:"classic", label:"Cash-Secured Put",
    desc:"Sell slightly OTM puts (Δ −0.20–−0.40) to acquire stock at a discount or generate income. Best in high-IV environments. Green = target strikes. Yellow = borderline. Red = too risky or no premium.",
    score:(row)=>{
      if(row.option_type!=="put") return null;
      const d=Math.abs(row.delta??0), iv=row.implied_vol??0;
      if(d>=0.20&&d<=0.40&&iv>=0.15) return "attractive";
      if((d>0.40&&d<=0.55)||(d>=0.12&&d<0.20)) return "neutral";
      return "unattractive";
    },
  },
  longStraddle: {
    group:"classic", label:"Long Straddle",
    desc:"Buy ATM call + put (Δ ~±0.50) expecting a large move in either direction. Best when IV is low — cheap options. Green = ATM + low IV. Yellow = ATM + moderate IV. Red = expensive or far OTM.",
    score:(row)=>{
      const d=Math.abs(row.delta??0), iv=row.implied_vol??0;
      const atm=d>=0.40&&d<=0.60;
      if(atm&&iv<=0.25) return "attractive";
      if(atm&&iv<=0.40) return "neutral";
      return "unattractive";
    },
  },
  ironCondor: {
    group:"classic", label:"Iron Condor",
    desc:"Sell OTM strangle (short legs Δ 0.15–0.25) and buy wings (Δ 0.05–0.12) for protection. Profits when stock stays range-bound. Green = short legs (sell). Yellow = long legs (protection). Red = too close or too far.",
    score:(row)=>{
      const d=Math.abs(row.delta??0);
      if(d>=0.15&&d<=0.25) return "attractive";
      if(d>=0.05&&d<0.15) return "neutral";
      return "unattractive";
    },
  },
  bullCallSpread: {
    group:"classic", label:"Bull Call Spread",
    desc:"Buy near-ATM call (Δ 0.45–0.60) and sell OTM call (Δ 0.20–0.35). Defined-risk bullish position with capped upside. Green = buy leg. Yellow = sell leg. Red = avoid. Puts not used.",
    score:(row)=>{
      if(row.option_type!=="call") return null;
      const d=row.delta??0;
      if(d>=0.45&&d<=0.60) return "attractive";
      if(d>=0.20&&d<0.40) return "neutral";
      return "unattractive";
    },
  },
  bearPutSpread: {
    group:"classic", label:"Bear Put Spread",
    desc:"Buy near-ATM put (Δ −0.45–−0.60) and sell OTM put (Δ −0.20–−0.35). Defined-risk bearish position with limited loss. Green = buy leg. Yellow = sell leg. Red = avoid. Calls not used.",
    score:(row)=>{
      if(row.option_type!=="put") return null;
      const d=Math.abs(row.delta??0);
      if(d>=0.45&&d<=0.60) return "attractive";
      if(d>=0.20&&d<0.40) return "neutral";
      return "unattractive";
    },
  },
  // ── Hedge Fund ───────────────────────────────────────────
  gammaScalping: {
    group:"hedgefund", label:"Gamma Scalping",
    desc:"Buy high-Γ ATM options and delta-hedge continuously to profit when realized vol exceeds implied vol. Gamma peaks at ATM near expiry. Green = high-Γ ATM. Yellow = near-ATM with decent Γ. Red = low gamma.",
    score:(row)=>{
      const d=Math.abs(row.delta??0), g=row.gamma??0;
      if(d>=0.40&&d<=0.60&&g>0.01) return "attractive";
      if(d>=0.30&&d<0.40&&g>0.005) return "neutral";
      return "unattractive";
    },
  },
  vegaHarvesting: {
    group:"hedgefund", label:"Vega Harvesting",
    desc:"Sell high-IV options to capture the volatility risk premium — implied vol statistically exceeds realized vol over time. Green = rich vol (IV ≥ 40%), moderate delta. Yellow = moderate IV. Red = cheap vol, not worth selling.",
    score:(row)=>{
      const iv=row.implied_vol??0, d=Math.abs(row.delta??0);
      if(iv>=0.40&&d>=0.15&&d<=0.50) return "attractive";
      if(iv>=0.25&&d>=0.10) return "neutral";
      return "unattractive";
    },
  },
  thetaDecay: {
    group:"hedgefund", label:"Theta Decay",
    desc:"Sell options where daily Θ decay is large relative to the premium received. Green = Θ/price ≥ 1.5%/day. Yellow = 0.8–1.5%/day. Red = slow decay relative to premium — poor income ratio.",
    score:(row)=>{
      const theta=Math.abs(row.theta??0);
      const price=row.last_price||((row.bid??0)+(row.ask??0))/2;
      if(!price||price<0.01) return "unattractive";
      const ratio=theta/price;
      if(ratio>=0.015) return "attractive";
      if(ratio>=0.008) return "neutral";
      return "unattractive";
    },
  },
  deltaHedging: {
    group:"hedgefund", label:"Delta Hedging",
    desc:"Identify liquid ATM options (Δ ~±0.50, high OI) for efficient portfolio delta neutralization. High OI ensures tight spreads and easy execution. Green = ATM + high liquidity. Yellow = near-ATM + decent OI. Red = illiquid or far from ATM.",
    score:(row)=>{
      const d=Math.abs(row.delta??0), oi=row.open_interest??0;
      if(d>=0.44&&d<=0.56&&oi>=500) return "attractive";
      if(d>=0.35&&d<=0.65&&oi>=100) return "neutral";
      return "unattractive";
    },
  },
  riskReversal: {
    group:"hedgefund", label:"Risk Reversal",
    desc:"Buy OTM calls + sell OTM puts (Δ 0.20–0.35 each side) to express a bullish skew view. Profits when stock rises or the put-call IV skew compresses. Green = target legs. Yellow = borderline delta. Red = avoid.",
    score:(row)=>{
      const d=Math.abs(row.delta??0);
      if(d>=0.20&&d<=0.35) return "attractive";
      if(d>=0.35&&d<=0.45) return "neutral";
      return "unattractive";
    },
  },
  skewArb: {
    group:"hedgefund", label:"Skew Arb",
    desc:"Sell expensive OTM wings (Δ < 0.20, IV > 45%) and buy cheaper near-ATM options when the volatility smile is extreme. Fade the expensive tails. Green = rich wings to sell. Yellow = cheap near-ATM to buy. Red = fairly priced.",
    score:(row)=>{
      const d=Math.abs(row.delta??0), iv=row.implied_vol??0;
      if(d<=0.20&&iv>=0.45) return "attractive";
      if(d>=0.38&&d<=0.62&&iv<=0.28) return "neutral";
      return "unattractive";
    },
  },
};

// ── Strategy sweet-spot guidance ─────────────────────────
const STRAT_FOCUS = {
  coveredCall:    { filt:"otm", label:"OTM calls",       range:"Δ 0.20–0.40 · IV ≥ 15%"              },
  cashSecuredPut: { filt:"otm", label:"OTM puts",        range:"Δ 0.20–0.40 · IV ≥ 15%"              },
  longStraddle:   { filt:"atm", label:"ATM contracts",   range:"Δ 0.40–0.60 · lowest IV"              },
  ironCondor:     { filt:"otm", label:"OTM legs",        range:"Short leg Δ 0.15–0.25 · wing 0.05–0.12" },
  bullCallSpread: { filt:"atm", label:"ATM→OTM calls",   range:"Long leg Δ 0.45–0.60 · sell leg 0.20–0.35" },
  bearPutSpread:  { filt:"atm", label:"ATM→OTM puts",    range:"Long leg Δ 0.45–0.60 · sell leg 0.20–0.35" },
  gammaScalping:  { filt:"atm", label:"ATM high-Γ",      range:"Δ 0.40–0.60 · Γ > 0.01"              },
  vegaHarvesting: { filt:"all", label:"High-IV",         range:"IV ≥ 40% · Δ 0.15–0.50"              },
  thetaDecay:     { filt:"otm", label:"OTM contracts",   range:"Θ/price ≥ 1.5%/day"                  },
  deltaHedging:   { filt:"atm", label:"ATM liquid",      range:"Δ 0.44–0.56 · OI ≥ 500"              },
  riskReversal:   { filt:"otm", label:"OTM both sides",  range:"Δ 0.20–0.35 calls + puts"            },
  skewArb:        { filt:"otm", label:"OTM wings",       range:"Δ < 0.20 · IV ≥ 45%"                },
};

function GreekCell({val, greek}) {
  const C = useC();
  if (val == null || isNaN(val)) return <span style={mono(9,C.mut)}>—</span>;
  const abs = Math.abs(val);
  const col = abs > 0.5 ? C.grn : abs > 0.2 ? C.sky : C.mut;
  return <span style={mono(9,col,600)}>{val.toFixed(3)}</span>;
}

// ── Opportunity analysis helpers ──────────────────────────
function getTopOpportunities(stratKey, contracts) {
  if (!stratKey || !contracts?.length) return [];
  const strat = OPTION_STRATEGIES[stratKey];
  if (!strat) return [];
  const attractive = contracts.filter(r => strat.score(r) === "attractive");
  if (!attractive.length) return [];
  const rank = (r) => {
    switch(stratKey) {
      case "coveredCall": case "cashSecuredPut":
        return Math.abs(r.theta ?? 0);
      case "longStraddle":
        return -(r.implied_vol ?? 1);
      case "gammaScalping":
        return r.gamma ?? 0;
      case "vegaHarvesting": case "skewArb":
        return r.implied_vol ?? 0;
      case "thetaDecay": {
        const p = r.last_price || ((r.bid??0)+(r.ask??0))/2;
        return p > 0.01 ? Math.abs(r.theta??0)/p : 0;
      }
      default: return r.open_interest ?? 0;
    }
  };
  return [...attractive].sort((a,b)=>rank(b)-rank(a)).slice(0,5);
}

function getOpportunityMetric(stratKey, row) {
  const iv = ((row.implied_vol??0)*100).toFixed(1)+"%";
  const price = row.last_price || ((row.bid??0)+(row.ask??0))/2;
  switch(stratKey) {
    case "coveredCall": case "cashSecuredPut":
      return {label:"Θ/day",   val:row.theta!=null?row.theta.toFixed(3):"—",    color:"#ff5252"};
    case "longStraddle":
      return {label:"IV",      val:iv,                                            color:"#40c4ff"};
    case "gammaScalping":
      return {label:"Γ",       val:row.gamma!=null?row.gamma.toFixed(4):"—",     color:"#b388ff"};
    case "vegaHarvesting": case "skewArb":
      return {label:"IV",      val:iv,                                            color:"#ffb300"};
    case "thetaDecay": {
      const ratio = price>0.01?(Math.abs(row.theta??0)/price*100).toFixed(1)+"%":"—";
      return {label:"Θ/Prem",  val:ratio,                                         color:"#ff5252"};
    }
    case "deltaHedging":
      return {label:"OI",      val:(row.open_interest??0).toLocaleString(),       color:"#40c4ff"};
    default:
      return {label:"Δ",       val:row.delta!=null?row.delta.toFixed(3):"—",     color:"#00e676"};
  }
}

function getStrategyInsight(stratKey, opps, spot) {
  if (!opps.length) return "No high-scoring contracts in this expiration. Try a different date.";
  const t = opps[0], n = opps.length;
  const iv   = t.implied_vol ? (t.implied_vol*100).toFixed(1)+"%" : "—";
  const da   = t.delta!=null ? Math.abs(t.delta).toFixed(2) : "—";
  const prem = (t.bid!=null&&t.ask!=null) ? ((t.bid+t.ask)/2).toFixed(2) : "—";
  const dist = spot&&t.strike ? ((t.strike-spot)/spot*100) : null;
  const ds   = dist!==null ? ` (${dist>=0?"+":""}${dist.toFixed(1)}% from spot)` : "";
  switch(stratKey) {
    case "coveredCall":
      return `${n} sweet-spot calls found. Strike $${t.strike}${ds} leads with Θ ${t.theta?.toFixed(3)}/day — collecting ~$${prem}/share reduces your cost basis immediately.`;
    case "cashSecuredPut":
      return `${n} target puts found. Strike $${t.strike}${ds} offers ~$${prem}/share — effective buy price if assigned: $${(t.strike-Number(prem)).toFixed(2)}.`;
    case "longStraddle":
      return `${n} ATM candidates. $${t.strike} has the lowest IV (${iv}) — cheaper straddle means a smaller breakeven move needed to profit.`;
    case "ironCondor":
      return `${n} short-leg candidates near Δ ${da}. Sell these strikes on both sides to define a profitable range around spot $${spot?.toFixed(2)}.`;
    case "bullCallSpread":
      return `Buy the $${t.strike} call (Δ ${da}) as the long leg, then sell a higher-strike call to offset premium cost. ${n} liquid legs available.`;
    case "bearPutSpread":
      return `Buy the $${t.strike} put (Δ ${da}) as the long leg, then sell a lower-strike put to offset premium cost. ${n} liquid legs available.`;
    case "gammaScalping":
      return `Peak gamma at $${t.strike} (Γ ${t.gamma?.toFixed(4)}) — delta shifts fastest here per $1 move, creating the most frequent rebalancing opportunities.`;
    case "vegaHarvesting":
      return `Richest vol at $${t.strike} (${iv} IV) — selling here captures the most volatility risk premium per unit of vega. ${n} attractive contracts.`;
    case "thetaDecay": {
      const price = t.last_price||((t.bid??0)+(t.ask??0))/2;
      const ratio = price>0?(Math.abs(t.theta??0)/price*100).toFixed(1):"—";
      return `Best decay at $${t.strike} — ${ratio}%/day theta-to-premium ratio. With ${n} similar strikes, short positions here maximize time-decay income.`;
    }
    case "deltaHedging":
      return `Most liquid at $${t.strike} (${(t.open_interest??0).toLocaleString()} OI, Δ ${da}) — high OI means tight spreads and minimal impact when adjusting delta.`;
    case "riskReversal":
      return `${n} strikes near Δ ${da} suitable for both legs. Buy OTM calls, sell OTM puts here for a net-zero or credit bullish position.`;
    case "skewArb":
      return `Highest skew at $${t.strike} (${iv}) — these expensive wings are prime candidates to sell when the vol smile steepens beyond historical norms.`;
    default:
      return `${n} attractive contracts found. Focus on the green-outlined rows in the chain table for best entry points.`;
  }
}

// ── Action Brief helpers ──────────────────────────────
function generateBrief(symbol, spot, summary, analytics, mktOverview) {
  const lines = [];

  // ── 1. IV posture + strategy class ──────────────────
  const ivr = analytics?.iv_rank;
  const avgIV = summary?.avg_iv_call;
  if (ivr != null) {
    const pct = (ivr * 100).toFixed(0);
    const [posture, strats] =
      ivr > 0.70 ? ["historically elevated — premium-selling conditions", "Iron Condor, Vega Harvesting, Covered Call"]
    : ivr > 0.45 ? ["moderate — no strong edge to buyers or sellers",      "Balanced spreads, Risk Reversal, Theta Decay"]
    :              ["historically depressed — buying vol is cheap",         "Long Straddle, Gamma Scalping"];
    lines.push({ icon:"📊", color:"#ffb300",
      text:`IV Rank ${pct}%: implied vol is ${posture}. Best-fit strategy classes right now: ${strats}.` });
  } else if (avgIV != null) {
    lines.push({ icon:"📊", color:"#ffb300",
      text:`Average call IV is ${(avgIV*100).toFixed(1)}%. Fetch analytics to compute IV Rank for richer context.` });
  }

  // ── 2. Max Pain gravity ──────────────────────────────
  if (analytics?.max_pain != null && spot) {
    const mp = analytics.max_pain;
    const distPct = ((mp - spot) / spot * 100);
    const dir = distPct >= 0 ? "above" : "below";
    const abs = Math.abs(distPct).toFixed(1);
    const gravity = Math.abs(distPct) < 0.8
      ? "nearly at spot — minimal pin-risk pull; stock may stay pinned near current levels"
      : `${abs}% ${dir} spot — ${dir === "below" ? "bearish" : "bullish"} gravitational pull as expiry approaches; option writers will defend $${mp.toFixed(0)}`;
    lines.push({ icon:"📍", color:"#b388ff",
      text:`Max Pain at $${mp.toFixed(0)} is ${gravity}.` });
  }

  // ── 3. Macro regime ──────────────────────────────────
  if (mktOverview?.vix?.value != null) {
    const vix   = mktOverview.vix.value;
    const regime = mktOverview.vix.regime?.replace(/_/g," ") ?? "unknown";
    const sent  = mktOverview.sentiment;
    const adv   = mktOverview.sectors?.filter(s => s.change_pct > 0).length ?? 0;
    const tot   = mktOverview.sectors?.length ?? 11;
    const breadth = adv <= 3 ? "broadly risk-off" : adv >= 8 ? "broadly risk-on" : "mixed sector participation";
    const advice  = vix > 25 ? "Elevated vol: widen strikes, reduce size, favour short-premium."
                  : vix < 15 ? "Low-vol: options are cheap — prefer long-gamma and debit spreads."
                  :            "Moderate vol: standard sizing; both buyers and sellers can find edge.";
    const mktColor = vix > 25 ? "#ff5252" : vix > 18 ? "#ffb300" : "#00e676";
    lines.push({ icon:"🌍", color: mktColor,
      text:`Macro: VIX ${vix.toFixed(1)} (${regime}), Fear & Greed ${sent?.score} (${sent?.label}), ${adv}/${tot} sectors advancing (${breadth}). ${advice}` });
  }

  // ── 4. Options flow signal (Put/Call ratio) ──────────
  if (summary?.put_call_ratio != null) {
    const pcr = summary.put_call_ratio;
    const signal = pcr > 1.5 ? "extreme put buying — contrarian bullish signal or heavy hedging underway"
                 : pcr > 1.1 ? "elevated put interest — participants are hedging downside risk"
                 : pcr > 0.8 ? "neutral flow — no strong directional options bias"
                 :              "call-heavy flow — bullish positioning is dominant";
    const action = pcr > 1.3 ? " Selling puts into this demand can offer favourable entry premiums."
                 : pcr < 0.7 ? " Elevated complacency; consider protective puts or short calls above resistance."
                 : "";
    lines.push({ icon:"📈", color:"#40c4ff",
      text:`P/C Ratio ${pcr.toFixed(2)}: ${signal}.${action}` });
  }

  // ── 5. Volatility risk premium (IV vs HV) ────────────
  if (analytics?.iv_hv_spread != null && analytics?.hv30 != null) {
    const spread  = (analytics.iv_hv_spread * 100);
    const hv30    = (analytics.hv30 * 100).toFixed(1);
    const curIV   = analytics.current_iv ? (analytics.current_iv * 100).toFixed(1) : "—";
    const positive = analytics.iv_hv_spread > 0;
    const spreadStr = Math.abs(spread).toFixed(1);
    const txt = positive
      ? `IV (${curIV}%) is ${spreadStr}pp above HV30 (${hv30}%) — a positive vol premium exists. Statistically, option sellers have historically captured this edge over time.`
      : `IV (${curIV}%) is ${spreadStr}pp below HV30 (${hv30}%) — rare: options are cheap relative to recent realised moves. Favour long-vol strategies.`;
    lines.push({ icon:"⚡", color: positive ? "#00e676" : "#ff5252", text: txt });
  }

  return lines;
}

// ── Action Brief component ────────────────────────────
function ActionBriefPanel({ symbol, summary, spot }) {
  const C = useC();
  const [analytics, setAnalytics] = useState(null);
  const [mktOverview, setMktOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const snapshotKey = summary?.snapshot_at ?? null;

  useEffect(() => {
    if (!symbol || !summary) return;
    setLoading(true);
    setAnalytics(null);
    setMktOverview(null);
    Promise.all([
      fetch(`/api/options/${symbol}/analytics`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/market/overview").then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([anal, mkt]) => {
      setAnalytics(anal);
      setMktOverview(mkt);
      setLoading(false);
    });
  }, [symbol, snapshotKey]);

  if (!summary) return null;

  const sentences = generateBrief(symbol, spot, summary, analytics, mktOverview);

  if (loading) return (
    <Card accent={C.grn}>
      <div style={{display:"flex",alignItems:"center",gap:8,...mono(10,C.mut),padding:"4px 0"}}>
        <RefreshCw size={11}/> Generating action brief for {symbol}…
      </div>
    </Card>
  );

  if (!sentences.length) return null;

  return (
    <Card accent={C.grn}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <Lbl color={C.grn}>Action Brief · {symbol}</Lbl>
          <div style={mono(9,C.mut)}>Synthesised from IV rank · max pain · macro regime · options flow · vol premium</div>
        </div>
        <Tag color={C.mut}>Not financial advice</Tag>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {sentences.map((s, i) => (
          <div key={i} style={{
            display:"flex", gap:10, alignItems:"flex-start",
            padding:"9px 13px", borderRadius:8,
            background: C.dim,
            borderLeft: `3px solid ${s.color}`,
          }}>
            <span style={{flexShrink:0, fontSize:13, marginTop:1}}>{s.icon}</span>
            <span style={{...mono(11,C.txt), lineHeight:1.75}}>{s.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Options Analytics Panel ───────────────────────────
function OptionsAnalyticsPanel({symbol, expiration}) {
  const C = useC();
  const TT = makeTT(C);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setData(null);
    setLoading(true);
    const qs = expiration ? `?expiration=${expiration}` : "";
    fetch(`/api/options/${symbol}/analytics${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, expiration]);

  if (loading) return (
    <Card><div style={{...mono(10,C.mut),textAlign:"center",padding:"14px 0"}}>
      <RefreshCw size={12}/> Computing analytics…
    </div></Card>
  );
  if (!data) return null;

  const gex = (data.gex || []).filter(g => g.net_gex !== 0);
  const gexTop = gex.slice(0, 22);
  const deltaOi = data.delta_oi || [];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── IVR / HV stats ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}>
        {[
          {l:"IV Rank",    v: data.iv_rank!=null?`${(data.iv_rank*100).toFixed(0)}%`:"—",
            c: data.iv_rank>0.7?C.grn:data.iv_rank>0.4?C.amb:C.red,
            sub:"1-yr HV range", tip:"IV Rank: how elevated current IV is vs its 1-year range. >70% = rich vol, good for selling premium."},
          {l:"IV Pctile",  v: data.iv_percentile!=null?`${(data.iv_percentile*100).toFixed(0)}%`:"—",
            c: C.sky, sub:"% of HV days below",
            tip:"IV Percentile: fraction of the last year where IV was below today's level. High = historically expensive."},
          {l:"HV20",       v: data.hv20!=null?`${(data.hv20*100).toFixed(1)}%`:"—",
            c: C.mut, sub:"20-day realized vol",
            tip:"Historical Volatility over 20 days, annualised. Compare with IV to see the vol risk premium."},
          {l:"HV30",       v: data.hv30!=null?`${(data.hv30*100).toFixed(1)}%`:"—",
            c: C.mut, sub:"30-day realized vol",
            tip:"Historical Volatility over 30 days, annualised. Longer window, less noise."},
          {l:"IV − HV30",  v: data.iv_hv_spread!=null?`${(data.iv_hv_spread*100>0?"+":"")}${(data.iv_hv_spread*100).toFixed(1)}pp`:"—",
            c: data.iv_hv_spread>0?C.amb:C.grn,
            sub:"vol risk premium",
            tip:"Implied minus realized vol (vol premium). Positive = sellers of vol historically have an edge."},
        ].map(({l,v,c,sub,tip})=>(
          <Card key={l}>
            <div style={{...mono(9,C.mut,700),letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>
              {tip
                ? <InfoTip desc={tip} bands={[]}><span style={{cursor:"help",borderBottom:`1px dashed ${C.mut}`}}>{l}</span></InfoTip>
                : l}
            </div>
            <div style={mono(20,c,800)}>{v}</div>
            {sub&&<div style={{...mono(9,C.mut),marginTop:3}}>{sub}</div>}
          </Card>
        ))}
      </div>

      {/* ── Max Pain + GEX ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:12}}>
        {/* Max Pain */}
        {data.max_pain && (
          <Card>
            <Lbl color={C.amb}>Max Pain Strike</Lbl>
            <div style={mono(28,C.amb,800)}>${data.max_pain}</div>
            <div style={{...mono(9,C.mut),marginTop:6,lineHeight:1.65}}>
              Strike where cumulative buyer losses are maximised at expiration. Often acts as a magnet for price near expiry.
            </div>
          </Card>
        )}
        {!data.max_pain && <div/>}

        {/* GEX bar chart */}
        {gexTop.length > 0 && (
          <Card>
            <Lbl>Gamma Exposure (GEX) · By Strike</Lbl>
            <div style={{...mono(9,C.mut),marginBottom:8}}>+ = dealers long gamma (stabilising) · − = dealers short gamma (amplifying volatility)</div>
            <ChartPanel title="Gamma Exposure (GEX) By Strike" defaultHeight={150}>
            {(h) => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={gexTop} margin={{top:4,right:8,bottom:18,left:46}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                <XAxis dataKey="strike" tick={mono(7,C.mut)} angle={-45} textAnchor="end" interval={Math.ceil(gexTop.length/10)}/>
                <YAxis tick={mono(7,C.mut)} width={36} tickFormatter={v=>v>=1e6?`${(v/1e6).toFixed(0)}M`:v>=1e3?`${(v/1e3).toFixed(0)}k`:v}
                  label={{value:"Net GEX",angle:-90,position:"insideLeft",offset:18,
                    style:{fontFamily:"monospace",fontSize:7,fill:C.mut,textAnchor:"middle"}}}/>
                <Tooltip {...TT} formatter={(v,n) => [v.toFixed(0), n === "net_gex" ? "Net GEX" : n]}/>
                <ReferenceLine y={0} stroke={C.mut} strokeDasharray="2 2"/>
                <Bar dataKey="net_gex" name="Net GEX">
                  {gexTop.map((entry,i)=>(
                    <Cell key={`gex-${i}`} fill={entry.net_gex>=0?C.grn:C.red}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )}
            </ChartPanel>
          </Card>
        )}
      </div>

      {/* ── ΔOI Table ── */}
      {deltaOi.length > 0 && (
        <Card>
          <Lbl>ΔOI · Open Interest Change vs Prior Snapshot</Lbl>
          <div style={{...mono(9,C.mut),marginBottom:8}}>Largest OI shifts since last refresh — watch for unusual accumulation or unwinding.</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace"}}>
              <thead>
                <tr style={{background:C.dim}}>
                  {[["STRIKE","right"],["TYPE","center"],["ΔOI","right"],["CUR OI","right"],["PREV OI","right"]].map(([h,a])=>(
                    <th key={h} style={{...mono(8,C.mut,700),padding:"4px 8px",borderBottom:`1px solid ${C.bdr}`,textAlign:a,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deltaOi.slice(0,15).map((r,i)=>{
                  const big = Math.abs(r.delta_oi) > 500;
                  return (
                    <tr key={i} style={{background:big?"transparent":"transparent"}}>
                      <td style={{...mono(10,C.txt),padding:"3px 8px",textAlign:"right",borderBottom:`1px solid ${C.dim}`}}>${r.strike}</td>
                      <td style={{padding:"3px 8px",textAlign:"center",borderBottom:`1px solid ${C.dim}`}}>
                        <span style={{...mono(8,r.option_type==="call"?C.grn:C.red,700),padding:"1px 5px",borderRadius:3,background:r.option_type==="call"?C.grnBg:C.red+"15"}}>
                          {r.option_type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{...mono(10,r.delta_oi>0?C.grn:C.red,700),padding:"3px 8px",textAlign:"right",borderBottom:`1px solid ${C.dim}`}}>
                        {r.delta_oi>0?"+":""}{r.delta_oi.toLocaleString()}
                      </td>
                      <td style={{...mono(9,C.mut),padding:"3px 8px",textAlign:"right",borderBottom:`1px solid ${C.dim}`}}>{r.current_oi.toLocaleString()}</td>
                      <td style={{...mono(9,C.mut),padding:"3px 8px",textAlign:"right",borderBottom:`1px solid ${C.dim}`}}>{r.prev_oi.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Options Advanced Panel (Term Structure · Skew · HV Trend · Liquidity · Catalyst) ──
function OptionsAdvancedPanel({ symbol, snapshotKey }) {
  const C  = useC();
  const TT = makeTT(C);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [tsHover, setTsHover] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setData(null);
    fetch(`/api/options/${symbol}/advanced`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, snapshotKey]);

  if (loading) return (
    <Card>
      <div style={{display:"flex",alignItems:"center",gap:8,...mono(10,C.mut),padding:"6px 0"}}>
        <RefreshCw size={11}/> Loading advanced analytics — term structure · skew · HV trend · catalysts…
      </div>
    </Card>
  );
  if (!data) return null;

  const ts        = data.term_structure || [];
  const hvTrend   = data.hv_trend       || [];
  const liqStats  = data.liquidity_stats || {};
  const earnings  = data.earnings_date;

  // Term structure shape
  const tsPoints = ts.filter(t => t.atm_iv != null);
  const tsFirst  = tsPoints[0]?.atm_iv;
  const tsLast   = tsPoints[tsPoints.length - 1]?.atm_iv;
  const tsShape  = !tsFirst || !tsLast ? null
    : tsFirst > tsLast * 1.02 ? "Backwardation"
    : tsLast  > tsFirst * 1.02 ? "Contango"
    : "Flat";
  const tsColor = tsShape === "Backwardation" ? C.red : tsShape === "Contango" ? C.grn : C.amb;

  // Average 25Δ skew across expirations
  const skewVals = ts.filter(t => t.skew != null).map(t => t.skew);
  const avgSkew  = skewVals.length ? skewVals.reduce((a,b) => a+b, 0) / skewVals.length : null;
  const skewColor = avgSkew == null ? C.mut
    : avgSkew > 0.04 ? C.red : avgSkew > 0.01 ? C.amb : avgSkew > -0.01 ? C.grn : C.sky;

  // Liquidity aggregate
  const totalContracts   = Object.values(liqStats).reduce((s,v) => s + (v.total       || 0), 0);
  const totalLiquid1000  = Object.values(liqStats).reduce((s,v) => s + (v.liquid_1000 || 0), 0);
  const liquidPct        = totalContracts > 0 ? totalLiquid1000 / totalContracts : 0;
  const liqColor = liquidPct > 0.3 ? C.grn : liquidPct > 0.1 ? C.amb : C.red;

  // HV trend direction
  let hvTrendDir = null, hvTrendColor = C.mut;
  if (hvTrend.length >= 20) {
    const recent   = hvTrend.slice(-10).map(d => d.hv);
    const older    = hvTrend.slice(-30, -10).map(d => d.hv);
    const rAvg = recent.reduce((a,b)=>a+b,0)/recent.length;
    const oAvg = older.length ? older.reduce((a,b)=>a+b,0)/older.length : rAvg;
    hvTrendDir   = rAvg > oAvg * 1.05 ? "Rising ↑" : rAvg < oAvg * 0.95 ? "Falling ↓" : "Stable →";
    hvTrendColor = hvTrendDir.startsWith("Rising") ? C.red : hvTrendDir.startsWith("Falling") ? C.grn : C.mut;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── Section header ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,paddingBottom:2,borderBottom:`1px solid ${C.bdr}`}}>
        <Lbl color={C.sky}>Advanced Signal Panel · {symbol}</Lbl>
        <div style={{...mono(9,C.mut)}}>Term Structure · Skew · HV Trend · Liquidity · Catalysts</div>
      </div>

      {/* ── Row 1: Term Structure chart + Skew / Shape cards ── */}
      {ts.length >= 2 && (
        <div style={{display:"grid",gridTemplateColumns:"3fr 1fr",gap:14}}>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:8,flex:1,minWidth:0}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <Lbl>IV Term Structure</Lbl>
                    {/* ── Hover Info Trigger ── */}
                    <div style={{position:"relative",display:"inline-block"}}
                      onMouseEnter={()=>setTsHover(true)} onMouseLeave={()=>setTsHover(false)}>
                      <span style={{...mono(10,C.mut,600),cursor:"help",
                        width:16,height:16,borderRadius:"50%",border:`1px solid ${C.mut}60`,
                        display:"inline-flex",alignItems:"center",justifyContent:"center",
                        userSelect:"none",flexShrink:0}}>ⓘ</span>
                      {tsHover && (() => {
                        // ── Data-driven insights ──
                        const validPts = tsPoints.filter(t => t.atm_iv != null);
                        const nearPt   = validPts[0];
                        const farPt    = validPts[validPts.length - 1];
                        const peakPt   = validPts.reduce((a,b) => (b.atm_iv > a.atm_iv ? b : a), validPts[0]);
                        const nearIV   = nearPt  ? (nearPt.atm_iv  * 100).toFixed(1) : null;
                        const farIV    = farPt   ? (farPt.atm_iv   * 100).toFixed(1) : null;
                        const peakIV   = peakPt  ? (peakPt.atm_iv  * 100).toFixed(1) : null;
                        const slope    = nearPt && farPt
                          ? ((farPt.atm_iv - nearPt.atm_iv) / nearPt.atm_iv * 100).toFixed(0)
                          : null;
                        // Kink detection: point where IV spikes >30% above its neighbours
                        const kinks = validPts.filter((p,i) => {
                          if (i === 0 || i === validPts.length - 1) return false;
                          const prev = validPts[i-1].atm_iv, next = validPts[i+1].atm_iv;
                          const avg  = (prev + next) / 2;
                          return p.atm_iv > avg * 1.3;
                        });
                        const tradeNote = tsShape === "Backwardation"
                          ? "Near-term IV is elevated — market is pricing in stress or event risk imminently. Your bearish thesis may already be early-stage confirmed."
                          : tsShape === "Contango"
                          ? "Normal structure — no panic yet. Puts in near-term expirations are relatively cheap vs further out. 60–120 DTE is the sweet spot."
                          : "Flat structure — IV is priced uniformly. No strong directional signal from term structure alone.";
                        return (
                          <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,width:340,zIndex:2000,
                            background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:10,
                            padding:"14px 16px",boxShadow:"0 10px 36px rgba(0,0,0,.65)",pointerEvents:"none"}}>
                            {/* What it shows */}
                            <div style={{...mono(9,C.grn,700),letterSpacing:".1em",marginBottom:6}}>WHAT THIS SHOWS</div>
                            <p style={{...mono(10,C.mut),lineHeight:1.75,marginBottom:12}}>
                              Implied Volatility plotted for each expiration date, from shortest to longest duration. Each dot = the ATM IV priced into options expiring that day. The shape of this curve reveals how nervous the market is about <em>near-term</em> vs <em>long-term</em> risk.
                            </p>
                            {/* How to read */}
                            <div style={{...mono(9,C.sky,700),letterSpacing:".1em",marginBottom:6}}>HOW TO READ IT</div>
                            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12}}>
                              {[
                                {col:C.grn,  lbl:"Upward slope (Contango)",  txt:"Normal. Long-term uncertainty > short-term. No panic."},
                                {col:C.red,  lbl:"Downward slope (Backwardation)", txt:"Stress signal. Near-term IV spikes above long-term. Something is feared imminently."},
                                {col:C.amb,  lbl:"Kink / spike at one DTE",  txt:"Event risk (earnings, FOMC, CPI) priced into that specific expiry."},
                              ].map(({col,lbl,txt}) => (
                                <div key={lbl} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                                  <div style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0,marginTop:3}}/>
                                  <div>
                                    <span style={{...mono(9,col,700)}}>{lbl}: </span>
                                    <span style={mono(9,C.mut)}>{txt}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {/* Live data insights */}
                            <div style={{...mono(9,C.amb,700),letterSpacing:".1em",marginBottom:6}}>LIVE INSIGHTS · {symbol}</div>
                            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12}}>
                              {nearPt && farPt && (
                                <div style={{...mono(9,C.mut),lineHeight:1.6}}>
                                  <span style={{color:C.sky}}>Near-term ({nearPt.dte}d):</span> {nearIV}% IV &nbsp;→&nbsp;
                                  <span style={{color:C.sky}}>Long-term ({farPt.dte}d):</span> {farIV}% IV
                                  {slope && <span style={{color: Number(slope) < 0 ? C.grn : C.red}}> ({slope > 0 ? "+" : ""}{slope}% slope)</span>}
                                </div>
                              )}
                              {peakPt && (
                                <div style={{...mono(9,C.mut),lineHeight:1.6}}>
                                  <span style={{color:C.amb}}>Peak IV:</span> {peakIV}% at DTE {peakPt.dte} ({peakPt.expiration})
                                  {peakPt !== nearPt && <span style={{color:C.mut}}> — event risk concentrated here</span>}
                                </div>
                              )}
                              {kinks.length > 0 && (
                                <div style={{...mono(9,C.mut),lineHeight:1.6}}>
                                  <span style={{color:C.red}}>⚠ Kinks detected</span> at DTE {kinks.map(k=>k.dte).join(", ")} — unusual IV spikes suggest known catalyst at {kinks.length === 1 ? "that expiry" : "those expiries"}.
                                </div>
                              )}
                              <div style={{...mono(9,C.sky),lineHeight:1.65,marginTop:2,paddingTop:6,borderTop:`1px solid ${C.bdr}`}}>
                                💡 {tradeNote}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <div style={mono(9,C.mut)}>ATM IV across expirations · backwardation = near-term stress · contango = normal</div>
                </div>
              </div>
              {tsShape && <Tag color={tsColor}>{tsShape}{tsShape==="Backwardation" ? " ⚠" : " ✓"}</Tag>}
            </div>
            <ChartPanel title="IV Term Structure" defaultHeight={165}>
            {(h) => (
              <ResponsiveContainer width="100%" height={h}>
                <ComposedChart data={tsPoints} margin={{top:4,right:55,bottom:22,left:46}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                  <XAxis dataKey="dte" tick={mono(8,C.mut)}
                    label={{value:"Days to Expiry (DTE)",position:"insideBottom",offset:-8,style:{fontFamily:"monospace",fontSize:7,fill:C.mut}}}/>
                  <YAxis tick={mono(8,C.mut)} width={40} tickFormatter={v=>`${(v*100).toFixed(0)}%`}
                    label={{value:"Implied Vol",angle:-90,position:"insideLeft",offset:22,style:{fontFamily:"monospace",fontSize:7,fill:C.mut,textAnchor:"middle"}}}/>
                  <Tooltip {...TT} formatter={(v,n) => [`${(v*100).toFixed(1)}%`, n==="atm_iv"?"ATM IV":n==="put_25d_iv"?"Put 25Δ":n==="call_25d_iv"?"Call 25Δ":n]}/>
                  <Line type="monotone" dataKey="atm_iv"      stroke={C.sky} strokeWidth={2}   dot={{r:3,fill:C.sky}}  name="atm_iv"/>
                  <Line type="monotone" dataKey="put_25d_iv"  stroke={C.red} strokeWidth={1.5} dot={false} strokeDasharray="5 3" name="put_25d_iv"/>
                  <Line type="monotone" dataKey="call_25d_iv" stroke={C.grn} strokeWidth={1.5} dot={false} strokeDasharray="5 3" name="call_25d_iv"/>
                </ComposedChart>
              </ResponsiveContainer>
            )}
            </ChartPanel>
            <div style={{...mono(9,C.mut),marginTop:6,display:"flex",gap:16,flexWrap:"wrap"}}>
              <span style={{color:C.sky}}>─ ATM IV</span>
              <span style={{color:C.red}}>-- Put 25Δ</span>
              <span style={{color:C.grn}}>-- Call 25Δ</span>
            </div>
          </Card>

          {/* Skew + Shape summary */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Card>
              <div style={{...mono(8,C.mut,700),letterSpacing:".12em",textTransform:"uppercase",marginBottom:6}}>25Δ Skew</div>
              <div style={mono(22,skewColor,800)}>
                {avgSkew != null ? `${avgSkew > 0 ? "+" : ""}${(avgSkew*100).toFixed(1)}pp` : "—"}
              </div>
              <div style={{...mono(9,C.mut),marginTop:5,lineHeight:1.65}}>
                {avgSkew == null          ? "Need more data"
                : avgSkew > 0.05         ? "Puts very expensive — heavy institutional hedging"
                : avgSkew > 0.02         ? "Put premium elevated — hedging demand present"
                : avgSkew > -0.01        ? "Flat — complacency, puts underpriced"
                :                          "Calls rich vs puts — upside demand dominant"}
              </div>
            </Card>
            <Card>
              <div style={{...mono(8,C.mut,700),letterSpacing:".12em",textTransform:"uppercase",marginBottom:6}}>Structure</div>
              <div style={mono(15,tsColor,700)}>{tsShape ?? "—"}</div>
              <div style={{...mono(9,C.mut),marginTop:5,lineHeight:1.65}}>
                {tsShape === "Backwardation" ? "Short-term IV > long-term — panic / near-term risk signal. Bearish thesis confirmation."
                : tsShape === "Contango"     ? "Short-term IV < long-term — normal. No immediate stress."
                : tsShape === "Flat"         ? "Flat term structure — no strong directional vol signal."
                : "Need ≥2 expirations"}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Row 2: HV Trend chart + Liquidity ── */}
      <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"2fr 1fr",gap:14}}>

        {/* HV Trend */}
        {hvTrend.length > 10 ? (
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <Lbl>HV20 Trend · 90 Days</Lbl>
                <div style={mono(9,C.mut)}>Rising HV = market unstable, options worth buying · Falling HV = decay danger zone</div>
              </div>
              {hvTrendDir && <Tag color={hvTrendColor}>{hvTrendDir}</Tag>}
            </div>
            <ChartPanel title="HV20 Trend" defaultHeight={140}>
            {(h) => (
              <ResponsiveContainer width="100%" height={h}>
                <AreaChart data={hvTrend} margin={{top:4,right:55,bottom:18,left:40}}>
                  <defs>
                    <linearGradient id="hvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.amb} stopOpacity={0.28}/>
                      <stop offset="95%" stopColor={C.amb} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                  <XAxis dataKey="date" tick={mono(7,C.mut)}
                    tickFormatter={d => d ? d.slice(5) : ""}
                    interval={Math.ceil(hvTrend.length / 8)}/>
                  <YAxis tick={mono(8,C.mut)} width={32} tickFormatter={v=>`${v}%`}/>
                  <Tooltip {...TT} formatter={(v) => [`${Number(v).toFixed(1)}%`, "HV20"]}/>
                  <Area type="monotone" dataKey="hv" stroke={C.amb} fill="url(#hvGrad)" strokeWidth={1.8} dot={false}/>
                  {hvTrend.length > 0 && (
                    <ReferenceLine y={hvTrend[hvTrend.length-1].hv} stroke={C.amb} strokeDasharray="4 2" strokeWidth={1}
                      label={{value:`Now: ${hvTrend[hvTrend.length-1].hv.toFixed(1)}%`,position:"right",fill:C.amb,fontSize:8,fontFamily:"monospace"}}/>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
            </ChartPanel>
            {hvTrendDir && (
              <div style={{...mono(9,C.mut),marginTop:6}}>
                10-day avg vs prior 20-day: <span style={{color:hvTrendColor,fontWeight:700}}>{hvTrendDir}</span>
                {hvTrendDir.startsWith("Rising")  ? " — Confirms unstable market; long-vol thesis supported" : ""}
                {hvTrendDir.startsWith("Falling") ? " — Caution: rapid decay environment, hold time is costly" : ""}
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <Lbl>HV20 Trend</Lbl>
            <div style={{...mono(10,C.mut),padding:"14px 0"}}>Insufficient price history for HV trend. Try fetching after market hours.</div>
          </Card>
        )}

        {/* Liquidity Quality */}
        <Card>
          <Lbl>Liquidity Quality</Lbl>
          <div style={{...mono(9,C.mut),marginBottom:10}}>Rule: only trade OI ≥ 1,000 · tight spreads</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={mono(9,C.mut)}>OI ≥ 1,000</span>
              <span style={{...mono(16,liqColor,800)}}>{totalLiquid1000} / {totalContracts}</span>
            </div>
            <div style={{height:5,background:C.dim,borderRadius:3,overflow:"hidden"}}>
              <div style={{width:`${Math.min(100,liquidPct*100)}%`,height:"100%",background:liqColor,opacity:0.85,transition:"width .4s"}}/>
            </div>
            <div style={{...mono(9,C.mut),lineHeight:1.65}}>
              {liquidPct > 0.3  ? "Good — most contracts tradable at scale"
              : liquidPct > 0.1 ? "Moderate — focus on high-OI strikes only"
              :                   "Poor — widespread illiquidity, use caution or avoid"}
            </div>
            <div style={{borderTop:`1px solid ${C.bdr}`,paddingTop:8,marginTop:2}}>
              {Object.entries(liqStats).slice(0,6).map(([exp, s]) => (
                <div key={exp} style={{display:"flex",justifyContent:"space-between",marginBottom:3,gap:8}}>
                  <span style={mono(8,C.mut)}>{exp}</span>
                  <span style={{...mono(8,s.liquid_1000 > 0 ? C.grn : C.amb),textAlign:"right"}}>
                    {s.liquid_1000}× liquid · {s.liquid_100}× decent
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row 3: Catalyst Calendar + Decision Framework ── */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
          <Lbl>Catalyst Calendar · {symbol}</Lbl>
          <div style={mono(9,C.mut)}>Options move around events — know what's ahead</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"repeat(3,1fr)",gap:10,marginBottom:14}}>
          {/* Earnings */}
          <div style={{padding:"12px 14px",borderRadius:8,background:C.dim,border:`2px solid ${earnings ? C.amb+"80" : C.bdr}`}}>
            <div style={{...mono(8,C.mut,700),letterSpacing:".12em",marginBottom:6}}>EARNINGS DATE</div>
            <div style={mono(14,earnings ? C.amb : C.mut,700)}>{earnings ?? "Not available"}</div>
            {earnings && (
              <div style={{...mono(9,C.mut),marginTop:5,lineHeight:1.65}}>
                IV expands into earnings, then collapses post-event (IV crush). Size down after print.
              </div>
            )}
            {!earnings && (
              <div style={{...mono(9,C.mut),marginTop:5,lineHeight:1.65}}>
                ETF or no upcoming earnings. Check company IR page for event risk.
              </div>
            )}
          </div>
          {/* FOMC */}
          {(() => {
            // 2026 FOMC scheduled meeting dates (federalreserve.gov)
            const FOMC_2026 = [
              {dates:"Jan 27–28",  end:"2026-01-28"},
              {dates:"Mar 17–18",  end:"2026-03-18"},
              {dates:"Apr 28–29",  end:"2026-04-29"},
              {dates:"Jun 9–10",   end:"2026-06-10"},
              {dates:"Jul 28–29",  end:"2026-07-29"},
              {dates:"Sep 15–16",  end:"2026-09-16"},
              {dates:"Oct 27–28",  end:"2026-10-28"},
              {dates:"Dec 8–9",    end:"2026-12-09"},
            ];
            const today = new Date().toISOString().slice(0,10);
            const upcoming = FOMC_2026.filter(m => m.end >= today);
            const next     = upcoming[0]  ?? null;
            const after    = upcoming[1]  ?? null;
            const daysAway = next
              ? Math.round((new Date(next.end) - new Date(today)) / 86400000)
              : null;
            const urgent = daysAway != null && daysAway <= 14;
            return (
              <div style={{padding:"12px 14px",borderRadius:8,background:C.dim,
                border:`2px solid ${urgent ? C.red+"80" : next ? C.sky+"40" : C.bdr}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{...mono(8,C.mut,700),letterSpacing:".12em"}}>FOMC / FED MEETING</div>
                  {urgent && <Tag color={C.red}>Soon</Tag>}
                </div>
                {next ? (
                  <>
                    <div style={mono(14,urgent ? C.red : C.sky, 700)}>{next.dates}, 2026</div>
                    <div style={{...mono(9,C.mut),marginTop:3}}>
                      {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `${daysAway} days away`}
                      {after && <span> · Next: {after.dates}</span>}
                    </div>
                  </>
                ) : (
                  <div style={mono(12,C.mut,600)}>No more 2026 meetings</div>
                )}
                <div style={{...mono(9,C.mut),marginTop:6,lineHeight:1.65}}>
                  {urgent
                    ? "⚠ FOMC is imminent — IV will expand. Widen strikes, reduce size. Rate surprises = gap moves."
                    : "Fed meetings spike VIX and all IV surfaces. Avoid selling premium in the week prior."}
                </div>
              </div>
            );
          })()}
          {/* CPI/PCE/Jobs */}
          <div style={{padding:"12px 14px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
            <div style={{...mono(8,C.mut,700),letterSpacing:".12em",marginBottom:6}}>CPI · PCE · JOBS</div>
            <div style={mono(11,C.sky,600)}>bls.gov · bea.gov</div>
            <div style={{...mono(9,C.mut),marginTop:5,lineHeight:1.65}}>
              High-impact macro prints. Own puts ahead of prints when market is complacent (VIX &lt; 15). PCE is Fed's preferred measure.
            </div>
          </div>
        </div>

        {/* Decision Framework */}
        <div style={{padding:"10px 14px",borderRadius:8,background:C.grnBg,border:`1px solid ${C.grn}20`}}>
          <div style={{...mono(9,C.grn,700),marginBottom:8}}>4-STEP PUT-BUYING DECISION FRAMEWORK</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
            {[
              {step:"① Environment",    check:"IV not extreme · P/C skew flat → complacency",     action:"Puts are underpriced — best time to buy"},
              {step:"② Timing",         check:"VIX rising? Near resistance? Market rolling over?",  action:"Start position; momentum confirms thesis"},
              {step:"③ Structure",      check:"ATM / slight OTM · 60–120 DTE · OI ≥ 1,000",       action:"Avoid deep OTM illiquid strikes at all costs"},
              {step:"④ Confirmation",   check:"P/C ratio rising · IV expanding · GEX flipping −",  action:"Add aggressively — thesis validated, add size"},
            ].map(({step,check,action}) => (
              <div key={step} style={{padding:"8px 12px",borderRadius:6,background:C.dim}}>
                <div style={{...mono(9,C.grn,700),marginBottom:4}}>{step}</div>
                <div style={mono(9,C.mut)}>{check}</div>
                <div style={{...mono(9,C.sky),marginTop:3}}>{action}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

    </div>
  );
}


function OptionsView() {
  const C = useC();
  const { token } = useAuth();
  const [symbol, setSymbol] = useState("SPY");
  const [inputSym, setInputSym] = useState("SPY");
  const [expirations, setExpirations] = useState([]);
  const [selExp, setSelExp] = useState(null);
  const [chain, setChain] = useState(null);
  const [summary, setSummary] = useState(null);
  const [snapshotAt, setSnapshotAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [error, setError] = useState(null);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [chainView, setChainView] = useState("both"); // "both" | "calls" | "puts"
  const [strikeFilt,   setStrikeFilt]   = useState("all"); // "all"|"itm"|"atm"|"otm"
  const [strikeWindow, setStrikeWindow] = useState(0);     // 0=all, N=±N strikes around ATM
  const [priceHistory, setPriceHistory] = useState([]);
  const [mlRecs,     setMlRecs]     = useState(null);   // backend ML recommender
  const [mlRecLoad,  setMlRecLoad]  = useState(false);
  const [liquidFilt, setLiquidFilt] = useState(false); // liquidity filter
  const [liquidMin,  setLiquidMin]  = useState(1000);  // min OI threshold
  const CALL_ONLY = new Set(["coveredCall","bullCallSpread"]);
  const PUT_ONLY  = new Set(["cashSecuredPut","bearPutSpread"]);

  // Auto-fetch price history whenever the active symbol changes.
  // Clear stale data first so the chart never shows a different ticker's history.
  useEffect(() => {
    if (!symbol) return;
    setPriceHistory([]);
    fetch(`/api/market/price/${symbol}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setPriceHistory(d.data); })
      .catch(() => {});
  }, [symbol]);

  // Auto-load default symbol on mount — data is pre-warmed in DB so this is instant.
  useEffect(() => {
    loadChain(inputSym, null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll job progress.
  // sym is passed explicitly to avoid the stale-closure problem with the
  // `symbol` state variable (React batches the setSymbol update, so the
  // closure would capture the old value if we relied on state directly).
  const pollJob = (id, sym) => {
    const iv = setInterval(async () => {
      const r = await fetch(`/api/options/refresh/${id}`);
      if (!r.ok) { clearInterval(iv); return; }
      const j = await r.json();
      setJobStatus(j);
      if (j.status === "complete" || j.status === "failed") {
        clearInterval(iv);
        setRefreshing(false);
        if (j.status === "complete") loadChain(sym, null);  // use the passed sym, not stale state
      }
    }, 2000);
  };

  const fetchRefresh = async () => {
    const sym = inputSym.trim().toUpperCase();
    // Reset all per-symbol state immediately so nothing stale is displayed
    setRefreshing(true); setError(null); setJobStatus(null);
    setSymbol(sym); setSelExp(null); setChain(null); setSummary(null);
    setExpirations([]); setSnapshotAt(null); setPriceHistory([]);
    const r = await fetch("/api/options/refresh", {
      method:"POST",
      headers:{"Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {})},
      body: JSON.stringify({symbols:[sym], risk_free_rate:0.05}),
    });
    if (!r.ok) { setError(friendlyError(await r.text())); setRefreshing(false); return; }
    const j = await r.json();
    setJobId(j.job_id);
    pollJob(j.job_id, sym);  // pass sym so the closure is always correct
  };

  const loadChain = async (sym, exp) => {
    setLoading(true); setError(null);
    try {
      const url = exp ? `/api/options/${sym}/${exp}` : `/api/options/${sym}`;
      const r = await fetch(url);
      if (!r.ok) {
        // No cached data — kick off an automatic fetch so the user sees data
        // without having to click a button (only on full-chain load, not expiry filter)
        setLoading(false);
        if (!exp) { fetchRefresh(); } else { setError(`No data for ${sym}. Click Fetch to download.`); }
        return;
      }
      const data = await r.json();
      if (exp) {
        setChain(data);
        setSnapshotAt(null);
      } else {
        setChain(data.data);
        setExpirations(data.expirations || []);
        setSnapshotAt(data.snapshot_at);
        // Only set the first expiration if nothing is selected yet
        if (data.expirations?.length) setSelExp(prev => prev && data.expirations.includes(prev) ? prev : data.expirations[0]);
      }
      // Load summary
      const sr = await fetch(`/api/options/${sym}/greeks/summary${exp?`?expiration=${exp}`:""}`);
      if (sr.ok) setSummary(await sr.json());
      // Load ML strategy recommendations in parallel
      setMlRecs(null); setMlRecLoad(true);
      fetch(`/api/options/${sym}/recommend`)
        .then(rr => rr.ok ? rr.json() : null)
        .then(d => { if(d) setMlRecs(d); })
        .catch(()=>{})
        .finally(()=>setMlRecLoad(false));
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const handleLoad = () => {
    const sym = inputSym.trim().toUpperCase();
    // Reset all per-symbol state so nothing from the previous ticker lingers
    setSymbol(sym); setSelExp(null); setChain(null); setSummary(null);
    setExpirations([]); setSnapshotAt(null); setPriceHistory([]);
    loadChain(sym, null);
  };

  // Filter chain to selected expiration
  const visibleChain = selExp && chain
    ? (Array.isArray(chain) ? chain.filter(r=>r.expiration===selExp) : [])
    : (Array.isArray(chain) ? chain : []);

  // Precompute which strategies have attractive contracts (for button highlighting)
  const strategyHasOpps = useMemo(() => {
    const result = {};
    if (!visibleChain?.length) return result;
    for (const key of Object.keys(OPTION_STRATEGIES)) {
      const strat = OPTION_STRATEGIES[key];
      const hasAttractive = visibleChain.some(r => strat.score(r) === "attractive");
      result[key] = hasAttractive;
    }
    return result;
  }, [visibleChain, selExp]);

  const calls = visibleChain.filter(r=>r.option_type==="call").sort((a,b)=>a.strike-b.strike);
  const puts  = visibleChain.filter(r=>r.option_type==="put").sort((a,b)=>a.strike-b.strike);
  const spot  = visibleChain[0]?.spot || null;

  // Merge by strike
  const strikesSet = new Set([...calls.map(r=>r.strike), ...puts.map(r=>r.strike)]);
  const strikes = [...strikesSet].sort((a,b)=>a-b);
  const callByStrike = Object.fromEntries(calls.map(r=>[r.strike,r]));
  const putByStrike  = Object.fromEntries(puts.map(r=>[r.strike,r]));

  // Strike filtering
  const filteredStrikes = (() => {
    let s = strikes;
    if (spot) {
      if      (strikeFilt === "itm") s = s.filter(k => k < spot);                              // call-side ITM
      else if (strikeFilt === "otm") s = s.filter(k => k > spot);                              // call-side OTM
      else if (strikeFilt === "atm") s = s.filter(k => Math.abs(k - spot) / spot <= 0.03);    // ±3% from spot
    }
    if (strikeWindow > 0 && spot && s.length > 0) {
      // Find index of the strike closest to spot, then slice ±strikeWindow around it
      const atmIdx = s.reduce((best, k, i) =>
        Math.abs(k - spot) < Math.abs(s[best] - spot) ? i : best, 0);
      s = s.slice(Math.max(0, atmIdx - strikeWindow), atmIdx + strikeWindow + 1);
    }
    return s;
  })();

  // Liquidity filter applied to strike rows
  const finalStrikes = liquidFilt
    ? filteredStrikes.filter(k => {
        const cOI = callByStrike[k]?.open_interest ?? 0;
        const pOI = putByStrike[k]?.open_interest  ?? 0;
        return cOI >= liquidMin || pOI >= liquidMin;
      })
    : filteredStrikes;

  // Opportunity analysis
  const topOpps     = activeStrategy && visibleChain.length ? getTopOpportunities(activeStrategy, visibleChain) : [];
  const stratInsight = activeStrategy && topOpps.length ? getStrategyInsight(activeStrategy, topOpps, spot) : null;

  // Apply strategy color border to a table cell: edge = "L" | "M" | "R"
  const scs = (base, score, edge) => {
    if (!score || !SCORE_COLORS[score]) return base;
    const {fg, bg} = SCORE_COLORS[score];
    return {
      ...base,
      background: bg,
      borderTop: `1px solid ${fg}40`,
      borderBottom: `1px solid ${fg}40`,
      ...(edge==="L" ? {borderLeft:  `2px solid ${fg}`} : {}),
      ...(edge==="R" ? {borderRight: `2px solid ${fg}`} : {}),
    };
  };

  const colHdr = (label, tipKey) => (
    <th style={{...mono(8,C.mut,700),padding:"4px 6px",borderBottom:`1px solid ${C.bdr}`,textAlign:"right",letterSpacing:"0.1em",whiteSpace:"nowrap"}}>
      {tipKey
        ? <InfoTip desc={GREEK_TIPS[tipKey].desc} bands={GREEK_TIPS[tipKey].bands}>
            <span style={{cursor:"help",borderBottom:`1px dashed ${C.mut}`}}>{label}</span>
          </InfoTip>
        : label}
    </th>
  );
  const cellStyle = {padding:"3px 6px",textAlign:"right",borderBottom:`1px solid ${C.dim}`};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div><Lbl>Options Chain</Lbl><div style={mono(11,C.mut)}>Live Greeks computed via Black-Scholes · Data via yfinance</div></div>

      {/* Search + Fetch bar */}
      <Card>
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{flex:"1 1 160px"}}>
            <Lbl>Symbol</Lbl>
            <input value={inputSym} onChange={e=>setInputSym(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&handleLoad()}
              placeholder="SPY" style={{...mono(13,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.dim,border:`1px solid ${C.grn}60`,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <SpinRing active={loading} color={C.sky}>
          <button onClick={handleLoad} disabled={loading}
            style={{padding:"8px 18px",borderRadius:8,border:"none",background:C.sky,color:"#000",...mono(11,"#000",700),cursor:loading?"not-allowed":"pointer"}}>
            {loading ? <><RefreshCw size={12}/> Loading…</> : "Load Chain"}
          </button>
          </SpinRing>
          <SpinRing active={refreshing}>
          <button onClick={fetchRefresh} disabled={refreshing}
            style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${C.grn}50`,background:"transparent",...mono(11,refreshing?C.mut:C.grn,700),cursor:refreshing?"not-allowed":"pointer"}}>
            {refreshing ? <><RefreshCw size={12}/> Fetching…</> : "↓ Fetch / Refresh"}
          </button>
          </SpinRing>
        </div>
        {snapshotAt && <div style={{...mono(9,C.mut),marginTop:8}}>Snapshot: {snapshotAt.slice(0,19)} UTC</div>}
        {refreshing && jobStatus && (
          <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
            <div style={mono(9,C.amb)}>Fetching options + computing Greeks…</div>
            <div style={{...mono(10,C.grn),marginTop:4}}>{jobStatus.symbols_done} / {jobStatus.symbols_total} symbols done</div>
          </div>
        )}
        {error && <div style={{...mono(10,C.red),marginTop:8,padding:"6px 10px",borderRadius:6,background:C.red+"10",border:`1px solid ${C.red}30`}}>✗ {error}</div>}
      </Card>

      {/* ═══════════ OPTIONS REGIME SNAPSHOT + TOP OPPORTUNITIES ═══════════ */}
      {chain && chain.length > 0 && summary && (()=>{
        // ── Contract Scoring Engine ──
        const hv20 = summary?.hv20 || 0;
        const ivRank = summary?.iv_rank || 50;
        const spot0 = chain[0]?.spot || 0;

        // Vol Regime
        const avgIV = chain.reduce((s,c) => s + (c.implied_vol||0), 0) / chain.length;
        const ivHvRatio = hv20 > 0 ? avgIV / hv20 : 1;
        const volRegime = ivHvRatio > 1.3 ? "Expensive" : ivHvRatio < 0.9 ? "Cheap" : "Fair";

        // Skew Regime (put vs call IV)
        const calls = chain.filter(c => c.option_type === "call" && c.implied_vol > 0);
        const puts = chain.filter(c => c.option_type === "put" && c.implied_vol > 0);
        const avgCallIV = calls.length ? calls.reduce((s,c)=>s+c.implied_vol,0)/calls.length : 0;
        const avgPutIV = puts.length ? puts.reduce((s,c)=>s+c.implied_vol,0)/puts.length : 0;
        const skewRegime = avgPutIV > avgCallIV * 1.1 ? "Put-rich" : avgCallIV > avgPutIV * 1.1 ? "Call-rich" : "Flat";

        // Liquidity Regime
        const liquidContracts = chain.filter(c => (c.open_interest||0) >= 500 && (c.bid||0) > 0);
        const liqRatio = liquidContracts.length / Math.max(chain.length, 1);
        const liquidityRegime = liqRatio > 0.4 ? "Strong" : liqRatio > 0.2 ? "Mixed" : "Weak";

        // Strategy Bias
        const strategyBias = volRegime === "Expensive" ? "Sell Premium" : volRegime === "Cheap" ? "Buy Vol" : (skewRegime === "Put-rich" ? "Neutral Structures" : "Sell Premium");

        // Contract scoring
        const scoreContract = (c) => {
          let liq = 0, vol = 50, struc = 50, strat = 50, cat = 50;
          // Liquidity
          const mid = (c.bid > 0 && c.ask > 0) ? (c.bid + c.ask) / 2 : 0;
          if (mid > 0) liq += 20;
          const oi = c.open_interest || 0;
          if (oi >= 5000) liq += 30; else if (oi >= 1000) liq += 22; else if (oi >= 250) liq += 14; else if (oi >= 50) liq += 6;
          const v = c.volume || 0;
          if (v >= 1000) liq += 25; else if (v >= 250) liq += 18; else if (v >= 50) liq += 10;
          const spread = mid > 0 ? Math.abs((c.ask||0) - (c.bid||0)) / mid : 1;
          if (spread <= 0.02) liq += 25; else if (spread <= 0.05) liq += 18; else if (spread <= 0.10) liq += 8; else liq -= 10;
          liq = Math.max(0, Math.min(100, liq));

          // Vol value
          const iv = c.implied_vol || 0;
          if (hv20 > 0) {
            const ratio = iv / hv20;
            if (ratio < 0.9) vol += 20; else if (ratio < 1.1) vol += 10; else if (ratio > 1.4) vol -= 15;
          }
          if (ivRank < 30) vol += 15; else if (ivRank > 70) vol -= 15;
          vol = Math.max(0, Math.min(100, vol));

          // Structure
          const delta = Math.abs(c.delta || 0);
          const dte = c.expiration ? Math.round((new Date(c.expiration) - new Date()) / 86400000) : 30;
          if (delta >= 0.2 && delta <= 0.5) struc += 15;
          if (dte >= 14 && dte <= 60) struc += 10;
          struc = Math.max(0, Math.min(100, struc));

          // Strategy fit
          if (liquidityRegime === "Strong") strat += 10; else if (liquidityRegime === "Weak") strat -= 20;
          strat = Math.max(0, Math.min(100, strat));

          const composite = Math.round(0.25 * liq + 0.25 * vol + 0.20 * struc + 0.20 * strat + 0.10 * cat);
          return { liq, vol, struc, strat, cat, composite };
        };

        // Score and rank
        const scored = chain
          .filter(c => (c.bid||0) > 0 || (c.open_interest||0) >= 50)
          .map(c => ({...c, score: scoreContract(c)}))
          .sort((a,b) => b.score.composite - a.score.composite);

        // Top opportunities by category
        const topCall = scored.find(c => c.option_type === "call" && Math.abs(c.delta||0) >= 0.3 && Math.abs(c.delta||0) <= 0.6);
        const topPut = scored.find(c => c.option_type === "put" && Math.abs(c.delta||0) >= 0.2 && Math.abs(c.delta||0) <= 0.5);
        const topHedge = scored.filter(c => c.option_type === "put" && Math.abs(c.delta||0) >= 0.15 && Math.abs(c.delta||0) <= 0.35).sort((a,b) => b.score.composite - a.score.composite)[0];
        const topPremium = scored.filter(c => Math.abs(c.theta||0) > 0 && (c.open_interest||0) >= 500).sort((a,b) => Math.abs(b.theta||0) - Math.abs(a.theta||0))[0];
        const topLongVol = scored.filter(c => (c.gamma||0) > 0.005).sort((a,b) => (b.gamma||0) - (a.gamma||0))[0];

        const opps = [
          topCall && {cat:"Directional Call", c:topCall, reason:`Δ${Math.abs(topCall.delta||0).toFixed(2)}, strong liquidity (OI ${topCall.open_interest})`},
          topPut && {cat:"Directional Put", c:topPut, reason:`Δ${Math.abs(topPut.delta||0).toFixed(2)}, composite score ${topPut.score.composite}`},
          topHedge && {cat:"Hedge Put", c:topHedge, reason:`Efficient downside at Δ${Math.abs(topHedge.delta||0).toFixed(2)}`},
          topPremium && {cat:"Premium Sale", c:topPremium, reason:`Θ ${topPremium.theta?.toFixed(3)}/day, OI ${topPremium.open_interest}`},
          topLongVol && {cat:"Long Vol", c:topLongVol, reason:`Γ ${topLongVol.gamma?.toFixed(4)}, event convexity`},
        ].filter(Boolean);

        const regCol = ({Expensive:C.red, Fair:C.amb, Cheap:C.grn})[volRegime] || C.mut;
        const skewCol = ({["Put-rich"]:C.red, Flat:C.amb, ["Call-rich"]:C.grn})[skewRegime] || C.mut;
        const liqCol = ({Strong:C.grn, Mixed:C.amb, Weak:C.red})[liquidityRegime] || C.mut;
        const biasCol = ({["Buy Vol"]:C.grn, ["Sell Premium"]:"#ff8a65", ["Neutral Structures"]:C.amb, Hedge:C.red, Avoid:C.red})[strategyBias] || C.mut;

        // Regime bullets
        const bullets = [];
        if (volRegime === "Expensive") bullets.push("IV is elevated relative to realized — favor premium-selling strategies");
        else if (volRegime === "Cheap") bullets.push("IV is cheap relative to realized — long vol structures may be attractive");
        else bullets.push("IV is fairly priced — focus on structure and liquidity");
        if (skewRegime === "Put-rich") bullets.push("Downside hedges are relatively expensive — put skew is elevated");
        if (liquidityRegime === "Strong") bullets.push("Liquidity is strong across the chain — execution should be efficient");
        else if (liquidityRegime === "Weak") bullets.push("Liquidity is thin — widen expected fill ranges and reduce size");
        if (summary?.iv_rank != null) bullets.push(`IV Rank at ${summary.iv_rank.toFixed(0)}% — ${summary.iv_rank > 70 ? "historically elevated" : summary.iv_rank < 30 ? "historically low" : "mid-range"}`);

        return (<>
          {/* Options Regime Snapshot */}
          <div style={{borderRadius:14, border:`1.5px solid ${regCol}30`, background:regCol+"07", padding:"18px 20px"}}>
            <div style={{...mono(11, C.headingTxt, 700), marginBottom:12}}>OPTIONS REGIME</div>
            <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginBottom:14}}>
              <div style={{padding:"10px 12px",borderRadius:10,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>VOL REGIME</div>
                <div style={mono(16, regCol, 800)}>{volRegime}</div>
                <div style={mono(8, C.mut)}>IV/HV: {ivHvRatio.toFixed(2)}x</div>
              </div>
              <div style={{padding:"10px 12px",borderRadius:10,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>SKEW</div>
                <div style={mono(16, skewCol, 800)}>{skewRegime}</div>
                <div style={mono(8, C.mut)}>P:{(avgPutIV*100).toFixed(0)}% C:{(avgCallIV*100).toFixed(0)}%</div>
              </div>
              <div style={{padding:"10px 12px",borderRadius:10,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>LIQUIDITY</div>
                <div style={mono(16, liqCol, 800)}>{liquidityRegime}</div>
                <div style={mono(8, C.mut)}>{liquidContracts.length} tradable</div>
              </div>
              <div style={{padding:"10px 12px",borderRadius:10,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>STRATEGY BIAS</div>
                <div style={mono(14, biasCol, 800)}>{strategyBias}</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {bullets.map((b,i) => <div key={i} style={{display:"flex",gap:6}}><span style={mono(9,C.mut)}>•</span><span style={mono(9,C.txt)}>{b}</span></div>)}
            </div>
          </div>

          {/* Top Opportunities */}
          {opps.length > 0 && (
            <div style={{borderRadius:14, border:`1.5px solid ${C.pur}30`, background:C.pur+"07", padding:"18px 20px"}}>
              <div style={{...mono(11, C.headingTxt, 700), marginBottom:12}}>TOP OPPORTUNITIES</div>
              <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : `repeat(${Math.min(opps.length, 3)},1fr)`, gap:10}}>
                {opps.slice(0,5).map((opp,i) => {
                  const c = opp.c;
                  const dte = c.expiration ? Math.round((new Date(c.expiration) - new Date()) / 86400000) : 0;
                  return (
                    <div key={i} style={{padding:"12px 14px",borderRadius:10,background:C.dim,border:`1px solid ${C.bdr}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <Tag color={C.pur}>{opp.cat}</Tag>
                        <span style={mono(14, c.score.composite >= 70 ? C.grn : c.score.composite >= 50 ? C.amb : C.red, 800)}>{c.score.composite}</span>
                      </div>
                      <div style={mono(12, C.headingTxt, 700)}>${c.strike} {c.option_type.toUpperCase()}</div>
                      <div style={mono(9, C.mut)}>Exp: {c.expiration} · {dte}d · Δ{Math.abs(c.delta||0).toFixed(2)}</div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                        <span style={mono(9, C.mut)}>Bid: ${(c.bid||0).toFixed(2)}</span>
                        <span style={mono(9, C.mut)}>Ask: ${(c.ask||0).toFixed(2)}</span>
                        <span style={mono(9, C.mut)}>IV: {((c.implied_vol||0)*100).toFixed(0)}%</span>
                      </div>
                      <div style={{...mono(8, C.txt), marginTop:6, lineHeight:1.4}}>{opp.reason}</div>
                      {/* Sub-scores */}
                      <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                        {[["Liq",c.score.liq],["Vol",c.score.vol],["Str",c.score.struc],["Fit",c.score.strat]].map(([label,val]) => (
                          <span key={label} style={{...mono(7, val >= 60 ? C.grn : val >= 40 ? C.amb : C.red, 600),
                            padding:"1px 5px",borderRadius:4,background:C.dim,border:`1px solid ${C.bdr}`}}>
                            {label}:{val}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>);
      })()}

      {/* ── Price Chart ── */}
      {priceHistory.length > 0 && (
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
            <div>
              <Lbl>{symbol} · Price History · 3 Month</Lbl>
              {spot && <div style={{...mono(9,C.mut)}}>
                Strike range: <span style={{color:C.txt}}>${strikes[0] ?? "—"} – ${strikes[strikes.length-1] ?? "—"}</span>
                {selExp && <span> · Exp: {selExp}</span>}
              </div>}
            </div>
            {spot && <Tag color={C.sky}>Spot ${spot.toFixed(2)}</Tag>}
          </div>
          <ChartPanel title={`${symbol} · Price History`} defaultHeight={190}>
          {(h) => (
          <ResponsiveContainer width="100%" height={h}>
            <ComposedChart data={priceHistory} margin={{top:6,right:55,bottom:4,left:50}}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.sky} stopOpacity={0.22}/>
                  <stop offset="95%" stopColor={C.sky} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="date" tick={mono(8,C.mut)} tickFormatter={d=>d.slice(5)} interval={Math.max(1,Math.ceil(priceHistory.length/8)-1)}/>
              <YAxis tick={mono(8,C.mut)} domain={["auto","auto"]} tickFormatter={v=>`$${v}`} width={52}
                label={{value:"Price ($)",angle:-90,position:"insideLeft",offset:20,
                  style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
              <Tooltip {...makeTT(C)} formatter={(v)=>[`$${v.toFixed(2)}`,"Close"]}/>
              <Area type="monotone" dataKey="close" stroke={C.sky} fill="url(#priceGrad)" strokeWidth={1.5} dot={false}/>
              {spot && (
                <ReferenceLine y={spot} stroke={C.grn} strokeDasharray="5 3" strokeWidth={1.5}
                  label={{value:`Spot $${spot.toFixed(2)}`,position:"right",fill:C.grn,fontSize:9,fontFamily:"monospace"}}/>
              )}
              {summary?.max_gamma_strike && (
                <ReferenceLine y={summary.max_gamma_strike} stroke={C.pur} strokeDasharray="4 2" strokeWidth={1}
                  label={{value:`MaxΓ $${summary.max_gamma_strike}`,position:"right",fill:C.pur,fontSize:9,fontFamily:"monospace"}}/>
              )}
            </ComposedChart>
          </ResponsiveContainer>
          )}
          </ChartPanel>
          <div style={{...mono(9,C.mut),marginTop:6,display:"flex",gap:16,flexWrap:"wrap"}}>
            <span style={{color:C.sky}}>─ Close price</span>
            {spot && <span style={{color:C.grn}}>-- Spot</span>}
            {summary?.max_gamma_strike && <span style={{color:C.pur}}>-- Max Gamma Strike</span>}
          </div>
        </Card>
      )}

      {/* Strategy Overlay Panel */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <Lbl>Strategy Overlay</Lbl>
            <div style={{...mono(9,C.mut),marginTop:2}}>Toggle a strategy to highlight attractive / median / unattractive contracts on the chain</div>
          </div>
          {activeStrategy && (
            <button onClick={()=>setActiveStrategy(null)}
              style={{...mono(9,C.mut),background:"transparent",border:`1px solid ${C.bdr}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",flexShrink:0}}>
              ✕ Clear
            </button>
          )}
        </div>

        {/* Active strategy description + legend */}
        {activeStrategy && (
          <div style={{...mono(9,C.mut),marginBottom:12,padding:"8px 12px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`,lineHeight:1.6}}>
            <span style={{color:C.txt,fontWeight:700}}>{OPTION_STRATEGIES[activeStrategy].label}  </span>
            {OPTION_STRATEGIES[activeStrategy].desc}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginTop:8}}>
              <div style={{display:"flex",gap:16}}>
                {[["attractive","#00e676","● Attractive"],["neutral","#ffb300","● Median"],["unattractive","#ff5252","● Unattractive"]].map(([k,col,lbl])=>(
                  <span key={k} style={{...mono(9,col,700)}}>{lbl}</span>
                ))}
              </div>
              {STRAT_FOCUS[activeStrategy] && (
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={mono(8,C.mut)}>
                    Sweet spot: <span style={{color:C.sky}}>{STRAT_FOCUS[activeStrategy].range}</span>
                  </span>
                  <button onClick={()=>{
                    const f = STRAT_FOCUS[activeStrategy];
                    if(f) { setStrikeFilt(f.filt); setStrikeWindow(0); }
                  }}
                    style={{...mono(8,C.sky,700),padding:"2px 9px",borderRadius:12,
                      border:`1px solid ${C.sky}50`,background:C.sky+"12",cursor:"pointer",
                      whiteSpace:"nowrap"}}>
                    → Show {STRAT_FOCUS[activeStrategy].label}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Classic strategies */}
        {[["classic","Classic Strategies"],["hedgefund","Hedge Fund Strategies"]].map(([grp,grpLabel])=>(
          <div key={grp} style={{marginBottom:10}}>
            <div style={{...mono(8,C.mut,700),letterSpacing:"0.10em",marginBottom:7,paddingBottom:4,borderBottom:`1px solid ${C.bdr}`}}>
              {grpLabel.toUpperCase()}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {Object.entries(OPTION_STRATEGIES).filter(([,s])=>s.group===grp).map(([key,strat])=>{
                const isActive = activeStrategy===key;
                const hasOpps = strategyHasOpps[key];
                const col = isActive ? "#00e676" : hasOpps ? C.txt : C.mut;
                return (
                  <button key={key} onClick={()=>{
                    if(isActive){ setActiveStrategy(null); }
                    else {
                      setActiveStrategy(key);
                      if(CALL_ONLY.has(key))      setChainView("calls");
                      else if(PUT_ONLY.has(key))  setChainView("puts");
                    }
                  }}
                    style={{
                      ...mono(10, isActive?"#001a0a":col, isActive?700: hasOpps?500:400),
                      padding:"5px 14px", borderRadius:20,
                      border:`1px solid ${isActive?"#00e676": hasOpps?C.grn+"40":C.bdr}`,
                      background: isActive ? "#00e676" : hasOpps ? C.grn+"08" : C.dim,
                      cursor:"pointer", transition:"all .15s",
                      boxShadow: isActive ? "0 0 8px #00e67640" : "none",
                      opacity: hasOpps || isActive ? 1 : 0.45,
                    }}>
                    {strat.label}
                    {hasOpps && !isActive && <span style={{...mono(7,C.grn),marginLeft:4}}>●</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* ── Opportunity Summary ───────────────────────── */}
        {activeStrategy && topOpps.length > 0 && (
          <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${C.bdr}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6}}>
              <Lbl>Top Opportunities · {OPTION_STRATEGIES[activeStrategy].label}</Lbl>
              <Tag color={C.grn}>{topOpps.length} contract{topOpps.length>1?"s":""}{selExp?` · ${selExp}`:""}</Tag>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace"}}>
                <thead>
                  <tr style={{background:C.dim}}>
                    {[
                      ["STRIKE","right"],
                      ["TYPE","center"],
                      [topOpps.length ? getOpportunityMetric(activeStrategy,topOpps[0]).label : "—","right"],
                      ["Bid","right"],["Ask","right"],["IV","right"],["OI","right"],["Volume","right"],
                    ].map(([h,align])=>(
                      <th key={h} style={{...mono(8,C.mut,700),padding:"4px 8px",borderBottom:`1px solid ${C.bdr}`,textAlign:align,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topOpps.map((row,i)=>{
                    const {val,color} = getOpportunityMetric(activeStrategy,row);
                    const sc = SCORE_COLORS.attractive;
                    const isTop = i===0;
                    return (
                      <tr key={row.strike+""+row.option_type+i} style={{
                        background: isTop ? sc.bg : "transparent",
                        borderLeft: isTop ? `2px solid ${sc.fg}` : "none",
                      }}>
                        <td style={{...mono(11,isTop?C.txt:C.mut,isTop?700:400),padding:"4px 8px",textAlign:"right"}}>
                          ${row.strike}
                        </td>
                        <td style={{padding:"4px 8px",textAlign:"center"}}>
                          <span style={{...mono(8,row.option_type==="call"?C.grn:C.red,700),padding:"1px 6px",borderRadius:3,background:row.option_type==="call"?C.grnBg:C.red+"15"}}>
                            {row.option_type==="call"?"CALL":"PUT"}
                          </span>
                        </td>
                        <td style={{...mono(10,color,700),padding:"4px 8px",textAlign:"right"}}>{val}</td>
                        <td style={{...mono(10,C.mut),padding:"4px 8px",textAlign:"right"}}>{row.bid!=null?row.bid.toFixed(2):"—"}</td>
                        <td style={{...mono(10,C.mut),padding:"4px 8px",textAlign:"right"}}>{row.ask!=null?row.ask.toFixed(2):"—"}</td>
                        <td style={{...mono(10,C.mut),padding:"4px 8px",textAlign:"right"}}>{row.implied_vol?(row.implied_vol*100).toFixed(1)+"%":"—"}</td>
                        <td style={{...mono(10,C.mut),padding:"4px 8px",textAlign:"right"}}>{row.open_interest?.toLocaleString()||"—"}</td>
                        <td style={{...mono(10,C.mut),padding:"4px 8px",textAlign:"right"}}>{row.volume?.toLocaleString()||"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {stratInsight && (
              <div style={{...mono(9,C.mut),marginTop:10,padding:"9px 12px",borderRadius:6,background:C.dim,lineHeight:1.65,borderLeft:`3px solid ${C.grn}`}}>
                💡 {stratInsight}
              </div>
            )}
          </div>
        )}
        {activeStrategy && !topOpps.length && visibleChain.length > 0 && (() => {
          const focus = STRAT_FOCUS[activeStrategy];
          const strat = OPTION_STRATEGIES[activeStrategy];
          // Count how many contracts in the FULL visible chain would be attractive
          // (ignoring strike filter) to distinguish "wrong filter" vs "genuinely none"
          const fullAttractive = visibleChain.filter(r=>strat.score(r)==="attractive").length;
          return (
            <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${C.bdr}`,
              padding:"12px 14px",borderRadius:8,background:C.amb+"08",border:`1px solid ${C.amb}30`}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                <div style={{flex:1}}>
                  <div style={mono(9,C.amb,700)}>No attractive contracts visible for {strat.label}</div>
                  {fullAttractive > 0 ? (
                    <div style={{...mono(8,C.mut),marginTop:4,lineHeight:1.6}}>
                      ✓ {fullAttractive} attractive contract{fullAttractive>1?"s":""} exist in this expiration but are hidden by the current strike filter.
                      {focus && <> Sweet spot: <span style={{color:C.sky}}>{focus.range}</span>.</>}
                    </div>
                  ) : (
                    <div style={{...mono(8,C.mut),marginTop:4,lineHeight:1.6}}>
                      {focus
                        ? <>Sweet spot for this strategy is <span style={{color:C.sky}}>{focus.range}</span> — all currently visible strikes fall outside this range. Try a different expiration or use the filter below.</>
                        : "Try a different expiration or adjust the strike filter."}
                    </div>
                  )}
                </div>
                {focus && (
                  <button onClick={()=>{ setStrikeFilt(focus.filt); setStrikeWindow(0); }}
                    style={{...mono(9,C.sky,700),padding:"5px 12px",borderRadius:8,
                      border:`1px solid ${C.sky}50`,background:C.sky+"12",cursor:"pointer",
                      flexShrink:0,whiteSpace:"nowrap"}}>
                    → Show {focus.label}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Card>

      {/* Expirations */}
      {expirations.length > 0 && (
        <Card>
          <Lbl>Expiration</Lbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {expirations.map(exp=>(
              <Pill key={exp} label={exp} active={selExp===exp} onClick={()=>setSelExp(exp)}/>
            ))}
          </div>
        </Card>
      )}

      {/* Greeks Summary */}
      {summary && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}>
          {[
            {l:"Call OI",   v:summary.total_call_oi?.toLocaleString()||"—",  c:C.grn},
            {l:"Put OI",    v:summary.total_put_oi?.toLocaleString()||"—",   c:C.red},
            {l:"P/C Ratio", v:summary.put_call_ratio!=null?summary.put_call_ratio.toFixed(3):"—", c:summary.put_call_ratio>1?C.red:C.grn},
            {l:"Max Γ Strike",v:summary.max_gamma_strike!=null?`$${summary.max_gamma_strike}`:"—", c:C.sky},
            {l:"Avg Call IV",v:summary.avg_iv_call!=null?`${(summary.avg_iv_call*100).toFixed(1)}%`:"—", c:C.amb},
          ].map(({l,v,c})=><Stat key={l} label={l} value={v} color={c}/>)}
        </div>
      )}

      {/* ── Action Brief ── */}
      {summary && (
        <ActionBriefPanel symbol={symbol} summary={summary} spot={spot}/>
      )}

      {/* ── Advanced Signal Panel (Term Structure · Skew · HV Trend · Liquidity · Catalysts) ── */}
      {chain && symbol && (
        <OptionsAdvancedPanel symbol={symbol} snapshotKey={snapshotAt}/>
      )}

      {/* ── ML Strategy Recommender ── */}
      {(mlRecs || mlRecLoad) && (
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:22,height:22,borderRadius:6,background:`${C.pur}18`,border:`1px solid ${C.pur}30`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Cpu size={12} style={{color:C.pur}}/>
            </div>
            <Lbl>ML Strategy Recommender</Lbl>
            {mlRecs && <Tag color={C.sky}>{mlRecs.iv_env?.replace("_"," ")||"—"} · IV Rank {mlRecs.iv_rank!=null?mlRecs.iv_rank.toFixed(0):"—"}</Tag>}
            {mlRecLoad && <RefreshCw size={11} style={{color:C.mut,animation:"spin 1s linear infinite",marginLeft:4}}/>}
          </div>
          {mlRecs?.recommendations?.length > 0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {mlRecs.recommendations.slice(0,5).map((rec,i)=>{
                const fitPct = Math.round((rec.fit||0)*100);
                const fitCol = fitPct>=80?C.grn:fitPct>=50?C.amb:C.mut;
                return (
                  <div key={rec.name} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${C.bdr}`,
                    background:i===0?`${C.pur}08`:"transparent",
                    borderLeft:i===0?`3px solid ${C.pur}`:`1px solid ${C.bdr}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flex:1}}>
                        <span style={{...mono(10,C.headingTxt,700)}}>{rec.label||rec.name}</span>
                        {i===0 && <span style={{...mono(8,C.pur,700),padding:"1px 6px",borderRadius:3,background:`${C.pur}18`}}>TOP PICK</span>}
                        <span style={{...mono(9,C.mut)}}>{rec.risk_profile?.replace("_"," ")}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:80,height:4,background:C.dim,borderRadius:2,overflow:"hidden"}}>
                          <div style={{width:`${fitPct}%`,height:"100%",background:fitCol,opacity:0.9}}/>
                        </div>
                        <span style={{...mono(10,fitCol,700),minWidth:32,textAlign:"right"}}>{fitPct}%</span>
                      </div>
                    </div>
                    {rec.reason && (
                      <div style={{...mono(9,C.mut),marginTop:5,lineHeight:1.6}}>
                        {rec.reason}
                      </div>
                    )}
                    {rec.best_strikes && Object.keys(rec.best_strikes).length>0 && (
                      <div style={{display:"flex",gap:12,marginTop:5,flexWrap:"wrap"}}>
                        {Object.entries(rec.best_strikes).map(([k,v])=>(
                          <span key={k} style={mono(9,C.mut)}>
                            {k.replace(/_/g," ")}: <span style={{color:C.sky,fontWeight:600}}>{v!=null?`$${typeof v==="number"?v.toFixed(0):v}`:"—"}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : !mlRecLoad && (
            <div style={{...mono(10,C.mut),textAlign:"center",padding:"16px 0"}}>
              Load a chain to see ML strategy recommendations
            </div>
          )}
        </Card>
      )}

      {/* ── Advanced Analytics Panel ── */}
      {chain && symbol && (
        <OptionsAnalyticsPanel symbol={symbol} expiration={selExp}/>
      )}

      {/* Chain Table */}
      {strikes.length > 0 && (
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:8}}>
            <Lbl>
              {chainView==="calls"?"Calls":chainView==="puts"?"Puts":"Chain"}
              {selExp ? ` — ${selExp} · ${finalStrikes.length}${finalStrikes.length!==strikes.length?` / ${strikes.length}`:""} strikes${liquidFilt?` · OI≥${liquidMin}`:""} ` : ""}
            </Lbl>
            <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
              {[["calls","Calls ↗"],["both","Both"],["puts","↘ Puts"]].map(([v,lbl])=>(
                <button key={v} onClick={()=>setChainView(v)}
                  style={{...mono(9,chainView===v?"#000":C.mut,chainView===v?700:400),
                    padding:"4px 12px",borderRadius:6,cursor:"pointer",transition:"all .15s",
                    border:`1px solid ${chainView===v?C.sky:C.bdr}`,
                    background:chainView===v?C.sky:C.dim}}>
                  {lbl}
                </button>
              ))}
              {spot && <Tag color={C.sky}>Spot: ${spot.toFixed(2)}</Tag>}
            </div>
          </div>

          {/* ── Strike Filters ── */}
          {strikes.length > 0 && (
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",
              padding:"8px 10px",marginBottom:10,borderRadius:8,
              background:C.dim,border:`1px solid ${C.bdr}`}}>
              {/* Moneyness filter */}
              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                <span style={{...mono(8,C.mut,600),letterSpacing:".07em",marginRight:3}}>MONEYNESS</span>
                {[["all","All"],["itm","ITM"],["atm","Near ATM"],["otm","OTM"]].map(([v,lbl])=>(
                  <button key={v} onClick={()=>setStrikeFilt(v)}
                    style={{...mono(9,strikeFilt===v?"#000":C.mut,strikeFilt===v?700:400),
                      padding:"3px 10px",borderRadius:5,cursor:"pointer",transition:"all .15s",
                      border:`1px solid ${strikeFilt===v?C.grn:C.bdr}`,
                      background:strikeFilt===v?C.grn:C.surf}}>
                    {lbl}
                  </button>
                ))}
              </div>
              {/* Divider */}
              <div style={{width:1,height:16,background:C.bdr,flexShrink:0}}/>
              {/* Window filter */}
              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                <span style={{...mono(8,C.mut,600),letterSpacing:".07em",marginRight:3}}>
                  {spot ? `AROUND ATM ($${spot.toFixed(0)})` : "WINDOW"}
                </span>
                {[[5,"±5"],[10,"±10"],[20,"±20"],[0,"All"]].map(([v,lbl])=>(
                  <button key={v} onClick={()=>setStrikeWindow(v)}
                    style={{...mono(9,strikeWindow===v?"#000":C.mut,strikeWindow===v?700:400),
                      padding:"3px 10px",borderRadius:5,cursor:"pointer",transition:"all .15s",
                      border:`1px solid ${strikeWindow===v?C.sky:C.bdr}`,
                      background:strikeWindow===v?C.sky:C.surf}}>
                    {lbl}
                  </button>
                ))}
              </div>
              {/* Divider */}
              <div style={{width:1,height:16,background:C.bdr,flexShrink:0}}/>
              {/* Liquidity filter */}
              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                <span style={{...mono(8,C.mut,600),letterSpacing:".07em",marginRight:3}}>LIQUID OI ≥</span>
                {[[0,"Off"],[100,"100"],[500,"500"],[1000,"1k+"]].map(([v,lbl])=>(
                  <button key={v} onClick={()=>{ if(v===0){setLiquidFilt(false);}else{setLiquidFilt(true);setLiquidMin(v);} }}
                    style={{...mono(9,liquidFilt&&liquidMin===v?"#000":!liquidFilt&&v===0?"#000":C.mut,
                      (liquidFilt&&liquidMin===v)||(!liquidFilt&&v===0)?700:400),
                      padding:"3px 10px",borderRadius:5,cursor:"pointer",transition:"all .15s",
                      border:`1px solid ${(liquidFilt&&liquidMin===v)||(!liquidFilt&&v===0)?C.amb:C.bdr}`,
                      background:(liquidFilt&&liquidMin===v)||(!liquidFilt&&v===0)?C.amb:C.surf}}>
                    {lbl}
                  </button>
                ))}
              </div>
              {/* Active filter indicator */}
              {(strikeFilt !== "all" || strikeWindow > 0 || liquidFilt) && (
                <button onClick={()=>{ setStrikeFilt("all"); setStrikeWindow(0); setLiquidFilt(false); }}
                  style={{...mono(8,C.mut),padding:"2px 8px",borderRadius:5,cursor:"pointer",
                    border:`1px solid ${C.bdr}`,background:"transparent",marginLeft:"auto"}}>
                  ✕ Reset filters
                </button>
              )}
            </div>
          )}
          <div style={{overflowX:"auto"}}>
            {/* ── Dual-side (Both) view ── */}
            {chainView==="both" && (
            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace"}}>
              <thead>
                <tr style={{background:C.dim}}>
                  {/* CALLS */}
                  {colHdr("Bid",null)}{colHdr("Ask",null)}{colHdr("IV",null)}
                  {colHdr("Δ","delta")}{colHdr("Γ","gamma")}{colHdr("Θ","theta")}{colHdr("ν","vega")}
                  {colHdr("OI",null)}
                  {/* STRIKE */}
                  <th style={{...mono(8,C.sky,700),padding:"4px 10px",borderBottom:`1px solid ${C.bdr}`,textAlign:"center",letterSpacing:"0.1em"}}>STRIKE</th>
                  {/* PUTS */}
                  {colHdr("OI",null)}
                  {colHdr("Δ","delta")}{colHdr("Γ","gamma")}{colHdr("Θ","theta")}{colHdr("ν","vega")}
                  {colHdr("IV",null)}{colHdr("Bid",null)}{colHdr("Ask",null)}
                </tr>
              </thead>
              <tbody>
                {finalStrikes.map(strike=>{
                  const c = callByStrike[strike];
                  const p = putByStrike[strike];
                  const itm_call = c?.in_the_money;
                  const itm_put  = p?.in_the_money;
                  const isAtm = spot && Math.abs(strike - spot) / spot < 0.005;
                  const rowBg = isAtm ? C.sky+"10" : "transparent";
                  // Strategy scoring
                  const strat = activeStrategy ? OPTION_STRATEGIES[activeStrategy] : null;
                  const cs = strat && c ? strat.score(c) : null;
                  const ps = strat && p ? strat.score(p) : null;
                  return (
                    <tr key={`k-${strike}`} style={{background:rowBg}}>
                      {/* CALL side — L=left-border edge, M=middle, R=right-border edge */}
                      <td style={scs({...cellStyle,color:itm_call?C.grn:C.mut},cs,"L")}>{c?c.bid.toFixed(2):"—"}</td>
                      <td style={scs({...cellStyle,color:itm_call?C.grn:C.mut},cs,"M")}>{c?c.ask.toFixed(2):"—"}</td>
                      <td style={scs({...cellStyle,color:C.mut},cs,"M")}>{c&&c.implied_vol?(c.implied_vol*100).toFixed(1)+"%":"—"}</td>
                      <td style={scs(cellStyle,cs,"M")}><GreekCell val={c?.delta} greek="delta"/></td>
                      <td style={scs(cellStyle,cs,"M")}><GreekCell val={c?.gamma} greek="gamma"/></td>
                      <td style={scs(cellStyle,cs,"M")}><GreekCell val={c?.theta} greek="theta"/></td>
                      <td style={scs(cellStyle,cs,"M")}><GreekCell val={c?.vega}  greek="vega"/></td>
                      <td style={scs({...cellStyle,color:C.mut},cs,"R")}>{c?c.open_interest.toLocaleString():"—"}</td>
                      {/* STRIKE */}
                      <td style={{...cellStyle,textAlign:"center",...mono(10,isAtm?C.sky:C.txt,isAtm?700:400),background:C.dim,borderLeft:`1px solid ${C.bdr}`,borderRight:`1px solid ${C.bdr}`}}>
                        {strike.toFixed(0)}
                      </td>
                      {/* PUT side */}
                      <td style={scs({...cellStyle,color:itm_put?C.red:C.mut},ps,"L")}>{p?p.open_interest.toLocaleString():"—"}</td>
                      <td style={scs(cellStyle,ps,"M")}><GreekCell val={p?.delta} greek="delta"/></td>
                      <td style={scs(cellStyle,ps,"M")}><GreekCell val={p?.gamma} greek="gamma"/></td>
                      <td style={scs(cellStyle,ps,"M")}><GreekCell val={p?.theta} greek="delta"/></td>
                      <td style={scs(cellStyle,ps,"M")}><GreekCell val={p?.vega}  greek="vega"/></td>
                      <td style={scs({...cellStyle,color:C.mut},ps,"M")}>{p&&p.implied_vol?(p.implied_vol*100).toFixed(1)+"%":"—"}</td>
                      <td style={scs({...cellStyle,color:itm_put?C.red:C.mut},ps,"M")}>{p?p.bid.toFixed(2):"—"}</td>
                      <td style={scs({...cellStyle,color:itm_put?C.red:C.mut},ps,"R")}>{p?p.ask.toFixed(2):"—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )} {/* end chainView==="both" */}

            {/* ── Single-side (Calls or Puts) view ── */}
            {chainView !== "both" && (
            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace"}}>
              <thead>
                <tr style={{background:C.dim}}>
                  <th style={{...mono(8,C.sky,700),padding:"4px 8px",borderBottom:`1px solid ${C.bdr}`,textAlign:"right",letterSpacing:"0.1em"}}>STRIKE</th>
                  {colHdr("Bid",null)}{colHdr("Ask",null)}{colHdr("Last",null)}
                  {colHdr("Vol",null)}{colHdr("OI",null)}{colHdr("IV",null)}
                  {colHdr("Δ","delta")}{colHdr("Γ","gamma")}{colHdr("Θ","theta")}{colHdr("ν","vega")}
                </tr>
              </thead>
              <tbody>
                {(chainView==="calls" ? calls : puts).filter(row=>finalStrikes.includes(row.strike) && (!liquidFilt || (row.open_interest??0) >= liquidMin)).map(row=>{
                  const strat2 = activeStrategy ? OPTION_STRATEGIES[activeStrategy] : null;
                  const score2 = strat2 ? strat2.score(row) : null;
                  const isAtm2 = spot && Math.abs(row.strike - spot) / spot < 0.005;
                  const itmCol = row.option_type==="call" ? C.grn : C.red;
                  const itm2   = row.in_the_money;
                  return (
                    <tr key={`s-${row.strike}-${row.expiration}`} style={{background: isAtm2 ? C.sky+"10" : "transparent"}}>
                      <td style={scs({...cellStyle,...mono(10,isAtm2?C.sky:C.txt,isAtm2?700:400),textAlign:"right"},score2,"L")}>{row.strike.toFixed(0)}</td>
                      <td style={scs({...cellStyle,color:itm2?itmCol:C.mut},score2,"M")}>{row.bid!=null?row.bid.toFixed(2):"—"}</td>
                      <td style={scs({...cellStyle,color:itm2?itmCol:C.mut},score2,"M")}>{row.ask!=null?row.ask.toFixed(2):"—"}</td>
                      <td style={scs({...cellStyle,color:C.mut},score2,"M")}>{row.last_price!=null?row.last_price.toFixed(2):"—"}</td>
                      <td style={scs({...cellStyle,color:C.mut},score2,"M")}>{row.volume?.toLocaleString()||"—"}</td>
                      <td style={scs({...cellStyle,color:C.mut},score2,"M")}>{row.open_interest?.toLocaleString()||"—"}</td>
                      <td style={scs({...cellStyle,color:C.mut},score2,"M")}>{row.implied_vol?(row.implied_vol*100).toFixed(1)+"%":"—"}</td>
                      <td style={scs(cellStyle,score2,"M")}><GreekCell val={row.delta} greek="delta"/></td>
                      <td style={scs(cellStyle,score2,"M")}><GreekCell val={row.gamma} greek="gamma"/></td>
                      <td style={scs(cellStyle,score2,"M")}><GreekCell val={row.theta} greek="theta"/></td>
                      <td style={scs(cellStyle,score2,"R")}><GreekCell val={row.vega}  greek="vega"/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )} {/* end single-side */}
          </div>
          <div style={{...mono(9,C.mut),marginTop:10,display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
            {chainView==="both" && <span>← Calls · Strike · Puts →</span>}
            {chainView!=="both" && <span>{chainView==="calls"?"Call":"Put"} contracts · sorted by strike</span>}
            <span style={{color:C.grn}}>█ ITM calls</span>
            <span style={{color:C.red}}>█ ITM puts</span>
            <span style={{color:C.sky}}>█ ATM row</span>
            {activeStrategy && <>
              <span style={{color:"#00e676",fontWeight:700}}>▐ Attractive</span>
              <span style={{color:"#ffb300",fontWeight:700}}>▐ Median</span>
              <span style={{color:"#ff5252",fontWeight:700}}>▐ Unattractive</span>
            </>}
          </div>
        </Card>
      )}

      {!chain && !loading && !error && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"30px 0"}}>
            Enter a ticker and click <strong style={{color:C.grn}}>Load Chain</strong> to view options data,
            or <strong style={{color:C.grn}}>Fetch / Refresh</strong> to download fresh data from yfinance.
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO VIEW — components
// ─────────────────────────────────────────────────────────────────────────────

function CorrelationHeatmap({ tickers, matrix }) {
  const C = useC();
  function cellBg(v) {
    if (v >= 1) return `rgba(140,140,160,0.35)`;
    if (v >= 0) return `rgba(0,230,118,${0.08 + v * 0.55})`;
    return `rgba(255,82,82,${0.08 + (-v) * 0.55})`;
  }
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",width:"100%",...mono(10,C.txt)}}>
        <thead>
          <tr>
            <th style={{padding:"3px 6px",background:C.surf}}/>
            {tickers.map(t=>(
              <th key={t} style={{padding:"3px 6px",background:C.surf,...mono(9,C.mut,600),textAlign:"center",
                whiteSpace:"nowrap",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis"}}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickers.map((row,i)=>(
            <tr key={row}>
              <td style={{padding:"3px 6px",...mono(9,C.mut,600),whiteSpace:"nowrap"}}>{row}</td>
              {matrix[i].map((v,j)=>(
                <td key={j} style={{padding:"5px 6px",background:cellBg(v),textAlign:"center",
                  border:`1px solid ${C.bdr}20`,borderRadius:3,minWidth:44}}>
                  <span style={{...mono(10,i===j?C.headingTxt:C.txt,i===j?700:400)}}>
                    {v.toFixed(2)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MCFanChart({ fanData }) {
  const C = useC();
  // Stacked area trick: base=p5, bands build up to p95
  const d = fanData.map(pt => ({
    day:      pt.day,
    base:     pt.p5,
    lo_outer: +(pt.p25 - pt.p5).toFixed(6),
    lo_inner: +(pt.p50 - pt.p25).toFixed(6),
    hi_inner: +(pt.p75 - pt.p50).toFixed(6),
    hi_outer: +(pt.p95 - pt.p75).toFixed(6),
    p50:      pt.p50,
  }));
  return (
    <ChartPanel title="Monte Carlo Fan Chart · 500 Paths" defaultHeight={240}>
    {(h) => (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={d} margin={{top:6,right:10,bottom:20,left:55}}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
        <XAxis dataKey="day" tick={{fill:C.mut,fontSize:9}}
          label={{value:"Trading Days",fill:C.mut,fontSize:9,position:"insideBottom",offset:-4}}/>
        <YAxis tickFormatter={v=>`${((v-1)*100).toFixed(0)}%`} tick={{fill:C.mut,fontSize:9}} tickLine={false}
          label={{value:"Return from $1",angle:-90,position:"insideLeft",offset:22,
            style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
        <Tooltip
          formatter={(v,name)=>{
            const labels={base:"P5",lo_outer:"P5→P25",lo_inner:"P25→P50",hi_inner:"P50→P75",hi_outer:"P75→P95",p50:"Median"};
            return [`${((v-1)*100).toFixed(2)}%`,labels[name]||name];
          }}
          contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,fontSize:10}}/>
        {/* Invisible base */}
        <Area type="monotone" dataKey="base" stackId="fan" fill="transparent" stroke="none"/>
        {/* P5→P25 outer band */}
        <Area type="monotone" dataKey="lo_outer" stackId="fan" fill={C.sky} stroke="none" fillOpacity={0.13}/>
        {/* P25→P50 inner band */}
        <Area type="monotone" dataKey="lo_inner" stackId="fan" fill={C.sky} stroke="none" fillOpacity={0.22}/>
        {/* P50→P75 inner band */}
        <Area type="monotone" dataKey="hi_inner" stackId="fan" fill={C.grn} stroke="none" fillOpacity={0.22}/>
        {/* P75→P95 outer band */}
        <Area type="monotone" dataKey="hi_outer" stackId="fan" fill={C.grn} stroke="none" fillOpacity={0.13}/>
        {/* Median */}
        <Line type="monotone" dataKey="p50" stroke={C.grn} strokeWidth={2} dot={false}/>
        <ReferenceLine y={1} stroke={C.mut} strokeDasharray="4 4"/>
      </ComposedChart>
    </ResponsiveContainer>
    )}
    </ChartPanel>
  );
}

function EfficientFrontierChart({ frontier }) {
  const C = useC();
  const toXY = p => ({ vol:+(p.vol*100).toFixed(3), ret:+(p.ret*100).toFixed(3), sharpe:p.sharpe });
  const cloud   = frontier.cloud.map(toXY);
  const cur     = [toXY(frontier.current)];
  const maxSh   = [toXY(frontier.max_sharpe)];
  const minV    = [toXY(frontier.min_vol)];
  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload || {};
    return (
      <div style={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"8px 12px",...mono(10,C.txt)}}>
        <div>Vol: <strong>{d.vol?.toFixed(1)}%</strong></div>
        <div>Return: <strong>{d.ret?.toFixed(1)}%</strong></div>
        {d.sharpe != null && <div>Sharpe: <strong>{d.sharpe?.toFixed(2)}</strong></div>}
      </div>
    );
  };
  return (
    <ChartPanel title="Efficient Frontier" defaultHeight={280}>
    {(h) => (
    <ResponsiveContainer width="100%" height={h}>
      <ScatterChart margin={{top:10,right:20,bottom:24,left:16}}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
        <XAxis dataKey="vol" name="Vol" unit="%" type="number" domain={["auto","auto"]}
          tick={{fill:C.mut,fontSize:9}}
          label={{value:"Annualised Volatility %",fill:C.mut,fontSize:9,position:"insideBottom",offset:-8}}/>
        <YAxis dataKey="ret" name="Return" unit="%" type="number" domain={["auto","auto"]}
          tick={{fill:C.mut,fontSize:9}}
          label={{value:"Return %",fill:C.mut,fontSize:9,angle:-90,position:"insideLeft",offset:10}}/>
        <Tooltip content={tip} cursor={{strokeDasharray:"3 3"}}/>
        <Scatter name="Portfolios"  data={cloud}  fill={C.sky} fillOpacity={0.35} r={2}/>
        <Scatter name="Max Sharpe" data={maxSh}  fill={C.grn} r={8}/>
        <Scatter name="Min Vol"    data={minV}   fill={C.pur} r={8}/>
        <Scatter name="Current"    data={cur}    fill={C.amb} r={8}/>
      </ScatterChart>
    </ResponsiveContainer>
    )}
    </ChartPanel>
  );
}

const TICKER_COLORS = [
  "#00e676","#40c4ff","#b388ff","#ffb300","#ff8a65",
  "#ff5252","#69f0ae","#80d8ff","#ea80fc","#ffff00",
  "#ff6d00","#00e5ff","#76ff03","#d500f9","#ff4081",
];

function StackedHoldingsChart({ perTickerSeries, tickers }) {
  const C = useC();
  if (!perTickerSeries?.length || !tickers?.length) return null;
  return (
    <ChartPanel title="Holdings Contribution Over Time" defaultHeight={240}>
    {(h) => (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={perTickerSeries} margin={{top:4,right:6,bottom:4,left:55}}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
        <XAxis dataKey="date" tick={{fill:C.mut,fontSize:8}} tickFormatter={d=>d.slice(0,7)}/>
        <YAxis
          tickFormatter={v=>v.toFixed(2)}
          tick={{fill:C.mut,fontSize:9}} tickLine={false}
          label={{value:"Portfolio Weight",angle:-90,position:"insideLeft",offset:22,
            style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
        <Tooltip
          formatter={(v,name)=>[`${(v*100).toFixed(2)}% contrib`,name]}
          contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,fontSize:10}}/>
        <ReferenceLine y={1} stroke={C.mut} strokeDasharray="4 4" strokeOpacity={0.5}/>
        {tickers.map((t,i)=>(
          <Area key={t} type="monotone" dataKey={t} stackId="portfolio"
            fill={TICKER_COLORS[i%TICKER_COLORS.length]}
            stroke={TICKER_COLORS[i%TICKER_COLORS.length]}
            fillOpacity={0.72} strokeWidth={1}/>
        ))}
      </AreaChart>
    </ResponsiveContainer>
    )}
    </ChartPanel>
  );
}

function PortfolioView() {
  const C = useC();
  const { token } = useAuth();
  const DEFAULT_HOLDINGS = [
    {ticker:"AAPL",weight:20},{ticker:"MSFT",weight:18},{ticker:"NVDA",weight:15},
    {ticker:"GOOGL",weight:12},{ticker:"AMZN",weight:10},{ticker:"JPM",weight:10},
    {ticker:"BRK-B",weight:8},{ticker:"UNH",weight:7},
  ];
  const [holdings, setHoldings] = useState(()=>{
    try { const s=localStorage.getItem("portfolio"); return s?JSON.parse(s):DEFAULT_HOLDINGS; }
    catch { return DEFAULT_HOLDINGS; }
  });
  const [jobId,     setJobId]    = useState(null);
  const [job,       setJob]      = useState(null);
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState(null);
  const [inputMode, setInputMode]= useState("weight"); // "weight" | "shares"
  const [newTicker, setNewTicker]= useState("");
  const [newVal,    setNewVal]   = useState("");
  const [rfr,       setRfr]      = useState(5.0);
  const BASE = "/api";
  const results = job?.results;

  // Persist holdings + mode
  useEffect(()=>{ try{localStorage.setItem("portfolio",JSON.stringify(holdings));}catch{} },[holdings]);
  useEffect(()=>{ try{localStorage.setItem("portfolioMode",inputMode);}catch{} },[inputMode]);

  // Poll job
  useEffect(()=>{
    if (!jobId) return;
    if (job?.status==="complete"||job?.status==="failed") return;
    const iv = setInterval(async()=>{
      try {
        const r=await fetch(`${BASE}/portfolio/job/${jobId}`);
        const d=await r.json();
        setJob(d);
        if(d.status==="complete"||d.status==="failed"){ clearInterval(iv); setLoading(false); }
      } catch{}
    },2000);
    return ()=>clearInterval(iv);
  },[jobId,job]);

  const totalW = holdings.reduce((s,h)=>s+(parseFloat(h.weight)||0),0);
  const totalSh= holdings.reduce((s,h)=>s+(parseFloat(h.shares)||0),0);

  async function runAnalysis(){
    setError(null); setLoading(true); setJob(null);
    try {
      const h=holdings.filter(h=>h.ticker.trim()).map(h=>(
        inputMode==="shares"
          ? { ticker:h.ticker.toUpperCase().trim(), shares:parseFloat(h.shares)||0 }
          : { ticker:h.ticker.toUpperCase().trim(), weight:(parseFloat(h.weight)||0)/Math.max(totalW,1) }
      ));
      if(!h.length) throw new Error("Add at least one holding");
      const r=await fetch(`${BASE}/portfolio/analyze`,{
        method:"POST",
        headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},
        body:JSON.stringify({holdings:h,risk_free_rate:rfr/100}),
      });
      const d=await r.json();
      if(!r.ok) throw new Error(friendlyError(d.detail)||"Failed");
      setJobId(d.job_id);
    } catch(e){ setError(e.message); setLoading(false); }
  }

  function addHolding(){
    if(!newTicker.trim()) return;
    const v=parseFloat(newVal)||( inputMode==="shares"?10:10 );
    if(inputMode==="shares")
      setHoldings(h=>[...h,{ticker:newTicker.toUpperCase().trim(),shares:v,weight:0,locked:false}]);
    else
      setHoldings(h=>[...h,{ticker:newTicker.toUpperCase().trim(),weight:v,shares:0,locked:false}]);
    setNewTicker(""); setNewVal("");
  }
  function removeHolding(i){ setHoldings(h=>h.filter((_,idx)=>idx!==i)); }
  function updateField(i,field,val){
    setHoldings(h=>h.map((item,idx)=>idx===i?{...item,[field]:parseFloat(val)||0}:item));
  }
  function toggleLock(i){
    setHoldings(h=>h.map((item,idx)=>idx===i?{...item,locked:!item.locked}:item));
  }

  const pctFmt = v => v==null?"—":`${(v*100).toFixed(2)}%`;
  const valCol = (v,invert)=>{ if(v==null)return C.mut; if(invert) return v<0?C.grn:v>0?C.red:C.mut; return v>0?C.grn:v<0?C.red:C.mut; };
  const m = results?.metrics;
  const [stressRes,  setStressRes]  = useState(null);
  const [stressLoad, setStressLoad] = useState(false);
  const [perfPeriod, setPerfPeriod] = useState("3y");

  async function runStressTest() {
    if (!results) return;
    setStressLoad(true);
    try {
      const validH  = holdings.filter(h=>h.ticker.trim());
      const tickers = validH.map(h=>h.ticker.toUpperCase().trim());
      const rawW    = validH.map(h=>parseFloat(h.weight)||0);
      const sumW    = rawW.reduce((a,b)=>a+b,0)||1;
      const weights = rawW.map(w=>w/sumW);
      const r = await fetch("/api/portfolio/stress", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({tickers, weights}),
      });
      if (r.ok) setStressRes(await r.json());
    } catch(_) {}
    setStressLoad(false);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* Header */}
      <div>
        <div style={{...mono(20,C.headingTxt,700),marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
          <Briefcase size={20} style={{color:C.grn}}/> Portfolio Analyzer
        </div>
        <div style={mono(11,C.mut)}>Enter your holdings, run 500-path Monte Carlo simulations, and compute risk metrics including Sharpe, Sortino, VaR, and drawdown.</div>
      </div>

      {/* Holdings editor */}
      <Card>
        {/* Header row with mode toggle */}
        <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
          <Lbl color={C.headingTxt}>Holdings</Lbl>
          <div style={{marginLeft:"auto",display:"flex",gap:4}}>
            {[{k:"weight",l:"Weight %"},{k:"shares",l:"Shares"}].map(({k,l})=>(
              <button key={k} onClick={()=>setInputMode(k)}
                style={{padding:"3px 12px",borderRadius:6,
                  border:`1px solid ${inputMode===k?C.grn:C.bdr}`,
                  background:inputMode===k?C.grnBg:"transparent",
                  cursor:"pointer",...mono(9,inputMode===k?C.grn:C.mut,600)}}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",...mono(11,C.txt)}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${C.bdr}`}}>
                {["Ticker", inputMode==="shares"?"Shares":"Weight", "Allocation","Lock",""].map((h,i)=>(
                  <th key={i} style={{padding:"4px 10px",textAlign:i>1?"center":"left",
                    ...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdings.map((h,i)=>{
                const isShares = inputMode==="shares";
                const rawVal   = isShares ? (parseFloat(h.shares)||0) : (parseFloat(h.weight)||0);
                const total    = isShares ? totalSh : totalW;
                const alloc    = total>0 ? rawVal/total*100 : 0;
                const isLocked = !!h.locked;
                return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.bdr}20`,
                    background:isLocked?C.sky+"06":"transparent",
                    transition:"background .15s"}}>
                    <td style={{padding:"6px 10px",fontWeight:700,color:C.headingTxt}}>
                      {h.ticker}
                    </td>
                    <td style={{padding:"6px 10px"}}>
                      <input type="number" value={rawVal||""} min={0}
                        step={isShares?1:1} placeholder={isShares?"qty":"wt"}
                        disabled={isLocked}
                        onChange={e=>updateField(i, isShares?"shares":"weight", e.target.value)}
                        style={{width:80,background:isLocked?C.bdr:C.dim,
                          border:`1px solid ${isLocked?C.sky+"40":C.bdr}`,borderRadius:6,
                          padding:"3px 6px",color:C.txt,opacity:isLocked?.6:1,...mono(11),
                          cursor:isLocked?"not-allowed":"text"}}/>
                      {isShares && (
                        <span style={{...mono(9,C.mut),marginLeft:5}}>shares</span>
                      )}
                    </td>
                    <td style={{padding:"6px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,minWidth:120}}>
                        <div style={{flex:1,height:5,background:C.dim,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${alloc}%`,height:"100%",
                            background:isLocked?C.sky:C.sky,borderRadius:3,
                            opacity:isLocked?.7:1}}/>
                        </div>
                        <span style={mono(10,C.txt,600)}>{alloc.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{padding:"6px 10px",textAlign:"center"}}>
                      <button onClick={()=>toggleLock(i)}
                        title={isLocked?"Unlock weight":"Lock weight"}
                        style={{background:"transparent",border:"none",cursor:"pointer",
                          padding:"2px 4px",color:isLocked?C.sky:C.mut,
                          transition:"color .15s"}}>
                        {isLocked
                          ? <Lock size={13} style={{color:C.sky}}/>
                          : <Unlock size={13} style={{color:C.mut}}/>}
                      </button>
                    </td>
                    <td style={{padding:"6px 10px",textAlign:"center"}}>
                      <button onClick={()=>removeHolding(i)}
                        disabled={isLocked}
                        style={{background:"transparent",border:"none",cursor:isLocked?"not-allowed":"pointer",
                          color:isLocked?C.bdr:C.red,fontSize:16,lineHeight:1,padding:"0 4px"}}>×</button>
                    </td>
                  </tr>
                );
              })}
              {/* Add row */}
              <tr style={{borderTop:`1px solid ${C.bdr}`}}>
                <td style={{padding:"7px 10px"}}>
                  <input placeholder="TICKER" value={newTicker}
                    onChange={e=>setNewTicker(e.target.value.toUpperCase())}
                    onKeyDown={e=>e.key==="Enter"&&addHolding()}
                    style={{width:80,background:C.dim,border:`1px solid ${C.grn}40`,borderRadius:6,
                      padding:"3px 7px",color:C.grn,...mono(11)}}/>
                </td>
                <td style={{padding:"7px 10px"}}>
                  <input type="number"
                    placeholder={inputMode==="shares"?"qty":"weight"}
                    value={newVal}
                    onChange={e=>setNewVal(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addHolding()}
                    style={{width:80,background:C.dim,border:`1px solid ${C.bdr}`,borderRadius:6,
                      padding:"3px 6px",color:C.txt,...mono(11)}}/>
                </td>
                <td colSpan={2} style={{padding:"7px 10px"}}>
                  <button onClick={addHolding}
                    style={{padding:"4px 14px",borderRadius:8,background:C.grnBg,
                      border:`1px solid ${C.grn}40`,cursor:"pointer",...mono(10,C.grn,600)}}>
                    + Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {inputMode==="shares" && (
          <div style={{...mono(9,C.mut),marginTop:6,lineHeight:1.6}}>
            Shares mode — backend fetches current market prices to derive portfolio weights automatically.
          </div>
        )}

        {/* Controls row */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:14,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={mono(10,C.txt)}>Risk-Free Rate</span>
            <input type="number" value={rfr} min={0} max={20} step={0.1}
              onChange={e=>setRfr(parseFloat(e.target.value)||0)}
              style={{width:52,background:C.dim,border:`1px solid ${C.bdr}`,borderRadius:6,
                padding:"3px 6px",color:C.txt,...mono(11)}}/>
            <span style={mono(10,C.txt)}>%</span>
          </div>
          <SpinRing active={loading}>
          <button onClick={runAnalysis} disabled={loading||holdings.length===0}
            style={{padding:"7px 22px",borderRadius:8,border:`1px solid ${C.grn}`,
              background:loading?C.grnBg:`${C.grn}18`,cursor:loading?"not-allowed":"pointer",
              ...mono(11,loading?C.mut:C.grn,700),display:"flex",alignItems:"center",gap:6}}>
            {loading
              ? <><RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/> Analysing…</>
              : <><Play size={12}/> Run Analysis</>}
          </button>
          </SpinRing>
          {job?.status==="complete" && (
            <span style={mono(10,C.grn)}>✓ Done · {results?.as_of?.slice(0,19).replace("T"," ")} UTC · {results?.n_days} trading days</span>
          )}
          {results?.missing?.length>0 && (
            <span style={mono(10,C.amb)}>⚠ No data for: {results.missing.join(", ")}</span>
          )}
        </div>
        {error && <div style={{...mono(10,C.red),marginTop:8}}>⚠ {error}</div>}
        {job?.status==="failed" && <div style={{...mono(10,C.red),marginTop:8}}>⚠ Analysis failed: {job.error}</div>}
      </Card>

      {/* Loading placeholder */}
      {loading && !results && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"36px 0",display:"flex",
            flexDirection:"column",alignItems:"center",gap:14}}>
            <RefreshCw size={22} style={{color:C.sky,animation:"spin 1s linear infinite"}}/>
            <div>
              Fetching 3 years of price history and computing portfolio analytics…
              <div style={mono(9,C.mut)}>500 Monte Carlo paths · correlation matrix · efficient frontier</div>
            </div>
          </div>
        </Card>
      )}

      {/* Results section */}
      {results && <>

        {/* 9-metric grid */}
        <div>
          <SectionSep label="Portfolio Metrics · 3-Year History"/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(158px,1fr))",gap:10}}>
            <Stat label="Ann. Return"    value={pctFmt(m.ann_return)}
              color={valCol(m.ann_return)} sub="Compounded 3Y"
              tip="Annualised compound return based on 3 years of daily prices."/>
            <Stat label="Volatility"     value={pctFmt(m.ann_vol)}
              color={m.ann_vol>0.28?C.red:m.ann_vol>0.16?C.amb:C.grn} sub="Std dev × √252"
              tip="Annualised standard deviation of daily portfolio returns."/>
            <Stat label="Sharpe Ratio"   value={m.sharpe?.toFixed(2)}
              color={m.sharpe>1.5?C.grn:m.sharpe>0.5?C.amb:C.red} sub={`RFR ${rfr}%`}
              tip="(Ann. Return − Risk-Free Rate) / Ann. Vol. >1 = solid; >2 = excellent."/>
            <Stat label="Sortino Ratio"  value={m.sortino?.toFixed(2)}
              color={m.sortino>1.5?C.grn:m.sortino>0.5?C.amb:C.red} sub="Downside vol only"
              tip="Like Sharpe but only penalises downside volatility. Better for asymmetric strategies."/>
            <Stat label="Max Drawdown"   value={pctFmt(m.max_drawdown)}
              color={valCol(m.max_drawdown,true)} sub="Worst peak-trough"
              tip="Largest percentage drop from a portfolio high to a subsequent low."/>
            <Stat label="VaR 95%"        value={pctFmt(m.var_95)}
              color={C.red} sub="Daily 5th pct"
              tip="On 95% of days losses are smaller than this. The worst 5% can exceed it."/>
            <Stat label="CVaR 95%"       value={pctFmt(m.cvar_95)}
              color={C.red} sub="Expected tail loss"
              tip="Expected Shortfall: the average return on the worst 5% of days."/>
            <Stat label="Beta (SPY)"     value={m.beta_spy!=null?m.beta_spy?.toFixed(2):"—"}
              color={m.beta_spy!=null?(Math.abs(m.beta_spy)>1.3?C.red:C.grn):C.mut}
              sub="Market sensitivity"
              tip="Beta=1 moves 1:1 with S&P 500. >1 = amplified market moves; <1 = dampened."/>
            <Stat label="Corr (SPY)"     value={m.corr_spy!=null?m.corr_spy?.toFixed(2):"—"}
              color={m.corr_spy!=null?(m.corr_spy>0.85?C.amb:C.grn):C.mut}
              sub="Pearson"
              tip="Correlation to S&P 500. High correlation means little diversification from the broad market."/>
          </div>
        </div>

        {/* Per-ticker breakdown */}
        <div>
          <SectionSep label="Holdings Breakdown"/>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",...mono(11,C.txt)}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.bdr}`}}>
                    {["Ticker","Weight","Ann. Return","Ann. Vol","Sharpe","Beta","Corr SPY"].map((h,i)=>(
                      <th key={i} style={{padding:"5px 10px",textAlign:i>0?"right":"left",
                        ...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.per_ticker.map((t,i)=>(
                    <tr key={t.ticker} style={{borderBottom:`1px solid ${C.bdr}20`,
                      background:i%2===0?"transparent":C.dim+"30"}}>
                      <td style={{padding:"6px 10px",fontWeight:700,color:C.headingTxt}}>{t.ticker}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",color:C.mut}}>{(t.weight*100).toFixed(1)}%</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,
                        color:t.ann_return>0?C.grn:C.red}}>{(t.ann_return*100).toFixed(2)}%</td>
                      <td style={{padding:"6px 10px",textAlign:"right",
                        color:t.ann_vol>0.35?C.red:t.ann_vol>0.22?C.amb:C.mut}}>{(t.ann_vol*100).toFixed(2)}%</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,
                        color:t.sharpe>1.5?C.grn:t.sharpe>0.5?C.amb:C.red}}>{t.sharpe?.toFixed(2)}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",color:C.txt}}>{t.beta_spy!=null?t.beta_spy?.toFixed(2):"—"}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",color:C.txt}}>{t.corr_spy!=null?t.corr_spy?.toFixed(2):"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Stacked holdings chart — full width */}
        <div>
          <SectionSep label="Holdings Contribution Over Time (Stacked)"/>
          <Card>
            <StackedHoldingsChart
              perTickerSeries={results.per_ticker_series}
              tickers={results.tickers}/>
            {/* Colour legend */}
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",marginTop:10}}>
              {results.tickers.map((t,i)=>(
                <div key={t} style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:10,height:10,borderRadius:2,
                    background:TICKER_COLORS[i%TICKER_COLORS.length],flexShrink:0}}/>
                  <span style={mono(9,C.mut)}>{t}</span>
                </div>
              ))}
            </div>
            <div style={{...mono(9,C.mut),marginTop:6,lineHeight:1.6}}>
              Each band = weight × cumulative return for that holding. Stacked total = portfolio value.
              Rising bands mean that name is appreciating and growing its share of the portfolio.
            </div>
          </Card>
        </div>

        {/* Portfolio Performance Chart */}
        {(()=>{
          const hist = results.historical || [];
          const now = new Date();
          const ytdStart = `${now.getFullYear()}-01-01`;
          const oneYrStart = new Date(now);
          oneYrStart.setFullYear(now.getFullYear()-1);
          const oneYrStr = oneYrStart.toISOString().slice(0,10);
          const filtered = perfPeriod==="ytd" ? hist.filter(d=>d.date>=ytdStart)
            : perfPeriod==="1y" ? hist.filter(d=>d.date>=oneYrStr)
            : hist;
          const sampled = filtered.filter((_,i,a)=>i%Math.max(1,Math.floor(a.length/200))===0);
          const base = sampled[0]?.value||1;
          const pts = sampled.map(d=>({date:d.date,value:(d.value/base)*100}));
          const latest = pts[pts.length-1]?.value;
          const perfPct = latest!=null ? ((latest/100)-1)*100 : null;
          const lineCol = perfPct==null||perfPct>=0 ? C.grn : C.red;
          return (
            <div>
              <SectionSep label="Portfolio Performance"/>
              <Card>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                  <span style={mono(10,C.headingTxt,700)}>Cumulative Return</span>
                  {perfPct!=null && (
                    <span style={{...mono(16,lineCol,800)}}>
                      {perfPct>=0?"+":""}{perfPct.toFixed(2)}%
                    </span>
                  )}
                  <div style={{marginLeft:"auto",display:"flex",gap:4}}>
                    {[["ytd","YTD"],["1y","1 Year"],["3y","3 Year"]].map(([k,l])=>(
                      <button key={k} onClick={()=>setPerfPeriod(k)}
                        style={{padding:"3px 10px",borderRadius:6,cursor:"pointer",
                          border:`1px solid ${perfPeriod===k?C.grn:C.bdr}`,
                          background:perfPeriod===k?C.grnBg:"transparent",
                          ...mono(9,perfPeriod===k?C.grn:C.mut,600)}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <ChartPanel title="" defaultHeight={220}>
                  {(h)=>(
                    <ResponsiveContainer width="100%" height={h}>
                      <AreaChart data={pts} margin={{top:4,right:6,bottom:4,left:55}}>
                        <defs>
                          <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={lineCol} stopOpacity={0.18}/>
                            <stop offset="95%" stopColor={lineCol} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                        <XAxis dataKey="date" tick={{fill:C.mut,fontSize:8}} tickFormatter={d=>d.slice(0,7)}/>
                        <YAxis tick={{fill:C.mut,fontSize:9}} tickLine={false}
                          tickFormatter={v=>`${(v-100).toFixed(0)}%`}
                          label={{value:"Return (%)",angle:-90,position:"insideLeft",offset:20,
                            style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
                        <Tooltip formatter={v=>[`${(v-100).toFixed(2)}%`,"Portfolio"]}
                          contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,fontSize:10}}/>
                        <ReferenceLine y={100} stroke={C.mut} strokeDasharray="4 4"/>
                        <Area type="monotone" dataKey="value" stroke={lineCol}
                          fill="url(#perfGrad)" strokeWidth={2} dot={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </ChartPanel>
                <div style={{...mono(9,C.mut),marginTop:6}}>
                  Indexed to 100 at period start · {results.n_days} trading days of 3Y history available
                </div>
              </Card>
            </div>
          );
        })()}

        {/* Two-col: Correlation + Historical */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:14,alignItems:"start"}}>
          <div>
            <SectionSep label="Correlation Matrix"/>
            <Card>
              <CorrelationHeatmap
                tickers={results.correlation_matrix.tickers}
                matrix={results.correlation_matrix.matrix}/>
              <div style={{...mono(9,C.mut),marginTop:8,lineHeight:1.6}}>
                Green = positively correlated · Red = inversely correlated.
                High intra-portfolio correlation reduces diversification benefit.
              </div>
            </Card>
          </div>
          <div>
            <SectionSep label="Historical Cumulative Return (3Y)"/>
            <Card>
              <ChartPanel title="Historical Cumulative Return (3Y)" defaultHeight={210}>
              {(h) => (
              <ResponsiveContainer width="100%" height={h}>
                <AreaChart data={results.historical.filter((_,i,a)=>i%Math.max(1,Math.floor(a.length/150))===0)}
                  margin={{top:4,right:6,bottom:4,left:55}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                  <XAxis dataKey="date" tick={{fill:C.mut,fontSize:8}} tickFormatter={d=>d.slice(0,7)}/>
                  <YAxis tickFormatter={v=>`${((v-1)*100).toFixed(0)}%`} tick={{fill:C.mut,fontSize:9}} tickLine={false}
                    label={{value:"Cumulative Return (%)",angle:-90,position:"insideLeft",offset:20,
                      style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
                  <Tooltip formatter={v=>[`${((v-1)*100).toFixed(2)}%`,"Portfolio"]}
                    contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,fontSize:10}}/>
                  <ReferenceLine y={1} stroke={C.mut} strokeDasharray="4 4"/>
                  <Area type="monotone" dataKey="value" stroke={C.grn} fill={C.grn}
                    fillOpacity={0.12} strokeWidth={2} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
              )}
              </ChartPanel>
            </Card>
          </div>
        </div>

        {/* Monte Carlo */}
        <div>
          <SectionSep label="Monte Carlo Simulation · 500 Paths · 252 Trading Days"/>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14,alignItems:"start"}}>
            <Card>
              <MCFanChart fanData={results.mc_fan}/>
              <div style={{...mono(9,C.mut),marginTop:6,lineHeight:1.6}}>
                Correlated GBM paths via Cholesky decomposition. Starting value = $1.00.
                Outer bands = P5–P95 · Inner bands = P25–P75 · Green line = median.
              </div>
            </Card>
            <Card>
              <Lbl>Simulation Summary (1Y)</Lbl>
              <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                {[
                  {l:"Median outcome",    v:`${((results.mc_summary.median_final-1)*100).toFixed(1)}%`,
                    c:results.mc_summary.median_final>=1?C.grn:C.red},
                  {l:"95th percentile",   v:`+${((results.mc_summary.p95_final-1)*100).toFixed(1)}%`, c:C.grn},
                  {l:"5th percentile",    v:`${((results.mc_summary.p5_final-1)*100).toFixed(1)}%`,   c:C.red},
                  {l:"Prob. profit",      v:`${(results.mc_summary.prob_profit*100).toFixed(1)}%`,
                    c:results.mc_summary.prob_profit>=0.6?C.grn:results.mc_summary.prob_profit>=0.4?C.amb:C.red},
                  {l:"Prob. loss > 20%",  v:`${(results.mc_summary.prob_loss_20pct*100).toFixed(1)}%`,
                    c:results.mc_summary.prob_loss_20pct<=0.08?C.grn:results.mc_summary.prob_loss_20pct<=0.2?C.amb:C.red},
                ].map(({l,v,c})=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",
                    alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${C.bdr}30`}}>
                    <span style={mono(10,C.mut)}>{l}</span>
                    <span style={{...mono(14,c,700)}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{...mono(9,C.mut),marginTop:10,lineHeight:1.7}}>
                Based on fitted 3Y historical return and covariance. Past behaviour ≠ future results.
              </div>
            </Card>
          </div>
        </div>

        {/* Efficient Frontier */}
        <div>
          <SectionSep label="Efficient Frontier · 800 Random Portfolios"/>
          <Card>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14,alignItems:"start"}}>
              <EfficientFrontierChart frontier={results.efficient_frontier}/>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <Lbl>Legend</Lbl>
                {[
                  {c:C.sky, l:"Portfolio Cloud",   d:"800 randomly sampled weight allocations across your tickers"},
                  {c:C.amb, l:"★ Your Portfolio",   d:`Return ${(results.efficient_frontier.current.ret).toFixed(1)}% · Vol ${(results.efficient_frontier.current.vol).toFixed(1)}%`},
                  {c:C.grn, l:"● Max Sharpe",       d:`Sharpe ${results.efficient_frontier.max_sharpe.sharpe?.toFixed(2)} — best risk-adjusted return`},
                  {c:C.pur, l:"● Min Volatility",   d:`Vol ${(results.efficient_frontier.min_vol.vol).toFixed(1)}% — minimum portfolio variance`},
                ].map(({c,l,d})=>(
                  <div key={l} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0,marginTop:2}}/>
                    <div>
                      <div style={mono(10,C.headingTxt,700)}>{l}</div>
                      <div style={mono(9,C.mut)}>{d}</div>
                    </div>
                  </div>
                ))}
                <div style={{...mono(9,C.mut),marginTop:10,borderTop:`1px solid ${C.bdr}`,paddingTop:10,lineHeight:1.7}}>
                  Portfolios to the upper-left of the cloud are sub-optimal — same return is achievable at lower risk by rebalancing toward the frontier.
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Stress Tests ── */}
        <div>
          <SectionSep label="Stress Test · Historical Shock Scenarios"/>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <SpinRing active={stressLoad} color={C.red}>
            <button onClick={runStressTest} disabled={stressLoad||!results}
              style={{padding:"7px 20px",borderRadius:8,
                border:`1px solid ${C.red}`,
                background:stressLoad?`${C.red}10`:"transparent",
                cursor:stressLoad||!results?"not-allowed":"pointer",
                ...mono(11,stressLoad?C.mut:C.red,700),
                display:"flex",alignItems:"center",gap:6}}>
              {stressLoad
                ? <><RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/> Running scenarios…</>
                : <><Shield size={12}/> Run Stress Test</>}
            </button>
            </SpinRing>
            {stressRes && <span style={mono(9,C.grn)}>✓ {stressRes.scenarios?.length} scenarios computed</span>}
          </div>
          {stressRes?.scenarios?.length > 0 && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:10}}>
              {stressRes.scenarios.map(sc=>{
                const ret = sc.portfolio_return;
                const col = ret < -0.2 ? C.red : ret < -0.1 ? C.amb : C.grn;
                return (
                  <Card key={sc.name}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
                      <div style={mono(10,C.headingTxt,700)}>{sc.name}</div>
                      <div style={{...mono(15,col,800),letterSpacing:"-0.02em"}}>
                        {ret>0?"+":""}{(ret*100).toFixed(1)}%
                      </div>
                    </div>
                    <div style={{height:4,borderRadius:2,background:C.dim,overflow:"hidden",marginBottom:8}}>
                      <div style={{
                        width:`${Math.min(100,Math.abs(ret)*200)}%`,height:"100%",
                        background:col,opacity:0.8,
                        marginLeft:ret<0?"auto":0
                      }}/>
                    </div>
                    {sc.worst_ticker && (
                      <div style={mono(9,C.mut)}>
                        Worst: <span style={{color:C.red,fontWeight:700}}>{sc.worst_ticker}</span>
                        {sc.worst_return!=null && <span> ({(sc.worst_return*100).toFixed(1)}%)</span>}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          {!stressRes && !stressLoad && (
            <Card>
              <div style={{...mono(10,C.mut),textAlign:"center",padding:"20px 0"}}>
                Click <strong style={{color:C.red}}>Run Stress Test</strong> to apply 6 historical shock scenarios
                (2008 GFC, 2020 COVID, 2022 Rate Shock, Dot-com, +100bps, Flash Crash) to your portfolio weights.
              </div>
            </Card>
          )}
        </div>

      </>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TECHNICAL ANALYSIS VIEW — TradingView-style chart
// ─────────────────────────────────────────────────────────────────────────────
const TV_G = "#26a69a";   // TradingView bull green
const TV_R = "#ef5350";   // TradingView bear red
const SMA_COLS = {"20":"#ef9b20","50":"#2196f3","200":"#9c27b0","10":"#ef9b20","100":"#2196f3"};
const EMA_COLS = {"9":"#e91e63","12":"#e91e63","21":"#00bcd4","26":"#00bcd4"};
const TV_Y_AX_W = 80;   // wider right gutter keeps Fib labels outside the candle zone
const TV_X_AX_H = 22;
const TV_MAIN_H = 340;

// ── TV-themed indicator hover tooltip ────────────────────────────────────────
function TVTip({ children, title, desc, bands, signals }) {
  const [anchor, setAnchor] = useState(null);
  const tipW = 296;
  const onMove = e => setAnchor({ x: e.clientX, y: e.clientY });
  const onLeave = () => setAnchor(null);
  const left = anchor ? Math.min(anchor.x + 14, window.innerWidth - tipW - 8) : 0;
  const top  = anchor ? anchor.y + 16 : 0;
  return (
    <span style={{position:"relative",display:"inline-block"}}
      onMouseEnter={onMove} onMouseMove={onMove} onMouseLeave={onLeave}>
      <span style={{cursor:"help",borderBottom:"1px dashed #787b8666",paddingBottom:1}}>
        {children}
      </span>
      {anchor && (
        <div style={{
          position:"fixed", left, top, width:tipW, zIndex:99999,
          background:"#0d1117", border:"1px solid #363a4a",
          borderRadius:10, padding:"13px 15px",
          boxShadow:"0 12px 36px rgba(0,0,0,.75)",
          pointerEvents:"none", fontFamily:"monospace",
        }}>
          {/* Title */}
          <div style={{fontSize:11,fontWeight:800,color:"#d1d4dc",marginBottom:5,letterSpacing:".04em"}}>
            {title}
          </div>
          {/* Description */}
          <div style={{fontSize:9,color:"#9598a1",lineHeight:1.7,marginBottom:10}}>
            {desc}
          </div>
          {/* Bands */}
          {bands?.length > 0 && (
            <div style={{marginBottom:10}}>
              <div style={{fontSize:8,color:"#555",letterSpacing:".08em",marginBottom:5}}>REFERENCE LEVELS</div>
              {bands.map((b,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:b.color,flexShrink:0}}/>
                  <span style={{fontSize:9,color:b.color,fontWeight:700,minWidth:90}}>{b.label}</span>
                  <span style={{fontSize:9,color:"#787b86"}}>{b.range}</span>
                </div>
              ))}
            </div>
          )}
          {/* Signals to watch */}
          {signals?.length > 0 && (
            <div>
              <div style={{fontSize:8,color:"#555",letterSpacing:".08em",marginBottom:5}}>WATCH FOR</div>
              {signals.map((s,i) => (
                <div key={i} style={{fontSize:9,color:"#9598a1",lineHeight:1.6,paddingLeft:8,
                  borderLeft:"2px solid #2a2e39",marginBottom:3}}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

// ── Panel tooltip content library ─────────────────────────────────────────────
const PANEL_TIPS = {
  vol: {
    title: "Volume",
    desc: "Counts shares/contracts traded per bar. High volume validates a price move — low volume questions it. Volume precedes price.",
    bands: [
      {color:TV_G,    label:"High (>1.5× avg)", range:"Conviction behind the move"},
      {color:"#787b86",label:"Average",          range:"Normal activity, neutral"},
      {color:TV_R,    label:"Low on breakout",   range:"Weak signal — may fail"},
    ],
    signals: [
      "Price ↑ + volume ↑ → healthy uptrend, trend is real",
      "Price ↑ + volume ↓ → weakening trend, watch for reversal",
      "Volume spike on reversal bar → potential trend change",
      "Climactic volume (huge spike) → exhaustion, likely top/bottom",
      "OBV rising while price flat → accumulation underway",
    ],
  },
  rsi: {
    title: "RSI — Relative Strength Index",
    desc: "Momentum oscillator comparing average gains to average losses over N bars. Ranges 0–100. Uses Wilder's smoothed EMA method.",
    bands: [
      {color:TV_R,    label:"> 70 Overbought", range:"Selling pressure likely"},
      {color:"#d1d4dc",label:"50 – 70",         range:"Bullish momentum zone"},
      {color:"#555",  label:"= 50",             range:"Neutral midline"},
      {color:"#d1d4dc",label:"30 – 50",         range:"Bearish momentum zone"},
      {color:TV_G,    label:"< 30 Oversold",    range:"Bounce potential"},
    ],
    signals: [
      "Crosses above 30 from below → buy signal (oversold recovery)",
      "Crosses below 70 from above → sell signal (overbought rollover)",
      "Bullish divergence: price lower low, RSI higher low → reversal up",
      "Bearish divergence: price higher high, RSI lower high → reversal down",
      "RSI > 50 = bullish bias; RSI < 50 = bearish bias for trend context",
      "In strong trends RSI can stay above 70 / below 30 for extended periods",
    ],
  },
  macd: {
    title: "MACD — Moving Avg Convergence/Divergence",
    desc: "Tracks the spread between a fast EMA and slow EMA. The Signal line smooths MACD. Histogram = MACD minus Signal — shows momentum strength.",
    bands: [
      {color:TV_G,      label:"Histogram ↑ & growing",  range:"Bullish momentum accelerating"},
      {color:"#26a69a88",label:"Histogram ↑ & shrinking", range:"Bullish momentum fading"},
      {color:"#ef535088",label:"Histogram ↓ & shrinking", range:"Bearish momentum fading"},
      {color:TV_R,      label:"Histogram ↓ & growing",  range:"Bearish momentum accelerating"},
    ],
    signals: [
      "MACD crosses above Signal → bullish crossover",
      "MACD crosses below Signal → bearish crossover",
      "Crossover above zero line = stronger bull signal than below",
      "Histogram peak before price peak → early warning of trend change",
      "Divergence between MACD and price = high-probability reversal",
      "MACD far from zero = extended move, mean reversion possible",
    ],
  },
  stoch: {
    title: "Stochastic Oscillator %K / %D",
    desc: "Compares close to the N-period high-low range. %K is the raw fast line; %D is its smoothed signal line. Best in ranging, mean-reverting markets.",
    bands: [
      {color:TV_R,    label:"> 80 Overbought", range:"Watch for %K cross below %D"},
      {color:"#d1d4dc",label:"20 – 80",         range:"Neutral — trend-following mode"},
      {color:TV_G,    label:"< 20 Oversold",   range:"Watch for %K cross above %D"},
    ],
    signals: [
      "%K crosses above %D in oversold zone → bullish buy signal",
      "%K crosses below %D in overbought zone → bearish sell signal",
      "Both lines exit extreme zone together = highest conviction setup",
      "Divergence with price in extreme zones = early reversal warning",
      "Avoid crossover signals when both lines are in the 20–80 range",
      "In strong trends, can stay overbought/oversold for many bars",
    ],
  },
  wr: {
    title: "Williams %R",
    desc: "Momentum indicator showing where price closed relative to the period's highest high. Scale: 0 (top) to -100 (bottom). Essentially an inverted Stochastic.",
    bands: [
      {color:TV_R,    label:"-20 to 0",    range:"Overbought — near period highs"},
      {color:"#787b86",label:"-20 to -80",  range:"Neutral trading range"},
      {color:TV_G,    label:"-80 to -100", range:"Oversold — near period lows"},
    ],
    signals: [
      "Rises above -20 → entering overbought, watch for reversal down",
      "Falls below -80 → entering oversold, watch for bounce up",
      "Crosses -50 upward from oversold → bullish momentum shift",
      "Crosses -50 downward from overbought → bearish momentum shift",
      "Use as confirmation alongside RSI and Stochastic for best results",
      "Failure swings near extremes = strong reversal signal",
    ],
  },
  cci: {
    title: "CCI — Commodity Channel Index",
    desc: "Measures how far price deviates from its N-period statistical mean. Cycles around zero; extreme readings suggest mean reversion is due.",
    bands: [
      {color:TV_R,    label:"> +100",      range:"Overbought / strong uptrend"},
      {color:"#d1d4dc",label:"0 to +100",   range:"Bullish bias above mean"},
      {color:"#555",  label:"= 0",         range:"At average — neutral"},
      {color:"#d1d4dc",label:"-100 to 0",   range:"Bearish bias below mean"},
      {color:TV_G,    label:"< -100",      range:"Oversold / strong downtrend"},
    ],
    signals: [
      "Crosses +100 from below → new uptrend, momentum entering strong zone",
      "Crosses -100 from above → new downtrend initiating",
      "Extreme readings (±200+) → very extended move, mean reversion likely",
      "Divergence with price at extremes = potential reversal signal",
      "Zero-line crossovers → trend bias shifting bullish or bearish",
      "Use period length: shorter (10) = more sensitive; longer (20+) = smoother",
    ],
  },
};

// ── Market Structure Framework helpers ────────────────────────────────────────
function getSignalCategory(id) {
  const s = (id||"").toLowerCase();
  if (/golden_cross|death_cross|ma_align|above_200|below_200|ema_cross|ema_stack|sma_stack|trend|200/.test(s)) return "TREND";
  if (/rsi|macd|stoch|momentum|cci|williams|wr_|oscillat/.test(s)) return "MOMENTUM";
  if (/volume|vwap|bb_|breakout|squeeze|atr|liquidity/.test(s)) return "LIQUIDITY";
  return null;
}

function computeMarketStructure(lastBar, data) {
  if (!lastBar) return null;
  const price  = lastBar.close;
  const sma20  = lastBar.sma20;
  const sma50  = lastBar.sma50;
  const sma200 = lastBar.sma200;
  const rsi    = lastBar.rsi;
  const macdH  = lastBar.macd_h;
  const stochK = lastBar.stoch_k;
  const vwap   = lastBar.vwap;

  // ── TREND (50%) ────────────────────────────────────────────────────────────
  let tp = 0, tMax = 0;
  const tFactors = [];
  if (price != null && sma200 != null) {
    tMax += 40;
    if (price > sma200) { tp += 40; tFactors.push(`Price above 200 MA ($${sma200.toFixed(0)})`); }
    else tFactors.push(`Price below 200 MA ($${sma200.toFixed(0)})`);
  }
  if (sma20 != null && sma50 != null && sma200 != null) {
    tMax += 40;
    if (sma20 > sma50 && sma50 > sma200) { tp += 40; tFactors.push("Full bull alignment (20>50>200)"); }
    else if (sma20 < sma50 && sma50 < sma200) { tFactors.push("Full bear alignment (20<50<200)"); }
    else if (sma20 > sma50) { tp += 20; tFactors.push("Partial bull (20>50 only)"); }
    else { tp += 10; tFactors.push("Mixed MA structure"); }
  }
  if (macdH != null) {
    tMax += 20;
    if (macdH > 0) { tp += 20; tFactors.push("MACD above zero"); }
    else tFactors.push("MACD below zero");
  }
  const trendScore = tMax > 0 ? (tp / tMax) * 100 : 50;
  const trendLabel = trendScore >= 75 ? "Strong Bullish"
    : trendScore >= 58 ? "Weak Bullish"
    : trendScore >= 42 ? "Neutral / Transition"
    : trendScore >= 25 ? "Weak Bearish" : "Bearish";
  const trendState = trendScore >= 58 ? "bull" : trendScore >= 42 ? "neutral" : "bear";

  // ── MOMENTUM (30%) ─────────────────────────────────────────────────────────
  let mp = 0, mMax = 0;
  const mFactors = [];
  let momLabel, momState;
  if (rsi != null) {
    mMax += 40;
    if (rsi < 30) { mp += 25; mFactors.push(`RSI ${rsi.toFixed(0)} — oversold (reset/bounce)`); }
    else if (rsi > 70) { mp += 10; mFactors.push(`RSI ${rsi.toFixed(0)} — overbought (exhaustion risk)`); }
    else if (rsi >= 50) { mp += 40; mFactors.push(`RSI ${rsi.toFixed(0)} — bullish zone`); }
    else { mp += 20; mFactors.push(`RSI ${rsi.toFixed(0)} — bearish zone`); }
  }
  if (macdH != null) {
    mMax += 35;
    if (macdH > 0) { mp += 35; mFactors.push("MACD histogram expanding"); }
    else mFactors.push("MACD histogram negative");
  }
  if (stochK != null) {
    mMax += 25;
    if (stochK < 20) { mp += 22; mFactors.push(`Stoch %K ${stochK.toFixed(0)} — oversold`); }
    else if (stochK > 80) { mp += 5; mFactors.push(`Stoch %K ${stochK.toFixed(0)} — overbought`); }
    else { mp += 13; }
  }
  const momScore = mMax > 0 ? (mp / mMax) * 100 : 50;
  const isOversold = rsi != null && rsi < 35;
  const macdNeg = macdH != null && macdH < 0;
  if (isOversold && macdNeg) { momLabel = "Resetting (Bounce Setup)"; momState = "resetting"; }
  else if (rsi != null && rsi > 70) { momLabel = "Exhausted (Reversal Risk)"; momState = "exhausted"; }
  else if (momScore >= 68) { momLabel = "Expanding (Strong)"; momState = "expanding"; }
  else if (momScore >= 50) { momLabel = "Neutral → Building"; momState = "building"; }
  else if (momScore >= 35) { momLabel = "Resetting"; momState = "resetting"; }
  else { momLabel = "Exhausted"; momState = "exhausted"; }

  // ── LIQUIDITY (20%) ────────────────────────────────────────────────────────
  let lp = 0, lMax = 0;
  const lFactors = [];
  const ohlcv = data?.ohlcv || [];
  if (ohlcv.length >= 10) {
    const recent = ohlcv.slice(-Math.min(20, ohlcv.length));
    const avgVol = recent.reduce((s,b) => s + (b.volume || 0), 0) / recent.length;
    const curVol = ohlcv[ohlcv.length - 1]?.volume || 0;
    lMax += 50;
    const vr = avgVol > 0 ? curVol / avgVol : 1;
    if (vr >= 1.5) { lp += 50; lFactors.push(`Volume ${vr.toFixed(1)}× avg — strong participation`); }
    else if (vr >= 0.75) { lp += 28; lFactors.push(`Volume ${vr.toFixed(1)}× avg — normal`); }
    else { lp += 8; lFactors.push(`Volume ${vr.toFixed(1)}× avg — thin / fading`); }
  }
  if (price != null && vwap != null && vwap > 0) {
    lMax += 50;
    const vd = (price - vwap) / vwap * 100;
    if (price > vwap) { lp += 42; lFactors.push(`Above VWAP (+${vd.toFixed(2)}%) — buyers in control`); }
    else { lp += 15; lFactors.push(`Below VWAP (${vd.toFixed(2)}%) — sellers in control`); }
  } else {
    lFactors.push("VWAP not loaded — enable overlay");
  }
  const liqScore = lMax > 0 ? (lp / lMax) * 100 : 40;
  const liqLabel = liqScore >= 65 ? "Strong Participation"
    : liqScore >= 40 ? "Mixed / Unclear" : "Weak / Fading";
  const liqState = liqScore >= 65 ? "strong" : liqScore >= 40 ? "mixed" : "weak";

  // ── NET BIAS ───────────────────────────────────────────────────────────────
  const weighted = trendScore * 0.5 + momScore * 0.3 + liqScore * 0.2;
  const netBias = weighted >= 72 ? "Strong Bullish"
    : weighted >= 60 ? "Bullish"
    : weighted >= 52 ? "Weak Bullish"
    : weighted >= 45 ? "Neutral"
    : weighted >= 35 ? "Weak Bearish" : "Bearish";
  const netColor = weighted >= 60 ? TV_G
    : weighted >= 45 ? "#787b86"
    : TV_R;

  let reason = "";
  if (trendState === "bear") reason = "Price below key MAs — trend is down";
  else if (liqState === "weak" && trendState !== "bear") reason = "Counter-trend bounce without volume confirmation";
  else if (momState === "resetting" && trendState === "bull") reason = "Healthy pullback within uptrend — watch RSI for reversal";
  else if (trendState === "bull" && momState === "expanding" && liqState === "strong") reason = "All three layers aligned — high confidence setup";
  else if (momState === "exhausted") reason = "Momentum exhausted — avoid chasing, watch for reversal";
  else reason = "Mixed signals across layers — wait for confirmation";

  return {
    trend:    { label: trendLabel,  state: trendState,  score: Math.round(trendScore), factors: tFactors.slice(0,2) },
    momentum: { label: momLabel,    state: momState,    score: Math.round(momScore),   factors: mFactors.slice(0,2) },
    liquidity:{ label: liqLabel,    state: liqState,    score: Math.round(liqScore),   factors: lFactors.slice(0,2) },
    netBias, netColor, weighted: Math.round(weighted), reason,
  };
}

function TechnicalView() {
  const C = useC();
  const containerRef = useRef(null);
  const [cw, setCw]   = useState(900);
  const [sym, setSym] = useState("SPY");
  const [inputSym, setInputSym] = useState("SPY");
  const [period, setPeriod]     = useState("1y");
  const [intv, setIntv]         = useState("1d");
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState(null);
  const [chartType, setChartType] = useState("candle");
  const [panels, setPanels] = useState({vol:true,rsi:true,macd:true,stoch:false,wr:false,cci:false});
  const [overlays, setOvl]  = useState({sma:true,ema:true,bb:true,vwap:false});
  const [showCfg, setShowCfg] = useState(false);
  const [signals, setSignals]         = useState([]);
  const [godMode, setGodMode]         = useState(null);
  const [showGodMode, setShowGodMode] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [showFib, setShowFib]         = useState(false);
  const [params, setParams] = useState({
    sma:"20,50,200", ema:"9,21",
    bbP:20, bbS:2.0, rsiP:14,
    mcdF:12, mcdSl:26, mcdSg:9,
    stK:14, stD:3, atrP:14, cciP:20, wrP:14,
  });

  // ── Container width via ResizeObserver ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setCw(e.contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const load = () => {
    setLoading(true); setErr(null);
    const q = new URLSearchParams({
      period, interval:intv,
      sma_periods:params.sma, ema_periods:params.ema,
      bb_period:params.bbP, bb_std:params.bbS,
      rsi_period:params.rsiP,
      macd_fast:params.mcdF, macd_slow:params.mcdSl, macd_signal:params.mcdSg,
      stoch_k:params.stK, stoch_d:params.stD,
      atr_period:params.atrP, cci_period:params.cciP, williams_period:params.wrP,
    }).toString();
    fetch(`/api/ta/${encodeURIComponent(sym)}?${q}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail||"Error")))
      .then(d => {
        setData(d);
        setSignals(d.signals || []);
        setGodMode(d.god_mode || null);
        setLoading(false);
      })
      .catch(e => { setErr(String(e)); setLoading(false); });
  };
  // ── Auto-reset period when interval changes to keep bar counts sensible ───
  useEffect(() => {
    const available = (PERIOD_MAP[intv] || PERIOD_MAP["1d"]).map(p => p.v);
    if (!available.includes(period)) {
      // Pick a sensible default for the new interval
      const defaults = {"1h":"3mo","4h":"6mo","8h":"1y","1d":"1y","1wk":"2y","1mo":"5y"};
      setPeriod(defaults[intv] || available[Math.floor(available.length/2)]);
    }
  }, [intv]); // eslint-disable-line

  useEffect(() => { load(); }, [sym, period, intv]); // eslint-disable-line

  // ── Chart data (subsampled to ≤300 bars) ─────────────────────────────────
  const cd = useMemo(() => {
    if (!data?.ohlcv?.length) return [];
    const smaKeys = params.sma.split(",").map(x=>x.trim()).filter(Boolean);
    const emaKeys = params.ema.split(",").map(x=>x.trim()).filter(Boolean);
    const MAX = 300;
    const step = Math.max(1, Math.floor(data.ohlcv.length / MAX));
    return data.ohlcv.filter((_,i)=>i%step===0).map((bar,ii) => {
      const i = ii * step;
      const row = {
        date:bar.date, open:bar.open, high:bar.high, low:bar.low, close:bar.close, volume:bar.volume,
        bb_upper:data.bb.upper[i], bb_middle:data.bb.middle[i], bb_lower:data.bb.lower[i],
        rsi:data.rsi[i],
        macd:data.macd.macd[i], macd_sig:data.macd.signal[i], macd_h:data.macd.histogram[i],
        stoch_k:data.stoch.k[i], stoch_d:data.stoch.d[i],
        vwap:data.vwap[i], wr:data.williams_r[i], cci:data.cci[i],
      };
      smaKeys.forEach(k => { row[`sma${k}`] = data.sma[k]?.[i]; });
      emaKeys.forEach(k => { row[`ema${k}`] = data.ema[k]?.[i]; });
      return row;
    });
  }, [data, params.sma, params.ema]);

  // ── Market Structure Framework ────────────────────────────────────────────
  const ms = useMemo(() => {
    if (!data || !cd.length) return null;
    const lb = cd[cd.length - 1];
    return computeMarketStructure(lb, data);
  }, [cd, data]);

  // ── Y domain (price axis) ─────────────────────────────────────────────────
  const yDomain = useMemo(() => {
    if (!cd.length) return [0,100];
    const vals = cd.flatMap(d => {
      const arr = [d.low, d.high].filter(x=>x!=null);
      if (overlays.bb) { if(d.bb_upper) arr.push(d.bb_upper); if(d.bb_lower) arr.push(d.bb_lower); }
      if (overlays.vwap && d.vwap) arr.push(d.vwap);
      return arr;
    });
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pad = (mx - mn) * 0.025;
    return [mn - pad, mx + pad];
  }, [cd, overlays.bb, overlays.vwap]);

  // ── Candlestick pixel coordinate helpers ─────────────────────────────────
  const N  = cd.length || 1;
  const iW = Math.max(cw - TV_Y_AX_W, 1);
  const iH = TV_MAIN_H - TV_X_AX_H;
  const xAt = i  => (i + 0.5) / N * iW;
  const yAt = px => (1 - (px - yDomain[0]) / (yDomain[1] - yDomain[0])) * iH;
  const bW  = Math.max(iW / N * 0.65, 1.5);

  // ── Misc ─────────────────────────────────────────────────────────────────
  const smaKeys  = params.sma.split(",").map(x=>x.trim()).filter(Boolean);
  const emaKeys  = params.ema.split(",").map(x=>x.trim()).filter(Boolean);
  const lastBar  = cd[cd.length - 1];
  const isUp     = !!(data && lastBar && lastBar.close >= lastBar.open);
  const fmtVol   = v => !v ? "–" : v>=1e9 ? `${(v/1e9).toFixed(1)}B` : v>=1e6 ? `${(v/1e6).toFixed(1)}M` : v>=1e3 ? `${(v/1e3).toFixed(0)}K` : String(v);
  const fmtP     = v => v == null ? "–" : v.toFixed(2);
  const INTERVALS = [
    {l:"1H",v:"1h"},{l:"4H",v:"4h"},{l:"8H",v:"8h"},
    {l:"1D",v:"1d"},{l:"1W",v:"1wk"},{l:"MO",v:"1mo"},
  ];
  const PERIOD_MAP = {
    "1h":  [{l:"5D",v:"5d"},{l:"1M",v:"1mo"},{l:"3M",v:"3mo"},{l:"6M",v:"6mo"},{l:"1Y",v:"1y"}],
    "4h":  [{l:"1M",v:"1mo"},{l:"3M",v:"3mo"},{l:"6M",v:"6mo"},{l:"1Y",v:"1y"},{l:"2Y",v:"2y"}],
    "8h":  [{l:"1M",v:"1mo"},{l:"3M",v:"3mo"},{l:"6M",v:"6mo"},{l:"1Y",v:"1y"},{l:"2Y",v:"2y"}],
    "1d":  [{l:"5D",v:"5d"},{l:"1M",v:"1mo"},{l:"3M",v:"3mo"},{l:"6M",v:"6mo"},{l:"1Y",v:"1y"},{l:"2Y",v:"2y"},{l:"5Y",v:"5y"}],
    "1wk": [{l:"3M",v:"3mo"},{l:"6M",v:"6mo"},{l:"1Y",v:"1y"},{l:"2Y",v:"2y"},{l:"5Y",v:"5y"}],
    "1mo": [{l:"1Y",v:"1y"},{l:"2Y",v:"2y"},{l:"5Y",v:"5y"}],
  };
  const PERIODS = PERIOD_MAP[intv] || PERIOD_MAP["1d"];

  // ── Custom Tooltip – OHLCV ───────────────────────────────────────────────
  const PriceTT = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload; if (!d) return null;
    const up = d.close >= d.open;
    return (
      <div style={{background:"#1e222d",border:"1px solid #2a2e39",borderRadius:7,padding:"8px 12px",fontFamily:"monospace",fontSize:10,minWidth:140,boxShadow:"0 4px 16px #0008"}}>
        <div style={{color:"#787b86",marginBottom:5,fontWeight:600}}>{d.date}</div>
        {[["O",d.open],["H",d.high],["L",d.low],["C",d.close]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",gap:20}}>
            <span style={{color:"#787b86"}}>{k}</span>
            <span style={{color:k==="H"?TV_G:k==="L"?TV_R:up?TV_G:TV_R,fontWeight:700}}>{fmtP(v)}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",gap:20,marginTop:5,paddingTop:5,borderTop:"1px solid #2a2e3966"}}>
          <span style={{color:"#787b86"}}>Vol</span>
          <span style={{color:"#d1d4dc"}}>{fmtVol(d.volume)}</span>
        </div>
      </div>
    );
  };

  // ── Sub-panel tooltip builder ─────────────────────────────────────────────
  const subTT = (fmt) => ({
    content: ({active, payload}) => {
      if (!active || !payload?.length) return null;
      return (
        <div style={{background:"#1e222d",border:"1px solid #2a2e39",borderRadius:5,padding:"5px 8px",fontFamily:"monospace",fontSize:10}}>
          {payload.map((p,i) => p.value != null && (
            <div key={i} style={{color:p.stroke||p.fill||"#d1d4dc"}}>
              {p.name}: {fmt ? fmt(p.value) : p.value.toFixed(2)}
            </div>
          ))}
        </div>
      );
    }
  });

  const tvBtn = (active, onClick, label) => (
    <button onClick={onClick} style={{
      fontFamily:"monospace",fontSize:10,fontWeight:active?700:400,color:active?"#d1d4dc":"#787b86",
      background:active?"#2a2e39":"transparent",border:"none",borderRadius:4,
      padding:"3px 8px",cursor:"pointer",transition:"all .1s",
    }}>{label}</button>
  );

  const CM = {top:0,right:8,bottom:0,left:0};
  const xTickFmt = d => { if (!d) return ""; const p = d.split("-"); if (p.length < 2) return d; const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(p[1],10)-1]||p[1]; return `${mo} '${p[0].slice(2)}`; };
  const xTickInterval = Math.max(1, Math.ceil(cd.length / 8) - 1);
  const xAx = {dataKey:"date",type:"category",height:TV_X_AX_H,tick:{fill:"#787b86",fontSize:8,fontFamily:"monospace"},tickLine:false,axisLine:{stroke:"#2a2e39"},interval:xTickInterval,tickFormatter:xTickFmt,padding:{left:4,right:4}};
  const yAx = {type:"number",domain:yDomain,orientation:"right",width:TV_Y_AX_W,tick:{fill:"#787b86",fontSize:9,fontFamily:"monospace"},tickLine:false,axisLine:false,tickFormatter:v=>v.toFixed(0),allowDataOverflow:false,label:{value:`${sym} ($)`,angle:90,position:"insideRight",offset:16,style:{fontFamily:"monospace",fontSize:8,fill:"#787b86",textAnchor:"middle"}}};
  const subYAx = (dm,tks,fmt) => ({type:"number",domain:dm,orientation:"right",width:TV_Y_AX_W,ticks:tks,tick:{fill:"#787b86",fontSize:8,fontFamily:"monospace"},tickLine:false,axisLine:false,tickFormatter:fmt||(v=>v.toFixed(0))});

  return (
    <div>
      {/* Title */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <TrendingUp size={16} style={{color:C.grn}}/>
        <span style={mono(14,C.headingTxt,700)}>Technical Analysis</span>
        <Tag color={C.sky}>TradingView-style</Tag>
      </div>

      {/* ── Strategy Signal Pills Row ─────────────────────────────────────── */}
      {signals.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontFamily:"monospace",fontSize:9,color:"#787b86",letterSpacing:".08em"}}>STRATEGY SIGNALS</span>
            <span style={{fontFamily:"monospace",fontSize:9,color:"#555"}}>— click to highlight on chart</span>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {signals.map(sig => {
              const active  = sig.triggered;
              const isSel   = selectedSignal === sig.id;
              const bc      = sig.direction === "bull" ? TV_G : TV_R;
              const stars   = active ? "★".repeat(sig.strength || 1) : "";
              const cat     = active ? getSignalCategory(sig.id) : null;
              const catColor = cat === "TREND" ? "#5c9cf5" : cat === "MOMENTUM" ? "#ab68ff" : cat === "LIQUIDITY" ? "#f6c90e" : null;
              return (
                <button key={sig.id}
                  onClick={()=>setSelectedSignal(isSel ? null : sig.id)}
                  title={active ? `[${cat||"SIGNAL"}] ${sig.desc || sig.name} — ${sig.action || ""}` : `${sig.name} — not triggered`}
                  style={{
                    fontFamily:"monospace", fontSize:9, fontWeight:active?700:400,
                    color: active ? (isSel?"#131722":bc) : "#555",
                    background: active
                      ? (isSel ? bc : `${bc}18`)
                      : "transparent",
                    border:`1px solid ${active?(isSel?bc:`${bc}55`):"#2a2e39"}`,
                    borderRadius:20, padding:"3px 10px", cursor:"pointer",
                    opacity: active ? 1 : 0.4,
                    transition:"all .15s",
                    boxShadow: active && !isSel ? `0 0 6px ${bc}44` : "none",
                    display:"flex",alignItems:"center",gap:4,
                  }}>
                  {cat && active && <span style={{fontSize:7,fontWeight:800,color:catColor,letterSpacing:".04em",opacity:0.9}}>{cat}</span>}
                  {sig.name}{stars ? ` ${stars}` : ""}
                </button>
              );
            })}
          </div>
          {/* Selected signal detail strip */}
          {selectedSignal && (() => {
            const sig = signals.find(s=>s.id===selectedSignal);
            if (!sig || !sig.triggered) return null;
            const bc = sig.direction==="bull"?TV_G:TV_R;
            return (
              <div style={{marginTop:8,padding:"8px 12px",background:`${bc}10`,border:`1px solid ${bc}30`,borderRadius:8,display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontFamily:"monospace",fontSize:10,color:bc,fontWeight:700}}>{sig.name}</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:"#d1d4dc"}}>{sig.desc}</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>→</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:bc,fontWeight:600}}>{sig.action}</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:"#555",marginLeft:"auto"}}>
                  Strength: {"★".repeat(sig.strength||1)}{"☆".repeat(5-(sig.strength||1))}
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Market Structure Framework ─────────────────────────────────────── */}
      {ms && (()=>{
        const layers = [
          { key:"trend",     label:"TREND",     weight:"50%", col:"#5c9cf5" },
          { key:"momentum",  label:"MOMENTUM",  weight:"30%", col:"#ab68ff" },
          { key:"liquidity", label:"LIQUIDITY", weight:"20%", col:"#f6c90e" },
        ];
        const stateColor = (state) =>
          state === "bull" || state === "expanding" || state === "strong" ? TV_G
          : state === "bear" || state === "exhausted" || state === "weak"   ? TV_R
          : "#787b86";
        const stateDot = (state) =>
          state === "bull" || state === "expanding" || state === "strong" ? "🟢"
          : state === "bear" || state === "exhausted" || state === "weak"   ? "🔴" : "🟡";
        return (
          <div style={{marginBottom:10,background:"#0e1117",border:"1px solid #2a2e39",borderRadius:12,overflow:"hidden"}}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",borderBottom:"1px solid #2a2e39",background:"#131722"}}>
              <span style={{fontFamily:"monospace",fontSize:9,fontWeight:800,letterSpacing:".1em",color:"#d1d4dc"}}>MARKET STRUCTURE FRAMEWORK</span>
              <span style={{fontFamily:"monospace",fontSize:8,color:"#555"}}>Trend · Momentum · Liquidity → Decision Engine</span>
            </div>
            {/* 3 columns */}
            <div style={{display:"grid",gridTemplateColumns:C.isMobile?"1fr":"1fr 1fr 1fr",gap:0}}>
              {layers.map((layer,li) => {
                const d = ms[layer.key];
                const sc = stateColor(d.state);
                return (
                  <div key={layer.key} style={{
                    padding:"10px 14px",
                    borderRight: li < 2 ? "1px solid #2a2e39" : "none",
                  }}>
                    {/* Layer label + weight */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <span style={{fontFamily:"monospace",fontSize:8,fontWeight:800,letterSpacing:".1em",color:layer.col}}>{layer.label}</span>
                      <span style={{fontFamily:"monospace",fontSize:7,color:"#555",background:"#1e222d",padding:"1px 5px",borderRadius:4}}>{layer.weight}</span>
                    </div>
                    {/* State dot + label */}
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                      <span style={{fontSize:11}}>{stateDot(d.state)}</span>
                      <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:sc}}>{d.label}</span>
                    </div>
                    {/* Confidence bar */}
                    <div style={{marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <span style={{fontFamily:"monospace",fontSize:7,color:"#555"}}>confidence</span>
                        <span style={{fontFamily:"monospace",fontSize:7,fontWeight:700,color:sc}}>{d.score}%</span>
                      </div>
                      <div style={{height:4,borderRadius:2,background:"#2a2e39",overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${d.score}%`,background:sc,borderRadius:2,transition:"width .4s"}}/>
                      </div>
                    </div>
                    {/* Key factors */}
                    {d.factors.slice(0,2).map((f,fi)=>(
                      <div key={fi} style={{fontFamily:"monospace",fontSize:8,color:"#787b86",lineHeight:1.5}}>
                        <span style={{color:"#555"}}>›</span> {f}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            {/* Net Bias footer */}
            <div style={{borderTop:"1px solid #2a2e39",padding:"7px 14px",background:"#131722",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={{fontFamily:"monospace",fontSize:8,color:"#555",letterSpacing:".08em"}}>NET BIAS</span>
              <span style={{fontFamily:"monospace",fontSize:11,fontWeight:800,color:ms.netColor}}>{ms.netBias}</span>
              <span style={{fontFamily:"monospace",fontSize:8,color:"#555"}}>·</span>
              <span style={{fontFamily:"monospace",fontSize:8,color:"#787b86",fontStyle:"italic"}}>{ms.reason}</span>
              <div style={{marginLeft:"auto",display:"flex",gap:3}}>
                {[...Array(10)].map((_,i)=>(
                  <div key={i} style={{width:8,height:8,borderRadius:1,background:i < Math.round(ms.weighted/10) ? ms.netColor : "#2a2e39"}}/>
                ))}
                <span style={{fontFamily:"monospace",fontSize:8,color:ms.netColor,marginLeft:4,fontWeight:700}}>{ms.weighted}%</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════ TECHNICAL REGIME SNAPSHOT ═══════════ */}
      {data && godMode && ms && (()=>{
        // 5-pillar scoring engine (-1 to +1)
        const trendS = ms.trend.state === "bull" ? (ms.trend.score >= 75 ? 0.8 : 0.4) : ms.trend.state === "bear" ? (ms.trend.score <= 25 ? -0.8 : -0.4) : 0;
        const momS = ms.momentum.state === "expanding" ? 0.7 : ms.momentum.state === "building" ? 0.3 : ms.momentum.state === "exhausted" ? -0.6 : ms.momentum.state === "resetting" ? -0.2 : 0;
        const liqS = ms.liquidity.state === "strong" ? 0.6 : ms.liquidity.state === "weak" ? -0.5 : 0;

        // Volatility/Structure from BB width + ATR
        const lastBar = data.ohlcv?.[data.ohlcv.length - 1];
        const bbUpper = data.bb?.upper?.[data.bb.upper.length - 1];
        const bbLower = data.bb?.lower?.[data.bb.lower.length - 1];
        const bbWidth = (bbUpper && bbLower && lastBar?.close) ? (bbUpper - bbLower) / lastBar.close : 0.05;
        const volStructS = bbWidth < 0.03 ? 0.3 : (bbWidth > 0.08 ? -0.3 : 0); // compression = setup potential

        // Signal confirmation
        const bullSigs = godMode.bull_count || 0;
        const bearSigs = godMode.bear_count || 0;
        const totalSigs = bullSigs + bearSigs || 1;
        const confS = (bullSigs - bearSigs) / totalSigs; // -1 to +1

        // Composite
        const techScore = Math.max(-1, Math.min(1, 0.30 * trendS + 0.25 * momS + 0.15 * liqS + 0.15 * volStructS + 0.15 * confS));

        // Bias
        const bias = techScore >= 0.4 ? "Bullish" : techScore >= 0.15 ? "Neutral-to-Bullish" : techScore > -0.15 ? "Neutral" : techScore > -0.4 ? "Neutral-to-Bearish" : "Bearish";

        // Confidence
        const signalAgreement = Math.abs(bullSigs - bearSigs) / totalSigs;
        const primaryStrength = (godMode.confidence || 50) / 100;
        const confidence = Math.round((0.5 * signalAgreement + 0.5 * primaryStrength) * 100);

        // Setup classifier
        let setup;
        if (trendS >= 0.4 && momS >= 0.3) setup = "Trend Continuation";
        else if (trendS <= -0.3 && momS >= 0) setup = "Mean Reversion Bounce";
        else if (trendS <= -0.3 && momS <= -0.3) setup = "Breakdown Risk";
        else if (bbWidth < 0.03) setup = "Range Compression";
        else if (trendS >= 0.3 && momS <= -0.3) setup = "Exhaustion / Reversal Watch";
        else if (trendS <= 0 && momS >= 0.2) setup = "Trend Repair Attempt";
        else setup = "Rangebound / Mixed";

        // Regime
        let regime;
        if (trendS >= 0.4 && momS >= 0.2) regime = "Bullish Trend";
        else if (trendS <= -0.4 && momS <= -0.2) regime = "Bearish Trend";
        else if (trendS <= 0 && momS >= 0.2) regime = "Transitional Bounce";
        else if (trendS <= -0.3 && momS <= 0) regime = "Breakdown Risk";
        else if (bbWidth < 0.03) regime = "Compression Before Move";
        else if (trendS >= 0.3 && momS <= -0.3) regime = "Exhaustion / Reversal Watch";
        else regime = "Rangebound / Mixed";

        // Action posture
        let posture;
        if (techScore >= 0.6 && confidence >= 60) posture = "Aggressive Long";
        else if (techScore >= 0.2 && confidence >= 40) posture = "Tactical Long";
        else if (techScore <= -0.6 && confidence >= 60) posture = "Aggressive Short";
        else if (techScore <= -0.2 && confidence >= 40) posture = "Tactical Short";
        else if (confidence < 25) posture = "No Trade";
        else posture = "Neutral / Wait";

        const biasCol = techScore >= 0.15 ? C.grn : techScore <= -0.15 ? C.red : C.amb;
        const confCol = confidence >= 60 ? C.grn : confidence >= 35 ? C.amb : C.red;

        // Risks
        const risks = [];
        if (trendS <= 0 && momS <= 0) risks.push("Trend and momentum both weak");
        if (ms.trend.state === "bear" && ms.liquidity.state !== "strong") risks.push("Bearish trend with no volume support");
        if (bbWidth < 0.025) risks.push("Compression — breakout direction unclear");
        if (bullSigs > 0 && bearSigs > 0 && Math.abs(bullSigs - bearSigs) <= 2) risks.push("Conflicting signals — low conviction");

        return (
          <div style={{marginBottom:14,borderRadius:14,border:`1.5px solid ${biasCol}30`,background:biasCol+"07",padding:"18px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:14}}>
              <div>
                <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",marginBottom:4}}>TECHNICAL REGIME</div>
                <div style={mono(20, biasCol, 800)}>{regime}</div>
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>SCORE</div>
                  <div style={mono(18, biasCol, 800)}>{techScore > 0 ? "+" : ""}{(techScore * 100).toFixed(0)}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>BIAS</div>
                  <div style={mono(13, biasCol, 700)}>{bias}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>CONFIDENCE</div>
                  <div style={mono(13, confCol, 700)}>{confidence}%</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>SETUP</div>
                  <div style={mono(11, C.headingTxt, 600)}>{setup}</div>
                </div>
              </div>
            </div>

            {/* 5-Pillar breakdown */}
            <div style={{display:"grid",gridTemplateColumns: C.isMobile ? "repeat(3,1fr)" : "repeat(5,1fr)",gap:8,marginBottom:12}}>
              {[["Trend",trendS,0.30],["Momentum",momS,0.25],["Liquidity",liqS,0.15],["Volatility",volStructS,0.15],["Signals",confS,0.15]].map(([name,val,wt])=>{
                const pc = val >= 0.3 ? C.grn : val <= -0.3 ? C.red : C.amb;
                return (
                  <div key={name} style={{padding:"8px 10px",borderRadius:8,background:C.dim,textAlign:"center"}}>
                    <div style={{...mono(7,C.mut,600),letterSpacing:"0.08em"}}>{name.toUpperCase()} <span style={{color:C.mut+"88"}}>({(wt*100).toFixed(0)}%)</span></div>
                    <div style={mono(14, pc, 800)}>{val > 0 ? "+" : ""}{val.toFixed(2)}</div>
                  </div>
                );
              })}
            </div>

            {/* Action posture + risks */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{...mono(9,C.mut,600)}}>POSTURE:</span>
                <span style={{...mono(11, posture.includes("Long") ? C.grn : posture.includes("Short") ? C.red : C.amb, 700),
                  padding:"3px 12px",borderRadius:8,background:(posture.includes("Long")?C.grn:posture.includes("Short")?C.red:C.amb)+"15",
                  border:`1px solid ${posture.includes("Long")?C.grn:posture.includes("Short")?C.red:C.amb}30`}}>
                  {posture}
                </span>
              </div>
              {risks.length > 0 && (
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {risks.slice(0,2).map((r,i) => (
                    <span key={i} style={{...mono(8,C.red,600),padding:"2px 8px",borderRadius:6,background:C.red+"10",border:`1px solid ${C.red}20`}}>{r}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── God Mode Panel ────────────────────────────────────────────────── */}
      {showGodMode && godMode && (
        <div style={{marginBottom:14,background:"#0e1117",border:`1px solid ${godMode.direction==="BULLISH"?TV_G:godMode.direction==="BEARISH"?TV_R:"#787b86"}44`,borderRadius:12,overflow:"hidden"}}>
          {/* Header bar */}
          <div style={{
            background: godMode.direction==="BULLISH"?`${TV_G}18`:godMode.direction==="BEARISH"?`${TV_R}18`:"#1e222d",
            padding:"12px 16px",
            borderBottom:"1px solid #2a2e39",
            display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
          }}>
            <span style={{fontFamily:"monospace",fontSize:11,fontWeight:800,letterSpacing:".06em",color:"#f6c90e"}}>⚡ GOD MODE</span>
            <span style={{fontFamily:"monospace",fontSize:18,fontWeight:900,
              color:godMode.direction==="BULLISH"?TV_G:godMode.direction==="BEARISH"?TV_R:"#787b86"}}>
              {godMode.direction}
            </span>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              {[...Array(5)].map((_,i)=>(
                <div key={i} style={{
                  width:12,height:12,borderRadius:2,
                  background: i < Math.round((godMode.confidence||0)/20)
                    ? (godMode.direction==="BULLISH"?TV_G:godMode.direction==="BEARISH"?TV_R:"#787b86")
                    : "#2a2e39",
                }}/>
              ))}
              <span style={{fontFamily:"monospace",fontSize:10,color:"#d1d4dc",marginLeft:4}}>{godMode.confidence}% confidence</span>
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:12}}>
              <span style={{fontFamily:"monospace",fontSize:9,color:TV_G}}>▲ {godMode.bull_count} bull signals</span>
              <span style={{fontFamily:"monospace",fontSize:9,color:TV_R}}>▼ {godMode.bear_count} bear signals</span>
            </div>
          </div>

          {/* Body */}
          <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {/* Left: Summary + Action */}
            <div>
              <div style={{fontFamily:"monospace",fontSize:9,color:"#787b86",marginBottom:5,letterSpacing:".06em"}}>MARKET READ</div>
              <div style={{fontFamily:"monospace",fontSize:11,color:"#d1d4dc",lineHeight:1.6,marginBottom:10}}>{godMode.summary}</div>
              <div style={{display:"inline-block",padding:"6px 14px",borderRadius:8,
                background: godMode.direction==="BULLISH"?`${TV_G}22`:godMode.direction==="BEARISH"?`${TV_R}22`:"#1e222d",
                border:`1px solid ${godMode.direction==="BULLISH"?`${TV_G}55`:godMode.direction==="BEARISH"?`${TV_R}55`:"#444"}`,
                fontFamily:"monospace",fontSize:11,fontWeight:700,
                color:godMode.direction==="BULLISH"?TV_G:godMode.direction==="BEARISH"?TV_R:"#d1d4dc"}}>
                {godMode.action}
              </div>
              {godMode.position_sizing && (
                <div style={{marginTop:8,fontFamily:"monospace",fontSize:9,color:"#787b86"}}>
                  Position: <span style={{color:"#d1d4dc"}}>{godMode.position_sizing}</span>
                </div>
              )}
            </div>

            {/* Right: Primary signals + Fibonacci */}
            <div>
              <div style={{marginBottom:10}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:"#787b86",marginBottom:6,letterSpacing:".06em"}}>PRIMARY DRIVERS</div>
                {ms && [
                  { label:"Trend",     d:ms.trend,     col:"#5c9cf5", weight:50 },
                  { label:"Momentum",  d:ms.momentum,  col:"#ab68ff", weight:30 },
                  { label:"Liquidity", d:ms.liquidity, col:"#f6c90e", weight:20 },
                ].map(({label,d,col,weight})=>{
                  const sc = d.state==="bull"||d.state==="expanding"||d.state==="strong" ? TV_G
                    : d.state==="bear"||d.state==="exhausted"||d.state==="weak" ? TV_R : "#787b86";
                  return (
                    <div key={label} style={{marginBottom:5}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <span style={{fontFamily:"monospace",fontSize:8,color:col,fontWeight:700}}>{label}</span>
                          <span style={{fontFamily:"monospace",fontSize:7,color:"#555"}}>({weight}%)</span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <span style={{fontFamily:"monospace",fontSize:8,color:sc,fontWeight:700}}>{d.label}</span>
                          <span style={{fontFamily:"monospace",fontSize:7,color:"#555"}}>{d.score}%</span>
                        </div>
                      </div>
                      <div style={{height:3,borderRadius:2,background:"#2a2e39",overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${d.score}%`,background:sc,borderRadius:2}}/>
                      </div>
                    </div>
                  );
                })}
                {godMode.primary_signals?.length > 0 && (
                  <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid #2a2e3944"}}>
                    <div style={{fontFamily:"monospace",fontSize:8,color:"#555",marginBottom:3}}>Top signals</div>
                    {godMode.primary_signals.map((s,i)=>(
                      <div key={i} style={{fontFamily:"monospace",fontSize:8,color:"#d1d4dc88",padding:"1px 0"}}>· {s}</div>
                    ))}
                  </div>
                )}
              </div>
              {godMode.fib_levels && (
                <div>
                  <div style={{fontFamily:"monospace",fontSize:9,color:"#787b86",marginBottom:5,letterSpacing:".06em"}}>
                    FIBONACCI LEVELS
                    <span style={{color:"#555",marginLeft:6}}>
                      {godMode.swing_low?.toFixed(2)} → {godMode.swing_high?.toFixed(2)}
                    </span>
                  </div>
                  {Object.entries(godMode.fib_levels)
                    .filter(([k])=>["0.0%","23.6%","38.2%","50.0%","61.8%","78.6%","100.0%"].includes(k))
                    .map(([pct,price])=>{
                      const isKey = pct === godMode.key_fib_label;
                      const cp    = godMode.current_price;
                      const pxAbove = cp && price > cp;
                      return (
                        <div key={pct} style={{display:"flex",justifyContent:"space-between",
                          padding:"2px 6px",borderRadius:4,marginBottom:2,
                          background:isKey?"#f6c90e18":"transparent",
                          border:isKey?"1px solid #f6c90e44":"1px solid transparent"}}>
                          <span style={{fontFamily:"monospace",fontSize:9,color:isKey?"#f6c90e":"#787b86"}}>{pct}</span>
                          <span style={{fontFamily:"monospace",fontSize:9,
                            color:isKey?"#f6c90e":pxAbove?"#26a69a88":"#ef535088",fontWeight:isKey?700:400}}>
                            ${price?.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TV Chart shell */}
      <div style={{background:"#131722",borderRadius:12,border:"1px solid #2a2e39",overflow:"hidden"}}>

        {/* ── Top toolbar ──────────────────────────────────────────────────── */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid #2a2e39",flexWrap:"wrap"}}>
          {/* Symbol input */}
          <form onSubmit={e=>{
            e.preventDefault();
            const s=inputSym.trim().toUpperCase();
            if(!s) return;
            if(s!==sym){
              // New ticker — atomically wipe all stale per-ticker state first
              setData(null); setSignals([]); setGodMode(null);
              setSelectedSignal(null); setShowGodMode(false); setShowFib(false);
              setSym(s);           // triggers useEffect → load()
            } else {
              load();              // Same ticker — force a refresh
            }
          }} style={{display:"flex",gap:6}}>
            <input value={inputSym} onChange={e=>setInputSym(e.target.value.toUpperCase())}
              style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#d1d4dc",
                background:"#1e222d",border:"1px solid #2a2e39",borderRadius:6,
                padding:"4px 10px",width:90,outline:"none",letterSpacing:".04em"}}
              placeholder="SYMBOL"/>
            <button type="submit" style={{fontFamily:"monospace",fontSize:10,color:"#26a69a",
              background:"#26a69a15",border:"1px solid #26a69a40",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Go</button>
          </form>

          <div style={{width:1,height:18,background:"#2a2e39"}}/>
          {/* Interval — intraday group + divider + daily group */}
          <div style={{display:"flex",gap:1,alignItems:"center"}}>
            {/* Intraday: 1H 4H 8H */}
            <span style={{fontFamily:"monospace",fontSize:8,color:"#555",padding:"0 4px"}}>INTRA</span>
            {INTERVALS.filter(({v})=>["1h","4h","8h"].includes(v)).map(({l,v}) =>
              <span key={v}>{tvBtn(intv===v, ()=>setIntv(v), l)}</span>
            )}
            <div style={{width:1,height:14,background:"#2a2e39",margin:"0 3px"}}/>
            {/* Daily+: 1D 1W 1M */}
            {INTERVALS.filter(({v})=>!["1h","4h","8h"].includes(v)).map(({l,v}) =>
              <span key={v}>{tvBtn(intv===v, ()=>setIntv(v), l)}</span>
            )}
          </div>
          <div style={{width:1,height:18,background:"#2a2e39"}}/>
          {/* Period — dynamically filtered to valid options for selected interval */}
          <div style={{display:"flex",gap:1}}>
            {PERIODS.map(({l,v}) => <span key={v}>{tvBtn(period===v, ()=>setPeriod(v), l)}</span>)}
          </div>

          <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
            {/* Chart type */}
            <div style={{display:"flex",gap:1,background:"#1e222d",borderRadius:5,padding:2,border:"1px solid #2a2e39"}}>
              {[["candle","Candles"],["area","Area"]].map(([t,l])=><span key={t}>{tvBtn(chartType===t,()=>setChartType(t),l)}</span>)}
            </div>
            {/* Settings */}
            <button onClick={()=>setShowCfg(s=>!s)} style={{fontFamily:"monospace",fontSize:10,
              color:showCfg?"#26a69a":"#787b86",background:showCfg?"#26a69a15":"transparent",
              border:`1px solid ${showCfg?"#26a69a50":"#2a2e39"}`,borderRadius:6,
              padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              <Settings size={11}/> Indicators
            </button>
            <button onClick={()=>setShowGodMode(s=>!s)} style={{fontFamily:"monospace",fontSize:10,
              color:"#f6c90e",
              background:showGodMode?"#f6c90e28":"#f6c90e0f",
              border:`${showGodMode?"2px":"1.5px"} solid ${showGodMode?"#f6c90eee":"#f6c90eaa"}`,
              borderRadius:6,
              padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontWeight:700,
              boxShadow:showGodMode?"0 0 12px #f6c90e55":"0 0 6px #f6c90e22",
              transition:"all .15s"}}>
              ⚡ God Mode
            </button>
            <button onClick={load} disabled={loading} style={{fontFamily:"monospace",fontSize:12,
              color:loading?"#555":"#787b86",background:"transparent",border:"1px solid #2a2e39",
              borderRadius:6,padding:"4px 9px",cursor:loading?"not-allowed":"pointer",
              opacity:loading?0.6:1,transition:"opacity .15s"}} title="Refresh">
              {loading ? "…" : "↺"}
            </button>
          </div>
        </div>

        {/* ── Overlay & panel toggles ───────────────────────────────────────── */}
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"5px 14px",borderBottom:"1px solid #2a2e39",flexWrap:"wrap"}}>
          <span style={{fontFamily:"monospace",fontSize:9,color:"#555"}}>OVERLAYS</span>
          {[["SMA","sma"],["EMA","ema"],["BB","bb"],["VWAP","vwap"]].map(([l,k])=>(
            <button key={k} onClick={()=>setOvl(o=>({...o,[k]:!o[k]}))}
              style={{fontFamily:"monospace",fontSize:9,color:overlays[k]?"#d1d4dc":"#555",
                background:overlays[k]?"#2a2e39":"transparent",
                border:`1px solid ${overlays[k]?"#444":"#2a2e3966"}`,
                borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>{l}</button>
          ))}
          <button onClick={()=>setShowFib(f=>!f)}
            style={{fontFamily:"monospace",fontSize:9,color:showFib?"#f6c90e":"#555",
              background:showFib?"#f6c90e18":"transparent",
              border:`1px solid ${showFib?"#f6c90e55":"#2a2e3966"}`,
              borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>Fib</button>
          <div style={{width:1,height:14,background:"#2a2e39",margin:"0 3px"}}/>
          <span style={{fontFamily:"monospace",fontSize:9,color:"#555"}}>PANELS</span>
          {[["Vol","vol"],["RSI","rsi"],["MACD","macd"],["Stoch","stoch"],["WR%","wr"],["CCI","cci"]].map(([l,k])=>(
            <button key={k} onClick={()=>setPanels(o=>({...o,[k]:!o[k]}))}
              style={{fontFamily:"monospace",fontSize:9,color:panels[k]?"#d1d4dc":"#555",
                background:panels[k]?"#2a2e39":"transparent",
                border:`1px solid ${panels[k]?"#444":"#2a2e3966"}`,
                borderRadius:4,padding:"2px 8px",cursor:"pointer"}}>{l}</button>
          ))}
        </div>

        {/* ── Settings panel ────────────────────────────────────────────────── */}
        {showCfg && (
          <div style={{background:"#191d2b",borderBottom:"1px solid #2a2e39",padding:"12px 14px"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px 14px"}}>
              {[
                ["SMA periods (csv)","sma"],["EMA periods (csv)","ema"],
                ["BB period","bbP"],["BB std dev","bbS"],
                ["RSI period","rsiP"],
                ["MACD fast","mcdF"],["MACD slow","mcdSl"],["MACD signal","mcdSg"],
                ["Stoch %K","stK"],["Stoch %D","stD"],
                ["ATR period","atrP"],["CCI period","cciP"],["WR period","wrP"],
              ].map(([label,key])=>(
                <div key={key}>
                  <div style={{fontFamily:"monospace",fontSize:8,color:"#787b86",marginBottom:3}}>{label}</div>
                  <input value={params[key]} onChange={e=>setParams(pp=>({...pp,[key]:e.target.value}))}
                    style={{fontFamily:"monospace",fontSize:10,color:"#d1d4dc",
                      background:"#1e222d",border:"1px solid #2a2e39",borderRadius:4,
                      padding:"3px 7px",width:"100%",outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
            </div>
            <SpinRing active={loading} color={TV_G}>
            <button onClick={load} disabled={loading} style={{fontFamily:"monospace",fontSize:10,
              color:loading?"#555":TV_G,background:loading?"#1a1a1a":"#26a69a15",
              border:`1px solid ${loading?"#333":"#26a69a40"}`,borderRadius:6,
              padding:"6px 16px",cursor:loading?"not-allowed":"pointer",marginTop:10,
              opacity:loading?0.7:1,transition:"all .15s"}}>
              {loading ? "Loading…" : "Apply & Reload"}
            </button>
            </SpinRing>
          </div>
        )}

        {/* ── Quote bar ─────────────────────────────────────────────────────── */}
        {data && (
          <div style={{display:"flex",alignItems:"center",gap:14,padding:"8px 14px",borderBottom:"1px solid #2a2e39",flexWrap:"wrap"}}>
            <span style={{fontFamily:"monospace",fontSize:15,color:"#d1d4dc",fontWeight:700,letterSpacing:".04em"}}>{data.symbol}</span>
            <span style={{fontFamily:"monospace",fontSize:19,color:data.change_pct>=0?TV_G:TV_R,fontWeight:700}}>
              ${data.current_price?.toFixed(2)}
            </span>
            <span style={{fontFamily:"monospace",fontSize:12,color:data.change_pct>=0?TV_G:TV_R}}>
              {data.change_pct>=0?"+":""}{data.change?.toFixed(2)} ({data.change_pct>=0?"+":""}{data.change_pct?.toFixed(2)}%)
            </span>
            {lastBar && (
              <div style={{display:"flex",gap:12,marginLeft:6}}>
                {[["O",lastBar.open],["H",lastBar.high],["L",lastBar.low],["C",lastBar.close]].map(([k,v])=>(
                  <span key={k} style={{fontFamily:"monospace",fontSize:10,color:"#787b86"}}>
                    {k} <span style={{color:k==="H"?TV_G:k==="L"?TV_R:"#d1d4dc"}}>{fmtP(v)}</span>
                  </span>
                ))}
                <span style={{fontFamily:"monospace",fontSize:10,color:"#787b86"}}>Vol <span style={{color:"#d1d4dc"}}>{fmtVol(lastBar.volume)}</span></span>
              </div>
            )}
            {loading && <span style={{fontFamily:"monospace",fontSize:9,color:"#787b86",marginLeft:"auto"}}>Fetching {sym}…</span>}
          </div>
        )}
        {err && <div style={{padding:"12px 14px",color:TV_R,fontFamily:"monospace",fontSize:11}}>{err}</div>}

        {/* ── Main price chart ──────────────────────────────────────────────── */}
        {cd.length > 0 && (
          <div ref={containerRef} style={{position:"relative",height:TV_MAIN_H,borderBottom:"1px solid #2a2e39"}}>
            {/* Recharts: grid + axes + overlay lines */}
            <ResponsiveContainer width="100%" height={TV_MAIN_H}>
              <ComposedChart data={cd} margin={CM}>
                <CartesianGrid strokeDasharray="1 4" stroke="#2a2e39" vertical={false}/>
                <XAxis {...xAx}/>
                <YAxis {...yAx}/>
                {/* Hidden close line: enables recharts tooltip position tracking */}
                <Line dataKey="close" stroke="transparent" strokeWidth={0} dot={false} legendType="none"/>
                {/* SMA lines */}
                {overlays.sma && smaKeys.map(k=>(
                  <Line key={`sma${k}`} dataKey={`sma${k}`} stroke={SMA_COLS[k]||"#aaa"} strokeWidth={1.5}
                    dot={false} connectNulls={false} legendType="none" name={`SMA ${k}`}/>
                ))}
                {/* EMA lines */}
                {overlays.ema && emaKeys.map(k=>(
                  <Line key={`ema${k}`} dataKey={`ema${k}`} stroke={EMA_COLS[k]||"#aaa"} strokeWidth={1.2}
                    dot={false} connectNulls={false} legendType="none" name={`EMA ${k}`}/>
                ))}
                {/* Bollinger Bands */}
                {overlays.bb && <>
                  <Line dataKey="bb_upper" stroke="#7b61ff" strokeWidth={1} strokeDasharray="4 2"
                    dot={false} connectNulls={false} legendType="none" name="BB Upper"/>
                  <Line dataKey="bb_middle" stroke="#7b61ff80" strokeWidth={0.8} strokeDasharray="3 4"
                    dot={false} connectNulls={false} legendType="none" name="BB Mid"/>
                  <Line dataKey="bb_lower" stroke="#7b61ff" strokeWidth={1} strokeDasharray="4 2"
                    dot={false} connectNulls={false} legendType="none" name="BB Lower"/>
                </>}
                {/* VWAP */}
                {overlays.vwap && (
                  <Line dataKey="vwap" stroke="#ff9800" strokeWidth={1.5}
                    dot={false} connectNulls={false} legendType="none" name="VWAP"/>
                )}
                <Tooltip content={<PriceTT/>} cursor={{stroke:"#2a2e3999",strokeWidth:1}}/>
              </ComposedChart>
            </ResponsiveContainer>

            {/* ── Candlestick SVG overlay ───────────────────────────────── */}
            {chartType === "candle" && cw > 0 && (
              <svg style={{position:"absolute",top:0,left:0,pointerEvents:"none"}}
                width={cw} height={TV_MAIN_H}>
                {cd.map((d,i) => {
                  const cx  = xAt(i);
                  const yH  = yAt(d.high);
                  const yL  = yAt(d.low);
                  const yO  = yAt(d.open);
                  const yC  = yAt(d.close);
                  if ([cx,yH,yL,yO,yC].some(isNaN)) return null;
                  const up  = d.close >= d.open;
                  const col = up ? TV_G : TV_R;
                  const bT  = Math.min(yO,yC);
                  const bH  = Math.max(Math.abs(yC-yO), 1.5);
                  return (
                    <g key={i}>
                      <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={col} strokeWidth={1} strokeOpacity={0.85}/>
                      <rect x={cx-bW/2} y={bT} width={bW} height={bH} fill={col}/>
                    </g>
                  );
                })}
              </svg>
            )}

            {/* ── Area chart (alternative mode) ────────────────────────── */}
            {chartType === "area" && (
              <div style={{position:"absolute",top:0,left:0,right:0,height:TV_MAIN_H,pointerEvents:"none"}}>
                <ResponsiveContainer width="100%" height={TV_MAIN_H}>
                  <AreaChart data={cd} margin={CM}>
                    <defs>
                      <linearGradient id="tvAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={isUp?TV_G:TV_R} stopOpacity={0.28}/>
                        <stop offset="92%" stopColor={isUp?TV_G:TV_R} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <YAxis domain={yDomain} hide width={TV_Y_AX_W} orientation="right"/>
                    <XAxis dataKey="date" hide height={TV_X_AX_H}/>
                    <Area type="monotone" dataKey="close" stroke={isUp?TV_G:TV_R} strokeWidth={2}
                      fill="url(#tvAreaGrad)" dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Fibonacci retracement overlay ─────────────────────────── */}
            {showFib && godMode?.fib_levels && cw > 0 && (() => {
              const fibColors = {
                "0.0%":"#787b86","23.6%":"#ab47bc","38.2%":"#f6c90e",
                "50.0%":"#ff9800","61.8%":"#f6c90e","78.6%":"#ab47bc","100.0%":"#787b86",
                "127.2%":"#26a69a88","161.8%":"#26a69a","261.8%":"#26a69acc",
              };
              const retraceLevels = ["0.0%","23.6%","38.2%","50.0%","61.8%","78.6%","100.0%"];
              return (
                <svg style={{position:"absolute",top:0,left:0,pointerEvents:"none"}}
                  width={cw} height={TV_MAIN_H}>
                  {retraceLevels.map(pct => {
                    const price = godMode.fib_levels[pct];
                    if (price == null) return null;
                    const py = yAt(price);
                    if (py < 0 || py > iH) return null;
                    const col = fibColors[pct] || "#787b86";
                    const isKey = pct === godMode.key_fib_label;
                    return (
                      <g key={pct}>
                        <line x1={0} y1={py} x2={iW} y2={py}
                          stroke={col} strokeWidth={isKey?1.5:0.8}
                          strokeDasharray={isKey?"none":"4 3"} strokeOpacity={isKey?0.85:0.55}/>
                        {/* label lives in the Y-axis gutter (x > iW) — never over candles */}
                        <rect x={iW+3} y={py-7} width={TV_Y_AX_W-6} height={13}
                          fill="#131722dd" rx={2}/>
                        <text x={iW+6} y={py} fill={col}
                          fontSize={7.5} fontFamily="monospace" dominantBaseline="middle"
                          fontWeight={isKey?"700":"400"}>
                          {pct} ${price?.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}
                  {/* Shaded zone between 38.2% and 61.8% */}
                  {(() => {
                    const y382 = yAt(godMode.fib_levels["38.2%"]);
                    const y618 = yAt(godMode.fib_levels["61.8%"]);
                    if (!y382 || !y618) return null;
                    const top = Math.min(y382,y618), bot = Math.max(y382,y618);
                    return <rect x={0} y={top} width={iW} height={bot-top}
                      fill="#f6c90e" fillOpacity={0.05}/>;
                  })()}
                </svg>
              );
            })()}

            {/* ── Chart legend overlay (top-left) ──────────────────────── */}
            <div style={{position:"absolute",top:5,left:6,display:"flex",flexWrap:"wrap",gap:"3px 10px",pointerEvents:"none"}}>
              {overlays.sma && smaKeys.map(k=>(
                <span key={k} style={{fontFamily:"monospace",fontSize:9,color:SMA_COLS[k]||"#aaa",background:"#13172288",padding:"1px 5px",borderRadius:3}}>
                  SMA {k}
                </span>
              ))}
              {overlays.ema && emaKeys.map(k=>(
                <span key={k} style={{fontFamily:"monospace",fontSize:9,color:EMA_COLS[k]||"#aaa",background:"#13172288",padding:"1px 5px",borderRadius:3}}>
                  EMA {k}
                </span>
              ))}
              {overlays.bb && (
                <span style={{fontFamily:"monospace",fontSize:9,color:"#7b61ff",background:"#13172288",padding:"1px 5px",borderRadius:3}}>
                  BB ({params.bbP},{params.bbS})
                </span>
              )}
              {overlays.vwap && (
                <span style={{fontFamily:"monospace",fontSize:9,color:"#ff9800",background:"#13172288",padding:"1px 5px",borderRadius:3}}>VWAP</span>
              )}
            </div>
          </div>
        )}

        {/* Empty / loading states */}
        {!cd.length && (
          <div style={{height:200,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"monospace",fontSize:11,color:"#787b86"}}>
              {loading ? `Loading ${sym}…` : "Enter a symbol and press Go"}
            </span>
          </div>
        )}

        {/* ── Volume panel ─────────────────────────────────────────────────── */}
        {panels.vol && cd.length > 0 && (
          <div style={{borderTop:"1px solid #2a2e39"}}>
            <div style={{height:20,display:"flex",alignItems:"center",paddingLeft:10,gap:8}}>
              <TVTip {...PANEL_TIPS.vol}><span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>Volume</span></TVTip>
              {lastBar && <span style={{fontFamily:"monospace",fontSize:9,color:lastBar.close>=lastBar.open?TV_G:TV_R}}>{fmtVol(lastBar.volume)}</span>}
            </div>
            <ResponsiveContainer width="100%" height={60}>
              <BarChart data={cd} margin={{top:0,right:TV_Y_AX_W,bottom:0,left:0}} barCategoryGap="15%">
                <YAxis hide orientation="right" width={TV_Y_AX_W}/>
                <XAxis dataKey="date" hide height={0}/>
                <Bar dataKey="volume" maxBarSize={24}>
                  {cd.map((d,i)=>(
                    <Cell key={i} fill={d.close>=d.open?`${TV_G}55`:`${TV_R}55`} stroke={d.close>=d.open?TV_G:TV_R} strokeWidth={0.3}/>
                  ))}
                </Bar>
                <Tooltip content={({active,payload})=>{
                  if(!active||!payload?.length) return null;
                  const d=payload[0]?.payload;
                  return <div style={{background:"#1e222d",border:"1px solid #2a2e39",borderRadius:4,padding:"4px 8px",fontFamily:"monospace",fontSize:9,color:"#d1d4dc"}}>{d?.date} · {fmtVol(d?.volume)}</div>;
                }}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── RSI panel ────────────────────────────────────────────────────── */}
        {panels.rsi && cd.length > 0 && (
          <div style={{borderTop:"1px solid #2a2e39"}}>
            <div style={{height:20,display:"flex",alignItems:"center",paddingLeft:10,gap:8}}>
              <TVTip {...PANEL_TIPS.rsi}><span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>RSI ({params.rsiP})</span></TVTip>
              {lastBar?.rsi!=null && (
                <span style={{fontFamily:"monospace",fontSize:9,color:lastBar.rsi>70?TV_R:lastBar.rsi<30?TV_G:"#d1d4dc",fontWeight:700}}>
                  {lastBar.rsi.toFixed(1)}
                  {lastBar.rsi>70?" — Overbought":lastBar.rsi<30?" — Oversold":""}
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={cd} margin={{top:0,right:TV_Y_AX_W,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="1 4" stroke="#2a2e39" vertical={false}/>
                <XAxis dataKey="date" hide height={0}/>
                <YAxis {...subYAx([0,100],[0,30,50,70,100])} tickFormatter={v=>v.toFixed(0)}/>
                <ReferenceLine y={70} stroke={TV_R} strokeDasharray="3 3" strokeOpacity={0.55} label={{value:"OB",position:"right",fill:TV_R,fontSize:8,fontFamily:"monospace"}}/>
                <ReferenceLine y={30} stroke={TV_G} strokeDasharray="3 3" strokeOpacity={0.55} label={{value:"OS",position:"right",fill:TV_G,fontSize:8,fontFamily:"monospace"}}/>
                <Line dataKey="rsi" stroke="#7b61ff" strokeWidth={1.5} dot={false} connectNulls={false} name="RSI"/>
                <Tooltip {...subTT(v=>v?.toFixed(1))}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── MACD panel ───────────────────────────────────────────────────── */}
        {panels.macd && cd.length > 0 && (
          <div style={{borderTop:"1px solid #2a2e39"}}>
            <div style={{height:20,display:"flex",alignItems:"center",paddingLeft:10,gap:12}}>
              <TVTip {...PANEL_TIPS.macd}><span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>MACD ({params.mcdF},{params.mcdSl},{params.mcdSg})</span></TVTip>
              {lastBar?.macd!=null    && <span style={{fontFamily:"monospace",fontSize:9,color:"#2196f3"}}>MACD {lastBar.macd.toFixed(3)}</span>}
              {lastBar?.macd_sig!=null && <span style={{fontFamily:"monospace",fontSize:9,color:"#ef9b20"}}>Sig {lastBar.macd_sig.toFixed(3)}</span>}
              {lastBar?.macd_h!=null  && <span style={{fontFamily:"monospace",fontSize:9,color:lastBar.macd_h>=0?TV_G:TV_R}}>Hist {lastBar.macd_h.toFixed(3)}</span>}
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={cd} margin={{top:0,right:TV_Y_AX_W,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="1 4" stroke="#2a2e39" vertical={false}/>
                <XAxis dataKey="date" hide height={0}/>
                <YAxis orientation="right" width={TV_Y_AX_W} tick={{fill:"#787b86",fontSize:8,fontFamily:"monospace"}} tickLine={false} axisLine={false} tickFormatter={v=>v.toFixed(2)}/>
                <ReferenceLine y={0} stroke="#787b86" strokeOpacity={0.4}/>
                <Bar dataKey="macd_h" maxBarSize={24} name="Histogram">
                  {cd.map((d,i)=><Cell key={i} fill={d.macd_h>=0?`${TV_G}88`:`${TV_R}88`}/>)}
                </Bar>
                <Line dataKey="macd"     stroke="#2196f3" strokeWidth={1.5} dot={false} connectNulls={false} name="MACD"/>
                <Line dataKey="macd_sig" stroke="#ef9b20" strokeWidth={1.5} dot={false} connectNulls={false} name="Signal"/>
                <Tooltip {...subTT(v=>v?.toFixed(4))}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Stochastic panel ─────────────────────────────────────────────── */}
        {panels.stoch && cd.length > 0 && (
          <div style={{borderTop:"1px solid #2a2e39"}}>
            <div style={{height:20,display:"flex",alignItems:"center",paddingLeft:10,gap:12}}>
              <TVTip {...PANEL_TIPS.stoch}><span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>Stoch ({params.stK},{params.stD})</span></TVTip>
              {lastBar?.stoch_k!=null && <span style={{fontFamily:"monospace",fontSize:9,color:"#2196f3"}}>%K {lastBar.stoch_k.toFixed(1)}</span>}
              {lastBar?.stoch_d!=null && <span style={{fontFamily:"monospace",fontSize:9,color:"#ef9b20"}}>%D {lastBar.stoch_d.toFixed(1)}</span>}
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={cd} margin={{top:0,right:TV_Y_AX_W,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="1 4" stroke="#2a2e39" vertical={false}/>
                <XAxis dataKey="date" hide height={0}/>
                <YAxis {...subYAx([0,100],[0,20,80,100])} tickFormatter={v=>v.toFixed(0)}/>
                <ReferenceLine y={80} stroke={TV_R} strokeDasharray="3 3" strokeOpacity={0.55}/>
                <ReferenceLine y={20} stroke={TV_G} strokeDasharray="3 3" strokeOpacity={0.55}/>
                <Line dataKey="stoch_k" stroke="#2196f3" strokeWidth={1.5} dot={false} connectNulls={false} name="%K"/>
                <Line dataKey="stoch_d" stroke="#ef9b20" strokeWidth={1.5} dot={false} connectNulls={false} name="%D"/>
                <Tooltip {...subTT(v=>v?.toFixed(1))}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Williams %R panel ────────────────────────────────────────────── */}
        {panels.wr && cd.length > 0 && (
          <div style={{borderTop:"1px solid #2a2e39"}}>
            <div style={{height:20,display:"flex",alignItems:"center",paddingLeft:10,gap:8}}>
              <TVTip {...PANEL_TIPS.wr}><span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>Williams %R ({params.wrP})</span></TVTip>
              {lastBar?.wr!=null && (
                <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                  color:lastBar.wr>-20?TV_R:lastBar.wr<-80?TV_G:"#d1d4dc"}}>
                  {lastBar.wr.toFixed(1)}{lastBar.wr>-20?" — Overbought":lastBar.wr<-80?" — Oversold":""}
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={cd} margin={{top:0,right:TV_Y_AX_W,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="1 4" stroke="#2a2e39" vertical={false}/>
                <XAxis dataKey="date" hide height={0}/>
                <YAxis {...subYAx([-100,0],[-100,-80,-20,0])} tickFormatter={v=>v.toFixed(0)}/>
                <ReferenceLine y={-20} stroke={TV_R} strokeDasharray="3 3" strokeOpacity={0.55}/>
                <ReferenceLine y={-80} stroke={TV_G} strokeDasharray="3 3" strokeOpacity={0.55}/>
                <Line dataKey="wr" stroke="#00bcd4" strokeWidth={1.5} dot={false} connectNulls={false} name="WR%"/>
                <Tooltip {...subTT(v=>v?.toFixed(1))}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── CCI panel ────────────────────────────────────────────────────── */}
        {panels.cci && cd.length > 0 && (
          <div style={{borderTop:"1px solid #2a2e39"}}>
            <div style={{height:20,display:"flex",alignItems:"center",paddingLeft:10,gap:8}}>
              <TVTip {...PANEL_TIPS.cci}><span style={{fontFamily:"monospace",fontSize:9,color:"#787b86"}}>CCI ({params.cciP})</span></TVTip>
              {lastBar?.cci!=null && (
                <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                  color:lastBar.cci>100?TV_R:lastBar.cci<-100?TV_G:"#d1d4dc"}}>
                  {lastBar.cci.toFixed(1)}
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={cd} margin={{top:0,right:TV_Y_AX_W,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="1 4" stroke="#2a2e39" vertical={false}/>
                <XAxis dataKey="date" hide height={0}/>
                <YAxis orientation="right" width={TV_Y_AX_W} tick={{fill:"#787b86",fontSize:8,fontFamily:"monospace"}} tickLine={false} axisLine={false} tickFormatter={v=>v.toFixed(0)}/>
                <ReferenceLine y={100}  stroke={TV_R} strokeDasharray="3 3" strokeOpacity={0.55}/>
                <ReferenceLine y={-100} stroke={TV_G} strokeDasharray="3 3" strokeOpacity={0.55}/>
                <ReferenceLine y={0}    stroke="#787b86" strokeOpacity={0.35}/>
                <Line dataKey="cci" stroke="#ff9800" strokeWidth={1.5} dot={false} connectNulls={false} name="CCI"/>
                <Tooltip {...subTT(v=>v?.toFixed(1))}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

      </div>{/* end TV shell */}

      {/* ── Quick-stats row ──────────────────────────────────────────────── */}
      {data && lastBar && (
        <div style={{marginTop:12,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10}}>
          {[
            {l:"ATR (14)",   v:data.atr?.[data.n_bars-1]!=null?data.atr[data.n_bars-1].toFixed(2):"–", c:C.amb,
              desc:"Average daily price range. Measures volatility — higher = bigger swings, wider stops needed.",
              interp:data.atr?.[data.n_bars-1]!=null?(data.atr[data.n_bars-1]>lastBar.close*0.03?"High volatility — wide ranges":"Low-moderate volatility"):null},
            {l:"RSI (14)",   v:lastBar.rsi!=null?lastBar.rsi.toFixed(1):"–",
              c:lastBar.rsi>70?TV_R:lastBar.rsi<30?TV_G:"#d1d4dc",
              desc:"Momentum oscillator (0-100). Above 70 = overbought, below 30 = oversold.",
              interp:lastBar.rsi!=null?(lastBar.rsi>70?"Overbought — pullback risk":lastBar.rsi<30?"Oversold — bounce potential":lastBar.rsi>50?"Bullish zone":"Bearish zone"):null},
            {l:"MACD Hist",  v:lastBar.macd_h!=null?lastBar.macd_h.toFixed(4):"–",
              c:lastBar.macd_h>=0?TV_G:TV_R,
              desc:"Difference between MACD and Signal lines. Positive = bullish momentum building.",
              interp:lastBar.macd_h!=null?(lastBar.macd_h>0?"Bullish momentum expanding":"Bearish momentum — sellers in control"):null},
            {l:"Stoch %K",   v:lastBar.stoch_k!=null?lastBar.stoch_k.toFixed(1)+"%" :"–",
              c:lastBar.stoch_k>80?TV_R:lastBar.stoch_k<20?TV_G:"#d1d4dc",
              desc:"Momentum oscillator (0-100). Above 80 = overbought, below 20 = oversold.",
              interp:lastBar.stoch_k!=null?(lastBar.stoch_k>80?"Overbought — reversal watch":lastBar.stoch_k<20?"Oversold — bounce setup":"Mid-range"):null},
            {l:"BB Width",   v:lastBar.bb_upper&&lastBar.bb_lower?((lastBar.bb_upper-lastBar.bb_lower)/lastBar.close*100).toFixed(2)+"%":"–",
              c:C.pur,
              desc:"Bollinger Band width as % of price. Low = compression (breakout imminent), high = expanded volatility.",
              interp:lastBar.bb_upper&&lastBar.bb_lower?(((lastBar.bb_upper-lastBar.bb_lower)/lastBar.close)<0.03?"Squeeze — breakout setup":"Normal-wide range"):null},
            {l:"Williams %R",v:lastBar.wr!=null?lastBar.wr.toFixed(1):"–",
              c:lastBar.wr>-20?TV_R:lastBar.wr<-80?TV_G:"#d1d4dc",
              desc:"Momentum oscillator (-100 to 0). Above -20 = overbought, below -80 = oversold.",
              interp:lastBar.wr!=null?(lastBar.wr>-20?"Overbought — caution":lastBar.wr<-80?"Oversold — opportunity":"Neutral range"):null},
          ].map(({l,v,c,desc,interp})=>(
            <Card key={l}>
              <Lbl>{l}</Lbl>
              <div style={mono(18,c,700)}>{v}</div>
              <div style={{...mono(8,C.mut),marginTop:4,lineHeight:1.5}}>{desc}</div>
              {interp && <div style={{...mono(8,c,600),marginTop:3}}>{interp}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Macro Narrative helpers ───────────────────────────────────────────────────
function buildMacroNarrative(summaries, feeds) {
  const gdp   = summaries["GDPC1"];
  const cpi   = summaries["CPIAUCSL"];
  const fed   = summaries["FEDFUNDS"];
  const unemp = summaries["UNRATE"];
  const yc    = summaries["T10Y2Y"];
  const ip    = summaries["INDPRO"];

  const p1 = [];
  if (gdp) {
    const trend = gdp.trend_label || "stable";
    p1.push(`Real GDP is ${trend}${gdp.change_1y != null ? `, with output ${gdp.change_1y >= 0 ? "up" : "down"} ${Math.abs(gdp.change_1y).toFixed(1)}% year-over-year` : ""}, reflecting the broad trajectory of the U.S. economy.`);
  }
  if (ip) {
    p1.push(`Industrial production is ${ip.trend_label || "moving"}${ip.change_1y != null ? ` (${ip.change_1y >= 0 ? "+" : ""}${ip.change_1y.toFixed(1)}% YoY)` : ""}, pointing to the health of the real-economy manufacturing cycle.`);
  }
  if (cpi) {
    const desc = cpi.regime === "elevated" ? "running above the Fed's 2% target — keeping pressure on monetary policy" : cpi.regime === "normal" ? "near the Fed's 2% target, allowing room for policy flexibility" : "below historically normal levels, giving the Fed room to ease";
    p1.push(`Inflation (CPI) reads ${cpi.current_formatted}${cpi.change_1y != null ? `, ${cpi.change_1y >= 0 ? "up" : "down"} ${Math.abs(cpi.change_1y).toFixed(1)}% over the past year` : ""} — ${desc}.`);
  }
  if (fed) {
    const stance = fed.current_value != null ? (fed.current_value > 4.5 ? "a restrictive stance that is tightening financial conditions" : fed.current_value > 3 ? "a neutral-to-tight posture as the Fed manages the inflation-growth trade-off" : "an accommodative posture supportive of growth") : "a policy posture currently under review";
    p1.push(`The Federal Funds Rate sits at ${fed.current_formatted}${fed.percentile_5y != null ? ` — a ${fed.percentile_5y.toFixed(0)}th-percentile 5-year reading —` : ","} reflecting ${stance}.`);
  }

  const p2 = [];
  if (unemp) {
    const desc = unemp.regime === "elevated" ? "signalling emerging labour-market stress" : unemp.regime === "normal" ? "near historically normal levels" : "near multi-decade lows, pointing to a tight labour market";
    p2.push(`Unemployment stands at ${unemp.current_formatted} — ${desc}${unemp.change_1y != null ? `, having ${unemp.change_1y >= 0 ? "risen" : "fallen"} ${Math.abs(unemp.change_1y).toFixed(2)} percentage points over the past year` : ""}.`);
  }
  if (yc) {
    const ycDesc = yc.current_value != null ? (yc.current_value < -0.1 ? `The 10Y−2Y yield curve remains inverted at ${yc.current_formatted}, a historically reliable leading indicator of recession risk within 12–18 months` : yc.current_value < 0.2 ? `The 10Y−2Y yield curve is flat at ${yc.current_formatted}, a cautious signal from bond markets about the near-term growth outlook` : `The 10Y−2Y yield curve has steepened to ${yc.current_formatted}, suggesting bond markets are pricing in recovery`) : null;
    if (ycDesc) p2.push(ycDesc + ".");
  }

  const macroKw = ["fed","rate","inflation","gdp","recession","economy","cpi","tariff","jobs","employment","treasury","yield","geopolit","war","sanction","trade","china","growth","deficit","fiscal","debt"];
  const rel = (Array.isArray(feeds) ? feeds : []).filter(f => f.title && macroKw.some(k => f.title.toLowerCase().includes(k))).slice(0, 3);
  if (rel.length > 0) {
    const negKw = ["concern","risk","fall","drop","decline","war","sanction","tariff","recession","miss","weak","slow","cut","loss","fear"];
    const posKw = ["rise","gain","beat","strong","growth","rally","recover","surge","expansion","job","hire","beat"];
    const neg = rel.filter(f => negKw.some(k => f.title.toLowerCase().includes(k))).length;
    const pos = rel.filter(f => posKw.some(k => f.title.toLowerCase().includes(k))).length;
    const tone = neg > pos ? "headwinds" : pos > neg ? "tailwinds" : "mixed signals";
    p2.push(`Recent newsflow points to macro ${tone}: ${rel.map(f => `"${f.title}"`).join("; ")}.`);
  }

  const growthDesc = gdp?.trend_label?.match(/ris|accel|fast/) ? "expansionary" : gdp?.trend_label?.match(/fall|contract|declin/) ? "contracting" : "moderating";
  const inflDesc = cpi?.regime === "elevated" ? "above-target inflation" : cpi?.regime === "normal" ? "inflation near target" : "subdued inflation";
  const rateDesc = fed?.current_value != null ? (fed.current_value > 4.5 ? "a hawkish Fed" : fed.current_value > 2.5 ? "a data-dependent Fed" : "an accommodative Fed") : null;
  p2.push(`Against this backdrop, the macro environment is broadly ${growthDesc} with ${inflDesc}${rateDesc ? ` and ${rateDesc}` : ""}. Investors should monitor inflation trajectory and yield-curve shape as primary risk barometers.`);

  return [p1.filter(Boolean).join(" "), p2.filter(Boolean).join(" ")].filter(s => s.trim().length > 0);
}

function MacroNarrativePanel() {
  const C = useC();
  const KEY = ["GDPC1","CPIAUCSL","FEDFUNDS","UNRATE","T10Y2Y","INDPRO"];
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [ts,      setTs]      = useState(null);

  const fetch_ = async () => {
    setLoading(true);
    try {
      const [sums, feedsRes] = await Promise.all([
        Promise.all(KEY.map(id => fetch(`/api/macro/summary/${id}`).then(r=>r.json()).catch(()=>null))),
        fetch("/api/feeds?category=all&limit=40").then(r=>r.json()).catch(()=>({articles:[]})),
      ]);
      const sm = {};
      KEY.forEach((id,i) => { if (sums[i]?.current_value != null) sm[id] = sums[i]; });
      setData({ summaries: sm, feeds: feedsRes.articles || feedsRes.items || (Array.isArray(feedsRes) ? feedsRes : []) });
      setTs(new Date());
    } finally { setLoading(false); }
  };
  useEffect(() => { fetch_(); }, []);

  const regCol = { elevated: C.red, inverted: C.red, low: C.amb, normal: C.grn };
  const LABELS = { GDPC1:"Real GDP", CPIAUCSL:"CPI", FEDFUNDS:"Fed Funds", UNRATE:"Unemployment", T10Y2Y:"10Y−2Y Spread", INDPRO:"Ind. Production" };

  return (
    <div style={{borderRadius:12,border:`1px solid ${C.sky}22`,background:C.sky+"05",padding:"16px 20px",marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <Globe size={13} style={{color:C.sky}}/>
        <span style={mono(9,C.sky,700)}>MACRO OUTLOOK · SYNTHESIZED OVERVIEW</span>
        <span style={{...mono(8,C.mut),marginLeft:"auto"}}>{ts ? `Updated ${ts.toLocaleTimeString()}` : ""}</span>
        <SpinRing active={loading} radius={6}>
        <button onClick={fetch_} disabled={loading}
          style={{background:"none",border:`1px solid ${C.bdr}`,borderRadius:6,padding:"3px 8px",
            cursor:"pointer",display:"flex",alignItems:"center",gap:4,...mono(8,C.mut)}}>
          <RefreshCw size={9} style={{animation:loading?"spin 1s linear infinite":"none"}}/> Refresh
        </button>
        </SpinRing>
      </div>

      {/* Key indicator chips */}
      {data && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
          {KEY.map(id => {
            const s = data.summaries[id];
            if (!s) return null;
            const col = regCol[s.regime] || C.mut;
            return (
              <div key={id} style={{padding:"6px 10px",borderRadius:8,background:col+"12",border:`1px solid ${col}30`,
                display:"flex",flexDirection:"column",gap:2,minWidth:90}}>
                <span style={mono(7,C.mut,600)}>{LABELS[id]||id}</span>
                <span style={mono(12,col,700)}>{s.current_formatted}</span>
                {s.change_1y != null && (
                  <span style={mono(7,s.change_1y>=0?C.grn:C.red)}>
                    {s.change_1y>=0?"+":""}{s.change_1y.toFixed(1)}% YoY
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Paragraphs */}
      {loading && !data && (
        <div style={{display:"flex",alignItems:"center",gap:8,...mono(10,C.mut)}}>
          <RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>
          Generating macro overview…
        </div>
      )}
      {data && (() => {
        const paras = buildMacroNarrative(data.summaries, data.feeds);
        return (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {paras.map((para, i) => (
              <p key={i} style={{...mono(10,C.txt),lineHeight:1.85,margin:0}}>{para}</p>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// FRED MACRO INTELLIGENCE VIEW
// ─────────────────────────────────────────────────────────────────────────────

const MACRO_PERIODS  = [{l:"1Y",v:"1y"},{l:"2Y",v:"2y"},{l:"5Y",v:"5y"},{l:"10Y",v:"10y"},{l:"20Y",v:"20y"},{l:"MAX",v:"max"}];
const MACRO_UNITS    = [{l:"Level",v:"lin"},{l:"YoY %",v:"pc1"},{l:"MoM %",v:"pch"}];
const MACRO_OVERLAY_COLORS = ["#40c4ff","#ffb300","#b388ff","#ff8a65"];
const ordinal = n => { const v=Math.round(n); if(v>=11&&v<=13) return `${v}th`; return `${v}${['th','st','nd','rd','th'][Math.min(v%10,4)]}`; };

const REGIME_META = {
  elevated: {color:"#ff5252", label:"Elevated"},
  inverted: {color:"#ff5252", label:"Inverted"},
  low:      {color:"#ffb300", label:"Below Normal"},
  normal:   {color:"#00e676", label:"Normal"},
};

function MacroView() {
  const C = useC();
  const { token } = useAuth();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  // Chart workspace state (preserved from original)
  const [catalog, setCatalog] = useState({});
  const [openCats, setOpenCats] = useState({});
  const [activeSeries, setActiveSeries] = useState([]);
  const [period, setPeriod] = useState("5y");
  const [units, setUnits] = useState("lin");
  const [chartLoading, setChartLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeSection, setActiveSection] = useState("snapshot"); // snapshot | charts
  const [unifiedRegime, setUnifiedRegime] = useState(null);

  // ── Load macro snapshot ──
  useEffect(() => {
    setLoading(true);
    fetch("/api/macro/snapshot", {headers: token ? {Authorization:`Bearer ${token}`} : {}})
      .then(r => r.ok ? r.json() : Promise.reject("Snapshot error"))
      .then(d => { setSnapshot(d); setLoading(false);
        fetch("/api/regime/unified").then(r=>r.ok?r.json():null).then(u=>setUnifiedRegime(u)).catch(()=>{});
      })
      .catch(e => { setErr(String(e)); setLoading(false); });
  }, []);

  // ── Load FRED catalog (for chart workspace) ──
  useEffect(() => {
    fetch("/api/macro/catalog")
      .then(r => r.json())
      .then(d => setCatalog(d.catalog || {}))
      .catch(() => {});
  }, []);

  // ── Chart helpers ──
  const MACRO_PERIODS = [{l:"1Y",v:"1y"},{l:"2Y",v:"2y"},{l:"5Y",v:"5y"},{l:"10Y",v:"10y"},{l:"20Y",v:"20y"},{l:"MAX",v:"max"}];
  const MACRO_UNITS = [{l:"Level",v:"lin"},{l:"YoY %",v:"pc1"},{l:"MoM %",v:"pch"}];
  const OVERLAY_COLORS = ["#40c4ff","#ffb300","#b388ff","#ff8a65"];

  const loadSeries = (seriesId, seriesName, color, replace) => {
    setChartLoading(true);
    const col = color || OVERLAY_COLORS[activeSeries.length % OVERLAY_COLORS.length];
    Promise.all([
      fetch(`/api/macro/series/${seriesId}?period=${period}&units=${units}`).then(r=>r.json()),
      fetch(`/api/macro/summary/${seriesId}?period=${period}`).then(r=>r.json()),
    ]).then(([seriesResp, sumResp]) => {
      const entry = {id:seriesId, name:seriesName, unit:seriesResp.info?.units_short||"", color:col, obs:seriesResp.observations||[], info:seriesResp.info};
      if (replace) { setActiveSeries([entry]); setSummary(sumResp); }
      else { setActiveSeries(prev => [...prev, entry]); if (!activeSeries.length) setSummary(sumResp); }
      setChartLoading(false);
    }).catch(() => setChartLoading(false));
  };

  const removeSeries = (id) => {
    setActiveSeries(prev => prev.filter(s => s.id !== id));
    if (activeSeries.length <= 1) setSummary(null);
  };

  const doSearch = () => {
    if (searchQ.length < 2) return;
    setSearching(true);
    fetch(`/api/macro/search?q=${encodeURIComponent(searchQ)}&limit=12`)
      .then(r => r.json())
      .then(d => { setSearchResults(d.results || []); setSearching(false); })
      .catch(() => setSearching(false));
  };

  // ── Formatting helpers ──
  const scoreColor = s => s >= 0.5 ? C.grn : s <= -0.5 ? C.red : C.amb;
  const trendArrow = t => t === "Improving" ? "↑" : t === "Deteriorating" ? "↓" : "→";
  const trendColor = t => t === "Improving" ? C.grn : t === "Deteriorating" ? C.red : C.amb;
  const sevColor = s => s === "High" ? C.red : s === "Medium" ? C.amb : C.grn;
  const dirColor = d => d === "positive" ? C.grn : d === "negative" ? C.red : C.amb;
  const regimeColor = r => {
    const map = {"Goldilocks":C.grn, "Late-Cycle Tightening":C.amb, "Disinflationary Slowdown":C.sky,
      "Reflation":"#ff8a65", "Stagflation Risk":C.red, "Recession / Stress":C.red, "Mixed / Transitional":C.amb};
    return map[r] || C.mut;
  };

  // Section components
  const Section = ({accent, children}) => (
    <div style={{borderRadius:14, border:`1.5px solid ${accent}30`, background:accent+"07", padding:"18px 20px"}}>
      {children}
    </div>
  );
  const SectionTitle = ({children, sub}) => (
    <div style={{marginBottom:14}}>
      <div style={mono(13, C.headingTxt, 700)}>{children}</div>
      {sub && <div style={{...mono(9, C.mut), marginTop:3}}>{sub}</div>}
    </div>
  );

  const snap = snapshot?.macro_snapshot || {};
  const pillars = snapshot?.pillars || {};
  const pillarOrder = ["growth","inflation","labor","policy","liquidity","credit","fiscal","global"];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <Lbl>MACRO</Lbl>
        <div style={mono(10,C.mut)}>Macro regime engine — scoring, classification, risk, and market implications</div>
      </div>

      {/* Tab toggle: Snapshot vs Charts */}
      <div style={{display:"flex",gap:8}}>
        {["snapshot","charts"].map(s => (
          <button key={s} onClick={()=>setActiveSection(s)}
            style={{...mono(10, activeSection===s ? C.sky : C.mut, 600),
              padding:"6px 16px", borderRadius:8,
              border:`1px solid ${activeSection===s ? C.sky+"50" : C.bdr}`,
              background: activeSection===s ? C.sky+"12" : "transparent",
              cursor:"pointer", textTransform:"capitalize"}}>
            {s === "snapshot" ? "Regime Dashboard" : "Chart Workspace"}
          </button>
        ))}
      </div>

      {loading && <Card><div style={{...mono(11,C.mut),textAlign:"center",padding:"32px 0"}}>Loading macro snapshot...</div></Card>}
      {err && <Card><div style={mono(11,C.red)}>Error: {err}</div></Card>}

      {/* ═══════════════════════════════════════════════════════
          REGIME DASHBOARD
         ═══════════════════════════════════════════════════════ */}
      {activeSection === "snapshot" && snapshot && (<>

        {/* ── 1. MACRO SNAPSHOT ── */}
        <Section accent={regimeColor(snap.regime)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:16}}>
            <div>
              <div style={{...mono(9, C.mut, 700), letterSpacing:"0.1em", marginBottom:6}}>MACRO REGIME</div>
              <div style={{...mono(22, regimeColor(snap.regime), 800)}}>{snap.regime || "—"}</div>
            </div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>COMPOSITE</div>
                <div style={mono(20, scoreColor(snap.composite_score/25), 800)}>{snap.composite_score != null ? (snap.composite_score > 0 ? "+" : "") + snap.composite_score : "—"}</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>TREND</div>
                <div style={mono(16, trendColor(snap.trend), 700)}>{trendArrow(snap.trend)} {snap.trend || "—"}</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>CONFIDENCE</div>
                <div style={mono(14, snap.confidence === "High" ? C.grn : snap.confidence === "Moderate" ? C.amb : C.mut, 700)}>{snap.confidence || "—"}</div>
              </div>
            </div>
          </div>

          {/* Summary bullets */}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {(snap.summary_bullets || []).map((b,i) => (
              <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                <span style={mono(10, C.mut)}>•</span>
                <span style={mono(10, C.txt)}>{b}</span>
              </div>
            ))}
          </div>
          {snap.recent_change_summary && (
            <div style={{marginTop:10, padding:"8px 12px", borderRadius:8, background:C.dim}}>
              <span style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>RECENT: </span>
              <span style={mono(9, C.txt)}>{snap.recent_change_summary}</span>
            </div>
          )}
        </Section>

        {/* ── CROSS-TAB ALIGNMENT ── */}
        {unifiedRegime && unifiedRegime.alignment && (
          <div style={{padding:"12px 16px", borderRadius:12, background:C.dim, border:`1px solid ${C.amb}30`,
            display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10}}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>SYSTEM ALIGNMENT</div>
                <div style={mono(12, unifiedRegime.alignment.overall_alignment === "Aligned" ? C.grn : unifiedRegime.alignment.overall_alignment === "Conflicted" ? C.red : C.amb, 700)}>
                  {unifiedRegime.alignment.overall_alignment}
                </div>
              </div>
              <div style={{width:1,height:28,background:C.bdr}}/>
              <div style={{flex:1}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>CROSS-TAB</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:2}}>
                  {Object.entries(unifiedRegime.tabs || {}).map(([tab, data]) => (
                    <span key={tab} style={{...mono(8, regimeColor(snap.regime) || C.mut, 600),
                      padding:"2px 8px", borderRadius:10, background:C.dim, border:`1px solid ${C.bdr}`}}>
                      {tab.charAt(0).toUpperCase()+tab.slice(1)}: {data.mapped_regime}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 2. PILLAR SCORECARDS ── */}
        <div>
          <div style={{...mono(11, C.headingTxt, 700), marginBottom:10}}>PILLAR SCORES</div>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10}}>
            {pillarOrder.map(p => {
              const d = pillars[p] || {};
              const sc = scoreColor(d.score);
              return (
                <div key={p} style={{padding:"14px 16px", borderRadius:12, background:C.surf, border:`1px solid ${sc}30`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{...mono(9, C.mut, 700), letterSpacing:"0.1em", textTransform:"uppercase"}}>{p}</div>
                    <span style={mono(12, trendColor(d.trend), 700)}>{trendArrow(d.trend)}</span>
                  </div>
                  <div style={mono(22, sc, 800)}>{d.score != null ? (d.score > 0 ? "+" : "") + d.score.toFixed(1) : "—"}</div>
                  <div style={{...mono(8, C.mut), marginTop:4, lineHeight:1.5}}>{d.interpretation || ""}</div>
                  {/* Drivers */}
                  {d.drivers && d.drivers.length > 0 && d.drivers[0].value != null && (
                    <div style={{marginTop:8, borderTop:`1px solid ${C.bdr}`, paddingTop:6}}>
                      {d.drivers.slice(0,3).map((dr,i) => (
                        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}>
                          <span style={mono(8, C.mut)}>{dr.label}</span>
                          <span style={mono(9, dirColor(dr.direction), 600)}>{dr.value}{dr.unit ? ` ${dr.unit}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 3. REGIME ENGINE ── */}
        <Section accent={regimeColor(snap.regime)}>
          <SectionTitle sub="Why this regime was selected">REGIME CLASSIFICATION</SectionTitle>
          <div style={{display:"flex",gap:20,flexWrap:"wrap",marginBottom:14}}>
            <div>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>CURRENT REGIME</div>
              <div style={{...mono(18, regimeColor(snap.regime), 800), marginTop:4}}>{snap.regime}</div>
            </div>
            <div style={{flex:1, minWidth:200}}>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em", marginBottom:6}}>DRIVING PILLARS</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {pillarOrder.filter(p => Math.abs(pillars[p]?.score || 0) >= 0.5).map(p => (
                  <Tag key={p} color={scoreColor(pillars[p]?.score)}>{p.toUpperCase()} {pillars[p]?.score > 0 ? "+" : ""}{pillars[p]?.score?.toFixed(1)}</Tag>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ── 5. NARRATIVE ENGINE ── */}
        {snapshot.narrative && (
          <Section accent={C.pur}>
            <SectionTitle sub="Deterministic macro interpretation">NARRATIVE</SectionTitle>
            <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "1fr 1fr", gap:14, marginBottom:16}}>
              <div style={{padding:"12px 14px", borderRadius:10, background:C.grn+"08", border:`1px solid ${C.grn}25`}}>
                <div style={{...mono(9, C.grn, 700), letterSpacing:"0.1em", marginBottom:8}}>WHAT IS IMPROVING</div>
                {(snapshot.narrative.improving || []).map((item,i) => (
                  <div key={i} style={{...mono(9, C.txt), padding:"3px 0"}}>+ {item}</div>
                ))}
              </div>
              <div style={{padding:"12px 14px", borderRadius:10, background:C.red+"08", border:`1px solid ${C.red}25`}}>
                <div style={{...mono(9, C.red, 700), letterSpacing:"0.1em", marginBottom:8}}>WHAT IS DETERIORATING</div>
                {(snapshot.narrative.deteriorating || []).map((item,i) => (
                  <div key={i} style={{...mono(9, C.txt), padding:"3px 0"}}>- {item}</div>
                ))}
              </div>
            </div>

            {/* Market Implications */}
            {snapshot.market_implications && (
              <div>
                <div style={{...mono(9, C.mut, 700), letterSpacing:"0.1em", marginBottom:8}}>MARKET IMPLICATIONS</div>
                <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "repeat(5,1fr)", gap:8}}>
                  {Object.entries(snapshot.market_implications).map(([asset, text]) => (
                    <div key={asset} style={{padding:"10px 12px", borderRadius:8, background:C.dim}}>
                      <div style={{...mono(8, C.sky, 700), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4}}>{asset}</div>
                      <div style={mono(9, C.txt)}>{text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── 6. RISK DASHBOARD ── */}
        {snapshot.risk_dashboard && (
          <Section accent={C.red}>
            <SectionTitle sub="Key macro risks by severity">RISK DASHBOARD</SectionTitle>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {snapshot.risk_dashboard.map((r,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom: i < snapshot.risk_dashboard.length-1 ? `1px solid ${C.bdr}` : "none"}}>
                  <Tag color={sevColor(r.severity)}>{r.severity}</Tag>
                  <div style={{flex:1}}>
                    <div style={mono(10, C.headingTxt, 600)}>{r.risk}</div>
                    <div style={mono(9, C.mut)}>{r.explanation}</div>
                  </div>
                  {r.linked_series && r.linked_series.length > 0 && (
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {r.linked_series.slice(0,3).map(s => (
                        <span key={s} style={{...mono(7, C.sky), cursor:"pointer", textDecoration:"underline"}}
                          onClick={() => { setActiveSection("charts"); loadSeries(s, s, null, true); }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 7. CATALYSTS ── */}
        {snapshot.catalysts && (
          <Section accent={C.sky}>
            <SectionTitle sub="Upcoming macro events to monitor">CATALYSTS</SectionTitle>
            <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap:8}}>
              {snapshot.catalysts.map((cat,i) => (
                <div key={i} style={{padding:"10px 12px", borderRadius:8, background:C.dim, border:`1px solid ${cat.importance === "high" ? C.sky+"30" : C.bdr}`, textAlign:"center"}}>
                  <div style={mono(10, cat.importance === "high" ? C.sky : C.headingTxt, 700)}>{cat.event}</div>
                  <div style={{...mono(8, C.mut), marginTop:2}}>{cat.region}</div>
                  <Tag color={cat.importance === "high" ? C.sky : C.mut}>{cat.importance}</Tag>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 8. GLOBAL CONTEXT ── */}
        {snapshot.global_context && (
          <Section accent={C.amb}>
            <SectionTitle sub="Cross-country and global macro signals">GLOBAL CONTEXT</SectionTitle>
            <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
              <div>
                <span style={mono(9, C.mut)}>World Growth: </span>
                <span style={mono(11, trendColor(snapshot.global_context.world_growth_trend === "Improving" ? "Improving" : snapshot.global_context.world_growth_trend === "Slowing" ? "Deteriorating" : "Stable"), 700)}>
                  {snapshot.global_context.world_growth_trend}
                </span>
              </div>
              <div>
                <span style={mono(9, C.mut)}>Forecast Revisions: </span>
                <span style={mono(10, C.amb, 600)}>{snapshot.global_context.forecast_revision_direction}</span>
              </div>
            </div>
            <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "repeat(3,1fr)", gap:10}}>
              {(snapshot.global_context.regions || []).map((reg,i) => (
                <div key={i} style={{padding:"10px 14px", borderRadius:10, background:C.dim}}>
                  <div style={mono(10, C.headingTxt, 700)}>{reg.region}</div>
                  <div style={{...mono(9, C.mut), marginTop:4}}>{reg.signal}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

      </>)}

      {/* ═══════════════════════════════════════════════════════
          CHART WORKSPACE
         ═══════════════════════════════════════════════════════ */}
      {activeSection === "charts" && (
        <div style={{display:"flex",gap:14,flexDirection: C.isMobile ? "column" : "row"}}>
          {/* Sidebar: Catalog */}
          <div style={{width: C.isMobile ? "100%" : 230, flexShrink:0}}>
            <Card>
              <Lbl>FRED Series</Lbl>
              <div style={{marginBottom:10}}>
                <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
                  placeholder="Search FRED…"
                  style={{width:"100%",padding:"6px 10px",borderRadius:6,border:`1px solid ${C.bdr}`,background:C.dim,color:C.txt,fontFamily:"monospace",fontSize:10,boxSizing:"border-box",outline:"none"}}/>
              </div>
              {searchResults.length > 0 && (
                <div style={{marginBottom:12,maxHeight:200,overflowY:"auto"}}>
                  {searchResults.map(s => (
                    <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${C.bdr}`,cursor:"pointer"}}
                      onClick={() => { loadSeries(s.id, s.title, null, true); setSearchResults([]); setSearchQ(""); }}>
                      <div>
                        <div style={mono(9, C.sky, 600)}>{s.id}</div>
                        <div style={mono(8, C.mut)}>{s.title?.substring(0,40)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); loadSeries(s.id, s.title, null, false); }}
                        style={{...mono(9, C.grn, 700), background:"transparent", border:"none", cursor:"pointer"}}>+</button>
                    </div>
                  ))}
                </div>
              )}
              {/* Category browser */}
              {Object.entries(catalog).map(([cat, series]) => (
                <div key={cat} style={{marginBottom:4}}>
                  <div onClick={()=>setOpenCats(p=>({...p,[cat]:!p[cat]}))}
                    style={{...mono(9, C.mut, 700), cursor:"pointer", padding:"4px 0", display:"flex", justifyContent:"space-between"}}>
                    <span>{cat}</span><span>{openCats[cat] ? "−" : "+"}</span>
                  </div>
                  {openCats[cat] && series.map(s => {
                    const isActive = activeSeries.some(a => a.id === s.id);
                    return (
                      <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 8px",cursor:"pointer",background:isActive?C.sky+"12":"transparent",borderRadius:4}}
                        onClick={() => loadSeries(s.id, s.name, null, true)}>
                        <div>
                          <div style={mono(9, isActive ? C.sky : C.txt)}>{s.name}</div>
                          <div style={mono(7, C.mut)}>{s.id} · {s.freq}</div>
                        </div>
                        {!isActive && <button onClick={(e) => { e.stopPropagation(); loadSeries(s.id, s.name, null, false); }}
                          style={{...mono(8, C.grn), background:"transparent", border:"none", cursor:"pointer"}}>+</button>}
                        {isActive && <button onClick={(e) => { e.stopPropagation(); removeSeries(s.id); }}
                          style={{...mono(8, C.red), background:"transparent", border:"none", cursor:"pointer"}}>×</button>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </Card>
          </div>

          {/* Chart area */}
          <div style={{flex:1}}>
            {/* Period & units toolbar */}
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {MACRO_PERIODS.map(p => (
                <Pill key={p.v} label={p.l} active={period===p.v} onClick={()=>{
                  setPeriod(p.v);
                  if (activeSeries.length) loadSeries(activeSeries[0].id, activeSeries[0].name, activeSeries[0].color, true);
                }}/>
              ))}
              <div style={{width:1,background:C.bdr,margin:"0 4px"}}/>
              {MACRO_UNITS.map(u => (
                <Pill key={u.v} label={u.l} active={units===u.v} onClick={()=>{
                  setUnits(u.v);
                  if (activeSeries.length) loadSeries(activeSeries[0].id, activeSeries[0].name, activeSeries[0].color, true);
                }}/>
              ))}
            </div>

            {/* Active overlays */}
            {activeSeries.length > 0 && (
              <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                {activeSeries.map(s => (
                  <span key={s.id} style={{...mono(9, s.color, 700), padding:"2px 8px", borderRadius:12, background:s.color+"15", border:`1px solid ${s.color}30`, cursor:"pointer"}}
                    onClick={() => removeSeries(s.id)}>
                    {s.id} ×
                  </span>
                ))}
              </div>
            )}

            {/* Chart */}
            {activeSeries.length > 0 ? (
              <Card>
                <div style={{height:380}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={(() => {
                      const primary = activeSeries[0];
                      const subsampled = primary.obs.length > 400 ? primary.obs.filter((_,i) => i % Math.ceil(primary.obs.length/400) === 0) : primary.obs;
                      return subsampled.map(o => {
                        const point = {date: o.date, [primary.id]: o.value};
                        activeSeries.slice(1).forEach(s => {
                          const match = s.obs.find(so => so.date === o.date);
                          if (match) point[s.id] = match.value;
                        });
                        return point;
                      });
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                      <XAxis dataKey="date" tick={{...mono(8,C.mut)}} tickFormatter={d => d?.substring(0,7)} interval="preserveStartEnd"/>
                      <YAxis yAxisId="right" orientation="right" tick={{...mono(8,C.mut)}} domain={["auto","auto"]}/>
                      {activeSeries.length > 1 && <YAxis yAxisId="left" orientation="left" tick={{...mono(8,C.mut)}} domain={["auto","auto"]}/>}
                      <Tooltip contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,fontFamily:"monospace",fontSize:11,borderRadius:8}}/>
                      <Area yAxisId="right" type="monotone" dataKey={activeSeries[0].id} fill={activeSeries[0].color} fillOpacity={0.07} stroke={activeSeries[0].color} strokeWidth={2} dot={false}/>
                      {activeSeries.slice(1).map(s => (
                        <Line key={s.id} yAxisId="left" type="monotone" dataKey={s.id} stroke={s.color} strokeWidth={1.5} dot={false}/>
                      ))}
                      {units !== "lin" && <ReferenceLine yAxisId="right" y={0} stroke={C.mut} strokeDasharray="4 4"/>}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ) : (
              <Card>
                <div style={{...mono(11,C.mut),textAlign:"center",padding:"48px 0",lineHeight:2}}>
                  Select a series from the catalog to begin charting.<br/>
                  Click a series name to load it, or <span style={{color:C.grn}}>+</span> to overlay.
                </div>
              </Card>
            )}

            {/* Summary stats */}
            {summary && activeSeries.length > 0 && (
              <Card>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:10,marginBottom:10}}>
                  <div>
                    <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em"}}>{activeSeries[0]?.name}</div>
                    <div style={mono(22, C.headingTxt, 800)}>{summary.current_formatted || "—"}</div>
                  </div>
                  <div style={{display:"flex",gap:14}}>
                    {[["1M",summary.change_1m],["3M",summary.change_3m],["12M",summary.change_1y]].map(([label,val]) => (
                      <div key={label} style={{textAlign:"right"}}>
                        <div style={mono(8,C.mut)}>{label}</div>
                        <div style={mono(11, val > 0 ? C.grn : val < 0 ? C.red : C.mut, 700)}>{val != null ? (val > 0 ? "+" : "") + val.toFixed(2) + "%" : "—"}</div>
                      </div>
                    ))}
                    {summary.regime && <Tag color={summary.regime === "elevated" ? C.red : summary.regime === "low" ? C.amb : summary.regime === "inverted" ? C.red : C.grn}>{summary.regime}</Tag>}
                  </div>
                </div>
                {summary.headline && <div style={{...mono(10, C.txt), lineHeight:1.7, marginBottom:8}}>{summary.headline}</div>}
                {summary.body && summary.body.slice(0,3).map((b,i) => (
                  <div key={i} style={{...mono(9, C.mut), lineHeight:1.6, marginBottom:2}}>• {b}</div>
                ))}
              </Card>
            )}
          </div>
        </div>
      )}

      <div style={mono(8,C.mut)}>Data sourced from FRED/ALFRED (Federal Reserve Bank of St. Louis). Not financial advice.</div>
    </div>
  );
}

// ── TradeAdvisorView ──────────────────────────────────────────────────────────
function TradeAdvisorView() {
  const C = useC();
  const { token } = useAuth();
  const [input,   setInput]   = useState("SPY");
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState(null);
  const [err,     setErr]     = useState(null);

  const run = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setData(null); setErr(null);
    fetch("/api/advisor", {
      method:"POST",
      headers:{"Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {})},
      body: JSON.stringify({ symbol: sym, risk_tolerance: "moderate" }),
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(friendlyError(e.detail) || "Advisor error")))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr(String(e)); setLoading(false); });
  };

  const dCol = d => d === "bullish" ? C.grn : d === "bearish" ? C.red : C.amb;

  // helpers used throughout
  // ── Formatting helpers ──
  const fmtCap = v => {
    if (!v) return "—";
    if (v >= 1e12) return "$" + (v/1e12).toFixed(2) + "T";
    if (v >= 1e9)  return "$" + (v/1e9).toFixed(1) + "B";
    if (v >= 1e6)  return "$" + (v/1e6).toFixed(0) + "M";
    return "$" + v.toLocaleString();
  };
  const fmtFCF = v => {
    if (!v) return "—";
    if (Math.abs(v) >= 1e9)  return (v >= 0 ? "+" : "-") + "$" + (Math.abs(v)/1e9).toFixed(1) + "B";
    if (Math.abs(v) >= 1e6)  return (v >= 0 ? "+" : "-") + "$" + (Math.abs(v)/1e6).toFixed(0) + "M";
    return "$" + v.toLocaleString();
  };
  const fmtPct = (v,dec=1) => v != null ? (v >= 0 ? "+" : "") + v.toFixed(dec) + "%" : "—";
  const fmtNum = (v,dec=1) => v != null ? v.toFixed(dec) : "—";
  const analystLabel = mean => {
    if (mean == null) return {label:"—", col:C.mut};
    if (mean <= 1.5)  return {label:"Strong Buy",  col:"#00c853"};
    if (mean <= 2.5)  return {label:"Buy",          col:C.grn};
    if (mean <= 3.5)  return {label:"Hold",         col:C.amb};
    if (mean <= 4.5)  return {label:"Underperform", col:C.red};
    return              {label:"Sell",         col:"#d50000"};
  };
  const metricColor = (v,good,bad) => v == null ? C.mut : v >= good ? C.grn : v <= bad ? C.red : C.amb;

  // ── Thesis generation ──
  const buildThesis = (f, sent, comp) => {
    if (!f) return [];
    const bullets = [];
    // Valuation
    const pe = f.pe_ratio;
    if (pe != null) {
      if (pe < 12) bullets.push({text:"Deep value — trailing P/E well below market average", col:C.grn});
      else if (pe < 20) bullets.push({text:"Reasonably valued — P/E in line with market", col:C.amb});
      else if (pe < 35) bullets.push({text:"Premium valuation — priced for growth", col:C.amb});
      else bullets.push({text:"Elevated multiple — requires sustained high growth to justify", col:C.red});
    }
    if (f.target_upside != null) {
      if (f.target_upside > 20) bullets.push({text:`Trading ~${Math.round(f.target_upside)}% below consensus target — potential re-rating`, col:C.grn});
      else if (f.target_upside < -10) bullets.push({text:`Trading ${Math.round(Math.abs(f.target_upside))}% above consensus target — limited upside`, col:C.red});
    }
    // Quality
    const roe = f.roe;
    if (roe != null) {
      if (roe > 20) bullets.push({text:`High-quality business — ROE of ${roe.toFixed(0)}% with ${f.gross_margin > 50 ? "strong" : "adequate"} margins`, col:C.grn});
      else if (roe > 10) bullets.push({text:`Adequate returns on equity (${roe.toFixed(0)}%)`, col:C.amb});
      else bullets.push({text:`Below-average returns on equity (${roe.toFixed(0)}%)`, col:C.red});
    }
    // Growth
    if (f.revenue_growth != null && f.eps_growth != null) {
      const rg = f.revenue_growth, eg = f.eps_growth;
      if (rg > 10 && eg > 10) bullets.push({text:`Strong growth — revenue +${rg.toFixed(0)}%, EPS +${eg.toFixed(0)}%`, col:C.grn});
      else if (rg > 0 && eg > 0) bullets.push({text:`Moderate growth — revenue +${rg.toFixed(0)}%, EPS +${eg.toFixed(0)}%`, col:C.amb});
      else bullets.push({text:`Growth headwinds — revenue ${fmtPct(rg,0)}, EPS ${fmtPct(eg,0)}`, col:C.red});
    }
    // Risk
    if (f.debt_to_equity != null && f.debt_to_equity > 200) bullets.push({text:`High leverage (D/E ${f.debt_to_equity.toFixed(0)}%) introduces downside risk`, col:C.red});
    if (f.free_cash_flow != null && f.free_cash_flow < 0) bullets.push({text:"Negative free cash flow — cash burn warrants monitoring", col:C.red});
    return bullets;
  };

  // ── Risk assessment ──
  const buildRisks = (f) => {
    if (!f) return [];
    const risks = [];
    if (f.debt_to_equity != null && f.debt_to_equity > 200) risks.push({text:`High leverage — D/E ratio of ${f.debt_to_equity.toFixed(0)}%`, severity:"High", col:C.red});
    if (f.debt_to_equity != null && f.debt_to_equity > 100 && f.debt_to_equity <= 200) risks.push({text:`Moderate leverage — D/E ratio of ${f.debt_to_equity.toFixed(0)}%`, severity:"Medium", col:C.amb});
    if (f.free_cash_flow != null && f.free_cash_flow < 0) risks.push({text:"Negative free cash flow", severity:"High", col:C.red});
    if (f.beta != null && f.beta > 1.5) risks.push({text:`High market sensitivity — beta of ${f.beta.toFixed(2)}`, severity:"Medium", col:C.amb});
    if (f.short_ratio != null && f.short_ratio > 5) risks.push({text:`Elevated short interest — short ratio ${f.short_ratio.toFixed(1)}`, severity:"Medium", col:C.amb});
    if (f.current_ratio != null && f.current_ratio < 1) risks.push({text:`Liquidity concern — current ratio ${f.current_ratio.toFixed(2)}`, severity:"High", col:C.red});
    if (f.pe_ratio != null && f.pe_ratio > 50) risks.push({text:`Extreme valuation — P/E of ${f.pe_ratio.toFixed(0)}x`, severity:"Medium", col:C.amb});
    if (f.eps_growth != null && f.eps_growth < -10) risks.push({text:`Earnings declining — EPS growth ${fmtPct(f.eps_growth,0)}`, severity:"High", col:C.red});
    if (risks.length === 0) risks.push({text:"No major risk flags identified", severity:"Low", col:C.grn});
    return risks;
  };

  // ── Earnings quality score (1-10) ──
  const calcEarningsQuality = (f) => {
    if (!f) return {score:null, factors:[]};
    let score = 5; // baseline
    const factors = [];
    if (f.free_cash_flow != null && f.free_cash_flow > 0) { score += 1.5; factors.push({text:"Positive free cash flow", col:C.grn}); }
    else if (f.free_cash_flow != null) { score -= 1.5; factors.push({text:"Negative free cash flow", col:C.red}); }
    if (f.earnings_streak != null && f.earnings_streak >= 4) { score += 1.5; factors.push({text:`${f.earnings_streak} consecutive earnings beats`, col:C.grn}); }
    else if (f.earnings_streak != null && f.earnings_streak >= 2) { score += 0.5; factors.push({text:`${f.earnings_streak} consecutive earnings beats`, col:C.amb}); }
    if (f.gross_margin != null && f.gross_margin > 40) { score += 0.5; factors.push({text:"Strong gross margins", col:C.grn}); }
    if (f.last_eps_surprise != null && f.last_eps_surprise > 0) { score += 0.5; factors.push({text:`Positive EPS surprise (${fmtPct(f.last_eps_surprise)})`, col:C.grn}); }
    else if (f.last_eps_surprise != null && f.last_eps_surprise < 0) { score -= 1; factors.push({text:`Negative EPS surprise (${fmtPct(f.last_eps_surprise)})`, col:C.red}); }
    if (f.revenue_growth != null && f.revenue_growth > 0) { score += 0.5; factors.push({text:"Revenue growth positive", col:C.grn}); }
    return {score: Math.max(1, Math.min(10, Math.round(score))), factors};
  };

  // ── Investor fit ──
  const calcInvestorFit = (f) => {
    if (!f) return [];
    return [
      {label:"Value Investors", fit: (f.pe_ratio != null && f.pe_ratio < 18 && f.target_upside != null && f.target_upside > 10)},
      {label:"Growth Investors", fit: (f.revenue_growth != null && f.revenue_growth > 10 && f.eps_growth != null && f.eps_growth > 10)},
      {label:"Income / Dividend", fit: (f.div_yield != null && f.div_yield > 2)},
      {label:"Quality Compounders", fit: (f.roe != null && f.roe > 15 && f.gross_margin != null && f.gross_margin > 30)},
      {label:"Tactical / Short-term", fit: (f.revenue_growth != null || f.eps_growth != null)},
    ];
  };

  // ── Final verdict ──
  const calcVerdict = (f, risks, eq) => {
    if (!f) return {verdict:"Insufficient data", confidence:"Low", action:"Investigate further"};
    let valScore = 0, qualScore = 0, riskScore = 0;
    if (f.pe_ratio != null && f.pe_ratio < 18) valScore += 2;
    else if (f.pe_ratio != null && f.pe_ratio < 25) valScore += 1;
    if (f.target_upside != null && f.target_upside > 15) valScore += 1;
    if (f.roe != null && f.roe > 15) qualScore += 2;
    if (f.gross_margin != null && f.gross_margin > 40) qualScore += 1;
    if (f.revenue_growth != null && f.revenue_growth > 5) qualScore += 1;
    riskScore = risks.filter(r => r.severity === "High").length;

    let verdict, action, confidence;
    const total = valScore + qualScore - riskScore * 1.5;
    if (total >= 4) { verdict = "Fundamentally attractive"; action = "Consider for portfolio"; confidence = "High"; }
    else if (total >= 2) { verdict = riskScore > 0 ? "Undervalued with elevated risk" : "Fairly valued with solid fundamentals"; action = "Investigate further"; confidence = "Moderate"; }
    else if (total >= 0) { verdict = "Mixed fundamentals"; action = "Monitor for improvement"; confidence = "Low"; }
    else { verdict = "Weak fundamentals"; action = "Avoid or reduce exposure"; confidence = "Low"; }

    if (eq && eq.score >= 8) confidence = "High";
    return {verdict, confidence, action};
  };

  // ── Market alignment ──
  const calcAlignment = (sent, catalysts) => {
    if (!sent) return {label:"Insufficient Data", col:C.mut};
    const s = sent.score || 0;
    const m = sent.momentum || 0;
    const nCat = (catalysts?.catalysts || []).length;
    const nHead = (catalysts?.headwinds || []).length;
    const net = s + m * 0.5 + (nCat - nHead) * 0.1;
    if (net > 0.3) return {label:"Supportive", col:C.grn};
    if (net < -0.3) return {label:"Diverging", col:C.red};
    return {label:"Mixed", col:C.amb};
  };

  // ── Precompute section data when loaded ──
  const f = data?.fundamentals || {};
  const sent = data?.sentiment || {};
  const cats = data?.catalysts_headwinds || {};
  const tech = data?.technical || {};
  const thesis = buildThesis(f, sent, data?.composite);
  const risks = buildRisks(f);
  const eq = calcEarningsQuality(f);
  const fits = calcInvestorFit(f);
  const verdict = calcVerdict(f, risks, eq);
  const alignment = calcAlignment(sent, cats);
  const al = analystLabel(f.recommend_mean);
  const price = tech?.latest_close;

  // Section wrapper helper
  const Section = ({accent, children, style:sx}) => (
    <div style={{borderRadius:14, border:`1.5px solid ${accent}30`, background:accent+"07", padding:"18px 20px", ...sx}}>
      {children}
    </div>
  );
  const SectionTitle = ({children, sub}) => (
    <div style={{marginBottom:14}}>
      <div style={mono(13, C.headingTxt, 700)}>{children}</div>
      {sub && <div style={{...mono(9, C.mut), marginTop:3}}>{sub}</div>}
    </div>
  );
  const MetricCard = ({label, value, color, sub}) => (
    <div style={{padding:"10px 12px", borderRadius:10, background:C.dim, border:`1px solid ${C.bdr}`}}>
      <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4}}>{label}</div>
      <div style={mono(16, color || C.headingTxt, 700)}>{value}</div>
      {sub && <div style={{...mono(8, C.mut), marginTop:2}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <Lbl>Fundamentals</Lbl>
        <div style={mono(10,C.mut)}>Institutional-grade equity underwriting — valuation, quality, risk, and market alignment</div>
      </div>

      {/* Search */}
      <Card>
        <div style={{display:"flex",gap:12,alignItems:"flex-end"}}>
          <div style={{flex:1}}>
            <div style={{...mono(9,C.mut,600),marginBottom:5,letterSpacing:"0.08em"}}>SYMBOL</div>
            <input
              value={input}
              onChange={e=>setInput(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&run()}
              placeholder="AAPL, MSFT, TSLA, SPY…"
              style={{
                width:"100%", padding:"9px 13px", borderRadius:8,
                border:`1.5px solid ${C.grn}55`,
                background:C.surf, color:C.headingTxt,
                fontFamily:"monospace", fontSize:14, fontWeight:600,
                boxSizing:"border-box", outline:"none",
              }}
            />
          </div>
          <SpinRing active={loading} color={C.sky}>
          <button onClick={run} disabled={loading}
            style={{padding:"9px 28px",borderRadius:8,border:"none",
              background:loading?C.dim:C.sky, color:loading?C.mut:"#000",
              fontFamily:"monospace", fontSize:11, fontWeight:700,
              cursor:loading?"not-allowed":"pointer", transition:"background .15s",
              display:"flex",alignItems:"center",gap:6}}>
            {loading && <RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/>}
            {loading ? "Analyzing…" : "Analyze"}
          </button>
          </SpinRing>
        </div>
      </Card>

      {err && <Card><div style={mono(11,C.red)}>⚠ {err}</div></Card>}

      {data && (<>

        {/* ══════════════════════════════════════════════════════════════════
            1. THESIS SNAPSHOT
           ══════════════════════════════════════════════════════════════════ */}
        {data.fundamentals && (()=>{ return (<div style={{display:"flex",flexDirection:"column",gap:16}}>

        {/* ── 1. THESIS SNAPSHOT ── */}
        <Section accent={C.pur}>
          <SectionTitle sub="Instant synthesis of the investment case">THESIS SNAPSHOT</SectionTitle>
          {f.company_name && <div style={{...mono(11, C.headingTxt, 600), marginBottom:10}}>
            {f.company_name} ({data.symbol}) {f.sector ? `— ${f.sector}` : ""} {f.industry ? `· ${f.industry}` : ""}
          </div>}
          {price && <div style={{...mono(9, C.mut), marginBottom:12}}>
            Last: <span style={mono(12, C.headingTxt, 700)}>${price.toFixed(2)}</span>
            {f.market_cap ? <span style={{marginLeft:14}}>Mkt Cap: <span style={mono(11, C.headingTxt, 600)}>{fmtCap(f.market_cap)}</span></span> : null}
          </div>}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {thesis.map((b,i) => (
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{...mono(11, b.col), flexShrink:0, marginTop:1}}>{b.col === C.grn ? "+" : b.col === C.red ? "−" : "·"}</span>
                <span style={mono(11, C.txt)}>{b.text}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 2. VALUATION OVERVIEW ── */}
        <Section accent={C.sky}>
          <SectionTitle sub="Is the stock cheap or expensive?">VALUATION OVERVIEW</SectionTitle>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap:10, marginBottom:16}}>
            <MetricCard label="P/E (TTM)" value={fmtNum(f.pe_ratio)} color={metricColor(f.pe_ratio, 0, 30)} sub="Trailing" />
            <MetricCard label="P/E (Fwd)" value={fmtNum(f.forward_pe)} color={metricColor(f.forward_pe, 0, 25)} sub="Forward" />
            <MetricCard label="EV/EBITDA" value={fmtNum(f.ev_to_ebitda)} color={metricColor(f.ev_to_ebitda, 0, 20)} />
            <MetricCard label="P/B" value={fmtNum(f.pb_ratio)} color={metricColor(f.pb_ratio, 0, 5)} />
            <MetricCard label="PEG" value={fmtNum(f.peg_ratio)} color={f.peg_ratio != null ? (f.peg_ratio < 1 ? C.grn : f.peg_ratio > 2 ? C.red : C.amb) : C.mut} />
          </div>

          {/* Analyst targets + intrinsic value */}
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "1fr 1fr", gap:12}}>
            <div style={{padding:"12px 14px", borderRadius:10, background:C.dim, border:`1px solid ${C.bdr}`}}>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8}}>ANALYST PRICE TARGETS</div>
              {f.analyst_target_low != null && f.analyst_target_high != null && (
                <div style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={mono(9, C.red, 600)}>${f.analyst_target_low?.toFixed(0)}</span>
                    <span style={mono(9, C.grn, 600)}>${f.analyst_target_high?.toFixed(0)}</span>
                  </div>
                  <div style={{height:6,borderRadius:3,background:C.bdr,position:"relative",overflow:"hidden"}}>
                    {price && <div style={{
                      position:"absolute", left:`${Math.min(100,Math.max(0,(price - f.analyst_target_low)/(f.analyst_target_high - f.analyst_target_low)*100))}%`,
                      top:0, width:3, height:6, background:C.sky, borderRadius:1
                    }}/>}
                    <div style={{height:"100%",borderRadius:3,background:`linear-gradient(90deg,${C.red}40,${C.amb}40,${C.grn}40)`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"center",marginTop:6}}>
                    <span style={mono(10, C.sky, 700)}>Mean: ${f.analyst_target_mean?.toFixed(0) || "—"}</span>
                  </div>
                </div>
              )}
              {f.target_upside != null && (
                <div style={{display:"flex",justifyContent:"center"}}>
                  <Tag color={f.target_upside > 0 ? C.grn : C.red}>{f.target_upside > 0 ? "+" : ""}{f.target_upside.toFixed(1)}% upside</Tag>
                </div>
              )}
            </div>

            <div style={{padding:"12px 14px", borderRadius:10, background:C.dim, border:`1px solid ${C.bdr}`}}>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8}}>INTRINSIC VALUE</div>
              {f.graham_number != null && f.graham_number > 0 ? (
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                    <span style={mono(9, C.mut)}>Graham Number</span>
                    <span style={mono(16, C.headingTxt, 700)}>${f.graham_number.toFixed(0)}</span>
                  </div>
                  {price && <div style={{...mono(9, f.graham_number > price ? C.grn : C.red), marginTop:6}}>
                    {f.graham_number > price ? `${((f.graham_number/price - 1)*100).toFixed(0)}% above current price — undervalued` : `${((1 - f.graham_number/price)*100).toFixed(0)}% below current price — overvalued`}
                  </div>}
                </div>
              ) : <div style={mono(10, C.mut)}>Insufficient data for intrinsic value estimate</div>}
            </div>
          </div>

          {/* Valuation drivers */}
          <div style={{marginTop:14, padding:"10px 14px", borderRadius:8, background:C.dim}}>
            <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6}}>VALUATION DRIVERS</div>
            <div style={mono(10, C.txt, 400)}>
              {f.pe_ratio != null && f.forward_pe != null && f.forward_pe < f.pe_ratio && <div style={{marginBottom:3}}>Forward P/E ({fmtNum(f.forward_pe)}x) below trailing ({fmtNum(f.pe_ratio)}x) — earnings expected to improve</div>}
              {f.pe_ratio != null && f.forward_pe != null && f.forward_pe >= f.pe_ratio && <div style={{marginBottom:3}}>Forward P/E ({fmtNum(f.forward_pe)}x) at or above trailing ({fmtNum(f.pe_ratio)}x) — growth may be slowing</div>}
              {f.peg_ratio != null && f.peg_ratio < 1 && <div style={{marginBottom:3}}>PEG below 1.0 — growth not fully priced in</div>}
              {f.ev_to_ebitda != null && f.ev_to_ebitda < 10 && <div>Low EV/EBITDA — enterprise value is modest relative to cash earnings</div>}
              {f.ev_to_ebitda != null && f.ev_to_ebitda > 25 && <div>High EV/EBITDA — premium pricing assumes durable competitive advantage</div>}
            </div>
          </div>
        </Section>

        {/* ── 3. BUSINESS QUALITY ── */}
        {(()=>{
          const qualityGood = (f.roe > 15 && f.gross_margin > 35);
          const qAccent = qualityGood ? C.grn : C.amb;
          return (
            <Section accent={qAccent}>
              <SectionTitle sub="Is this a high-quality business?">BUSINESS QUALITY</SectionTitle>
              <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginBottom:12}}>
                <MetricCard label="Gross Margin" value={f.gross_margin != null ? f.gross_margin.toFixed(1) + "%" : "—"} color={metricColor(f.gross_margin, 40, 20)} />
                <MetricCard label="Operating Margin" value={f.operating_margin != null ? f.operating_margin.toFixed(1) + "%" : "—"} color={metricColor(f.operating_margin, 20, 5)} />
                <MetricCard label="Net Margin" value={f.net_margin != null ? f.net_margin.toFixed(1) + "%" : "—"} color={metricColor(f.net_margin, 15, 0)} />
                <MetricCard label="ROE" value={f.roe != null ? f.roe.toFixed(1) + "%" : "—"} color={metricColor(f.roe, 15, 5)} />
              </div>
              {f.employees && f.revenue_ttm && (
                <div style={{...mono(9, C.mut), marginTop:4}}>
                  Revenue per employee: <span style={mono(10, C.headingTxt, 600)}>{fmtCap(f.revenue_ttm / f.employees)}</span>
                  <span style={{marginLeft:12}}>({f.employees.toLocaleString()} employees)</span>
                </div>
              )}
            </Section>
          );
        })()}

        {/* ── 4. BALANCE SHEET & CAPITAL ALLOCATION ── */}
        <Section accent={C.sky}>
          <SectionTitle sub="Can this company survive and allocate capital effectively?">BALANCE SHEET</SectionTitle>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10, marginBottom:12}}>
            <MetricCard label="Debt / Equity" value={f.debt_to_equity != null ? f.debt_to_equity.toFixed(0) + "%" : "—"} color={f.debt_to_equity != null ? (f.debt_to_equity < 50 ? C.grn : f.debt_to_equity < 150 ? C.amb : C.red) : C.mut} />
            <MetricCard label="Current Ratio" value={fmtNum(f.current_ratio, 2)} color={metricColor(f.current_ratio, 1.5, 1)} />
            <MetricCard label="Free Cash Flow" value={fmtFCF(f.free_cash_flow)} color={f.free_cash_flow != null ? (f.free_cash_flow > 0 ? C.grn : C.red) : C.mut} />
            <MetricCard label="Short Ratio" value={fmtNum(f.short_ratio)} color={f.short_ratio != null ? (f.short_ratio < 3 ? C.grn : f.short_ratio < 6 ? C.amb : C.red) : C.mut} />
          </div>
          <div style={{padding:"8px 12px", borderRadius:8, background:C.dim}}>
            <span style={mono(10, C.txt)}>
              {f.debt_to_equity != null && f.debt_to_equity < 50 && "Conservative balance sheet — low leverage. "}
              {f.debt_to_equity != null && f.debt_to_equity >= 50 && f.debt_to_equity < 150 && "Moderate leverage — manageable if cash flows remain stable. "}
              {f.debt_to_equity != null && f.debt_to_equity >= 150 && "Elevated leverage — monitor closely. "}
              {f.free_cash_flow != null && f.free_cash_flow > 0 && "Positive FCF supports buybacks and debt reduction."}
              {f.free_cash_flow != null && f.free_cash_flow <= 0 && "Negative FCF — dependent on external financing."}
            </span>
          </div>
        </Section>

        {/* ── 5. GROWTH & HISTORICAL TRENDS ── */}
        <Section accent={C.grn}>
          <SectionTitle sub="What direction is the business moving?">GROWTH & TRENDS</SectionTitle>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:10}}>
            <MetricCard label="Revenue Growth (YoY)" value={fmtPct(f.revenue_growth)} color={metricColor(f.revenue_growth, 5, -5)}
              sub={f.revenue_growth > 0 ? "↑ expanding" : f.revenue_growth < 0 ? "↓ contracting" : "→ flat"} />
            <MetricCard label="EPS Growth" value={fmtPct(f.eps_growth)} color={metricColor(f.eps_growth, 5, -5)}
              sub={f.eps_growth > 0 ? "↑ improving" : f.eps_growth < 0 ? "↓ declining" : "→ flat"} />
            <MetricCard label="Earnings Streak" value={f.earnings_streak != null ? f.earnings_streak + " Qs" : "—"} color={metricColor(f.earnings_streak, 3, 0)}
              sub={f.earnings_streak >= 4 ? "consistent beats" : f.earnings_streak >= 2 ? "recent beats" : "mixed"} />
            <MetricCard label="Last EPS Surprise" value={fmtPct(f.last_eps_surprise)} color={metricColor(f.last_eps_surprise, 0, -5)}
              sub={f.last_eps_surprise > 0 ? "beat estimates" : f.last_eps_surprise < 0 ? "missed estimates" : ""} />
          </div>
        </Section>

        {/* ── 6. RISK DASHBOARD ── */}
        <Section accent={C.red}>
          <SectionTitle sub="Clearly surface downside risks">RISK DASHBOARD</SectionTitle>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {risks.map((r,i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                <Tag color={r.col}>{r.severity}</Tag>
                <span style={mono(10, C.txt)}>{r.text}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 7. EXTERNAL VALIDATION ── */}
        <Section accent={C.amb}>
          <SectionTitle sub="Market, analysts, and narratives — supporting evidence">EXTERNAL VALIDATION</SectionTitle>

          {/* Analyst Positioning */}
          <div style={{marginBottom:16}}>
            <div style={{...mono(9, C.mut, 700), letterSpacing:"0.1em", marginBottom:8}}>ANALYST POSITIONING</div>
            <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
              <div>
                <span style={mono(9, C.mut)}>Consensus: </span>
                <span style={{...mono(13, al.col, 700), padding:"2px 10px", borderRadius:20, background:al.col+"15", border:`1px solid ${al.col}30`}}>{al.label}</span>
              </div>
              {f.analyst_count && <span style={mono(9, C.mut)}>({f.analyst_count} analysts)</span>}
            </div>
            {/* Rating scale bar */}
            {f.recommend_mean != null && (
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={mono(8, C.grn, 600)}>Buy</span>
                <div style={{flex:1,height:6,borderRadius:3,background:C.bdr,position:"relative"}}>
                  <div style={{position:"absolute",left:`${((f.recommend_mean - 1) / 4) * 100}%`,top:-3,width:12,height:12,borderRadius:6,background:al.col,border:`2px solid ${C.surf}`}}/>
                </div>
                <span style={mono(8, C.red, 600)}>Sell</span>
              </div>
            )}
            {/* Upgrades / Downgrades */}
            {f.analyst_activity && f.analyst_activity.length > 0 && (
              <div style={{marginTop:8}}>
                <div style={{...mono(8, C.mut, 600), letterSpacing:"0.08em", marginBottom:6}}>RECENT ACTIVITY</div>
                {f.analyst_activity.slice(0, 4).map((a, i) => (
                  <div key={i} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${C.bdr}`}}>
                    <span style={mono(8, C.mut)}>{a.date}</span>
                    <span style={mono(9, C.headingTxt, 600)}>{a.firm}</span>
                    <Tag color={a.action === "up" ? C.grn : a.action === "down" ? C.red : C.amb}>
                      {a.action === "up" ? "Upgrade" : a.action === "down" ? "Downgrade" : a.action === "init" ? "Initiate" : "Maintain"}
                    </Tag>
                    <span style={mono(8, C.mut)}>{a.from} → {a.to}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Market Narrative */}
          <div style={{marginBottom:16}}>
            <div style={{...mono(9, C.mut, 700), letterSpacing:"0.1em", marginBottom:8}}>MARKET NARRATIVE</div>
            <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
              <div>
                <span style={mono(9, C.mut)}>News tone: </span>
                <span style={mono(10, dCol(sent.direction), 700)}>{sent.direction || "neutral"}</span>
              </div>
              <div>
                <span style={mono(9, C.mut)}>Momentum: </span>
                <span style={mono(10, (sent.momentum||0) > 0 ? C.grn : (sent.momentum||0) < 0 ? C.red : C.amb, 700)}>
                  {(sent.momentum||0) > 0 ? "improving" : (sent.momentum||0) < 0 ? "softening" : "neutral"}
                </span>
              </div>
              {sent.articles && <span style={mono(9, C.mut)}>({sent.articles} articles)</span>}
            </div>
            {sent.headlines && sent.headlines.length > 0 && (
              <div style={{padding:"8px 12px",borderRadius:8,background:C.dim}}>
                {sent.headlines.slice(0,3).map((h,i) => (
                  <div key={i} style={{...mono(9, C.txt), padding:"3px 0", borderBottom: i < 2 ? `1px solid ${C.bdr}` : "none"}}>{typeof h === "string" ? h : h.title || h}</div>
                ))}
              </div>
            )}
          </div>

          {/* Bull vs Bear */}
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "1fr 1fr", gap:12, marginBottom:14}}>
            <div style={{padding:"10px 14px",borderRadius:10,background:C.grn+"08",border:`1px solid ${C.grn}25`}}>
              <div style={{...mono(9, C.grn, 700), letterSpacing:"0.1em", marginBottom:6}}>SUPPORTS THESIS</div>
              {(cats.catalysts||[]).length > 0
                ? cats.catalysts.slice(0,4).map((c,i) => <div key={i} style={{...mono(9, C.txt), padding:"3px 0"}}>+ {c}</div>)
                : <div style={mono(9, C.mut)}>No catalysts identified</div>}
            </div>
            <div style={{padding:"10px 14px",borderRadius:10,background:C.red+"08",border:`1px solid ${C.red}25`}}>
              <div style={{...mono(9, C.red, 700), letterSpacing:"0.1em", marginBottom:6}}>CHALLENGES THESIS</div>
              {(cats.headwinds||[]).length > 0
                ? cats.headwinds.slice(0,4).map((h,i) => <div key={i} style={{...mono(9, C.txt), padding:"3px 0"}}>- {h}</div>)
                : <div style={mono(9, C.mut)}>No headwinds identified</div>}
            </div>
          </div>

          {/* Market Alignment */}
          <div style={{display:"flex",justifyContent:"center",padding:"10px 0"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={mono(10, C.mut, 600)}>Market Alignment:</span>
              <span style={{...mono(12, alignment.col, 700), padding:"3px 14px", borderRadius:20, background:alignment.col+"15", border:`1px solid ${alignment.col}40`}}>{alignment.label}</span>
            </div>
          </div>
        </Section>

        {/* ── 8. EARNINGS QUALITY SCORE ── */}
        <Section accent={eq.score >= 7 ? C.grn : eq.score >= 4 ? C.amb : C.red}>
          <SectionTitle sub="Evaluate reliability of earnings">EARNINGS QUALITY</SectionTitle>
          <div style={{display:"flex",gap:20,alignItems: C.isMobile ? "flex-start" : "center",flexDirection: C.isMobile ? "column" : "row"}}>
            <div style={{width:72,height:72,borderRadius:36,border:`3px solid ${eq.score >= 7 ? C.grn : eq.score >= 4 ? C.amb : C.red}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={mono(28, eq.score >= 7 ? C.grn : eq.score >= 4 ? C.amb : C.red, 800)}>{eq.score || "—"}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,flex:1}}>
              <div style={mono(10, C.mut)}>Score out of 10 — based on cash vs accounting earnings, consistency, and revenue quality</div>
              {eq.factors.map((fac,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:5,height:5,borderRadius:3,background:fac.col,flexShrink:0}}/>
                  <span style={mono(9, fac.col)}>{fac.text}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ── 9. INVESTOR FIT ── */}
        <Section accent={C.sky}>
          <SectionTitle sub="Does this fit your strategy?">INVESTOR FIT</SectionTitle>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "repeat(5,1fr)", gap:10}}>
            {fits.map((fit,i) => (
              <div key={i} style={{padding:"10px 12px",borderRadius:10,background:C.dim,border:`1px solid ${fit.fit ? C.grn : C.bdr}30`,textAlign:"center"}}>
                <div style={mono(16, fit.fit ? C.grn : C.mut, 700)}>{fit.fit ? "✔" : "✖"}</div>
                <div style={{...mono(9, fit.fit ? C.headingTxt : C.mut, 600), marginTop:4}}>{fit.label}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 10. FINAL VERDICT ── */}
        <Section accent={C.pur}>
          <SectionTitle>VERDICT</SectionTitle>
          <div style={{display:"grid", gridTemplateColumns: C.isMobile ? "1fr" : "repeat(3,1fr)", gap:14}}>
            <div style={{padding:"12px 16px", borderRadius:10, background:C.dim}}>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.1em", marginBottom:6}}>FUNDAMENTAL VERDICT</div>
              <div style={mono(13, C.headingTxt, 700)}>{verdict.verdict}</div>
            </div>
            <div style={{padding:"12px 16px", borderRadius:10, background:C.dim}}>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.1em", marginBottom:6}}>CONFIDENCE</div>
              <div style={mono(13, verdict.confidence === "High" ? C.grn : verdict.confidence === "Moderate" ? C.amb : C.red, 700)}>{verdict.confidence}</div>
            </div>
            <div style={{padding:"12px 16px", borderRadius:10, background:C.dim}}>
              <div style={{...mono(8, C.mut, 600), letterSpacing:"0.1em", marginBottom:6}}>SUGGESTED ACTION</div>
              <div style={mono(13, C.sky, 700)}>{verdict.action}</div>
            </div>
          </div>
        </Section>

        </div>); })()}

      </>)}

      {!data && !loading && !err && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"48px 0",lineHeight:2}}>
            Enter any equity, ETF, or crypto ticker above and click <span style={{color:C.sky,fontWeight:700}}>Analyze</span><br/>
            to get a full fundamental breakdown — valuation, business quality, risk assessment,<br/>
            earnings quality, investor fit, and market alignment.
          </div>
        </Card>
      )}

      <div style={mono(8,C.mut)}>Not financial advice. All analysis is for educational/research purposes only.</div>
    </div>
  );
}


// ── PairsView ─────────────────────────────────────────────────────────────────
// ── PairsCompareChart ──────────────────────────────────────────────────────────
function PairsCompareChart({ comparisonSeries, symbols, pairs }) {
  const C = useC();
  const [visible, setVisible] = useState(() => new Set(symbols || []));
  const [range,   setRange]   = useState("1Y");
  const RANGE_DAYS = {"3M":63,"6M":126,"1Y":252,"2Y":504};

  // Slice to chosen range then normalize every symbol to 100 at period start
  const { chartData, symReturns } = useMemo(() => {
    if (!comparisonSeries?.length || !symbols?.length)
      return { chartData: [], symReturns: {} };
    const slice = comparisonSeries.slice(-(RANGE_DAYS[range] || 252));
    if (!slice.length) return { chartData: [], symReturns: {} };
    const first = slice[0];
    const bases = {};
    symbols.forEach(s => { bases[s] = first[s] || 1; });
    const chartData = slice.map(row => {
      const r = { date: row.date };
      symbols.forEach(s => {
        r[s] = row[s] != null ? +((row[s] / bases[s]) * 100).toFixed(2) : null;
      });
      return r;
    });
    const last = chartData[chartData.length - 1] || {};
    const symReturns = {};
    symbols.forEach(s => { symReturns[s] = last[s] != null ? (last[s] - 100).toFixed(1) : null; });
    return { chartData, symReturns };
  }, [comparisonSeries, symbols, range]);

  const pairMembers = useMemo(() =>
    new Set((pairs || []).flatMap(p => [p.symbol_a, p.symbol_b]))
  , [pairs]);

  if (!comparisonSeries?.length || !symbols?.length) return null;

  const toggle = s => setVisible(prev => {
    const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n;
  });

  return (
    <Card>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        marginBottom:10,flexWrap:"wrap",gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <TrendingUp size={13} style={{color:C.sky}}/>
          <span style={mono(9,C.sky,700)}>PRICE COMPARISON</span>
          <span style={mono(8,C.mut)}>normalized to 100 at period start</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          {["3M","6M","1Y","2Y"].map(r=>(
            <button key={r} onClick={()=>setRange(r)}
              style={{padding:"3px 9px",borderRadius:5,cursor:"pointer",
                border:`1px solid ${r===range?C.sky:C.bdr}`,
                background:r===range?C.sky+"22":"transparent",
                color:r===range?C.sky:C.mut,
                ...mono(9,undefined,r===range?700:400)}}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Symbol toggle chips — bold for pair members */}
      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
        {(symbols||[]).map((s,i)=>{
          const on  = visible.has(s);
          const col = TICKER_COLORS[i % TICKER_COLORS.length];
          const ret = symReturns[s];
          const isPair = pairMembers.has(s);
          return (
            <button key={s} onClick={()=>toggle(s)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",
                borderRadius:16,cursor:"pointer",transition:"all 0.15s",
                border:`1px solid ${on?col+"66":C.bdr+"44"}`,
                background:on?col+"18":"transparent"}}>
              <span style={{width:8,height:8,borderRadius:"50%",flexShrink:0,
                background:on?col:C.mut+"44",display:"inline-block"}}/>
              <span style={mono(9,on?col:C.mut,isPair?700:400)}>{s}</span>
              {ret!=null&&on&&(
                <span style={mono(8,parseFloat(ret)>=0?C.grn:C.red,600)}>
                  {parseFloat(ret)>=0?"+":""}{ret}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Chart — ChartPanel gives the expand-to-fullscreen button */}
      <ChartPanel title="Price Comparison" defaultHeight={290}>
        {(h)=>(
          <ResponsiveContainer width="100%" height={h}>
            <ComposedChart data={chartData} margin={{top:4,right:14,bottom:4,left:44}}>
              <defs>
                {(symbols||[]).map((s,i)=>{
                  const safeId = s.replace(/[^a-zA-Z0-9]/g,"_");
                  const col = TICKER_COLORS[i % TICKER_COLORS.length];
                  return (
                    <linearGradient key={s} id={`pcmp_${safeId}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={col} stopOpacity={0.22}/>
                      <stop offset="95%" stopColor={col} stopOpacity={0}/>
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid stroke={C.bdr} strokeDasharray="3 3"/>
              <XAxis dataKey="date" tick={{fill:C.mut,fontSize:8}} tickLine={false}
                tickFormatter={v=>v?.slice(5,10)||""}/>
              <YAxis tick={{fill:C.mut,fontSize:8}} tickLine={false} axisLine={false}
                tickFormatter={v=>v?.toFixed(0)}
                label={{value:"Indexed (100)",angle:-90,position:"insideLeft",offset:20,
                  style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
              <ReferenceLine y={100} stroke={C.bdr} strokeDasharray="4 2" strokeOpacity={0.8}/>
              <Tooltip
                contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,
                  ...mono(9),padding:"8px 14px",borderRadius:8}}
                labelStyle={{color:C.mut,marginBottom:6,fontFamily:"monospace",fontSize:9}}
                formatter={(v,name)=>{
                  const idx=(symbols||[]).indexOf(name);
                  if (idx<0||v==null) return [v,name];
                  const ret=(v-100).toFixed(1);
                  const col=TICKER_COLORS[idx%TICKER_COLORS.length];
                  return [
                    <span style={{color:col}}>{v.toFixed(1)} ({parseFloat(ret)>=0?"+":""}{ret}%)</span>,
                    <span style={{color:col,fontWeight:pairMembers.has(name)?700:400}}>{name}</span>
                  ];
                }}
              />
              {(symbols||[]).flatMap((s,i)=>{
                if (!visible.has(s)) return [];
                const col    = TICKER_COLORS[i % TICKER_COLORS.length];
                const safeId = s.replace(/[^a-zA-Z0-9]/g,"_");
                return [
                  <Area key={s} type="monotone" dataKey={s}
                    fill={`url(#pcmp_${safeId})`} stroke={col}
                    strokeWidth={pairMembers.has(s)?2.2:1.5}
                    fillOpacity={1} dot={false} connectNulls/>
                ];
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>
    </Card>
  );
}

function PairsView() {
  const C = useC();
  const [symbols,  setSymbols]  = useState("SPY,QQQ,IWM,GLD,TLT,XLF,XLK,XLE");
  const [loading,  setLoading]  = useState(false);
  const [pairs,    setPairs]    = useState(null);
  const [err,      setErr]      = useState(null);
  const [zEntry,   setZEntry]   = useState(2.0);
  const [minCorr,  setMinCorr]  = useState(0.7);
  const [expanded, setExpanded] = useState(null);
  const screeningRef = useRef(false);

  const screen = () => {
    if (screeningRef.current) return;               // prevent double-trigger (Enter + button)
    const syms = symbols.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
    if (syms.length < 2) { setErr("Need at least 2 symbols"); return; }
    screeningRef.current = true;
    setLoading(true); setPairs(null); setErr(null); setExpanded(null);
    fetch("/api/pairs/screen", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ symbols: syms, z_entry: zEntry, min_correlation: minCorr }),
    })
      .then(r=>r.ok?r.json():r.json().then(e=>Promise.reject(friendlyError(e.detail)||"Screen failed")))
      .then(d=>{ setPairs(d); setLoading(false); })
      .catch(e=>{ setErr(String(e)); setLoading(false); })
      .finally(()=>{ screeningRef.current = false; });
  };

  const zCol = z => { const az=Math.abs(z||0); return az>=zEntry?(z>0?C.grn:C.red):C.mut; };
  const posInfo = p => p==="long_spread"?{t:"LONG SPREAD",c:C.grn}:p==="short_spread"?{t:"SHORT SPREAD",c:C.red}:{t:"FLAT",c:C.mut};
  const PRESETS = [
    ["Mega-Cap Tech","AAPL,MSFT,GOOGL,META,NVDA,AMZN,TSLA"],
    ["Rates + Credit","TLT,HYG,LQD,IEF,AGG"],
    ["11 Sectors","XLF,XLK,XLE,XLV,XLI,XLB,XLRE,XLP,XLU,XLY"],
    ["Cross-Asset","SPY,QQQ,IWM,GLD,TLT,USO,UUP"],
    ["Crypto","BTC-USD,ETH-USD,SOL-USD,BNB-USD"],
    ["Futures","ES=F,NQ=F,GC=F,CL=F,ZN=F"],
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div>
        <Lbl>Pairs Trading</Lbl>
        <div style={mono(10,C.mut)}>Engle-Granger cointegration · Kalman filter dynamic hedge ratio · Z-score entry/exit</div>
      </div>

      <Card>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:2,minWidth:240}}>
            <div style={{...mono(9,C.mut),marginBottom:4}}>SYMBOLS (comma-separated, 2–30)</div>
            <input value={symbols} onChange={e=>setSymbols(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&screen()}
              style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${C.bdr}`,
                background:C.dim,color:C.txt,...mono(11),boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{...mono(9,C.mut),marginBottom:4}}>Z-ENTRY</div>
            <input type="number" value={zEntry} onChange={e=>setZEntry(+e.target.value)}
              min={1} max={4} step={0.1}
              style={{width:68,padding:"8px 10px",borderRadius:8,border:`1px solid ${C.bdr}`,
                background:C.dim,color:C.txt,...mono(12)}}/>
          </div>
          <div>
            <div style={{...mono(9,C.mut),marginBottom:4}}>MIN CORR</div>
            <input type="number" value={minCorr} onChange={e=>setMinCorr(+e.target.value)}
              min={0.4} max={1} step={0.05}
              style={{width:68,padding:"8px 10px",borderRadius:8,border:`1px solid ${C.bdr}`,
                background:C.dim,color:C.txt,...mono(12)}}/>
          </div>
          <SpinRing active={loading} color={C.sky}>
          <button onClick={screen} disabled={loading}
            style={{padding:"9px 20px",borderRadius:8,border:"none",
              background:loading?C.mut:C.sky,color:"#000",...mono(11,undefined,700),
              cursor:loading?"not-allowed":"pointer"}}>
            {loading ? "Screening…" : "Screen Pairs"}
          </button>
          </SpinRing>
        </div>
        <div style={{...mono(9,C.mut),marginTop:10}}>
          Quick load: {PRESETS.map(([n,s])=>(
            <span key={n} onClick={()=>setSymbols(s)}
              style={{...mono(9,C.sky),cursor:"pointer",marginRight:12,
                textDecoration:"underline",textDecorationStyle:"dotted"}}>
              {n}
            </span>
          ))}
        </div>
      </Card>

      {/* ── Pairs Trading Synthesis ── */}
      {pairs && (() => {
        const allPairs   = pairs.pairs || [];
        const total      = allPairs.length;
        const withSignal = allPairs.filter(p => p.signal_a !== 0 && p.signal_a != null);
        const longSpr    = withSignal.filter(p => p.position === "long_spread");
        const shortSpr   = withSignal.filter(p => p.position === "short_spread");

        // Quality metrics across the universe
        const pVals      = allPairs.map(p => p.p_value).filter(v => v != null);
        const avgP       = pVals.length ? pVals.reduce((a,b)=>a+b,0)/pVals.length : null;
        const highConf   = allPairs.filter(p => (p.p_value||1) < 0.01).length;   // p < 1%

        const halfLives  = allPairs.map(p => p.half_life).filter(v => v != null && v > 0);
        const minHL      = halfLives.length ? Math.min(...halfLives).toFixed(1) : null;
        const medHL      = halfLives.length
          ? [...halfLives].sort((a,b)=>a-b)[Math.floor(halfLives.length/2)].toFixed(1)
          : null;

        const sharpes    = allPairs.map(p => p.sharpe).filter(v => v != null);
        const bestSharpe = sharpes.length ? Math.max(...sharpes) : null;
        const avgSharpe  = sharpes.length ? sharpes.reduce((a,b)=>a+b,0)/sharpes.length : null;

        const zscores    = allPairs.map(p => p.current_zscore).filter(v => v != null);
        const avgAbsZ    = zscores.length
          ? (zscores.reduce((a,b)=>a+Math.abs(b),0)/zscores.length).toFixed(2)
          : null;
        const maxAbsZ    = zscores.length
          ? Math.max(...zscores.map(z=>Math.abs(z))).toFixed(2)
          : null;

        // Best pair by Sharpe
        const bestPair   = allPairs.length
          ? allPairs.reduce((a,b)=>(b.sharpe||0)>(a.sharpe||0)?b:a)
          : null;

        // Determine overall regime verdict
        let verdict, bc, synthesis, implications;

        if (total === 0) {
          verdict = "NO PAIRS"; bc = C.mut;
          synthesis = `${pairs.symbols_screened} symbols screened — no statistically significant cointegration found at current correlation threshold (${minCorr}).`;
          implications = "Expand your universe, lower the min correlation filter, or consider that the selected assets are moving independently (regime break or structural shift).";
        } else if (withSignal.length === 0) {
          verdict = "MEAN REVERTING"; bc = C.amb;
          synthesis = `${total} cointegrated pair${total===1?"":"s"} found across ${pairs.symbols_screened} symbols. Spreads are currently near equilibrium — no entry signals at ±${zEntry}σ. Median half-life: ${medHL||"—"}d · Avg |Z|: ${avgAbsZ||"—"}σ.`;
          implications = `Pairs are cointegrated but not stretched. Monitor for spread expansion — expected mean-reversion window is ~${medHL||"—"} trading days once a signal fires. ${highConf} pair${highConf===1?"":"s"} with p < 1% offer highest-conviction setup.`;
        } else if (withSignal.length >= 3 && avgAbsZ > 2.5) {
          verdict = "SPREAD REGIME"; bc = C.red;
          synthesis = `${withSignal.length} of ${total} pairs show active Z-score signals — broad spread widening suggests a market stress or correlation breakdown event. Avg |Z|: ${avgAbsZ}σ · Max |Z|: ${maxAbsZ}σ.`;
          implications = "High simultaneous signal count may indicate regime-wide dislocation rather than idiosyncratic pair divergence. Mean-reversion trades carry elevated risk — size conservatively and validate that cointegration relationships remain intact.";
        } else {
          const sDir = longSpr.length >= shortSpr.length ? "LONG SPREAD" : "SHORT SPREAD";
          verdict = `${withSignal.length} SIGNAL${withSignal.length>1?"S":""}  ACTIVE`; bc = C.grn;
          synthesis = `${withSignal.length} active signal${withSignal.length>1?"s":""} across ${total} cointegrated pair${total===1?"":"s"}. Dominant direction: ${sDir}. Best Sharpe: ${bestSharpe?.toFixed(2)||"—"} (${bestPair?.symbol_a||""}/${bestPair?.symbol_b||""}). Median half-life: ${medHL||"—"}d · Avg |Z|: ${avgAbsZ}σ.`;
          implications = `${highConf} pair${highConf===1?"":"s"} with p < 1% suggest robust cointegration. Size positions using hedge ratio (β) from each pair card — 1 unit long paired with β units short. Targets: Z-score returning to 0 within ~${medHL||"—"} days. Use ±0.5σ as exit.`;
        }

        // Go-forward note based on half-life
        let hlNote = "";
        if (medHL) {
          const hl = parseFloat(medHL);
          if (hl < 5)       hlNote = "⚡ Short half-lives (<5d) — suitable for active intraday/swing execution with tight stops.";
          else if (hl < 15) hlNote = "Short-to-medium half-lives (5–15d) — weekly rebalance cadence appropriate.";
          else if (hl < 40) hlNote = "Moderate half-lives (15–40d) — monthly review; spreads take time to revert.";
          else              hlNote = "Long half-lives (>40d) — cointegration may be weak or structural; monitor p-values closely over time.";
        }

        return (
          <div style={{padding:"18px 20px",borderRadius:12,
            background:bc+"09",border:`1px solid ${bc}35`,borderLeft:`3px solid ${bc}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
              <div style={mono(8,C.mut,700,{letterSpacing:1})}>PAIRS SYNTHESIS</div>
              <div style={{padding:"2px 10px",borderRadius:20,background:bc+"25",
                border:`1px solid ${bc}55`,...mono(9,bc,700)}}>{verdict}</div>
              <div style={{marginLeft:"auto",...mono(8,C.mut)}}>
                {total} pair{total===1?"":"s"} · {withSignal.length} signal{withSignal.length===1?"":"s"} · {pairs.symbols_screened} symbols screened
              </div>
            </div>
            <div style={{...mono(10,C.txt),marginBottom:10,lineHeight:1.6}}>{synthesis}</div>
            <div style={{...mono(8,C.mut,700,{letterSpacing:1}),marginBottom:4}}>OBSERVATIONS & GO-FORWARD</div>
            <div style={{...mono(10,C.mut),lineHeight:1.6,marginBottom: hlNote ? 8 : 0}}>{implications}</div>
            {hlNote && (
              <div style={{...mono(9,C.amb),marginTop:6,padding:"6px 10px",
                borderRadius:6,background:C.amb+"11",border:`1px solid ${C.amb}30`}}>
                {hlNote}
              </div>
            )}
            {bestPair && avgSharpe != null && (
              <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                {[
                  ["Best Pair",    `${bestPair.symbol_a}/${bestPair.symbol_b}`],
                  ["Best Sharpe",  bestSharpe?.toFixed(2)||"—"],
                  ["Avg Sharpe",   avgSharpe?.toFixed(2)||"—"],
                  ["Median HL",    medHL ? medHL+"d" : "—"],
                  ["High-Conf",    `${highConf}/${total}`],
                  ["Active",       `${withSignal.length}/${total}`],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",flexDirection:"column",gap:2}}>
                    <div style={mono(8,C.mut)}>{k}</div>
                    <div style={mono(11,C.headingTxt,700)}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {err && <Card><div style={mono(11,C.red)}>⚠ {err}</div></Card>}
      {loading && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"30px 0"}}>
            Running cointegration tests… (may take 20–40s for larger universes)
          </div>
        </Card>
      )}

      {pairs && (<>
        <div style={mono(10,C.mut)}>
          Screened {pairs.symbols_screened} symbols · {pairs.pairs?.length||0} cointegrated pair{pairs.pairs?.length===1?"":"s"} found
        </div>

        {/* Price comparison chart — always shown when data is available */}
        <PairsCompareChart
          comparisonSeries={pairs.comparison_series}
          symbols={pairs.comparison_symbols}
          pairs={pairs.pairs}
        />

        {(pairs.pairs?.length||0)===0 && (
          <Card><div style={mono(11,C.mut)}>No cointegrated pairs found. Try lowering min correlation or adding more symbols.</div></Card>
        )}

        {pairs.pairs?.map((p,i)=>{
          const pl=posInfo(p.position);
          const open=expanded===i;
          return (
            <Card key={i}>
              <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{minWidth:130}}>
                  <div style={mono(17,C.headingTxt,700)}>{p.symbol_a} / {p.symbol_b}</div>
                  <div style={{marginTop:4}}><Tag color={pl.c}>{pl.t}</Tag></div>
                </div>
                <div style={{display:"flex",gap:10,flex:1,flexWrap:"wrap"}}>
                  <Stat label="Z-Score"   value={p.current_zscore?.toFixed(2)||"—"}   valueColor={zCol(p.current_zscore)}/>
                  <Stat label="Half-Life" value={p.half_life!=null?p.half_life.toFixed(1)+"d":"—"}/>
                  <Stat label="Hedge β"   value={p.hedge_ratio?.toFixed(3)||"—"}/>
                  <Stat label="Corr"      value={(p.correlation*100)?.toFixed(1)+"%"}/>
                  <Stat label="p-value"   value={p.p_value?.toFixed(4)||"—"} valueColor={p.p_value<0.05?C.grn:C.red}/>
                  <Stat label="BT Return" value={p.recent_return!=null?(p.recent_return>=0?"+":"")+
                    (p.recent_return*100).toFixed(1)+"%":"—"} valueColor={(p.recent_return||0)>=0?C.grn:C.red}/>
                  <Stat label="Sharpe"    value={p.sharpe?.toFixed(2)||"—"} valueColor={(p.sharpe||0)>0.5?C.grn:(p.sharpe||0)<0?C.red:C.amb}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:170}}>
                  {p.signal_a!==0&&p.signal_a!=null ? (<>
                    <div style={mono(11,p.signal_a>0?C.grn:C.red,700)}>
                      {p.signal_a>0?"↑ BUY":"↓ SELL"} {p.symbol_a}
                    </div>
                    <div style={mono(11,p.signal_b>0?C.grn:C.red,700)}>
                      {p.signal_b>0?"↑ BUY":"↓ SELL"} {p.symbol_b}
                    </div>
                    <div style={mono(8,C.mut)}>hedge ratio {p.hedge_ratio?.toFixed(3)}</div>
                  </>) : (
                    <div style={mono(9,C.mut)}>No active signal (z={p.current_zscore?.toFixed(2)||"—"}, entry ±{zEntry})</div>
                  )}
                </div>
              </div>

              <button onClick={()=>setExpanded(open?null:i)}
                style={{marginTop:10,padding:"4px 12px",borderRadius:6,border:`1px solid ${C.bdr}`,
                  background:"transparent",color:C.mut,...mono(8),cursor:"pointer"}}>
                {open ? "▲ Hide spread chart" : "▼ Show spread z-score chart"}
              </button>

              {open && p.spread_series?.length > 0 && (
                <div style={{marginTop:10}}>
                  <ChartPanel title={`${p.symbol_a}/${p.symbol_b} · Spread Z-Score`} defaultHeight={180}>
                  {(h)=>(
                  <ResponsiveContainer width="100%" height={h}>
                    <ComposedChart data={p.spread_series} margin={{top:4,right:12,bottom:4,left:40}}>
                      <XAxis dataKey="timestamp" tick={{fill:C.mut,fontSize:8}} tickLine={false}
                        tickFormatter={v=>v?.slice(5,10)||""}/>
                      <YAxis tick={{fill:C.mut,fontSize:8}} tickLine={false} axisLine={false}
                        label={{value:"Z-Score",angle:-90,position:"insideLeft",offset:18,
                          style:{fontFamily:"monospace",fontSize:8,fill:C.mut,textAnchor:"middle"}}}/>
                      <CartesianGrid stroke={C.bdr} strokeDasharray="3 3"/>
                      <Tooltip contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,...mono(9)}}
                        formatter={v=>[v?.toFixed(3),"z-score"]}/>
                      <ReferenceLine y={zEntry}  stroke={C.red} strokeDasharray="4 2"/>
                      <ReferenceLine y={-zEntry} stroke={C.grn} strokeDasharray="4 2"/>
                      <ReferenceLine y={0} stroke={C.mut} strokeWidth={0.5}/>
                      <Line type="monotone" dataKey="z_score" stroke={C.sky} dot={false} strokeWidth={1.5}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                  )}
                  </ChartPanel>
                </div>
              )}
            </Card>
          );
        })}
      </>)}

      {!pairs&&!loading&&!err && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"40px 0",lineHeight:2}}>
            Enter a universe of symbols above and click <span style={{color:C.sky,fontWeight:700}}>Screen Pairs</span><br/>
            to find cointegrated pairs with active z-score trading signals.
          </div>
        </Card>
      )}
      <div style={mono(8,C.mut)}>⚠ Cointegration is not guaranteed to persist. Not financial advice.</div>
    </div>
  );
}

// ── Hub wrappers ────────────────────────────────────────
// Markets = Overview dashboard + Feeds
function MarketsView({onNav, onDetail}) {
  const [tab, setTab] = useState("dashboard");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",gap:8}}>
        {[["dashboard","Dashboard"],["feeds","Feeds"]].map(([id,l])=>(
          <Pill key={id} label={l} active={tab===id} onClick={()=>setTab(id)}/>
        ))}
      </div>
      {tab==="dashboard" && <OverviewView onNav={onNav} onDetail={onDetail}/>}
      {tab==="feeds"     && <FeedsView/>}
    </div>
  );
}

// Portfolio = Holdings analytics + Black-Litterman optimizer
function PortfolioHubView() {
  const [tab, setTab] = useState("holdings");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",gap:8}}>
        {[["holdings","Portfolio Risk"],["optimizer","Optimization"]].map(([id,l])=>(
          <Pill key={id} label={l} active={tab===id} onClick={()=>setTab(id)}/>
        ))}
      </div>
      {tab==="holdings"  && <PortfolioView/>}
      {tab==="optimizer" && <OptimizeView/>}
    </div>
  );
}

// Lab = Backtest runner + Results browser + Stochastic finance tools
function LabView() {
  const [tab, setTab] = useState("backtest");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",gap:8}}>
        {[["backtest","Backtest"],["report","Report"],["stochastic","Stochastic"]].map(([id,l])=>(
          <Pill key={id} label={l} active={tab===id} onClick={()=>setTab(id)}/>
        ))}
      </div>
      {tab==="backtest"   && <BacktestView/>}
      {tab==="report"     && <ReportView/>}
      {tab==="stochastic" && <StochasticView/>}
    </div>
  );
}

// ── Stock Synthesis helpers ───────────────────────────────
function generateStockSynthesis(snap) {
  const ticker = snap.symbol || snap.ticker || "The stock";
  const bullets = [];

  // --- Valuation ---
  if (snap.pe_ratio != null) {
    const pe = snap.pe_ratio;
    const valDesc = pe < 12 ? "deeply discounted"
      : pe < 18 ? "attractively valued"
      : pe < 25 ? "fairly valued"
      : pe < 35 ? "premium-priced"
      : "richly valued";
    let v = `At a P/E of ${pe.toFixed(1)}×, ${ticker} appears ${valDesc}`;
    if (snap.forward_pe != null) {
      const diff = pe - snap.forward_pe;
      if (diff > 2) v += `; forward earnings are expected to improve (Fwd P/E ${snap.forward_pe.toFixed(1)}×)`;
      else if (diff < -2) v += `; the forward P/E of ${snap.forward_pe.toFixed(1)}× suggests earnings may soften`;
    }
    if (snap.peg_ratio != null) {
      v += snap.peg_ratio < 1 ? " — a sub-1 PEG implies growth is not yet fully priced in"
        : snap.peg_ratio < 2 ? `; the PEG of ${snap.peg_ratio.toFixed(2)} is reasonable for a growth stock`
        : `; the elevated PEG of ${snap.peg_ratio.toFixed(2)} reflects stretched growth expectations`;
    }
    v += ".";
    if (snap.target_upside != null && snap.analyst_count > 0) {
      v += snap.target_upside > 0
        ? ` Analysts see ${snap.target_upside.toFixed(1)}% potential upside to consensus target.`
        : ` Analysts see ${Math.abs(snap.target_upside).toFixed(1)}% downside risk to consensus target.`;
    }
    bullets.push(v);
  }

  // --- Business quality ---
  const qParts = [];
  if (snap.roe != null) qParts.push(
    snap.roe > 20 ? `a strong ROE of ${snap.roe.toFixed(1)}%`
    : snap.roe > 10 ? `a decent ROE of ${snap.roe.toFixed(1)}%`
    : `a below-average ROE of ${snap.roe.toFixed(1)}%`
  );
  if (snap.net_margin != null) qParts.push(
    snap.net_margin > 20 ? `an excellent net margin of ${snap.net_margin.toFixed(1)}%`
    : snap.net_margin > 10 ? `a solid net margin of ${snap.net_margin.toFixed(1)}%`
    : snap.net_margin > 0 ? `a thin but positive net margin of ${snap.net_margin.toFixed(1)}%`
    : "negative net income"
  );
  if (snap.debt_to_equity != null) qParts.push(
    snap.debt_to_equity < 0.3 ? "minimal leverage on the balance sheet"
    : snap.debt_to_equity < 1 ? `manageable leverage (D/E ${snap.debt_to_equity.toFixed(2)})`
    : snap.debt_to_equity < 2 ? `elevated leverage at ${snap.debt_to_equity.toFixed(2)}× debt/equity`
    : `notably high leverage at ${snap.debt_to_equity.toFixed(2)}× debt/equity`
  );
  if (qParts.length > 0) bullets.push("Fundamentals show " + qParts.join(", ") + ".");

  // --- Growth ---
  const gParts = [];
  if (snap.revenue_growth != null) gParts.push(
    snap.revenue_growth > 20 ? `rapid revenue growth of ${snap.revenue_growth.toFixed(1)}%`
    : snap.revenue_growth > 5 ? `healthy revenue growth of ${snap.revenue_growth.toFixed(1)}%`
    : snap.revenue_growth > 0 ? `modest revenue growth of ${snap.revenue_growth.toFixed(1)}%`
    : `revenue decline of ${Math.abs(snap.revenue_growth).toFixed(1)}%`
  );
  if (snap.eps_growth != null) gParts.push(
    snap.eps_growth > 15 ? `strong EPS growth of ${snap.eps_growth.toFixed(1)}%`
    : snap.eps_growth > 0 ? `EPS up ${snap.eps_growth.toFixed(1)}%`
    : `EPS contracted ${Math.abs(snap.eps_growth).toFixed(1)}%`
  );
  if (snap.earnings_streak != null && snap.earnings_streak !== 0) gParts.push(
    snap.earnings_streak >= 2 ? `${snap.earnings_streak} consecutive earnings beats`
    : snap.earnings_streak <= -2 ? `${Math.abs(snap.earnings_streak)} consecutive earnings misses`
    : null
  );
  if (snap.last_eps_surprise != null) gParts.push(
    snap.last_eps_surprise > 0 ? `last quarter beat by ${snap.last_eps_surprise.toFixed(1)}%`
    : `last quarter missed by ${Math.abs(snap.last_eps_surprise).toFixed(1)}%`
  );
  const gFiltered = gParts.filter(Boolean);
  if (gFiltered.length > 0) bullets.push("Growth profile: " + gFiltered.join(", ") + ".");

  // --- Technical position ---
  const tParts = [];
  if (snap.above_ma50 != null && snap.above_ma200 != null) {
    if (snap.above_ma50 && snap.above_ma200) tParts.push("price confirmed above both 50- and 200-day MAs");
    else if (!snap.above_ma50 && !snap.above_ma200) tParts.push("price below both key moving averages — downtrend in force");
    else if (snap.above_ma50) tParts.push("near-term trend bullish but longer-term momentum still recovering");
    else tParts.push("longer-term structure intact but near-term price under pressure");
  }
  if (snap.rsi_14 != null) tParts.push(
    snap.rsi_14 > 70 ? `RSI at ${snap.rsi_14.toFixed(0)} is overbought — watch for potential pullback`
    : snap.rsi_14 < 30 ? `RSI at ${snap.rsi_14.toFixed(0)} is oversold — mean-reversion potential`
    : `RSI at ${snap.rsi_14.toFixed(0)} is neutral`
  );
  if (tParts.length > 0) bullets.push("Technically, " + tParts.join("; ") + ".");

  // --- Verdict ---
  const bull = [
    snap.pe_ratio != null && snap.pe_ratio < 18,
    snap.target_upside != null && snap.target_upside > 10,
    snap.above_ma50 && snap.above_ma200,
    snap.earnings_streak != null && snap.earnings_streak >= 2,
    snap.roe != null && snap.roe > 15,
    snap.revenue_growth != null && snap.revenue_growth > 5,
  ].filter(Boolean).length;
  const bear = [
    snap.pe_ratio != null && snap.pe_ratio > 35,
    snap.target_upside != null && snap.target_upside < 0,
    snap.above_ma50 === false && snap.above_ma200 === false,
    snap.earnings_streak != null && snap.earnings_streak <= -2,
    snap.debt_to_equity != null && snap.debt_to_equity > 2,
    snap.net_margin != null && snap.net_margin < 0,
  ].filter(Boolean).length;
  const verdict = bull > bear + 1
    ? "Overall, the weight of evidence is constructive — multiple fundamental and technical factors align favorably."
    : bear > bull + 1
    ? "Overall, the setup presents notable risk — consider position sizing carefully and watch for deterioration."
    : "Overall, the picture is mixed — positives and headwinds roughly offset; a selective or neutral stance is warranted.";

  return { bullets, verdict };
}

function StockSynthesisTile({ snap }) {
  const C = useC();
  if (!snap) return null;
  const { bullets, verdict } = generateStockSynthesis(snap);
  if (bullets.length === 0) return null;
  return (
    <div style={{borderRadius:12,border:`1px solid ${C.pur}30`,background:C.pur+"08",padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
        <Cpu size={13} style={{color:C.pur}}/>
        <span style={mono(9,C.pur,700)}>SYNTHESIS · KEY TAKEAWAYS</span>
        <span style={{...mono(8,C.mut),marginLeft:4,fontStyle:"italic"}}>{snap.symbol||""}</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {bullets.map((b,i)=>(
          <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{...mono(9,C.pur),marginTop:2,flexShrink:0}}>›</span>
            <span style={{...mono(10,C.txt),lineHeight:1.75}}>{b}</span>
          </div>
        ))}
      </div>
      <div style={{...mono(9,C.mut),marginTop:10,paddingTop:10,borderTop:`1px solid ${C.bdr}`,fontStyle:"italic",lineHeight:1.7}}>
        {verdict}
      </div>
    </div>
  );
}

// ── Sectors View ─────────────────────────────────────────
function SectorsView() {
  const C = useC();
  const { token } = useAuth();
  const [summaries,     setSummaries]     = useState(null);
  const [loadingOv,     setLoadingOv]     = useState(false);
  const [err,           setErr]           = useState(null);
  const [activeSector,  setActiveSector]  = useState(null);
  const [sectorData,    setSectorData]    = useState(null);
  const [sectorLoading, setSectorLoading] = useState(false);
  const [activeTicker,  setActiveTicker]  = useState(null);
  const [tickerData,    setTickerData]    = useState(null);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [jobId,         setJobId]         = useState(null);
  const [job,           setJob]           = useState(null);
  const [sortKey,       setSortKey]       = useState("signal_score");
  const [sortDir,       setSortDir]       = useState(-1);
  const [filterLabel,   setFilterLabel]   = useState("all");
  const pollRef = useRef(null);

  const fetchSummaries = () => {
    setLoadingOv(true); setErr(null);
    fetch("/api/sectors")
      .then(r=>r.ok?r.json():Promise.reject("Backend offline"))
      .then(d=>{setSummaries(d);setLoadingOv(false);})
      .catch(e=>{setErr(String(e));setLoadingOv(false);});
  };
  useEffect(()=>{
    setLoadingOv(true); setErr(null);
    fetch("/api/sectors")
      .then(r=>r.ok?r.json():Promise.reject("Backend offline"))
      .then(d=>{
        setSummaries(d); setLoadingOv(false);
        // Auto-refresh if no sectors are cached or all have zero data
        const cached = (d || []).filter(s => s.cached);
        const hasData = cached.some(s => s.total_market_cap > 0 || (s.etf_price != null && s.etf_price > 0));
        if (cached.length === 0 || !hasData) {
          triggerRefresh();
        }
      })
      .catch(e=>{setErr(String(e));setLoadingOv(false);});
  },[]);

  useEffect(()=>{
    if (!jobId) return;
    pollRef.current = setInterval(()=>{
      fetch(`/api/sectors/refresh/${jobId}`)
        .then(r=>r.json())
        .then(d=>{
          setJob(d);
          if (d.status!=="running") {
            clearInterval(pollRef.current);
            setJobId(null);
            fetchSummaries();
            if (activeSector) fetchSector(activeSector);
          }
        })
        .catch(()=>clearInterval(pollRef.current));
    },2500);
    return ()=>clearInterval(pollRef.current);
  },[jobId]);

  const triggerRefresh=(sectors=null)=>{
    const body=sectors?{sectors}:{};
    fetch("/api/sectors/refresh",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)})
      .then(async r=>{
        const text=await r.text();
        if(!r.ok) throw new Error(friendlyError(text) || `Server error ${r.status}: ${text.slice(0,120)}`);
        return JSON.parse(text);
      })
      .then(d=>{setJobId(d.job_id);setJob({...d,status:"running"});})
      .catch(e=>setErr(String(e)));
  };

  const fetchSector=(sector)=>{
    setSectorLoading(true);setSectorData(null);setErr(null);
    const enc=sector.replace(/ /g,"_");
    fetch(`/api/sectors/${enc}`)
      .then(r=>r.ok?r.json():r.json().then(e=>Promise.reject(e.detail||"Load failed")))
      .then(d=>{setSectorData(d);setSectorLoading(false);})
      .catch(e=>{setErr(String(e));setSectorLoading(false);});
  };

  const fetchTicker=(symbol)=>{
    setTickerLoading(true);setTickerData(null);
    fetch(`/api/sectors/ticker/${symbol}/financials`)
      .then(r=>r.ok?r.json():Promise.reject("Fetch failed"))
      .then(d=>{setTickerData(d);setTickerLoading(false);})
      .catch(e=>{setErr(String(e));setTickerLoading(false);});
  };

  // ── Helpers ──────────────────────────────────────────────
  const fp=(v,d=1)=>v==null?"—":`${v>=0?"+":""}${v.toFixed(d)}%`;
  const fn=(v,d=2)=>v==null?"—":v.toFixed(d);
  const fbn=(v)=>v==null||v<=0?"—":v>=1000?`$${(v/1000).toFixed(1)}T`:`$${v.toFixed(0)}B`;
  const cc=(v)=>v==null?C.mut:v>=0?C.grn:C.red;
  const sigCol=(lbl)=>({"STRONG BUY":C.grn,"BUY":"#66bb6a","NEUTRAL":C.mut,"SELL":"#ef9a9a","STRONG SELL":C.red}[lbl]||C.mut);
  const valCol=(lbl)=>lbl==="UNDERVALUED"?C.grn:lbl==="OVERVALUED"?C.red:C.mut;
  const sortToggle=(key)=>{if(sortKey===key)setSortDir(d=>-d);else{setSortKey(key);setSortDir(-1);}};

  const sortedTickers=useMemo(()=>{
    if (!sectorData?.tickers) return [];
    let tks=[...sectorData.tickers];
    if (filterLabel==="UNDERVALUED") tks=tks.filter(t=>t.val_label==="UNDERVALUED");
    else if (filterLabel==="OVERVALUED") tks=tks.filter(t=>t.val_label==="OVERVALUED");
    else if (filterLabel==="BUY") tks=tks.filter(t=>["STRONG BUY","BUY"].includes(t.signal_label));
    else if (filterLabel==="SELL") tks=tks.filter(t=>["STRONG SELL","SELL"].includes(t.signal_label));
    tks.sort((a,b)=>{const va=a[sortKey]??-9999,vb=b[sortKey]??-9999;return typeof va==="string"?va.localeCompare(vb)*sortDir:(va-vb)*sortDir;});
    return tks;
  },[sectorData,sortKey,sortDir,filterLabel]);

  // ── Job progress bar ─────────────────────────────────────
  const jobBar = job&&job.status==="running" ? (()=>{
    const pct=job.sectors_total>0?Math.round(job.sectors_done/job.sectors_total*100):0;
    return (
      <div style={{padding:"10px 14px",borderRadius:10,background:C.sky+"10",border:`1px solid ${C.sky}30`,marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={mono(10,C.sky,700)}>⟳ Refreshing sector data…</span>
          <span style={mono(10,C.sky)}>{job.sectors_done}/{job.sectors_total} sectors</span>
        </div>
        <div style={{height:4,borderRadius:2,background:C.bdr,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:2,background:C.sky,width:`${pct}%`,transition:"width .3s"}}/>
        </div>
      </div>
    );
  })() : null;

  // ══════════════════════════════════════════════════════════
  // RENDER: Ticker deep-dive
  // ══════════════════════════════════════════════════════════
  if (activeTicker) {
    const snap=sectorData?.tickers?.find(t=>t.symbol===activeTicker);
    const secColor=summaries?.find(s=>s.sector===activeSector)?.color||C.sky;
    return (
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <button onClick={()=>{setActiveTicker(null);setTickerData(null);}}
            style={{...mono(10,C.mut),background:"transparent",border:`1px solid ${C.bdr}`,borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
            ← {activeSector}
          </button>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={mono(18,C.headingTxt,800)}>{activeTicker}</span>
              {snap?.name&&snap.name!==activeTicker&&<span style={mono(11,C.mut)}>{snap.name}</span>}
              {snap?.signal_label&&<Tag color={sigCol(snap.signal_label)}>{snap.signal_label}</Tag>}
              {snap?.val_label&&snap.val_label!=="UNKNOWN"&&<Tag color={valCol(snap.val_label)}>{snap.val_label}</Tag>}
            </div>
            <div style={mono(10,C.mut)}>{activeSector} · Deep Dive</div>
          </div>
          {snap?.price!=null&&(
            <div style={{textAlign:"right"}}>
              <div style={mono(20,C.headingTxt,800)}>${snap.price.toFixed(2)}</div>
              {snap.change_1d_pct!=null&&<div style={mono(12,cc(snap.change_1d_pct),700)}>{fp(snap.change_1d_pct)}</div>}
            </div>
          )}
        </div>

        {tickerLoading&&(
          <Card><div style={{...mono(11,C.mut),padding:"24px 0",textAlign:"center",display:"flex",gap:8,alignItems:"center",justifyContent:"center"}}><RefreshCw size={13}/>Loading financials…</div></Card>
        )}

        {snap&&(<>
          {/* Performance strip */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
            {[["1D",snap.change_1d_pct],["1W",snap.change_1w_pct],["1M",snap.change_1m_pct],["3M",snap.change_3m_pct],["YTD",snap.change_ytd_pct]].map(([l,v])=>(
              <div key={l} style={{padding:"10px 12px",borderRadius:10,background:C.surf,border:`1px solid ${C.bdr}`,borderTop:`2px solid ${cc(v)}`}}>
                <div style={mono(8,C.mut)}>{l}</div>
                <div style={mono(16,cc(v),700)}>{fp(v)}</div>
              </div>
            ))}
          </div>

          {/* Synthesis panel */}
          <StockSynthesisTile snap={snap}/>

          {/* Market & Valuation */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Card>
              <Lbl>Market Data</Lbl>
              {[["Market Cap",fbn(snap.market_cap)],["Beta",snap.beta!=null?snap.beta.toFixed(2):"—"],["Vol/Avg",snap.volume_vs_avg!=null?`${snap.volume_vs_avg.toFixed(2)}×`:"—"],["52W High",snap.week52_high!=null?`$${snap.week52_high.toFixed(2)}`:"—"],["52W Low",snap.week52_low!=null?`$${snap.week52_low.toFixed(2)}`:"—"],["From 52W High",snap.pct_from_52h!=null?`${snap.pct_from_52h.toFixed(1)}%`:"—"]].map(([k,v])=><KV key={k} k={k} v={v}/>)}
            </Card>
            <Card>
              <Lbl>Valuation Multiples</Lbl>
              {[["P/E (TTM)",snap.pe_ratio!=null?fn(snap.pe_ratio,1):"—"],["Fwd P/E",snap.forward_pe!=null?fn(snap.forward_pe,1):"—"],["P/B",snap.pb_ratio!=null?fn(snap.pb_ratio,2):"—"],["P/S",snap.ps_ratio!=null?fn(snap.ps_ratio,2):"—"],["EV/EBITDA",snap.ev_ebitda!=null?fn(snap.ev_ebitda,1):"—"],["PEG",snap.peg_ratio!=null?fn(snap.peg_ratio,2):"—"],["Div Yield",snap.dividend_yield!=null?`${snap.dividend_yield.toFixed(2)}%`:"—"]].map(([k,v])=><KV key={k} k={k} v={v}/>)}
            </Card>
          </div>

          {/* Fundamentals */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Card>
              <Lbl>Fundamentals (TTM)</Lbl>
              {[["Revenue",fbn(snap.revenue_ttm)],["Revenue Growth",fp(snap.revenue_growth),cc(snap.revenue_growth)],["EPS (TTM)",snap.eps_ttm!=null?`$${fn(snap.eps_ttm,2)}`:"—"],["EPS Growth",fp(snap.eps_growth),cc(snap.eps_growth)],["Gross Margin",snap.gross_margin!=null?`${snap.gross_margin.toFixed(1)}%`:"—"],["Net Margin",snap.net_margin!=null?`${snap.net_margin.toFixed(1)}%`:"—"],["FCF",fbn(snap.free_cash_flow)]].map(([k,v,vc])=><KV key={k} k={k} v={v} vc={vc}/>)}
            </Card>
            <Card>
              <Lbl>Efficiency & Leverage</Lbl>
              {[["ROE",snap.roe!=null?`${snap.roe.toFixed(1)}%`:"—",cc(snap.roe)],["ROA",snap.roa!=null?`${snap.roa.toFixed(1)}%`:"—",cc(snap.roa)],["Op Margin",snap.operating_margin!=null?`${snap.operating_margin.toFixed(1)}%`:"—"],["Debt/Equity",snap.debt_to_equity!=null?fn(snap.debt_to_equity,2):"—"],["Current Ratio",snap.current_ratio!=null?fn(snap.current_ratio,2):"—"]].map(([k,v,vc])=><KV key={k} k={k} v={v} vc={vc}/>)}
            </Card>
          </div>

          {/* Technical signals */}
          <Card>
            <Lbl>Technical Signals</Lbl>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {[
                {l:"RSI-14",v:snap.rsi_14!=null?snap.rsi_14.toFixed(1):"—",c:snap.rsi_14==null?C.mut:snap.rsi_14>70?C.red:snap.rsi_14<30?C.grn:C.amb,s:snap.rsi_14!=null?(snap.rsi_14>70?"Overbought":snap.rsi_14<30?"Oversold":"Neutral"):null},
                {l:"MA 50",v:snap.ma50!=null?`$${snap.ma50.toFixed(2)}`:"—",c:snap.above_ma50?C.grn:C.red,s:snap.above_ma50?"Above":"Below"},
                {l:"MA 200",v:snap.ma200!=null?`$${snap.ma200.toFixed(2)}`:"—",c:snap.above_ma200?C.grn:C.red,s:snap.above_ma200?"Above":"Below"},
                {l:"MA50/200",v:snap.ma50_vs_ma200!=null?`${snap.ma50_vs_ma200.toFixed(2)}%`:"—",c:snap.ma50_vs_ma200!=null?cc(snap.ma50_vs_ma200):C.mut,s:snap.ma50_vs_ma200!=null?(snap.ma50_vs_ma200>0?"Golden Cross":"Death Cross"):null},
              ].map(({l,v,c,s})=>(
                <div key={l} style={{padding:"10px 12px",borderRadius:10,background:C.dim}}>
                  <div style={mono(8,C.mut)}>{l}</div>
                  <div style={mono(14,c,700)}>{v}</div>
                  {s&&<div style={{...mono(8,c),marginTop:2}}>{s}</div>}
                </div>
              ))}
            </div>
          </Card>

          {/* Analyst consensus */}
          {snap.analyst_count>0&&(
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Lbl>Analyst Consensus</Lbl>
                <Tag color={C.mut}>{snap.analyst_count} analysts · {snap.recommendation||""}</Tag>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {[["STRONG BUY",snap.strong_buy,C.grn],["BUY",snap.buy_count,"#66bb6a"],["HOLD",snap.hold_count,C.amb],["SELL",snap.sell_count,"#ef9a9a"],["STRONG SELL",snap.strong_sell,C.red]].filter(([,ct])=>ct>0).map(([lbl,ct,col])=>(
                  <div key={lbl} style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 12px",borderRadius:8,background:col+"12",border:`1px solid ${col}30`}}>
                    <div style={mono(14,col,800)}>{ct}</div>
                    <div style={mono(7,col,700)}>{lbl}</div>
                  </div>
                ))}
                {snap.mean_target!=null&&(
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 14px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`,marginLeft:"auto"}}>
                    <div style={mono(14,C.sky,800)}>${snap.mean_target.toFixed(2)}</div>
                    <div style={mono(7,C.mut)}>MEAN TARGET</div>
                    {snap.target_upside!=null&&<div style={mono(9,cc(snap.target_upside),700)}>{fp(snap.target_upside)} upside</div>}
                  </div>
                )}
              </div>
              {(()=>{const total=snap.analyst_count;const segs=[{p:snap.strong_buy/total*100,c:C.grn},{p:snap.buy_count/total*100,c:"#66bb6a"},{p:snap.hold_count/total*100,c:C.amb},{p:snap.sell_count/total*100,c:"#ef9a9a"},{p:snap.strong_sell/total*100,c:C.red}];return(<div style={{height:8,borderRadius:4,overflow:"hidden",display:"flex"}}>{segs.filter(s=>s.p>0).map((s,i)=><div key={i} style={{width:`${s.p}%`,background:s.c}}/>)}</div>);})()}
            </Card>
          )}

          {/* Earnings banner */}
          {(snap.next_earnings||snap.last_eps_surprise!=null||snap.earnings_streak!==0)&&(
            <Card>
              <Lbl>Earnings</Lbl>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {snap.next_earnings&&(
                  <div style={{padding:"10px 14px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
                    <div style={mono(8,C.mut)}>NEXT EARNINGS</div>
                    <div style={mono(14,C.sky,700)}>{snap.next_earnings}</div>
                  </div>
                )}
                {snap.last_eps_surprise!=null&&(
                  <div style={{padding:"10px 14px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
                    <div style={mono(8,C.mut)}>LAST EPS SURPRISE</div>
                    <div style={mono(14,cc(snap.last_eps_surprise),700)}>{fp(snap.last_eps_surprise)}</div>
                  </div>
                )}
                {snap.earnings_streak!==0&&(
                  <div style={{padding:"10px 14px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
                    <div style={mono(8,C.mut)}>EARNINGS STREAK</div>
                    <div style={mono(14,snap.earnings_streak>0?C.grn:C.red,700)}>
                      {snap.earnings_streak>0?`▲${snap.earnings_streak} beats`:`▼${Math.abs(snap.earnings_streak)} misses`}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </>)}

        {/* ── Deep-dive financials (from /financials endpoint) ── */}
        {tickerData&&!tickerLoading&&(<>
          {/* Quarterly income chart */}
          {tickerData.quarterly_income?.length>0&&(()=>{
            const qi=[...tickerData.quarterly_income].reverse();
            return (
              <Card>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <Lbl>Quarterly Revenue & Net Income</Lbl>
                  <span style={mono(8,C.mut)}>Last {qi.length}Q · $B</span>
                </div>
                <ChartPanel title={`${activeTicker} — Quarterly Financials`} defaultHeight={180}>
                  {h=>(
                    <ResponsiveContainer width="100%" height={h}>
                      <ComposedChart data={qi} margin={{left:-18,right:4,top:4,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
                        <XAxis dataKey="period" tick={{fontFamily:"monospace",fontSize:8,fill:C.mut}} tickLine={false} axisLine={false} tickFormatter={v=>v?.slice(0,7)||""}/>
                        <YAxis tick={{fontFamily:"monospace",fontSize:8,fill:C.mut}} tickLine={false} axisLine={false} tickFormatter={v=>v!=null?(v>=1?`$${v.toFixed(0)}B`:`$${(v*1000).toFixed(0)}M`):""}/>
                        <Tooltip {...makeTT(C)} formatter={(v,k)=>[v!=null?`$${Math.abs(v).toFixed(2)}B`:"—",k==="revenue"?"Revenue":"Net Income"]}/>
                        <Bar dataKey="revenue" name="Revenue" fill={C.sky} fillOpacity={0.8} radius={[3,3,0,0]}/>
                        <Bar dataKey="net_income" name="Net Income" radius={[3,3,0,0]}>
                          {qi.map((q,i)=><Cell key={i} fill={q.net_income>=0?C.grn+"aa":C.red+"aa"}/>)}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </ChartPanel>
              </Card>
            );
          })()}

          {/* Earnings history */}
          {tickerData.earnings_history?.length>0&&(
            <Card>
              <Lbl>Earnings History</Lbl>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {tickerData.earnings_history.slice(0,8).map((e,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",borderRadius:7,background:C.dim,alignItems:"center",flexWrap:"wrap",gap:6}}>
                    <span style={mono(10,C.txt)}>{e.period||e.date||`Q${i+1}`}</span>
                    {e.eps_estimate!=null&&<span style={mono(9,C.mut)}>Est: ${fn(e.eps_estimate,2)}</span>}
                    {e.eps_actual!=null&&<span style={mono(9,C.txt,700)}>Act: ${fn(e.eps_actual,2)}</span>}
                    {e.surprise_pct!=null&&<Tag color={e.surprise_pct>=0?C.grn:C.red}>{e.surprise_pct>=0?"+":""}{e.surprise_pct.toFixed(1)}%</Tag>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Analyst upgrades/downgrades */}
          {tickerData.upgrades_downgrades?.length>0&&(
            <Card>
              <Lbl>Recent Analyst Actions</Lbl>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {tickerData.upgrades_downgrades.slice(0,8).map((u,i)=>{
                  const isUp=["strongBuy","buy","upgrade"].some(k=>(u.action||"").toLowerCase().includes(k)||(u.to_grade||"").toLowerCase().includes("buy"));
                  const col=isUp?C.grn:C.red;
                  return (
                    <div key={i} style={{display:"flex",gap:8,padding:"7px 10px",borderRadius:7,background:C.dim,alignItems:"center",flexWrap:"wrap"}}>
                      <Tag color={col}>{u.action||"Rating"}</Tag>
                      <span style={mono(10,C.txt,700)}>{u.firm||"—"}</span>
                      {u.from_grade&&<span style={mono(9,C.mut)}>{u.from_grade} →</span>}
                      {u.to_grade&&<span style={mono(9,col,700)}>{u.to_grade}</span>}
                      {u.date&&<span style={{...mono(9,C.mut),marginLeft:"auto"}}>{String(u.date).slice(0,10)}</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Recent news */}
          {tickerData.recent_news?.length>0&&(
            <Card>
              <Lbl>Recent News</Lbl>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {tickerData.recent_news.slice(0,5).map((a,i)=>(
                  <div key={i} style={{padding:"8px 10px",borderRadius:7,background:C.dim}}>
                    <div style={mono(11,C.txt,700)}>{a.title}</div>
                    {a.publisher&&<div style={{...mono(8,C.mut),marginTop:3}}>
                      {a.publisher}{a.published&&<span> · {String(a.published).slice(0,10)}</span>}
                      {a.link&&<a href={a.link} target="_blank" rel="noreferrer" style={{...mono(8,C.sky),marginLeft:8}}>↗ Read</a>}
                    </div>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── SEC EDGAR: 10-15 year annual financials ── */}
          {tickerData.sec_annual&&(()=>{
            const sa=tickerData.sec_annual;
            const rev=sa.revenue_annual||[];
            const ni=sa.net_income_annual||[];
            const eps=sa.eps_annual||[];
            const debt=sa.lt_debt_annual||[];
            const cash=sa.cash_annual||[];
            const rd=sa.rd_expense_annual||[];
            // Merge revenue + net_income by year
            const years=Array.from(new Set([...rev,...ni].map(d=>d.period?.slice(0,4)||""))).filter(Boolean).sort();
            const annualChart=years.map(yr=>({
              year:yr,
              revenue:rev.find(d=>(d.period||"").startsWith(yr))?.value??null,
              net_income:ni.find(d=>(d.period||"").startsWith(yr))?.value??null,
            }));
            return (<>
              {annualChart.length>0&&(
                <Card>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                    <Lbl>Annual Revenue & Net Income · SEC EDGAR</Lbl>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={mono(8,C.mut)}>{annualChart.length} years · $B</span>
                      {sa.fetched_at&&<Tag color={C.mut}>{String(sa.fetched_at).slice(0,10)}</Tag>}
                    </div>
                  </div>
                  <ChartPanel title={`${activeTicker} — Annual Financials (SEC EDGAR)`} defaultHeight={200}>
                    {h=>(
                      <ResponsiveContainer width="100%" height={h}>
                        <ComposedChart data={annualChart} margin={{left:-18,right:4,top:4,bottom:0}}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
                          <XAxis dataKey="year" tick={{fontFamily:"monospace",fontSize:8,fill:C.mut}} tickLine={false} axisLine={false}/>
                          <YAxis tick={{fontFamily:"monospace",fontSize:8,fill:C.mut}} tickLine={false} axisLine={false} tickFormatter={v=>v!=null?(Math.abs(v)>=1?`$${v.toFixed(0)}B`:`$${(v*1000).toFixed(0)}M`):""}/>
                          <Tooltip {...makeTT(C)} formatter={(v,k)=>[v!=null?`$${Math.abs(v).toFixed(2)}B`:"—",k==="revenue"?"Revenue":"Net Income"]}/>
                          <Bar dataKey="revenue" name="Revenue" fill={C.sky} fillOpacity={0.8} radius={[3,3,0,0]}/>
                          <Bar dataKey="net_income" name="Net Income" radius={[3,3,0,0]}>
                            {annualChart.map((d,i)=><Cell key={i} fill={d.net_income==null?C.mut:d.net_income>=0?C.grn+"bb":C.red+"bb"}/>)}
                          </Bar>
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </ChartPanel>
                </Card>
              )}

              {/* EPS + Debt/Cash trend */}
              {(eps.length>0||debt.length>0||cash.length>0)&&(()=>{
                const epsYears=Array.from(new Set(eps.map(d=>d.period?.slice(0,4)||""))).filter(Boolean).sort();
                const epsChart=epsYears.map(yr=>({year:yr,eps:eps.find(d=>(d.period||"").startsWith(yr))?.value??null}));
                const dcYears=Array.from(new Set([...debt,...cash].map(d=>d.period?.slice(0,4)||""))).filter(Boolean).sort();
                const dcChart=dcYears.map(yr=>({year:yr,debt:debt.find(d=>(d.period||"").startsWith(yr))?.value??null,cash:cash.find(d=>(d.period||"").startsWith(yr))?.value??null}));
                return (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {epsChart.length>2&&(
                      <Card>
                        <Lbl>Annual EPS (Basic)</Lbl>
                        <ChartPanel title={`${activeTicker} — EPS History`} defaultHeight={140}>
                          {h=>(
                            <ResponsiveContainer width="100%" height={h}>
                              <ComposedChart data={epsChart} margin={{left:-18,right:4,top:4,bottom:0}}>
                                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
                                <XAxis dataKey="year" tick={{fontFamily:"monospace",fontSize:7,fill:C.mut}} tickLine={false} axisLine={false}/>
                                <YAxis tick={{fontFamily:"monospace",fontSize:7,fill:C.mut}} tickLine={false} axisLine={false} tickFormatter={v=>v!=null?`$${v.toFixed(1)}`:""}/>
                                <Tooltip {...makeTT(C)} formatter={(v)=>[v!=null?`$${v.toFixed(2)}`:"—","EPS"]}/>
                                <Bar dataKey="eps" radius={[3,3,0,0]}>
                                  {epsChart.map((d,i)=><Cell key={i} fill={d.eps==null?C.mut:d.eps>=0?C.grn+"aa":C.red+"aa"}/>)}
                                </Bar>
                              </ComposedChart>
                            </ResponsiveContainer>
                          )}
                        </ChartPanel>
                      </Card>
                    )}
                    {dcChart.length>2&&(
                      <Card>
                        <Lbl>Debt vs Cash ($B)</Lbl>
                        <ChartPanel title={`${activeTicker} — Debt & Cash`} defaultHeight={140}>
                          {h=>(
                            <ResponsiveContainer width="100%" height={h}>
                              <ComposedChart data={dcChart} margin={{left:-18,right:4,top:4,bottom:0}}>
                                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
                                <XAxis dataKey="year" tick={{fontFamily:"monospace",fontSize:7,fill:C.mut}} tickLine={false} axisLine={false}/>
                                <YAxis tick={{fontFamily:"monospace",fontSize:7,fill:C.mut}} tickLine={false} axisLine={false} tickFormatter={v=>v!=null?`$${v.toFixed(0)}B`:""}/>
                                <Tooltip {...makeTT(C)} formatter={(v,k)=>[v!=null?`$${Math.abs(v).toFixed(2)}B`:"—",k==="debt"?"LT Debt":"Cash"]}/>
                                <Bar dataKey="debt" name="LT Debt" fill={C.red} fillOpacity={0.75} radius={[3,3,0,0]}/>
                                <Bar dataKey="cash" name="Cash" fill={C.grn} fillOpacity={0.75} radius={[3,3,0,0]}/>
                              </ComposedChart>
                            </ResponsiveContainer>
                          )}
                        </ChartPanel>
                      </Card>
                    )}
                  </div>
                );
              })()}

              {/* R&D spend if meaningful */}
              {rd.length>2&&(()=>{
                const rdYears=Array.from(new Set(rd.map(d=>d.period?.slice(0,4)||""))).filter(Boolean).sort();
                const rdChart=rdYears.map(yr=>({year:yr,rd:rd.find(d=>(d.period||"").startsWith(yr))?.value??null}));
                return (
                  <Card>
                    <Lbl>R&D Spend ($B) · Annual</Lbl>
                    <ChartPanel title={`${activeTicker} — R&D Investment`} defaultHeight={130}>
                      {h=>(
                        <ResponsiveContainer width="100%" height={h}>
                          <ComposedChart data={rdChart} margin={{left:-18,right:4,top:4,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
                            <XAxis dataKey="year" tick={{fontFamily:"monospace",fontSize:7,fill:C.mut}} tickLine={false} axisLine={false}/>
                            <YAxis tick={{fontFamily:"monospace",fontSize:7,fill:C.mut}} tickLine={false} axisLine={false} tickFormatter={v=>v!=null?`$${v.toFixed(1)}B`:""}/>
                            <Tooltip {...makeTT(C)} formatter={(v)=>[v!=null?`$${v.toFixed(2)}B`:"—","R&D"]}/>
                            <Bar dataKey="rd" fill={C.pur} fillOpacity={0.8} radius={[3,3,0,0]}/>
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </ChartPanel>
                  </Card>
                );
              })()}
            </>);
          })()}

          {/* ── SEC Filings list ── */}
          {tickerData.sec_filings?.length>0&&(
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <Lbl>Recent SEC Filings</Lbl>
                {tickerData.cik&&(
                  <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${tickerData.cik}&type=&dateb=&owner=include&count=40`}
                     target="_blank" rel="noreferrer"
                     style={{...mono(8,C.sky),textDecoration:"none"}}>
                    View all on EDGAR ↗
                  </a>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {tickerData.sec_filings.slice(0,10).map((f,i)=>{
                  const formCol=f.form==="8-K"?C.amb:f.form==="10-K"?C.grn:f.form==="10-Q"?C.sky:C.mut;
                  return (
                    <div key={i} style={{display:"flex",gap:10,padding:"6px 10px",borderRadius:7,background:C.dim,alignItems:"center",flexWrap:"wrap"}}>
                      <Tag color={formCol}>{f.form}</Tag>
                      <span style={mono(9,C.mut)}>{f.date}</span>
                      <span style={{...mono(9,C.txt),flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.description}</span>
                      {f.url&&<a href={f.url} target="_blank" rel="noreferrer" style={{...mono(8,C.sky),flexShrink:0,textDecoration:"none"}}>↗</a>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>)}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // RENDER: Sector drill-down
  // ══════════════════════════════════════════════════════════
  if (activeSector) {
    const secSum=summaries?.find(s=>s.sector===activeSector);
    const secColor=secSum?.color||C.sky;
    const SortTh=({k,label,title})=>(
      <th onClick={()=>sortToggle(k)} title={title||label}
        style={{...mono(8,sortKey===k?C.headingTxt:C.mut,sortKey===k?700:400),padding:"8px 10px",textAlign:"right",whiteSpace:"nowrap",cursor:"pointer",userSelect:"none",borderBottom:`1px solid ${C.bdr}`}}>
        {label}{sortKey===k?(sortDir===-1?"↓":"↑"):""}
      </th>
    );
    return (
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <button onClick={()=>{setActiveSector(null);setSectorData(null);setFilterLabel("all");setErr(null);}}
            style={{...mono(10,C.mut),background:"transparent",border:`1px solid ${C.bdr}`,borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
            ← All Sectors
          </button>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:12,height:12,borderRadius:3,background:secColor,flexShrink:0}}/>
              <span style={mono(16,C.headingTxt,800)}>{activeSector}</span>
              {secSum?.etf&&<Tag color={secColor}>{secSum.etf}</Tag>}
            </div>
            {secSum?.snapshot_at&&<div style={mono(9,C.mut)}>Snapshot: {String(secSum.snapshot_at).slice(0,16)}</div>}
          </div>
          <button onClick={()=>triggerRefresh([activeSector])}
            style={{...mono(9,C.mut),background:"transparent",border:`1px solid ${C.bdr}`,borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
            <RefreshCw size={11}/> Refresh Sector
          </button>
        </div>

        {jobBar}

        {/* Sector agg stats */}
        {secSum?.cached&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
            {[
              {l:"Market Cap",v:fbn(secSum.total_market_cap),c:C.headingTxt},
              {l:"ETF Today",v:fp(secSum.etf_change_1d),c:cc(secSum.etf_change_1d)},
              {l:"ETF YTD",v:fp(secSum.etf_change_ytd),c:cc(secSum.etf_change_ytd)},
              {l:"Breadth",v:secSum.breadth_up!=null?`${secSum.breadth_up}↑ ${secSum.breadth_down}↓`:"—",c:secSum.breadth_up>secSum.breadth_down?C.grn:C.red},
              {l:"Median P/E",v:secSum.median_pe!=null?fn(secSum.median_pe,1):"—",c:C.txt},
            ].map(({l,v,c})=>(
              <div key={l} style={{padding:"10px 12px",borderRadius:10,background:C.surf,border:`1px solid ${C.bdr}`}}>
                <div style={mono(8,C.mut)}>{l}</div>
                <div style={mono(16,c,700)}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter pills */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={mono(8,C.mut,700)}>FILTER:</span>
          {[["all","All Tickers"],["UNDERVALUED","Undervalued"],["OVERVALUED","Overvalued"],["BUY","Buy Signals"],["SELL","Sell Signals"]].map(([f,l])=>(
            <Pill key={f} label={l} active={filterLabel===f} onClick={()=>setFilterLabel(f)}/>
          ))}
          <span style={{...mono(8,C.mut),marginLeft:"auto"}}>{sortedTickers.length} tickers</span>
        </div>

        {sectorLoading&&(
          <Card><div style={{...mono(11,C.mut),padding:"24px 0",textAlign:"center",display:"flex",gap:8,alignItems:"center",justifyContent:"center"}}><RefreshCw size={13}/>Loading {activeSector} data…</div></Card>
        )}
        {err&&!sectorLoading&&(
          <Card><div style={{...mono(10,C.red)}}>{err}</div><div style={{...mono(9,C.mut),marginTop:4}}>Try clicking "Refresh Sector" above.</div></Card>
        )}
        {!sectorData&&!sectorLoading&&!err&&(
          <Card>
            <div style={{...mono(11,C.mut),padding:"20px 0",textAlign:"center"}}>No data cached for {activeSector} yet.</div>
            <div style={{textAlign:"center",marginTop:10}}>
              <button onClick={()=>triggerRefresh([activeSector])}
                style={{...mono(11,secColor,700),padding:"8px 18px",borderRadius:8,background:secColor+"15",border:`1px solid ${secColor}40`,cursor:"pointer"}}>
                Fetch {activeSector} Data
              </button>
            </div>
          </Card>
        )}

        {/* Ticker table */}
        {sortedTickers.length>0&&(
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:C.dim}}>
                    <th style={{...mono(8,C.mut,700),padding:"8px 10px",textAlign:"left",borderBottom:`1px solid ${C.bdr}`,whiteSpace:"nowrap"}}>TICKER</th>
                    <th style={{...mono(8,C.mut,700),padding:"8px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}`,whiteSpace:"nowrap"}}>PRICE</th>
                    {[["change_1d_pct","1D"],["change_1w_pct","1W"],["change_1m_pct","1M"],["change_ytd_pct","YTD"],["market_cap","MKT CAP"],["pe_ratio","P/E"],["rsi_14","RSI"],["val_score","VAL"],["signal_score","SIGNAL"]].map(([k,l])=>(
                      <SortTh key={k} k={k} label={l}/>
                    ))}
                    <th style={{...mono(8,C.mut,700),padding:"8px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}`,whiteSpace:"nowrap"}}>ANALYST</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTickers.map((t,i)=>(
                    <tr key={t.symbol}
                      onClick={()=>{setActiveTicker(t.symbol);fetchTicker(t.symbol);}}
                      style={{cursor:"pointer",background:i%2===0?"transparent":C.dim+"60",transition:"background .1s"}}
                      onMouseEnter={e=>e.currentTarget.style.background=secColor+"12"}
                      onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":C.dim+"60"}>
                      <td style={{padding:"7px 10px",borderBottom:`1px solid ${C.bdr}20`}}>
                        <div style={mono(11,C.headingTxt,700)}>{t.symbol}</div>
                        {(()=>{const cn=COMPANY_NAMES[t.symbol]||(t.name&&t.name!==t.symbol?t.name:null);return cn?<div style={{...mono(8,C.mut),maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cn}</div>:null;})()}
                      </td>
                      <td style={{...mono(11,C.txt,600),padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`,whiteSpace:"nowrap"}}>{t.price!=null?`$${t.price.toFixed(2)}`:"—"}</td>
                      {[t.change_1d_pct,t.change_1w_pct,t.change_1m_pct,t.change_ytd_pct].map((v,j)=>(
                        <td key={j} style={{...mono(10,cc(v),700),padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`,whiteSpace:"nowrap"}}>{v!=null?fp(v):"—"}</td>
                      ))}
                      <td style={{...mono(10,C.txt),padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`,whiteSpace:"nowrap"}}>{fbn(t.market_cap)}</td>
                      <td style={{...mono(10,C.txt),padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`}}>{t.pe_ratio!=null?fn(t.pe_ratio,1):"—"}</td>
                      <td style={{padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`}}>
                        {t.rsi_14!=null?<span style={mono(10,t.rsi_14>70?C.red:t.rsi_14<30?C.grn:C.amb,700)}>{t.rsi_14.toFixed(0)}</span>:"—"}
                      </td>
                      <td style={{padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`}}>
                        {t.val_label&&t.val_label!=="UNKNOWN"&&t.val_label!=="FAIR"?<Tag color={valCol(t.val_label)}>{t.val_label.slice(0,5)}</Tag>:<span style={mono(9,C.mut)}>{t.val_label==="FAIR"?"FAIR":"—"}</span>}
                      </td>
                      <td style={{padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`}}>
                        {t.signal_label?<Tag color={sigCol(t.signal_label)}>{t.signal_label}</Tag>:"—"}
                      </td>
                      <td style={{padding:"7px 10px",textAlign:"right",borderBottom:`1px solid ${C.bdr}20`}}>
                        {t.recommendation?<span style={mono(9,sigCol(t.recommendation==="strongBuy"?"STRONG BUY":t.recommendation==="buy"?"BUY":t.recommendation==="hold"?"NEUTRAL":t.recommendation==="sell"?"SELL":"STRONG SELL"),700)}>{t.recommendation}</span>:"—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Synthesis tile */}
        {sectorData&&(()=>{
          const tks=sectorData.tickers||[];
          const buys=tks.filter(t=>["STRONG BUY","BUY"].includes(t.signal_label)).length;
          const sells=tks.filter(t=>["STRONG SELL","SELL"].includes(t.signal_label)).length;
          const under=tks.filter(t=>t.val_label==="UNDERVALUED").length;
          const over=tks.filter(t=>t.val_label==="OVERVALUED").length;
          const topBuy=[...tks].filter(t=>t.signal_score!=null).sort((a,b)=>(b.signal_score||0)-(a.signal_score||0)).slice(0,4);
          const topSell=[...tks].filter(t=>t.signal_score!=null).sort((a,b)=>(a.signal_score||0)-(b.signal_score||0)).slice(0,4);
          const verdict=buys>=5&&under>=3?"ACCUMULATE":buys>=4?"SELECTIVE BUYS":sells>=5?"AVOID":"HOLD / NEUTRAL";
          const vCol=verdict==="ACCUMULATE"?C.grn:verdict==="SELECTIVE BUYS"?C.sky:verdict==="AVOID"?C.red:C.mut;
          return (
            <Card accent={vCol}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:14}}>
                <div>
                  <Lbl>Sector Synthesis</Lbl>
                  <div style={{...mono(17,vCol,800),letterSpacing:".02em"}}>{verdict}</div>
                  <div style={mono(9,C.mut)}>Composite view across {tks.length} names in {activeSector}</div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <Tag color={C.grn}>{buys} buy signals</Tag>
                  <Tag color={C.red}>{sells} sell signals</Tag>
                  <Tag color={C.grn}>{under} undervalued</Tag>
                  <Tag color={C.red}>{over} overvalued</Tag>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{...mono(8,C.grn,700),marginBottom:6,letterSpacing:".1em"}}>TOP BUY SIGNALS</div>
                  {topBuy.map(t=>(
                    <div key={t.symbol} onClick={()=>{setActiveTicker(t.symbol);fetchTicker(t.symbol);}}
                      style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",borderRadius:7,background:C.grn+"08",border:`1px solid ${C.grn}20`,marginBottom:4,cursor:"pointer"}}>
                      <span style={mono(10,C.txt,700)}>{t.symbol}</span>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        {t.val_label!=="UNKNOWN"&&t.val_label!=="FAIR"&&<span style={mono(8,valCol(t.val_label))}>{t.val_label}</span>}
                        <Tag color={sigCol(t.signal_label)}>{t.signal_label}</Tag>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{...mono(8,C.red,700),marginBottom:6,letterSpacing:".1em"}}>WEAKEST SIGNALS</div>
                  {topSell.map(t=>(
                    <div key={t.symbol} onClick={()=>{setActiveTicker(t.symbol);fetchTicker(t.symbol);}}
                      style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",borderRadius:7,background:C.red+"08",border:`1px solid ${C.red}20`,marginBottom:4,cursor:"pointer"}}>
                      <span style={mono(10,C.txt,700)}>{t.symbol}</span>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        {t.val_label!=="UNKNOWN"&&t.val_label!=="FAIR"&&<span style={mono(8,valCol(t.val_label))}>{t.val_label}</span>}
                        <Tag color={sigCol(t.signal_label)}>{t.signal_label}</Tag>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          );
        })()}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // RENDER: Overview grid
  // ══════════════════════════════════════════════════════════
  const cachedCount=summaries?.filter(s=>s.cached).length||0;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
        <div>
          <Lbl>Sector Monitor</Lbl>
          <div style={mono(10,C.mut)}>S&P 500 · 11 GICS sectors · Valuation + Signal scoring</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {cachedCount>0&&<Tag color={C.mut}>{cachedCount}/11 cached</Tag>}
          <button onClick={()=>{
            fetch("/api/sectors/universe/refresh",{method:"POST",headers:{...(token?{Authorization:`Bearer ${token}`}:{})}})
              .then(r=>r.json()).then(d=>alert(`Universe refreshed: ${d.total} S&P 500 tickers across ${Object.keys(d.sectors||{}).length} sectors`))
              .catch(e=>alert("Universe refresh failed: "+e));
          }} style={{...mono(9,C.mut),background:"transparent",border:`1px solid ${C.bdr}`,borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}
            title="Refresh S&P 500 constituent list from Wikipedia">
            <Globe size={11}/> Update Universe
          </button>
          <SpinRing active={job?.status==="running"} color={C.sky}>
          <button onClick={()=>triggerRefresh()} disabled={job?.status==="running"}
            style={{...mono(9,job?.status==="running"?C.sky:C.mut),
              background:job?.status==="running"?C.sky+"12":"transparent",
              border:`1px solid ${job?.status==="running"?C.sky+"44":C.bdr}`,
              borderRadius:7,padding:"5px 12px",
              cursor:job?.status==="running"?"not-allowed":"pointer",
              display:"flex",alignItems:"center",gap:5,transition:"all .2s"}}>
            <RefreshCw size={11} style={{animation:job?.status==="running"?"spin 1s linear infinite":undefined}}/>
            {job?.status==="running" ? "Refreshing…" : "Refresh All"}
          </button>
          </SpinRing>
        </div>
      </div>

      {jobBar}

      {/* ── SECTOR REGIME & LEADERSHIP SNAPSHOT ── */}
      {summaries && summaries.length > 0 && (()=>{
        const CYCL = new Set(["Energy","Materials","Industrials","Financials","Consumer Discretionary"]);
        const DEF = new Set(["Utilities","Consumer Staples","Health Care","Real Estate"]);
        const GRO = new Set(["Information Technology","Communication Services"]);
        const cached = summaries.filter(s=>s.cached && (s.total_market_cap > 0 || (s.etf_price != null && s.etf_price > 0)));
        if (cached.length < 3) return null;

        const allChgs = cached.map(s => s.avg_change_1d || s.etf_change_1d || 0);
        const advancing = cached.filter(s => (s.avg_change_1d||s.etf_change_1d||0) >= 0).length;
        const breadthR = advancing / cached.length;
        const avgChg = allChgs.reduce((a,b)=>a+b,0) / allChgs.length;

        const cyc = cached.filter(s=>CYCL.has(s.sector)).map(s=>s.avg_change_1d||s.etf_change_1d||0);
        const def_ = cached.filter(s=>DEF.has(s.sector)).map(s=>s.avg_change_1d||s.etf_change_1d||0);
        const gro = cached.filter(s=>GRO.has(s.sector)).map(s=>s.avg_change_1d||s.etf_change_1d||0);
        const cycAvg = cyc.length ? cyc.reduce((a,b)=>a+b,0)/cyc.length : 0;
        const defAvg = def_.length ? def_.reduce((a,b)=>a+b,0)/def_.length : 0;
        const groAvg = gro.length ? gro.reduce((a,b)=>a+b,0)/gro.length : 0;

        let rotation;
        if (breadthR >= 0.8 && cycAvg > 0 && defAvg > 0 && groAvg > 0) rotation = "Broad Participation";
        else if (cycAvg > defAvg + 0.15 && cycAvg > groAvg + 0.1 && cycAvg > 0) rotation = "Cyclical Leadership";
        else if (defAvg > cycAvg + 0.15 && defAvg > groAvg + 0.1) rotation = "Defensive Rotation";
        else if (groAvg > cycAvg + 0.15 && groAvg > defAvg + 0.1 && groAvg > 0) rotation = "Growth Leadership";
        else rotation = "Mixed Rotation";

        // Map to shared regime
        let mappedRegime;
        if (rotation === "Broad Participation" && avgChg > 0.4) mappedRegime = "Risk-On";
        else if (rotation === "Cyclical Leadership" && avgChg > 0.15) mappedRegime = "Constructive";
        else if (rotation === "Growth Leadership" && breadthR < 0.4) mappedRegime = "Neutral";
        else if (rotation === "Defensive Rotation") mappedRegime = "Cautious";
        else if (avgChg < -0.35) mappedRegime = "Risk-Off";
        else if (rotation === "Mixed Rotation") mappedRegime = "Transitional";
        else mappedRegime = "Neutral";

        const regCol = ({"Risk-On":C.grn,"Constructive":"#66bb6a","Neutral":C.amb,"Cautious":"#ff8a65","Risk-Off":C.red,"Transitional":C.amb})[mappedRegime]||C.mut;
        const rotCol = ({"Broad Participation":C.grn,"Cyclical Leadership":"#66bb6a","Defensive Rotation":"#ff8a65","Growth Leadership":C.sky,"Mixed Rotation":C.amb})[rotation]||C.mut;

        return (
          <div style={{borderRadius:14,border:`1.5px solid ${regCol}30`,background:regCol+"07",padding:"16px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:12}}>
              <div>
                <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",marginBottom:4}}>SECTOR LEADERSHIP</div>
                <div style={mono(20, rotCol, 800)}>{rotation}</div>
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>REGIME</div>
                  <div style={mono(14, regCol, 700)}>{mappedRegime}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>BREADTH</div>
                  <div style={mono(14, breadthR >= 0.7 ? C.grn : breadthR < 0.4 ? C.red : C.amb, 700)}>{advancing}/{cached.length}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>AVG 1D</div>
                  <div style={mono(14, avgChg >= 0 ? C.grn : C.red, 700)}>{avgChg >= 0 ? "+" : ""}{avgChg.toFixed(2)}%</div>
                </div>
              </div>
            </div>
            {/* Category breakdown */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              <div style={{padding:"8px 10px",borderRadius:8,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>CYCLICALS</div>
                <div style={mono(13, cycAvg >= 0 ? C.grn : C.red, 700)}>{cycAvg >= 0 ? "+" : ""}{cycAvg.toFixed(2)}%</div>
              </div>
              <div style={{padding:"8px 10px",borderRadius:8,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>DEFENSIVES</div>
                <div style={mono(13, defAvg >= 0 ? C.grn : C.red, 700)}>{defAvg >= 0 ? "+" : ""}{defAvg.toFixed(2)}%</div>
              </div>
              <div style={{padding:"8px 10px",borderRadius:8,background:C.dim,textAlign:"center"}}>
                <div style={{...mono(8,C.mut,600),letterSpacing:"0.08em"}}>GROWTH</div>
                <div style={mono(13, groAvg >= 0 ? C.grn : C.red, 700)}>{groAvg >= 0 ? "+" : ""}{groAvg.toFixed(2)}%</div>
              </div>
            </div>
          </div>
        );
      })()}

      {loadingOv&&(
        <Card><div style={{...mono(11,C.mut),padding:"30px 0",textAlign:"center",display:"flex",gap:8,alignItems:"center",justifyContent:"center"}}><RefreshCw size={13}/>Loading sector data…</div></Card>
      )}
      {err&&!loadingOv&&<Card><div style={{...mono(10,C.red)}}>{err}</div></Card>}

      {/* Sector cards */}
      {summaries&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {summaries.map(s=>{
            const col=s.color||C.mut;
            return (
              <div key={s.sector} onClick={()=>handleSectorClick(s.sector)}
                style={{borderRadius:14,background:C.surf,border:`1px solid ${C.bdr}`,borderLeft:`3px solid ${col}`,padding:"14px 16px",cursor:"pointer",transition:"background .15s, border-color .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background=col+"08";e.currentTarget.style.borderLeftColor=col;}}
                onMouseLeave={e=>{e.currentTarget.style.background=C.surf;e.currentTarget.style.borderLeftColor=col;}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={mono(12,col,700)}>{s.sector}</span>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    {job?.status==="running" && (
                      <RefreshCw size={11} style={{color:col,animation:"spin 1s linear infinite",opacity:0.8}}/>
                    )}
                    <Tag color={col}>{s.etf}</Tag>
                  </div>
                </div>
                {(!s.cached || (s.total_market_cap == null || s.total_market_cap <= 0) && (s.etf_price == null || s.etf_price <= 0))?(
                  <div style={{...mono(10,C.mut),padding:"12px 0",textAlign:"center",borderTop:`1px solid ${C.bdr}`}}>
                    <div style={{marginBottom:8}}>{s.cached ? "Data stale — refresh needed" : "No data cached"}</div>
                    <button onClick={e=>{e.stopPropagation();triggerRefresh([s.sector]);}}
                      style={{...mono(9,col,700),padding:"4px 12px",borderRadius:6,background:col+"15",border:`1px solid ${col}30`,cursor:"pointer"}}>
                      {s.cached ? "Refresh" : "Fetch Now"}
                    </button>
                  </div>
                ):(
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      {s.etf_price!=null&&<span style={mono(17,C.headingTxt,800)}>${s.etf_price.toFixed(2)}</span>}
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {s.etf_change_1d!=null&&<Tag color={cc(s.etf_change_1d)}>{fp(s.etf_change_1d)}</Tag>}
                        {s.etf_change_ytd!=null&&<Tag color={cc(s.etf_change_ytd)}>YTD {fp(s.etf_change_ytd)}</Tag>}
                      </div>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={mono(9,C.mut)}>Cap: <span style={mono(9,C.txt,700)}>{fbn(s.total_market_cap)}</span></span>
                      {s.breadth_up!=null&&(
                        <span style={mono(9,C.mut)}><span style={mono(9,C.grn,700)}>{s.breadth_up}↑</span>&nbsp;/&nbsp;<span style={mono(9,C.red,700)}>{s.breadth_down}↓</span></span>
                      )}
                    </div>
                    {s.breadth_up!=null&&s.breadth_down!=null&&(()=>{
                      const total=s.breadth_up+s.breadth_down;
                      const upPct=total>0?s.breadth_up/total*100:50;
                      return (
                        <div style={{height:4,borderRadius:2,overflow:"hidden",display:"flex",marginBottom:10,background:C.red+"40"}}>
                          <div style={{width:`${upPct}%`,background:C.grn,borderRadius:2}}/>
                        </div>
                      );
                    })()}
                    {s.leaders?.length>0&&(
                      <div style={{marginBottom:6}}>
                        <div style={{...mono(7,C.grn,700),letterSpacing:".1em",marginBottom:3}}>TOP NAMES</div>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          {s.leaders.map(l=>(
                            <span key={l.symbol} style={{...mono(9,C.grn),background:C.grn+"10",padding:"2px 6px",borderRadius:5,border:`1px solid ${C.grn}25`}}>
                              {l.symbol} {l.chg!=null?fp(l.chg):""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.laggards?.length>0&&(
                      <div style={{marginBottom:8}}>
                        <div style={{...mono(7,C.red,700),letterSpacing:".1em",marginBottom:3}}>LAGGARDS</div>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          {s.laggards.map(l=>(
                            <span key={l.symbol} style={{...mono(9,C.red),background:C.red+"10",padding:"2px 6px",borderRadius:5,border:`1px solid ${C.red}25`}}>
                              {l.symbol} {l.chg!=null?fp(l.chg):""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(s.undervalued?.length>0||s.overvalued?.length>0)&&(
                      <div style={{borderTop:`1px solid ${C.bdr}`,paddingTop:8}}>
                        {s.undervalued?.length>0&&(
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                            <span style={mono(7,C.grn,700)}>VALUE:</span>
                            {s.undervalued.map(sym=>(<span key={sym} style={{...mono(8,C.grn),background:C.grn+"10",padding:"1px 5px",borderRadius:4}}>{sym}</span>))}
                          </div>
                        )}
                        {s.overvalued?.length>0&&(
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                            <span style={mono(7,C.red,700)}>RICH:</span>
                            {s.overvalued.map(sym=>(<span key={sym} style={{...mono(8,C.red),background:C.red+"10",padding:"1px 5px",borderRadius:4}}>{sym}</span>))}
                          </div>
                        )}
                      </div>
                    )}
                    {s.snapshot_at&&<div style={{...mono(7,C.mut),marginTop:8,textAlign:"right"}}>{String(s.snapshot_at).slice(0,16)}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {summaries&&summaries.every(s=>!s.cached)&&!loadingOv&&(
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"16px 0",marginBottom:12}}>
            No sector data cached yet. Fetch all 11 sectors to populate the dashboard.
          </div>
          <div style={{textAlign:"center"}}>
            <button onClick={()=>triggerRefresh()}
              style={{...mono(12,C.grn,700),padding:"10px 24px",borderRadius:10,background:C.grnBg,border:`1px solid ${C.grn}40`,cursor:"pointer"}}>
              ↓ Fetch All 11 Sectors
            </button>
            <div style={{...mono(9,C.mut),marginTop:8}}>~2–3 min · 165 tickers · Runs in background</div>
          </div>
        </Card>
      )}
    </div>
  );

  // ── inner helper ─────────────────────────────────────────
  function handleSectorClick(sector) {
    setActiveSector(sector);
    setActiveTicker(null);
    setTickerData(null);
    fetchSector(sector);
  }
}

// ── App ─────────────────────────────────────────────────
const NAV=[
  {id:"markets",   l:"Markets",   I:BarChart2},   // Overview + News
  {id:"advisor",   l:"Fundamentals",  I:Compass},
  {id:"macro",     l:"Macro",     I:Database},
  {id:"sectors",   l:"Sectors",   I:Layers},
  {id:"options",   l:"Options",   I:Activity},
  {id:"technical", l:"Technical", I:TrendingUp},
  {id:"signals",   l:"Quant",     I:Zap},
  {id:"pairs",     l:"Pairs",     I:Shuffle},
  {id:"portfolio", l:"Portfolio", I:Briefcase},   // Holdings + Optimizer
  {id:"paper",     l:"Paper",     I:BookOpen},    // Paper trading
  {id:"lab",       l:"Lab",       I:FlaskConical},// Backtest + Report + Stochastic
];

// ─────────────────────────────────────────────────────────────────────────────
// MACRO DETAIL VIEW — constants & component
// ─────────────────────────────────────────────────────────────────────────────

const CAT_COLORS = {
  crisis:       "#ff5252",
  policy:       "#40c4ff",
  political:    "#ffb300",
  geopolitical: "#ff8a65",
  macro:        "#b388ff",
};

const MARKET_EVENTS = [
  // ── 2020 ──
  {date:"2020-02-20",label:"COVID Crash Begins",    desc:"Global pandemic accelerates. S&P 500 enters fastest bear market in history, falling 34% in 33 days.",cat:"crisis",       highlight:true},
  {date:"2020-03-15",label:"Fed → 0% + QE∞",       desc:"Fed emergency cuts to 0–0.25% and launches unlimited QE ($3T+ balance-sheet expansion). Trough 8 days later.",cat:"policy",highlight:true},
  {date:"2020-03-23",label:"COVID Market Bottom",   desc:"S&P 500 hits pandemic low (2,191). Fed unlimited QE pledge triggers the fastest recovery bull market ever.",cat:"macro",      highlight:false},
  {date:"2020-11-07",label:"Biden Elected",         desc:"Biden projected president. Markets rally on divided-government expectations. Dollar weakens.",cat:"political",               highlight:false},
  {date:"2020-11-09",label:"Vaccine Monday",        desc:"Pfizer/BioNTech 90%+ efficacy. Biggest single-day rotation in decades: Cyclicals +10%, Growth -3%.",cat:"macro",           highlight:false},
  // ── 2021 ──
  {date:"2021-01-27",label:"GameStop Squeeze",      desc:"Retail-driven short squeeze in GME/AMC. Robinhood halts trading. VIX spikes on market-structure fears.",cat:"macro",        highlight:false},
  {date:"2021-11-03",label:"Fed Announces Taper",   desc:"Fed announces QE taper. Beginning of the end of post-COVID liquidity era. 10Y yield begins multi-year rise.",cat:"policy",  highlight:false},
  {date:"2021-11-22",label:"Nasdaq Peak",           desc:"QQQ peaks at 403. Rising rates + taper signal trigger 33% peak-to-trough bear market in growth stocks.",cat:"macro",        highlight:false},
  // ── 2022 ──
  {date:"2022-02-24",label:"Russia Invades Ukraine",desc:"Full-scale invasion. Oil +8%, Gold +2%, VIX spikes. Global supply chain and energy shock.",cat:"geopolitical",              highlight:true},
  {date:"2022-03-16",label:"Fed First Rate Hike",   desc:"First hike since 2018 (+25bps). Beginning of fastest tightening cycle in 40 years — 525bps in 16 months.",cat:"policy",    highlight:true},
  {date:"2022-06-10",label:"CPI 9.1% — 40-Year High",desc:"US CPI peaks at highest since 1981. Dollar surges to 20-year high. Bond markets crash globally.",cat:"macro",             highlight:true},
  {date:"2022-06-15",label:"Fed Hikes +75bps",      desc:"Largest single hike since 1994. S&P 500 enters official bear market (-22%). Dollar DXY breaks 105.",cat:"policy",          highlight:false},
  {date:"2022-09-27",label:"UK Gilt Crisis",        desc:"UK unfunded 'mini-budget' triggers gilt/sterling collapse. BOE emergency bond buying. Global contagion fear.",cat:"geopolitical",highlight:false},
  {date:"2022-10-13",label:"Bear Market Low",       desc:"S&P 500 intraday low at 3,491 (-27%). Softer-than-expected CPI triggers massive reversal and new bull.",cat:"macro",        highlight:false},
  // ── 2023 ──
  {date:"2023-03-10",label:"SVB Collapses",         desc:"Silicon Valley Bank fails — 2nd largest US bank failure in history. Regional banking contagion. Fed creates BTFP.",cat:"crisis",highlight:true},
  {date:"2023-05-01",label:"First Republic Fails",  desc:"3rd major bank failure in 2 months. FDIC/JPMorgan deal. Banking sector stress peaks.",cat:"crisis",                          highlight:false},
  {date:"2023-07-26",label:"Fed Peaks at 5.25%",    desc:"Final rate hike. Fed funds at 5.25–5.50%, highest since 2001. Prolonged pause begins.",cat:"policy",                        highlight:false},
  {date:"2023-08-01",label:"Fitch Downgrades US",   desc:"Fitch cuts US credit rating from AAA to AA+. 10Y yield spikes. Equity volatility.",cat:"macro",                            highlight:false},
  {date:"2023-10-07",label:"Hamas Attacks Israel",  desc:"Hamas attacks trigger Middle East conflict. Gold +1%, Oil +5%, defence stocks surge.",cat:"geopolitical",                    highlight:false},
  {date:"2023-10-23",label:"10Y Yield Hits 5%",     desc:"10Y Treasury reaches 5% for first time since 2007. S&P 500 -10% correction. 30-year mortgage near 8%.",cat:"macro",       highlight:false},
  // ── 2024 ──
  {date:"2024-04-14",label:"Iran-Israel Escalation",desc:"Iran launches first-ever direct missile + drone attack on Israel. Gold +1%, Oil +3%, VIX spikes briefly.",cat:"geopolitical",highlight:false},
  {date:"2024-07-11",label:"CPI Surprise Miss",     desc:"Softer CPI triggers massive growth-to-value rotation. Small-caps (IWM) surge +10% in 5 days.",cat:"macro",                highlight:false},
  {date:"2024-08-05",label:"JPY Carry Unwind",      desc:"BOJ surprise hike triggers yen carry liquidation. VIX spikes to 65 (post-COVID high). Nikkei -13% in one day.",cat:"crisis",highlight:true},
  {date:"2024-09-18",label:"Fed First Cut −50bps",  desc:"Fed begins easing cycle with outsized -50bps cut. Soft landing narrative strengthens.",cat:"policy",                         highlight:true},
  {date:"2024-11-06",label:"Trump Elected",         desc:"Trump wins 47th presidency. Dollar +1.6% (largest post-election surge ever). Crypto surges. Tariff stocks rally.",cat:"political",highlight:true},
  // ── 2025 ──
  {date:"2025-01-20",label:"Trump Inaugurated",     desc:"Day-1 executive orders on immigration, energy, and border. Tariff threats against Canada, Mexico, China formalised.",cat:"political",highlight:false},
  {date:"2025-01-27",label:"DeepSeek Shock",        desc:"Chinese AI DeepSeek claims GPT-4 level at 1/100th cost. NVDA -17% in single day. ~$600B market cap erased.",cat:"macro",   highlight:true},
  {date:"2025-02-01",label:"Tariff War Escalates",  desc:"25% tariffs on Canada/Mexico, 10% on China. Retaliation follows. VIX spikes. Supply chain repricing.",cat:"geopolitical",   highlight:true},
];

const COMPANY_NAMES = {
  // Technology
  "AAPL":"Apple","MSFT":"Microsoft","NVDA":"NVIDIA","AVGO":"Broadcom","ORCL":"Oracle",
  "AMD":"Advanced Micro Devices","QCOM":"Qualcomm","TXN":"Texas Instruments","AMAT":"Applied Materials",
  "MU":"Micron Technology","LRCX":"Lam Research","KLAC":"KLA Corp","ADI":"Analog Devices",
  "MCHP":"Microchip Technology","CDNS":"Cadence Design","SNPS":"Synopsys","FTNT":"Fortinet",
  "PANW":"Palo Alto Networks","CRWD":"CrowdStrike","INTC":"Intel","IBM":"IBM","HPE":"HP Enterprise",
  "HPQ":"HP Inc","ACN":"Accenture","INFY":"Infosys","WIT":"Wipro","IT":"Gartner","EPAM":"EPAM Systems",
  "CTSH":"Cognizant","GLW":"Corning","STX":"Seagate Technology","WDC":"Western Digital",
  "KEYS":"Keysight Technologies","JNPR":"Juniper Networks","NTAP":"NetApp","ZBRA":"Zebra Technologies",
  // Communication Services
  "META":"Meta Platforms","GOOGL":"Alphabet","GOOG":"Alphabet","NFLX":"Netflix","DIS":"Walt Disney",
  "CMCSA":"Comcast","T":"AT&T","VZ":"Verizon","TMUS":"T-Mobile","CHTR":"Charter Communications",
  "SNAP":"Snap","PINS":"Pinterest","RDDT":"Reddit","SPOT":"Spotify","MTCH":"Match Group",
  "WBD":"Warner Bros Discovery","FOX":"Fox Corp","FOXA":"Fox Corp A","NWS":"News Corp",
  "NWSA":"News Corp A","IPG":"Interpublic Group","OMC":"Omnicom Group","ZM":"Zoom Video",
  // Consumer Discretionary
  "AMZN":"Amazon","TSLA":"Tesla","HD":"Home Depot","MCD":"McDonald's","NKE":"Nike","SBUX":"Starbucks",
  "TGT":"Target","LOW":"Lowe's","CMG":"Chipotle","BKNG":"Booking Holdings","ABNB":"Airbnb",
  "MAR":"Marriott International","HLT":"Hilton Worldwide","MGM":"MGM Resorts","LVS":"Las Vegas Sands",
  "WYNN":"Wynn Resorts","F":"Ford Motor","GM":"General Motors","RIVN":"Rivian Automotive",
  "LCID":"Lucid Group","TM":"Toyota Motor","HMC":"Honda Motor","RACE":"Ferrari","DHI":"D.R. Horton",
  "LEN":"Lennar","PHM":"PulteGroup","NVR":"NVR Inc","TOL":"Toll Brothers","ROST":"Ross Stores",
  "TJX":"TJX Companies","ULTA":"Ulta Beauty","BBY":"Best Buy","DG":"Dollar General",
  "DLTR":"Dollar Tree","AMZN":"Amazon","EBAY":"eBay","ETSY":"Etsy","W":"Wayfair",
  "CHWY":"Chewy","DKNG":"DraftKings","PENN":"Penn Entertainment","CZR":"Caesars Entertainment",
  "HAS":"Hasbro","MAT":"Mattel","NWL":"Newell Brands","WHR":"Whirlpool","LEG":"Leggett & Platt",
  // Consumer Staples
  "WMT":"Walmart","COST":"Costco","PG":"Procter & Gamble","KO":"Coca-Cola","PEP":"PepsiCo",
  "PM":"Philip Morris","MO":"Altria Group","CL":"Colgate-Palmolive","EL":"Estée Lauder",
  "KMB":"Kimberly-Clark","CHD":"Church & Dwight","CLX":"Clorox","SJM":"J.M. Smucker",
  "CAG":"Conagra Brands","MKC":"McCormick","GIS":"General Mills","K":"Kellogg","HRL":"Hormel Foods",
  "TSN":"Tyson Foods","STZ":"Constellation Brands","BF.B":"Brown-Forman","DEO":"Diageo",
  "MDLZ":"Mondelēz International","HSY":"Hershey","CPB":"Campbell Soup","KR":"Kroger",
  "SFM":"Sprouts Farmers Market","GO":"Grocery Outlet","ACI":"Albertsons","CASY":"Casey's General Stores",
  // Healthcare
  "LLY":"Eli Lilly","JNJ":"Johnson & Johnson","UNH":"UnitedHealth Group","ABBV":"AbbVie",
  "MRK":"Merck","PFE":"Pfizer","AMGN":"Amgen","BMY":"Bristol-Myers Squibb","GILD":"Gilead Sciences",
  "CVS":"CVS Health","CI":"Cigna","HUM":"Humana","CNC":"Centene","MOH":"Molina Healthcare",
  "ELV":"Elevance Health","MDT":"Medtronic","ABT":"Abbott Laboratories","DHR":"Danaher",
  "SYK":"Stryker","ISRG":"Intuitive Surgical","EW":"Edwards Lifesciences","BSX":"Boston Scientific",
  "BAX":"Baxter International","BDX":"Becton Dickinson","ZBH":"Zimmer Biomet","HOLX":"Hologic",
  "INCY":"Incyte","REGN":"Regeneron Pharmaceuticals","VRTX":"Vertex Pharmaceuticals",
  "BIIB":"Biogen","MRNA":"Moderna","BNTX":"BioNTech","NVAX":"Novavax","SRPT":"Sarepta Therapeutics",
  "ALNY":"Alnylam Pharmaceuticals","BLUE":"bluebird bio","EDIT":"Editas Medicine",
  "FATE":"Fate Therapeutics","NTLA":"Intellia Therapeutics","CAH":"Cardinal Health",
  "MCK":"McKesson","ABC":"AmerisourceBergen","PDCO":"Patterson Companies","HSIC":"Henry Schein",
  // Financials
  "BRK.B":"Berkshire Hathaway","JPM":"JPMorgan Chase","BAC":"Bank of America","WFC":"Wells Fargo",
  "GS":"Goldman Sachs","MS":"Morgan Stanley","C":"Citigroup","USB":"U.S. Bancorp",
  "TFC":"Truist Financial","PNC":"PNC Financial","COF":"Capital One","AXP":"American Express",
  "MA":"Mastercard","V":"Visa","PYPL":"PayPal","SQ":"Block Inc","FIS":"Fidelity National Info",
  "FI":"Fiserv","GPN":"Global Payments","AFRM":"Affirm","UPST":"Upstart","LC":"LendingClub",
  "SOFI":"SoFi Technologies","BLK":"BlackRock","SCHW":"Charles Schwab","ICE":"Intercontinental Exchange",
  "CME":"CME Group","CBOE":"Cboe Global Markets","MKTX":"MarketAxess","IBKR":"Interactive Brokers",
  "MET":"MetLife","PRU":"Prudential Financial","ALL":"Allstate","TRV":"Travelers Companies",
  "PGR":"Progressive","CB":"Chubb","AIG":"American International Group","MMC":"Marsh & McLennan",
  "AON":"Aon","WTW":"Willis Towers Watson","AFL":"Aflac","GL":"Globe Life","CINF":"Cincinnati Financial",
  "RE":"Everest Group","RNR":"RenaissanceRe","ACGL":"Arch Capital","AJG":"Arthur J. Gallagher",
  // Industrials
  "GE":"GE Aerospace","CAT":"Caterpillar","HON":"Honeywell","UPS":"UPS","DE":"Deere & Company",
  "LMT":"Lockheed Martin","RTX":"Raytheon Technologies","NOC":"Northrop Grumman","GD":"General Dynamics",
  "BA":"Boeing","HII":"Huntington Ingalls","L3H":"L3Harris Technologies","TXT":"Textron",
  "MMM":"3M","EMR":"Emerson Electric","ETN":"Eaton","ROK":"Rockwell Automation","PH":"Parker Hannifin",
  "ITW":"Illinois Tool Works","DOV":"Dover","AME":"Ametek","HUBB":"Hubbell","ROP":"Roper Technologies",
  "FTV":"Fortive","GNRC":"Generac Holdings","AOS":"A.O. Smith","XYL":"Xylem","IDEX":"IDEX Corp",
  "GGG":"Graco","MIDD":"Middleby","CFX":"Colfax","NDSN":"Nordson","TT":"Trane Technologies",
  "JCI":"Johnson Controls","CSX":"CSX","NSC":"Norfolk Southern","UNP":"Union Pacific","KNX":"Knight-Swift",
  "ODFL":"Old Dominion Freight","JBHT":"J.B. Hunt Transport","CHRW":"C.H. Robinson","XPO":"XPO Logistics",
  "UBER":"Uber","LYFT":"Lyft","DASH":"DoorDash","FDX":"FedEx","DAL":"Delta Air Lines",
  "UAL":"United Airlines","AAL":"American Airlines","LUV":"Southwest Airlines","ALK":"Alaska Air Group",
  "JBLU":"JetBlue","CCL":"Carnival","RCL":"Royal Caribbean","NCLH":"Norwegian Cruise Line",
  "WM":"Waste Management","RSG":"Republic Services","CTAS":"Cintas","FAST":"Fastenal",
  "GWW":"W.W. Grainger","MSC":"MSC Industrial Direct","ADP":"ADP","PAYX":"Paychex",
  "MAN":"ManpowerGroup","KFY":"Korn Ferry","RHI":"Robert Half","EXPO":"Exponent",
  // Energy
  "XOM":"ExxonMobil","CVX":"Chevron","COP":"ConocoPhillips","SLB":"Schlumberger","HAL":"Halliburton",
  "BKR":"Baker Hughes","EOG":"EOG Resources","OXY":"Occidental Petroleum","DVN":"Devon Energy",
  "FANG":"Diamondback Energy","MPC":"Marathon Petroleum","PSX":"Phillips 66","VLO":"Valero Energy",
  "PXD":"Pioneer Natural Resources","HES":"Hess","APA":"APA Corp","MRO":"Marathon Oil",
  "CTRA":"Coterra Energy","EQT":"EQT Corp","AR":"Antero Resources","CRK":"Comstock Resources",
  "RRC":"Range Resources","SWN":"SouthWestern Energy","CHK":"Chesapeake Energy","GPOR":"Gulfport Energy",
  "LNG":"Cheniere Energy","OKE":"ONEOK","KMI":"Kinder Morgan","WMB":"Williams Companies",
  "EPD":"Enterprise Products Partners","ET":"Energy Transfer","MPLX":"MPLX LP","PAA":"Plains All American",
  "NEE":"NextEra Energy","DUK":"Duke Energy","SO":"Southern Company","D":"Dominion Energy",
  "AEP":"American Electric Power","EXC":"Exelon","XEL":"Xcel Energy","SRE":"Sempra",
  "PEG":"Public Service Enterprise Group","PCG":"PG&E","ED":"Consolidated Edison",
  "ETR":"Entergy","FE":"FirstEnergy","PPL":"PPL Corp","WEC":"WEC Energy","CMS":"CMS Energy",
  // Materials
  "LIN":"Linde","APD":"Air Products","SHW":"Sherwin-Williams","ECL":"Ecolab","DD":"DuPont",
  "DOW":"Dow Inc","LYB":"LyondellBasell","EMN":"Eastman Chemical","CE":"Celanese",
  "ALB":"Albemarle","FMC":"FMC Corp","IFF":"International Flavors & Fragrances","MOS":"Mosaic",
  "CF":"CF Industries","NUE":"Nucor","STLD":"Steel Dynamics","RS":"Reliance Steel","CLF":"Cleveland-Cliffs",
  "X":"U.S. Steel","AA":"Alcoa","NEM":"Newmont","AEM":"Agnico Eagle Mines","GOLD":"Barrick Gold",
  "KGC":"Kinross Gold","HL":"Hecla Mining","CDE":"Coeur Mining","WPM":"Wheaton Precious Metals",
  "FCX":"Freeport-McMoRan","TECK":"Teck Resources","IP":"International Paper","PKG":"Packaging Corp",
  "SEE":"Sealed Air","BALL":"Ball Corp","CCK":"Crown Holdings","OI":"O-I Glass",
  // Real Estate
  "AMT":"American Tower","PLD":"Prologis","CCI":"Crown Castle","EQIX":"Equinix","PSA":"Public Storage",
  "O":"Realty Income","SPG":"Simon Property Group","EQR":"Equity Residential","AVB":"AvalonBay",
  "VTR":"Ventas","WELL":"Welltower","PEAK":"Healthpeak Properties","ARE":"Alexandria Real Estate",
  "BXP":"Boston Properties","KIM":"Kimco Realty","REG":"Regency Centers","FRT":"Federal Realty",
  "MAA":"Mid-America Apartment","CPT":"Camden Property Trust","NNN":"NNN REIT",
  "VICI":"VICI Properties","GLPI":"Gaming and Leisure Properties","SBAC":"SBA Communications",
  "INVH":"Invitation Homes","AMH":"American Homes 4 Rent","ELS":"Equity LifeStyle Properties",
  "SUI":"Sun Communities","UDR":"UDR Inc","ESS":"Essex Property Trust","NLY":"Annaly Capital",
  "AGNC":"AGNC Investment","DX":"Dynex Capital","TWO":"Two Harbors","IVR":"Invesco Mortgage",
  // Utilities
  "AES":"AES Corp","AWK":"American Water Works","WTR":"Artesian Resources","SJW":"SJW Group",
  "MSEX":"Middlesex Water","AWR":"American States Water","YORW":"York Water",
  // Misc large-caps
  "COIN":"Coinbase","HOOD":"Robinhood","RBLX":"Roblox","U":"Unity Software","EA":"Electronic Arts",
  "TTWO":"Take-Two Interactive","ATVI":"Activision Blizzard","NTES":"NetEase","SE":"Sea Limited",
  "GRAB":"Grab Holdings","MELI":"MercadoLibre","NU":"Nu Holdings","STNE":"StoneCo",
  "PAGS":"PagSeguro","DESP":"Despegar.com","LREN3":"Lojas Renner","VALE":"Vale",
  "BBD":"Banco Bradesco","ITUB":"Itaú Unibanco","BIDU":"Baidu","JD":"JD.com","PDD":"PDD Holdings",
  "BABA":"Alibaba","NIO":"NIO Inc","LI":"Li Auto","XPEV":"XPeng","BYD":"BYD Company",
  "PLTR":"Palantir","SNOW":"Snowflake","DDOG":"Datadog","NET":"Cloudflare","ZS":"Zscaler",
  "OKTA":"Okta","MDB":"MongoDB","CFLT":"Confluent","ESTC":"Elastic","HUBS":"HubSpot",
  "CRM":"Salesforce","NOW":"ServiceNow","WDAY":"Workday","ADSK":"Autodesk","ANSS":"ANSYS",
  "PTC":"PTC Inc","VEEV":"Veeva Systems","PCTY":"Paylocity","PAYC":"Paycom","SMAR":"Smartsheet",
  "APPN":"Appian","COUP":"Coupa Software","GWRE":"Guidewire","NUAN":"Nuance Communications",
  "TTD":"The Trade Desk","DV":"DoubleVerify","MGNI":"Magnite","APP":"AppLovin","IRONSRC":"ironSource",
  "ADBE":"Adobe","INTU":"Intuit","ANGI":"Angi Inc","IAC":"IAC Inc","TRIP":"TripAdvisor",
  "VRSK":"Verisk Analytics","CSGP":"CoStar Group","ZILW":"Zillow","Z":"Zillow Group",
  "RDFN":"Redfin","OPEN":"Opendoor","EXPI":"eXp World Holdings","COMP":"Compass Inc",
  "DOCU":"DocuSign","DBX":"Dropbox","BOX":"Box Inc","BAND":"Bandwidth","TWLO":"Twilio",
  "FSLY":"Fastly","AKAM":"Akamai","EIGI":"Endurance International","GCI":"Gannett",
  "MSTR":"MicroStrategy","RIOT":"Riot Platforms",
  "MARA":"Marathon Digital","HUT":"Hut 8 Mining","CIFR":"Cipher Mining","BTBT":"Bit Digital",
};

const TICKER_META = {
  "SPY": {name:"SPDR S&P 500 ETF",              col:"#00e676",
    desc:"Tracks 500 largest US companies by market cap — the primary equity benchmark. Driven equally by earnings growth and multiple expansion. When rates rise, multiples compress."},
  "QQQ": {name:"Invesco Nasdaq 100 ETF",         col:"#00e676",
    desc:"Nasdaq 100 — 100 largest non-financial Nasdaq stocks, ~50% technology (AAPL, MSFT, NVDA, META, GOOGL). Most rate-sensitive of the major indices."},
  "IWM": {name:"iShares Russell 2000 ETF",       col:"#00e676",
    desc:"2,000 US small-cap stocks. More sensitive to domestic growth, credit conditions, and USD strength than large-caps. Typically leads recoveries and signals late-cycle stress early."},
  "DIA": {name:"SPDR Dow Jones ETF",              col:"#00e676",
    desc:"30 blue-chip industrials — price-weighted (Boeing counts more than Apple). Most value and cyclical of the major indices. Good proxy for 'old economy' health."},
  "^VIX":{name:"CBOE Volatility Index",           col:"#ff5252", unit:"%",
    desc:"30-day implied volatility derived from S&P 500 options. Called the 'Fear Index'. <15 = complacency; >20 = fear; >30 = panic. Spikes are typically short-lived and mean-reverting."},
  "^TNX":{name:"10-Year Treasury Note Yield",     col:"#40c4ff", unit:"%",
    desc:"The most-watched interest rate in the world — the risk-free rate against which all assets are priced. Rising yield = tighter financial conditions, lower equity multiples, stronger dollar."},
  "^IRX":{name:"3-Month T-Bill Yield",            col:"#b388ff", unit:"%",
    desc:"Short-term risk-free rate reflecting near-term Fed funds expectations. When 3M > 10Y (inverted curve), historical US recession probability rises sharply within 12–18 months."},
  "HYG": {name:"iShares High Yield Bond ETF",     col:"#ffb300",
    desc:"Tracks US high-yield (junk) bonds. Falls faster than LQD in risk-off environments. HYG underperforming LQD signals credit spread widening — an early warning of stress."},
  "LQD": {name:"iShares Invest.-Grade Bond ETF",  col:"#40c4ff",
    desc:"Tracks US investment-grade corporate bonds. More sensitive to duration (rate risk) than HYG. A benchmark for corporate credit quality and the cost of borrowing."},
  "GLD": {name:"SPDR Gold Trust",                 col:"#ffb300",
    desc:"Tracks gold spot price. Classic flight-to-safety asset inversely correlated with real yields and the dollar. Outperforms during crises, inflation surprises, and dollar weakness."},
  "USO": {name:"United States Oil Fund (WTI)",    col:"#ff8a65",
    desc:"Tracks WTI crude oil futures. Proxy for global growth demand and inflationary pressure. Energy sector earnings, transport costs, and headline CPI all follow crude oil closely."},
  "COPX":{name:"Global X Copper Miners ETF",      col:"#ff8a65",
    desc:"'Dr. Copper' — copper demand mirrors industrial output and global trade. A leading indicator of economic health. Major structural driver: China manufacturing and EV battery demand."},
  "UUP": {name:"Invesco DB US Dollar Fund (DXY)", col:"#40c4ff",
    desc:"Tracks DXY — a trade-weighted USD basket vs 6 currencies. Dollar strength = risk-off signal, headwind for EM assets, commodities, and US multinational earnings."},
};

// ── MacroDetailView summary generator ────────────────────────────────────────
function generateMarketSummary(sym, meta, last, ret3m, ret6m, ret9m, ret12m, hi52, lo52, vol1y, isYield) {
  if (last == null) return null;
  const fmtR = r => r == null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`;
  const fmtP = v => v == null ? "—" : isYield
    ? `${v.toFixed(2)}%`
    : `$${v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Position within 52W range
  let rangePos = "mid-range";
  if (hi52 != null && lo52 != null) {
    const range = hi52 - lo52;
    const pos = range > 0 ? (last - lo52) / range : 0.5;
    if (pos > 0.85)      rangePos = "near its 52-week highs";
    else if (pos < 0.15) rangePos = "near its 52-week lows";
    else if (pos > 0.6)  rangePos = "in the upper half of its 52-week range";
    else                 rangePos = "in the lower half of its 52-week range";
  }

  // Momentum: compare recent 3M pace to 12M average pace
  let momentumNote = "";
  if (ret3m != null && ret12m != null) {
    const annualised3m = ret3m * 4;
    if (annualised3m > ret12m + 12 && ret3m > 0)       momentumNote = " Momentum is accelerating — the most recent quarter is outpacing the 12-month trend, suggesting the move is gaining strength.";
    else if (annualised3m < ret12m - 12 && ret12m > 0)  momentumNote = " However, near-term momentum is fading relative to the prior year, which may signal a consolidation phase ahead.";
    else if (ret3m > 0 && ret12m < 0)                   momentumNote = " Notably, the 3-month trend has turned positive despite a negative 12-month backdrop — a potential early inflection point worth monitoring.";
    else if (ret3m < 0 && ret12m > 0)                   momentumNote = " Caution: the 3-month trend has rolled over despite a positive 12-month picture, suggesting a possible short-term correction underway.";
  }

  // Paragraph 1 — factual trend narrative
  let p1 = `${meta.name} (${sym}) is currently ${rangePos} at ${fmtP(last)}`;
  if (ret12m != null) p1 += `, ${ret12m >= 0 ? "up" : "down"} ${fmtR(Math.abs(ret12m))} over the trailing 12 months`;
  p1 += ". ";
  if (ret3m != null && ret6m != null && ret9m != null) {
    p1 += `Breaking down by period: 3-month ${fmtR(ret3m)} · 6-month ${fmtR(ret6m)} · 9-month ${fmtR(ret9m)} · 12-month ${fmtR(ret12m)}.`;
    p1 += momentumNote;
  }

  // Paragraph 2 — asset-specific conclusion
  let p2 = "";
  if (sym === "^TNX") {
    if (last > 4.5) p2 = "At current levels, 10-year yields remain elevated by post-2008 standards. This sustains pressure on equity valuations — each 10bps rise in the risk-free rate mechanically reduces the present value of future earnings. Mortgage rates stay high, weighing on housing. The path lower requires either a clear inflation reversal or a growth scare that forces the Fed's hand.";
    else if (last > 4.0) p2 = "Yields in the 4–4.5% range reflect the market pricing meaningful Fed uncertainty — neither fully hawkish nor dovish. Financial conditions remain moderately tight. Equity multiples are compressed relative to the 2020–21 zero-rate era, but not extreme. Watch the 3M/10Y spread: if still inverted, the recession clock is ticking.";
    else p2 = "A yield below 4% signals a meaningful shift toward easier financial conditions, typically supportive for rate-sensitive equities, growth stocks, and housing. The question is whether the move reflects a soft landing or a harder growth scare — the distinction matters significantly for how equity markets interpret the signal.";
    if (ret3m != null) p2 += ret3m > 0.25 ? " The recent rise in yields is tightening conditions in real time." : ret3m < -0.25 ? " The recent decline in yields is providing near-term relief to risk assets." : "";
  } else if (sym === "^IRX") {
    p2 = "The 3-month T-bill yield is the market's best read on near-term Fed funds expectations. When it exceeds the 10-year yield (inverted curve), historical recession probability within 12–18 months rises sharply. ";
    if (last > 4.5) p2 += "Current short-term rates remain high, consistent with a still-restrictive Fed posture. Any pivot signal from the FOMC would compress this yield rapidly.";
    else p2 += "The current level suggests the market is beginning to price in eventual cuts, though timing remains uncertain. Monitor Fed statement language closely.";
  } else if (["SPY","QQQ","IWM","DIA"].includes(sym)) {
    const bench = sym === "QQQ" ? "Nasdaq 100" : sym === "IWM" ? "Russell 2000 small-caps" : sym === "DIA" ? "Dow blue-chips" : "S&P 500";
    if (ret12m != null && ret12m > 20) p2 = `The ${bench}'s strong 12-month run reflects a combination of earnings resilience and/or multiple expansion. At this point in the cycle, the key risk is whether valuations have run ahead of fundamentals. Watch forward P/E relative to the earnings growth rate.`;
    else if (ret12m != null && ret12m > 5) p2 = `The ${bench} has delivered solid returns over the past year — consistent with a maturing bull market. The challenge is whether earnings growth can continue to justify current multiples as interest rates stay elevated.`;
    else if (ret12m != null && ret12m < -10) p2 = `The ${bench}'s 12-month drawdown reflects either a fundamental earnings deterioration or a valuation reset driven by higher rates. Look for stabilisation in forward earnings estimates as the key signal that a base is forming.`;
    else p2 = `The ${bench}'s relatively flat 12-month return masks underlying volatility and reflects a market in equilibrium between rate pressure and earnings resilience. A decisive break in either inflation data or corporate guidance would likely resolve the range.`;
  } else if (sym === "^VIX") {
    if (last < 15) p2 = "VIX below 15 signals broad complacency. Risk assets can continue to grind higher in this environment, but tail risk is significantly underpriced. This is the environment where surprises — geopolitical, macro, or earnings — cause the largest vol spikes. Consider it a low-cost window to hedge.";
    else if (last < 20) p2 = "VIX in the 15–20 zone reflects normal market uncertainty. Not complacent, not panicked. The market is appropriately pricing near-term risk. Watch for a break above 20 as an early signal of deteriorating sentiment.";
    else if (last < 30) p2 = "VIX above 20 signals elevated fear. Participants are paying up for downside protection. Historically, elevated VIX environments precede higher forward equity returns as risk is more fairly priced, but the path there can be painful.";
    else p2 = "VIX above 30 is panic territory. These spikes are historically mean-reverting, but can persist during systemic stress. The key question is whether the shock is transitory (buy the spike) or the beginning of a regime change (stay defensive).";
  } else if (sym === "GLD") {
    if (ret12m != null && ret12m > 15) p2 = "Gold's strong run reflects a combination of real yield uncertainty, central bank accumulation, and geopolitical risk demand. The dollar relationship has loosened — gold has rallied even during periods of USD strength, suggesting structural demand from non-Western central banks diversifying away from Treasuries.";
    else p2 = "Gold's outlook hinges on three factors: real yields (inverse relationship), dollar direction (inverse), and geopolitical/safe-haven demand. A genuine Fed pivot lower or a dollar weakening cycle would be the most powerful bullish catalyst. Watch TIP (TIPS ETF) as a real-yield proxy.";
  } else if (sym === "USO") {
    if (ret12m != null && ret12m > 10) p2 = "Oil's strength signals healthy global demand or supply constraints (OPEC+ discipline, geopolitical disruptions). Sustained crude above $80 starts feeding through to headline CPI with a 4–6 week lag, complicating the Fed's inflation narrative. Energy sector earnings are directly correlated.";
    else if (ret12m != null && ret12m < -10) p2 = "Falling crude signals softening global demand, easing supply constraints, or demand destruction from prior high prices. This provides disinflationary relief to the Fed and reduces energy cost pressure on consumer spending, but also signals possible global growth weakness.";
    else p2 = "Oil at current levels reflects balanced supply/demand dynamics. The marginal driver at this point is China demand (economic recovery pace) and OPEC+ supply discipline. A Chinese demand surprise or OPEC production change would be the most likely catalysts for a directional break.";
  } else if (sym === "COPX") {
    if (ret12m != null && ret12m > 10) p2 = "'Dr. Copper' performing well is a positive global growth signal, particularly for industrial activity and China's manufacturing recovery. Structurally, the energy transition (EVs, grid infrastructure) creates a multi-year demand tailwind that sets a higher base for copper prices.";
    else p2 = "Copper's weakness is often a leading indicator of slowing global growth, particularly Chinese industrial output. Monitor PMI data from China and Germany as directional guides. Longer-term, energy transition demand provides structural support, but cyclical headwinds can overwhelm that in the near term.";
  } else if (sym === "HYG") {
    if (ret12m != null && ret12m > 5) p2 = "High-yield bonds performing well signals healthy corporate credit conditions — companies can service debt, and default rates are contained. This is a positive backdrop for equities broadly. When HYG leads equities, it typically signals genuine risk appetite rather than just momentum.";
    else if (ret12m != null && ret12m < -5) p2 = "HYG underperformance signals widening credit spreads — the market is demanding more compensation for lending to lower-quality borrowers. This is an early warning of tightening financial conditions and rising default expectations. Historically, sustained HYG weakness precedes equity market stress by 3–6 months.";
    else p2 = "High-yield spreads at moderate levels suggest neither euphoria nor stress in credit markets. Watch for spread widening (HYG falling relative to LQD) as the earliest warning signal of changing credit conditions — it typically leads equity volatility by several weeks.";
  } else if (sym === "LQD") {
    p2 = "Investment-grade corporate bonds are primarily driven by duration (interest rate sensitivity) rather than credit risk. LQD tends to fall when rates rise and rally when the Fed pivots. Compare LQD vs HYG: if LQD outperforms, it signals rate concerns driving bonds lower rather than credit concerns — a different risk entirely.";
  } else if (sym === "UUP") {
    if (ret12m != null && ret12m > 5) p2 = "Dollar strength creates tangible headwinds: US multinational earnings face FX translation losses, commodity prices fall (dollar-denominated), and EM economies with dollar-denominated debt see financial conditions tighten. It often signals US economic outperformance but can self-limit by slowing exports.";
    else if (ret12m != null && ret12m < -5) p2 = "Dollar weakness provides a meaningful tailwind: commodity prices rise, US multinationals' overseas earnings translate back favorably, and EM assets typically outperform. Watch whether this reflects genuine Fed dovishness or just a rebalancing of relative growth expectations.";
    else p2 = "The dollar's relative stability suggests balanced global macro conditions with no dominant directional catalyst. A significant shift in US vs. rest-of-world growth differentials or a surprise Fed pivot would be the most likely trigger for a sustained directional move.";
  } else {
    p2 = "Compare this performance against correlated assets to assess whether the move is asset-specific or part of a broader macro shift. Sustained divergence from historical correlations is often the most actionable signal.";
  }

  return { p1, p2 };
}

// ── MacroDetailView ─────────────────────────────────────────────────────────
function MacroDetailView({ sym, onBack }) {
  const C        = useC();
  const [allData, setAllData]     = useState([]);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  useEffect(() => {
    setLoading(true); setError(null); setAllData([]); setChartData([]);
    fetch(`/api/market/price/${encodeURIComponent(sym)}?period=5y`)
      .then(r => r.ok ? r.json() : Promise.reject("No data returned for " + sym))
      .then(d => {
        const arr = d.data || [];
        setAllData(arr);
        const stride = Math.max(1, Math.floor(arr.length / 280));
        setChartData(arr.filter((_, i) => i % stride === 0));
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [sym]);

  const meta    = TICKER_META[sym] || { name: sym, col: "#00e676", desc: "" };
  const isYield = meta.unit === "%";
  const prices  = allData.map(d => d.close);
  const last    = prices.at(-1) ?? null;

  // ── Statistics ────────────────────────────────────────────────────────────
  const fiveYrFirst   = prices[0] ?? null;
  const oneYrMs       = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const oneYrAgoPrice = allData.findLast?.(d => new Date(d.date).getTime() <= oneYrMs)?.close ?? null;
  const recent252     = prices.slice(-252);
  const hi52          = recent252.length ? Math.max(...recent252) : null;
  const lo52          = recent252.length ? Math.min(...recent252) : null;

  const logRets   = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const rets252   = logRets.slice(-252);
  const vol1y     = rets252.length > 1 ? (() => {
    const mu  = rets252.reduce((a,b)=>a+b,0) / rets252.length;
    const v   = rets252.reduce((a,x)=>a+(x-mu)**2,0) / (rets252.length - 1);
    return Math.sqrt(v * 252) * 100;
  })() : null;

  const ret5y  = (last && fiveYrFirst)  ? (last/fiveYrFirst  - 1)*100 : null;
  const ret1y  = (last && oneYrAgoPrice) ? (last/oneYrAgoPrice - 1)*100 : null;
  const fromHi = (last && hi52)          ? (last/hi52          - 1)*100 : null;

  const ms3m  = Date.now() -  91 * 24 * 60 * 60 * 1000;
  const ms6m  = Date.now() - 182 * 24 * 60 * 60 * 1000;
  const ms9m  = Date.now() - 273 * 24 * 60 * 60 * 1000;
  const p3m   = allData.findLast?.(d => new Date(d.date).getTime() <= ms3m)?.close ?? null;
  const p6m   = allData.findLast?.(d => new Date(d.date).getTime() <= ms6m)?.close ?? null;
  const p9m   = allData.findLast?.(d => new Date(d.date).getTime() <= ms9m)?.close ?? null;
  const ret3m = (last && p3m) ? (last/p3m - 1)*100 : null;
  const ret6m = (last && p6m) ? (last/p6m - 1)*100 : null;
  const ret9m = (last && p9m) ? (last/p9m - 1)*100 : null;

  const summary = generateMarketSummary(sym, meta, last, ret3m, ret6m, ret9m, ret1y, hi52, lo52, vol1y, isYield);

  const fmt = {
    price: v => v == null ? "—" : isYield ? `${v.toFixed(2)}%` : `$${v.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`,
    pct:   v => v == null ? "—" : `${v>=0?"+":""}${v.toFixed(2)}%`,
  };
  const chgCol = v => v == null ? C.mut : v >= 0 ? C.grn : C.red;

  // ── Event mapping ─────────────────────────────────────────────────────────
  const firstDate = chartData[0]?.date ?? "";
  const lastDate  = chartData.at(-1)?.date ?? "";
  const inRange   = MARKET_EVENTS.filter(e => e.date >= firstDate && e.date <= lastDate);

  const nearestDate = (targetDate) => {
    const tms = new Date(targetDate).getTime();
    let best = chartData[0]?.date ?? targetDate, bestDiff = Infinity;
    for (const d of chartData) {
      const diff = Math.abs(new Date(d.date).getTime() - tms);
      if (diff < bestDiff) { bestDiff = diff; best = d.date; }
    }
    return best;
  };
  const mapped = inRange.map(e => ({ ...e, chartDate: nearestDate(e.date) }));

  const priceAtDate = dt => allData.find(d => d.date === dt)?.close ?? null;

  const yFmt = v => isYield ? `${v.toFixed(1)}%`
    : v >= 10000 ? `$${(v/1000).toFixed(0)}k`
    : v >= 1000  ? `$${(v/1000).toFixed(1)}k`
    : `$${v.toFixed(0)}`;

  // One tick per calendar year — first data point that falls in each new year
  const yearTicks = chartData.reduce((acc, d) => {
    const yr = d.date.slice(0, 4);
    if (!acc.some(t => t.slice(0, 4) === yr)) acc.push(d.date);
    return acc;
  }, []);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── Header ── */}
      <div style={{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
        <button onClick={onBack}
          style={{display:"flex",alignItems:"center",gap:6,...mono(10,C.mut),padding:"6px 12px",
            borderRadius:8,border:`1px solid ${C.bdr}`,background:"transparent",cursor:"pointer",
            flexShrink:0,marginTop:2,transition:"background .15s"}}
          onMouseEnter={e=>e.currentTarget.style.background=C.dim}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          ← Back to Overview
        </button>
        <div style={{flex:1,minWidth:200}}>
          <div style={{display:"flex",alignItems:"baseline",gap:12,flexWrap:"wrap"}}>
            <span style={mono(26,meta.col,800)}>{sym}</span>
            <span style={mono(14,C.headingTxt,600)}>{meta.name}</span>
            {last != null && (
              <span style={{...mono(22,meta.col,700),marginLeft:"auto"}}>{fmt.price(last)}</span>
            )}
          </div>
          <div style={{...mono(10,C.mut),marginTop:5,lineHeight:1.75,maxWidth:700}}>{meta.desc}</div>
        </div>
      </div>

      {loading && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"48px 0",display:"flex",
            alignItems:"center",justifyContent:"center",gap:10}}>
            <RefreshCw size={13}/> Loading 5-year history for {sym}…
          </div>
        </Card>
      )}
      {error && !loading && (
        <Card><div style={mono(10,C.red)}>⚠ {error}</div></Card>
      )}

      {chartData.length > 0 && <>

        {/* ── Market Summary ── */}
        {summary && (
          <Card>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{width:3,height:28,borderRadius:2,background:meta.col,flexShrink:0}}/>
              <div>
                <div style={{...mono(8,meta.col,700),letterSpacing:"0.1em"}}>MARKET ANALYSIS</div>
                <div style={mono(8,C.mut)}>Based on 3 · 6 · 9 · 12 month performance</div>
              </div>
            </div>
            <div style={{...mono(11,C.txt),lineHeight:1.85,marginBottom:12,paddingLeft:11,borderLeft:`1px solid ${meta.col}20`}}>
              {summary.p1}
            </div>
            <div style={{...mono(10,C.mut),lineHeight:1.85,paddingLeft:11,borderLeft:`1px solid ${C.bdr}`}}>
              {summary.p2}
            </div>
          </Card>
        )}

        {/* ── Chart ── */}
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:10,flexWrap:"wrap",gap:8}}>
            <Lbl color={meta.col}>5-Year Chart · {sym}</Lbl>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {Object.entries(CAT_COLORS).map(([cat,col]) => {
                const n = inRange.filter(e=>e.cat===cat).length;
                if (!n) return null;
                return (
                  <div key={cat} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:10,height:2,background:col,borderRadius:1}}/>
                    <span style={mono(8,col)}>{n} {cat}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={310}>
            <ComposedChart data={chartData} margin={{top:32,right:8,bottom:0,left:0}}>
              <defs>
                <linearGradient id="mdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={meta.col} stopOpacity={0.20}/>
                  <stop offset="95%" stopColor={meta.col} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} vertical={false}/>
              <XAxis dataKey="date" ticks={yearTicks} tick={mono(8,C.mut)}
                axisLine={false} tickLine={false} tickFormatter={v=>v.slice(0,4)}/>
              <YAxis tick={mono(8,C.mut)} axisLine={false} tickLine={false}
                tickFormatter={yFmt} width={52}/>
              <Tooltip
                contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,fontSize:10}}
                labelFormatter={v => {
                  const ev = mapped.find(e => e.chartDate === v);
                  return ev ? `${v}  ·  ${ev.label}` : v;
                }}
                formatter={v => [fmt.price(v), "Price"]}/>
              {/* Background events — thin dashed lines */}
              {mapped.filter(e=>!e.highlight).map((e,i)=>(
                <ReferenceLine key={`bg-${i}`} x={e.chartDate}
                  stroke={CAT_COLORS[e.cat]} strokeOpacity={0.28} strokeWidth={1}
                  strokeDasharray="3 2"/>
              ))}
              {/* Highlighted events — labeled lines */}
              {mapped.filter(e=>e.highlight).map((e,i)=>(
                <ReferenceLine key={`hl-${i}`} x={e.chartDate}
                  stroke={CAT_COLORS[e.cat]} strokeOpacity={0.85} strokeWidth={1.5}
                  label={{
                    value: e.label,
                    position: "insideTopLeft",
                    angle: -90,
                    offset: i % 2 === 0 ? 6 : 18,
                    style: {fontSize:8, fill:CAT_COLORS[e.cat], fontFamily:"monospace",
                      fontWeight:700, textAnchor:"start"},
                  }}/>
              ))}
              <Area type="monotone" dataKey="close" stroke={meta.col} strokeWidth={1.5}
                fill="url(#mdGrad)" dot={false} name="Price"/>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        {/* ── Statistics row ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
          {[
            ["Current",    fmt.price(last),   meta.col],
            ["52W High",   fmt.price(hi52),   C.grn],
            ["52W Low",    fmt.price(lo52),   C.red],
            ["vs 52W High",fmt.pct(fromHi),   chgCol(fromHi)],
            ["1Y Return",  fmt.pct(ret1y),    chgCol(ret1y)],
            ["5Y Return",  fmt.pct(ret5y),    chgCol(ret5y)],
          ].map(([label,val,col])=>(
            <div key={label} style={{padding:"12px 14px",borderRadius:12,background:C.surf,
              border:`1px solid ${C.bdr}`}}>
              <div style={{...mono(8,C.mut,700),letterSpacing:"0.06em",marginBottom:5,
                textTransform:"uppercase"}}>{label}</div>
              <div style={mono(16,col,800)}>{val}</div>
            </div>
          ))}
        </div>

        {vol1y != null && (
          <div style={{...mono(9,C.mut),padding:"6px 13px",borderRadius:8,background:C.dim,
            border:`1px solid ${C.bdr}`,display:"inline-block",alignSelf:"flex-start"}}>
            Annualised Volatility (1Y): <span style={{
              color: vol1y>40?C.red : vol1y>20?C.amb : C.grn, fontWeight:700
            }}>{vol1y.toFixed(1)}%</span>
          </div>
        )}

        {/* ── Event Timeline ── */}
        {inRange.length > 0 && (
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <Lbl>Historical Context</Lbl>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(CAT_COLORS).map(([cat,col])=>{
                  const n = inRange.filter(e=>e.cat===cat).length;
                  if (!n) return null;
                  return <Tag key={cat} color={col}>{n} {cat}</Tag>;
                })}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[...inRange].sort((a,b)=>b.date.localeCompare(a.date)).map((e,i)=>{
                const col = CAT_COLORS[e.cat];
                const p   = priceAtDate(e.date);
                return (
                  <div key={i} style={{display:"flex",gap:12,padding:"10px 14px",borderRadius:10,
                    background:C.dim,borderLeft:`3px solid ${col}`,alignItems:"flex-start"}}>
                    <div style={{flexShrink:0,display:"flex",flexDirection:"column",gap:4,width:90}}>
                      <span style={mono(8,C.mut)}>{e.date}</span>
                      <span style={{...mono(7,col,700),padding:"1px 6px",borderRadius:6,
                        background:col+"18",display:"inline-block",textTransform:"uppercase",
                        letterSpacing:"0.06em",whiteSpace:"nowrap"}}>{e.cat}</span>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{...mono(11,C.headingTxt,700),marginBottom:3}}>
                        {e.highlight && <span style={{color:col,marginRight:5}}>★</span>}
                        {e.label}
                      </div>
                      <div style={{...mono(10,C.mut),lineHeight:1.7}}>{e.desc}</div>
                    </div>
                    {p != null && (
                      <div style={{flexShrink:0,textAlign:"right",minWidth:60}}>
                        <div style={mono(8,C.mut)}>price</div>
                        <div style={mono(12,meta.col,700)}>{fmt.price(p)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </>}
    </div>
  );
}

// ── Paper Trading ─────────────────────────────────────────────────────────────
function normCdf(x){
  const a=[0.31938153,-0.356563782,1.781477937,-1.821255978,1.330274429];
  const t=1/(1+0.2316419*Math.abs(x));
  let p=0,ti=t; for(let i=0;i<5;i++){p+=a[i]*ti;ti*=t;}
  const v=1-(1/Math.sqrt(2*Math.PI))*Math.exp(-0.5*x*x)*p;
  return x>=0?v:1-v;
}
function bsPrice(S,K,T,r,sigma,isCall){
  if(T<=0)return Math.max(0,isCall?S-K:K-S);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  return isCall?S*normCdf(d1)-K*Math.exp(-r*T)*normCdf(d2):K*Math.exp(-r*T)*normCdf(-d2)-S*normCdf(-d1);
}
function dte(exp){return Math.max(0,(new Date(exp)-Date.now())/86400000);}
function ppLoad(key,def){try{const s=localStorage.getItem(key);return s?JSON.parse(s):def;}catch{return def;}}
function ppSave(key,val){try{localStorage.setItem(key,JSON.stringify(val));}catch{}}
function ppId(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}

function CloseDialog({pos,prices,onClose,onConfirm}){
  const C=useC();
  const [cp,setCp]=useState(prices[pos.symbol]?String(prices[pos.symbol].toFixed(2)):"");
  const [fetching,setFetching]=useState(false);
  const inp={background:C.dim,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"8px 11px",color:C.txt,fontFamily:"monospace",fontSize:11,width:"100%",outline:"none"};
  async function fetchCurrent(){
    setFetching(true);
    try{
      const r=await fetch(`/api/market/price/${pos.symbol}?period=1mo`);
      const d=await r.json();
      const arr=Array.isArray(d)?d:d.prices||[];
      if(arr.length)setCp(arr[arr.length-1].close.toFixed(2));
    }catch{}
    setFetching(false);
  }
  const closePrice=parseFloat(cp);
  const isOpt=pos.type!=="equity";
  let previewPnl=null;
  if(!isNaN(closePrice)&&closePrice>0){
    if(!isOpt) previewPnl=(closePrice-pos.entryPrice)*pos.qty*(pos.side==="long"?1:-1);
    else{
      const T=dte(pos.expiry)/365;
      const prem=bsPrice(closePrice,pos.strike,T,0.045,pos.iv/100,pos.type==="call");
      previewPnl=(pos.side==="buy"?1:-1)*(prem-pos.entryPremium)*pos.contracts*100;
    }
  }
  return (
    <div style={{position:"fixed",inset:0,background:"#000b",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:14,padding:24,width:"min(420px,92vw)"}}>
        <div style={{...mono(14,C.txt,700),marginBottom:4}}>Close {pos.symbol}</div>
        <div style={{...mono(10,C.mut),marginBottom:16}}>
          {isOpt?`${pos.type.toUpperCase()} $${pos.strike} · exp ${pos.expiry} · ${pos.contracts} contract${pos.contracts>1?"s":""}`:`${pos.side.toUpperCase()} · ${pos.qty} shares · entry $${pos.entryPrice.toFixed(2)}`}
        </div>
        <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{isOpt?"Current Underlying ($)":"Close Price ($)"}</div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <input type="number" value={cp} onChange={e=>setCp(e.target.value)} placeholder="0.00" style={{...inp,flex:1}}/>
          <button onClick={fetchCurrent} disabled={fetching} style={{...mono(10,C.sky,600),border:`1px solid ${C.sky}30`,background:`${C.sky}10`,borderRadius:8,padding:"7px 14px",cursor:"pointer"}}>{fetching?"…":"Fetch"}</button>
        </div>
        {previewPnl!=null&&(
          <div style={{background:C.dim,borderRadius:8,padding:12,marginBottom:14,textAlign:"center"}}>
            <div style={mono(9,C.mut)}>Estimated P&L</div>
            <div style={{...mono(20,previewPnl>=0?C.grn:C.red,700),marginTop:4}}>{previewPnl>=0?"+":""}${previewPnl.toFixed(2)}</div>
          </div>
        )}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{...mono(10,C.mut,600),flex:1,border:`1px solid ${C.bdr}`,background:"transparent",borderRadius:8,padding:"9px",cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>onConfirm(closePrice)} disabled={isNaN(closePrice)||closePrice<=0} style={{...mono(10,C.grn,600),flex:1,border:`1px solid ${C.grn}30`,background:`${C.grn}12`,borderRadius:8,padding:"9px",cursor:"pointer",opacity:(isNaN(closePrice)||closePrice<=0)?0.4:1}}>Confirm Close</button>
        </div>
      </div>
    </div>
  );
}

function PaperTradingView(){
  const C=useC();
  const { isAuthenticated, token } = useAuth();

  // ── Persistence helpers ──────────────────────────────────────────────────
  // When authenticated: backend API.  When demo: localStorage (existing).
  const [portfolioId, setPortfolioId] = useState(null);  // backend portfolio UUID
  const [syncing,     setSyncing]     = useState(false);  // backend sync in-flight

  const [cash,   setCash0] = useState(()=>ppLoad("pp_cash",100000));
  const [pos,    setPos0]  = useState(()=>ppLoad("pp_pos",[]));
  const [jnl,    setJnl0]  = useState(()=>ppLoad("pp_jnl",[]));
  const [prices, setPrices]= useState({});
  const [sub,    setSub]   = useState("positions");
  const [busy,   setBusy]  = useState(false);
  const [msg,    setMsg]   = useState(null);
  const [closeT, setCloseT]= useState(null);
  const [kind,   setKind]  = useState("equity");
  const [eqF,    setEqF]   = useState({sym:"",qty:"",side:"long",notes:""});
  const [eqQ,    setEqQ]   = useState(null);
  const [optSym,        setOptSym]        = useState("");
  const [optU,          setOptU]          = useState(null);
  const [optExpiries,   setOptExpiries]   = useState([]);
  const [optSelExp,     setOptSelExp]     = useState(null);
  const [optChain,      setOptChain]      = useState([]);
  const [optTypeFilter, setOptTypeFilter] = useState("call");
  const [optSelC,       setOptSelC]       = useState(null);
  const [optQty,        setOptQty]        = useState("1");
  const [optSide,       setOptSide]       = useState("buy");
  const [optNotes,      setOptNotes]      = useState("");
  const [chainBusy,     setChainBusy]     = useState(false);
  const [importDone,    setImportDone]    = useState(false); // track if we offered to import localStorage

  // ── Backend sync helpers ─────────────────────────────────────────────────
  const authHeaders = useCallback(()=>({ "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}) }), [token]);

  async function backendPost(url, body){
    const r = await fetch(url, { method:"POST", headers: authHeaders(), body: JSON.stringify(body) });
    if(!r.ok){ const d=await r.json().catch(()=>({detail:"error"})); throw new Error(d.detail||`HTTP ${r.status}`); }
    return r.json();
  }
  async function backendPatch(url, body){
    const r = await fetch(url, { method:"PATCH", headers: authHeaders(), body: JSON.stringify(body) });
    if(!r.ok){ const d=await r.json().catch(()=>({detail:"error"})); throw new Error(d.detail||`HTTP ${r.status}`); }
    return r.json();
  }
  async function backendDelete(url){
    const r = await fetch(url, { method:"DELETE", headers: authHeaders() });
    if(!r.ok){ const d=await r.json().catch(()=>({detail:"error"})); throw new Error(d.detail||`HTTP ${r.status}`); }
    return r.json();
  }

  // ── Load from backend on auth ────────────────────────────────────────────
  useEffect(()=>{
    if(!isAuthenticated||!token) return;
    (async()=>{
      setSyncing(true);
      try{
        const r=await fetch("/api/paper/portfolios",{headers:{Authorization:`Bearer ${token}`}});
        if(!r.ok) throw new Error("failed");
        const portfolios=await r.json();
        let pid;
        if(portfolios.length===0){
          // Create default portfolio; offer to import localStorage data
          const created = await backendPost("/api/paper/portfolios",{name:"My Portfolio",starting_cash:100000});
          pid = created.id;
          setPortfolioId(pid);
          // Auto-import localStorage if there's data and we haven't asked yet
          const localPos = ppLoad("pp_pos",[]);
          const localJnl = ppLoad("pp_jnl",[]);
          const localCash = ppLoad("pp_cash",100000);
          if((localPos.length>0||localJnl.length>0) && !importDone){
            setImportDone(true);
            await backendPost(`/api/paper/portfolios/${pid}/import`,{cash:localCash,positions:localPos,journal:localJnl});
            flash("Imported your local paper trades to your account ✓",true);
          }
        } else {
          pid = portfolios[0].id;
          setPortfolioId(pid);
          // Load positions + journal + cash from backend
          const [posR, jnlR] = await Promise.all([
            fetch(`/api/paper/portfolios/${pid}/positions`,{headers:{Authorization:`Bearer ${token}`}}),
            fetch(`/api/paper/portfolios/${pid}/journal`,  {headers:{Authorization:`Bearer ${token}`}}),
          ]);
          if(posR.ok){
            const backendPos = await posR.json();
            // Map backend snake_case back to camelCase for existing UI logic
            setCash0(portfolios[0].cash ?? 100000);
            setPos0(backendPos.map(p=>({
              id:p.id, type:p.type, symbol:p.symbol, side:p.side,
              qty:p.qty, entryPrice:p.entry_price,
              contracts:p.contracts, strike:p.strike, expiry:p.expiry,
              entryPremium:p.entry_premium, underlyingAtEntry:p.underlying_at_entry,
              iv:p.iv, delta:p.delta,
              entryDate:p.entry_date, notes:p.notes,
            })));
          }
          if(jnlR.ok){
            const backendJnl = await jnlR.json();
            setJnl0(backendJnl.map(j=>({
              id:j.id, date:j.date, action:j.action, type:j.type,
              symbol:j.symbol, strike:j.strike, expiry:j.expiry,
              qty:j.qty, contracts:j.contracts,
              price:j.price, total:j.total, pnl:j.pnl, notes:j.notes,
            })));
          }
        }
      }catch(e){
        console.error("Paper trading backend sync failed:",e.message);
        // Silent fail — localStorage already loaded
      }
      setSyncing(false);
    })();
  },[isAuthenticated,token]); // eslint-disable-line

  // ── Setters: write to backend when authed, localStorage always ───────────
  const setCash = useCallback(async v=>{
    setCash0(v); ppSave("pp_cash",v);
    if(isAuthenticated&&portfolioId){
      try{ await backendPatch(`/api/paper/portfolios/${portfolioId}/cash`,{cash:v}); }catch{}
    }
  },[isAuthenticated,portfolioId,token]);

  const setPos = useCallback(async (newPos, addedPos=null, removedId=null)=>{
    setPos0(newPos); ppSave("pp_pos",newPos);
    if(isAuthenticated&&portfolioId){
      try{
        if(addedPos){
          await backendPost(`/api/paper/portfolios/${portfolioId}/positions`,{
            type:addedPos.type, symbol:addedPos.symbol, side:addedPos.side,
            qty:addedPos.qty, entry_price:addedPos.entryPrice,
            contracts:addedPos.contracts, strike:addedPos.strike, expiry:addedPos.expiry,
            entry_premium:addedPos.entryPremium, underlying_at_entry:addedPos.underlyingAtEntry,
            iv:addedPos.iv, delta:addedPos.delta, notes:addedPos.notes||"",
          });
        } else if(removedId){
          await backendDelete(`/api/paper/portfolios/${portfolioId}/positions/${removedId}`);
        }
      }catch{}
    }
  },[isAuthenticated,portfolioId,token]);

  const setJnl = useCallback(async (newJnl, addedEntry=null)=>{
    setJnl0(newJnl); ppSave("pp_jnl",newJnl);
    if(isAuthenticated&&portfolioId&&addedEntry){
      try{
        await backendPost(`/api/paper/portfolios/${portfolioId}/journal`,{
          action:addedEntry.action, type:addedEntry.type, symbol:addedEntry.symbol,
          strike:addedEntry.strike, expiry:addedEntry.expiry,
          qty:addedEntry.qty, contracts:addedEntry.contracts,
          price:addedEntry.price, total:addedEntry.total, pnl:addedEntry.pnl,
          notes:addedEntry.notes||"",
        });
      }catch{}
    }
  },[isAuthenticated,portfolioId,token]);
  const flash   = (t,ok=true)=>{setMsg({t,ok});setTimeout(()=>setMsg(null),3500);};

  async function fetchQ(sym){
    const r=await fetch(`/api/market/price/${sym.toUpperCase()}?period=1mo`);
    if(!r.ok)throw new Error(`No data: ${sym}`);
    const d=await r.json();
    const a=Array.isArray(d)?d:d.data||d.prices||[];
    if(!a.length)throw new Error(`Empty: ${sym}`);
    return a[a.length-1].close;
  }

  async function refreshPrices(){
    if(!pos.length){flash("No open positions",false);return;}
    setBusy(true);
    const syms=[...new Set(pos.map(p=>p.symbol))];
    const res={};
    await Promise.all(syms.map(async s=>{try{res[s]=await fetchQ(s);}catch{}}));
    setPrices(prev=>({...prev,...res}));
    flash(`Prices updated for ${Object.keys(res).length} symbol(s)`);
    setBusy(false);
  }

  async function doGetEqQ(){
    if(!eqF.sym)return;
    setBusy(true);
    try{const p=await fetchQ(eqF.sym);setEqQ(p);setPrices(prev=>({...prev,[eqF.sym.toUpperCase()]:p}));}
    catch(e){flash(e.message,false);}
    setBusy(false);
  }

  async function fetchOptChain(){
    if(!optSym)return;
    setChainBusy(true);
    try{
      // fetch underlying price and expirations in parallel
      const sym=optSym.toUpperCase();
      const [p, r] = await Promise.all([
        fetchQ(sym),
        fetch(`/api/options/${sym}/expirations`),
      ]);
      setOptU(p);
      setPrices(prev=>({...prev,[sym]:p}));

      if(r.status===404){
        // no cached chain — trigger a single-symbol refresh from yfinance
        flash(`No cached chain for ${sym} — fetching live data…`,true);
        const jr=await fetch('/api/options/refresh',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({symbols:[sym],risk_free_rate:0.045,max_workers:1}),
        });
        if(!jr.ok)throw new Error(`Could not start options refresh for ${sym}`);
        const {job_id}=await jr.json();
        // poll until complete (max 60s)
        for(let i=0;i<30;i++){
          await new Promise(res=>setTimeout(res,2000));
          const pr=await fetch(`/api/options/refresh/${job_id}`);
          const pd=await pr.json();
          if(pd.status==='complete')break;
          if(pd.status==='failed')throw new Error(`Options refresh failed for ${sym}`);
        }
        // retry expirations
        const r2=await fetch(`/api/options/${sym}/expirations`);
        if(!r2.ok)throw new Error(`Still no options data for ${sym} after refresh`);
        const d2=await r2.json();
        setOptExpiries(d2.expirations||[]);
      } else {
        if(!r.ok)throw new Error(`Failed to load expirations for ${sym}`);
        const d=await r.json();
        setOptExpiries(d.expirations||[]);
      }
      setOptSelExp(null);
      setOptChain([]);
      setOptSelC(null);
      flash(`Chain loaded for ${sym}`,true);
    }catch(e){flash(e.message,false);}
    setChainBusy(false);
  }

  async function fetchExpiry(exp){
    setOptSelExp(exp);
    setOptSelC(null);
    setChainBusy(true);
    try{
      const r=await fetch(`/api/options/${optSym.toUpperCase()}?expiration=${exp}&limit=300`);
      if(!r.ok)throw new Error(`Failed to load chain for ${exp}`);
      const d=await r.json();
      setOptChain(d.data||[]);
    }catch(e){flash(e.message,false);}
    setChainBusy(false);
  }

  function openEquity(){
    const sym=eqF.sym.toUpperCase(), qty=parseInt(eqF.qty);
    if(!sym||!qty||qty<=0||!eqQ)return flash("Enter symbol, qty, and get quote first",false);
    const cost=eqQ*qty;
    if(eqF.side==="long"&&cost>cash)return flash("Insufficient cash",false);
    const newPos={id:ppId(),type:"equity",symbol:sym,side:eqF.side,qty,entryPrice:eqQ,entryDate:new Date().toISOString(),notes:eqF.notes};
    const newCash=eqF.side==="long"?cash-cost:cash+cost;
    const action=eqF.side==="long"?"BUY":"SELL SHORT";
    const newJnlEntry={id:ppId(),date:new Date().toISOString(),action,type:"equity",symbol:sym,qty,price:eqQ,total:cost,pnl:null,notes:eqF.notes};
    setPos([...pos,newPos], newPos, null);
    setCash(newCash);
    setJnl([newJnlEntry,...jnl], newJnlEntry);
    setEqF({sym:"",qty:"",side:"long",notes:""});setEqQ(null);
    flash(`${action} ${qty}× ${sym} @ $${eqQ.toFixed(2)}`);
    setSub("positions");
  }

  function openOptions(){
    if(!optSelC||!optU)return flash("Select a contract from the chain first",false);
    const contracts=parseInt(optQty)||1;
    const entryPremium=optSelC.last_price>0?optSelC.last_price:(optSelC.bid+optSelC.ask)/2||0;
    if(!entryPremium)return flash("No valid price for this contract",false);
    const total=entryPremium*contracts*100;
    if(optSide==="buy"&&total>cash)return flash("Insufficient cash",false);
    const sym=optSym.toUpperCase();
    const newPos={id:ppId(),type:optSelC.option_type,symbol:sym,strike:optSelC.strike,expiry:optSelC.expiration,side:optSide,contracts,entryPremium,underlyingAtEntry:optU,iv:optSelC.implied_vol*100,delta:optSelC.delta,entryDate:new Date().toISOString(),notes:optNotes};
    const action=`${optSide==="buy"?"BUY":"WRITE"} ${optSelC.option_type.toUpperCase()}`;
    const newJnlEntry={id:ppId(),date:new Date().toISOString(),action,type:optSelC.option_type,symbol:sym,strike:optSelC.strike,expiry:optSelC.expiration,contracts,price:entryPremium,total,pnl:null,notes:optNotes};
    setPos([...pos,newPos], newPos, null);
    setCash(optSide==="buy"?cash-total:cash+total);
    setJnl([newJnlEntry,...jnl], newJnlEntry);
    setOptSelC(null);setOptQty("1");setOptNotes("");
    flash(`${action} ${contracts}× ${sym} $${optSelC.strike} exp ${optSelC.expiration}`);
    setSub("positions");
  }

  function closePos(p,closePrice){
    let pnl,cashDelta;
    if(p.type==="equity"){
      pnl=(closePrice-p.entryPrice)*p.qty*(p.side==="long"?1:-1);
      cashDelta=p.side==="long"?closePrice*p.qty:-(closePrice*p.qty);
    }else{
      const T=dte(p.expiry)/365;
      const prem=bsPrice(closePrice,p.strike,T,0.045,p.iv/100,p.type==="call");
      pnl=(p.side==="buy"?1:-1)*(prem-p.entryPremium)*p.contracts*100;
      cashDelta=p.side==="buy"?prem*p.contracts*100:-(prem*p.contracts*100);
    }
    const action=p.type==="equity"?(p.side==="long"?"SELL (CLOSE)":"BUY (COVER)"):`CLOSE ${p.type.toUpperCase()}`;
    const jnlEntry={id:ppId(),date:new Date().toISOString(),action,type:p.type,symbol:p.symbol,strike:p.strike,expiry:p.expiry,qty:p.qty||p.contracts,price:closePrice,total:Math.abs(cashDelta),pnl:Math.round(pnl*100)/100,notes:p.notes};
    setJnl([jnlEntry,...jnl], jnlEntry);
    setPos(pos.filter(x=>x.id!==p.id), null, p.id);
    setCash(cash+cashDelta);
    setCloseT(null);
    flash(`${p.symbol} closed · P&L: ${pnl>=0?"+":""}$${pnl.toFixed(2)}`,pnl>=0);
  }

  function unrealPnL(p){
    const cp=prices[p.symbol];
    if(!cp)return null;
    if(p.type==="equity")return(cp-p.entryPrice)*p.qty*(p.side==="long"?1:-1);
    const T=dte(p.expiry)/365;
    const prem=bsPrice(cp,p.strike,T,0.045,p.iv/100,p.type==="call");
    return(p.side==="buy"?1:-1)*(prem-p.entryPremium)*p.contracts*100;
  }

  const posValue=useMemo(()=>pos.reduce((acc,p)=>{
    if(p.type==="equity"){const cp=prices[p.symbol]??p.entryPrice;return acc+(p.side==="long"?cp*p.qty:-(cp*p.qty));}
    const cp=prices[p.symbol]??p.underlyingAtEntry;
    const T=dte(p.expiry)/365;
    const prem=bsPrice(cp,p.strike,T,0.045,p.iv/100,p.type==="call");
    return acc+(p.side==="buy"?prem*p.contracts*100:-(prem*p.contracts*100));
  },0),[pos,prices]);
  const portValue=cash+posValue;
  const totalPnL=portValue-100000;
  const closed=jnl.filter(j=>j.pnl!=null);
  const wins=closed.filter(j=>j.pnl>0).length;
  const realPnL=closed.reduce((a,j)=>a+(j.pnl||0),0);

  const inp={background:C.dim,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"8px 11px",color:C.txt,fontFamily:"monospace",fontSize:11,width:"100%",outline:"none"};
  const sbtn=(col,active)=>({...mono(10,active?col:C.mut,600),border:`1px solid ${active?col+"40":C.bdr}`,background:active?col+"10":"transparent",borderRadius:8,padding:"6px 14px",cursor:"pointer"});
  const fmt2=n=>n.toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2});

  return(
    <div style={{padding:20,maxWidth:1100,margin:"0 auto"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:20}}>
        <div>
          <div style={{...mono(9,C.sky,700),letterSpacing:"0.18em",marginBottom:4}}>PAPER TRADING</div>
          <div style={mono(22,C.txt,700)}>Virtual Portfolio</div>
          <div style={{...mono(10,C.mut),marginTop:2}}>Simulate trades with real market data · no real money at risk</div>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {[
            ["Cash",`$${fmt2(cash)}`,C.grn],
            ["Portfolio",`$${fmt2(portValue)}`,C.sky],
            ["Total P&L",`${totalPnL>=0?"+":""}$${fmt2(totalPnL)}`,totalPnL>=0?C.grn:C.red],
          ].map(([l,v,col])=>(
            <Card key={l}><Lbl>{l}</Lbl><div style={mono(16,col,700)}>{v}</div></Card>
          ))}
        </div>
      </div>

      {/* Flash message */}
      {msg&&<div style={{...mono(11,msg.ok?C.grn:C.red),background:msg.ok?C.grnBg:`${C.red}12`,border:`1px solid ${msg.ok?C.grn:C.red}30`,borderRadius:8,padding:"10px 14px",marginBottom:14}}>{msg.t}</div>}

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[["positions","Positions"],["newtrade","New Trade"],["journal","Journal"]].map(([id,l])=>(
          <Pill key={id} label={l} active={sub===id} onClick={()=>setSub(id)}/>
        ))}
      </div>

      {/* ── POSITIONS ── */}
      {sub==="positions"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={mono(11,C.mut)}>{pos.length} open position{pos.length!==1?"s":""}</div>
            <button onClick={refreshPrices} disabled={busy} style={{...mono(10,C.sky,600),border:`1px solid ${C.sky}30`,background:`${C.sky}10`,borderRadius:8,padding:"7px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
              <RefreshCw size={11}/>{busy?"Refreshing…":"Refresh Prices"}
            </button>
          </div>
          {pos.length===0
            ? <Card><div style={{...mono(11,C.mut),textAlign:"center",padding:"32px 0"}}>No open positions — open one in New Trade.</div></Card>
            : <Card>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      {["Symbol","Type","Side","Qty","Entry","Current","Unr. P&L","P&L %","Opened",""].map(h=>(
                        <th key={h} style={{...mono(8,C.mut,700),textAlign:"left",padding:"6px 10px",borderBottom:`1px solid ${C.bdr}`,letterSpacing:"0.09em",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {pos.map(p=>{
                        const pnl=unrealPnL(p);
                        const cost=p.type==="equity"?p.entryPrice*p.qty:p.entryPremium*p.contracts*100;
                        const pct=pnl!=null?(pnl/Math.abs(cost))*100:null;
                        const col=pnl==null?C.mut:pnl>=0?C.grn:C.red;
                        const cp=prices[p.symbol];
                        return(
                          <tr key={p.id} style={{borderBottom:`1px solid ${C.bdr}22`}}>
                            <td style={{...mono(12,C.txt,700),padding:"9px 10px"}}>{p.symbol}</td>
                            <td style={{...mono(10,C.sky),padding:"9px 10px",textTransform:"uppercase"}}>{p.type==="equity"?"EQ":p.type}</td>
                            <td style={{padding:"9px 10px"}}>
                              <span style={{...mono(9,p.side==="long"||p.side==="buy"?C.grn:C.amb,700),background:(p.side==="long"||p.side==="buy"?C.grn:C.amb)+"15",borderRadius:4,padding:"2px 6px",textTransform:"uppercase"}}>{p.side}</span>
                            </td>
                            <td style={{...mono(11,C.txt),padding:"9px 10px"}}>{p.type==="equity"?p.qty:p.contracts}</td>
                            <td style={{...mono(11,C.txt),padding:"9px 10px"}}>{p.type==="equity"?`$${p.entryPrice.toFixed(2)}`:`$${p.entryPremium.toFixed(3)}`}</td>
                            <td style={{...mono(11,cp?C.txt:C.mut),padding:"9px 10px"}}>{cp?`$${cp.toFixed(2)}`:"—"}</td>
                            <td style={{...mono(12,col,700),padding:"9px 10px"}}>{pnl==null?"—":`${pnl>=0?"+":""}$${pnl.toFixed(2)}`}</td>
                            <td style={{...mono(11,col),padding:"9px 10px"}}>{pct==null?"—":`${pct>=0?"+":""}${pct.toFixed(2)}%`}</td>
                            <td style={{...mono(9,C.mut),padding:"9px 10px",whiteSpace:"nowrap"}}>{new Date(p.entryDate).toLocaleDateString()}</td>
                            <td style={{padding:"9px 10px"}}>
                              <button onClick={()=>setCloseT(p)} style={{...mono(9,C.red),background:`${C.red}12`,border:`1px solid ${C.red}30`,borderRadius:6,padding:"3px 9px",cursor:"pointer"}}>Close</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
          }
          {closeT&&<CloseDialog pos={closeT} prices={prices} onClose={()=>setCloseT(null)} onConfirm={(cp)=>closePos(closeT,cp)}/>}
        </div>
      )}

      {/* ── NEW TRADE ── */}
      {sub==="newtrade"&&(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["equity","Equity"],["options","Options"]].map(([k,l])=>(
              <button key={k} onClick={()=>setKind(k)} style={sbtn(C.sky,kind===k)}>{l}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:16}}>
            {kind==="equity"&&<>
              <Card>
                <Lbl>Equity Trade</Lbl>
                <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Symbol</div>
                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  <input value={eqF.sym} onChange={e=>setEqF(f=>({...f,sym:e.target.value.toUpperCase()}))}
                    placeholder="e.g. AAPL, SPY, TSLA" style={{...inp,flex:1}}
                    onKeyDown={e=>e.key==="Enter"&&doGetEqQ()}/>
                  <button onClick={doGetEqQ} disabled={busy||!eqF.sym} style={{...mono(10,C.sky,600),border:`1px solid ${C.sky}30`,background:`${C.sky}10`,borderRadius:8,padding:"7px 14px",cursor:"pointer",opacity:!eqF.sym?0.5:1}}>{busy?"…":"Get Quote"}</button>
                </div>
                {eqQ!=null&&<div style={{...mono(14,C.grn,700),marginBottom:12}}>Last: ${eqQ.toFixed(2)}</div>}
                <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Direction</div>
                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  {[["long","Long (Buy)"],["short","Short"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setEqF(f=>({...f,side:v}))} style={sbtn(v==="long"?C.grn:C.amb,eqF.side===v)}>{l}</button>
                  ))}
                </div>
                <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Shares</div>
                <input type="number" value={eqF.qty} onChange={e=>setEqF(f=>({...f,qty:e.target.value}))}
                  placeholder="Number of shares" style={{...inp,marginBottom:12}}/>
                {eqQ&&eqF.qty&&parseInt(eqF.qty)>0&&(
                  <div style={{...mono(10,C.mut),marginBottom:12}}>
                    Est. {eqF.side==="long"?"cost":"proceeds"}: ${fmt2(eqQ*parseInt(eqF.qty))}
                  </div>
                )}
                <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Notes</div>
                <textarea value={eqF.notes} onChange={e=>setEqF(f=>({...f,notes:e.target.value}))}
                  placeholder="Thesis, entry reasoning…" rows={2} style={{...inp,resize:"vertical",marginBottom:14}}/>
                <button onClick={openEquity} disabled={!eqQ||busy||!eqF.qty} style={{...mono(10,C.grn,600),width:"100%",border:`1px solid ${C.grn}30`,background:`${C.grn}12`,borderRadius:8,padding:"10px",cursor:"pointer",opacity:(!eqQ||!eqF.qty)?0.5:1}}>
                  Open Equity Trade
                </button>
              </Card>
              <Card>
                <Lbl>Account</Lbl>
                <KV k="Cash Available" v={`$${fmt2(cash)}`} vc={C.grn}/>
                <KV k="Open Positions" v={pos.length}/>
                <KV k="Starting Capital" v="$100,000"/>
                <KV k="Total P&L" v={`${totalPnL>=0?"+":""}$${fmt2(totalPnL)}`} vc={totalPnL>=0?C.grn:C.red}/>
                <div style={{...mono(9,C.mut),marginTop:16,lineHeight:1.85,padding:12,background:C.dim,borderRadius:8}}>
                  <span style={{color:C.sky,fontWeight:700}}>Tip:</span> Get a quote first, then set direction and share count. Short positions receive the sale proceeds immediately and are closed by buying back.
                </div>
              </Card>
            </>}
            {kind==="options"&&(
              <div style={{gridColumn:"1/-1"}}>
                {/* ── Step 1: Fetch chain ── */}
                <Card>
                  <Lbl>Options Chain</Lbl>
                  <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
                    <div style={{flex:"0 0 200px"}}>
                      <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Underlying Symbol</div>
                      <input value={optSym} onChange={e=>{setOptSym(e.target.value.toUpperCase());setOptExpiries([]);setOptChain([]);setOptSelC(null);setOptSelExp(null);setOptU(null);}}
                        placeholder="e.g. SPY, AAPL, QQQ" style={inp} onKeyDown={e=>e.key==="Enter"&&fetchOptChain()}/>
                    </div>
                    <button onClick={fetchOptChain} disabled={chainBusy||!optSym} style={{...mono(10,C.sky,600),border:`1px solid ${C.sky}30`,background:`${C.sky}10`,borderRadius:8,padding:"9px 16px",cursor:"pointer",opacity:!optSym?0.5:1}}>
                      {chainBusy&&!optSelExp?"Loading…":"Fetch Chain"}
                    </button>
                    {optU!=null&&<div style={mono(16,C.grn,700)}>Underlying: ${optU.toFixed(2)}</div>}
                  </div>

                  {/* ── Step 2: Expiry pills ── */}
                  {optExpiries.length>0&&(
                    <div style={{marginBottom:12}}>
                      <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Select Expiry</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {optExpiries.map(exp=>(
                          <button key={exp} onClick={()=>fetchExpiry(exp)}
                            style={{...mono(10,optSelExp===exp?C.sky:C.mut,600),border:`1px solid ${optSelExp===exp?C.sky+"50":C.bdr}`,background:optSelExp===exp?`${C.sky}14`:"transparent",borderRadius:6,padding:"4px 11px",cursor:"pointer",transition:"all .12s"}}>
                            {exp}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Step 3: Call/Put filter + contract table ── */}
                  {optChain.length>0&&(
                    <>
                      <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
                        {[["call","Calls",C.grn],["put","Puts",C.red]].map(([v,l,col])=>(
                          <button key={v} onClick={()=>setOptTypeFilter(v)}
                            style={{...mono(10,optTypeFilter===v?col:C.mut,600),border:`1px solid ${optTypeFilter===v?col+"40":C.bdr}`,background:optTypeFilter===v?col+"10":"transparent",borderRadius:8,padding:"5px 14px",cursor:"pointer"}}>
                            {l}
                          </button>
                        ))}
                        {chainBusy&&<div style={mono(10,C.mut)}>Loading…</div>}
                        <div style={{...mono(9,C.mut),marginLeft:"auto"}}>{optChain.filter(c=>c.option_type===optTypeFilter).length} contracts · click row to select</div>
                      </div>
                      {(()=>{
                        const filtered=optChain.filter(c=>c.option_type===optTypeFilter).sort((a,b)=>a.strike-b.strike);
                        if(!filtered.length)return <div style={{...mono(10,C.mut),padding:"12px 0"}}>No {optTypeFilter}s for this expiry.</div>;
                        const col=optTypeFilter==="call"?C.grn:C.red;
                        return(
                          <div style={{overflowX:"auto",maxHeight:300,overflowY:"auto",borderRadius:8,border:`1px solid ${C.bdr}`}}>
                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                              <thead style={{position:"sticky",top:0,background:C.surf,zIndex:1}}>
                                <tr>{["Strike","Bid","Ask","Last","IV %","Δ","OI","Vol",""].map(h=>(
                                  <th key={h} style={{...mono(8,C.mut,700),textAlign:"left",padding:"6px 10px",borderBottom:`1px solid ${C.bdr}`,letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{h}</th>
                                ))}</tr>
                              </thead>
                              <tbody>
                                {filtered.map((c,i)=>{
                                  const isSelected=optSelC&&optSelC.strike===c.strike&&optSelC.option_type===c.option_type&&optSelC.expiration===c.expiration;
                                  const isAtm=optU&&Math.abs(c.strike-optU)<optU*0.015;
                                  return(
                                    <tr key={i} onClick={()=>setOptSelC(c)}
                                      style={{borderBottom:`1px solid ${C.bdr}22`,cursor:"pointer",background:isSelected?col+"20":isAtm?C.dim:"transparent",transition:"background .1s"}}>
                                      <td style={{...mono(12,isAtm?col:C.txt,isAtm?700:500),padding:"7px 10px",whiteSpace:"nowrap"}}>
                                        ${c.strike.toFixed(c.strike>=100?1:2)}
                                        {isAtm&&<span style={{...mono(7,col,700),marginLeft:5,background:col+"18",borderRadius:3,padding:"1px 4px"}}>ATM</span>}
                                        {c.in_the_money&&!isAtm&&<span style={{...mono(7,col,600),marginLeft:5}}>ITM</span>}
                                      </td>
                                      <td style={{...mono(10,C.txt),padding:"7px 10px"}}>{c.bid>0?`$${c.bid.toFixed(2)}`:"—"}</td>
                                      <td style={{...mono(10,C.txt),padding:"7px 10px"}}>{c.ask>0?`$${c.ask.toFixed(2)}`:"—"}</td>
                                      <td style={{...mono(10,c.last_price>0?C.txt:C.mut),padding:"7px 10px"}}>{c.last_price>0?`$${c.last_price.toFixed(2)}`:"—"}</td>
                                      <td style={{...mono(10,C.sky),padding:"7px 10px"}}>{c.implied_vol?(c.implied_vol*100).toFixed(1)+"%":"—"}</td>
                                      <td style={{...mono(10,c.delta!=null?(c.delta>=0?C.grn:C.red):C.mut),padding:"7px 10px"}}>{c.delta!=null?c.delta.toFixed(3):"—"}</td>
                                      <td style={{...mono(9,C.mut),padding:"7px 10px"}}>{c.open_interest?.toLocaleString()||"—"}</td>
                                      <td style={{...mono(9,C.mut),padding:"7px 10px"}}>{c.volume?.toLocaleString()||"—"}</td>
                                      <td style={{padding:"7px 10px"}}>
                                        <button onClick={e=>{e.stopPropagation();setOptSelC(c);}} style={{...mono(9,col),border:`1px solid ${col}30`,background:`${col}10`,borderRadius:5,padding:"2px 8px",cursor:"pointer"}}>
                                          {isSelected?"✓ Selected":"Select"}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {optExpiries.length===0&&!chainBusy&&optU!=null&&(
                    <div style={{...mono(10,C.amb),marginTop:8}}>No options data cached for {optSym}. Run a chain refresh in the Options tab first.</div>
                  )}
                </Card>

                {/* ── Step 4: Selected contract + trade params ── */}
                {optSelC&&(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16,marginTop:16}}>
                    <Card accent={optTypeFilter==="call"?C.grn:C.red}>
                      <Lbl>Selected Contract</Lbl>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                        {[
                          ["Symbol",   optSym,                                    C.txt],
                          ["Strike",   `$${optSelC.strike}`,                      C.sky],
                          ["Expiry",   optSelC.expiration,                        C.txt],
                          ["Type",     optSelC.option_type.toUpperCase(),         optTypeFilter==="call"?C.grn:C.red],
                          ["IV",       optSelC.implied_vol?(optSelC.implied_vol*100).toFixed(1)+"%":"—", C.sky],
                          ["Delta",    optSelC.delta!=null?optSelC.delta.toFixed(3):"—", C.txt],
                          ["Bid",      optSelC.bid>0?`$${optSelC.bid.toFixed(2)}`:"—",  C.txt],
                          ["Ask",      optSelC.ask>0?`$${optSelC.ask.toFixed(2)}`:"—",  C.txt],
                          ["Last",     optSelC.last_price>0?`$${optSelC.last_price.toFixed(2)}`:"—", C.grn],
                        ].map(([l,v,col])=>(
                          <div key={l}><div style={mono(8,C.mut)}>{l}</div><div style={mono(13,col,700)}>{v}</div></div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,background:C.dim,borderRadius:8,padding:10}}>
                        {[
                          ["Θ Theta",  optSelC.theta],
                          ["Γ Gamma",  optSelC.gamma],
                          ["ν Vega",   optSelC.vega],
                          ["OI",       typeof optSelC.open_interest==="number"?optSelC.open_interest.toLocaleString():null],
                        ].map(([l,v])=>(
                          <div key={l}><div style={mono(8,C.mut)}>{l}</div><div style={mono(11,C.txt,700)}>{typeof v==="number"?v.toFixed(4):v||"—"}</div></div>
                        ))}
                      </div>
                    </Card>
                    <Card>
                      <Lbl>Trade Parameters</Lbl>
                      <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Side</div>
                      <div style={{display:"flex",gap:8,marginBottom:12}}>
                        {[["buy","Buy"],["write","Write"]].map(([v,l])=>(
                          <button key={v} onClick={()=>setOptSide(v)} style={sbtn(C.sky,optSide===v)}>{l}</button>
                        ))}
                      </div>
                      <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Contracts</div>
                      <input type="number" value={optQty} onChange={e=>setOptQty(e.target.value)} placeholder="1" min="1" style={{...inp,marginBottom:12}}/>
                      {(()=>{
                        const contracts=parseInt(optQty)||1;
                        const premium=optSelC.last_price>0?optSelC.last_price:(optSelC.bid+optSelC.ask)/2||0;
                        const total=premium*contracts*100;
                        const cashAfter=optSide==="buy"?cash-total:cash+total;
                        return <div style={{background:C.dim,borderRadius:8,padding:10,marginBottom:12}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                            <div><div style={mono(8,C.mut)}>Entry Premium</div><div style={mono(13,C.sky,700)}>${premium.toFixed(3)}/share</div></div>
                            <div><div style={mono(8,C.mut)}>Total {optSide==="buy"?"Cost":"Credit"}</div><div style={mono(13,C.grn,700)}>${total.toFixed(2)}</div></div>
                            <div><div style={mono(8,C.mut)}>DTE</div><div style={mono(13,C.txt,700)}>{Math.round(dte(optSelC.expiration))}d</div></div>
                            <div><div style={mono(8,C.mut)}>Cash After</div><div style={mono(13,cashAfter>=0?C.grn:C.red,700)}>${fmt2(cashAfter)}</div></div>
                          </div>
                        </div>;
                      })()}
                      <div style={{...mono(9,C.mut,700),letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Notes</div>
                      <textarea value={optNotes} onChange={e=>setOptNotes(e.target.value)}
                        placeholder="Strategy, entry thesis…" rows={2} style={{...inp,resize:"vertical",marginBottom:14}}/>
                      <button onClick={openOptions} style={{...mono(10,C.grn,600),width:"100%",border:`1px solid ${C.grn}30`,background:`${C.grn}12`,borderRadius:8,padding:"10px",cursor:"pointer"}}>
                        Open Options Trade
                      </button>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── JOURNAL ── */}
      {sub==="journal"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
            {[
              ["Total Trades",  jnl.length,                                                     C.txt],
              ["Closed",        closed.length,                                                   C.mut],
              ["Win Rate",      closed.length?`${Math.round((wins/closed.length)*100)}%`:"—",   C.grn],
              ["Realised P&L",  closed.length?`${realPnL>=0?"+":""}$${fmt2(realPnL)}`:"—",     realPnL>=0?C.grn:C.red],
            ].map(([l,v,col])=>(
              <Card key={l}><Lbl>{l}</Lbl><div style={mono(18,col,700)}>{v}</div></Card>
            ))}
          </div>
          {jnl.length===0
            ? <Card><div style={{...mono(11,C.mut),textAlign:"center",padding:"32px 0"}}>No journal entries yet — open your first trade.</div></Card>
            : <Card>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>
                      {["Date","Action","Symbol","Type","Qty","Price","Total","P&L","Notes"].map(h=>(
                        <th key={h} style={{...mono(8,C.mut,700),textAlign:"left",padding:"6px 10px",borderBottom:`1px solid ${C.bdr}`,letterSpacing:"0.09em",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {jnl.map(j=>{
                        const col=j.pnl==null?C.mut:j.pnl>=0?C.grn:C.red;
                        return(
                          <tr key={j.id} style={{borderBottom:`1px solid ${C.bdr}22`}}>
                            <td style={{...mono(9,C.mut),padding:"8px 10px",whiteSpace:"nowrap"}}>{new Date(j.date).toLocaleDateString()}</td>
                            <td style={{...mono(10,C.sky,700),padding:"8px 10px",whiteSpace:"nowrap"}}>{j.action}</td>
                            <td style={{...mono(12,C.txt,700),padding:"8px 10px"}}>{j.symbol}</td>
                            <td style={{...mono(9,C.mut),padding:"8px 10px",textTransform:"uppercase"}}>{j.type}</td>
                            <td style={{...mono(11,C.txt),padding:"8px 10px"}}>{j.qty||j.contracts}</td>
                            <td style={{...mono(11,C.txt),padding:"8px 10px"}}>${typeof j.price==="number"?j.price.toFixed(2):"—"}</td>
                            <td style={{...mono(11,C.txt),padding:"8px 10px"}}>${typeof j.total==="number"?j.total.toFixed(2):"—"}</td>
                            <td style={{...mono(11,col,700),padding:"8px 10px"}}>{j.pnl==null?"—":`${j.pnl>=0?"+":""}$${j.pnl.toFixed(2)}`}</td>
                            <td style={{...mono(9,C.mut),padding:"8px 10px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.notes||"—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
          }
          <div style={{marginTop:14,display:"flex",justifyContent:"flex-end"}}>
            <button onClick={()=>{if(window.confirm("Reset all paper trading data? This cannot be undone.")){setCash(100000);setPos([]);setJnl([]);setPrices({});flash("Portfolio reset to $100,000");}}}
              style={{...mono(10,C.red),background:`${C.red}10`,border:`1px solid ${C.red}30`,borderRadius:8,padding:"8px 16px",cursor:"pointer"}}>
              Reset Portfolio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inner App (inside AuthProvider) ──────────────────────────────────────────
function AppInner() {
  const { isAuthenticated, ready } = useAuth();
  const [showGate, setShowGate] = useState(false);

  // Refs avoid stale closures inside the fetch interceptor (which is set up
  // once on mount and must read current values without re-registering).
  const isAuthRef     = useRef(false);
  const fetchCountRef = useRef(0);
  const timerFiredRef = useRef(false);
  const isDemoRef     = useRef(false);
  const demoFetchRef  = useRef(0);
  const demoStartRef  = useRef(0);

  // Keep isAuthRef in sync; hide gate immediately on successful login.
  useEffect(() => {
    isAuthRef.current = isAuthenticated;
    if (isAuthenticated) setShowGate(false);
  }, [isAuthenticated]);

  // 20-second timer — fires once. Skipped entirely in demo mode.
  useEffect(() => {
    if (DEMO_MODE) return;
    const t = setTimeout(() => {
      timerFiredRef.current = true;
      if (fetchCountRef.current >= 1 && !isAuthRef.current && !isDemoRef.current)
        setShowGate(true);
    }, 20000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // In DEMO_MODE: intercept any 401/403 at the network layer so no component
  // ever sees an "unauthenticated" response — works even with cached old code.
  useEffect(() => {
    if (!DEMO_MODE) return;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await orig(...args);
      if (res.status === 401 || res.status === 403) {
        // Return a neutral 503 so friendlyError never shows the auth prompt.
        return new Response(JSON.stringify({ detail: "Temporarily unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return res;
    };
    return () => { window.fetch = orig; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Patch window.fetch once on mount to count /api/ calls (excluding /auth/).
  // Gate logic is fully disabled in demo mode.
  useEffect(() => {
    if (DEMO_MODE) return;   // no gate in demo mode — skip entirely
    const orig = window.fetch.bind(window);
    window.fetch = (...args) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
      if (url.startsWith("/api/") && !url.includes("/api/auth/")) {
        fetchCountRef.current += 1;
        const c = fetchCountRef.current;

        // Not authed, not in demo → show gate after (timer fired + 2 fetches)
        // or after 3 fetches regardless of timer.
        if (!isAuthRef.current && !isDemoRef.current) {
          if ((timerFiredRef.current && c >= 2) || c >= 3) setShowGate(true);
        }

        // In demo mode → re-prompt after 10 more fetches or 5 minutes.
        if (isDemoRef.current) {
          demoFetchRef.current += 1;
          const elapsed = Date.now() - demoStartRef.current;
          if (demoFetchRef.current >= 10 || elapsed >= 5 * 60 * 1000) {
            isDemoRef.current = false;
            setShowGate(true);
          }
        }
      }
      return orig(...args);
    };
    return () => { window.fetch = orig; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While auth context is still rehydrating from sessionStorage, render nothing
  // (avoids a flash of the gate for returning signed-in users).
  if (!ready) return null;

  return (
    <>
      <AppShell />
      {!DEMO_MODE && showGate && !isAuthenticated && (
        <AuthScreen
          onDemoMode={() => {
            isDemoRef.current    = true;
            demoStartRef.current = Date.now();
            demoFetchRef.current = 0;
            setShowGate(false);
          }}
        />
      )}
    </>
  );
}

function AppShell() {
  const { isAuthenticated, user } = useAuth();
  const [view,setView]           = useState("markets");
  const [dark,setDark]           = useState(true);
  const [detailSym,setDetailSym] = useState(null);
  const [loadCount, setLoadCount] = useState(0);
  const globalLoading = loadCount > 0;
  const loadCtxVal = useMemo(()=>({
    active: globalLoading,
    push: () => setLoadCount(n => n+1),
    pop:  () => setLoadCount(n => Math.max(0, n-1)),
  }), [globalLoading]);
  const [navOpen,setNavOpen]     = useState(false);
  const [isMobile,setIsMobile]   = useState(()=>window.innerWidth < 768);
  useEffect(()=>{
    const fn=()=>setIsMobile(window.innerWidth<768);
    window.addEventListener("resize",fn);
    return ()=>window.removeEventListener("resize",fn);
  },[]);
  const C = dark ? DARK : LIGHT;
  const VIEWS={
    markets:   <MarketsView onNav={(v)=>{setDetailSym(null);setView(v);}} onDetail={setDetailSym}/>,
    advisor:   <TradeAdvisorView/>,
    macro:     <MacroView/>,
    technical: <TechnicalView/>,
    options:   <OptionsView/>,
    sectors:   <SectorsView/>,
    signals:   <SignalsView/>,
    pairs:     <PairsView/>,
    portfolio: <PortfolioHubView/>,
    paper:     <PaperTradingView/>,
    lab:       <LabView/>,
  };
  return (
    <LoadingCtx.Provider value={loadCtxVal}>
    <ThemeCtx.Provider value={{...C, isMobile}}>
      <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"monospace",overflow:"hidden"}}>
        {/* Mobile overlay backdrop */}
        {isMobile && navOpen && (
          <div onClick={()=>setNavOpen(false)}
            style={{position:"fixed",inset:0,background:"#00000099",zIndex:40}}/>
        )}
        {/* Sidebar */}
        <aside style={{
          width:186,flexShrink:0,borderRight:`1px solid ${C.bdr}`,
          display:"flex",flexDirection:"column",background:C.surf,
          ...(isMobile ? {
            position:"fixed",top:0,left:0,height:"100vh",zIndex:50,
            transform:navOpen?"translateX(0)":"translateX(-100%)",
            transition:"transform .25s ease",
          } : {})
        }}>
          <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${C.bdr}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <div style={{width:26,height:26,borderRadius:8,background:C.grnBg,border:`1px solid ${C.grn}30`,display:"flex",alignItems:"center",justifyContent:"center",
                  boxShadow:globalLoading?`0 0 8px ${C.grn}88`:"none",
                  transition:"box-shadow .3s"}}>
                  <BarChart2 size={14} style={{color:C.grn, animation:globalLoading?"spin 1.2s linear infinite":"none"}}/>
                </div>
                <span style={mono(11,C.headingTxt,700)}>Picador</span>
              </div>
              <div style={mono(9,C.mut)}>v2.0.0 · The Analyst's Terminal</div>
            </div>
            {isMobile && (
              <button onClick={()=>setNavOpen(false)} style={{background:"transparent",border:"none",cursor:"pointer",padding:"2px 4px",marginTop:2}}>
                <X size={16} style={{color:C.mut}}/>
              </button>
            )}
          </div>
          <nav style={{flex:1,padding:"10px 8px",overflowY:"auto"}}>
            {NAV.map(({id,l,I})=>{
              const a=view===id;
              return (
                <button key={id} onClick={()=>{setView(id);setDetailSym(null);if(isMobile)setNavOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",borderRadius:8,marginBottom:2,border:`1px solid ${a?C.grn+"30":"transparent"}`,background:a?C.grnBg:"transparent",cursor:"pointer",transition:"all .15s",...mono(11,a?C.grn:C.mut,a?700:400)}}
                  onMouseEnter={e=>{if(!a)e.currentTarget.style.color=C.txt;}} onMouseLeave={e=>{if(!a)e.currentTarget.style.color=C.mut;}}>
                  <I size={13} style={{flexShrink:0}}/>{l}
                </button>
              );
            })}
          </nav>
          <div style={{padding:"10px 12px",borderTop:`1px solid ${C.bdr}`}}>
            <button
              onClick={()=>setDark(d=>!d)}
              style={{display:"flex",alignItems:"center",gap:7,width:"100%",padding:"6px 10px",borderRadius:8,border:`1px solid ${C.bdr}`,background:"transparent",cursor:"pointer",marginBottom:8,transition:"background .15s",...mono(10,C.mut,600)}}
              onMouseEnter={e=>e.currentTarget.style.background=C.dim}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {dark?<Sun size={13} style={{color:C.amb}}/>:<Moon size={13} style={{color:C.sky}}/>}
              {dark?"Light mode":"Dark mode"}
            </button>
            {isAuthenticated ? (
              <UserMenu />
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,border:`1px solid ${C.grn}25`,background:C.grnBg}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:C.grn}}/>
                <span style={mono(9,C.grn)}>Demo Mode</span>
              </div>
            )}
            <div style={{...mono(8,C.mut),marginTop:8,lineHeight:1.6}}>⚠ Not financial advice.<br/>Markets involve risk.</div>
          </div>
        </aside>
        <main style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:isMobile?"14px 12px":"26px 30px",background:C.bg}}>
          {/* Hamburger button — mobile only */}
          {isMobile && (
            <button onClick={()=>setNavOpen(true)}
              style={{position:"fixed",top:10,left:10,zIndex:30,background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"7px 9px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,boxShadow:"0 2px 8px #0006"}}>
              <Menu size={15} style={{color:C.txt}}/>
            </button>
          )}
          <div style={{maxWidth:980,margin:"0 auto",paddingTop:isMobile?36:0}}>
            {detailSym
              ? <MacroDetailView sym={detailSym} onBack={()=>setDetailSym(null)}/>
              : (VIEWS[view]||VIEWS.markets)}
          </div>
        </main>
      </div>
    </ThemeCtx.Provider>
    </LoadingCtx.Provider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
// cache-bust 1774398688

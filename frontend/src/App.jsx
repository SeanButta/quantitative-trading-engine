import { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
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
  Compass, Shuffle, Network, Layers, Shield, Cpu, Newspaper
} from "lucide-react";

// ── Theme tokens ────────────────────────────────────────
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

  // ── Colour helpers ──────────────────────────────────────────────────────
  const vixCol    = r => r==="extreme_fear"?C.red : r==="fear"?"#ff8a65" : r==="calm"?C.amb : C.grn;
  const sentCol   = s => s>=60?C.grn : s>=40?C.amb : C.red;
  const chgColor  = c => c==null?C.mut : c>=0?C.grn : C.red;
  const curveCol  = r => r==="inverted"?C.red : r==="flat"?C.amb : C.grn;
  const stressCol = s => s==="high"?C.red : s==="elevated"?C.amb : C.grn;

  const fi = mkt?.fixed_income  || {};
  const cr = mkt?.credit        || {};
  const ca = mkt?.cross_asset   || [];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div>
          <Lbl>Market Overview</Lbl>
          <div style={mono(10,C.mut)}>Live market intelligence · 5-min cache · All tiers</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {mkt?.as_of && <Tag color={C.mut}>Updated {mkt.as_of.slice(11,16)} UTC</Tag>}
          <button onClick={()=>doFetch(true)}
            style={{display:"flex",alignItems:"center",gap:5,...mono(9,C.mut),padding:"5px 12px",
              borderRadius:8,border:`1px solid ${C.bdr}`,background:"transparent",cursor:"pointer"}}>
            <RefreshCw size={11}/> Refresh
          </button>
        </div>
      </div>

      {mktLoading && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"36px 0",display:"flex",
            alignItems:"center",justifyContent:"center",gap:10}}>
            <RefreshCw size={14}/> Fetching market data from yfinance…
          </div>
        </Card>
      )}
      {mktErr && !mktLoading && (
        <Card>
          <div style={{...mono(10,C.red),padding:"6px 0"}}>⚠ {mktErr}</div>
          <div style={{...mono(9,C.mut),marginTop:4}}>Make sure the FastAPI backend is running.</div>
        </Card>
      )}

      {mkt && <>

        {/* ══════════════════════════════════════════════════════════════
            TIER 1 — VOLATILITY & REGIME
        ══════════════════════════════════════════════════════════════ */}
        <SectionSep label="Volatility & Regime"/>
        <div style={{display:"grid",gridTemplateColumns:"1.1fr 1fr 1fr",gap:12}}>

          {/* VIX card */}
          <div onClick={()=>onDetail?.("^VIX")}
            style={{padding:"18px 20px",borderRadius:14,background:C.surf,cursor:"pointer",
              border:`1px solid ${C.bdr}`,borderLeft:`3px solid ${vixCol(mkt.vix.regime)}`,
              transition:"background .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background=vixCol(mkt.vix.regime)+"0a";}}
            onMouseLeave={e=>{e.currentTarget.style.background=C.surf;}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{...mono(8,C.mut,700),letterSpacing:"0.12em"}}>VIX · VOLATILITY INDEX</span>
              <span style={{...mono(8,vixCol(mkt.vix.regime),700),padding:"2px 8px",borderRadius:10,
                background:vixCol(mkt.vix.regime)+"1a"}}>
                {mkt.vix.regime?.replace(/_/g," ").toUpperCase()}
              </span>
            </div>
            <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:14}}>
              <span style={mono(42,vixCol(mkt.vix.regime),800)}>{mkt.vix.value?.toFixed(1)??"—"}</span>
              {mkt.vix.change_pct!=null && (
                <span style={mono(13,mkt.vix.change_pct>=0?C.red:C.grn,700)}>
                  {mkt.vix.change_pct>=0?"+":""}{mkt.vix.change_pct.toFixed(2)}%
                </span>
              )}
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {[["< 15","Complacent",C.grn],["15–20","Calm",C.amb],["20–30","Fear","#ff8a65"],["> 30","Panic",C.red]].map(([r,l,c])=>(
                <div key={r} style={{padding:"3px 8px",borderRadius:14,border:`1px solid ${c}35`,
                  background:c+"12",...mono(8,c,700)}}>{r} {l}</div>
              ))}
            </div>
          </div>

          {/* Fear & Greed — composite indicator, no dedicated ticker */}
          <div style={{padding:"18px 20px",borderRadius:14,background:C.surf,border:`1px solid ${C.bdr}`}}>
            <div style={{...mono(8,C.mut,700),letterSpacing:"0.12em",marginBottom:6}}>FEAR & GREED · COMPOSITE</div>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:12}}>
              <span style={mono(42,sentCol(mkt.sentiment.score),800)}>{mkt.sentiment.score}</span>
              <span style={mono(12,sentCol(mkt.sentiment.score),700)}>{mkt.sentiment.label}</span>
            </div>
            <div style={{position:"relative",marginBottom:6}}>
              <div style={{height:8,borderRadius:4,
                background:`linear-gradient(to right,${C.red},${C.amb} 50%,${C.grn})`}}/>
              <div style={{position:"absolute",top:-5,
                left:`${Math.min(Math.max(mkt.sentiment.score,1),99)}%`,
                width:3,height:18,background:C.headingTxt,borderRadius:2,
                transform:"translateX(-50%)",boxShadow:"0 0 5px rgba(0,0,0,.5)"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={mono(7,C.red)}>Fear</span>
              <span style={mono(7,C.mut)}>Neutral</span>
              <span style={mono(7,C.grn)}>Greed</span>
            </div>
            <div style={mono(8,C.mut)}>VIX (40%) · SPY momentum (35%) · Sector breadth (25%)</div>
          </div>

          {/* Yield Curve */}
          <div onClick={()=>onDetail?.("^TNX")}
            style={{padding:"18px 20px",borderRadius:14,background:C.surf,cursor:"pointer",
              border:`1px solid ${C.bdr}`,transition:"background .15s",
              borderLeft:`3px solid ${fi.curve_regime ? curveCol(fi.curve_regime) : C.bdr}`}}
            onMouseEnter={e=>{e.currentTarget.style.background=curveCol(fi.curve_regime||"steepening")+"0a";}}
            onMouseLeave={e=>{e.currentTarget.style.background=C.surf;}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{...mono(8,C.mut,700),letterSpacing:"0.12em"}}>10Y − 3M YIELD CURVE</span>
              {fi.curve_regime && (
                <span style={{...mono(8,curveCol(fi.curve_regime),700),padding:"2px 8px",borderRadius:10,
                  background:curveCol(fi.curve_regime)+"1a"}}>
                  {fi.curve_regime.toUpperCase()}
                </span>
              )}
            </div>
            {fi.yield_curve != null ? (<>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
                <span style={mono(38,curveCol(fi.curve_regime),800)}>
                  {fi.yield_curve >= 0 ? "+" : ""}{fi.yield_curve.toFixed(2)}%
                </span>
              </div>
              {/* Visual bar comparison */}
              {fi.ten_year?.value != null && fi.three_month?.value != null && (() => {
                const mx = Math.max(fi.ten_year.value, fi.three_month.value);
                return (
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {[["10Y", fi.ten_year.value, C.sky],["3M", fi.three_month.value, C.pur]].map(([lbl,val,col])=>(
                      <div key={lbl} style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{...mono(8,C.mut,700),width:22,flexShrink:0}}>{lbl}</span>
                        <div style={{flex:1,height:5,borderRadius:3,background:C.dim}}>
                          <div style={{width:`${(val/mx*100).toFixed(0)}%`,height:"100%",borderRadius:3,background:col,
                            transition:"width .3s"}}/>
                        </div>
                        <span style={{...mono(10,col,700),width:38,textAlign:"right"}}>{val.toFixed(2)}%</span>
                      </div>
                    ))}
                    <div style={mono(8,C.mut)}>
                      {fi.curve_regime==="inverted" ? "⚠ Inversion historically precedes recessions 12–18 mo." :
                       fi.curve_regime==="flat"      ? "Curve flattening — watch for further compression." :
                       "Normal shape — no near-term recession signal."}
                    </div>
                  </div>
                );
              })()}
            </>) : (
              <div style={mono(11,C.mut)}>Yield data unavailable</div>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            TIER 2 — EQUITY INDICES
        ══════════════════════════════════════════════════════════════ */}
        <SectionSep label="Equity Indices"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {mkt.indices.map(idx => {
            const names = {SPY:"S&P 500", QQQ:"Nasdaq 100", IWM:"Russell 2000", DIA:"Dow Jones"};
            return <MacroTile key={idx.symbol} sym={idx.symbol} name={names[idx.symbol]||idx.symbol}
              price={idx.price} chg={idx.change_pct} onClick={()=>onDetail?.(idx.symbol)}/>;
          })}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            TIER 3 — FIXED INCOME & CREDIT
        ══════════════════════════════════════════════════════════════ */}
        <SectionSep label="Fixed Income & Credit"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>

          {/* 10Y Treasury */}
          {[{sym:"^TNX",label:"10Y Treasury Yield",col:C.sky, val:fi.ten_year?.value,
              bps:fi.ten_year?.daily_chg_bp, extra:null},
            {sym:"^IRX",label:"3M T-Bill Yield",   col:C.pur, val:fi.three_month?.value,
              bps:fi.three_month?.daily_chg_bp, extra:null},
            {sym:"HYG", label:"High Yield Bonds",  col:C.headingTxt, price:cr.hyg?.price,
              chg:cr.hyg?.change_pct, badge: cr.stress ? {label:`Credit stress: ${cr.stress}`, col:stressCol(cr.stress)} : null},
            {sym:"LQD", label:"Invest. Grade Bonds",col:C.headingTxt, price:cr.lqd?.price,
              chg:cr.lqd?.change_pct, badge: cr.spread_change!=null ? {label:`HYG−LQD Δ ${cr.spread_change>=0?"+":""}${cr.spread_change?.toFixed(2)}%`, col:cr.spread_change>=0?C.grn:C.red} : null},
          ].map(t => (
            <div key={t.sym} onClick={()=>onDetail?.(t.sym)}
              style={{padding:"12px 14px",borderRadius:12,background:C.surf,border:`1px solid ${C.bdr}`,
                cursor:"pointer",transition:"border-color .15s, background .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=(t.col||C.mut)+"70"; e.currentTarget.style.background=(t.col||C.mut)+"08";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.bdr; e.currentTarget.style.background=C.surf;}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                <span style={{...mono(9,C.mut,700),letterSpacing:"0.06em"}}>{t.sym}</span>
                {t.chg != null && (
                  <span style={{...mono(8,chgColor(t.chg),700),padding:"2px 6px",borderRadius:8,background:chgColor(t.chg)+"16"}}>
                    {t.chg>=0?"+":""}{t.chg.toFixed(2)}%
                  </span>
                )}
              </div>
              <div style={{...mono(9,C.mut),marginBottom:6}}>{t.label}</div>
              <div style={mono(22,t.col,800)}>
                {t.val != null ? `${t.val.toFixed(2)}%` : t.price != null ? `$${t.price.toFixed(2)}` : "—"}
              </div>
              {t.bps != null && (
                <div style={mono(10,t.bps>=0?C.red:C.grn,700)}>
                  {t.bps>=0?"+":""}{t.bps.toFixed(0)} bps today
                </div>
              )}
              {t.badge && (
                <div style={{...mono(8,t.badge.col,700),marginTop:4,padding:"2px 8px",borderRadius:8,
                  background:t.badge.col+"16",display:"inline-block"}}>
                  {t.badge.label}
                </div>
              )}
              <div style={{...mono(7,C.mut),marginTop:3,opacity:0.55}}>↗ View 5Y chart</div>
            </div>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            TIER 4 — CROSS-ASSET
        ══════════════════════════════════════════════════════════════ */}
        <SectionSep label="Cross-Asset"/>
        {ca.length > 0 ? (
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {ca.map(a => <MacroTile key={a.symbol} sym={a.symbol} name={a.name} price={a.price} chg={a.change_pct}
            onClick={()=>onDetail?.(a.symbol)}/>)}
          </div>
        ) : (
          <Card><div style={mono(10,C.mut)}>Cross-asset data unavailable</div></Card>
        )}

        {/* Cross-asset signal legend */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[
            ["GLD","Gold ↑ = flight-to-safety / inflation hedge",C.amb],
            ["USO","Oil ↑ = inflationary pressure / global demand",C.red],
            ["COPX","Copper ↑ = global growth is healthy",C.grn],
            ["UUP","Dollar ↑ = risk-off / headwind for risk assets",C.sky],
          ].map(([sym,desc,col])=>(
            <div key={sym} style={{padding:"8px 10px",borderRadius:10,background:col+"08",
              border:`1px solid ${col}20`,display:"flex",gap:8,alignItems:"flex-start"}}>
              <span style={{...mono(8,col,700),flexShrink:0,paddingTop:1}}>{sym}</span>
              <span style={mono(8,C.mut)}>{desc}</span>
            </div>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            TIER 5 — SECTOR HEATMAP (collapsible)
        ══════════════════════════════════════════════════════════════ */}
        <SectionSep label="Sector Heatmap"/>
        <Card>
          {/* Clickable header */}
          <div onClick={()=>setSectorsOpen(o=>!o)}
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              cursor:"pointer",userSelect:"none",marginBottom: sectorsOpen ? 12 : 0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <Lbl>11 SPDR Sectors · Today</Lbl>
              <Tag color={mkt.sectors.filter(s=>s.change_pct>0).length>5?C.grn:C.red}>
                {mkt.sectors.filter(s=>s.change_pct>0).length}/11 advancing
              </Tag>
            </div>
            <span style={{...mono(9,C.mut),display:"flex",alignItems:"center",gap:5}}>
              {sectorsOpen ? <><ChevronRight size={12} style={{transform:"rotate(-90deg)"}}/> Collapse</>
                           : <><ChevronRight size={12} style={{transform:"rotate(90deg)"}}/> Expand</>}
            </span>
          </div>

          {/* Collapsed: mini pill strip */}
          {!sectorsOpen && (
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>
              {[...mkt.sectors].sort((a,b)=>b.change_pct-a.change_pct).map(s=>{
                const col = s.change_pct>=0?C.grn:C.red;
                return (
                  <div key={s.symbol} style={{padding:"3px 9px",borderRadius:8,background:col+"14",
                    border:`1px solid ${col}28`,...mono(8,col,700)}}>
                    {s.symbol} {s.change_pct>=0?"+":""}{s.change_pct.toFixed(1)}%
                  </div>
                );
              })}
            </div>
          )}

          {/* Expanded: full heatmap */}
          {sectorsOpen && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(125px,1fr))",gap:6}}>
              {mkt.sectors.map(s=>{
                const intensity = Math.min(Math.abs(s.change_pct)/2.5,1);
                const col = s.change_pct>=0?C.grn:C.red;
                const bg  = s.change_pct>=0
                  ? `rgba(0,230,118,${0.06+intensity*0.20})`
                  : `rgba(255,82,82,${0.06+intensity*0.20})`;
                return (
                  <div key={s.symbol} style={{padding:"10px 12px",borderRadius:10,background:bg,
                    border:`1px solid ${col}28`}}>
                    <div style={mono(9,col,700)}>{s.symbol}</div>
                    <div style={{...mono(9,C.txt),marginBottom:4,whiteSpace:"nowrap",
                      overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                    <div style={mono(14,col,800)}>{s.change_pct>=0?"+":""}{s.change_pct.toFixed(2)}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Quick Nav ── */}
        <SectionSep label="Actions"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {[{l:"Options Monitor",v:"options",I:Activity,c:C.grn},
            {l:"Run Backtest",v:"lab",I:FlaskConical,c:C.sky},
            {l:"Optimize Portfolio",v:"portfolio",I:Target,c:C.amb}].map(({l,v,I,c})=>(
            <button key={v} onClick={()=>onNav(v)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"13px 16px",borderRadius:12,border:`1px solid ${c}30`,
                background:"transparent",cursor:"pointer",...mono(12,c,700)}}
              onMouseEnter={e=>e.currentTarget.style.background=c+"10"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{display:"flex",alignItems:"center",gap:8}}><I size={14}/>{l}</span>
              <ArrowRight size={13}/>
            </button>
          ))}
        </div>
      </>}

      {/* ── Engine Status (always visible) ── */}
      <SectionSep label="Engine Status"/>
      <Card>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[["Data Layer","3 / 3",C.grn],["Signal Engine","5 active",C.grn],
            ["Options Feed","Live",C.grn],["Statistical Val","49 / 49",C.grn]].map(([k,v,c])=>(
            <div key={k} style={{padding:"10px 12px",borderRadius:10,background:c+"08",border:`1px solid ${c}22`}}>
              <div style={{...mono(8,C.mut,700),letterSpacing:"0.09em",marginBottom:4}}>{k.toUpperCase()}</div>
              <div style={mono(14,c,800)}>{v}</div>
              <div style={{...mono(8,C.mut),marginTop:2}}>operational</div>
            </div>
          ))}
        </div>
      </Card>

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

      // 1. Create project
      const pRes = await fetch("/api/projects", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({name:`Run ${new Date().toISOString().slice(0,16)}`, symbols:symList, start_date:startDate, end_date:endDate}),
      });
      if (!pRes.ok) throw new Error(`Create project: ${await pRes.text()}`);
      const proj = await pRes.json();

      // 2. Ingest
      setStep("ingesting");
      const iRes = await fetch(`/api/projects/${proj.id}/ingest`, {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
      if (!iRes.ok) throw new Error(`Ingest: ${await iRes.text()}`);

      // 3. Features
      setStep("features");
      const fRes = await fetch(`/api/projects/${proj.id}/features/compute`, {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
      if (!fRes.ok) throw new Error(`Features: ${await fRes.text()}`);

      // 4. Backtest
      setStep("backtesting");
      const bRes = await fetch(`/api/projects/${proj.id}/runs/backtest`, {
        method:"POST", headers:{"Content-Type":"application/json"},
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
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:12,marginBottom:14}}>
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
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>{ALL.map(s=><Pill key={s} label={s} active={sigs.includes(s)} onClick={()=>toggle(s)}/>)}</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
          {[["Fee (bps)",fee,setFee],["Slippage (bps)",slippage,setSlippage],["Risk-Free Rate %",rfr,setRfr]].map(([l,val,set])=>(
            <div key={l}><Lbl>{l}</Lbl>
              <input value={val} onChange={e=>set(e.target.value)}
                style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/>
            </div>
          ))}
        </div>

        <button onClick={go} disabled={!!running}
          style={{display:"flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:8,border:"none",cursor:running?"not-allowed":"pointer",background:running?C.dim:C.grn,color:running?C.mut:"#000",...mono(12,running?C.mut:"#000",700),transition:"all .15s"}}>
          {running ? <><RefreshCw size={14}/>Running…</> : <><Play size={14}/>Run Backtest</>}
        </button>

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

        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginTop:6}}>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginTop:6}}>
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
      style={{background: C.surf, border:`1px solid ${selected ? meta.col : hov ? C.txt+"28" : C.bdr}`,
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
    if (!selProject || pollActive) return;
    setResults(null);
    setJobStatus("pending");
    setPollActive(false);
    try {
      const r = await fetch(`/api/projects/${selProject}/signals/reading`, {
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
          <button onClick={analyze} disabled={!selProject || isRunning}
            style={{...mono(10, isRunning ? C.mut : C.bg, 700),
              background: isRunning ? C.dim : C.grn,
              border:"none",borderRadius:6,padding:"6px 16px",
              cursor: selProject && !isRunning ? "pointer" : "not-allowed",
              transition:"background .15s", display:"flex",alignItems:"center",gap:6}}>
            {isRunning && <RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>}
            {isRunning ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>

      {/* No project */}
      {!selProject && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"36px 0"}}>
            No project found. Create a project and compute features first, then come back here.
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

      {/* Empty prompt */}
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

function NewsView() {
  const C = useC();
  const [input,      setInput]      = useState("");
  const [symbol,     setSymbol]     = useState("market");
  const [articles,   setArticles]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [activeTag,  setActiveTag]  = useState("All");
  const [error,      setError]      = useState(null);
  const [lastFetch,  setLastFetch]  = useState(null);

  const loadFeed = async (sym) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/news/feed?symbol=${encodeURIComponent(sym)}&limit=60`);
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setArticles(d.articles || []);
      setLastFetch(new Date().toLocaleTimeString());
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  useEffect(()=>{ loadFeed("market"); }, []);

  const handleSearch = () => {
    const sym = input.trim().toUpperCase() || "market";
    setSymbol(sym); setActiveTag("All");
    loadFeed(sym);
  };

  const allTags = useMemo(()=>{
    const counts = {};
    articles.forEach(a => a.tags.forEach(t => { counts[t]=(counts[t]||0)+1; }));
    return ["All", ...Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([t])=>t)];
  }, [articles]);

  const filtered = activeTag==="All" ? articles : articles.filter(a=>a.tags.includes(activeTag));

  const bullCount = articles.filter(a=>a.score>0.1).length;
  const bearCount = articles.filter(a=>a.score<-0.1).length;
  const neutCount = articles.length - bullCount - bearCount;
  const avgScore  = articles.length ? (articles.reduce((s,a)=>s+a.score,0)/articles.length).toFixed(2) : "—";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div>
          <Lbl>Market News Feed</Lbl>
          <div style={mono(11,C.mut)}>Live financial news · RSS aggregated · sentiment-scored & tagged</div>
        </div>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          <input
            value={input}
            onChange={e=>setInput(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter"&&handleSearch()}
            placeholder="SPY, AAPL, market…"
            style={{padding:"7px 12px",borderRadius:8,border:`1.5px solid ${C.grn}55`,
              background:C.surf,color:C.headingTxt,fontFamily:"monospace",fontSize:13,
              fontWeight:600,outline:"none",width:170,boxSizing:"border-box"}}
          />
          <button onClick={handleSearch}
            style={{padding:"7px 16px",borderRadius:8,background:loading?C.dim:C.grn,
              color:loading?C.mut:"#000",...mono(12,loading?C.mut:"#000",700),border:"none",cursor:"pointer"}}>
            Search
          </button>
          <button onClick={()=>loadFeed(symbol)} title="Refresh"
            style={{padding:"7px 9px",borderRadius:8,background:"transparent",
              border:`1px solid ${C.bdr}`,cursor:"pointer",color:C.mut,lineHeight:0}}>
            <RefreshCw size={13} style={{color:C.mut}}/>
          </button>
        </div>
      </div>

      {/* Summary strip */}
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
          <span style={mono(10,C.mut)}>avg score: <span style={{color: parseFloat(avgScore)>0?C.grn:parseFloat(avgScore)<0?C.red:C.mut}}>{avgScore>0?"+":""}{avgScore}</span></span>
          {lastFetch && <span style={{...mono(9,C.mut),marginLeft:"auto"}}>fetched {lastFetch}</span>}
        </div>
      )}

      {/* Tag filter pills */}
      {articles.length>0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {allTags.map(tag=>{
            const tagColor = NEWS_TAG_COLORS[tag]||C.mut;
            const isActive = activeTag===tag;
            return (
              <button key={tag} onClick={()=>setActiveTag(tag)} style={{
                padding:"4px 11px", borderRadius:6, cursor:"pointer", transition:"all .15s",
                border:`1px solid ${isActive?tagColor+"60":C.bdr}`,
                background: isActive?tagColor+"18":"transparent",
                color: isActive?tagColor:C.mut,
                ...mono(10,"inherit",600),
              }}>{tag}</button>
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

      {/* Loading spinner */}
      {loading && (
        <div style={{display:"flex",justifyContent:"center",padding:48}}>
          <RefreshCw size={22} style={{color:C.grn,animation:"spin 1s linear infinite"}}/>
        </div>
      )}

      {/* Article feed */}
      {!loading && filtered.map((a,i)=><NewsCard key={i} article={a}/>)}

      {!loading && filtered.length===0 && !error && (
        <div style={{textAlign:"center",padding:48,...mono(12,C.mut)}}>
          {articles.length===0 ? "Enter a ticker or click Search for market news." : "No articles match this filter."}
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
      if (!r.ok) throw new Error(await r.text());
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
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12,marginBottom:14}}>
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
        <button onClick={run} disabled={loading}
          style={{display:"flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:8,border:"none",
            cursor:loading?"not-allowed":"pointer",background:loading?C.dim:C.grn,
            color:loading?C.mut:"#000",...mono(12,loading?C.mut:"#000",700),transition:"all .15s"}}>
          {loading ? <><RefreshCw size={14} style={{animation:"spin 1s linear infinite"}}/>Optimizing…</> : <><Target size={14}/>Optimize Portfolio</>}
        </button>
        {error && <div style={{marginTop:10,padding:10,borderRadius:8,background:C.red+"12",border:`1px solid ${C.red}30`,...mono(10,C.red)}}>⚠ {error}</div>}
      </Card>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        <Stat label="Expected Return (ann.)" value={live&&result.portfolio_return!=null?`${(result.portfolio_return*100).toFixed(2)}%`:"—"} color={C.grn} sub={live?"Black-Litterman posterior":"run optimizer"}/>
        <Stat label="Portfolio Volatility"   value={live&&result.portfolio_vol!=null?`${(result.portfolio_vol*100).toFixed(2)}%`:"—"}    color={C.amb} sub={live?"annualised":"run optimizer"}/>
        <Stat label="Sharpe Ratio"           value={live&&result.portfolio_sharpe!=null?result.portfolio_sharpe.toFixed(3):"—"}            color={C.sky} sub={live?"risk-free adj.":"run optimizer"}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
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
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginTop:8}}>
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
          <button onClick={loadCtx} disabled={ctxLoading}
            style={{display:"flex",alignItems:"center",gap:5,padding:"6px 14px",borderRadius:8,
              border:`1px solid ${C.bdr}`,background:"transparent",cursor:"pointer",...mono(10,C.mut)}}>
            {ctxLoading
              ? <RefreshCw size={11} style={{animation:"spin 1s linear infinite"}}/>
              : <Search size={11}/>}
            {ctxLoading ? "Loading…" : "Load"}
          </button>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginTop:8,marginBottom:14}}>
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
            <button onClick={runGBM} disabled={gbmLoad}
              style={{display:"flex",alignItems:"center",gap:7,padding:"8px 18px",borderRadius:8,
                border:"none",cursor:gbmLoad?"not-allowed":"pointer",
                background:gbmLoad?C.dim:C.grn,color:"#000",...mono(12,"#000",700)}}>
              {gbmLoad ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/>Simulating…</> : <>▶ Simulate</>}
            </button>
            {gbmRes && (<>
              <div style={{display:"flex",gap:16}}>
                <span style={mono(10,C.mut)}>final mean: <span style={{color:C.grn}}>${gbmRes.final_mean?.toFixed(2)}</span></span>
                <span style={mono(10,C.mut)}>5th–95th: <span style={{color:C.amb}}>${gbmRes.final_5th?.toFixed(2)} – ${gbmRes.final_95th?.toFixed(2)}</span></span>
                <span style={mono(10,C.mut)}>theory E[S(T)]: <span style={{color:C.sky}}>${gbmRes.theoretical_mean?.toFixed(2)}</span></span>
              </div>
            </>)}
          </div>
        </Card>

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
          <button onClick={runBS} disabled={bsLoad}
            style={{display:"flex",alignItems:"center",gap:7,padding:"8px 18px",borderRadius:8,
              border:"none",cursor:"pointer",background:bsLoad?C.dim:C.grn,
              color:"#000",...mono(12,"#000",700)}}>
            {bsLoad ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/>Pricing…</> : <>▶ Price Option</>}
          </button>
        </Card>

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
      </>)}

      {/* ── POSITION SIZING TAB ── */}
      {tab==="sizing"&&(<>
        <div>
          <Lbl>Conviction &amp; Position Sizing</Lbl>
          <div style={mono(11,C.mut)}>Set your directional P(bull), portfolio size, and expected win/loss ratio. Kelly criterion computes optimal allocation. Import P(profit) directly from a GBM run above.</div>
        </div>
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
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginTop:8}}>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginTop:8}}>
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

        {/* ── Report Synthesis ── */}
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

function OptionsView() {
  const C = useC();
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
  const [priceHistory, setPriceHistory] = useState([]);
  const [mlRecs,     setMlRecs]     = useState(null);   // backend ML recommender
  const [mlRecLoad,  setMlRecLoad]  = useState(false);
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
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({symbols:[sym], risk_free_rate:0.05}),
    });
    if (!r.ok) { setError(await r.text()); setRefreshing(false); return; }
    const j = await r.json();
    setJobId(j.job_id);
    pollJob(j.job_id, sym);  // pass sym so the closure is always correct
  };

  const loadChain = async (sym, exp) => {
    setLoading(true); setError(null);
    try {
      const url = exp ? `/api/options/${sym}/${exp}` : `/api/options/${sym}`;
      const r = await fetch(url);
      if (!r.ok) { setError(`No data for ${sym}. Click Fetch to download.`); setLoading(false); return; }
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

  const calls = visibleChain.filter(r=>r.option_type==="call").sort((a,b)=>a.strike-b.strike);
  const puts  = visibleChain.filter(r=>r.option_type==="put").sort((a,b)=>a.strike-b.strike);
  const spot  = visibleChain[0]?.spot || null;

  // Merge by strike
  const strikesSet = new Set([...calls.map(r=>r.strike), ...puts.map(r=>r.strike)]);
  const strikes = [...strikesSet].sort((a,b)=>a-b);
  const callByStrike = Object.fromEntries(calls.map(r=>[r.strike,r]));
  const putByStrike  = Object.fromEntries(puts.map(r=>[r.strike,r]));

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
          <button onClick={handleLoad} disabled={loading}
            style={{padding:"8px 18px",borderRadius:8,border:"none",background:C.sky,color:"#000",...mono(11,"#000",700),cursor:loading?"not-allowed":"pointer"}}>
            {loading ? <><RefreshCw size={12}/> Loading…</> : "Load Chain"}
          </button>
          <button onClick={fetchRefresh} disabled={refreshing}
            style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${C.grn}50`,background:"transparent",...mono(11,refreshing?C.mut:C.grn,700),cursor:refreshing?"not-allowed":"pointer"}}>
            {refreshing ? <><RefreshCw size={12}/> Fetching…</> : "↓ Fetch / Refresh"}
          </button>
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
            <div style={{display:"flex",gap:16,marginTop:8}}>
              {[["attractive","#00e676","● Attractive"],["neutral","#ffb300","● Median"],["unattractive","#ff5252","● Unattractive"]].map(([k,col,lbl])=>(
                <span key={k} style={{...mono(9,col,700)}}>{lbl}</span>
              ))}
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
                const col = isActive ? "#00e676" : C.txt;
                return (
                  <button key={key} onClick={()=>{
                    if(isActive){ setActiveStrategy(null); }
                    else {
                      setActiveStrategy(key);
                      if(CALL_ONLY.has(key))      setChainView("calls");
                      else if(PUT_ONLY.has(key))  setChainView("puts");
                      // else leave current view
                    }
                  }}
                    style={{
                      ...mono(10,isActive?"#001a0a":col, isActive?700:400),
                      padding:"5px 14px", borderRadius:20,
                      border:`1px solid ${isActive?"#00e676":C.bdr}`,
                      background: isActive ? "#00e676" : C.dim,
                      cursor:"pointer", transition:"all .15s",
                      boxShadow: isActive ? "0 0 8px #00e67640" : "none",
                    }}>
                    {strat.label}
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
        {activeStrategy && !topOpps.length && visibleChain.length > 0 && (
          <div style={{...mono(9,C.mut),marginTop:14,paddingTop:12,borderTop:`1px solid ${C.bdr}`,textAlign:"center",color:C.mut}}>
            No "attractive" contracts for this strategy in the current expiration — try a different date or strategy.
          </div>
        )}
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
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:12}}>
            <Lbl>
              {chainView==="calls"?"Calls":chainView==="puts"?"Puts":"Chain"}
              {selExp ? ` — ${selExp} · ${chainView==="calls"?calls.length:chainView==="puts"?puts.length:strikes.length} strikes` : ""}
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
                {strikes.map(strike=>{
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
                {(chainView==="calls" ? calls : puts).map(row=>{
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
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({holdings:h,risk_free_rate:rfr/100}),
      });
      const d=await r.json();
      if(!r.ok) throw new Error(d.detail||"Failed");
      setJobId(d.job_id);
    } catch(e){ setError(e.message); setLoading(false); }
  }

  function addHolding(){
    if(!newTicker.trim()) return;
    const v=parseFloat(newVal)||( inputMode==="shares"?10:10 );
    if(inputMode==="shares")
      setHoldings(h=>[...h,{ticker:newTicker.toUpperCase().trim(),shares:v,weight:0}]);
    else
      setHoldings(h=>[...h,{ticker:newTicker.toUpperCase().trim(),weight:v,shares:0}]);
    setNewTicker(""); setNewVal("");
  }
  function removeHolding(i){ setHoldings(h=>h.filter((_,idx)=>idx!==i)); }
  function updateField(i,field,val){
    setHoldings(h=>h.map((item,idx)=>idx===i?{...item,[field]:parseFloat(val)||0}:item));
  }

  const pctFmt = v => v==null?"—":`${(v*100).toFixed(2)}%`;
  const valCol = (v,invert)=>{ if(v==null)return C.mut; if(invert) return v<0?C.grn:v>0?C.red:C.mut; return v>0?C.grn:v<0?C.red:C.mut; };
  const m = results?.metrics;
  const [stressRes,  setStressRes]  = useState(null);
  const [stressLoad, setStressLoad] = useState(false);

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
                {["Ticker", inputMode==="shares"?"Shares":"Weight", "Allocation",""].map((h,i)=>(
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
                return (
                  <tr key={i} style={{borderBottom:`1px solid ${C.bdr}20`}}>
                    <td style={{padding:"6px 10px",fontWeight:700,color:C.headingTxt}}>{h.ticker}</td>
                    <td style={{padding:"6px 10px"}}>
                      <input type="number" value={rawVal||""} min={0}
                        step={isShares?1:1} placeholder={isShares?"qty":"wt"}
                        onChange={e=>updateField(i, isShares?"shares":"weight", e.target.value)}
                        style={{width:80,background:C.dim,border:`1px solid ${C.bdr}`,borderRadius:6,
                          padding:"3px 6px",color:C.txt,...mono(11)}}/>
                      {isShares && (
                        <span style={{...mono(9,C.mut),marginLeft:5}}>shares</span>
                      )}
                    </td>
                    <td style={{padding:"6px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,minWidth:120}}>
                        <div style={{flex:1,height:5,background:C.dim,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${alloc}%`,height:"100%",background:C.sky,borderRadius:3}}/>
                        </div>
                        <span style={mono(10,C.mut,600)}>{alloc.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{padding:"6px 10px",textAlign:"center"}}>
                      <button onClick={()=>removeHolding(i)}
                        style={{background:"transparent",border:"none",cursor:"pointer",
                          color:C.red,fontSize:16,lineHeight:1,padding:"0 4px"}}>×</button>
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
            <span style={mono(10,C.mut)}>Risk-Free Rate</span>
            <input type="number" value={rfr} min={0} max={20} step={0.1}
              onChange={e=>setRfr(parseFloat(e.target.value)||0)}
              style={{width:52,background:C.dim,border:`1px solid ${C.bdr}`,borderRadius:6,
                padding:"3px 6px",color:C.txt,...mono(11)}}/>
            <span style={mono(10,C.mut)}>%</span>
          </div>
          <button onClick={runAnalysis} disabled={loading||holdings.length===0}
            style={{padding:"7px 22px",borderRadius:8,border:`1px solid ${C.grn}`,
              background:loading?C.grnBg:`${C.grn}18`,cursor:loading?"not-allowed":"pointer",
              ...mono(11,loading?C.mut:C.grn,700),display:"flex",alignItems:"center",gap:6}}>
            {loading
              ? <><RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/> Analysing…</>
              : <><Play size={12}/> Run Analysis</>}
          </button>
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

  const CM = {top:0,right:0,bottom:0,left:0};
  const xAx = {dataKey:"date",type:"category",height:TV_X_AX_H,tick:{fill:"#787b86",fontSize:9,fontFamily:"monospace"},tickLine:false,axisLine:{stroke:"#2a2e39"},interval:"preserveStartEnd",padding:{left:0,right:0}};
  const yAx = {type:"number",domain:yDomain,orientation:"right",width:TV_Y_AX_W,tick:{fill:"#787b86",fontSize:9,fontFamily:"monospace"},tickLine:false,axisLine:false,tickFormatter:v=>v.toFixed(0),allowDataOverflow:false,label:{value:`${sym} Price ($)`,angle:90,position:"insideRight",offset:16,style:{fontFamily:"monospace",fontSize:8,fill:"#787b86",textAnchor:"middle"}}};
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
              return (
                <button key={sig.id}
                  onClick={()=>setSelectedSignal(isSel ? null : sig.id)}
                  title={active ? `${sig.desc || sig.name} — ${sig.action || ""}` : `${sig.name} — not triggered`}
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
                  }}>
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
              {godMode.primary_signals?.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontFamily:"monospace",fontSize:9,color:"#787b86",marginBottom:5,letterSpacing:".06em"}}>PRIMARY DRIVERS</div>
                  {godMode.primary_signals.map((s,i)=>(
                    <div key={i} style={{fontFamily:"monospace",fontSize:9,color:"#d1d4dc",padding:"2px 0",borderBottom:"1px solid #2a2e3944"}}>
                      · {s}
                    </div>
                  ))}
                </div>
              )}
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
              color:showGodMode?"#f6c90e":"#787b86",background:showGodMode?"#f6c90e18":"transparent",
              border:`1px solid ${showGodMode?"#f6c90e55":"#2a2e39"}`,borderRadius:6,
              padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontWeight:700}}>
              ⚡ God Mode
            </button>
            <button onClick={load} style={{fontFamily:"monospace",fontSize:12,color:"#787b86",
              background:"transparent",border:"1px solid #2a2e39",borderRadius:6,
              padding:"4px 9px",cursor:"pointer"}} title="Refresh">↺</button>
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
            <button onClick={load} style={{fontFamily:"monospace",fontSize:10,color:TV_G,
              background:"#26a69a15",border:"1px solid #26a69a40",borderRadius:6,
              padding:"6px 16px",cursor:"pointer",marginTop:10}}>Apply & Reload</button>
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
              tip:"Average True Range — avg daily price range (volatility). Higher = bigger swings."},
            {l:"RSI (14)",   v:lastBar.rsi!=null?lastBar.rsi.toFixed(1):"–",
              c:lastBar.rsi>70?TV_R:lastBar.rsi<30?TV_G:"#d1d4dc",
              tip:"Relative Strength Index. >70 overbought (sell signal), <30 oversold (buy signal)."},
            {l:"MACD Hist",  v:lastBar.macd_h!=null?lastBar.macd_h.toFixed(4):"–",
              c:lastBar.macd_h>=0?TV_G:TV_R,
              tip:"MACD histogram = MACD minus Signal. Positive = bullish momentum strengthening."},
            {l:"Stoch %K",   v:lastBar.stoch_k!=null?lastBar.stoch_k.toFixed(1)+"%" :"–",
              c:lastBar.stoch_k>80?TV_R:lastBar.stoch_k<20?TV_G:"#d1d4dc",
              tip:"Stochastic oscillator. >80 overbought, <20 oversold. %K crosses %D = signal."},
            {l:"BB Width",   v:lastBar.bb_upper&&lastBar.bb_lower?((lastBar.bb_upper-lastBar.bb_lower)/lastBar.close*100).toFixed(2)+"%":"–",
              c:C.pur, tip:"Bollinger Band Width as % of price. Squeeze (low width) precedes breakout."},
            {l:"Williams %R",v:lastBar.wr!=null?lastBar.wr.toFixed(1):"–",
              c:lastBar.wr>-20?TV_R:lastBar.wr<-80?TV_G:"#d1d4dc",
              tip:"Williams %R (momentum). >−20 overbought, <−80 oversold. Scale is −100 to 0."},
          ].map(({l,v,c,tip})=>(
            <Card key={l}>
              <InfoTip desc={tip}><Lbl>{l}</Lbl></InfoTip>
              <div style={mono(18,c,700)}>{v}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
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
  // ── State ────────────────────────────────────────────────────────────────
  const [catalog,      setCatalog]      = useState({});
  const [openCats,     setOpenCats]     = useState({});         // {catName: bool}
  const [activeSeries, setActiveSeries] = useState([]);         // [{id,name,unit,color,obs,info}]
  const [period,       setPeriod]       = useState("5y");
  const [units,        setUnits]        = useState("lin");
  const [loading,      setLoading]      = useState(false);
  const [summary,      setSummary]      = useState(null);       // summary for primary series
  const [searchQ,      setSearchQ]      = useState("");
  const [searchResults,setSearchResults]= useState([]);
  const [searching,    setSearching]    = useState(false);
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [tickerInput,  setTickerInput]  = useState("");      // stock ticker overlay input
  const [tickerError,  setTickerError]  = useState("");      // brief error message

  // ── Load catalog once ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/macro/catalog").then(r=>r.json()).then(d=>{
      setCatalog(d.catalog||{});
      // Open first category by default
      const first = Object.keys(d.catalog||{})[0];
      if (first) setOpenCats({[first]:true});
    }).catch(()=>{});
  }, []);

  // ── Load series data ──────────────────────────────────────────────────────
  const loadSeries = async (seriesId, seriesName, color, replace=true) => {
    setLoading(true);
    try {
      // Only fetch summary for primary series (replace=true), not for overlays
      const fetches = [
        fetch(`/api/macro/series/${seriesId}?period=${period}&units=${units}`).then(r=>r.json()),
        replace ? fetch(`/api/macro/summary/${seriesId}`).then(r=>r.json()) : Promise.resolve(null),
      ];
      const [obsRes, sumRes] = await Promise.all(fetches);
      const newEntry = {
        id:    seriesId,
        name:  obsRes.info?.title || seriesName,
        unit:  obsRes.info?.units_short || "",
        freq:  obsRes.info?.frequency_short || "",
        obs:   obsRes.observations || [],
        info:  obsRes.info || {},
        color: color,
      };
      if (replace) {
        setActiveSeries([newEntry]);
        setSummary(sumRes);   // only update summary for the primary series
      } else {
        setActiveSeries(prev => {
          const exists = prev.find(s=>s.id===seriesId);
          if (exists) return prev;
          return [...prev, newEntry];
        });
        // overlay: keep existing primary summary unchanged
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Load stock ticker as overlay ─────────────────────────────────────────
  const loadTicker = async (symbol) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setTickerError("");
    setLoading(true);
    try {
      const r = await fetch(`/api/market/price/${encodeURIComponent(sym)}?period=${period}`);
      if (!r.ok) throw new Error(`No data for ${sym}`);
      const d = await r.json();
      const raw = d.data || d.ohlcv || [];   // backend returns "data" key
      const obs = raw
        .filter(p => p.close != null)
        .map(p => ({ date: (p.date||"").slice(0,10), value: p.close }));
      if (!obs.length) throw new Error(`No price data for ${sym}`);
      const color = MACRO_OVERLAY_COLORS[activeSeries.length % MACRO_OVERLAY_COLORS.length];
      const newEntry = {
        id:   sym,
        name: `${sym} (Stock)`,
        unit: "$",
        freq: "D",
        obs,
        info: { title: `${sym} Stock Price`, units_short: "$", frequency: "Daily" },
        color,
        type: "ticker",
      };
      setActiveSeries(prev => {
        if (prev.find(s=>s.id===sym)) return prev;   // already loaded
        return [...prev, newEntry];
      });
    } catch(e) {
      setTickerError(e.message);
      setTimeout(() => setTickerError(""), 3000);
    } finally {
      setLoading(false);
    }
  };

  // ── Re-fetch when period or units changes ────────────────────────────────
  useEffect(() => {
    if (!activeSeries.length) return;
    setLoading(true);
    Promise.all(activeSeries.map((s) => {
      if (s.type === "ticker") {
        // Re-fetch ticker data for the new period
        return fetch(`/api/market/price/${encodeURIComponent(s.id)}?period=${period}`)
          .then(r => r.ok ? r.json() : { ohlcv:[] })
          .then(d => ({
            ...s,
            obs: (d.data||d.ohlcv||[]).filter(p=>p.close!=null).map(p=>({date:(p.date||"").slice(0,10),value:p.close}))
          }));
      }
      return fetch(`/api/macro/series/${s.id}?period=${period}&units=${units}`).then(r=>r.json())
        .then(d => ({ ...s, obs: d.observations||[], info: d.info||{} }));
    })).then(updated => { setActiveSeries(updated); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period, units]); // eslint-disable-line

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchQ.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/macro/search?q=${encodeURIComponent(searchQ)}&limit=12`)
        .then(r=>r.json()).then(d=>{ setSearchResults(d.results||[]); setSearching(false); })
        .catch(()=>setSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [searchQ]);

  // ── Build merged chart data ───────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!activeSeries.length) return [];
    // Build date-indexed map from all series
    const map = {};
    activeSeries.forEach((s,i) => {
      s.obs.forEach(o => {
        if (!map[o.date]) map[o.date] = { date: o.date };
        map[o.date][`v${i}`] = o.value;
      });
    });
    return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
  }, [activeSeries]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const primaryObs = activeSeries[0]?.obs || [];
  const lastVal    = primaryObs.at(-1)?.value ?? null;
  const prevVal    = primaryObs.at(-2)?.value ?? null;
  const lastDate   = primaryObs.at(-1)?.date  ?? "—";

  const fmtVal = (v, unitShort) => {
    if (v == null) return "—";
    const us = (unitShort||"").toLowerCase();
    if (us.includes("percent") || us.includes("rate") || us.includes("%")) return `${v.toFixed(2)}%`;
    if (us.includes("billion") || us.includes("bil")) return `$${v.toLocaleString("en",{minimumFractionDigits:1,maximumFractionDigits:1})}B`;
    if (us.includes("million") || us.includes("mil")) return `$${v.toLocaleString("en",{minimumFractionDigits:0,maximumFractionDigits:0})}M`;
    if (us.includes("thousand")) return `${v.toLocaleString("en",{maximumFractionDigits:0})}K`;
    if (v >= 1e6) return `${(v/1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${v.toLocaleString("en",{maximumFractionDigits:1})}`;
    return v.toFixed(4).replace(/\.?0+$/, "");
  };

  const tvBtn = (active, onClick, label) => (
    <button onClick={onClick} style={{
      fontFamily:"monospace",fontSize:10,fontWeight:active?700:400,
      color:active?C.headingTxt:C.mut,
      background:active?C.dim:"transparent",
      border:"none",borderRadius:4,padding:"3px 9px",cursor:"pointer",
    }}>{label}</button>
  );

  const primarySeries = activeSeries[0];
  const regimeMeta    = summary?.regime ? REGIME_META[summary.regime] : null;

  // Subsample chart to max 400 points for performance
  const displayData = useMemo(() => {
    if (!chartData.length) return [];
    const step = Math.max(1, Math.floor(chartData.length / 400));
    return chartData.filter((_, i) => i % step === 0);
  }, [chartData]);

  // Y-axis domains per series
  const yDomain0 = useMemo(() => {
    const vals = (activeSeries[0]?.obs || []).map(o=>o.value).filter(v=>v!=null && isFinite(v));
    if (!vals.length) return ["auto","auto"];
    const mn=Math.min(...vals), mx=Math.max(...vals), pad=(mx-mn)*0.05||Math.abs(mn)*0.05||1;
    return [mn-pad, mx+pad];
  }, [activeSeries]);

  const yDomain1 = useMemo(() => {
    if (activeSeries.length < 2) return ["auto","auto"];
    // Use min/max across ALL overlay series so they share a sensible left axis
    const vals = activeSeries.slice(1).flatMap(s=>(s.obs||[]).map(o=>o.value)).filter(v=>v!=null && isFinite(v));
    if (!vals.length) return ["auto","auto"];
    const mn=Math.min(...vals), mx=Math.max(...vals), pad=(mx-mn)*0.05||Math.abs(mn)*0.05||1;
    return [mn-pad, mx+pad];
  }, [activeSeries]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:0,minHeight:"100vh"}}>
      {/* ── Top header bar ─────────────────────────────────────────────── */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,flexWrap:"wrap"}}>
        <Database size={16} style={{color:C.sky,flexShrink:0}}/>
        <span style={{...mono(14,C.headingTxt,700)}}>FRED Macro Intelligence</span>
        <span style={{fontFamily:"monospace",fontSize:9,color:C.mut,
          background:C.dim,borderRadius:4,padding:"2px 7px"}}>Federal Reserve Economic Data</span>
        {/* Search */}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <Search size={11} style={{position:"absolute",left:8,color:C.mut,pointerEvents:"none"}}/>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
              placeholder="Search FRED series…"
              style={{fontFamily:"monospace",fontSize:11,color:C.txt,background:C.dim,
                border:`1px solid ${C.bdr}`,borderRadius:7,padding:"5px 10px 5px 26px",
                width:220,outline:"none"}}/>
            {searchQ && <button onClick={()=>{setSearchQ(""); setSearchResults([]);}}
              style={{position:"absolute",right:6,background:"none",border:"none",cursor:"pointer",padding:2,color:C.mut}}>
              <X size={10}/></button>}
          </div>
        </div>
      </div>

      {/* ── Main layout: sidebar + chart ──────────────────────────────── */}
      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>

        {/* ── Left sidebar: catalog ────────────────────────────────────── */}
        <div style={{width:230,flexShrink:0,background:C.surf,border:`1px solid ${C.bdr}`,
          borderRadius:12,overflow:"hidden",maxHeight:"calc(100vh - 120px)",overflowY:"auto"}}>
          <div style={{padding:"10px 12px 6px",fontFamily:"monospace",fontSize:9,color:C.mut,
            letterSpacing:".08em",borderBottom:`1px solid ${C.bdr}`}}>
            SERIES CATALOG
          </div>
          {Object.entries(catalog).map(([cat, series]) => (
            <div key={cat}>
              <div onClick={()=>setOpenCats(p=>({...p,[cat]:!p[cat]}))}
                style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"7px 12px",cursor:"pointer",userSelect:"none",
                  background:openCats[cat]?C.dim:"transparent",
                  transition:"background .1s"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.dim}
                onMouseLeave={e=>e.currentTarget.style.background=openCats[cat]?C.dim:"transparent"}>
                <span style={{fontFamily:"monospace",fontSize:10,color:C.txt,fontWeight:600}}>{cat}</span>
                {openCats[cat]
                  ? <ChevronUp size={12} style={{color:C.mut,flexShrink:0}}/>
                  : <ChevronDown size={12} style={{color:C.mut,flexShrink:0}}/>}
              </div>
              {openCats[cat] && (series||[]).map(s => {
                const isActive = activeSeries.some(a=>a.id===s.id);
                const isFirst  = activeSeries[0]?.id === s.id;
                return (
                  <div key={s.id}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px 5px 20px",
                      cursor:"pointer",background:isFirst?"#40c4ff14":isActive?"#40c4ff08":"transparent",
                      transition:"background .1s",borderLeft:isFirst?`2px solid #40c4ff`:isActive?`2px solid #40c4ff44`:"2px solid transparent"}}
                    onMouseEnter={e=>{ if(!isFirst) e.currentTarget.style.background=C.dim; }}
                    onMouseLeave={e=>{ e.currentTarget.style.background=isFirst?"#40c4ff14":isActive?"#40c4ff08":"transparent"; }}>
                    <div style={{flex:1,minWidth:0}} onClick={()=>loadSeries(s.id, s.name, "#40c4ff", true)}>
                      <div style={{fontFamily:"monospace",fontSize:10,color:isFirst?C.sky:C.txt,
                        fontWeight:isFirst?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                      <div style={{fontFamily:"monospace",fontSize:8,color:C.mut}}>{s.id} · {s.freq}</div>
                    </div>
                    {isFirst
                      ? <div style={{width:6,height:6,borderRadius:"50%",background:"#40c4ff",flexShrink:0}}/>
                      : isActive
                        ? <button onClick={e=>{e.stopPropagation(); setActiveSeries(p=>p.filter(a=>a.id!==s.id));}}
                            title="Remove overlay"
                            style={{background:"none",border:"none",cursor:"pointer",padding:1,color:C.red,flexShrink:0}}>
                            <X size={11}/>
                          </button>
                        : <button onClick={e=>{e.stopPropagation(); loadSeries(s.id,s.name,MACRO_OVERLAY_COLORS[activeSeries.length%MACRO_OVERLAY_COLORS.length],false);}}
                            title="Add as overlay"
                            style={{background:"none",border:"none",cursor:"pointer",padding:"1px 3px",
                              color:C.grn,flexShrink:0,fontFamily:"monospace",fontSize:12,fontWeight:700,lineHeight:1}}>
                            +
                          </button>
                    }
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Right: chart + summary ───────────────────────────────────── */}
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:12}}>

          {/* Active series chips + ticker input */}
          <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
            {activeSeries.map((s,i) => (
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:5,
                background:s.color+"20",border:`1px solid ${s.color}44`,
                borderRadius:20,padding:"3px 10px"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                <span style={{fontFamily:"monospace",fontSize:10,color:s.color,fontWeight:700}}>{s.id}</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:C.mut,maxWidth:180,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                {i > 0 && (
                  <button onClick={()=>setActiveSeries(p=>p.filter((_,j)=>j!==i))}
                    style={{background:"none",border:"none",cursor:"pointer",padding:1,color:C.mut,display:"flex"}}>
                    <X size={10}/>
                  </button>
                )}
              </div>
            ))}
            {/* Stock ticker overlay input */}
            <div style={{display:"flex",gap:3,alignItems:"center"}}>
              <input value={tickerInput} onChange={e=>setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={e=>{ if(e.key==="Enter"){ const v=tickerInput.trim().toUpperCase(); if(v){loadTicker(v);setTickerInput("");} } }}
                placeholder="+ Stock ticker"
                style={{fontFamily:"monospace",fontSize:10,color:C.txt,background:C.dim,
                  border:`1px solid ${C.bdr}`,borderRadius:14,padding:"3px 10px",width:110,outline:"none"}}/>
              <button onClick={()=>{ const v=tickerInput.trim().toUpperCase(); if(v){loadTicker(v);setTickerInput("");} }}
                style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:C.grn,
                  background:"none",border:`1px solid ${C.grn}44`,borderRadius:10,
                  padding:"2px 8px",cursor:"pointer",lineHeight:1}}>↵</button>
            </div>
            {loading && <span style={{fontFamily:"monospace",fontSize:9,color:C.mut}}>Loading…</span>}
            {tickerError && <span style={{fontFamily:"monospace",fontSize:9,color:C.red}}>{tickerError}</span>}
          </div>

          {/* Toolbar: period + units */}
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
            background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:10,padding:"6px 10px"}}>
            <div style={{display:"flex",gap:1}}>
              {MACRO_PERIODS.map(({l,v})=><span key={v}>{tvBtn(period===v,()=>setPeriod(v),l)}</span>)}
            </div>
            <div style={{width:1,height:16,background:C.bdr}}/>
            <div style={{display:"flex",gap:1}}>
              {MACRO_UNITS.map(({l,v})=><span key={v}>{tvBtn(units===v,()=>setUnits(v),l)}</span>)}
            </div>
            {primarySeries && (
              <>
                <div style={{width:1,height:16,background:C.bdr}}/>
                <span style={{fontFamily:"monospace",fontSize:9,color:C.mut}}>
                  {primarySeries.info?.frequency} · {primarySeries.info?.seasonal_adjustment_short}
                  {primarySeries.info?.last_updated && ` · Updated ${primarySeries.info.last_updated.slice(0,10)}`}
                </span>
              </>
            )}
          </div>

          {/* Chart */}
          <div style={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,padding:"14px 4px 8px 4px"}}>
            {!activeSeries.length ? (
              <div style={{height:320,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10}}>
                <BookOpen size={28} style={{color:C.mut}}/>
                <span style={{fontFamily:"monospace",fontSize:12,color:C.mut}}>Select a series from the catalog</span>
                <span style={{fontFamily:"monospace",fontSize:10,color:C.mut,opacity:.6}}>or search for any FRED series above</span>
              </div>
            ) : (
              <>
                {/* Chart header */}
                <div style={{padding:"0 12px 10px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:13,color:C.headingTxt,fontWeight:700}}>
                      {primarySeries?.name || ""}
                    </div>
                    <div style={{fontFamily:"monospace",fontSize:9,color:C.mut,marginTop:2}}>
                      {primarySeries?.id} · FRED · {units==="lin"?"Level":units==="pc1"?"YoY %":"MoM %"}
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                    <div style={{fontFamily:"monospace",fontSize:20,fontWeight:800,
                      color:regimeMeta?.color || C.headingTxt}}>
                      {fmtVal(lastVal, primarySeries?.unit)}
                    </div>
                    {prevVal != null && lastVal != null && (
                      <div style={{fontFamily:"monospace",fontSize:10,
                        color:(lastVal-prevVal)>=0 ? C.grn : C.red}}>
                        {(lastVal-prevVal)>=0?"+":""}{(lastVal-prevVal).toFixed(3)} · {lastDate}
                      </div>
                    )}
                    {regimeMeta && (
                      <div style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                        color:regimeMeta.color,background:regimeMeta.color+"18",
                        borderRadius:4,padding:"2px 7px"}}>
                        {regimeMeta.label}
                      </div>
                    )}
                  </div>
                </div>

                {/* Recharts */}
                <ChartPanel title={primarySeries?.name || "Macro Chart"} defaultHeight={300}>
                {(chartH) => (
                <ResponsiveContainer width="100%" height={chartH}>
                  <ComposedChart data={displayData}
                    margin={{top:10,right:74,bottom:20,left:activeSeries.length>1?74:0}}>
                    <CartesianGrid strokeDasharray="2 4" stroke={C.bdr} vertical={false}/>
                    <XAxis dataKey="date" type="category"
                      tick={{fill:C.mut,fontSize:9,fontFamily:"monospace"}}
                      tickLine={false} axisLine={{stroke:C.bdr}}
                      interval="preserveStartEnd" height={22}/>
                    <YAxis yAxisId="y0" orientation="right" width={60}
                      domain={yDomain0} tickFormatter={v=>fmtVal(v,activeSeries[0]?.unit)}
                      tick={{fill:C.sky,fontSize:8,fontFamily:"monospace"}} tickLine={false} axisLine={false}
                      label={{value:`${activeSeries[0]?.id||""} (${activeSeries[0]?.unit||""})`,
                        angle:90,position:"insideRight",offset:14,
                        style:{fontFamily:"monospace",fontSize:8,fill:C.sky,textAnchor:"middle"}}}/>
                    {activeSeries.length > 1 && (
                      <YAxis yAxisId="y1" orientation="left" width={60}
                        domain={yDomain1} tickFormatter={v=>fmtVal(v,activeSeries[1]?.unit)}
                        tick={{fill:MACRO_OVERLAY_COLORS[1%MACRO_OVERLAY_COLORS.length],fontSize:8,fontFamily:"monospace"}}
                        tickLine={false} axisLine={false}
                        label={{value:`${activeSeries[1]?.id||""} (${activeSeries[1]?.unit||""})`,
                          angle:-90,position:"insideLeft",offset:14,
                          style:{fontFamily:"monospace",fontSize:8,
                            fill:MACRO_OVERLAY_COLORS[1%MACRO_OVERLAY_COLORS.length],textAnchor:"middle"}}}/>
                    )}
                    <Tooltip
                      contentStyle={{background:C.surf,border:`1px solid ${C.bdr}`,
                        borderRadius:8,fontFamily:"monospace",fontSize:10,padding:"8px 12px"}}
                      labelStyle={{color:C.mut,marginBottom:4}}
                      formatter={(val,name)=>{
                        const idx = parseInt(name.replace("v",""));
                        return [fmtVal(val,activeSeries[idx]?.unit), activeSeries[idx]?.id||name];
                      }}/>
                    {/* Primary area */}
                    <Area yAxisId="y0" type="monotone" dataKey="v0"
                      stroke="#40c4ff" strokeWidth={1.5}
                      fill="#40c4ff" fillOpacity={0.07} dot={false} connectNulls/>
                    {/* Overlay lines — all on left axis (y1) for clear dual-scale comparison */}
                    {activeSeries.slice(1).map((s,i) => (
                      <Line key={s.id} yAxisId="y1" type="monotone"
                        dataKey={`v${i+1}`} stroke={s.color||MACRO_OVERLAY_COLORS[(i+1)%MACRO_OVERLAY_COLORS.length]}
                        strokeWidth={1.5} dot={false} connectNulls
                        strokeDasharray={s.type==="ticker"?"":""}/>
                    ))}
                    {/* Zero reference for YoY/MoM */}
                    {units !== "lin" && <ReferenceLine yAxisId="y0" y={0} stroke={C.bdr} strokeDasharray="3 3"/>}
                  </ComposedChart>
                </ResponsiveContainer>
                )}
                </ChartPanel>
              </>
            )}
          </div>

          {/* ── Smart Summary ─────────────────────────────────────────────── */}
          {summary && primarySeries && (
            <div style={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,overflow:"hidden"}}>
              {/* Summary header */}
              <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.bdr}`,
                display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <BookOpen size={13} style={{color:C.sky}}/>
                <span style={{fontFamily:"monospace",fontSize:11,color:C.headingTxt,fontWeight:700}}>
                  Economic Analysis · {primarySeries.id}
                </span>
                {summary.percentile_5y != null && (
                  <span style={{fontFamily:"monospace",fontSize:9,color:C.mut,marginLeft:"auto"}}>
                    5Y Percentile: <span style={{
                      color:summary.percentile_5y>75?C.red:summary.percentile_5y<25?C.grn:C.amb,
                      fontWeight:700}}>{ordinal(summary.percentile_5y)}</span>
                  </span>
                )}
              </div>

              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:14}}>
                {/* Stat row */}
                <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                  {[
                    ["Current", fmtVal(summary.current_value, primarySeries.unit)],
                    ["1-Month Δ",  summary.change_1m  != null ? `${summary.change_1m>0?"+":""}${summary.change_1m.toFixed(2)}%`  : "—"],
                    ["3-Month Δ",  summary.change_3m  != null ? `${summary.change_3m>0?"+":""}${summary.change_3m.toFixed(2)}%`  : "—"],
                    ["12-Month Δ", summary.change_1y  != null ? `${summary.change_1y>0?"+":""}${summary.change_1y.toFixed(2)}%`  : "—"],
                    ["Trend",      summary.trend_label || "—"],
                  ].map(([k,v]) => (
                    <div key={k} style={{display:"flex",flexDirection:"column",gap:2}}>
                      <div style={{fontFamily:"monospace",fontSize:9,color:C.mut,letterSpacing:".06em"}}>{k.toUpperCase()}</div>
                      <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,
                        color:k==="Trend"?C.txt:k==="Current"?regimeMeta?.color||C.headingTxt:
                          (v.startsWith("+")?C.grn:v.startsWith("-")?C.red:C.txt)}}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Headline */}
                <div style={{fontFamily:"monospace",fontSize:11,color:C.headingTxt,
                  lineHeight:1.65,padding:"10px 12px",background:C.dim,borderRadius:8,
                  borderLeft:`3px solid ${regimeMeta?.color||C.sky}`}}>
                  {summary.headline}
                </div>

                {/* Body + Causes side by side */}
                <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                  {/* Interpretation */}
                  {summary.body?.length > 0 && (
                    <div style={{flex:1,minWidth:240}}>
                      <div style={{fontFamily:"monospace",fontSize:9,color:C.mut,
                        letterSpacing:".06em",marginBottom:6}}>INTERPRETATION</div>
                      {summary.body.map((b,i) => (
                        <div key={i} style={{display:"flex",gap:8,marginBottom:7,alignItems:"flex-start"}}>
                          <div style={{width:5,height:5,borderRadius:"50%",background:C.sky,
                            flexShrink:0,marginTop:4}}/>
                          <div style={{fontFamily:"monospace",fontSize:10,color:C.txt,lineHeight:1.6}}>{b}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Causes */}
                  {summary.causes?.length > 0 && (
                    <div style={{flex:1,minWidth:240}}>
                      <div style={{fontFamily:"monospace",fontSize:9,color:C.mut,
                        letterSpacing:".06em",marginBottom:6}}>POTENTIAL CAUSES</div>
                      {summary.causes.map((c,i) => (
                        <div key={i} style={{display:"flex",gap:8,marginBottom:7,alignItems:"flex-start"}}>
                          <div style={{width:5,height:5,borderRadius:"50%",background:C.amb,
                            flexShrink:0,marginTop:4}}/>
                          <div style={{fontFamily:"monospace",fontSize:10,color:C.txt,lineHeight:1.6}}>{c}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Watch */}
                {summary.watch && (
                  <div style={{display:"flex",gap:10,alignItems:"flex-start",
                    padding:"9px 12px",background:C.dim,borderRadius:8,
                    border:`1px solid ${C.bdr}`}}>
                    <Eye size={12} style={{color:C.pur,flexShrink:0,marginTop:1}}/>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:9,color:C.pur,
                        fontWeight:700,marginBottom:3,letterSpacing:".06em"}}>WATCH NEXT</div>
                      <div style={{fontFamily:"monospace",fontSize:10,color:C.txt,lineHeight:1.6}}>
                        {summary.watch}
                      </div>
                    </div>
                  </div>
                )}

                {/* Series notes */}
                {primarySeries.info?.notes && (
                  <div style={{fontFamily:"monospace",fontSize:9,color:C.mut,
                    lineHeight:1.7,borderTop:`1px solid ${C.bdr}`,paddingTop:10}}>
                    <span style={{color:C.mut,fontWeight:700}}>FRED NOTE: </span>
                    {primarySeries.info.notes.slice(0,300)}{primarySeries.info.notes.length>300?"…":""}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!activeSeries.length && !loading && (
            <div style={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,
              padding:"28px 20px",textAlign:"center"}}>
              <Database size={24} style={{color:C.mut,marginBottom:10}}/>
              <div style={{fontFamily:"monospace",fontSize:11,color:C.mut,lineHeight:1.7}}>
                Select any series from the catalog on the left, or search above.<br/>
                <span style={{color:C.sky,cursor:"pointer",fontWeight:700}}
                  onClick={()=>loadSeries("CPIAUCSL","CPI All Items","#40c4ff",true)}>
                  → Start with CPI (CPIAUCSL)
                </span>
                {" · "}
                <span style={{color:C.sky,cursor:"pointer",fontWeight:700}}
                  onClick={()=>loadSeries("FEDFUNDS","Federal Funds Rate","#40c4ff",true)}>
                  Fed Funds Rate
                </span>
                {" · "}
                <span style={{color:C.sky,cursor:"pointer",fontWeight:700}}
                  onClick={()=>loadSeries("T10Y2Y","10Y-2Y Spread","#40c4ff",true)}>
                  Yield Curve
                </span>
              </div>
            </div>
          )}

          {/* ── Search results (shown at bottom) ─────────────────────────── */}
          {(searchResults.length > 0 || searching) && (
            <div style={{background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"9px 14px 7px",borderBottom:`1px solid ${C.bdr}`,
                display:"flex",alignItems:"center",gap:8}}>
                <Search size={11} style={{color:C.sky}}/>
                <span style={{fontFamily:"monospace",fontSize:9,color:C.mut,letterSpacing:".07em",flex:1}}>
                  SEARCH RESULTS — click name to load as primary · click <span style={{color:C.grn,fontWeight:700}}>+</span> to overlay
                </span>
                <button onClick={()=>{setSearchQ(""); setSearchResults([]);}}
                  style={{background:"none",border:"none",cursor:"pointer",padding:2,color:C.mut,display:"flex"}}>
                  <X size={10}/>
                </button>
              </div>
              {searching && (
                <div style={{padding:"10px 14px",fontFamily:"monospace",fontSize:9,color:C.mut}}>Searching…</div>
              )}
              {searchResults.map(r => (
                <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 14px",
                  borderBottom:`1px solid ${C.bdr}`,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.dim}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontFamily:"monospace",fontSize:10,color:C.sky,fontWeight:700,width:100,flexShrink:0}}>{r.id}</span>
                  <span onClick={()=>{ loadSeries(r.id, r.title, "#40c4ff", true); setSearchQ(""); setSearchResults([]); }}
                    style={{fontFamily:"monospace",fontSize:10,color:C.txt,flex:1,minWidth:0,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}}>
                    {r.title}
                  </span>
                  <span style={{fontFamily:"monospace",fontSize:9,color:C.mut,flexShrink:0,width:60,textAlign:"right"}}>
                    {r.frequency_short} · {r.units_short}
                  </span>
                  <button onClick={()=>{ loadSeries(r.id, r.title, MACRO_OVERLAY_COLORS[activeSeries.length%MACRO_OVERLAY_COLORS.length], false); }}
                    title="Add as overlay"
                    style={{background:"none",border:"none",cursor:"pointer",padding:"1px 4px",
                      color:C.grn,fontFamily:"monospace",fontSize:13,fontWeight:700,flexShrink:0,lineHeight:1}}>
                    +
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TradeAdvisorView ──────────────────────────────────────────────────────────
function TradeAdvisorView() {
  const C = useC();
  const [input,   setInput]   = useState("SPY");
  const [risk,    setRisk]    = useState("moderate");
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState(null);
  const [err,     setErr]     = useState(null);

  const run = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setData(null); setErr(null);
    fetch("/api/advisor", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ symbol: sym, risk_tolerance: risk }),
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || "Advisor error")))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr(String(e)); setLoading(false); });
  };

  const sCol = s => s >= 0.2 ? C.grn : s <= -0.2 ? C.red : C.amb;
  const dIco = d => d === "bullish" ? "▲" : d === "bearish" ? "▼" : "●";
  const dCol = d => d === "bullish" ? C.grn : d === "bearish" ? C.red : C.amb;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div>
        <Lbl>Trade Advisor</Lbl>
        <div style={mono(10,C.mut)}>Synthesizes ML signal · news sentiment · technicals · options analytics → actionable trade recommendation</div>
      </div>

      {/* Controls */}
      <Card>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:1,minWidth:180}}>
            <div style={{...mono(9,C.mut,600),marginBottom:5,letterSpacing:"0.08em"}}>SYMBOL</div>
            <input
              value={input}
              onChange={e=>setInput(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&run()}
              placeholder="AAPL, SPY, BTC-USD…"
              style={{
                width:"100%", padding:"9px 13px", borderRadius:8,
                border:`1.5px solid ${C.grn}55`,
                background:C.surf,
                color:C.headingTxt,
                fontFamily:"monospace", fontSize:14, fontWeight:600,
                boxSizing:"border-box", outline:"none",
              }}
            />
          </div>
          <div>
            <div style={{...mono(9,C.mut,600),marginBottom:5,letterSpacing:"0.08em"}}>RISK TOLERANCE</div>
            <div style={{display:"flex",gap:6}}>
              {["conservative","moderate","aggressive"].map(r=>(
                <button key={r} onClick={()=>setRisk(r)}
                  style={{padding:"8px 13px",borderRadius:8,cursor:"pointer",
                    border:`1.5px solid ${risk===r?C.sky:C.bdr}`,
                    background:risk===r?`${C.sky}22`:"transparent",
                    color:risk===r?C.sky:C.txt,
                    fontFamily:"monospace", fontSize:10, fontWeight:risk===r?700:400,
                    textTransform:"capitalize", transition:"all .15s"}}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <button onClick={run} disabled={loading}
            style={{padding:"9px 24px",borderRadius:8,border:"none",
              background:loading?C.dim:C.sky,
              color:loading?C.mut:"#000",
              fontFamily:"monospace", fontSize:11, fontWeight:700,
              cursor:loading?"not-allowed":"pointer",
              transition:"background .15s",
              display:"flex",alignItems:"center",gap:6}}>
            {loading && <RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/>}
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </Card>

      {err && <Card><div style={mono(11,C.red)}>⚠ {err}</div></Card>}

      {data && (<>
        {/* Composite Score Banner */}
        {data.composite && (
          <div style={{borderRadius:14,border:`2px solid ${sCol(data.composite.score)}50`,
            background:sCol(data.composite.score)+"0a",padding:"16px 22px",display:"flex",gap:20,alignItems:"center"}}>
            <div style={{textAlign:"center",minWidth:80}}>
              <div style={{...mono(40,sCol(data.composite.score),800),lineHeight:1}}>
                {data.composite.score>=0?"+":""}{(data.composite.score*100).toFixed(0)}
              </div>
              <div style={mono(8,C.mut)}>COMPOSITE</div>
            </div>
            <div style={{flex:1}}>
              <div style={{...mono(22,sCol(data.composite.score),700),marginBottom:6}}>
                {data.composite.overall}
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                {Object.entries(data.composite.components||{}).map(([k,v])=>(
                  <Tag key={k} color={sCol(v)}>{k.replace("_"," ")}: {v>=0?"+":""}{(v*100).toFixed(0)}</Tag>
                ))}
              </div>
              <div style={mono(9,C.mut)}>
                Conviction: <span style={{color:C.sky,fontWeight:700}}>{data.composite.conviction?.toUpperCase()}</span>
                {" · "}{data.symbol} · {new Date().toLocaleDateString()}
              </div>
            </div>
          </div>
        )}

        {/* 3-column analysis grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {/* ML Signal */}
          <Card>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <Cpu size={13} style={{color:C.pur}}/><span style={mono(9,C.pur,700)}>ML SIGNAL</span>
            </div>
            {data.ml_signal ? (<>
              <div style={{...mono(28,dCol(data.ml_signal.direction),700),marginBottom:2}}>
                {dIco(data.ml_signal.direction)} {(data.ml_signal.p_up*100).toFixed(0)}%
              </div>
              <div style={mono(9,C.mut)}>P(up) · next 5 days</div>
              <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
                <KV k="Direction"  v={data.ml_signal.direction}/>
                <KV k="Confidence" v={(data.ml_signal.confidence*100).toFixed(0)+"%"}/>
                <KV k="OOS Acc."   v={(data.ml_signal.accuracy*100).toFixed(1)+"%"}/>
                <KV k="Top Feature" v={data.ml_signal.top_feature||"—"}/>
              </div>
              <div style={{...mono(8,C.mut),marginTop:8,lineHeight:1.6,borderTop:`1px solid ${C.bdr}`,paddingTop:8}}>
                {data.ml_signal.blurb}
              </div>
            </>) : <div style={mono(10,C.mut)}>No ML data — compute project features first</div>}
          </Card>

          {/* Sentiment */}
          <Card>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <Network size={13} style={{color:C.sky}}/><span style={mono(9,C.sky,700)}>NEWS SENTIMENT</span>
            </div>
            {data.sentiment ? (<>
              <div style={{...mono(28,dCol(data.sentiment.direction),700),marginBottom:2}}>
                {data.sentiment.score>=0?"+":""}{(data.sentiment.score*100).toFixed(0)}
              </div>
              <div style={mono(9,C.mut)}>{data.sentiment.articles} articles · last 24h</div>
              <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:3}}>
                <KV k="Direction" v={data.sentiment.direction}/>
                <KV k="Momentum" v={data.sentiment.momentum>=0?"+"+data.sentiment.momentum?.toFixed(2):data.sentiment.momentum?.toFixed(2)}/>
                <KV k="Strength"  v={(data.sentiment.strength||1)+"/5"}/>
              </div>
              {data.sentiment.headlines?.slice(0,2).map((h,i)=>(
                <div key={i} style={{...mono(8,C.mut),marginTop:6,padding:"4px 8px",
                  borderRadius:6,background:C.dim,lineHeight:1.5}}>{h}</div>
              ))}
            </>) : <div style={mono(10,C.mut)}>Fetching sentiment…</div>}
          </Card>

          {/* Technical */}
          <Card>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <TrendingUp size={13} style={{color:C.grn}}/><span style={mono(9,C.grn,700)}>TECHNICAL</span>
            </div>
            {data.technical ? (<>
              <div style={{...mono(26,dCol(data.technical.ta_bias),700),marginBottom:2}}>
                {dIco(data.technical.ta_bias)} {data.technical.ta_bias?.toUpperCase()}
              </div>
              <div style={mono(9,C.mut)}>{data.technical.bull_signals} bull · {data.technical.bear_signals} bear signals</div>
              <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                <KV k="Close"
                    v={data.technical.latest_close ? "$"+Number(data.technical.latest_close).toFixed(2) : "—"}
                    vc={data.technical.change_pct > 0 ? C.grn : data.technical.change_pct < 0 ? C.red : C.txt}/>
                {data.technical.change_pct != null && (
                  <KV k="Change"
                      v={(data.technical.change_pct >= 0 ? "+" : "") + Number(data.technical.change_pct).toFixed(2) + "%"}
                      vc={data.technical.change_pct >= 0 ? C.grn : C.red}/>
                )}
                <KV k="RSI (14)" v={data.technical.rsi != null ? Number(data.technical.rsi).toFixed(1) : "—"}
                    vc={data.technical.rsi > 70 ? C.red : data.technical.rsi < 30 ? C.grn : C.txt}/>
                <KV k="HV 20D"   v={data.technical.hv20 != null ? (data.technical.hv20*100).toFixed(1)+"%" : "—"}/>
                {data.technical.sma20 && <KV k="SMA 20"  v={"$"+Number(data.technical.sma20).toFixed(2)}/>}
                {data.technical.sma50 && <KV k="SMA 50"  v={"$"+Number(data.technical.sma50).toFixed(2)}/>}
                <KV k="Signals"  v={data.technical.triggered_count + " triggered"}/>
              </div>
              <div style={{marginTop:8,display:"flex",gap:4,flexWrap:"wrap"}}>
                {data.technical.top_signals?.slice(0,4).map((s,i)=>(
                  <Tag key={i} color={s.direction==="bullish"?C.grn:C.red}>
                    {s.name?.split(" ").slice(0,2).join(" ")}
                  </Tag>
                ))}
              </div>
            </>) : <div style={mono(10,C.mut)}>Technical data unavailable</div>}
          </Card>
        </div>

        {/* Options context + Strategy Recommendations */}
        {/* ── Options Context (full width, more detail) ─────────────────── */}
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <Layers size={13} style={{color:C.amb}}/><span style={mono(9,C.amb,700)}>OPTIONS CONTEXT</span>
            {data.options && !data.options.max_pain && (
              <Tag color={C.mut}>Run options refresh for full context</Tag>
            )}
          </div>
          {data.options ? (()=>{
            const opt = data.options;
            const ivRankPct  = opt.iv_rank!=null ? opt.iv_rank*100 : null;
            const ivRegime   = ivRankPct==null?"—":ivRankPct>70?"RICH (sell premium)":ivRankPct<30?"CHEAP (buy premium)":"FAIR";
            const ivRegimeC  = ivRankPct==null?C.mut:ivRankPct>70?C.red:ivRankPct<30?C.grn:C.amb;
            const spreadPct  = opt.iv_hv_spread!=null ? opt.iv_hv_spread*100 : null;
            const spreadLabel= spreadPct==null?"—":spreadPct>5?"Expensive (IV >> HV)":spreadPct<-2?"Cheap (IV << HV)":"Fair";
            const spreadC    = spreadPct==null?C.txt:spreadPct>5?C.red:spreadPct<-2?C.grn:C.txt;
            const totalOI    = (opt.total_call_oi||0) + (opt.total_put_oi||0);
            const callOIPct  = totalOI>0 ? Math.round(opt.total_call_oi/totalOI*100) : null;
            const putOIPct   = totalOI>0 ? Math.round(opt.total_put_oi/totalOI*100) : null;
            const snapshotAge= opt.snapshot_at ? (()=>{
              const h = Math.round((Date.now()-new Date(opt.snapshot_at+"Z").getTime())/3600000);
              return h<1?"<1h ago":h<24?h+"h ago":Math.floor(h/24)+"d ago";
            })() : null;
            const mpDiff     = opt.max_pain && data.technical?.latest_close
              ? ((opt.max_pain - data.technical.latest_close)/data.technical.latest_close*100).toFixed(1)
              : null;
            return (
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                <Stat label="HV 20D"
                  value={opt.hv20!=null?(opt.hv20*100).toFixed(1)+"%":"—"}
                  sub="Realized volatility" color={C.sky}/>
                <Stat label="Avg IV"
                  value={opt.avg_iv!=null?(opt.avg_iv*100).toFixed(1)+"%":"—"}
                  sub="Implied volatility" color={C.txt}/>
                <Stat label="IV Rank"
                  value={ivRankPct!=null?ivRankPct.toFixed(0)+"th pct":"—"}
                  sub={ivRegime} color={ivRegimeC}/>
                <Stat label="IV−HV Spread"
                  value={spreadPct!=null?(spreadPct>0?"+":"")+spreadPct.toFixed(1)+"%":"—"}
                  sub={spreadLabel} color={spreadC}/>
                <Stat label="Max Pain"
                  value={opt.max_pain?"$"+Number(opt.max_pain).toFixed(0):"—"}
                  sub={mpDiff!=null?(mpDiff>0?"+":"")+mpDiff+"% vs spot":"OI-weighted pinning level"}
                  color={mpDiff!=null&&Math.abs(mpDiff)<1?C.grn:C.txt}/>
                <Stat label="P/C Ratio"
                  value={opt.put_call_ratio!=null?Number(opt.put_call_ratio).toFixed(2):"—"}
                  sub={opt.put_call_ratio>1.3?"Bearish skew":opt.put_call_ratio<0.7?"Bullish skew":"Neutral"}
                  color={opt.put_call_ratio>1.3?C.red:opt.put_call_ratio<0.7?C.grn:C.txt}/>
                <Stat label="Max Γ Strike"
                  value={opt.max_gamma_strike?"$"+Number(opt.max_gamma_strike).toFixed(0):"—"}
                  sub="Dealer hedge magnet"/>
                <Stat label="Snapshot"
                  value={snapshotAge||"—"}
                  sub={opt.snapshot_at?opt.snapshot_at.slice(0,10):"No options data fetched"}
                  color={snapshotAge&&snapshotAge.includes("d")?C.red:C.mut}/>
                {totalOI>0 && (
                  <div style={{gridColumn:"1/-1",marginTop:2}}>
                    <div style={{...mono(8,C.mut),marginBottom:4}}>
                      OPEN INTEREST — Call: {(opt.total_call_oi/1000).toFixed(0)}K ({callOIPct}%) · Put: {(opt.total_put_oi/1000).toFixed(0)}K ({putOIPct}%) · Total: {(totalOI/1000).toFixed(0)}K contracts
                    </div>
                    <div style={{height:6,borderRadius:3,background:C.bdr,overflow:"hidden",display:"flex"}}>
                      <div style={{width:callOIPct+"%",background:C.grn+"99",transition:"width 0.4s"}}/>
                      <div style={{width:putOIPct+"%",background:C.red+"99",transition:"width 0.4s"}}/>
                    </div>
                    <div style={{display:"flex",gap:10,marginTop:3}}>
                      <span style={mono(7,C.grn)}>▌ Calls</span>
                      <span style={mono(7,C.red)}>▌ Puts</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })() : (
            <div style={{...mono(10,C.mut),padding:"12px 0"}}>
              No options or price data available.
            </div>
          )}
        </Card>

        {/* ── Strategy Recommendations (full width) ───────────────────── */}
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <Shield size={13} style={{color:C.sky}}/><span style={mono(9,C.sky,700)}>STRATEGY RECOMMENDATIONS</span>
            {data.strategy_recommendations?.length>0 && (
              <span style={mono(8,C.mut)}>— top {Math.min(data.strategy_recommendations.length,3)} strategies ranked by fit</span>
            )}
          </div>
          {data.strategy_recommendations?.length > 0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {data.strategy_recommendations.slice(0,3).map((r,i)=>{
                const isCredit = r.net_premium!=null && r.net_premium<0;
                const isDebit  = r.net_premium!=null && r.net_premium>0;
                return (
                  <div key={i} style={{borderRadius:10,border:`1px solid ${C.bdr}`,overflow:"hidden"}}>
                    {/* Header bar */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                      padding:"8px 12px",background:C.dim,borderBottom:`1px solid ${C.bdr}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{...mono(12,C.headingTxt,700)}}>#{r.rank}</span>
                        <span style={mono(11,C.txt,600)}>{r.name}</span>
                      </div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
                        <Tag color={C.mut}>{r.category}</Tag>
                        <Tag color={r.risk_level==="low"?C.grn:r.risk_level==="high"?C.red:C.amb}>{r.risk_level} risk</Tag>
                        <Tag color={C.sky}>{(r.fit_score*100).toFixed(0)}% fit</Tag>
                      </div>
                    </div>

                    <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                      {/* Contract detail rows */}
                      {r.contract_details?.length>0 && (
                        <div>
                          <div style={{...mono(8,C.mut,700),marginBottom:4}}>CONTRACT DETAILS</div>
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            {r.contract_details.map((cd,j)=>(
                              <div key={j} style={{display:"flex",alignItems:"center",gap:6,
                                padding:"5px 8px",borderRadius:6,
                                background:cd.action==="BUY"?C.grn+"11":C.red+"11",
                                border:`1px solid ${cd.action==="BUY"?C.grn:C.red}22`}}>
                                <span style={{...mono(9,cd.action==="BUY"?C.grn:C.red,700),minWidth:32}}>{cd.action}</span>
                                <span style={mono(9,C.txt,600)}>{cd.option_type.toUpperCase()}</span>
                                <span style={{...mono(10,C.headingTxt,700),minWidth:50}}>${cd.strike}</span>
                                <span style={{...mono(8,C.mut),flex:1}}>exp {cd.expiry_label} (~{cd.expiry_days}d)</span>
                                {cd.est_premium!=null && (
                                  <span style={mono(9,C.sky,600)}>
                                    ${cd.est_premium.toFixed(2)}/sh · ${cd.est_premium_contract?.toFixed(0)}/contract
                                  </span>
                                )}
                                {cd.delta!=null && (
                                  <span style={mono(8,C.mut)}>Δ {cd.delta>0?"+":""}{cd.delta.toFixed(2)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Trade summary row */}
                      <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center",
                        padding:"6px 8px",borderRadius:6,background:C.bg,border:`1px solid ${C.bdr}33`}}>
                        {r.net_premium!=null && (
                          <KV k={isCredit?"Net Credit":"Net Debit"}
                            v={"$"+Math.abs(r.net_premium).toFixed(2)+"/sh ($"+Math.abs(r.net_premium*100).toFixed(0)+"/contract)"}
                            vc={isCredit?C.grn:isDebit?C.red:C.txt}/>
                        )}
                        {r.breakeven_price!=null && (
                          <KV k="Breakeven" v={"$"+r.breakeven_price.toFixed(2)+" at expiry"}/>
                        )}
                        <KV k="Max Profit" v={r.max_profit}/>
                        <KV k="Max Loss" v={r.max_loss}/>
                      </div>

                      {/* Condensed rationale */}
                      <div style={{...mono(8,C.mut),lineHeight:1.6}}>
                        {r.rationale?.split(". ").slice(0,2).join(". ")+(r.rationale?.includes(".")?".":" ")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={mono(10,C.mut)}>Fetch options data and re-analyze to generate strategy recommendations.</div>
          )}
        </Card>

        {data.warnings?.filter(w=>w).length > 0 && (
          <Card>
            <div style={{...mono(9,C.amb,700),marginBottom:6}}>⚠ ANALYSIS NOTES</div>
            {data.warnings.filter(w=>w).map((w,i)=>(
              <div key={i} style={{...mono(9,C.mut),marginTop:3}}>· {w}</div>
            ))}
          </Card>
        )}
      </>)}

      {!data && !loading && !err && (
        <Card>
          <div style={{...mono(11,C.mut),textAlign:"center",padding:"48px 0",lineHeight:2}}>
            Enter any equity, ETF, or crypto ticker above and click <span style={{color:C.sky,fontWeight:700}}>Analyze</span><br/>
            to get a synthesized trade recommendation combining ML prediction,<br/>
            news sentiment, technical signals, and options analytics.
          </div>
        </Card>
      )}

      <div style={mono(8,C.mut)}>⚠ Not financial advice. All analysis is for educational/research purposes only.</div>
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

  const screen = () => {
    const syms = symbols.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
    if (syms.length < 2) { setErr("Need at least 2 symbols"); return; }
    setLoading(true); setPairs(null); setErr(null); setExpanded(null);
    fetch("/api/pairs/screen", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ symbols: syms, z_entry: zEntry, min_correlation: minCorr }),
    })
      .then(r=>r.ok?r.json():r.json().then(e=>Promise.reject(e.detail||"Screen failed")))
      .then(d=>{ setPairs(d); setLoading(false); })
      .catch(e=>{ setErr(String(e)); setLoading(false); });
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
          <button onClick={screen} disabled={loading}
            style={{padding:"9px 20px",borderRadius:8,border:"none",
              background:loading?C.mut:C.sky,color:"#000",...mono(11,undefined,700),
              cursor:loading?"not-allowed":"pointer"}}>
            {loading ? "Screening…" : "Screen Pairs"}
          </button>
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
// Markets = Overview dashboard + News feed
function MarketsView({onNav, onDetail}) {
  const [tab, setTab] = useState("dashboard");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",gap:8}}>
        {[["dashboard","Dashboard"],["news","News"]].map(([id,l])=>(
          <Pill key={id} label={l} active={tab===id} onClick={()=>setTab(id)}/>
        ))}
      </div>
      {tab==="dashboard" && <OverviewView onNav={onNav} onDetail={onDetail}/>}
      {tab==="news"      && <NewsView/>}
    </div>
  );
}

// Portfolio = Holdings analytics + Black-Litterman optimizer
function PortfolioHubView() {
  const [tab, setTab] = useState("holdings");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",gap:8}}>
        {[["holdings","Holdings"],["optimizer","Optimizer"]].map(([id,l])=>(
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

// ── App ─────────────────────────────────────────────────
const NAV=[
  {id:"markets",   l:"Markets",   I:BarChart2},   // Overview + News
  {id:"advisor",   l:"Advisor",   I:Compass},
  {id:"macro",     l:"Macro",     I:Database},
  {id:"technical", l:"Technical", I:TrendingUp},
  {id:"options",   l:"Options",   I:Activity},
  {id:"signals",   l:"Signals",   I:Zap},
  {id:"pairs",     l:"Pairs",     I:Shuffle},
  {id:"portfolio", l:"Portfolio", I:Briefcase},   // Holdings + Optimizer
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

export default function App() {
  const [view,setView]           = useState("markets");
  const [dark,setDark]           = useState(true);
  const [detailSym,setDetailSym] = useState(null);
  const C = dark ? DARK : LIGHT;
  const VIEWS={
    markets:   <MarketsView onNav={(v)=>{setDetailSym(null);setView(v);}} onDetail={setDetailSym}/>,
    advisor:   <TradeAdvisorView/>,
    macro:     <MacroView/>,
    technical: <TechnicalView/>,
    options:   <OptionsView/>,
    signals:   <SignalsView/>,
    pairs:     <PairsView/>,
    portfolio: <PortfolioHubView/>,
    lab:       <LabView/>,
  };
  return (
    <ThemeCtx.Provider value={C}>
      <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"monospace"}}>
        <aside style={{width:186,flexShrink:0,borderRight:`1px solid ${C.bdr}`,display:"flex",flexDirection:"column",background:C.surf}}>
          <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${C.bdr}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <div style={{width:26,height:26,borderRadius:8,background:C.grnBg,border:`1px solid ${C.grn}30`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <BarChart2 size={14} style={{color:C.grn}}/>
              </div>
              <span style={mono(11,C.headingTxt,700)}>Quant Engine</span>
            </div>
            <div style={mono(9,C.mut)}>v1.0.0 · Research Platform</div>
          </div>
          <nav style={{flex:1,padding:"10px 8px",overflowY:"auto"}}>
            {NAV.map(({id,l,I})=>{
              const a=view===id;
              return (
                <button key={id} onClick={()=>{setView(id);setDetailSym(null);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",borderRadius:8,marginBottom:2,border:`1px solid ${a?C.grn+"30":"transparent"}`,background:a?C.grnBg:"transparent",cursor:"pointer",transition:"all .15s",...mono(11,a?C.grn:C.mut,a?700:400)}}
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
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,border:`1px solid ${C.grn}25`,background:C.grnBg}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:C.grn}}/>
              <span style={mono(9,C.grn)}>Demo Mode</span>
            </div>
            <div style={{...mono(8,C.mut),marginTop:8,lineHeight:1.6}}>⚠ Not financial advice.<br/>Markets involve risk.</div>
          </div>
        </aside>
        <main style={{flex:1,overflowY:"auto",padding:"26px 30px",background:C.bg}}>
          <div style={{maxWidth:980,margin:"0 auto"}}>
            {detailSym
              ? <MacroDetailView sym={detailSym} onBack={()=>setDetailSym(null)}/>
              : (VIEWS[view]||VIEWS.markets)}
          </div>
        </main>
      </div>
    </ThemeCtx.Provider>
  );
}

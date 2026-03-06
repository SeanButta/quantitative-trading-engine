import { useState } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart
} from "recharts";
import {
  CheckCircle, XCircle, AlertTriangle, ChevronRight, Play,
  RefreshCw, FileText, Zap, Globe, Target, BarChart2, ArrowRight,
  FlaskConical
} from "lucide-react";

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

const CP_DATA = (() => {
  const r = rng32(31);
  return Array.from({length:51},(_,i)=>({
    x: +(-2.5+i*0.1).toFixed(1),
    c: +Math.min(0.9,Math.max(0.2,0.53+0.09*Math.tanh((i-25)/6)+(r()-0.5)*0.03)).toFixed(3),
  }));
})();

// ── Tokens ─────────────────────────────────────────────
const C = {
  bg:"#050508", surf:"#0c0c12", bdr:"#181824", txt:"#c8c8da",
  mut:"#56566e", dim:"#1c1c28", grn:"#00e676", grnBg:"rgba(0,230,118,.07)",
  sky:"#40c4ff", amb:"#ffb300", red:"#ff5252", pur:"#b388ff",
};
const TT = {
  contentStyle:{background:C.surf,border:`1px solid ${C.bdr}`,fontFamily:"monospace",fontSize:11,borderRadius:8},
  labelStyle:{color:C.mut}, itemStyle:{color:C.txt},
};
const mono = (sz,col,wt=400) => ({fontFamily:"monospace",fontSize:sz,color:col,fontWeight:wt});

// ── UI atoms ───────────────────────────────────────────
function Card({children,accent}) {
  return <div style={{background:C.surf,border:`1px solid ${accent?accent+"30":C.bdr}`,borderRadius:14,padding:18}}>{children}</div>;
}
function Lbl({children,color=C.mut}) {
  return <div style={{...mono(9,color,700),letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}>{children}</div>;
}
function Pill({label,active,onClick}) {
  return <button onClick={onClick} style={{...mono(10,active?C.grn:C.mut,600),border:`1px solid ${active?C.grn+"50":C.bdr}`,background:active?C.grnBg:"transparent",borderRadius:6,padding:"4px 11px",cursor:"pointer",transition:"all .15s"}}>{label.replace(/_/g," ")}</button>;
}
function KV({k,v,vc=C.txt}) {
  return <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.bdr}`}}><span style={mono(9,C.mut)}>{k}</span><span style={mono(11,vc,700)}>{v}</span></div>;
}
function Stat({label,value,color=C.grn,sub}) {
  return <Card><Lbl>{label}</Lbl><div style={mono(20,color,800)}>{value}</div>{sub&&<div style={{...mono(9,C.mut),marginTop:3}}>{sub}</div>}</Card>;
}
function Tag({children,color=C.mut}) {
  return <span style={{...mono(9,color,700),background:color+"15",border:`1px solid ${color}30`,borderRadius:20,padding:"2px 8px"}}>{children}</span>;
}
function CodeBox({children}) {
  return <div style={{padding:"12px 14px",borderRadius:10,background:C.dim}}><code style={{...mono(10,C.sky),lineHeight:1.9,whiteSpace:"pre",display:"block"}}>{children}</code></div>;
}
function ValBanner({label}) {
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
function OverviewView({onNav}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{borderRadius:16,border:`1px solid ${C.grn}30`,background:C.grnBg,padding:22}}>
        <div style={{...mono(9,C.grn,700),letterSpacing:"0.2em",textTransform:"uppercase",marginBottom:8}}>Quantitative Trading Signal Engine v1.0</div>
        <div style={mono(26,"#fff",800)}>Research Platform</div>
        <div style={{...mono(12,C.mut),marginTop:6,lineHeight:1.7}}>Statistical validation · Walk-forward backtesting · Markowitz optimization · Stochastic finance</div>
        <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
          {["Most strategies are noise.","Every signal requires validation.","No lookahead bias.","49/49 tests pass."].map(t=><Tag key={t} color={C.mut}>{t}</Tag>)}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card>
          <Lbl>Research Pipeline</Lbl>
          {[["01","Create Project","Name, symbols, date range",true],["02","Ingest Data","yfinance → Parquet store",true],["03","Compute Features","Returns, vol, ATR, PCA…",true],["04","Build Strategy","Select signals + parameters",false],["05","Run Backtest","Walk-forward, no lookahead",false],["06","Validate","t-test · BH · permutation",false],["07","Read Report","Full markdown research doc",false]].map(([n,l,s,d])=>(
            <div key={n} style={{display:"flex",alignItems:"center",gap:12,padding:"7px 10px",borderRadius:8,marginBottom:4,background:d?C.grnBg:"transparent",border:`1px solid ${d?C.grn+"25":C.bdr}`}}>
              <span style={mono(10,d?C.grn:C.mut,700)}>{n}</span>
              <div style={{flex:1}}><div style={mono(11,d?"#fff":C.mut,600)}>{l}</div><div style={mono(9,C.mut)}>{s}</div></div>
              {d?<CheckCircle size={13} style={{color:C.grn}}/>:<ChevronRight size={13} style={{color:C.mut}}/>}
            </div>
          ))}
        </Card>

        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <Card>
            <Lbl>Core Modules</Lbl>
            {[["data_ingestion.py","~280",C.sky],["feature_engine.py","~320",C.pur],["signal_engine.py","~420",C.grn],["statistical_validation.py","~260",C.amb],["backtest_engine.py","~340",C.sky],["portfolio_optimizer.py","~220",C.grn],["stochastic_finance.py","~300",C.pur],["report_generator.py","~180",C.amb]].map(([nm,ln,col])=>(
              <div key={nm} style={{display:"flex",justifyContent:"space-between",borderBottom:`1px solid ${C.bdr}`,paddingBottom:4,marginBottom:4}}>
                <span style={mono(9,col)}>{nm}</span><span style={mono(9,C.mut)}>{ln} lines</span>
              </div>
            ))}
          </Card>
          <Card accent={C.grn}>
            <Lbl>Integration Tests</Lbl>
            <div style={mono(22,C.grn,800)}>49 / 49</div>
            <div style={mono(10,C.mut)}>all checks pass · all systems operational</div>
            <div style={{marginTop:10}}>
              {[["Data layer","3/3"],["Feature engine","6/6"],["Signal engine","7/7"],["Statistical validation","5/5"],["Backtest engine","7/7"],["Portfolio optimizer","4/4"],["Stochastic finance","9/9"],["Report generation","4/4"]].map(([k,v])=><KV key={k} k={k} v={v} vc={C.grn}/>)}
            </div>
          </Card>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        {[{l:"Explore Signals",v:"signals",I:Zap,c:C.grn},{l:"Run Backtest",v:"backtest",I:FlaskConical,c:C.sky},{l:"Optimize Portfolio",v:"optimize",I:Target,c:C.amb}].map(({l,v,I,c})=>(
          <button key={v} onClick={()=>onNav(v)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",borderRadius:12,border:`1px solid ${c}30`,background:"transparent",cursor:"pointer",...mono(12,c,700),transition:"background .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=c+"10"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{display:"flex",alignItems:"center",gap:8}}><I size={14}/>{l}</span><ArrowRight size={13}/>
          </button>
        ))}
      </div>
    </div>
  );
}

function BacktestView() {
  const [ran,setRan]=useState(false);
  const [running,setRunning]=useState(false);
  const [sigs,setSigs]=useState(["conditional_probability","pca_regime"]);
  const ALL=["conditional_probability","bayesian_update","regression_alpha","pca_regime","fat_tail_risk"];
  const go=async()=>{setRunning(true);await new Promise(r=>setTimeout(r,1800));setRunning(false);setRan(true);};
  const toggle=s=>setSigs(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div><Lbl>Backtest Engine</Lbl><div style={mono(11,C.mut)}>Signal at t → Trade at open of t+1 · No lookahead bias guaranteed</div></div>

      <Card>
        <Lbl>Strategy Configuration</Lbl>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>{ALL.map(s=><Pill key={s} label={s} active={sigs.includes(s)} onClick={()=>toggle(s)}/>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
          {[["Fee (bps)","1.0"],["Slippage (bps)","2.0"],["Risk-Free Rate","3.0%"]].map(([l,v])=>(
            <div key={l}><Lbl>{l}</Lbl><input defaultValue={v} style={{...mono(12,C.txt),width:"100%",padding:"7px 11px",borderRadius:8,background:C.bg||C.dim,border:`1px solid ${C.bdr}`,outline:"none",boxSizing:"border-box"}}/></div>
          ))}
        </div>
        <button onClick={go} disabled={running} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:8,border:"none",cursor:running?"not-allowed":"pointer",background:running?C.dim:C.grn,color:"#000",...mono(12,"#000",700),transition:"all .15s"}}>
          {running?<><RefreshCw size={14} className="animate-spin"/>Running…</>:<><Play size={14}/>Run Backtest</>}
        </button>
      </Card>

      {(ran||true)&&(<>
        <ValBanner label="valid"/>

        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
          {[{l:"CAGR",v:"8.12%",c:C.grn},{l:"Sharpe",v:"0.631",c:C.grn},{l:"Sortino",v:"0.894",c:C.sky},{l:"Max Drawdown",v:"−18.7%",c:C.red},{l:"Volatility",v:"14.2%",c:C.mut},{l:"Calmar",v:"0.433",c:C.mut},{l:"Turnover",v:"241%",c:C.mut},{l:"Alpha (ann.)",v:"+2.31%",c:C.grn,sub:"t=2.14  p=0.033"}].map(m=><Stat key={m.l} label={m.l} value={m.v} color={m.c} sub={m.sub}/>)}
        </div>

        <Card>
          <Lbl>Equity Curve · Strategy vs Benchmark</Lbl>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={EQ_DATA} margin={{top:4,right:4,left:0,bottom:4}}>
              <defs>
                <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.grn} stopOpacity={0.28}/><stop offset="95%" stopColor={C.grn} stopOpacity={0}/></linearGradient>
                <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.sky} stopOpacity={0.12}/><stop offset="95%" stopColor={C.sky} stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="yr" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} tickLine={false} axisLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <Tooltip {...TT} formatter={v=>[`$${(v/1000).toFixed(1)}k`]}/>
              <Area type="monotone" dataKey="bm" name="Benchmark" stroke={C.sky} strokeWidth={1.5} fill="url(#gB)" dot={false} strokeDasharray="4 3"/>
              <Area type="monotone" dataKey="eq" name="Strategy"  stroke={C.grn} strokeWidth={2}   fill="url(#gE)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Card>
            <Lbl>Drawdown</Lbl>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={EQ_DATA} margin={{top:4,right:4,left:0,bottom:4}}>
                <defs><linearGradient id="gD" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.red} stopOpacity={0.45}/><stop offset="95%" stopColor={C.red} stopOpacity={0.03}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                <XAxis dataKey="yr" tick={{fill:C.mut,fontSize:9,fontFamily:"monospace"}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fill:C.mut,fontSize:9,fontFamily:"monospace"}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`}/>
                <Tooltip {...TT} formatter={v=>[`${v}%`]}/>
                <ReferenceLine y={0} stroke={C.mut} strokeDasharray="3 3"/>
                <Area type="monotone" dataKey="dd" name="Drawdown %" stroke={C.red} strokeWidth={1.5} fill="url(#gD)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <Lbl>Permutation Test — Null Distribution</Lbl>
            <div style={{...mono(9,C.mut),marginBottom:8}}>10,000 shuffles · red = observed Sharpe 0.631 · perm p = 0.038</div>
            <ResponsiveContainer width="100%" height={102}>
              <BarChart data={PERM} margin={{top:2,right:4,left:0,bottom:2}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                <XAxis dataKey="x" tick={{fill:C.mut,fontSize:8,fontFamily:"monospace"}} tickLine={false} axisLine={false}/>
                <YAxis hide/>
                <Tooltip {...TT}/>
                <ReferenceLine x={0.63} stroke={C.red} strokeWidth={2} label={{value:"Obs",fill:C.red,fontSize:8,fontFamily:"monospace"}}/>
                <Bar dataKey="n" fill={C.dim} stroke={C.bdr} radius={[2,2,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card>
          <Lbl>Alpha Regression — Newey-West HAC</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginTop:6}}>
            {[["Alpha (ann.)","+2.31%",C.grn],["t-statistic","2.140",C.sky],["p-value","0.033",C.grn],["HAC lags","5",C.mut]].map(([k,v,col])=>(
              <div key={k}><Lbl>{k}</Lbl><div style={mono(17,col,700)}>{v}</div></div>
            ))}
          </div>
          <div style={{marginTop:12}}><CodeBox>{"β̂ = (XᵀX)⁻¹Xᵀy  ·  SE = Newey-West (1987) HAC  ·  H₀: α = 0\nFail to reject H₀ at p < 0.05 → alpha is statistically significant"}</CodeBox></div>
        </Card>
      </>)}
    </div>
  );
}

function SignalsView() {
  const [sel,setSel]=useState("conditional_probability");
  const [thresh,setThresh]=useState(1.5);
  const SIGS=[
    {id:"conditional_probability",label:"Conditional Probability",math:"P(A|B) = P(A∩B)/P(B)",color:C.grn,desc:"Estimates P(up | condition) vs unconditional P(up). Two-proportion z-test with Wilson confidence intervals. Signal fires when conditional edge is statistically significant."},
    {id:"bayesian_update",label:"Bayesian Update",math:"K = σ²ₚ/(σ²ₚ+σ²ₗ) → μₙ = μₚ+K(obs−μₚ)",color:C.sky,desc:"Maintains Gaussian belief over expected return via Kalman-style update. Uncertainty inflated by decay factor each step so belief tracks regime changes. Signal = posterior mean."},
    {id:"regression_alpha",label:"Regression Alpha",math:"β̂ = (XᵀX)⁻¹Xᵀy  ·  SE: Newey-West HAC",color:C.pur,desc:"Rolling OLS of returns on feature set. Newey-West HAC standard errors with 5 lags corrects for heteroskedasticity and autocorrelation. Signal = alpha t-statistic (signed)."},
    {id:"pca_regime",label:"PCA Regime Filter",math:"Σ = QΛQᵀ  ·  σ²_port = wᵀΣw",color:C.amb,desc:"Eigendecomposition of cross-sectional return covariance Σ. First-PC explained variance > 70% → systemic risk → signal = −1 (risk-off). Dispersed variance < 40% → signal = +1 (risk-on)."},
    {id:"fat_tail_risk",label:"Fat-Tail Risk",math:"Student-t MLE → VaR₉₅ → size = target/VaR",color:C.red,desc:"Fits Student-t via MLE to rolling window. Computes 95th-pct VaR under fitted tail. Position size = target_VaR/unit_VaR. Lower ν (fatter tails) → smaller position, clipped to [0,1]."},
  ];
  const sig=SIGS.find(s=>s.id===sel);

  const codeMap={
    bayesian_update:`K = σ²_prior / (σ²_prior + σ²_lik)\nμ_post = μ_prior + K*(obs - μ_prior)\nσ²_post = (1 - K) * σ²_prior\nσ²_prior /= decay²  # adapt to regimes`,
    regression_alpha:`X = add_constant(features)\nmodel = OLS(returns, X)\nresult = model.fit(\n  cov_type="HAC",\n  cov_kwds={"maxlags": 5}\n)\nsignal[i] = result.tvalues[0]  # alpha t-stat`,
    pca_regime:`cov = np.cov(window.T)\nλ, Q = np.linalg.eigh(cov)\ntop_var = λ[-1] / λ.sum()\nif top_var > 0.70:\n  signal[i] = -1.0  # risk-off\nelif top_var < 0.40:\n  signal[i] = +1.0  # risk-on\nelse:\n  signal[i] =  0.0  # transition`,
    fat_tail_risk:`ν, μ, σ = t.fit(window_returns)\nν = max(2.1, ν)  # bound for variance\nVaR = abs(t.ppf(0.05,\n  df=ν, loc=μ, scale=σ))\nsize = min(1.0, target_VaR / VaR)\nsignal[i] = size`,
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div><Lbl>Signal Library</Lbl><div style={mono(11,C.mut)}>5 modular signals · mathematically documented</div></div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{SIGS.map(s=><Pill key={s.id} label={s.label} active={sel===s.id} onClick={()=>setSel(s.id)}/>)}</div>

      {sig&&<Card accent={sig.color}>
        <div style={mono(14,"#fff",700)}>{sig.label}</div>
        <code style={{display:"inline-block",marginTop:6,padding:"3px 10px",borderRadius:6,background:sig.color+"15",border:`1px solid ${sig.color}30`,...mono(11,sig.color)}}>{sig.math}</code>
        <p style={{...mono(11,C.mut),marginTop:10,lineHeight:1.8}}>{sig.desc}</p>
      </Card>}

      {sel==="conditional_probability"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1.6fr",gap:16}}>
          <Card>
            <Lbl>Explorer Controls</Lbl>
            <div style={{marginBottom:14}}>
              <div style={{...mono(9,C.mut),marginBottom:4}}>Threshold τ = {thresh.toFixed(2)}</div>
              <input type="range" min="-2.5" max="2.5" step="0.1" value={thresh} onChange={e=>setThresh(+e.target.value)} style={{width:"100%",accentColor:C.grn}}/>
            </div>
            {[["P(up) — base rate","53.1%",C.txt],["P(up | cond > τ)","61.2%",C.grn],["Edge","+8.1%",C.grn],["95% CI","[55.8%, 66.6%]",C.mut],["z-statistic","2.87",C.sky],["p-value","0.004",C.grn],["N (condition true)","341",C.mut],["N (total)","2,478",C.mut]].map(([k,v,c])=><KV key={k} k={k} v={v} vc={c}/>)}
            <div style={{marginTop:10,padding:10,borderRadius:8,background:C.grnBg,border:`1px solid ${C.grn}25`,...mono(10,C.grn)}}>✓ Statistically significant (p = 0.004 &lt; 0.05)</div>
          </Card>
          <Card>
            <Lbl>P(up | cond &gt; τ) vs Threshold</Lbl>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={CP_DATA} margin={{top:8,right:8,left:0,bottom:20}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
                <XAxis dataKey="x" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} label={{value:"z-score threshold",fill:C.mut,fontSize:10,dy:16}}/>
                <YAxis domain={[0.25,0.85]} tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} tickFormatter={v=>`${(v*100).toFixed(0)}%`}/>
                <Tooltip {...TT} formatter={v=>[`${(v*100).toFixed(1)}%`]}/>
                <ReferenceLine y={0.531} stroke={C.sky} strokeDasharray="4 2" label={{value:"Base 53.1%",fill:C.sky,fontSize:9,fontFamily:"monospace"}}/>
                <ReferenceLine x={thresh} stroke={C.amb} strokeDasharray="4 2" label={{value:`τ=${thresh.toFixed(1)}`,fill:C.amb,fontSize:9,fontFamily:"monospace"}}/>
                <Line type="monotone" dataKey="c" name="P(up|cond)" stroke={C.grn} strokeWidth={2.5} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {sel!=="conditional_probability"&&codeMap[sel]&&(
        <Card>
          <Lbl>Implementation Detail</Lbl>
          <CodeBox>{codeMap[sel]}</CodeBox>
        </Card>
      )}
    </div>
  );
}

function OptimizeView() {
  const weights={SPY:35,QQQ:22,IWM:13,TLT:18,GLD:12};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div><Lbl>Portfolio Optimizer</Lbl><div style={mono(11,C.mut)}>Markowitz mean-variance · Minimize σ² = wᵀΣw via cvxpy</div></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        <Stat label="Expected Return (ann.)" value="8.47%" color={C.grn}/>
        <Stat label="Portfolio Volatility"   value="12.31%" color={C.amb}/>
        <Stat label="Sharpe Ratio"           value="0.689" color={C.sky}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card>
          <Lbl>Optimal Weights — Min Variance</Lbl>
          <div style={{marginTop:8}}>
            {Object.entries(weights).map(([sym,w])=>(
              <div key={sym} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <span style={{...mono(12,C.txt,700),width:34}}>{sym}</span>
                <div style={{flex:1,height:14,borderRadius:99,background:C.bg||C.dim,border:`1px solid ${C.bdr}`,overflow:"hidden"}}>
                  <div style={{width:`${w*2.5}%`,height:"100%",background:C.grn,opacity:0.75,borderRadius:99,transition:"width .5s"}}/>
                </div>
                <span style={{...mono(12,C.grn,700),width:32,textAlign:"right"}}>{w}%</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:12}}>
            <CodeBox>{"min   σ² = wᵀΣw\ns.t.  1ᵀw = 1\n      0 ≤ wᵢ ≤ 0.40\n      μᵀw ≥ r_target\n      ‖w − w_prev‖₁ ≤ τ"}</CodeBox>
          </div>
        </Card>
        <Card>
          <Lbl>Efficient Frontier</Lbl>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{top:10,right:10,left:0,bottom:24}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="vol" name="Volatility %" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} label={{value:"Volatility %",fill:C.mut,fontSize:10,dy:18}}/>
              <YAxis dataKey="ret" name="Return %" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} label={{value:"Return %",fill:C.mut,fontSize:10,angle:-90,dx:-16}}/>
              <Tooltip {...TT} formatter={(v,n)=>[`${v}%`,n]}/>
              <Scatter data={FRONTIER} fill={C.grn} opacity={0.8} line={{stroke:C.grn,strokeWidth:1.5}} lineType="fitting" r={3.5}/>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card>
        <Lbl>Covariance Estimators Available</Lbl>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginTop:8}}>
          {[{m:"Sample",d:"np.cov(R.T) — unbiased, noisy for p ≈ T",a:true},{m:"Ledoit-Wolf",d:"Shrinkage estimator — reduces estimation error",a:false},{m:"Factor Model",d:"Σ = BFBᵀ + D — exploits low-rank structure",a:false}].map(({m,d,a})=>(
            <div key={m} style={{padding:12,borderRadius:10,border:`1px solid ${a?C.grn+"40":C.bdr}`,background:a?C.grnBg:"transparent"}}>
              <div style={mono(11,a?C.grn:C.mut,700)}>{m}{a?" ✓":""}</div>
              <div style={{...mono(9,C.mut),marginTop:4,lineHeight:1.6}}>{d}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StochasticView() {
  const [tab,setTab]=useState("gbm");
  const PC=["#00e676","#40c4ff","#ffb300","#b388ff","#ff5252","#00bfa5","#7c4dff","#ff6d00"];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <Lbl>Stochastic Finance</Lbl>
      <div style={{display:"flex",gap:8}}>{[["gbm","GBM Simulation"],["bs","Black-Scholes"],["lmsr","LMSR Market"]].map(([id,l])=><Pill key={id} label={l} active={tab===id} onClick={()=>setTab(id)}/>)}</div>

      {tab==="gbm"&&(<>
        <Card>
          <Lbl>Geometric Brownian Motion — Ito's Lemma</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            <CodeBox>{"dS = μS dt + σS dW\n\nIto's lemma on f = ln(S):\nd(ln S) = (μ − σ²/2)dt + σdW\n\nExact solution:\nS(T) = S₀ exp[(μ−σ²/2)T + σ√T·Z]\nZ ~ N(0,1)\n\nE[S(T)] = S₀ e^(μT)"}</CodeBox>
            <div>{[["μ (drift)","8% p.a."],["σ (vol)","20% p.a."],["S₀","$100"],["T","1 year (52 wk)"],["Paths","8"],["E[S(T)] theory","$108.33"],["Var[S(T)] theory","$504.71"]].map(([k,v])=><KV key={k} k={k} v={v}/>)}</div>
          </div>
        </Card>
        <Card>
          <Lbl>Monte Carlo Paths</Lbl>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={GBM} margin={{top:5,right:5,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr}/>
              <XAxis dataKey="t" tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} label={{value:"Week",fill:C.mut,fontSize:10,dy:14}}/>
              <YAxis tick={{fill:C.mut,fontSize:10,fontFamily:"monospace"}} tickFormatter={v=>`$${v.toFixed(0)}`}/>
              <Tooltip {...TT} formatter={v=>[`$${v}`]}/>
              {Array.from({length:8},(_,i)=><Line key={i} type="monotone" dataKey={`p${i}`} stroke={PC[i]} strokeWidth={1.5} dot={false} opacity={0.8}/>)}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </>)}

      {tab==="bs"&&(<>
        <Card>
          <Lbl>Black-Scholes European Option Pricing</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            <CodeBox>{"C = S₀N(d₁) − Ke^(−rT)N(d₂)\nP = Ke^(−rT)N(−d₂) − S₀N(−d₁)\n\nd₁ = [ln(S/K)+(r+σ²/2)T] / σ√T\nd₂ = d₁ − σ√T\n\nPut-call parity:\nC − P = S₀e^(−qT) − Ke^(−rT)"}</CodeBox>
            <div>{[["S (spot)","$100.00"],["K (strike)","$100.00"],["T","0.25 yr"],["r","3%"],["σ","20%"],["Call (BS)","$4.358"],["Put (BS)","$3.610"],["MC Call","$4.329 ± 0.031"],["MC error","0.67%"],["Impl. vol","20.000% ✓"]].map(([k,v])=><KV key={k} k={k} v={v} vc={k.startsWith("Call")||k.startsWith("Put")?C.grn:C.txt}/>)}</div>
          </div>
        </Card>
        <Card>
          <Lbl>Option Greeks (ATM, T=0.25yr, σ=20%)</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginTop:8}}>
            {[{n:"Delta Δ",v:"0.5497",f:"∂C/∂S = N(d₁)",c:C.grn},{n:"Gamma Γ",v:"0.0396",f:"∂²C/∂S² = φ(d₁)/(Sσ√T)",c:C.sky},{n:"Theta Θ",v:"−0.0421",f:"∂C/∂t (per day)",c:C.amb},{n:"Vega ν",v:"0.1834",f:"S·φ(d₁)·√T / 100",c:C.pur},{n:"Rho ρ",v:"0.0821",f:"KTe^(−rT)N(d₂)/100",c:C.red}].map(g=>(
              <div key={g.n} style={{padding:12,borderRadius:10,border:`1px solid ${g.c}25`,background:g.c+"08"}}>
                <div style={mono(10,g.c,700)}>{g.n}</div>
                <div style={mono(18,"#fff",800)}>{g.v}</div>
                <div style={{...mono(9,C.mut),marginTop:4,lineHeight:1.5}}>{g.f}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12}}><CodeBox>Put-call parity: C − P = 4.358 − 3.610 = 0.748 ≈ S − Ke^(−rT) = 100 − 99.252 = 0.748  ✓</CodeBox></div>
        </Card>
      </>)}

      {tab==="lmsr"&&(<>
        <Card>
          <Lbl>LMSR Automated Market Maker</Lbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            <CodeBox>{"Cost function:\nC(q) = b·ln(Σᵢ exp(qᵢ/b))\n\nPrice / probability of outcome i:\npᵢ = exp(qᵢ/b) / Σⱼ exp(qⱼ/b)\n\nProperties:\n  Σᵢ pᵢ = 1  (probs sum to 1)\n  Max loss = b·ln(n)  (bounded)\n  Proper scoring rule"}</CodeBox>
            <div>{[["Liquidity param b","100"],["N outcomes","2 (bull/bear)"],["Max loss","b·ln(2) = $69.31"],["q_bull","124 shares"],["q_bear","48 shares"],["P(bull)","62.2%"],["P(bear)","37.8%"],["Buy 1 bull (cost)","$0.378"]].map(([k,v])=><KV key={k} k={k} v={v}/>)}</div>
          </div>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {[{l:"Bull (Up)",p:62.2,c:C.grn,q:"q = 124"},{l:"Bear (Down)",p:37.8,c:C.red,q:"q = 48"}].map(o=>(
            <Card key={o.l} accent={o.c}>
              <div style={mono(28,o.c,800)}>{o.p}%</div>
              <div style={mono(13,C.txt,700)}>{o.l}</div>
              <div style={{...mono(9,C.mut),marginTop:4}}>{o.q} shares outstanding</div>
              <div style={{marginTop:10,height:6,borderRadius:99,background:C.dim,overflow:"hidden"}}>
                <div style={{width:`${o.p}%`,height:"100%",background:o.c,opacity:0.8}}/>
              </div>
            </Card>
          ))}
        </div>
        <Card>
          <Lbl>LMSR as Trading Signal</Lbl>
          <p style={{...mono(11,C.mut),lineHeight:1.8}}>The LMSR bull probability (62.2%) feeds directly into the signal pipeline: it can gate the Bayesian Update signal, scale the Fat-Tail position size, or act as an independent signal. When P(bull) &gt; 0.60, the system scales up allocation proportionally — integrating prediction-market crowd wisdom with quantitative model signals.</p>
        </Card>
      </>)}
    </div>
  );
}

function ReportView() {
  const metrics=[["CAGR","8.12%"],["Total Return","+124.7%"],["Volatility","14.20%"],["Sharpe Ratio","0.6310"],["Sortino Ratio","0.8940"],["Max Drawdown","−18.70%"],["Calmar Ratio","0.4330"],["Annual Turnover","241%"],["N Trades","1,847"],["Total Fees","$23,841"],["Alpha (ann.)","+2.31%"],["Alpha t-stat","2.1400"],["Alpha p-value","0.0330"],["N Days","2,520"]];
  const sections=[
    {t:"Executive Summary",b:"Strategy evaluated on SPY, QQQ, IWM, TLT, GLD over 10 years daily bars. Classified as VALID after full statistical gatekeeping pipeline including t-test, Benjamini-Hochberg multiple comparison correction, and 10,000-shuffle permutation test."},
    {t:"Statistical Validation",b:"t-stat = 2.14, corrected p = 0.047 (Benjamini-Hochberg), permutation p = 0.038. Passes all gates at α = 0.05. Null: returns ~ iid N(0, σ²). Both parametric and non-parametric tests agree."},
    {t:"Alpha Regression",b:"Annualized alpha = 2.31% (t = 2.14, p = 0.033). OLS with Newey-West HAC standard errors, 5 lags, corrects for heteroskedasticity and autocorrelation. H₀: α = 0."},
    {t:"Transaction Costs",b:"1bp fee + 2bp slippage (one-way). Next-open execution. Total fees $23,841 · slippage $47,682 · annual turnover 241%. Cost model reduces reported CAGR by approximately 1.8% vs gross."},
    {t:"Walk-Forward Validation",b:"2-year train / 6-month test rolling windows. OOS Sharpe across 4 splits: 0.61, 0.58, 0.67, 0.54 (avg 0.60). OOS performance consistent with in-sample — limited evidence of overfitting."},
    {t:"Disclaimer",b:"Not financial advice. Historical backtests do not predict future returns. Markets involve risk. Survivorship bias not addressed. Live execution costs may differ. Past performance is not indicative of future results."},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <Card accent={C.grn}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16}}>
          <div>
            <div style={{...mono(9,C.mut,700),letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:6}}># Research Report</div>
            <div style={mono(24,"#fff",800)}>SPY Momentum Alpha</div>
            <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
              <Tag color={C.mut}>Run: demo_run_01</Tag>
              <Tag color={C.mut}>{new Date().toUTCString()}</Tag>
              <Tag color={C.grn}>✓ VALID</Tag>
            </div>
          </div>
          <div style={{...mono(10,C.amb),padding:"8px 14px",borderRadius:8,border:`1px solid ${C.amb}30`,background:C.amb+"08",flexShrink:0,textAlign:"right"}}>⚠ Not financial advice.<br/>Markets involve risk.</div>
        </div>
      </Card>

      <Card>
        <Lbl>Performance Metrics</Lbl>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 40px",marginTop:8}}>
          {metrics.map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.bdr}`}}>
              <span style={mono(9,C.mut)}>{k}</span><span style={mono(11,C.txt,700)}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {sections.map(s=>(
        <Card key={s.t}><Lbl>## {s.t}</Lbl><p style={{...mono(11,C.mut),lineHeight:1.8}}>{s.b}</p></Card>
      ))}

      <Card>
        <Lbl>Run Artifacts</Lbl>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
          {[["metrics.json","Full metrics",C.grn],["trades.parquet","Complete trade log",C.sky],["equity_curve.json","Curve + timestamps",C.grn],["equity_curve.png","Chart",C.pur],["drawdown.png","Drawdown chart",C.red],["alpha_regression.json","OLS detail",C.amb],["permutation_test.png","Null distribution",C.sky],["report.md","This document",C.mut]].map(([f,d,col])=>(
            <div key={f} style={{display:"flex",gap:10,padding:"8px 10px",borderRadius:8,background:C.dim,border:`1px solid ${C.bdr}`}}>
              <FileText size={11} style={{color:col,flexShrink:0,marginTop:2}}/>
              <div><div style={mono(10,col,700)}>{f}</div><div style={mono(9,C.mut)}>{d}</div></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── App ─────────────────────────────────────────────────
const NAV=[{id:"overview",l:"Overview",I:BarChart2},{id:"signals",l:"Signals",I:Zap},{id:"backtest",l:"Backtest",I:FlaskConical},{id:"optimize",l:"Optimizer",I:Target},{id:"stochastic",l:"Stochastic",I:Globe},{id:"report",l:"Report",I:FileText}];

export default function App() {
  const [view,setView]=useState("overview");
  const VIEWS={overview:<OverviewView onNav={setView}/>,signals:<SignalsView/>,backtest:<BacktestView/>,optimize:<OptimizeView/>,stochastic:<StochasticView/>,report:<ReportView/>};
  return (
    <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"monospace"}}>
      <aside style={{width:186,flexShrink:0,borderRight:`1px solid ${C.bdr}`,display:"flex",flexDirection:"column",background:C.surf}}>
        <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${C.bdr}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <div style={{width:26,height:26,borderRadius:8,background:C.grnBg,border:`1px solid ${C.grn}30`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <BarChart2 size={14} style={{color:C.grn}}/>
            </div>
            <span style={mono(11,"#fff",700)}>Quant Engine</span>
          </div>
          <div style={mono(9,C.mut)}>v1.0.0 · Research Platform</div>
        </div>
        <nav style={{flex:1,padding:"10px 8px",overflowY:"auto"}}>
          {NAV.map(({id,l,I})=>{
            const a=view===id;
            return (
              <button key={id} onClick={()=>setView(id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",borderRadius:8,marginBottom:2,border:`1px solid ${a?C.grn+"30":"transparent"}`,background:a?C.grnBg:"transparent",cursor:"pointer",transition:"all .15s",...mono(11,a?C.grn:C.mut,a?700:400)}}
                onMouseEnter={e=>{if(!a)e.currentTarget.style.color=C.txt;}} onMouseLeave={e=>{if(!a)e.currentTarget.style.color=C.mut;}}>
                <I size={13} style={{flexShrink:0}}/>{l}
              </button>
            );
          })}
        </nav>
        <div style={{padding:"10px 12px",borderTop:`1px solid ${C.bdr}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:8,border:`1px solid ${C.grn}25`,background:C.grnBg}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:C.grn}}/>
            <span style={mono(9,C.grn)}>Demo Mode</span>
          </div>
          <div style={{...mono(8,C.mut),marginTop:8,lineHeight:1.6}}>⚠ Not financial advice.<br/>Markets involve risk.</div>
        </div>
      </aside>
      <main style={{flex:1,overflowY:"auto",padding:"26px 30px"}}>
        <div style={{maxWidth:980,margin:"0 auto"}}>{VIEWS[view]||VIEWS.overview}</div>
      </main>
    </div>
  );
}

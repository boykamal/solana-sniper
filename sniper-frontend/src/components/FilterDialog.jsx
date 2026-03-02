import { useState, useEffect } from 'react'

const DEFAULT = {
  min_liquidity:  5000,
  min_volume:     1000,
  max_age_hours:  720,
  min_score:      15,
  min_buys:       0,
  max_price_drop: -90,
  dex_filter:     [],
  only_new:       false,
  only_gainers:   false,
}

const DEX_OPTIONS = ['raydium','orca','pumpfun','meteora','phoenix']

const fmtNum = v => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M`
                  : v >= 1_000 ? `$${(v/1_000).toFixed(0)}k` : `$${v}`

export function FilterDialog({ onClose, onApply }) {
  const [f,    setF]    = useState(DEFAULT)
  const [saved, setSaved] = useState(false)

  // Load current filter from backend on open
  useEffect(() => {
    fetch('/api/scan-filter')
      .then(r => r.json())
      .then(r => { if (r.data) setF(r.data) })
      .catch(() => {})
  }, [])

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const toggleDex = (d) => setF(p => ({
    ...p,
    dex_filter: p.dex_filter.includes(d)
      ? p.dex_filter.filter(x => x !== d)
      : [...p.dex_filter, d]
  }))

  const apply = async () => {
    try {
      await fetch('/api/scan-filter', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(f),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      onApply?.(f)
    } catch {}
  }

  const reset = () => setF(DEFAULT)

  return (
    <div style={overlay}>
      <div style={dialog}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontFamily:"'Orbitron',monospace", color:'#00dcb4', fontSize:14, letterSpacing:2 }}>
            ⚙ SCANNER FILTERS
          </span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Info banner */}
        <div style={infoBanner}>
          <span style={{ color:'#ffd700' }}>💡</span>
          {' '}Filters apply to the backend scanner in real-time. Lower thresholds = more tokens shown.
          The scanner uses DexScreener boosted tokens, latest listings, and keyword sweeps — not keyword-locked.
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>

          {/* Min Liquidity */}
          <SliderRow
            label="MIN LIQUIDITY"
            value={f.min_liquidity}
            min={0} max={200000} step={1000}
            display={fmtNum(f.min_liquidity)}
            onChange={v => set('min_liquidity', v)}
            presets={[[0,'OFF'],[2000,'$2k'],[5000,'$5k'],[30000,'$30k'],[100000,'$100k']]}
          />

          {/* Min Volume */}
          <SliderRow
            label="MIN 24H VOLUME"
            value={f.min_volume}
            min={0} max={500000} step={1000}
            display={fmtNum(f.min_volume)}
            onChange={v => set('min_volume', v)}
            presets={[[0,'OFF'],[1000,'$1k'],[10000,'$10k'],[50000,'$50k'],[100000,'$100k']]}
          />

          {/* Max Age */}
          <SliderRow
            label="MAX TOKEN AGE"
            value={f.max_age_hours}
            min={1} max={8760} step={1}
            display={f.max_age_hours >= 720 ? 'Any age'
              : f.max_age_hours >= 24 ? `${(f.max_age_hours/24).toFixed(0)}d`
              : `${f.max_age_hours}h`}
            onChange={v => set('max_age_hours', v)}
            presets={[[1,'1h'],[6,'6h'],[24,'1d'],[72,'3d'],[720,'Any']]}
          />

          {/* Min Score */}
          <SliderRow
            label="MIN SCORE"
            value={f.min_score}
            min={0} max={80} step={5}
            display={`${f.min_score}`}
            onChange={v => set('min_score', v)}
            presets={[[0,'All'],[15,'15'],[30,'30'],[45,'45'],[60,'60']]}
            scoreColor
          />

          {/* Min Buys h1 */}
          <SliderRow
            label="MIN BUYS (1H)"
            value={f.min_buys}
            min={0} max={100} step={5}
            display={`${f.min_buys}`}
            onChange={v => set('min_buys', v)}
            presets={[[0,'Off'],[5,'5'],[10,'10'],[25,'25'],[50,'50']]}
          />

          {/* Max price drop */}
          <SliderRow
            label="MAX 1H DROP ALLOWED"
            value={f.max_price_drop}
            min={-100} max={0} step={5}
            display={`${f.max_price_drop}%`}
            onChange={v => set('max_price_drop', v)}
            presets={[[-100,'Any'],[-90,'-90%'],[-50,'-50%'],[-30,'-30%'],[-10,'-10%']]}
          />
        </div>

        {/* Toggle switches */}
        <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
          <ToggleBtn
            label="🆕 NEW ONLY (<24h)"
            active={f.only_new}
            onClick={() => set('only_new', !f.only_new)}
          />
          <ToggleBtn
            label="📈 GAINERS ONLY"
            active={f.only_gainers}
            onClick={() => set('only_gainers', !f.only_gainers)}
          />
        </div>

        {/* DEX filter */}
        <div style={{ marginTop:12 }}>
          <div style={sectionLabel}>DEX FILTER (empty = all)</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:6 }}>
            {DEX_OPTIONS.map(d => (
              <button
                key={d}
                style={dexBtn(f.dex_filter.includes(d))}
                onClick={() => toggleDex(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display:'flex', gap:8, marginTop:16 }}>
          <button style={{ ...actionBtn('#00ff88'), flex:1 }} onClick={apply}>
            {saved ? '✅ APPLIED' : '⚡ APPLY FILTERS'}
          </button>
          <button style={actionBtn('#4a7a8a')} onClick={reset}>RESET</button>
          <button style={actionBtn('#4a7a8a')} onClick={onClose}>CLOSE</button>
        </div>

        {/* Quick presets */}
        <div style={{ marginTop:10 }}>
          <div style={sectionLabel}>QUICK PRESETS</div>
          <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
            {[
              ['🔬 DEGEN',    { min_liquidity:2000,   min_volume:500,   max_age_hours:720, min_score:0,  only_new:false, only_gainers:false, min_buys:0,  max_price_drop:-100, dex_filter:[] }],
              ['⚖️ BALANCED', { min_liquidity:10000,  min_volume:5000,  max_age_hours:168, min_score:20, only_new:false, only_gainers:false, min_buys:5,  max_price_drop:-60,  dex_filter:[] }],
              ['🛡 SAFE',     { min_liquidity:100000, min_volume:50000, max_age_hours:72,  min_score:50, only_new:false, only_gainers:true,  min_buys:10, max_price_drop:-30,  dex_filter:[] }],
              ['🆕 NEW GEM',  { min_liquidity:5000,   min_volume:1000,  max_age_hours:24,  min_score:15, only_new:true,  only_gainers:false, min_buys:0,  max_price_drop:-50,  dex_filter:[] }],
              ['📈 MOMENTUM', { min_liquidity:20000,  min_volume:20000, max_age_hours:168, min_score:30, only_new:false, only_gainers:true,  min_buys:10, max_price_drop:-20,  dex_filter:[] }],
            ].map(([label, preset]) => (
              <button
                key={label}
                style={presetBtn}
                onClick={() => setF({ ...DEFAULT, ...preset })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SliderRow({ label, value, min, max, step, display, onChange, presets, scoreColor }) {
  const color = scoreColor
    ? value >= 60 ? '#00ff88' : value >= 30 ? '#ffd700' : '#ff6b35'
    : '#00dcb4'
  return (
    <div style={{ background:'#020509', border:'1px solid rgba(255,255,255,0.04)', borderRadius:5, padding:'10px 12px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <span style={sectionLabel}>{label}</span>
        <span style={{ color, fontWeight:'bold', fontSize:12 }}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:'100%', accentColor: color, marginBottom:6 }}
      />
      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
        {presets.map(([v, l]) => (
          <button
            key={l}
            style={{ ...presetBtn, background: value===v?'rgba(0,220,180,0.15)':'transparent',
              border:`1px solid ${value===v?'#00dcb4':'#0a1a24'}`,
              color: value===v?'#00dcb4':'#3a6a7a' }}
            onClick={() => onChange(v)}
          >{l}</button>
        ))}
      </div>
    </div>
  )
}

function ToggleBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(0,255,136,0.12)' : 'transparent',
        border:     `1px solid ${active ? '#00ff88' : '#0a1a24'}`,
        color:      active ? '#00ff88' : '#4a7a8a',
        padding:    '6px 14px', borderRadius:4, cursor:'pointer',
        fontSize:10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1,
      }}
    >{active ? '✓ ' : ''}{label}</button>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const overlay = {
  position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
  zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center',
  backdropFilter:'blur(4px)',
}
const dialog = {
  background:'#050d14', border:'1px solid rgba(0,220,180,0.25)',
  borderRadius:8, padding:20, width:'min(680px, 95vw)',
  maxHeight:'90vh', overflowY:'auto',
  boxShadow:'0 20px 60px rgba(0,0,0,0.8)',
}
const infoBanner = {
  background:'rgba(0,220,180,0.04)', border:'1px solid rgba(0,220,180,0.1)',
  borderRadius:4, padding:'8px 10px', fontSize:10, color:'#4a9a8a',
  lineHeight:1.6, marginBottom:12,
}
const sectionLabel = { color:'#2a5a6a', fontSize:9, letterSpacing:1 }
const closeBtn = {
  background:'transparent', border:'1px solid rgba(255,68,102,0.3)',
  color:'#ff4466', padding:'3px 10px', borderRadius:3, cursor:'pointer',
  fontFamily:"'IBM Plex Mono',monospace", fontSize:11,
}
const actionBtn = (c) => ({
  background:`${c}15`, border:`1px solid ${c}55`, color:c,
  padding:'9px 16px', borderRadius:4, cursor:'pointer', fontSize:11,
  fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1,
})
const dexBtn = (active) => ({
  background: active ? 'rgba(0,220,180,0.15)' : 'transparent',
  border: `1px solid ${active ? '#00dcb4' : '#0a1a24'}`,
  color:  active ? '#00dcb4' : '#3a6a7a',
  padding:'4px 12px', borderRadius:3, cursor:'pointer',
  fontSize:10, fontFamily:"'IBM Plex Mono',monospace",
  textTransform:'uppercase', letterSpacing:0.5,
})
const presetBtn = {
  background:'transparent', border:'1px solid #0a1a24', color:'#3a6a7a',
  padding:'3px 8px', borderRadius:3, cursor:'pointer',
  fontSize:9, fontFamily:"'IBM Plex Mono',monospace",
}

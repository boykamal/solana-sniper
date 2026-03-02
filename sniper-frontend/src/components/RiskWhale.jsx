import { useState } from 'react'

// ─── WHALE TRACKER ────────────────────────────────────────────────────────────

const KNOWN_WHALES = [
  { address: 'GUfCR9mK6azb9vcpsxgXyj7XRPAaF6GFSzBCXBVRL7k', label: 'SOL Whale #1' },
  { address: '8xot8L9o7qnYfSzLEeR9LFYBpWCFJtXYK2xhMQCJwJvf', label: 'DeFi Whale' },
  { address: 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq', label: 'Raydium MM' },
]

export function WhaleTracker({ onAlert }) {
  const [wallets,   setWallets]   = useState(KNOWN_WHALES)
  const [newWallet, setNewWallet] = useState('')
  const [newLabel,  setNewLabel]  = useState('')
  const [activity,  setActivity]  = useState([])

  const addWallet = () => {
    if (!newWallet.trim() || newWallet.trim().length < 32 || newWallet.trim().length > 44) {
      onAlert?.('WARNING', 'Enter a valid Solana address')
      return
    }
    setWallets(w => [...w, { address: newWallet.trim(), label: newLabel || 'Custom Whale' }])
    setNewWallet('')
    setNewLabel('')
  }

  const removeWallet = (addr) => setWallets(w => w.filter(x => x.address !== addr))

  const openSolscan = (addr) =>
    window.open(`https://solscan.io/account/${addr}`, '_blank')
  const openStep = (addr) =>
    window.open(`https://step.finance/en/portfolio/${addr}`, '_blank')

  return (
    <div>
      <div style={card}>
        <div style={{ color:'#00dcb4', letterSpacing:2, marginBottom:12, fontSize:11 }}>
          🐋 WHALE WALLET MONITOR
        </div>

        {wallets.map(w => (
          <div key={w.address} style={{ ...card, border:'1px solid #0a1a24', marginBottom:6 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 }}>
              <div>
                <div style={{ color:'#00dcb4', fontWeight:'bold', fontSize:11 }}>{w.label}</div>
                <div style={{ color:'#4a7a8a', fontSize:9, fontFamily:'monospace', marginTop:2 }}>
                  {w.address.slice(0,12)}…{w.address.slice(-8)}
                </div>
              </div>
              <div style={{ display:'flex', gap:5 }}>
                <button style={smBtn('#a0c4ff')} onClick={() => openSolscan(w.address)}>Solscan ↗</button>
                <button style={smBtn('#ffd700')} onClick={() => openStep(w.address)}>Portfolio ↗</button>
                <button style={smBtn('#ff4466')} onClick={() => removeWallet(w.address)}>✕</button>
              </div>
            </div>
          </div>
        ))}

        {/* Add wallet */}
        <div style={{ borderTop:'1px solid #0a1a24', paddingTop:10, marginTop:4 }}>
          <div style={{ color:'#4a7a8a', fontSize:9, letterSpacing:1, marginBottom:8 }}>
            ADD WHALE TO MONITOR
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <input
              value={newWallet}
              onChange={e => setNewWallet(e.target.value)}
              placeholder="Solana wallet address"
              style={{ ...input, flex:2, minWidth:200 }}
            />
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ ...input, flex:1, minWidth:120 }}
            />
            <button style={smBtn('#00ff88')} onClick={addWallet}>+ ADD</button>
          </div>
        </div>
      </div>

      {/* Copy trading logic guide */}
      <div style={{ ...card, border:'1px solid rgba(255,215,0,0.15)' }}>
        <div style={{ color:'#ffd700', fontSize:10, letterSpacing:2, marginBottom:10 }}>
          ⚡ COPY TRADING SIGNALS
        </div>
        {[
          ['🟢','3+ whales BUY same token in 10 min','STRONG BUY — enter full size'],
          ['🟢','Whale with >$100k buys <2h old token','EARLY ENTRY — enter 50%'],
          ['🔴','Whale sells >40% of position','EXIT IMMEDIATELY'],
          ['🔴','Dev wallet dumps >10% supply','INSTANT RUG EXIT'],
          ['🔴','Top holder concentration >20%','SKIP — rug risk'],
          ['🟡','Buy/sell ratio flips negative','TIGHTEN stop loss'],
        ].map(([e,t,a]) => (
          <div key={t} style={{ display:'grid', gridTemplateColumns:'20px 1fr auto', gap:8,
            padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.03)', alignItems:'center' }}>
            <span>{e}</span>
            <span style={{ color:'#8fb8d0', fontSize:10 }}>{t}</span>
            <span style={{ color: a.includes('STRONG')||a.includes('EARLY')?'#00ff88':
              a.includes('EXIT')||a.includes('SKIP')?'#ff4466':'#ffd700',
              fontSize:9, textAlign:'right' }}>{a}</span>
          </div>
        ))}
      </div>

      <div style={{ ...card, border:'1px solid rgba(255,68,102,0.15)' }}>
        <div style={{ color:'#ff4466', fontSize:10, letterSpacing:2, marginBottom:8 }}>
          🚨 REAL-TIME MONITORING
        </div>
        <div style={{ color:'#4a7a8a', fontSize:10, lineHeight:1.8 }}>
          For real-time whale tx alerts, integrate with:<br/>
          • <a href="https://helius.dev" target="_blank" style={{ color:'#00dcb4' }}>Helius webhooks</a> — Solana tx monitoring<br/>
          • <a href="https://birdeye.so" target="_blank" style={{ color:'#00dcb4' }}>Birdeye</a> — wallet tracking API<br/>
          • <a href="https://nansen.ai" target="_blank" style={{ color:'#00dcb4' }}>Nansen</a> — labeled wallet intelligence<br/>
          Set <code style={{color:'#ffd700'}}>HELIUS_WEBHOOK_URL</code> in your .env for live alerts.
        </div>
      </div>
    </div>
  )
}

// ─── RISK ENGINE ──────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  maxPositionPct:   10,
  stopLossPct:      15,
  maxPositions:      5,
  minLiquidity:  30000,
  minVolume:     10000,
  maxAge:           72,
  minScore:         55,
  slippageBps:     300,
  priorityFee:  500000,
}

export function RiskEngine({ onAlert }) {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [saved,  setSaved]  = useState(false)

  const set = (k, v) => setParams(p => ({ ...p, [k]: v }))

  const save = () => {
    localStorage.setItem('sniper_risk_params', JSON.stringify(params))
    setSaved(true)
    onAlert?.('INFO', '⚙ Risk parameters saved')
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = () => {
    setParams(DEFAULT_PARAMS)
    onAlert?.('INFO', 'Risk parameters reset to defaults')
  }

  return (
    <div>
      <div style={card}>
        <div style={{ color:'#ff6b35', letterSpacing:2, marginBottom:14, fontSize:11 }}>
          ⚙ RISK PARAMETERS
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {[
            ['MAX POSITION SIZE', 'maxPositionPct', '%', 1, 25, 1],
            ['STOP LOSS', 'stopLossPct', '%', 5, 50, 1],
            ['MAX OPEN POSITIONS', 'maxPositions', '', 1, 10, 1],
            ['MIN LIQUIDITY', 'minLiquidity', 'USD', 5000, 500000, 5000],
            ['MIN 24H VOLUME', 'minVolume', 'USD', 1000, 500000, 1000],
            ['MAX TOKEN AGE', 'maxAge', 'h', 1, 168, 1],
            ['MIN SCORE', 'minScore', '', 20, 90, 5],
            ['SLIPPAGE', 'slippageBps', 'bps', 50, 1000, 50],
          ].map(([label, key, unit, min, max, step]) => (
            <div key={key} style={statItem}>
              <div style={{ color:'#2a5a6a', fontSize:9, letterSpacing:1 }}>{label}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6 }}>
                <input
                  type="range" min={min} max={max} step={step}
                  value={params[key]}
                  onChange={e => set(key, parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:'#00dcb4' }}
                />
                <span style={{ color:'#00dcb4', minWidth:60, textAlign:'right', fontSize:11 }}>
                  {key==='minLiquidity'||key==='minVolume'
                    ? `$${params[key].toLocaleString()}`
                    : `${params[key]}${unit}`}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:8, marginTop:14 }}>
          <button style={{ ...smBtn('#00ff88'), flex:1, padding:'8px 0', fontSize:11 }} onClick={save}>
            {saved ? '✅ SAVED' : '💾 SAVE PARAMS'}
          </button>
          <button style={{ ...smBtn('#ff4466'), padding:'8px 14px' }} onClick={reset}>RESET</button>
        </div>
      </div>

      {/* Take profit visual */}
      <div style={card}>
        <div style={{ color:'#00ff88', letterSpacing:2, marginBottom:12, fontSize:11 }}>
          📊 TAKE PROFIT LADDER
        </div>
        {[
          [1.5, 0.40, '#00ff88', 'TP1'],
          [2.0, 0.30, '#4ae8c0', 'TP2'],
          [5.0, 0.20, '#ffd700', 'TP3'],
          [10.0,0.10, '#ff9944', '🌙 MOON'],
        ].map(([mult, sell, color, label]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:10,
            padding:8, background:'#020509', borderRadius:4, marginBottom:5 }}>
            <span style={{ color, fontWeight:'bold', minWidth:55, fontSize:11 }}>{label}</span>
            <div style={{ flex:1, background:'#0a1a24', borderRadius:3, height:8, overflow:'hidden' }}>
              <div style={{ width:`${Math.min((mult-1)*12,100)}%`, height:'100%',
                background:color, borderRadius:3, boxShadow:`0 0 6px ${color}66` }} />
            </div>
            <span style={{ color, minWidth:55, textAlign:'right', fontSize:11 }}>
              +{((mult-1)*100).toFixed(0)}%
            </span>
            <span style={{ color:'#4a7a8a', minWidth:70, textAlign:'right', fontSize:10 }}>
              sell {(sell*100).toFixed(0)}% of bag
            </span>
          </div>
        ))}
        <div style={{ marginTop:8, padding:8, background:'#020509', borderRadius:4,
          fontSize:10, color:'#4a7a8a', lineHeight:1.8 }}>
          After TP1 hit → trailing stop raised to <span style={{color:'#00ff88'}}>entry +10%</span><br/>
          Max loss per $100 capital at default settings:{' '}
          <span style={{color:'#ff4466'}}>-${(100 * 0.10 * 0.15).toFixed(2)}</span>
        </div>
      </div>

      {/* Rug detectors */}
      <div style={{ ...card, border:'1px solid rgba(255,68,102,0.15)' }}>
        <div style={{ color:'#ff4466', letterSpacing:2, marginBottom:10, fontSize:11 }}>
          🚨 RUG PULL DETECTORS
        </div>
        {[
          ['🔴','Liquidity drops >30% in 5 min',   'AUTO EXIT'],
          ['🔴','Dev wallet dumps >10% supply',     'AUTO EXIT'],
          ['🔴','Sell txns 2x buys sustained 5min', 'TIGHTEN SL'],
          ['🔴','Token age <30 min',                'HONEYPOT SKIP'],
          ['🔴','Liq/MCap ratio <1%',               'MANIPULATION'],
          ['🟡','Score drops below min',            'REDUCE SIZE'],
          ['🟡','Price impact >3% on entry',        'ABORT TRADE'],
          ['🟢','Score 70+ + whale accumulation',   'MAX POSITION'],
        ].map(([e,t,a]) => (
          <div key={t} style={{ display:'grid', gridTemplateColumns:'18px 1fr auto', gap:8,
            padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.02)', alignItems:'center' }}>
            <span style={{ fontSize:11 }}>{e}</span>
            <span style={{ color:'#8fb8d0', fontSize:10 }}>{t}</span>
            <span style={{ fontSize:9,
              color:a==='AUTO EXIT'||a==='HONEYPOT SKIP'?'#ff4466':
                    a==='TIGHTEN SL'||a==='MANIPULATION'?'#ff6b35':
                    a==='REDUCE SIZE'||a==='ABORT TRADE'?'#ffd700':'#00ff88' }}>
              {a}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card = {
  background:'#050d14', border:'1px solid rgba(0,220,180,0.08)',
  borderRadius:6, padding:12, marginBottom:10,
}
const statItem = {
  background:'#020509', padding:'10px 12px', borderRadius:4,
  border:'1px solid rgba(255,255,255,0.04)',
}
const smBtn = (c) => ({
  background:`${c}12`, border:`1px solid ${c}44`, color:c,
  padding:'5px 12px', borderRadius:3, cursor:'pointer', fontSize:10,
  fontFamily:"'IBM Plex Mono',monospace",
})
const input = {
  background:'#020509', border:'1px solid rgba(0,220,180,0.2)',
  color:'#c8d8e8', padding:'7px 10px', borderRadius:4, fontSize:10,
  fontFamily:"'IBM Plex Mono',monospace", outline:'none',
}

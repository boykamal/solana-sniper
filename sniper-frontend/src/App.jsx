import { useState, useEffect, useReducer } from 'react'
import { useWallet, useConnection }        from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, PublicKey }     from '@solana/web3.js'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts'

import { WalletButton }            from './components/WalletButton.jsx'
import { Scanner }                 from './components/Scanner.jsx'
import { Portfolio }               from './components/Portfolio.jsx'
import { WhaleTracker, RiskEngine } from './components/RiskWhale.jsx'
import { useWebSocket }            from './hooks/useWebSocket.js'

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${location.host}/ws`

// ─── ALERT REDUCER ───────────────────────────────────────────────────────────

function alertReducer(state, action) {
  switch (action.type) {
    case 'ADD':
      return [{ ...action.alert, id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString() }, ...state].slice(0, 60)
    case 'CLEAR':
      return []
    default:
      return state
  }
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const { connected, publicKey } = useWallet()
  const { connection }           = useConnection()
  const { last, status }         = useWebSocket(WS_URL)

  const [tab,       setTab]       = useState('SCANNER')
  const [alerts,    dispatchAlert] = useReducer(alertReducer, [])
  const [solBal,    setSolBal]    = useState(null)
  const [usdcBal,   setUsdcBal]  = useState(null)
  const [pnlSeries, setPnlSeries] = useState([])
  const [extPositions, setExtPositions] = useState([])
  const [extTrades,    setExtTrades]    = useState([])
  const [backendOn, setBackendOn] = useState(false)
  const [portfolio, setPortfolio] = useState(null)

  const pushAlert = (level, message) =>
    dispatchAlert({ type: 'ADD', alert: { level, message } })

  // ── SOL balance polling ─────────────────────────────────────────────────
  useEffect(() => {
    if (!publicKey) { setSolBal(null); return }
    const update = () =>
      connection.getBalance(publicKey).then(b => {
        const sol = b / LAMPORTS_PER_SOL
        setSolBal(sol)
        setPnlSeries(s => [...s.slice(-80), {
          t:   new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'}),
          sol,
        }])
      })
    update()
    const iv = setInterval(update, 20000)
    return () => clearInterval(iv)
  }, [publicKey, connection])

  // ── USDC balance polling ────────────────────────────────────────────────
  useEffect(() => {
    if (!publicKey) { setUsdcBal(null); return }
    const fetchUsdc = () =>
      connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(USDC_MINT) })
        .then(res => {
          const amt = res.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0
          setUsdcBal(amt)
        })
        .catch(() => setUsdcBal(0))
    fetchUsdc()
    const iv = setInterval(fetchUsdc, 20000)
    return () => clearInterval(iv)
  }, [publicKey, connection])

  // ── WebSocket handler (backend data) ────────────────────────────────────
  useEffect(() => {
    if (!last) return
    const { type, payload } = last
    
    if (type === 'PortfolioUpdate') {
      setPortfolio(payload)
      setExtPositions(payload.positions || [])
      setExtTrades(payload.recent_trades || [])
    }
    if (type === 'Alert') {
      pushAlert(payload.level, payload.message)
    }
    if (type === 'TradeExecuted') {
      pushAlert('PROFIT', `⚡ ${payload}`)
    }
  }, [last])

  // ── Backend health check ─────────────────────────────────────────────────
  useEffect(() => {
    fetch('/health')
      .then(r => r.ok && setBackendOn(true))
      .catch(() => setBackendOn(false))
  }, [])

  // ── Wallet connect alert ─────────────────────────────────────────────────
  useEffect(() => {
    if (connected && publicKey)
      pushAlert('INFO', `✅ Wallet connected: ${publicKey.toBase58().slice(0,8)}…`)
  }, [connected, publicKey])

  const TABS = ['SCANNER','PORTFOLIO','WHALES','RISK ENGINE','ALERTS']
  const alertColor = { INFO:'#a0c4ff', WARNING:'#ffd700', CRITICAL:'#ff4466', PROFIT:'#00ff88' }

  // ── Unread alert badge ──────────────────────────────────────────────────
  const unread = alerts.length

  // ── Paper trade mode ────────────────────────────────────────────────────
  // Paper mode when backend confirms dry_run OR wallet is not connected
  const isPaperMode = !connected || portfolio?.is_paper_trade !== false

  return (
    <div style={rootStyle}>
      {/* ── Scanline overlay ── */}
      <div style={scanline} />

      {/* ══════════════════════════════════════════════════ */}
      {/* HEADER                                           */}
      {/* ══════════════════════════════════════════════════ */}
      <header style={headerStyle}>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={logoBadge}>
              <img src="/sodagar_logo.png" alt="Sodagar" style={{ height:28, display:'block' }} />
            </div>
            <div style={logoStyle}>SODAGAR SNIPER</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <StatusDot color={status==='LIVE'?'#00ff88':'#ff4466'} />
            <span style={{ color:'#2a5a6a', fontSize:9, letterSpacing:1 }}>
              WS:{status} {backendOn ? '• RUST ENGINE' : '• DEX DIRECT'}
            </span>
          </div>
        </div>

        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <div style={balChip}>
            <span style={{ color:'#2a5a6a', fontSize:9 }}>💰</span>
            <span style={{ color:'#ffd700', fontWeight:'bold' }}>
              ${(portfolio?.total_capital_usd ?? 100.0).toFixed(2)}
            </span>
            <span style={{ color:'#2a5a6a', fontSize:8 }}>CAPITAL</span>
          </div>
          {solBal !== null && (
            <div style={balChip}>
              <span style={{ color:'#2a5a6a', fontSize:9 }}>◎</span>
              <span style={{ color:'#00dcb4', fontWeight:'bold' }}>{solBal.toFixed(4)}</span>
              <span style={{ color:'#2a5a6a', fontSize:9 }}>SOL</span>
            </div>
          )}
          {usdcBal !== null && (
            <div style={balChip}>
              <span style={{ color:'#2a5a6a', fontSize:9 }}>$</span>
              <span style={{ color:'#a0c4ff', fontWeight:'bold' }}>{usdcBal.toFixed(2)}</span>
              <span style={{ color:'#2a5a6a', fontSize:9 }}>USDC</span>
            </div>
          )}
          <WalletButton />
        </div>
      </header>

      {/* ── SOL balance sparkline ── */}
      {pnlSeries.length > 3 && (
        <div style={{ height:36, margin:'0 0 10px', opacity:0.6 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pnlSeries}>
              <defs>
                <linearGradient id="solGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#00dcb4" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="#00dcb4" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={['auto','auto']} />
              <Area type="monotone" dataKey="sol" stroke="#00dcb4" fill="url(#solGrad)"
                strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* TABS                                             */}
      {/* ══════════════════════════════════════════════════ */}
      <nav style={navStyle}>
        {TABS.map(t => (
          <button key={t} style={tabBtn(tab===t)} onClick={() => setTab(t)}>
            {t}
            {t === 'ALERTS' && unread > 0 && (
              <span style={alertBadge}>{Math.min(unread, 99)}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Paper trade banner ─────────────────────────── */}
      {isPaperMode && (
        <div style={paperBanner}>
          <span style={{ color:'#ffd700', fontWeight:'bold', letterSpacing:2 }}>
            📄 PAPER TRADING MODE
          </span>
          <span style={{ color:'#4a7a8a', fontSize:10, marginLeft:10 }}>
            {connected
              ? 'DRY_RUN=true — simulated trades only, no real money'
              : 'Connect wallet to trade with real funds'}
          </span>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* NOT CONNECTED BANNER                             */}
      {/* ══════════════════════════════════════════════════ */}
      {!connected && tab === 'SCANNER' && (
        <div style={walletBanner}>
          <div style={{ fontSize:13 }}>
            Connect <strong>Phantom</strong>, <strong>Solflare</strong> or <strong>Backpack</strong>
            {' '}to execute real trades directly from this dashboard
          </div>
          <div style={{ color:'#4a7a8a', fontSize:10, marginTop:4 }}>
            Without a wallet you can browse signals — but not trade. Wallets supported:
            👻 Phantom · 🌟 Solflare · 🎒 Backpack · 🔵 Coinbase · 🛡 Trust
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* MAIN CONTENT                                     */}
      {/* ══════════════════════════════════════════════════ */}
      <main style={mainStyle}>
        {tab === 'SCANNER' && (
          <Scanner onAlert={pushAlert} portfolio={{ positions: extPositions }} />
        )}
        {tab === 'PORTFOLIO' && (
          <Portfolio
            onAlert={pushAlert}
            portfolio={portfolio}
            externalPositions={extPositions}
            externalTrades={extTrades}
            walletCapital={connected ? { sol: solBal, usdc: usdcBal } : null}
            isPaperMode={isPaperMode}
          />
        )}
        {tab === 'WHALES' && (
          <WhaleTracker onAlert={pushAlert} />
        )}
        {tab === 'RISK ENGINE' && (
          <RiskEngine onAlert={pushAlert} />
        )}
        {tab === 'ALERTS' && (
          <div style={card}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ color:'#ffd700', letterSpacing:2, fontSize:11 }}>
                🔔 SYSTEM ALERTS ({alerts.length})
              </span>
              <button style={smBtn('#ff4466')} onClick={() => dispatchAlert({ type:'CLEAR' })}>
                CLEAR ALL
              </button>
            </div>
            {alerts.length === 0 && (
              <div style={{ color:'#2a4a5a', textAlign:'center', padding:30 }}>
                No alerts yet. Start trading.
              </div>
            )}
            {alerts.map(a => (
              <div key={a.id} style={{ display:'flex', justifyContent:'space-between',
                alignItems:'flex-start', padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,0.03)',
                gap:10 }}>
                <span style={{ color: alertColor[a.level?.toUpperCase?.()] || '#a0c4ff',
                  fontSize:11, lineHeight:1.5 }}>
                  {a.message}
                </span>
                <span style={{ color:'#2a4a5a', fontSize:9, whiteSpace:'nowrap' }}>{a.time}</span>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={footerStyle}>
        ⚠ MEME COINS CARRY EXTREME RISK OF TOTAL LOSS — NEVER INVEST MORE THAN YOU CAN AFFORD TO LOSE
        <span style={{ marginLeft:16 }}>
          <a href="https://jup.ag" target="_blank" rel="noreferrer" style={{ color:'#2a5a6a' }}>JUP</a>
          {' · '}
          <a href="https://raydium.io" target="_blank" rel="noreferrer" style={{ color:'#2a5a6a' }}>RAY</a>
          {' · '}
          <a href="https://pump.fun" target="_blank" rel="noreferrer" style={{ color:'#2a5a6a' }}>PUMP</a>
        </span>
      </footer>
    </div>
  )
}

// ─── MICRO COMPONENTS ────────────────────────────────────────────────────────

function StatusDot({ color }) {
  return (
    <span style={{ width:6, height:6, borderRadius:'50%', background:color,
      display:'inline-block', boxShadow:`0 0 6px ${color}` }} />
  )
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const rootStyle = {
  background: '#020509',
  minHeight:  '100vh',
  fontFamily: "'IBM Plex Mono', monospace",
  color:      '#c8d8e8',
  position:   'relative',
  padding:    '0 0 20px',
}

const scanline = {
  position:       'fixed',
  top:0, left:0, right:0,
  height:         '100%',
  background:     'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,220,180,0.008) 2px, rgba(0,220,180,0.008) 4px)',
  pointerEvents:  'none',
  zIndex:         0,
}

const headerStyle = {
  display:         'flex',
  justifyContent:  'space-between',
  alignItems:      'center',
  padding:         '14px 20px 12px',
  borderBottom:    '1px solid rgba(0,220,180,0.12)',
  marginBottom:    10,
  position:        'sticky',
  top:             0,
  zIndex:          100,
  background:      'rgba(2,5,9,0.95)',
  backdropFilter:  'blur(8px)',
}

const logoBadge = {
  background:   'white',
  borderRadius: 6,
  padding:      '3px 6px',
  display:      'flex',
  alignItems:   'center',
  flexShrink:   0,
}

const logoStyle = {
  fontFamily:    "'Orbitron', monospace",
  fontSize:      22,
  fontWeight:    900,
  color:         '#ff6b35',
  letterSpacing: 4,
  textShadow:    '0 0 30px rgba(255,107,53,0.5), 0 0 60px rgba(255,107,53,0.2)',
}

const balChip = {
  display:    'flex',
  alignItems: 'center',
  gap:        5,
  background: 'rgba(0,220,180,0.06)',
  border:     '1px solid rgba(0,220,180,0.2)',
  borderRadius: 4,
  padding:    '5px 10px',
  fontSize:   12,
}

const navStyle = {
  display:    'flex',
  gap:        4,
  padding:    '0 20px 10px',
  flexWrap:   'wrap',
  position:   'relative',
  zIndex:     1,
}

const tabBtn = (active) => ({
  position:      'relative',
  padding:       '6px 16px',
  background:    active ? 'rgba(0,220,180,0.1)' : 'transparent',
  border:        active ? '1px solid rgba(0,220,180,0.35)' : '1px solid transparent',
  borderBottom:  active ? '2px solid #00dcb4' : '2px solid transparent',
  color:         active ? '#00dcb4' : '#3a6a7a',
  cursor:        'pointer',
  fontSize:      10,
  fontFamily:    "'IBM Plex Mono',monospace",
  letterSpacing: 1.5,
  transition:    'all 0.2s',
  borderRadius:  '4px 4px 0 0',
})

const alertBadge = {
  position:   'absolute', top:-6, right:-6,
  background: '#ff4466', color:'#fff',
  borderRadius: '50%', width:16, height:16,
  display:'flex', alignItems:'center', justifyContent:'center',
  fontSize:8, fontWeight:'bold',
}

const paperBanner = {
  margin:     '0 20px 8px',
  padding:    '7px 14px',
  background: 'rgba(255,215,0,0.05)',
  border:     '1px solid rgba(255,215,0,0.25)',
  borderRadius: 4,
  display:    'flex',
  alignItems: 'center',
  fontSize:   11,
  position:   'relative',
  zIndex:     1,
}

const walletBanner = {
  margin:     '0 20px 10px',
  padding:    '10px 14px',
  background: 'rgba(255,107,53,0.06)',
  border:     '1px solid rgba(255,107,53,0.25)',
  borderRadius: 5,
  color:      '#ff9944',
  fontSize:   11,
  lineHeight: 1.5,
  position:   'relative', zIndex:1,
}

const mainStyle = {
  padding:  '0 20px',
  position: 'relative',
  zIndex:   1,
}

const footerStyle = {
  textAlign:   'center',
  color:       '#1a3a4a',
  fontSize:    9,
  marginTop:   24,
  padding:     '0 20px',
  letterSpacing: 1,
  position:    'relative',
  zIndex:      1,
}

const card = {
  background: '#050d14',
  border:     '1px solid rgba(0,220,180,0.08)',
  borderRadius: 6,
  padding:    12,
  marginBottom: 10,
}

const smBtn = (c) => ({
  background:`${c}12`, border:`1px solid ${c}44`, color:c,
  padding:'4px 12px', borderRadius:3, cursor:'pointer', fontSize:10,
  fontFamily:"'IBM Plex Mono',monospace",
})

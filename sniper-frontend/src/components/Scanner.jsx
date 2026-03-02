import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletTrading } from '../hooks/useWalletTrading.js'
import { dex } from '../lib/api.js'
import { FilterDialog } from './FilterDialog.jsx'

const QUERIES = ['solana meme','solana bonk pump','solana cat dog','solana ai meme','solana pepe']
let qIdx = 0

function scoreToken(pair) {
  let s = 0
  const liq  = parseFloat(pair.liquidity?.usd  || 0)
  const vol  = parseFloat(pair.volume?.h24      || 0)
  const h1   = parseFloat(pair.priceChange?.h1  || 0)
  const h6   = parseFloat(pair.priceChange?.h6  || 0)
  const buys = pair.txns?.h1?.buys  || 0
  const sels = pair.txns?.h1?.sells || 0
  const age  = pair._age || 0

  if (liq > 500000) s+=25; else if (liq>200000) s+=18; else if (liq>100000) s+=12;
  else if (liq>50000) s+=7; else if (liq>30000) s+=3; else s-=15

  if (vol > 1000000) s+=20; else if (vol>500000) s+=15; else if (vol>100000) s+=10;
  else if (vol>50000) s+=5; else if (vol>10000) s+=2; else s-=5

  if (h1>5&&h1<50) s+=15; else if (h1>2&&h1<100) s+=8; else if (h1>0) s+=3;
  else if (h1<-40) s-=20; else if (h1<-20) s-=10

  if (h6>0&&h6>h1/2) s+=5

  const r = sels > 0 ? buys/sels : 2
  if (r>3) s+=18; else if (r>2) s+=12; else if (r>1.5) s+=7;
  else if (r<0.5) s-=15; else if (r<0.8) s-=8

  if (age<0.5) s-=30; else if (age<1) s-=15; else if (age<3) s-=5;
  else if (age<72) s+=8

  const mc = parseFloat(pair.marketCap || 0)
  if (liq>0 && mc>0 && liq/mc < 0.01) s -= 20

  return Math.max(0, Math.min(100, s))
}

const riskOf = s => s>=70?'SAFE':s>=45?'MODERATE':'DEGEN'
const scoreColor = s => s>=70?'#00ff88':s>=45?'#ffd700':'#ff6b35'
const pnlColor   = v => parseFloat(v)>=0?'#00ff88':'#ff4466'
const fmtLiq = v => v>=1e6?`$${(v/1e6).toFixed(1)}M`:v>=1000?`$${(v/1000).toFixed(0)}k`:`$${v.toFixed(0)}`

export function Scanner({ onAlert, portfolio }) {
  const { connected, publicKey }        = useWallet()
  const { buyWithSol, buyWithUsdc, loading } = useWalletTrading()
  const [tokens,   setTokens]           = useState([])
  const [filter,   setFilter]           = useState('ALL')
  const [selected, setSelected]         = useState(null)
  const [buyMode,  setBuyMode]          = useState('SOL')  // 'SOL' | 'USDC'
  const [buyAmt,   setBuyAmt]           = useState('')
  const [txStatus, setTxStatus]         = useState('')
  const [scanning, setScanning]         = useState(false)
  const [showFilter, setShowFilter]       = useState(false)
  const [sortBy,   setSortBy]           = useState('score')

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      const q    = QUERIES[qIdx++ % QUERIES.length]
      const data = await dex.search(q)
      const pairs = (data.pairs || [])
        .filter(p => p.chainId === 'solana' && parseFloat(p.liquidity?.usd || 0) > 5000)
        .map(p => {
          const age = p.pairCreatedAt
            ? (Date.now() - p.pairCreatedAt) / 3_600_000
            : 99
          const sc = scoreToken({ ...p, _age: age })
          return { ...p, _score: sc, _risk: riskOf(sc), _age: age }
        })
        .filter(p => p._score >= 20)
        .sort((a, b) => b._score - a._score)
        .slice(0, 60)
      setTokens(pairs)
    } catch {}
    setScanning(false)
  }, [])

  useEffect(() => { scan() }, [])
  useEffect(() => {
    const iv = setInterval(scan, 30_000)
    return () => clearInterval(iv)
  }, [scan])

  const visible = tokens.filter(t =>
    filter === 'ALL'      ? true :
    filter === 'SAFE'     ? t._score >= 70 :
    filter === 'MODERATE' ? t._score >= 45 && t._score < 70 :
    t._score < 45
  )

  const sorted = [...visible].sort((a, b) => {
    if (sortBy === 'score') return b._score - a._score
    if (sortBy === 'liq')   return (b.liquidity?.usd||0) - (a.liquidity?.usd||0)
    if (sortBy === 'vol')   return (b.volume?.h24||0) - (a.volume?.h24||0)
    if (sortBy === 'h1')    return (b.priceChange?.h1||0) - (a.priceChange?.h1||0)
    return 0
  })

  const handleBuy = async () => {
    if (!connected) { onAlert('WARNING', 'Connect your wallet first'); return }
    if (!selected)  return
    const amt = parseFloat(buyAmt)
    if (!amt || amt <= 0) { onAlert('WARNING', 'Enter a valid amount'); return }
    setTxStatus('')

    try {
      let result
      if (buyMode === 'SOL') {
        result = await buyWithSol({
          tokenMint:  selected.baseToken.address,
          solAmount:  amt,
          slippageBps: 300,
          onStatus:   setTxStatus,
        })
      } else {
        result = await buyWithUsdc({
          tokenMint:  selected.baseToken.address,
          usdcAmount: amt,
          slippageBps: 300,
          onStatus:   setTxStatus,
        })
      }
      onAlert('PROFIT',
        `✅ Bought ${selected.baseToken.symbol} — tx: ${result.signature.slice(0,12)}…`)
      setSelected(null)
      setBuyAmt('')
    } catch (e) {
      setTxStatus('')
      onAlert('CRITICAL', `❌ ${e.message}`)
    }
  }

  return (
    <div>
      {/* ── Filter + sort bar ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={label}>FILTER:</span>
        {[['ALL','#a0c4ff'],['SAFE','#00ff88'],['MODERATE','#ffd700'],['DEGEN','#ff6b35']].map(([f,c]) => (
          <button key={f} style={filterBtn(filter===f, c)} onClick={() => setFilter(f)}>{f}</button>
        ))}
        <span style={{ ...label, marginLeft: 'auto' }}>SORT:</span>
        {[['score','SCORE'],['liq','LIQ'],['vol','VOL'],['h1','1H%']].map(([k,l]) => (
          <button key={k} style={filterBtn(sortBy===k,'#a0c4ff')} onClick={() => setSortBy(k)}>{l}</button>
        ))}
        <span style={{ color: '#4a7a8a', fontSize: 9 }}>{visible.length} tokens</span>
        <button style={filterBtn(false,'#00dcb4')} onClick={scan}>
          {scanning ? '…' : '↺'}
        </button>
        <button style={filterBtn(false,'#ffd700')} onClick={() => setShowFilter(true)}>
          ⚙ FILTER
        </button>
      </div>

      {/* ── Table ── */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: TBL_COLS,
          padding: '4px 8px', borderBottom: '1px solid rgba(0,220,180,0.15)', gap: 4, ...th }}>
          <span>TOKEN</span><span>SCORE</span><span>PRICE</span>
          <span>1H%</span><span>24H%</span><span>LIQ</span><span>B/S</span><span>AGE</span><span>ACTION</span>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {sorted.map((t, i) => {
            const h1   = parseFloat(t.priceChange?.h1  || 0)
            const h24  = parseFloat(t.priceChange?.h24 || 0)
            const liq  = t.liquidity?.usd  || 0
            const buys = t.txns?.h1?.buys  || 0
            const sels = t.txns?.h1?.sells || 0
            const isSelected = selected?.pairAddress === t.pairAddress
            return (
              <div key={t.pairAddress + i}
                style={{ display: 'grid', gridTemplateColumns: TBL_COLS, gap: 4,
                  padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                  cursor: 'pointer', transition: 'background 0.12s',
                  background: isSelected ? 'rgba(0,220,180,0.06)' :
                    t._score>=70 ? 'rgba(0,255,136,0.02)' :
                    t._score>=45 ? 'rgba(255,215,0,0.02)' : 'transparent',
                }}
                onMouseEnter={e => { if(!isSelected) e.currentTarget.style.background='rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if(!isSelected) e.currentTarget.style.background=
                  t._score>=70?'rgba(0,255,136,0.02)':t._score>=45?'rgba(255,215,0,0.02)':'transparent' }}
                onClick={() => setSelected(isSelected ? null : t)}>
                <span style={{ color:'#e8f4ff', fontWeight:600, fontSize:11,
                  overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                  {t.baseToken?.symbol?.slice(0,9)}
                </span>
                <span style={{ color: scoreColor(t._score), fontWeight:'bold', fontSize:11 }}>
                  {t._score}
                </span>
                <span style={{ color:'#8fb8d0', fontSize:10 }}>
                  {parseFloat(t.priceUsd||0) < 0.001
                    ? `$${parseFloat(t.priceUsd||0).toExponential(2)}`
                    : `$${parseFloat(t.priceUsd||0).toFixed(5)}`}
                </span>
                <span style={{ color: pnlColor(h1), fontSize: 10 }}>
                  {h1>=0?'+':''}{h1.toFixed(1)}%
                </span>
                <span style={{ color: pnlColor(h24), fontSize: 10 }}>
                  {h24>=0?'+':''}{h24.toFixed(1)}%
                </span>
                <span style={{ color:'#8fb8d0', fontSize:10 }}>{fmtLiq(liq)}</span>
                <span style={{ color: buys>sels?'#00ff88':'#ff4466', fontSize:10 }}>
                  {buys}/{sels}
                </span>
                <span style={{ color:'#4a7a8a', fontSize:10 }}>
                  {t._age < 1 ? `${(t._age*60).toFixed(0)}m` : `${t._age.toFixed(0)}h`}
                </span>
                <div style={{ display:'flex', gap:3 }}>
                  <button style={snipeBtn('#00ff88')}
                    onClick={e => { e.stopPropagation(); setSelected(t) }}>
                    ⚡
                  </button>
                  <button style={snipeBtn('#a0c4ff')}
                    onClick={e => { e.stopPropagation(); window.open(t.url,'_blank') }}>
                    📊
                  </button>
                </div>
              </div>
            )
          })}
          {sorted.length === 0 && (
            <div style={{ textAlign:'center', padding:30, color:'#2a4a5a' }}>
              {scanning ? 'SCANNING BLOCKCHAIN…' : 'No tokens matching filter'}
            </div>
          )}
        </div>
      </div>

      {/* ── Token detail + buy panel ── */}
      {selected && (
        <div style={{ ...card, border:'1px solid rgba(0,220,180,0.25)', marginTop:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span style={{ color:'#00dcb4', fontFamily:"'Orbitron',monospace", fontSize:18, fontWeight:800 }}>
                  {selected.baseToken?.symbol}
                </span>
                <span style={{ ...riskTag(selected._risk) }}>{selected._risk}</span>
                <span style={{ color:scoreColor(selected._score), fontWeight:'bold' }}>
                  SCORE {selected._score}
                </span>
              </div>
              <div style={{ color:'#4a7a8a', fontSize:9, marginTop:4, fontFamily:'monospace' }}>
                {selected.baseToken?.address}
              </div>
            </div>
            <button style={closeBtn} onClick={() => setSelected(null)}>✕</button>
          </div>

          {/* Stats grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:12 }}>
            {[
              ['PRICE',    parseFloat(selected.priceUsd||0) < 0.001
                ? `$${parseFloat(selected.priceUsd||0).toExponential(3)}`
                : `$${parseFloat(selected.priceUsd||0).toFixed(6)}`],
              ['LIQUIDITY', fmtLiq(selected.liquidity?.usd||0)],
              ['24H VOL',  fmtLiq(selected.volume?.h24||0)],
              ['MKT CAP',  selected.marketCap ? fmtLiq(selected.marketCap) : 'N/A'],
              ['1H CHANGE',`${parseFloat(selected.priceChange?.h1||0).toFixed(2)}%`],
              ['6H CHANGE',`${parseFloat(selected.priceChange?.h6||0).toFixed(2)}%`],
              ['24H CHANGE',`${parseFloat(selected.priceChange?.h24||0).toFixed(2)}%`],
              ['AGE',      selected._age<1?`${(selected._age*60).toFixed(0)}min`:`${selected._age.toFixed(1)}h`],
            ].map(([k,v]) => (
              <div key={k} style={statItem}>
                <div style={{ color:'#2a5a6a', fontSize:8, letterSpacing:1 }}>{k}</div>
                <div style={{ color:'#c8d8e8', marginTop:2, fontSize:11 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* TP Ladder info */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:12 }}>
            {[['+50%','40%','TP1'],['+100%','30%','TP2'],['+400%','20%','TP3'],['🌙 10x','HOLD','MOON']].map(([g,p,l]) => (
              <div key={l} style={{ background:'#020509', border:'1px solid rgba(255,215,0,0.15)',
                borderRadius:3, padding:'6px 8px', textAlign:'center' }}>
                <div style={{ color:'#ffd700', fontSize:10, fontWeight:'bold' }}>{l} {g}</div>
                <div style={{ color:'#4a7a8a', fontSize:9 }}>Sell {p}</div>
              </div>
            ))}
          </div>

          {/* Buy panel */}
          <div style={{ background:'rgba(0,220,180,0.04)', border:'1px solid rgba(0,220,180,0.15)',
            borderRadius:5, padding:12, marginBottom:10 }}>
            <div style={{ color:'#00dcb4', fontSize:10, letterSpacing:2, marginBottom:10 }}>
              ⚡ EXECUTE TRADE — {connected ? '✅ WALLET CONNECTED' : '⚠ CONNECT WALLET FIRST'}
            </div>

            <div style={{ display:'flex', gap:6, marginBottom:10 }}>
              {[['SOL','◎ SOL'],['USDC','$ USDC']].map(([m,l]) => (
                <button key={m} style={{ ...filterBtn(buyMode===m,'#00dcb4'), flex:1 }}
                  onClick={() => setBuyMode(m)}>{l}</button>
              ))}
            </div>

            <div style={{ display:'flex', gap:6, marginBottom:10, alignItems:'center' }}>
              <input
                type="number"
                value={buyAmt}
                onChange={e => setBuyAmt(e.target.value)}
                placeholder={buyMode==='SOL'?'Amount in SOL':'Amount in USDC'}
                style={inputStyle}
              />
              <div style={{ display:'flex', gap:4 }}>
                {(buyMode==='SOL' ? ['0.05','0.1','0.25','0.5'] : ['1','5','10','25']).map(v => (
                  <button key={v} style={{ ...filterBtn(false,'#4a7a8a'), padding:'4px 8px', fontSize:9 }}
                    onClick={() => setBuyAmt(v)}>{v}</button>
                ))}
              </div>
            </div>

            {txStatus && (
              <div style={{ color:'#ffd700', fontSize:10, marginBottom:8, padding:'6px 8px',
                background:'rgba(255,215,0,0.06)', borderRadius:3 }}>
                ⏳ {txStatus}
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:6 }}>
              <button
                style={{ ...execBtn('#00ff88'), opacity: !connected||loading ? 0.5 : 1 }}
                onClick={handleBuy}
                disabled={!connected || loading || !buyAmt}
              >
                {loading ? '⏳ WAITING FOR WALLET…' : `⚡ BUY ${selected.baseToken.symbol} WITH ${buyMode}`}
              </button>
              <button
                style={execBtn('#a0c4ff')}
                onClick={() => window.open(
                  `https://jup.ag/swap/SOL-${selected.baseToken.address}`, '_blank'
                )}>
                🪐 JUP
              </button>
            </div>

            {!connected && (
              <div style={{ color:'#ff6b35', fontSize:9, marginTop:8, textAlign:'center' }}>
                ⚠ Connect Phantom / Solflare / Backpack to trade directly from this dashboard
              </div>
            )}
          </div>

          {/* Links */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[
              ['Solscan',    `https://solscan.io/token/${selected.baseToken?.address}`],
              ['Dexscreener',selected.url],
              ['Birdeye',    `https://birdeye.so/token/${selected.baseToken?.address}`],
              ['Rugcheck',   `https://rugcheck.xyz/tokens/${selected.baseToken?.address}`],
            ].map(([l,u]) => (
              <button key={l} style={{ ...filterBtn(false,'#4a7a8a'), fontSize:9 }}
                onClick={() => window.open(u,'_blank')}>{l} ↗</button>
            ))}
          </div>
        </div>
      )}

      {showFilter && (
        <FilterDialog
          onClose={() => setShowFilter(false)}
          onApply={() => { setShowFilter(false); scan() }}
        />
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TBL_COLS = '90px 55px 90px 60px 60px 75px 60px 50px 65px'

const card = {
  background: '#050d14', border: '1px solid rgba(0,220,180,0.1)',
  borderRadius: 6, padding: 12, marginBottom: 10,
}
const th    = { color:'#2a5a6a', fontSize:9, letterSpacing:1 }
const label = { color:'#2a5a6a', fontSize:9, letterSpacing:1 }

const filterBtn = (active, c) => ({
  background:   active ? `${c}18` : 'transparent',
  border:       `1px solid ${active ? c : '#0a1a24'}`,
  color:        active ? c : '#4a7a8a',
  padding:      '3px 9px', borderRadius:3, cursor:'pointer',
  fontSize:     10, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:0.5,
})
const snipeBtn = (c) => ({
  background:'transparent', border:`1px solid ${c}33`, color:c,
  padding:'2px 6px', borderRadius:3, cursor:'pointer', fontSize:10,
  fontFamily:"'IBM Plex Mono',monospace",
})
const riskTag = (r) => ({
  background: r==='SAFE'?'rgba(0,255,136,0.12)':r==='MODERATE'?'rgba(255,215,0,0.12)':'rgba(255,107,53,0.12)',
  border: `1px solid ${r==='SAFE'?'#00ff8866':r==='MODERATE'?'#ffd70066':'#ff6b3566'}`,
  color:  r==='SAFE'?'#00ff88':r==='MODERATE'?'#ffd700':'#ff6b35',
  padding:'1px 7px', borderRadius:3, fontSize:9, letterSpacing:1, fontWeight:'bold',
})
const statItem = {
  background:'#020509', padding:'8px 10px', borderRadius:4,
  border:'1px solid rgba(255,255,255,0.04)',
}
const inputStyle = {
  flex:1, background:'#020509', border:'1px solid rgba(0,220,180,0.2)',
  color:'#c8d8e8', padding:'7px 10px', borderRadius:4, fontSize:11,
  fontFamily:"'IBM Plex Mono',monospace", outline:'none',
}
const execBtn = (c) => ({
  background:`${c}18`, border:`1px solid ${c}66`, color:c,
  padding:'9px 14px', borderRadius:4, cursor:'pointer', fontSize:11,
  fontFamily:"'IBM Plex Mono',monospace", letterSpacing:1, fontWeight:'bold',
})
const closeBtn = {
  background:'transparent', border:'1px solid rgba(255,68,102,0.3)', color:'#ff4466',
  padding:'4px 10px', borderRadius:3, cursor:'pointer', fontSize:11,
  fontFamily:"'IBM Plex Mono',monospace",
}
import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletTrading } from '../hooks/useWalletTrading.js'

const pnlColor = v => parseFloat(v) >= 0 ? '#00ff88' : '#ff4466'
const fmtUsd   = v => `$${parseFloat(v||0).toFixed(2)}`
const fmtPrice = v => parseFloat(v||0) < 0.001
  ? `$${parseFloat(v||0).toExponential(3)}`
  : `$${parseFloat(v||0).toFixed(6)}`

export function Portfolio({
  onAlert,
  portfolio      = null,
  externalPositions = [],
  externalTrades    = [],
  walletCapital  = null,   // { sol, usdc } from App.jsx when wallet connected
  isPaperMode    = true,
}) {
  const { connected }                           = useWallet()
  const { sellToken, getTokenBalance, loading } = useWalletTrading()
  const [positions,   setPositions]   = useState([])
  const [trades,      setTrades]      = useState([])
  const [sellStatus,  setSellStatus]  = useState({})

  useEffect(() => {
    if (externalPositions.length) setPositions(externalPositions)
    if (externalTrades.length)    setTrades(externalTrades)
  }, [externalPositions, externalTrades])

  const handleSell = async (pos, pct = 1.0) => {
    if (!connected) { onAlert('WARNING', 'Connect wallet to sell'); return }
    setSellStatus(s => ({ ...s, [pos.id]: `Selling ${(pct*100).toFixed(0)}%…` }))
    try {
      const balance = await getTokenBalance(pos.mint_address)
      const amount  = balance * pct
      if (amount <= 0) { throw new Error('No token balance found in wallet') }

      const result = await sellToken({
        tokenMint:     pos.mint_address,
        tokenDecimals: pos.decimals || 6,
        tokenAmount:   amount,
        slippageBps:   300,
        onStatus: (s) => setSellStatus(prev => ({ ...prev, [pos.id]: s })),
      })

      const pnl = result.usdcReceived - pos.invested_usd * pct
      onAlert('PROFIT',
        `💰 Sold ${(pct*100).toFixed(0)}% of ${pos.symbol} → $${result.usdcReceived.toFixed(2)} USDC`)

      // Update position
      setPositions(prev => {
        if (pct >= 1.0) return prev.filter(p => p.id !== pos.id)
        return prev.map(p => p.id === pos.id
          ? { ...p, quantity: p.quantity * (1-pct), invested_usd: p.invested_usd * (1-pct) }
          : p
        )
      })
      setTrades(prev => [{
        id:          Date.now(),
        symbol:      pos.symbol,
        trade_type:  'Sell',
        usd_value:   result.usdcReceived,
        pnl,
        tx_signature: result.signature,
        executed_at:  new Date().toISOString(),
      }, ...prev].slice(0, 100))
    } catch (e) {
      onAlert('CRITICAL', `❌ Sell failed: ${e.message}`)
    }
    setSellStatus(s => { const n={...s}; delete n[pos.id]; return n })
  }

  const realized = trades.filter(t=>t.trade_type==='Sell').reduce((s,t)=>s+(t.pnl||0),0)
  const winCount = trades.filter(t=>t.trade_type==='Sell' && (t.pnl||0)>0).length
  const losCount = trades.filter(t=>t.trade_type==='Sell' && (t.pnl||0)<0).length


  return (
    <div>
      {/* ── PORTFOLIO SUMMARY ── */}
      <div style={{ ...card, border:'1px solid rgba(0,220,180,0.3)', marginBottom:12, background:'rgba(0,220,180,0.02)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <span style={{ color:'#00dcb4', letterSpacing:2, fontSize:11, fontWeight:700 }}>📊 PORTFOLIO SUMMARY</span>
          {isPaperMode && (
            <span style={{ color:'#ffd700', fontSize:9, letterSpacing:1, background:'rgba(255,215,0,0.08)',
              border:'1px solid rgba(255,215,0,0.3)', borderRadius:3, padding:'2px 8px' }}>
              📄 PAPER
            </span>
          )}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
          {/* When wallet connected: show actual wallet capital */}
          {walletCapital ? (
            <div style={{ ...statItem, border:'1px solid rgba(0,220,180,0.2)' }}>
              <div style={{ color:'#2a5a6a', fontSize:9, letterSpacing:0.5 }}>WALLET CAPITAL</div>
              <div style={{ color:'#00dcb4', fontSize:12, fontWeight:700 }}>
                {walletCapital.sol !== null ? `${walletCapital.sol.toFixed(4)} ◎` : '…'}
              </div>
              <div style={{ color:'#1a3a4a', fontSize:8, marginTop:2 }}>
                {walletCapital.usdc !== null ? `+ $${walletCapital.usdc.toFixed(2)} USDC` : 'live balance'}
              </div>
            </div>
          ) : (
            <div style={statItem}>
              <div style={{ color:'#2a5a6a', fontSize:9, letterSpacing:0.5 }}>PAPER CAPITAL</div>
              <div style={{ color:'#c8d8e8', fontSize:12, fontWeight:700 }}>
                {fmtUsd(portfolio?.total_capital_usd ?? 100.0)}
              </div>
              <div style={{ color:'#1a3a4a', fontSize:8, marginTop:2 }}>Virtual</div>
            </div>
          )}
          <div style={statItem}>
            <div style={{ color:'#2a5a6a', fontSize:9, letterSpacing:0.5 }}>AVAILABLE CASH</div>
            <div style={{ color:'#00dcb4', fontSize:12, fontWeight:700 }}>
              {portfolio?.available_cash_usd !== undefined ? fmtUsd(portfolio.available_cash_usd) : '…'}
            </div>
            <div style={{ color:'#1a3a4a', fontSize:8, marginTop:2 }}>Not deployed</div>
          </div>
          <div style={statItem}>
            <div style={{ color:'#2a5a6a', fontSize:9, letterSpacing:0.5 }}>INVESTED</div>
            <div style={{ color:'#ffd700', fontSize:12, fontWeight:700 }}>
              {portfolio?.invested_usd !== undefined ? fmtUsd(portfolio.invested_usd) : fmtUsd(positions.reduce((s,p)=>s+p.invested_usd,0))}
            </div>
            <div style={{ color:'#1a3a4a', fontSize:8, marginTop:2 }}>Open positions</div>
          </div>
          <div style={statItem}>
            <div style={{ color:'#2a5a6a', fontSize:9, letterSpacing:0.5 }}>REALIZED PnL</div>
            <div style={{ color: (portfolio?.realized_pnl ?? realized)>=0?'#00ff88':'#ff4466', fontSize:12, fontWeight:700 }}>
              {`${(portfolio?.realized_pnl ?? realized)>=0?'+':''}${fmtUsd(portfolio?.realized_pnl ?? realized)}`}
            </div>
            <div style={{ color:'#1a3a4a', fontSize:8, marginTop:2 }}>Closed trades</div>
          </div>
        </div>
      </div>

      {/* ── Wallet summary ── */}
      {connected && (
        <div style={{ ...card, border:'1px solid rgba(0,220,180,0.2)', marginBottom:10 }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <StatMini label="WALLET SOL"  value={walletCapital?.sol  != null ? `${walletCapital.sol.toFixed(4)} ◎`  : '…'} color="#00dcb4" />
            <StatMini label="WALLET USDC" value={walletCapital?.usdc != null ? `$${walletCapital.usdc.toFixed(2)}` : '…'} color="#a0c4ff" />
            <StatMini label="REALIZED PnL" value={`${realized>=0?'+':''}${fmtUsd(realized)}`} color={pnlColor(realized)} />
            <StatMini label="WIN/LOSS" value={`${winCount}W / ${losCount}L`} color="#ffd700" />
            <StatMini label="WIN RATE" value={winCount+losCount>0?`${(winCount/(winCount+losCount)*100).toFixed(0)}%`:'—'} color="#a0c4ff" />
            <StatMini label="OPEN POS" value={positions.length} color="#ff6b35" />
          </div>
        </div>
      )}

      {/* ── Open positions ── */}
      <div style={card}>
        <div style={{ color:'#00dcb4', letterSpacing:2, marginBottom:12, fontSize:11 }}>OPEN POSITIONS</div>

        {positions.length === 0 && (
          <div style={{ color:'#2a4a5a', textAlign:'center', padding:24, fontSize:11 }}>
            {connected
              ? 'No tracked positions. Snipe a token to start.'
              : '⚡ Connect wallet to track positions'}
          </div>
        )}

        {positions.map(pos => {
          const status = sellStatus[pos.id]
          const tps    = pos.take_profit_levels || []
          return (
            <div key={pos.id} style={{ ...card, border:'1px solid #0a1a24', marginBottom:8 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:6 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ color:'#00dcb4', fontFamily:"'Orbitron',monospace", fontSize:14, fontWeight:700 }}>
                    {pos.symbol}
                  </span>
                  <span style={riskBadge(pos.risk_level||'MODERATE')}>
                    {pos.risk_level||'MODERATE'}
                  </span>
                  <span style={{ color:'#4a7a8a', fontSize:9 }}>
                    {new Date(pos.opened_at).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                  {[0.25,0.5,1.0].map(pct => (
                    <button key={pct}
                      style={{ ...actionBtn(pct===1.0?'#ff4466':pct===0.5?'#ffd700':'#a0c4ff'),
                        opacity: status||loading ? 0.5 : 1 }}
                      onClick={() => handleSell(pos, pct)}
                      disabled={!!status || loading}>
                      {pct===1.0 ? '✕ CLOSE' : `${pct*100}% SELL`}
                    </button>
                  ))}
                </div>
              </div>

              {status && (
                <div style={{ color:'#ffd700', fontSize:10, padding:'5px 8px',
                  background:'rgba(255,215,0,0.06)', borderRadius:3, marginBottom:8 }}>
                  ⏳ {status}
                </div>
              )}

              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:6, marginBottom:8 }}>
                {[
                  ['ENTRY',     fmtPrice(pos.entry_price)],
                  ['SIZE',      fmtUsd(pos.invested_usd)],
                  ['STOP LOSS', fmtPrice(pos.stop_loss_price)],
                  ['QTY',       parseFloat(pos.quantity||0).toFixed(2)],
                  ['SCORE',     pos.score_at_entry||'—'],
                ].map(([k,v]) => (
                  <div key={k} style={statItem}>
                    <div style={{ color:'#2a5a6a', fontSize:8 }}>{k}</div>
                    <div style={{ color:'#c8d8e8', fontSize:10 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* TP ladder */}
              {tps.length > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:`repeat(${tps.length},1fr)`, gap:4 }}>
                  {tps.map((tp,i) => (
                    <div key={i} style={{ background: tp.hit?'rgba(0,255,136,0.08)':'#020509',
                      border:`1px solid ${tp.hit?'#00ff88':'rgba(255,255,255,0.05)'}`,
                      borderRadius:3, padding:'4px 6px', textAlign:'center', fontSize:9 }}>
                      <div style={{ color:tp.hit?'#00ff88':'#4a7a8a' }}>
                        TP{tp.level} {tp.hit?'✓':`+${((tp.target_multiplier-1)*100).toFixed(0)}%`}
                      </div>
                      <div style={{ color:'#2a4a5a' }}>sell {(tp.sell_pct*100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tx link */}
              {pos.tx_signature && (
                <div style={{ marginTop:6 }}>
                  <a href={`https://solscan.io/tx/${pos.tx_signature}`} target="_blank"
                    rel="noreferrer"
                    style={{ color:'#2a5a6a', fontSize:9, textDecoration:'none' }}>
                    📋 {pos.tx_signature.slice(0,20)}… → Solscan ↗
                  </a>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Trade history ── */}
      <div style={card}>
        <div style={{ color:'#a0c4ff', letterSpacing:2, marginBottom:8, fontSize:11 }}>TRADE HISTORY</div>
        <div style={{ display:'grid', gridTemplateColumns:'50px 80px 80px 80px 90px auto',
          padding:'3px 0', color:'#2a5a6a', fontSize:9, letterSpacing:1, borderBottom:'1px solid #0a1a24',
          marginBottom:4 }}>
          <span>TYPE</span><span>TOKEN</span><span>SIZE</span><span>PnL</span><span>TX</span><span>TIME</span>
        </div>
        {trades.slice(0,20).map((t,i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'50px 80px 80px 80px 90px auto',
            padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.02)', fontSize:10 }}>
            <span style={{ color:t.trade_type==='Buy'?'#00ff88':'#ff4466', fontWeight:'bold' }}>
              {t.trade_type?.toUpperCase()}
            </span>
            <span style={{ color:'#c8d8e8' }}>{t.symbol}</span>
            <span style={{ color:'#8fb8d0' }}>{fmtUsd(t.usd_value)}</span>
            <span style={{ color:t.pnl!=null?pnlColor(t.pnl):'#4a7a8a' }}>
              {t.pnl != null ? `${t.pnl>=0?'+':''}${fmtUsd(t.pnl)}` : '—'}
            </span>
            <span>
              {t.tx_signature ? (
                <a href={`https://solscan.io/tx/${t.tx_signature}`} target="_blank" rel="noreferrer"
                  style={{ color:'#2a5a6a', textDecoration:'none', fontSize:9 }}>
                  {t.tx_signature.slice(0,8)}… ↗
                </a>
              ) : '—'}
            </span>
            <span style={{ color:'#2a4a5a', fontSize:9 }}>
              {t.executed_at ? new Date(t.executed_at).toLocaleTimeString() : ''}
            </span>
          </div>
        ))}
        {trades.length === 0 && (
          <div style={{ color:'#2a4a5a', textAlign:'center', padding:16 }}>No trades yet</div>
        )}
      </div>
    </div>
  )
}

function StatMini({ label, value, color }) {
  return (
    <div style={{ background:'#020509', border:'1px solid rgba(255,255,255,0.04)',
      borderRadius:4, padding:'8px 12px', flex:1, minWidth:110 }}>
      <div style={{ color:'#2a5a6a', fontSize:8, letterSpacing:1 }}>{label}</div>
      <div style={{ color, fontSize:14, fontWeight:'bold', marginTop:2 }}>{value}</div>
    </div>
  )
}

const card = {
  background:'#050d14', border:'1px solid rgba(0,220,180,0.08)',
  borderRadius:6, padding:12, marginBottom:10,
}
const statItem = {
  background:'#020509', padding:'7px 8px', borderRadius:4,
  border:'1px solid rgba(255,255,255,0.03)',
}
const riskBadge = (r) => ({
  background: r==='SAFE'?'rgba(0,255,136,0.1)':r==='MODERATE'?'rgba(255,215,0,0.1)':'rgba(255,107,53,0.1)',
  border: `1px solid ${r==='SAFE'?'#00ff8855':r==='MODERATE'?'#ffd70055':'#ff6b3555'}`,
  color:  r==='SAFE'?'#00ff88':r==='MODERATE'?'#ffd700':'#ff6b35',
  padding:'1px 6px', borderRadius:3, fontSize:9, letterSpacing:1,
})
const actionBtn = (c) => ({
  background:`${c}12`, border:`1px solid ${c}55`, color:c,
  padding:'4px 10px', borderRadius:3, cursor:'pointer', fontSize:9,
  fontFamily:"'IBM Plex Mono',monospace", letterSpacing:0.5,
})

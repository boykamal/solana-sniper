import { useState, useEffect, useCallback } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const HELIUS_KEY  = import.meta.env.VITE_HELIUS_KEY || ''
const SOL_MINT    = 'So11111111111111111111111111111111111111112'
const USDC_MINT   = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT_MINT   = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const STABLE_SET  = new Set([SOL_MINT, USDC_MINT, USDT_MINT])
const TOKEN_PROG  = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

const WHALE_COLORS = ['#00dcb4','#ffd700','#ff6b35','#a0c4ff','#c084fc','#00ff88','#ff4466']

const DEFAULT_WHALES = [
  { address: 'GUfCR9mK6azb9vcpsxgXyj7XRPAaF6GFSzBCXBVRL7k', label: 'SOL Whale #1', color: '#00dcb4' },
  { address: '8xot8L9o7qnYfSzLEeR9LFYBpWCFJtXYK2xhMQCJwJvf', label: 'DeFi Whale',   color: '#ffd700' },
  { address: 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq', label: 'Raydium MM',   color: '#ff6b35' },
]

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '?'
  const s = Math.floor(Date.now() / 1000) - ts
  if (s <    60) return `${s}s`
  if (s <  3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function fmtNum(n) {
  if (!n) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(2)
}

function fmtUsd(n) {
  if (!n) return '$0'
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}

// ─── HELIUS API HELPERS ───────────────────────────────────────────────────────

async function heliusFetchSwaps(address, limit = 25) {
  const r = await fetch(
    `https://api.helius.xyz/v0/addresses/${address}/transactions` +
    `?api-key=${HELIUS_KEY}&type=SWAP&limit=${limit}`
  )
  if (!r.ok) throw new Error(`Helius ${r.status}`)
  return r.json()
}

async function heliusFetchHoldings(address) {
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method:  'getAssetsByOwner',
      params: {
        ownerAddress: address,
        page: 1, limit: 50,
        displayOptions: { showFungible: true, showNativeBalance: true },
      },
    }),
  })
  const d = await r.json()
  return d.result
}

// Parse a Helius enhanced transaction into a normalised swap event
function parseHeliusTx(tx, address) {
  const received = tx.tokenTransfers?.find(
    t => t.toUserAccount === address && !STABLE_SET.has(t.mint)
  )
  const sent = tx.tokenTransfers?.find(
    t => t.fromUserAccount === address && !STABLE_SET.has(t.mint)
  )
  const base = received || sent
  if (!base) return null

  // Try to pull symbol from description: "swapped X SOL for Y SYMBOL"
  const symMatch = tx.description?.match(/for [\d,.]+ ([A-Z\w]{2,12})/)
  const symbol   = symMatch?.[1] || base.mint.slice(0, 6)

  // SOL spent/received (from nativeTransfers involving the wallet)
  const solMoved = (tx.nativeTransfers || [])
    .filter(t => t.fromUserAccount === address || t.toUserAccount === address)
    .reduce((s, t) => s + t.amount, 0) / 1e9

  return {
    action:      received ? 'BUY' : 'SELL',
    mint:        base.mint,
    symbol,
    amount:      base.tokenAmount || 0,
    solAmount:   solMoved,
    blockTime:   tx.timestamp,
    signature:   tx.signature,
    description: tx.description || '',
  }
}

// ─── PUBLIC RPC FALLBACK HELPERS ──────────────────────────────────────────────

async function rpcFetchSwaps(connection, address) {
  const pubkey = new PublicKey(address)
  const sigs   = await connection.getSignaturesForAddress(pubkey, { limit: 6 })
  const swaps  = []
  for (const s of sigs) {
    if (s.err) continue
    try {
      const tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
      if (!tx?.meta) continue
      const pre  = tx.meta.preTokenBalances  || []
      const post = tx.meta.postTokenBalances || []
      for (const pb of post) {
        if (pb.owner !== address) continue
        if (STABLE_SET.has(pb.mint)) continue
        const pa      = pre.find(p => p.accountIndex === pb.accountIndex)
        const preAmt  = pa?.uiTokenAmount?.uiAmount  || 0
        const postAmt = pb.uiTokenAmount?.uiAmount   || 0
        const diff    = postAmt - preAmt
        if (Math.abs(diff) < 1) continue
        swaps.push({
          action:    diff > 0 ? 'BUY' : 'SELL',
          mint:      pb.mint,
          symbol:    pb.mint.slice(0, 6) + '…',
          amount:    Math.abs(diff),
          solAmount: 0,
          blockTime: s.blockTime,
          signature: s.signature,
          description: '',
        })
      }
    } catch {}
  }
  return swaps
}

async function rpcFetchHoldings(connection, address) {
  const pubkey = new PublicKey(address)
  const { value } = await connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROG,
  })
  const solBal = await connection.getBalance(pubkey)
  const items = value
    .map(a => {
      const info = a.account.data.parsed.info
      return {
        mint:     info.mint,
        symbol:   info.mint.slice(0, 6) + '…',
        name:     '',
        amount:   info.tokenAmount.uiAmount || 0,
        usd:      0,
        imageUrl: '',
      }
    })
    .filter(t => t.amount > 0 && !STABLE_SET.has(t.mint))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 25)

  // Prepend SOL balance as first item
  items.unshift({
    mint:     SOL_MINT,
    symbol:   'SOL',
    name:     'Solana',
    amount:   solBal / 1e9,
    usd:      0,
    imageUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  })
  return items
}

// ─── SIGNAL GENERATOR ────────────────────────────────────────────────────────

function generateSignals(feed) {
  const now    = Date.now() / 1000
  const recent = feed.filter(f => f.blockTime && now - f.blockTime < 7200) // 2h window
  const byMint = {}
  for (const f of recent) {
    if (!f.mint) continue
    if (!byMint[f.mint]) byMint[f.mint] = { buys: [], sells: [], symbol: f.symbol }
    if (f.action === 'BUY')  byMint[f.mint].buys.push(f)
    if (f.action === 'SELL') byMint[f.mint].sells.push(f)
  }
  const sigs = []
  for (const [mint, d] of Object.entries(byMint)) {
    const buyWhales  = [...new Set(d.buys.map(b => b.whale))]
    const sellWhales = [...new Set(d.sells.map(s => s.whale))]
    if (buyWhales.length >= 3) {
      sigs.push({ strength: 'STRONG', type: 'ACC', mint, symbol: d.symbol,
        count: buyWhales.length, action: 'STRONG BUY',
        msg: `${buyWhales.length} whales accumulated ${d.symbol} in 2h`,
        time: Math.max(...d.buys.map(b => b.blockTime || 0)) })
    } else if (buyWhales.length === 2) {
      sigs.push({ strength: 'MODERATE', type: 'ACC', mint, symbol: d.symbol,
        count: 2, action: 'WATCH',
        msg: `2 whales both bought ${d.symbol}`,
        time: Math.max(...d.buys.map(b => b.blockTime || 0)) })
    }
    if (sellWhales.length >= 2) {
      sigs.push({ strength: 'WARNING', type: 'EXIT', mint, symbol: d.symbol,
        count: sellWhales.length, action: 'EXIT SIGNAL',
        msg: `${sellWhales.length} whales selling ${d.symbol}`,
        time: Math.max(...d.sells.map(s => s.blockTime || 0)) })
    } else if (sellWhales.length === 1 && d.sells.length >= 2) {
      sigs.push({ strength: 'CAUTION', type: 'EXIT', mint, symbol: d.symbol,
        count: 1, action: 'TIGHTEN SL',
        msg: `Whale has ${d.sells.length} sell events on ${d.symbol}`,
        time: Math.max(...d.sells.map(s => s.blockTime || 0)) })
    }
  }
  return sigs.sort((a, b) => b.time - a.time)
}

// ─── WHALE TRACKER ────────────────────────────────────────────────────────────

export function WhaleTracker({ onAlert }) {
  const { connection } = useConnection()

  const [wallets, setWallets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('whale_wallets') || 'null') || DEFAULT_WHALES }
    catch { return DEFAULT_WHALES }
  })
  const [tab,           setTab]           = useState('FEED')
  const [selectedWhale, setSelectedWhale] = useState(null)
  const [feed,          setFeed]          = useState([])
  const [holdings,      setHoldings]      = useState({})
  const [signals,       setSignals]       = useState([])
  const [loadingFeed,   setLoadingFeed]   = useState(false)
  const [loadingHold,   setLoadingHold]   = useState(false)
  const [lastUpdate,    setLastUpdate]    = useState(null)
  const [newAddr,       setNewAddr]       = useState('')
  const [newLabel,      setNewLabel]      = useState('')
  const [showAdd,       setShowAdd]       = useState(false)

  useEffect(() => {
    localStorage.setItem('whale_wallets', JSON.stringify(wallets))
  }, [wallets])

  // ── Refresh live feed ───────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (wallets.length === 0) return
    setLoadingFeed(true)
    const allSwaps = []
    for (const whale of wallets) {
      try {
        let swaps = []
        if (HELIUS_KEY) {
          const raw = await heliusFetchSwaps(whale.address)
          swaps = raw.map(tx => {
            const p = parseHeliusTx(tx, whale.address)
            if (!p) return null
            return { ...p, whale: whale.address, whaleLabel: whale.label, whaleColor: whale.color }
          }).filter(Boolean)
        } else {
          const raw = await rpcFetchSwaps(connection, whale.address)
          swaps = raw.map(s => ({ ...s, whale: whale.address, whaleLabel: whale.label, whaleColor: whale.color }))
        }
        allSwaps.push(...swaps)
      } catch (e) {
        console.warn('whale feed failed', whale.label, e.message)
      }
    }
    allSwaps.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
    setFeed(allSwaps.slice(0, 80))
    setSignals(generateSignals(allSwaps))
    setLastUpdate(new Date())
    setLoadingFeed(false)
  }, [wallets, connection])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const iv = setInterval(refresh, 60_000)
    return () => clearInterval(iv)
  }, [refresh])

  // ── Fetch holdings for a whale ──────────────────────────────────────────────
  const fetchHoldings = useCallback(async (address) => {
    setLoadingHold(true)
    try {
      let result = []
      if (HELIUS_KEY) {
        const data = await heliusFetchHoldings(address)
        // Native SOL balance
        const solItem = data?.nativeBalance
          ? [{
              mint: SOL_MINT, symbol: 'SOL', name: 'Solana',
              amount: data.nativeBalance.lamports / 1e9,
              usd:    data.nativeBalance.total_price || 0,
              imageUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
            }]
          : []
        // Fungible tokens
        const tokens = (data?.items || [])
          .filter(a => a.interface === 'FungibleToken' && a.token_info?.balance > 0)
          .map(a => ({
            mint:     a.id,
            symbol:   a.content?.metadata?.symbol || a.id.slice(0, 6),
            name:     a.content?.metadata?.name   || '',
            amount:   (a.token_info?.balance || 0) / Math.pow(10, a.token_info?.decimals || 6),
            usd:      a.token_info?.price_info?.total_price || 0,
            imageUrl: a.content?.links?.image || a.content?.files?.[0]?.uri || '',
          }))
          .filter(t => t.amount > 0 && !STABLE_SET.has(t.mint))
          .sort((a, b) => b.usd - a.usd)
          .slice(0, 30)
        result = [...solItem, ...tokens]
      } else {
        result = await rpcFetchHoldings(connection, address)
      }
      setHoldings(h => ({ ...h, [address]: result }))
    } catch (e) {
      console.warn('holdings failed', address, e.message)
      onAlert?.('WARNING', `Holdings fetch failed: ${e.message}`)
    }
    setLoadingHold(false)
  }, [connection, onAlert])

  const selectWhale = (addr) => {
    const next = addr === selectedWhale ? null : addr
    setSelectedWhale(next)
    if (next) {
      setTab('HOLDINGS')
      if (!holdings[next]) fetchHoldings(next)
    }
  }

  const addWallet = () => {
    const addr = newAddr.trim()
    if (!addr || addr.length < 32 || addr.length > 44) {
      onAlert?.('WARNING', 'Enter a valid Solana address (32–44 chars)')
      return
    }
    if (wallets.find(w => w.address === addr)) {
      onAlert?.('WARNING', 'Already watching this wallet')
      return
    }
    const color = WHALE_COLORS[wallets.length % WHALE_COLORS.length]
    const label = newLabel.trim() || `Whale #${wallets.length + 1}`
    setWallets(w => [...w, { address: addr, label, color }])
    setNewAddr('')
    setNewLabel('')
    setShowAdd(false)
    onAlert?.('INFO', `✅ Tracking: ${label}`)
  }

  const removeWallet = (addr) => {
    setWallets(w => w.filter(x => x.address !== addr))
    if (selectedWhale === addr) setSelectedWhale(null)
  }

  const whaleOf       = addr => wallets.find(w => w.address === addr)
  const holdingsData  = selectedWhale ? (holdings[selectedWhale] || []) : []
  const totalHoldUsd  = holdingsData.reduce((s, h) => s + (h.usd || 0), 0)
  const sigCount      = signals.length

  return (
    <div>
      {/* ── Header bar ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'#00dcb4', letterSpacing:2, fontSize:11 }}>🐋 WHALE TRACKER</span>
          <span style={pill(HELIUS_KEY ? '#00ff88' : '#ff6b35')}>
            {HELIUS_KEY ? 'HELIUS ✓' : 'PUBLIC RPC'}
          </span>
          {lastUpdate && (
            <span style={{ color:'#2a4a5a', fontSize:9 }}>
              {timeAgo(Math.floor(lastUpdate.getTime() / 1000))} ago
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:5 }}>
          <button style={smBtn('#00dcb4')} onClick={refresh} disabled={loadingFeed}>
            {loadingFeed ? '…' : '↺ REFRESH'}
          </button>
          <button style={smBtn('#c084fc')} onClick={() => setShowAdd(v => !v)}>
            + ADD WHALE
          </button>
        </div>
      </div>

      {/* ── Add wallet form ── */}
      {showAdd && (
        <div style={{ ...card, border:'1px solid rgba(192,132,252,0.3)', marginBottom:10 }}>
          <div style={{ color:'#c084fc', fontSize:10, letterSpacing:1.5, marginBottom:8 }}>
            ADD WHALE WALLET TO TRACK
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:6 }}>
            <input
              value={newAddr} onChange={e => setNewAddr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addWallet()}
              placeholder="Solana wallet address"
              style={{ ...inputStyle, flex:3, minWidth:200 }} />
            <input
              value={newLabel} onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addWallet()}
              placeholder="Label (e.g. Alpha Whale)"
              style={{ ...inputStyle, flex:1, minWidth:120 }} />
            <button style={smBtn('#c084fc')} onClick={addWallet}>ADD</button>
            <button style={smBtn('#ff4466')} onClick={() => setShowAdd(false)}>✕</button>
          </div>
          <div style={{ color:'#2a4a5a', fontSize:9, lineHeight:1.7 }}>
            Find whale addresses on:{' '}
            <a href="https://birdeye.so/leaderboard" target="_blank" rel="noreferrer" style={{ color:'#00dcb4' }}>Birdeye Leaderboard</a>
            {' · '}
            <a href="https://solscan.io/leaderboard" target="_blank" rel="noreferrer" style={{ color:'#00dcb4' }}>Solscan Rich List</a>
            {' · '}
            <a href="https://dexscreener.com" target="_blank" rel="noreferrer" style={{ color:'#00dcb4' }}>DexScreener large txns</a>
          </div>
        </div>
      )}

      {/* ── Whale chips ── */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:10 }}>
        {wallets.map(w => {
          const active = selectedWhale === w.address
          return (
            <div key={w.address}
              style={{ display:'flex', alignItems:'center', gap:5,
                background: active ? `${w.color}22` : 'rgba(0,0,0,0.35)',
                border: `1px solid ${active ? w.color : w.color + '44'}`,
                borderRadius: 20, padding:'4px 10px', cursor:'pointer',
                transition:'all 0.15s' }}
              onClick={() => selectWhale(w.address)}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:w.color,
                boxShadow:`0 0 6px ${w.color}`, display:'inline-block', flexShrink:0 }} />
              <span style={{ color: active ? w.color : '#8fb8d0', fontSize:10,
                fontWeight: active ? 'bold' : 'normal' }}>
                {w.label}
              </span>
              <span style={{ color:'#2a4a5a', fontSize:8, fontFamily:'monospace' }}>
                {w.address.slice(0,4)}…
              </span>
              <button
                style={{ background:'none', border:'none', color:'#2a4a5a', cursor:'pointer',
                  fontSize:11, padding:'0 1px', lineHeight:1 }}
                onClick={e => { e.stopPropagation(); removeWallet(w.address) }}>
                ×
              </button>
            </div>
          )
        })}
        {wallets.length === 0 && (
          <span style={{ color:'#2a4a5a', fontSize:10 }}>No whales tracked — click + ADD WHALE</span>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:'flex', gap:4, marginBottom:10, alignItems:'center' }}>
        {[
          ['FEED',     '📡 LIVE FEED'],
          ['HOLDINGS', '💼 HOLDINGS'],
          ['SIGNALS',  `⚡ SIGNALS${sigCount > 0 ? ` (${sigCount})` : ''}`],
        ].map(([k, l]) => (
          <button key={k} style={tabBtn(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
        {selectedWhale && (
          <span style={{ marginLeft:'auto', color: whaleOf(selectedWhale)?.color || '#00dcb4',
            fontSize:9, display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%',
              background: whaleOf(selectedWhale)?.color, display:'inline-block' }} />
            {whaleOf(selectedWhale)?.label}
          </span>
        )}
      </div>

      {/* ══════════ LIVE FEED ══════════ */}
      {tab === 'FEED' && (
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ color:'#4a7a8a', fontSize:9, letterSpacing:1 }}>
              RECENT WHALE SWAPS — all watched wallets · refreshes every 60s
            </span>
            {!HELIUS_KEY && (
              <span style={{ color:'#ff6b35', fontSize:9 }}>
                ⚡ Set VITE_HELIUS_KEY for full names + USD values
              </span>
            )}
          </div>

          {/* Feed header */}
          <div style={{ display:'grid', gridTemplateColumns: FEED_COLS, gap:4,
            padding:'3px 6px', borderBottom:'1px solid rgba(0,220,180,0.12)', ...th }}>
            <span>TIME</span>
            <span>WHALE</span>
            <span>ACTION</span>
            <span>TOKEN</span>
            <span>{HELIUS_KEY ? 'SOL SPENT' : 'AMOUNT'}</span>
            <span>TX</span>
          </div>

          <div style={{ maxHeight:420, overflowY:'auto' }}>
            {feed.map((f, i) => (
              <div key={f.signature + i}
                style={{ display:'grid', gridTemplateColumns: FEED_COLS, gap:4,
                  padding:'5px 6px', borderBottom:'1px solid rgba(255,255,255,0.02)',
                  alignItems:'center',
                  background: f.action === 'BUY' ? 'rgba(0,255,136,0.015)' : 'rgba(255,68,102,0.015)' }}>
                <span style={{ color:'#2a5a6a', fontSize:9 }}>{timeAgo(f.blockTime)}</span>
                <span style={{ color: f.whaleColor || '#00dcb4', fontSize:9,
                  overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                  {f.whaleLabel}
                </span>
                <span style={{
                  background: f.action === 'BUY' ? 'rgba(0,255,136,0.15)' : 'rgba(255,68,102,0.15)',
                  border: `1px solid ${f.action === 'BUY' ? '#00ff8866' : '#ff446666'}`,
                  color:   f.action === 'BUY' ? '#00ff88' : '#ff4466',
                  padding:'1px 5px', borderRadius:3, fontSize:8, fontWeight:'bold', textAlign:'center',
                }}>
                  {f.action}
                </span>
                <span style={{ color:'#e8f4ff', fontSize:10, fontWeight:600 }}>{f.symbol}</span>
                <span style={{ color:'#8fb8d0', fontSize:9 }}>
                  {f.solAmount > 0
                    ? `◎ ${f.solAmount.toFixed(2)}`
                    : fmtNum(f.amount)
                  }
                </span>
                <button
                  style={{ background:'none', border:'none', color:'#2a5a6a', cursor:'pointer',
                    fontSize:9, padding:0, textDecoration:'underline' }}
                  onClick={() => window.open(`https://solscan.io/tx/${f.signature}`, '_blank')}>
                  tx↗
                </button>
              </div>
            ))}
            {feed.length === 0 && (
              <div style={{ textAlign:'center', padding:36, color:'#2a4a5a' }}>
                {loadingFeed
                  ? '🔍 Scanning whale wallets…'
                  : 'No recent swap activity — try refreshing or add more whales'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ HOLDINGS ══════════ */}
      {tab === 'HOLDINGS' && (
        <div style={card}>
          {!selectedWhale ? (
            <div style={{ textAlign:'center', padding:36, color:'#2a4a5a' }}>
              👆 Click a whale chip above to view their portfolio
            </div>
          ) : (
            <>
              {/* Holdings header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div>
                  <span style={{ color: whaleOf(selectedWhale)?.color || '#00dcb4',
                    fontWeight:'bold', fontSize:11 }}>
                    {whaleOf(selectedWhale)?.label}
                  </span>
                  <span style={{ color:'#2a4a5a', fontSize:8, marginLeft:8, fontFamily:'monospace' }}>
                    {selectedWhale.slice(0,12)}…{selectedWhale.slice(-8)}
                  </span>
                  {totalHoldUsd > 0 && (
                    <span style={{ color:'#ffd700', fontSize:10, marginLeft:10 }}>
                      Portfolio: {fmtUsd(totalHoldUsd)}
                    </span>
                  )}
                </div>
                <div style={{ display:'flex', gap:5 }}>
                  <button style={smBtn('#00dcb4')} onClick={() => fetchHoldings(selectedWhale)}>↺</button>
                  <button style={smBtn('#a0c4ff')}
                    onClick={() => window.open(`https://solscan.io/account/${selectedWhale}`, '_blank')}>
                    Solscan↗
                  </button>
                  <button style={smBtn('#ffd700')}
                    onClick={() => window.open(`https://birdeye.so/profile/${selectedWhale}`, '_blank')}>
                    Birdeye↗
                  </button>
                  <button style={smBtn('#ff6b35')}
                    onClick={() => window.open(`https://step.finance/en/portfolio/${selectedWhale}`, '_blank')}>
                    Step↗
                  </button>
                </div>
              </div>

              {/* Holdings table header */}
              <div style={{ display:'grid', gridTemplateColumns: holdCols(), gap:4,
                padding:'3px 6px', borderBottom:'1px solid rgba(0,220,180,0.12)', ...th }}>
                <span>TOKEN</span>
                <span>AMOUNT</span>
                {HELIUS_KEY && <><span>USD VALUE</span><span>% OF BAG</span></>}
                <span>CHART</span>
              </div>

              <div style={{ maxHeight:400, overflowY:'auto' }}>
                {loadingHold && (
                  <div style={{ textAlign:'center', padding:24, color:'#2a4a5a' }}>
                    Loading portfolio…
                  </div>
                )}
                {!loadingHold && holdingsData.map((h, i) => (
                  <div key={h.mint + i}
                    style={{ display:'grid', gridTemplateColumns: holdCols(), gap:4,
                      padding:'5px 6px', borderBottom:'1px solid rgba(255,255,255,0.02)',
                      alignItems:'center' }}>
                    {/* Token icon + symbol */}
                    <div style={{ display:'flex', alignItems:'center', gap:4, overflow:'hidden' }}>
                      {h.imageUrl
                        ? <img src={h.imageUrl} alt="" style={{ width:16, height:16, borderRadius:'50%', flexShrink:0 }}
                            onError={e => { e.target.style.display = 'none' }} />
                        : <span style={{ width:16, height:16, borderRadius:'50%', flexShrink:0,
                            background:'rgba(0,220,180,0.15)', display:'inline-block' }} />
                      }
                      <span style={{ color:'#e8f4ff', fontSize:10, fontWeight:600,
                        overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                        {h.symbol}
                      </span>
                    </div>
                    <span style={{ color:'#8fb8d0', fontSize:10 }}>{fmtNum(h.amount)}</span>
                    {HELIUS_KEY && (
                      <>
                        <span style={{ color: h.usd > 10000 ? '#00ff88' : h.usd > 1000 ? '#ffd700' : '#8fb8d0',
                          fontSize:10 }}>
                          {fmtUsd(h.usd)}
                        </span>
                        <span style={{ color:'#4a7a8a', fontSize:9 }}>
                          {totalHoldUsd > 0 ? `${((h.usd / totalHoldUsd) * 100).toFixed(1)}%` : '—'}
                        </span>
                      </>
                    )}
                    <button
                      style={{ background:'none', border:'none', color:'#2a5a6a', cursor:'pointer',
                        fontSize:9, padding:0, textDecoration:'underline' }}
                      onClick={() => window.open(`https://dexscreener.com/solana/${h.mint}`, '_blank')}>
                      DEX↗
                    </button>
                  </div>
                ))}
                {!loadingHold && holdingsData.length === 0 && (
                  <div style={{ textAlign:'center', padding:30, color:'#2a4a5a' }}>
                    No meme coin holdings found
                    {!HELIUS_KEY && (
                      <span style={{ color:'#ff6b35' }}> — add VITE_HELIUS_KEY for richer data</span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════ SIGNALS ══════════ */}
      {tab === 'SIGNALS' && (
        <div>
          {signals.length === 0 && (
            <div style={{ ...card, textAlign:'center', padding:30, color:'#2a4a5a' }}>
              No multi-whale signals yet — need 2+ whales to interact with same token
            </div>
          )}
          {signals.map((sig, i) => {
            const isAcc  = sig.type === 'ACC'
            const color  = isAcc
              ? (sig.strength === 'STRONG' ? '#00ff88' : '#ffd700')
              : (sig.strength === 'WARNING' ? '#ff4466' : '#ff6b35')
            return (
              <div key={i} style={{ ...card, border:`1px solid ${color}44`, marginBottom:6 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:14 }}>
                      {isAcc ? (sig.strength === 'STRONG' ? '🔥' : '📈') : '⚠️'}
                    </span>
                    <span style={{ color, fontWeight:'bold', fontSize:11 }}>{sig.msg}</span>
                    <span style={{ background:`${color}20`, border:`1px solid ${color}55`,
                      color, padding:'1px 8px', borderRadius:3, fontSize:9, fontWeight:'bold' }}>
                      {sig.action}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0, marginLeft:8 }}>
                    <span style={{ color:'#2a5a6a', fontSize:9 }}>{timeAgo(sig.time)}</span>
                    <button
                      style={{ ...smBtn('#a0c4ff'), fontSize:9, padding:'2px 7px' }}
                      onClick={() => window.open(`https://dexscreener.com/solana/${sig.mint}`, '_blank')}>
                      Chart↗
                    </button>
                  </div>
                </div>
                <div style={{ color:'#4a7a8a', fontSize:9, marginTop:4 }}>
                  {sig.count} whale{sig.count !== 1 ? 's' : ''} · {sig.strength} signal · {sig.symbol}
                </div>
              </div>
            )
          })}

          {/* Signal playbook */}
          <div style={{ ...card, border:'1px solid rgba(255,215,0,0.15)', marginTop:10 }}>
            <div style={{ color:'#ffd700', fontSize:10, letterSpacing:1.5, marginBottom:8 }}>
              📖 SIGNAL PLAYBOOK
            </div>
            {[
              ['🔥','3+ whales buy same token in 2h',      'STRONG BUY — full position size'],
              ['📈','2 whales buy same token in 2h',       'WATCH — consider 50% entry'],
              ['⚠️','2+ whales selling same token',        'EXIT IMMEDIATELY'],
              ['⚠️','Single whale multiple sells in 1h',  'TIGHTEN stop loss to +5%'],
              ['🔴','Whale buys then quickly sells',       'PUMP & DUMP — avoid'],
              ['🟢','Whale accumulates over several hours','CONVICTION BUY — strong hold'],
            ].map(([e, t, a]) => (
              <div key={t} style={{ display:'grid', gridTemplateColumns:'22px 1fr auto', gap:8,
                padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.03)', alignItems:'center' }}>
                <span style={{ fontSize:11 }}>{e}</span>
                <span style={{ color:'#8fb8d0', fontSize:10 }}>{t}</span>
                <span style={{ fontSize:9,
                  color: a.includes('BUY') || a.includes('hold') ? '#00ff88'
                       : a.includes('EXIT') || a.includes('avoid') ? '#ff4466' : '#ffd700' }}>
                  {a}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Helius upgrade prompt ── */}
      {!HELIUS_KEY && (
        <div style={{ ...card, border:'1px solid rgba(255,107,53,0.2)', marginTop:6 }}>
          <div style={{ color:'#ff6b35', fontSize:9, letterSpacing:1, marginBottom:4 }}>
            ⚡ UNLOCK FULL WHALE INTELLIGENCE
          </div>
          <div style={{ color:'#4a7a8a', fontSize:9, lineHeight:1.8 }}>
            Add <span style={{ color:'#ffd700' }}>VITE_HELIUS_KEY=your_key</span> to{' '}
            <span style={{ color:'#ffd700' }}>.env</span> and rebuild to unlock:<br />
            ✓ Full token names &nbsp;·&nbsp; ✓ USD trade values &nbsp;·&nbsp;
            ✓ Portfolio USD totals &nbsp;·&nbsp; ✓ Token images in holdings<br />
            Free tier at{' '}
            <a href="https://helius.dev" target="_blank" rel="noreferrer" style={{ color:'#00dcb4' }}>
              helius.dev
            </a>{' '}
            — 100k requests/month, no credit card needed.
          </div>
        </div>
      )}
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
                  {key === 'minLiquidity' || key === 'minVolume'
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
          [10.0, 0.10, '#ff9944', '🌙 MOON'],
        ].map(([mult, sell, color, label]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:10,
            padding:8, background:'#020509', borderRadius:4, marginBottom:5 }}>
            <span style={{ color, fontWeight:'bold', minWidth:55, fontSize:11 }}>{label}</span>
            <div style={{ flex:1, background:'#0a1a24', borderRadius:3, height:8, overflow:'hidden' }}>
              <div style={{ width:`${Math.min((mult - 1) * 12, 100)}%`, height:'100%',
                background:color, borderRadius:3, boxShadow:`0 0 6px ${color}66` }} />
            </div>
            <span style={{ color, minWidth:55, textAlign:'right', fontSize:11 }}>
              +{((mult - 1) * 100).toFixed(0)}%
            </span>
            <span style={{ color:'#4a7a8a', minWidth:70, textAlign:'right', fontSize:10 }}>
              sell {(sell * 100).toFixed(0)}% of bag
            </span>
          </div>
        ))}
        <div style={{ marginTop:8, padding:8, background:'#020509', borderRadius:4,
          fontSize:10, color:'#4a7a8a', lineHeight:1.8 }}>
          After TP1 hit → trailing stop raised to{' '}
          <span style={{ color:'#00ff88' }}>entry +10%</span><br />
          Max loss per $100 capital at default settings:{' '}
          <span style={{ color:'#ff4466' }}>-${(100 * 0.10 * 0.15).toFixed(2)}</span>
        </div>
      </div>

      {/* Rug detectors */}
      <div style={{ ...card, border:'1px solid rgba(255,68,102,0.15)' }}>
        <div style={{ color:'#ff4466', letterSpacing:2, marginBottom:10, fontSize:11 }}>
          🚨 RUG PULL DETECTORS
        </div>
        {[
          ['🔴','Liquidity drops >30% in 5 min',    'AUTO EXIT'],
          ['🔴','Dev wallet dumps >10% supply',      'AUTO EXIT'],
          ['🔴','Sell txns 2x buys sustained 5min',  'TIGHTEN SL'],
          ['🔴','Token age <30 min',                 'HONEYPOT SKIP'],
          ['🔴','Liq/MCap ratio <1%',                'MANIPULATION'],
          ['🟡','Score drops below min',             'REDUCE SIZE'],
          ['🟡','Price impact >3% on entry',         'ABORT TRADE'],
          ['🟢','Score 70+ + whale accumulation',    'MAX POSITION'],
        ].map(([e, t, a]) => (
          <div key={t} style={{ display:'grid', gridTemplateColumns:'18px 1fr auto', gap:8,
            padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.02)', alignItems:'center' }}>
            <span style={{ fontSize:11 }}>{e}</span>
            <span style={{ color:'#8fb8d0', fontSize:10 }}>{t}</span>
            <span style={{ fontSize:9,
              color: a === 'AUTO EXIT' || a === 'HONEYPOT SKIP' ? '#ff4466'
                   : a === 'TIGHTEN SL' || a === 'MANIPULATION' ? '#ff6b35'
                   : a === 'REDUCE SIZE' || a === 'ABORT TRADE' ? '#ffd700' : '#00ff88' }}>
              {a}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────

const FEED_COLS = '42px 88px 48px 65px 70px 32px'

const holdCols = () => HELIUS_KEY
  ? '90px 70px 80px 65px 38px'
  : '130px 110px 42px'

const card = {
  background: '#050d14', border: '1px solid rgba(0,220,180,0.08)',
  borderRadius: 6, padding: 12, marginBottom: 10,
}
const statItem = {
  background: '#020509', padding: '10px 12px', borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.04)',
}
const th = { color:'#2a5a6a', fontSize:9, letterSpacing:1 }
const smBtn = (c) => ({
  background: `${c}12`, border: `1px solid ${c}44`, color: c,
  padding: '5px 10px', borderRadius: 3, cursor: 'pointer', fontSize: 10,
  fontFamily: "'IBM Plex Mono',monospace",
})
const pill = (c) => ({
  background: `${c}18`, border: `1px solid ${c}55`, color: c,
  padding: '2px 8px', borderRadius: 10, fontSize: 8, fontWeight: 'bold', letterSpacing: 0.5,
})
const inputStyle = {
  background: '#020509', border: '1px solid rgba(0,220,180,0.2)',
  color: '#c8d8e8', padding: '7px 10px', borderRadius: 4, fontSize: 10,
  fontFamily: "'IBM Plex Mono',monospace", outline: 'none',
}
const tabBtn = (active) => ({
  background:    active ? 'rgba(0,220,180,0.1)' : 'transparent',
  border:        active ? '1px solid rgba(0,220,180,0.35)' : '1px solid transparent',
  borderBottom:  active ? '2px solid #00dcb4' : '2px solid transparent',
  color:         active ? '#00dcb4' : '#3a6a7a',
  cursor:        'pointer', fontSize: 10,
  fontFamily:    "'IBM Plex Mono',monospace", letterSpacing: 1.5,
  padding:       '5px 14px', borderRadius: '4px 4px 0 0', transition: 'all 0.15s',
})

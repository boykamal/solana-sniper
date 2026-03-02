import { useState, useEffect } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

const WALLET_ICONS = {
  Phantom:  '👻',
  Solflare: '🌟',
  Backpack: '🎒',
  Coinbase: '🔵',
  Trust:    '🛡',
}

export function WalletButton({ compact = false }) {
  const { publicKey, wallet, disconnect, connecting, connected } = useWallet()
  const { connection }     = useConnection()
  const { setVisible }     = useWalletModal()
  const [balance, setBalance] = useState(null)
  const [drop,    setDrop]    = useState(false)

  useEffect(() => {
    if (!publicKey) { setBalance(null); return }
    connection.getBalance(publicKey).then(b => setBalance(b / LAMPORTS_PER_SOL))
    const id = setInterval(() => {
      connection.getBalance(publicKey).then(b => setBalance(b / LAMPORTS_PER_SOL))
    }, 15000)
    return () => clearInterval(id)
  }, [publicKey, connection])

  const addr = publicKey
    ? `${publicKey.toBase58().slice(0,4)}…${publicKey.toBase58().slice(-4)}`
    : null

  const icon = wallet?.adapter?.name
    ? (WALLET_ICONS[wallet.adapter.name] || '🔑')
    : '🔑'

  if (!connected) {
    return (
      <button
        onClick={() => setVisible(true)}
        disabled={connecting}
        style={btnStyle('#00dcb4')}
      >
        {connecting ? '⏳ CONNECTING…' : '⚡ CONNECT WALLET'}
      </button>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setDrop(d => !d)} style={btnStyle('#00dcb4', true)}>
        <span>{icon}</span>
        <span>{addr}</span>
        {balance !== null && (
          <span style={{ color: '#4ae8c0', marginLeft: 4 }}>
            {balance.toFixed(3)} SOL
          </span>
        )}
        <span style={{ marginLeft: 6, opacity: 0.5 }}>{drop ? '▲' : '▼'}</span>
      </button>

      {drop && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 999,
          background: '#050d14', border: '1px solid rgba(0,220,180,0.25)',
          borderRadius: 6, minWidth: 220, padding: '6px 0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          {/* Wallet info */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #0a1a24' }}>
            <div style={{ color: '#4a7a8a', fontSize: 9, letterSpacing: 1 }}>CONNECTED WALLET</div>
            <div style={{ color: '#00dcb4', fontSize: 11, marginTop: 2 }}>
              {icon} {wallet?.adapter?.name}
            </div>
            <div style={{ color: '#c8d8e8', fontSize: 10, marginTop: 2, fontFamily: 'monospace' }}>
              {publicKey?.toBase58()}
            </div>
          </div>
          {balance !== null && (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #0a1a24' }}>
              <div style={{ color: '#4a7a8a', fontSize: 9 }}>BALANCE</div>
              <div style={{ color: '#00ff88', fontSize: 14, fontWeight: 'bold' }}>
                {balance.toFixed(4)} SOL
              </div>
            </div>
          )}
          {/* Actions */}
          <button
            onClick={() => { navigator.clipboard.writeText(publicKey?.toBase58() || ''); setDrop(false) }}
            style={menuItemStyle}
          >📋 Copy Address</button>
          <button
            onClick={() => { window.open(`https://solscan.io/account/${publicKey?.toBase58()}`, '_blank'); setDrop(false) }}
            style={menuItemStyle}
          >🔍 View on Solscan</button>
          <button
            onClick={() => { setVisible(true); setDrop(false) }}
            style={menuItemStyle}
          >🔄 Change Wallet</button>
          <button
            onClick={() => { disconnect(); setDrop(false) }}
            style={{ ...menuItemStyle, color: '#ff4466' }}
          >⏏ Disconnect</button>
        </div>
      )}

      {/* Click outside to close */}
      {drop && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 998 }}
          onClick={() => setDrop(false)}
        />
      )}
    </div>
  )
}

const btnStyle = (c, connected) => ({
  display:       'flex',
  alignItems:    'center',
  gap:           8,
  background:    connected ? 'rgba(0,220,180,0.08)' : 'transparent',
  border:        `1px solid ${c}${connected ? '60' : '40'}`,
  color:         c,
  padding:       '7px 14px',
  borderRadius:  4,
  cursor:        'pointer',
  fontSize:      11,
  fontFamily:    "'IBM Plex Mono', monospace",
  letterSpacing: 1,
  transition:    'all 0.2s',
  whiteSpace:    'nowrap',
})

const menuItemStyle = {
  display:    'block',
  width:      '100%',
  textAlign:  'left',
  background: 'transparent',
  border:     'none',
  color:      '#c8d8e8',
  padding:    '8px 14px',
  cursor:     'pointer',
  fontSize:   11,
  fontFamily: "'IBM Plex Mono', monospace",
  letterSpacing: 0.5,
  transition: 'background 0.15s',
}

const BASE = import.meta.env.VITE_API_URL || ''

const call = async (path, opts = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

export const api = {
  tokens:    (q = '') => call(`/api/tokens${q}`),
  portfolio: ()       => call('/api/portfolio'),
  whales:    ()       => call('/api/whales'),
  config:    ()       => call('/api/config'),

  buy: (pair_address, usd_amount, wallet_pubkey) =>
    call('/api/trade/buy', {
      method: 'POST',
      body: JSON.stringify({ pair_address, usd_amount, wallet_pubkey }),
    }),

  sell: (position_id, sell_pct = 1.0, wallet_pubkey) =>
    call(`/api/trade/sell/${position_id}`, {
      method: 'POST',
      body: JSON.stringify({ sell_pct, wallet_pubkey }),
    }),

  close: (id, wallet_pubkey) =>
    call(`/api/positions/${id}/close`, {
      method: 'DELETE',
      body: JSON.stringify({ wallet_pubkey }),
    }),

  health: () => call('/health'),

  scanQueries: () => call('/api/scan-queries'),
  saveScanQueries: (queries) => call('/api/scan-queries', {
    method: 'POST',
    body: JSON.stringify({ queries }),
  }),

  // On-demand Rugcheck enrichment (cached after first fetch)
  getRug: (mint) => call(`/api/rug/${mint}`),
}

// DexScreener direct (no proxy needed)
export const dex = {
  search: (q) =>
    fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json()),
  pair: (addr) =>
    fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${addr}`)
      .then(r => r.json()),
  token: (mint) =>
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
      .then(r => r.json()),
}

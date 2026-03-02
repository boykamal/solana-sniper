import React, { useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork }               from '@solana/wallet-adapter-base'
import { WalletModalProvider }                from '@solana/wallet-adapter-react-ui'
import { clusterApiUrl }                       from '@solana/web3.js'

// Wallet adapters
import { PhantomWalletAdapter }   from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter }  from '@solana/wallet-adapter-solflare'
import { BackpackWalletAdapter }  from '@solana/wallet-adapter-backpack'
import { CoinbaseWalletAdapter }  from '@solana/wallet-adapter-coinbase'
import { TrustWalletAdapter }     from '@solana/wallet-adapter-trust'

// Default wallet adapter UI styles
import '@solana/wallet-adapter-react-ui/styles.css'

import App from './App.jsx'

function Root() {
  // Use mainnet for real trading
  const network  = WalletAdapterNetwork.Mainnet
  const endpoint = useMemo(() => {
    // Prefer env-provided RPC (Helius/QuickNode), fallback to public
    return import.meta.env.VITE_RPC_ENDPOINT || clusterApiUrl(network)
  }, [network])

  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network }),
    new BackpackWalletAdapter(),
    new CoinbaseWalletAdapter(),
    new TrustWalletAdapter(),
  ], [network])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)

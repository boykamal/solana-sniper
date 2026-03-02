import { useCallback, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import {
  VersionedTransaction,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'

const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote'
const JUPITER_SWAP  = 'https://quote-api.jup.ag/v6/swap'
const SOL_MINT      = 'So11111111111111111111111111111111111111112'
const USDC_MINT     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export function useWalletTrading() {
  const { connection }                                  = useConnection()
  const { publicKey, signTransaction, sendTransaction } = useWallet()
  const [loading, setLoading]                           = useState(false)
  const [lastTx,  setLastTx]                            = useState(null)
  const [error,   setError]                             = useState(null)

  // ── Get SOL balance ──────────────────────────────────────────────────────
  const getBalance = useCallback(async () => {
    if (!publicKey) return 0
    const lamports = await connection.getBalance(publicKey)
    return lamports / LAMPORTS_PER_SOL
  }, [connection, publicKey])

  // ── Get USDC balance ─────────────────────────────────────────────────────
  const getUsdcBalance = useCallback(async () => {
    if (!publicKey) return 0
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: new PublicKey(USDC_MINT) }
      )
      if (tokenAccounts.value.length === 0) return 0
      return tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0
    } catch {
      return 0
    }
  }, [connection, publicKey])

  // ── Get token balance ────────────────────────────────────────────────────
  const getTokenBalance = useCallback(async (mintAddress) => {
    if (!publicKey) return 0
    try {
      const mint = new PublicKey(mintAddress)
      const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint })
      if (!accounts.value.length) return 0
      return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0
    } catch {
      return 0
    }
  }, [connection, publicKey])

  // ── Jupiter quote ─────────────────────────────────────────────────────────
  const getQuote = useCallback(async (
    inputMint, outputMint, amountInSmallestUnit, slippageBps = 300
  ) => {
    const url = `${JUPITER_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}` +
                `&amount=${amountInSmallestUnit}&slippageBps=${slippageBps}&swapMode=ExactIn`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Jupiter quote failed: ${resp.status}`)
    return resp.json()
  }, [])

  // ── Buy token with SOL ───────────────────────────────────────────────────
  const buyWithSol = useCallback(async ({
    tokenMint,
    solAmount,      // in SOL
    slippageBps = 300,
    priorityFee = 500000,  // lamports
    onStatus,
  }) => {
    if (!publicKey || !signTransaction) throw new Error('Wallet not connected')
    setLoading(true)
    setError(null)

    try {
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL)
      onStatus?.('Getting quote…')

      // 1. Quote: SOL → token
      const quote = await getQuote(SOL_MINT, tokenMint, lamports, slippageBps)

      const priceImpact = parseFloat(quote.priceImpactPct)
      if (priceImpact > 5) throw new Error(`Price impact too high: ${priceImpact.toFixed(2)}%`)

      onStatus?.(`Impact: ${priceImpact.toFixed(2)}% — Building tx…`)

      // 2. Build swap transaction
      const swapResp = await fetch(JUPITER_SWAP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse:              quote,
          userPublicKey:              publicKey.toBase58(),
          wrapAndUnwrapSol:           true,
          dynamicComputeUnitLimit:    true,
          prioritizationFeeLamports:  priorityFee,
        }),
      })
      if (!swapResp.ok) throw new Error(`Jupiter swap build failed: ${swapResp.status}`)
      const { swapTransaction } = await swapResp.json()

      onStatus?.('Waiting for wallet approval…')

      // 3. Deserialize, sign, send
      const txBytes = Buffer.from(swapTransaction, 'base64')
      const tx      = VersionedTransaction.deserialize(txBytes)
      const signed  = await signTransaction(tx)
      const sig     = await sendTransaction(signed, connection, {
        skipPreflight:       false,
        preflightCommitment: 'confirmed',
        maxRetries:          3,
      })

      onStatus?.('Confirming…')
      const conf = await connection.confirmTransaction(sig, 'confirmed')
      if (conf.value.err) throw new Error(`Tx failed: ${JSON.stringify(conf.value.err)}`)

      setLastTx(sig)
      onStatus?.(`Confirmed: ${sig.slice(0,8)}…`)
      return {
        signature:   sig,
        inAmount:    solAmount,
        outAmount:   parseInt(quote.outAmount),
        priceImpact,
        quote,
      }
    } finally {
      setLoading(false)
    }
  }, [publicKey, signTransaction, sendTransaction, connection, getQuote])

  // ── Buy token with USDC ───────────────────────────────────────────────────
  const buyWithUsdc = useCallback(async ({
    tokenMint,
    usdcAmount,     // in USDC (human-readable)
    slippageBps = 300,
    priorityFee = 500000,
    onStatus,
  }) => {
    if (!publicKey || !signTransaction) throw new Error('Wallet not connected')
    setLoading(true)
    setError(null)

    try {
      const microUsdc = Math.floor(usdcAmount * 1_000_000)
      onStatus?.('Getting USDC → token quote…')

      const quote = await getQuote(USDC_MINT, tokenMint, microUsdc, slippageBps)
      const priceImpact = parseFloat(quote.priceImpactPct)
      if (priceImpact > 5) throw new Error(`Price impact too high: ${priceImpact.toFixed(2)}%`)

      onStatus?.('Building transaction…')
      const swapResp = await fetch(JUPITER_SWAP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse:             quote,
          userPublicKey:             publicKey.toBase58(),
          wrapAndUnwrapSol:          true,
          dynamicComputeUnitLimit:   true,
          prioritizationFeeLamports: priorityFee,
        }),
      })
      const { swapTransaction } = await swapResp.json()

      onStatus?.('Approve in wallet…')
      const txBytes = Buffer.from(swapTransaction, 'base64')
      const tx      = VersionedTransaction.deserialize(txBytes)
      const signed  = await signTransaction(tx)
      const sig     = await sendTransaction(signed, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      onStatus?.('Confirming on-chain…')
      await connection.confirmTransaction(sig, 'confirmed')
      setLastTx(sig)
      return { signature: sig, quote, priceImpact }
    } finally {
      setLoading(false)
    }
  }, [publicKey, signTransaction, sendTransaction, connection, getQuote])

  // ── Sell token → USDC ────────────────────────────────────────────────────
  const sellToken = useCallback(async ({
    tokenMint,
    tokenDecimals = 6,
    tokenAmount,    // human-readable
    slippageBps = 300,
    priorityFee = 500000,
    onStatus,
  }) => {
    if (!publicKey || !signTransaction) throw new Error('Wallet not connected')
    setLoading(true)
    setError(null)

    try {
      const rawAmount = Math.floor(tokenAmount * Math.pow(10, tokenDecimals))
      onStatus?.('Getting sell quote…')

      const quote = await getQuote(tokenMint, USDC_MINT, rawAmount, slippageBps)
      const usdcOut = parseInt(quote.outAmount) / 1_000_000

      onStatus?.(`Will receive ~$${usdcOut.toFixed(2)} USDC`)
      const swapResp = await fetch(JUPITER_SWAP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse:             quote,
          userPublicKey:             publicKey.toBase58(),
          wrapAndUnwrapSol:          true,
          dynamicComputeUnitLimit:   true,
          prioritizationFeeLamports: priorityFee,
        }),
      })
      const { swapTransaction } = await swapResp.json()

      onStatus?.('Approve in wallet…')
      const txBytes = Buffer.from(swapTransaction, 'base64')
      const tx      = VersionedTransaction.deserialize(txBytes)
      const signed  = await signTransaction(tx)
      const sig     = await sendTransaction(signed, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })

      onStatus?.('Confirming…')
      await connection.confirmTransaction(sig, 'confirmed')
      setLastTx(sig)
      return { signature: sig, usdcReceived: usdcOut, quote }
    } finally {
      setLoading(false)
    }
  }, [publicKey, signTransaction, sendTransaction, connection, getQuote])

  return {
    connected:       !!publicKey,
    publicKey,
    loading,
    lastTx,
    error,
    getBalance,
    getUsdcBalance,
    getTokenBalance,
    getQuote,
    buyWithSol,
    buyWithUsdc,
    sellToken,
  }
}

// executor.rs
// The Rust backend manages portfolio state and records trades.
// Actual on-chain signing is handled by the frontend wallet (Phantom/Solflare)
// via useWalletTrading.js → Jupiter V6 API.
//
// In DRY_RUN=true  → simulates trades, updates portfolio state
// In DRY_RUN=false → returns swap instructions for frontend to sign

use std::sync::Arc;
use anyhow::{bail, Result};
use chrono::Utc;
use tracing::info;
use uuid::Uuid;

use crate::models::*;
use crate::state::AppState;

const JUPITER_QUOTE: &str = "https://quote-api.jup.ag/v6/quote";
const USDC_MINT:     &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

pub struct TradeExecutor {
    state: Arc<AppState>,
}

impl TradeExecutor {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }

    // ── BUY ──────────────────────────────────────────────────────────────────

    pub async fn buy(&self, token: &ScoredToken, usd_amount: f64) -> Result<Trade> {
        if self.state.config.dry_run {
            return Ok(self.simulate_buy(token, usd_amount));
        }

        let quote = self.get_jupiter_quote(
            USDC_MINT,
            &token.pair.base_token.address,
            (usd_amount * 1_000_000.0) as u64,
            self.state.config.slippage_bps,
        ).await?;

        let price_impact: f64 = quote["priceImpactPct"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);

        if price_impact > 5.0 {
            bail!("Price impact too high: {:.2}% — aborting", price_impact);
        }

        let out_amount = quote["outAmount"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let price    = if out_amount > 0 { usd_amount / (out_amount as f64 / 1e9) } else { 0.0 };
        let quantity = out_amount as f64 / 1e9;

        info!("📋 BUY quote ready for {}: ${:.2} (impact: {:.2}%)",
              token.pair.base_token.symbol, usd_amount, price_impact);

        Ok(Trade {
            id:               Uuid::new_v4(),
            position_id:      Uuid::new_v4(),
            trade_type:       TradeType::Buy,
            symbol:           token.pair.base_token.symbol.clone(),
            price,
            quantity,
            usd_value:        usd_amount,
            fee_usd:          usd_amount * 0.003,
            pnl:              None,
            tx_signature:     Some("PENDING_WALLET_SIGNATURE".into()),
            executed_at:      Utc::now(),
            execution_source: ExecutionSource::Jupiter,
        })
    }

    // ── SELL ─────────────────────────────────────────────────────────────────

    pub async fn sell(&self, position: &Position, sell_pct: f64) -> Result<Trade> {
        if self.state.config.dry_run {
            let current_price = self.get_current_price(&position.pair_address).await
                .unwrap_or(position.entry_price);
            return Ok(self.simulate_sell(position, sell_pct, current_price));
        }

        let quantity  = position.quantity * sell_pct;
        let current   = self.get_current_price(&position.pair_address).await?;
        let usd_value = quantity * current;
        let pnl       = usd_value - (position.invested_usd * sell_pct);

        Ok(Trade {
            id:               Uuid::new_v4(),
            position_id:      position.id,
            trade_type:       TradeType::Sell,
            symbol:           position.symbol.clone(),
            price:            current,
            quantity,
            usd_value,
            fee_usd:          usd_value * 0.003,
            pnl:              Some(pnl),
            tx_signature:     Some("PENDING_WALLET_SIGNATURE".into()),
            executed_at:      Utc::now(),
            execution_source: ExecutionSource::Jupiter,
        })
    }

    // ── JUPITER QUOTE ─────────────────────────────────────────────────────────

    pub async fn get_jupiter_quote(
        &self,
        input_mint:   &str,
        output_mint:  &str,
        amount:       u64,
        slippage_bps: u32,
    ) -> Result<serde_json::Value> {
        let url = format!(
            "{}?inputMint={}&outputMint={}&amount={}&slippageBps={}&swapMode=ExactIn",
            JUPITER_QUOTE, input_mint, output_mint, amount, slippage_bps
        );
        let resp = self.state.http
            .get(&url)
            .send().await?
            .json::<serde_json::Value>().await?;

        if resp.get("error").is_some() {
            bail!("Jupiter quote error: {}", resp["error"]);
        }
        Ok(resp)
    }

    // ── PRICE FETCH ───────────────────────────────────────────────────────────

    pub async fn get_current_price(&self, pair_address: &str) -> Result<f64> {
        let url = format!(
            "https://api.dexscreener.com/latest/dex/pairs/solana/{}",
            pair_address
        );
        let resp = self.state.http
            .get(&url).send().await?
            .json::<serde_json::Value>().await?;

        let price = resp["pairs"][0]["priceUsd"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);

        Ok(price)
    }

    // ── DRY RUN SIMULATORS ────────────────────────────────────────────────────

    fn simulate_buy(&self, token: &ScoredToken, usd_amount: f64) -> Trade {
        let price: f64 = token.pair.price_usd
            .as_deref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.000001);

        let quantity = if price > 0.0 { usd_amount / price } else { 0.0 };

        info!("🔄 DRY RUN BUY: {} @ ${:.8} — Size: ${:.2}",
              token.pair.base_token.symbol, price, usd_amount);

        Trade {
            id:               Uuid::new_v4(),
            position_id:      Uuid::new_v4(),
            trade_type:       TradeType::Buy,
            symbol:           token.pair.base_token.symbol.clone(),
            price,
            quantity,
            usd_value:        usd_amount,
            fee_usd:          usd_amount * 0.003,
            pnl:              None,
            tx_signature:     Some(format!("DRY_{}", &Uuid::new_v4().to_string()[..8].to_uppercase())),
            executed_at:      Utc::now(),
            execution_source: ExecutionSource::Jupiter,
        }
    }

    fn simulate_sell(&self, position: &Position, sell_pct: f64, current_price: f64) -> Trade {
        let sim_price = if current_price > 0.0 {
            current_price
        } else {
            position.entry_price * 1.2
        };

        let quantity  = position.quantity * sell_pct;
        let usd_value = quantity * sim_price;
        let pnl       = usd_value - (position.invested_usd * sell_pct);

        info!("🔄 DRY RUN SELL: {} {:.0}% @ ${:.8} — PnL: {:+.2}",
              position.symbol, sell_pct * 100.0, sim_price, pnl);

        Trade {
            id:               Uuid::new_v4(),
            position_id:      position.id,
            trade_type:       TradeType::Sell,
            symbol:           position.symbol.clone(),
            price:            sim_price,
            quantity,
            usd_value,
            fee_usd:          usd_value * 0.003,
            pnl:              Some(pnl),
            tx_signature:     Some(format!("DRY_{}", &Uuid::new_v4().to_string()[..8].to_uppercase())),
            executed_at:      Utc::now(),
            execution_source: ExecutionSource::Jupiter,
        }
    }
}
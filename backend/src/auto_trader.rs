use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn, error};
use serde::Deserialize;

use crate::models::{WsMessage, AlertLevel, Position, Trade, TakeProfitLevel};
use crate::state::AppState;

// Minimal DexScreener structs used only for price refresh
#[derive(Debug, Deserialize)]
struct PriceResponse {
    pairs: Option<Vec<PricePair>>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PricePair {
    pair_address: String,
    price_usd: Option<String>,
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub async fn start_auto_trader(state: Arc<AppState>) {
    // Price updater always runs (tracks manually-opened positions too)
    let price_state = state.clone();
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(10)).await;
            if let Err(e) = update_prices(&price_state).await {
                warn!("Price update error: {}", e);
            }
        }
    });

    if !state.config.auto_trading_enabled {
        info!("ℹ️  Auto-trading disabled (AUTO_TRADING_ENABLED=false) — price updater still running");
        return;
    }

    let paper_tag = if state.config.dry_run { "[PAPER] " } else { "" };
    info!(
        "{}🤖 Auto-trader ON — {}% capital/trade, min score {}, every {}s",
        paper_tag,
        state.config.auto_buy_pct_capital * 100.0,
        state.config.auto_buy_min_score,
        state.config.auto_buy_interval_secs,
    );

    let interval = Duration::from_secs(state.config.auto_buy_interval_secs);
    loop {
        // Wait one interval before first buy (gives scanner time to populate)
        sleep(interval).await;
        if let Err(e) = try_buy(&state).await {
            error!("Auto-buy error: {}", e);
        }
    }
}

// ── Auto-buy ──────────────────────────────────────────────────────────────────

async fn try_buy(state: &Arc<AppState>) -> anyhow::Result<()> {
    // --- Check capacity (short read lock, dropped immediately) ---
    let allocation = {
        let port = state.portfolio.read();
        if port.positions.len() >= state.config.max_open_positions {
            return Ok(());
        }
        if port.available_cash_usd <= 10.0 {
            return Ok(());
        }
        let alloc = (port.total_capital_usd * state.config.auto_buy_pct_capital)
            .min(port.available_cash_usd)
            .min(state.config.auto_buy_max_per_trade * port.total_capital_usd);
        if alloc < 10.0 { return Ok(()); }
        alloc
    };

    // --- Pick best token not already in portfolio ---
    let candidate = {
        let tokens = state.scanner_tokens.read();
        if tokens.is_empty() {
            info!("Scanner has no tokens yet — waiting for first scan");
            return Ok(());
        }
        let existing: std::collections::HashSet<String> = {
            let port = state.portfolio.read();
            port.positions.iter().map(|p| p.pair_address.clone()).collect()
        };
        tokens.iter()
            .filter(|t| t.score >= state.config.auto_buy_min_score)
            .find(|t| !existing.contains(&t.pair_address))
            .cloned()
    };

    let token = match candidate {
        Some(t) => t,
        None => {
            info!("No qualifying tokens for auto-buy (min score: {})", state.config.auto_buy_min_score);
            return Ok(());
        }
    };

    let quantity        = allocation / token.price_usd;
    let stop_loss_price = token.price_usd * (1.0 - state.config.stop_loss_pct);
    let pos_id          = uuid::Uuid::new_v4().to_string();
    let trade_id        = uuid::Uuid::new_v4().to_string();

    let position = Position {
        id:              pos_id,
        symbol:          token.symbol.clone(),
        mint_address:    token.mint_address.clone(),
        pair_address:    token.pair_address.clone(),
        entry_price:     token.price_usd,
        current_price:   token.price_usd,
        quantity,
        invested_usd:    allocation,
        current_value_usd: allocation,
        unrealized_pnl:     0.0,
        unrealized_pnl_pct: 0.0,
        stop_loss_price,
        take_profit_levels: vec![
            TakeProfitLevel { level: 1, target_multiplier: 1.5,  sell_pct: 0.40, hit: false },
            TakeProfitLevel { level: 2, target_multiplier: 2.0,  sell_pct: 0.30, hit: false },
            TakeProfitLevel { level: 3, target_multiplier: 5.0,  sell_pct: 0.20, hit: false },
            TakeProfitLevel { level: 4, target_multiplier: 10.0, sell_pct: 0.10, hit: false },
        ],
        risk_level:     token.risk_level.clone(),
        score_at_entry: token.score,
        opened_at:      chrono::Utc::now(),
        decimals:       6,
        tx_signature:   None,
    };

    let paper_tag = if state.config.dry_run { "[PAPER] " } else { "" };
    let msg = format!(
        "{}🤖 AUTO BUY: {} @ ${:.6} | Size: ${:.2} | Score: {} | SL: ${:.6}",
        paper_tag, token.symbol, token.price_usd, allocation, token.score, stop_loss_price
    );
    info!("{}", msg);

    // --- Mutate portfolio (sync block, lock dropped before any .await) ---
    {
        let mut port = state.portfolio.write();
        port.available_cash_usd -= allocation;
        port.invested_usd       += allocation;
        port.total_value_usd     = port.available_cash_usd + port.invested_usd;
        port.positions.push(position);
        port.recent_trades.insert(0, Trade {
            id:           trade_id,
            symbol:       token.symbol.clone(),
            trade_type:   "Buy".into(),
            usd_value:    allocation,
            pnl:          None,
            tx_signature: None,
            executed_at:  chrono::Utc::now(),
        });
        port.recent_trades.truncate(100);
        port.updated_at = chrono::Utc::now();
    }

    let snapshot = state.portfolio.read().clone();
    state.broadcast(WsMessage::Alert { level: AlertLevel::Info, message: msg.clone() }).await;
    state.broadcast(WsMessage::PortfolioUpdate(snapshot)).await;
    state.broadcast(WsMessage::TradeExecuted(msg)).await;
    Ok(())
}

// ── Price updater ─────────────────────────────────────────────────────────────

async fn update_prices(state: &Arc<AppState>) -> anyhow::Result<()> {
    // Collect open pair addresses (lock dropped immediately)
    let pair_addresses: Vec<String> = {
        let port = state.portfolio.read();
        if port.positions.is_empty() { return Ok(()); }
        port.positions.iter().map(|p| p.pair_address.clone()).collect()
    };

    // HTTP call — no lock held
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    let url = format!(
        "https://api.dexscreener.com/latest/dex/pairs/solana/{}",
        pair_addresses.join(",")
    );
    let data: PriceResponse = client.get(&url).send().await?.json().await?;
    let pairs = data.pairs.unwrap_or_default();

    let mut price_map: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for pair in pairs {
        if let Some(s) = pair.price_usd {
            if let Ok(p) = s.parse::<f64>() {
                if p > 0.0 { price_map.insert(pair.pair_address, p); }
            }
        }
    }
    if price_map.is_empty() { return Ok(()); }

    // Collect exits to process after releasing write lock
    // Format: (pos_id, exit_price, reason, sell_pct)
    let mut exits: Vec<(String, f64, String, f64)> = Vec::new();

    // --- Write lock: update prices and collect exit triggers ---
    {
        let mut port = state.portfolio.write();
        for pos in &mut port.positions {
            let price = match price_map.get(&pos.pair_address) {
                Some(&p) => p,
                None => continue,
            };
            pos.current_price     = price;
            pos.current_value_usd = pos.quantity * price;
            pos.unrealized_pnl    = pos.current_value_usd - pos.invested_usd;
            pos.unrealized_pnl_pct = if pos.invested_usd > 0.0 {
                (pos.unrealized_pnl / pos.invested_usd) * 100.0
            } else { 0.0 };

            // Stop-loss check (takes priority over TP)
            if price <= pos.stop_loss_price {
                exits.push((pos.id.clone(), price, "STOP LOSS".into(), 1.0));
                continue; // don't check TPs if SL triggered
            }

            // Take-profit checks
            for tp in &mut pos.take_profit_levels {
                if !tp.hit && price >= pos.entry_price * tp.target_multiplier {
                    tp.hit = true;
                    exits.push((
                        pos.id.clone(),
                        price,
                        format!("TP{} +{:.0}%", tp.level, (tp.target_multiplier - 1.0) * 100.0),
                        tp.sell_pct,
                    ));
                }
            }
        }

        port.unrealized_pnl  = port.positions.iter().map(|p| p.unrealized_pnl).sum();
        port.total_value_usd = port.available_cash_usd + port.invested_usd + port.unrealized_pnl;
        port.updated_at      = chrono::Utc::now();
    } // write lock dropped

    // Process exits sequentially (each acquires its own write lock)
    for (pos_id, exit_price, reason, sell_pct) in exits {
        execute_exit(state, &pos_id, exit_price, &reason, sell_pct).await;
    }

    let snapshot = state.portfolio.read().clone();
    state.broadcast(WsMessage::PortfolioUpdate(snapshot)).await;
    Ok(())
}

// ── Exit handler ──────────────────────────────────────────────────────────────

async fn execute_exit(
    state: &Arc<AppState>,
    pos_id: &str,
    exit_price: f64,
    reason: &str,
    sell_pct: f64,
) {
    let paper_tag = if state.config.dry_run { "[PAPER] " } else { "" };

    // --- Sync block: mutate portfolio ---
    let outcome = {
        let mut port = state.portfolio.write();
        let pos = match port.positions.iter().find(|p| p.id == pos_id) {
            Some(p) => p.clone(),
            None => return, // already removed (e.g. SL and TP fired same cycle)
        };

        let qty_sold   = pos.quantity * sell_pct;
        let proceeds   = qty_sold * exit_price;
        let cost_basis = pos.invested_usd * sell_pct;
        let pnl        = proceeds - cost_basis;
        let fully_closed = sell_pct >= 1.0;

        port.available_cash_usd += proceeds;
        port.realized_pnl       += pnl;

        if pnl > 0.0 { port.win_count  += 1; }
        else         { port.loss_count += 1; }

        let total = port.win_count + port.loss_count;
        if total > 0 {
            port.win_rate_pct = port.win_count as f64 / total as f64 * 100.0;
        }

        if fully_closed {
            port.invested_usd -= pos.invested_usd;
            port.positions.retain(|p| p.id != pos_id);
        } else {
            // Partial exit: reduce quantity and cost basis proportionally
            if let Some(p) = port.positions.iter_mut().find(|p| p.id == pos_id) {
                p.quantity     *= 1.0 - sell_pct;
                p.invested_usd *= 1.0 - sell_pct;
            }
            port.invested_usd -= cost_basis;
        }

        port.recent_trades.insert(0, Trade {
            id:           uuid::Uuid::new_v4().to_string(),
            symbol:       pos.symbol.clone(),
            trade_type:   "Sell".into(),
            usd_value:    proceeds,
            pnl:          Some(pnl),
            tx_signature: None,
            executed_at:  chrono::Utc::now(),
        });
        port.recent_trades.truncate(100);
        port.total_value_usd = port.available_cash_usd + port.invested_usd;
        port.updated_at      = chrono::Utc::now();

        (pos.symbol.clone(), proceeds, pnl, fully_closed)
    }; // write lock dropped

    let (symbol, proceeds, pnl, fully_closed) = outcome;
    let sign  = if pnl >= 0.0 { "+" } else { "" };
    let close = if fully_closed { "CLOSED" } else { "PARTIAL" };
    let msg = format!(
        "{}💰 {}: {} {} → ${:.2} USDC | PnL: {}{:.2}",
        paper_tag, reason, symbol, close, proceeds, sign, pnl
    );
    let level = if pnl >= 0.0 { AlertLevel::Profit } else { AlertLevel::Warning };
    info!("{}", msg);
    state.broadcast(WsMessage::Alert { level, message: msg.clone() }).await;
    state.broadcast(WsMessage::TradeExecuted(msg)).await;
}

use std::sync::Arc;
use anyhow::Result;
use chrono::Utc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn, error};


use crate::models::*;
use crate::state::AppState;
use crate::executor::TradeExecutor;


// Take profit ladder: (target_multiplier, sell_pct)
pub const TP_LADDER: &[(f64, f64)] = &[
    (1.50, 0.40), // +50%  → sell 40%
    (2.00, 0.30), // +100% → sell 30%
    (5.00, 0.20), // +400% → sell 20%
    (10.0, 0.10), // +900% → hold 10% moonbag (never auto-sell, manual)
];

pub async fn start_risk_monitor(state: Arc<AppState>) {
    info!("🛡  Risk monitor started");
    let executor = TradeExecutor::new(state.clone());

    loop {
        if let Err(e) = check_positions(&state, &executor).await {
            error!("Risk monitor error: {}", e);
        }
        sleep(Duration::from_secs(10)).await;
    }
}

async fn check_positions(state: &Arc<AppState>, executor: &TradeExecutor) -> Result<()> {
    let positions: Vec<Position> = state.portfolio.read().positions.clone();

    for position in positions {
        if position.status != PositionStatus::Open &&
           position.status != PositionStatus::PartiallyTaken {
            continue;
        }

        // Get current price
        let current_price = match executor.get_current_price(&position.pair_address).await {
            Ok(p) if p > 0.0 => p,
            _ => {
                warn!("Could not fetch price for {}", position.symbol);
                continue;
            }
        };

        let pnl_pct = (current_price - position.entry_price) / position.entry_price;

        // ── STOP LOSS CHECK ──────────────────────────────────────────────────
        if current_price <= position.stop_loss_price {
            warn!("🔻 STOP LOSS HIT: {} @ ${:.8} (entry: ${:.8}, loss: {:.1}%)",
                  position.symbol, current_price, position.entry_price, pnl_pct * 100.0);

            match executor.sell(&position, 1.0).await {
                Ok(trade) => {
                    let pnl = trade.pnl.unwrap_or(0.0);
                    apply_close(&state, &position, trade, PositionStatus::StopLossHit).await;
                    state.broadcast(WsMessage::Alert {
                        level: AlertLevel::Warning,
                        message: format!("🔻 STOP LOSS: {} — Loss ${:.2}", position.symbol, pnl),
                    }).await;
                    send_telegram(&state, &format!("🔻 STOP LOSS: {} @ ${:.8}\nLoss: ${:.2}", 
                        position.symbol, current_price, pnl)).await;
                }
                Err(e) => error!("Stop loss sell failed: {}", e),
            }
            continue;
        }

        // ── TAKE PROFIT CHECKS ────────────────────────────────────────────────
        for (level_idx, (target_mult, sell_pct)) in TP_LADDER.iter().enumerate() {
            let tp = &position.take_profit_levels[level_idx];
            if tp.hit { continue; } // Already taken

            if current_price >= position.entry_price * target_mult {
                let gain_pct = (target_mult - 1.0) * 100.0;
                info!("💰 TAKE PROFIT {}: {} @ ${:.8} (+{:.0}%)",
                      level_idx + 1, position.symbol, current_price, gain_pct);

                // Level 4 = moonbag, never auto-sell
                if level_idx == 3 {
                    mark_tp_hit(state, &position, level_idx).await;
                    state.broadcast(WsMessage::Alert {
                        level: AlertLevel::Profit,
                        message: format!("🌙 MOONBAG: {} reached {}x!", position.symbol, target_mult),
                    }).await;
                    break;
                }

                match executor.sell(&position, *sell_pct).await {
                    Ok(trade) => {
                        let pnl = trade.pnl.unwrap_or(0.0);
                        mark_tp_hit(state, &position, level_idx).await;
                        apply_partial_sell(state, &position, &trade, *sell_pct).await;
                        state.broadcast(WsMessage::TradeExecuted(trade.clone())).await;
                        state.broadcast(WsMessage::Alert {
                            level: AlertLevel::Profit,
                            message: format!("💰 TP{}: {} +{:.0}% — Profit ${:.2}",
                                level_idx + 1, position.symbol, gain_pct, pnl),
                        }).await;
                        send_telegram(&state, &format!(
                            "💰 TP{} HIT: {} @ ${:.8}\n+{:.0}% — Profit: ${:.2}",
                            level_idx + 1, position.symbol, current_price, gain_pct, pnl)).await;
                    }
                    Err(e) => error!("TP sell failed: {}", e),
                }
                break; // Only one TP level per cycle
            }
        }

        // ── TRAILING STOP (bonus protection after TP1 hit) ────────────────────
        let tp1_hit = position.take_profit_levels.first().map(|t| t.hit).unwrap_or(false);
        if tp1_hit && pnl_pct > 0.30 {
            // After TP1, raise stop loss to break-even + 10%
            let new_sl = position.entry_price * 1.10;
            if position.stop_loss_price < new_sl {
                update_stop_loss(state, &position, new_sl).await;
                info!("📈 Trailing SL updated for {}: ${:.8}", position.symbol, new_sl);
            }
        }

        // Broadcast price update
        state.broadcast(WsMessage::PriceUpdate {
            pair_address: position.pair_address.clone(),
            price:        current_price,
            change_pct:   pnl_pct * 100.0,
        }).await;
    }

    // Broadcast full portfolio update
    let portfolio = state.portfolio.read().clone();
    state.broadcast(WsMessage::PortfolioUpdate(portfolio)).await;

    Ok(())
}

// ─── STATE MUTATIONS ──────────────────────────────────────────────────────────

pub async fn open_position(
    state: &Arc<AppState>,
    token: &ScoredToken,
    trade: &Trade,
) -> Position {
    let config = &state.config;
    let entry_price = trade.price;

    let tp_levels: Vec<TakeProfit> = TP_LADDER.iter().enumerate().map(|(i, (mult, sell_pct))| {
        TakeProfit {
            level:             (i + 1) as u8,
            target_multiplier: *mult,
            sell_pct:          *sell_pct,
            hit:               false,
            hit_at:            None,
        }
    }).collect();

    let position = Position {
        id:                  trade.position_id,
        symbol:              token.pair.base_token.symbol.clone(),
        mint_address:        token.pair.base_token.address.clone(),
        pair_address:        token.pair.pair_address.clone(),
        entry_price,
        quantity:            trade.quantity,
        invested_usd:        trade.usd_value,
        stop_loss_price:     entry_price * (1.0 - config.stop_loss_pct),
        take_profit_levels:  tp_levels,
        score_at_entry:      token.score,
        risk_level:          token.risk_level.clone(),
        status:              PositionStatus::Open,
        opened_at:           Utc::now(),
        closed_at:           None,
        realized_pnl:        0.0,
        tx_signature:        trade.tx_signature.clone(),
    };

    let mut portfolio = state.portfolio.write();
    portfolio.available_cash_usd -= trade.usd_value;
    portfolio.invested_usd       += trade.usd_value;
    portfolio.positions.push(position.clone());
    portfolio.recent_trades.push(trade.clone());
    if portfolio.recent_trades.len() > 100 {
        portfolio.recent_trades.drain(0..50);
    }
    portfolio.updated_at = Utc::now();
    recalc_portfolio(&mut portfolio);

    position
}

async fn apply_close(
    state: &Arc<AppState>,
    position: &Position,
    trade: Trade,
    _status: PositionStatus,
) {
    let pnl = trade.pnl.unwrap_or(0.0);
    let mut portfolio = state.portfolio.write();

    portfolio.available_cash_usd += trade.usd_value;
    portfolio.invested_usd = (portfolio.invested_usd - position.invested_usd).max(0.0);
    portfolio.realized_pnl += pnl;

    if pnl >= 0.0 { portfolio.win_count  += 1; }
    else          { portfolio.loss_count += 1; }

    portfolio.positions.retain(|p| p.id != position.id);
    portfolio.recent_trades.push(trade);
    if portfolio.recent_trades.len() > 100 {
        portfolio.recent_trades.drain(0..50);
    }
    portfolio.updated_at = Utc::now();
    recalc_portfolio(&mut portfolio);
}

async fn apply_partial_sell(
    state: &Arc<AppState>,
    position: &Position,
    trade: &Trade,
    sell_pct: f64,
) {
    let pnl = trade.pnl.unwrap_or(0.0);
    let mut portfolio = state.portfolio.write();

    portfolio.available_cash_usd += trade.usd_value;
    portfolio.invested_usd = (portfolio.invested_usd - position.invested_usd * sell_pct).max(0.0);
    portfolio.realized_pnl += pnl;

    if let Some(pos) = portfolio.positions.iter_mut().find(|p| p.id == position.id) {
        pos.quantity     *= 1.0 - sell_pct;
        pos.invested_usd *= 1.0 - sell_pct;
        pos.realized_pnl += pnl;
        pos.status       = PositionStatus::PartiallyTaken;
    }
    portfolio.recent_trades.push(trade.clone());
    portfolio.updated_at = Utc::now();
    recalc_portfolio(&mut portfolio);
}

async fn mark_tp_hit(state: &Arc<AppState>, position: &Position, level: usize) {
    let mut portfolio = state.portfolio.write();
    if let Some(pos) = portfolio.positions.iter_mut().find(|p| p.id == position.id) {
        if let Some(tp) = pos.take_profit_levels.get_mut(level) {
            tp.hit    = true;
            tp.hit_at = Some(Utc::now());
        }
    }
}

async fn update_stop_loss(state: &Arc<AppState>, position: &Position, new_sl: f64) {
    let mut portfolio = state.portfolio.write();
    if let Some(pos) = portfolio.positions.iter_mut().find(|p| p.id == position.id) {
        pos.stop_loss_price = new_sl;
    }
}

fn recalc_portfolio(portfolio: &mut Portfolio) {
    let total = portfolio.trades() + portfolio.win_count;
    portfolio.win_rate_pct = if total > 0 {
        portfolio.win_count as f64 / total as f64 * 100.0
    } else { 0.0 };
    portfolio.total_value_usd = portfolio.available_cash_usd + portfolio.invested_usd;
}

// ─── TELEGRAM ALERTS ─────────────────────────────────────────────────────────

pub async fn send_telegram(state: &Arc<AppState>, message: &str) {
    let (token, chat_id) = match (
        state.config.telegram_bot_token.as_ref(),
        state.config.telegram_chat_id.as_ref(),
    ) {
        (Some(t), Some(c)) => (t, c),
        _ => return,
    };

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML"
    });

    if let Err(e) = state.http.post(&url).json(&body).send().await {
        warn!("Telegram send failed: {}", e);
    }
}

// Dummy extension trait for portfolio
trait PortfolioExt {
    fn trades(&self) -> u32;
}
impl PortfolioExt for Portfolio {
    fn trades(&self) -> u32 { self.loss_count }
}

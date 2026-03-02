use std::sync::Arc;
use anyhow::Result;
use chrono::Utc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};

use crate::models::*;
use crate::state::AppState;

const DEX: &str = "https://api.dexscreener.com";
const BLACKLIST: &[&str] = &["SCAM","RUG","HONEYPOT","TEST","FAKE"];

// ─── SCANNER LOOP ─────────────────────────────────────────────────────────────

pub async fn start_scanner(state: Arc<AppState>) {
    info!("🔍 Scanner started");
    let mut cycle = 0u32;
    loop {
        match cycle % 4 {
            0 => { if let Err(e) = fetch_boosted(&state).await   { warn!("boosted: {}", e); } }
            1 => { if let Err(e) = fetch_profiles(&state).await  { warn!("profiles: {}", e); } }
            2 => { if let Err(e) = fetch_gainers(&state).await   { warn!("gainers: {}", e); } }
            _ => { if let Err(e) = fetch_searches(&state).await  { warn!("search: {}", e); } }
        }
        cycle += 1;
        sleep(Duration::from_secs(20)).await;
    }
}

// ─── DATA SOURCES ─────────────────────────────────────────────────────────────

/// Boosted/trending tokens — paid promotions, often have volume
async fn fetch_boosted(state: &Arc<AppState>) -> Result<usize> {
    let body: serde_json::Value = state.http
        .get(format!("{}/token-boosts/top/v1", DEX))
        .send().await?.json().await?;

    let addrs: Vec<String> = body.as_array().unwrap_or(&vec![])
        .iter()
        .filter(|x| x["chainId"].as_str().unwrap_or("") == "solana")
        .filter_map(|x| x["tokenAddress"].as_str().map(String::from))
        .take(20).collect();

    let pairs = fetch_pairs_for_tokens(state, &addrs).await;
    let n = pairs.len();
    process_pairs(pairs, state).await;
    info!("🚀 {} boosted tokens", n);
    Ok(n)
}

/// Latest token profiles — newest listings on DexScreener
async fn fetch_profiles(state: &Arc<AppState>) -> Result<usize> {
    let body: serde_json::Value = state.http
        .get(format!("{}/token-profiles/latest/v1", DEX))
        .send().await?.json().await?;

    let addrs: Vec<String> = body.as_array().unwrap_or(&vec![])
        .iter()
        .filter(|x| x["chainId"].as_str().unwrap_or("") == "solana")
        .filter_map(|x| x["tokenAddress"].as_str().map(String::from))
        .take(20).collect();

    let pairs = fetch_pairs_for_tokens(state, &addrs).await;
    let n = pairs.len();
    process_pairs(pairs, state).await;
    info!("🆕 {} latest profiles", n);
    Ok(n)
}

/// Wide keyword sweep — no single keyword, cast wide net
async fn fetch_gainers(state: &Arc<AppState>) -> Result<usize> {
    let terms = ["sol","pump","moon","inu","pepe","ai","cat","dog","baby","trump"];
    let mut all = Vec::new();
    for t in &terms {
        let url = format!("{}/latest/dex/search?q={}", DEX, t);
        if let Ok(resp) = state.http.get(&url).send().await {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let pairs: Vec<DexPair> = serde_json::from_value(
                    body["pairs"].clone()).unwrap_or_default();
                all.extend(pairs.into_iter().filter(|p| p.chain_id == "solana"));
            }
        }
        sleep(Duration::from_millis(150)).await;
    }
    let n = all.len();
    process_pairs(all, state).await;
    info!("📈 {} gainer pairs", n);
    Ok(n)
}

/// DEX-specific searches — raydium, orca, pumpfun
async fn fetch_searches(state: &Arc<AppState>) -> Result<usize> {
    let terms = ["raydium","orca","bonk","wif","pnut","goat","mew","popcat","fartcoin","jto"];
    let mut all = Vec::new();
    for t in &terms {
        let url = format!("{}/latest/dex/search?q={}", DEX, t);
        if let Ok(resp) = state.http.get(&url).send().await {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let pairs: Vec<DexPair> = serde_json::from_value(
                    body["pairs"].clone()).unwrap_or_default();
                all.extend(pairs.into_iter().filter(|p| p.chain_id == "solana"));
            }
        }
        sleep(Duration::from_millis(150)).await;
    }
    let n = all.len();
    process_pairs(all, state).await;
    info!("🎯 {} dex search pairs", n);
    Ok(n)
}

/// Fetch pair data for a list of token addresses
async fn fetch_pairs_for_tokens(state: &Arc<AppState>, addrs: &[String]) -> Vec<DexPair> {
    let mut all = Vec::new();
    for addr in addrs {
        let url = format!("{}/latest/dex/tokens/{}", DEX, addr);
        if let Ok(resp) = state.http.get(&url).send().await {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let pairs: Vec<DexPair> = serde_json::from_value(
                    data["pairs"].clone()).unwrap_or_default();
                all.extend(pairs);
            }
        }
        sleep(Duration::from_millis(80)).await;
    }
    all
}

// ─── PROCESS + SCORE ──────────────────────────────────────────────────────────

async fn process_pairs(pairs: Vec<DexPair>, state: &Arc<AppState>) {
    let filter = state.scan_filter.read().clone();
    let mut scored = Vec::new();
    let mut seen   = std::collections::HashSet::new();

    for pair in pairs {
        if !seen.insert(pair.pair_address.clone()) { continue; }

        // Only major quote tokens
        let quote = pair.quote_token.symbol.to_uppercase();
        if !["SOL","USDC","USDT"].contains(&quote.as_str()) { continue; }

        // Blacklist
        let sym = pair.base_token.symbol.to_uppercase();
        if BLACKLIST.iter().any(|b| sym.contains(b)) { continue; }

        let liq   = pair.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
        let vol   = pair.volume.as_ref().and_then(|v| v.h24).unwrap_or(0.0);
        let h1    = pair.price_change.as_ref().and_then(|p| p.h1).unwrap_or(0.0);
        let buys  = pair.txns.as_ref().and_then(|t| t.h1.as_ref()).map(|b| b.buys).unwrap_or(0);
        let age   = pair.pair_created_at.map(|c| {
            (Utc::now().timestamp_millis() - c) as f64 / 3_600_000.0
        }).unwrap_or(9999.0);

        // ── Apply frontend filter ──────────────────────────────────────────
        if liq  < filter.min_liquidity            { continue; }
        if vol  < filter.min_volume               { continue; }
        if age  > filter.max_age_hours            { continue; }
        if h1   < filter.max_price_drop           { continue; }
        if buys < filter.min_buys                 { continue; }
        if filter.only_new     && age > 24.0      { continue; }
        if filter.only_gainers && h1 <= 0.0       { continue; }
        if !filter.dex_filter.is_empty() {
            let dex = pair.dex_id.to_lowercase();
            if !filter.dex_filter.iter().any(|d| dex.contains(d)) { continue; }
        }

        let (score, signals) = score_token(&pair, age, liq, vol);
        if score < filter.min_score { continue; }

        let risk_level = if score >= 70 { RiskLevel::Safe }
            else if score >= 45         { RiskLevel::Moderate }
            else                        { RiskLevel::Degen };

        let available   = state.portfolio.read().available_cash_usd;
        let recommended = calc_position_size(score, available, &state.config);

        scored.push(ScoredToken {
            pair, score, risk_level, signals,
            recommended_position_usd: recommended,
            age_hours: age,
            scanned_at: Utc::now(),
        });
    }

    scored.sort_by(|a, b| b.score.cmp(&a.score));

    // Merge into token store, evict stale (>5min)
    {
        let mut tokens = state.tokens.write();
        for t in &scored { tokens.insert(t.pair.pair_address.clone(), t.clone()); }
        let now = Utc::now();
        tokens.retain(|_, v| (now - v.scanned_at).num_minutes() < 5);
    }

    if !scored.is_empty() {
        let top: Vec<ScoredToken> = scored.into_iter().take(100).collect();
        state.broadcast(WsMessage::TokenUpdate(top)).await;
    }
}

// ─── SCORING ENGINE ───────────────────────────────────────────────────────────

pub fn score_token(pair: &DexPair, age: f64, liq: f64, vol: f64) -> (u8, Vec<Signal>) {
    let mut score: i32 = 0;
    let mut sigs = Vec::new();

    // Liquidity (max 25)
    let ls = if liq >= 500_000.0 { 25 } else if liq >= 200_000.0 { 20 }
        else if liq >= 100_000.0 { 15 } else if liq >= 50_000.0  { 10 }
        else if liq >= 10_000.0  { 5  } else if liq >= 2_000.0   { 2  } else { -10 };
    score += ls;
    if ls >= 15 { sigs.push(sig(SignalKind::HighLiquidity,  &format!("Strong liq ${:.0}", liq), ls)); }
    if ls < 0   { sigs.push(sig(SignalKind::LowLiquidity,  &format!("Low liq ${:.0}", liq), ls)); }

    // Volume (max 20)
    let vs = if vol >= 1_000_000.0 { 20 } else if vol >= 500_000.0 { 16 }
        else if vol >= 100_000.0   { 12 } else if vol >= 50_000.0  { 8  }
        else if vol >= 10_000.0    { 4  } else if vol >= 1_000.0   { 1  } else { -5 };
    score += vs;
    if vs >= 12 { sigs.push(sig(SignalKind::HighVolume, &format!("Vol ${:.0}", vol), vs)); }

    // Momentum (max 25)
    if let Some(pc) = &pair.price_change {
        let h1  = pc.h1.unwrap_or(0.0);
        let h6  = pc.h6.unwrap_or(0.0);
        let ms = if h1 > 10.0 && h1 < 100.0 && h6 > 0.0 { 20 }
            else if h1 > 5.0  { 15 } else if h1 > 2.0   { 8  }
            else if h1 > 0.0  { 3  } else if h1 < -50.0 { -25}
            else if h1 < -30.0{ -15} else if h1 < -15.0 { -8 } else { 0 };
        score += ms;
        if ms >= 15 { sigs.push(sig(SignalKind::BullishMomentum, &format!("h1 +{:.1}%", h1), ms)); }
        if ms < -10 { sigs.push(sig(SignalKind::RugRisk, &format!("DUMP h1 {:.1}%", h1), ms)); }
        // Acceleration bonus
        let h24 = pc.h24.unwrap_or(0.0);
        if h1 > 0.0 && h24 > 0.0 && h1 > h24 / 3.0 {
            score += 5;
            sigs.push(sig(SignalKind::PriceAcceleration, "Accelerating momentum", 5));
        }
    }

    // Buy/sell ratio (max 20)
    if let Some(txns) = &pair.txns {
        if let Some(h1) = &txns.h1 {
            let rs = if h1.sells == 0 && h1.buys > 5 { 20 }
                else if h1.buys > 0 && h1.sells > 0 {
                    let r = h1.buys as f64 / h1.sells as f64;
                    if r > 3.0 { 20 } else if r > 2.0 { 14 } else if r > 1.5 { 8 }
                    else if r > 1.0 { 3 } else if r > 0.7 { 0 } else { -12 }
                } else { 0 };
            score += rs;
            if rs < 0 { sigs.push(sig(SignalKind::BuySellImbalance,
                &format!("Sells>{} buys>{}", h1.sells, h1.buys), rs)); }
        }
    }

    // Age (max 10)
    let as_ = if age < 0.5 { -20 } else if age < 1.0 { -10 } else if age < 3.0 { -3 }
        else if age < 6.0 { 3 } else if age < 24.0 { 7 } else if age < 72.0 { 10 } else { 5 };
    score += as_;
    if age < 1.0 { sigs.push(sig(SignalKind::NewToken,
        &format!("{:.0}min old — caution", age*60.0), as_)); }

    // Rug check
    if let (Some(mc), Some(lq)) = (pair.market_cap, pair.liquidity.as_ref().and_then(|l| l.usd)) {
        if mc > 0.0 && lq / mc < 0.01 {
            score -= 20;
            sigs.push(sig(SignalKind::SuspiciousActivity,
                &format!("Liq/MCap {:.2}%", lq/mc*100.0), -20));
        }
    }

    (score.clamp(0, 100) as u8, sigs)
}

fn sig(kind: SignalKind, msg: &str, w: i32) -> Signal {
    Signal { kind, message: msg.to_string(), weight: w as i8 }
}

pub fn calc_position_size(score: u8, available: f64, config: &AppConfig) -> f64 {
    let base = available * config.max_position_pct;
    let mult = if score >= 75 { 1.0 } else if score >= 60 { 0.7 }
               else if score >= 45 { 0.4 } else { 0.2 };
    (base * mult).min(available * 0.15).max(0.5)
}
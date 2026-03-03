use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};
use serde::Deserialize;

use crate::models::DexToken;
use crate::state::AppState;

// ── DexScreener API response types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct DexResponse {
    pairs: Option<Vec<DexPair>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DexPair {
    chain_id: String,
    pair_address: String,
    base_token: DexBaseToken,
    price_usd: Option<String>,
    liquidity: Option<DexLiquidity>,
    volume: Option<DexVolume>,
    price_change: Option<DexPriceChange>,
    txns: Option<DexTxns>,
    pair_created_at: Option<u64>,
    market_cap: Option<f64>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DexBaseToken {
    address: String,
    symbol: String,
}

#[derive(Debug, Deserialize)]
struct DexLiquidity { usd: Option<f64> }

#[derive(Debug, Deserialize)]
struct DexVolume { h24: Option<f64> }

#[derive(Debug, Deserialize)]
struct DexPriceChange {
    h1: Option<f64>,
    h24: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DexTxns { h1: Option<DexTxnCount> }

#[derive(Debug, Deserialize)]
struct DexTxnCount {
    buys: Option<u64>,
    sells: Option<u64>,
}

// ── Scoring ───────────────────────────────────────────────────────────────────

fn score_token(liq: f64, vol: f64, h1: f64, buys: u64, sells: u64, age_h: f64, mc: f64) -> u8 {
    let mut s: i32 = 0;

    if      liq > 500_000.0 { s += 25 }
    else if liq > 200_000.0 { s += 18 }
    else if liq > 100_000.0 { s += 12 }
    else if liq >  50_000.0 { s +=  7 }
    else if liq >  30_000.0 { s +=  3 }
    else                    { s -= 15 }

    if      vol > 1_000_000.0 { s += 20 }
    else if vol >   500_000.0 { s += 15 }
    else if vol >   100_000.0 { s += 10 }
    else if vol >    50_000.0 { s +=  5 }
    else if vol >    10_000.0 { s +=  2 }
    else                      { s -=  5 }

    if      h1 >  5.0 && h1 <  50.0 { s += 15 }
    else if h1 >  2.0 && h1 < 100.0 { s +=  8 }
    else if h1 >  0.0               { s +=  3 }
    else if h1 < -40.0              { s -= 20 }
    else if h1 < -20.0              { s -= 10 }

    let ratio = if sells > 0 { buys as f64 / sells as f64 } else { 2.0 };
    if      ratio > 3.0 { s += 18 }
    else if ratio > 2.0 { s += 12 }
    else if ratio > 1.5 { s +=  7 }
    else if ratio < 0.5 { s -= 15 }
    else if ratio < 0.8 { s -=  8 }

    if      age_h <  0.5 { s -= 30 }
    else if age_h <  1.0 { s -= 15 }
    else if age_h <  3.0 { s -=  5 }
    else if age_h < 72.0 { s +=  8 }

    if liq > 0.0 && mc > 0.0 && liq / mc < 0.01 { s -= 20 }

    s.max(0).min(100) as u8
}

fn risk_of(score: u8) -> &'static str {
    if score >= 70 { "SAFE" } else if score >= 45 { "MODERATE" } else { "DEGEN" }
}

// ── Phase detection ───────────────────────────────────────────────────────────

fn detect_phase(h1: f64, h24: f64, vol_h24: f64, buys: u64, sells: u64) -> String {
    let ratio = if sells > 0 { buys as f64 / sells as f64 } else { 3.0 };
    if h1 < -25.0 && ratio < 0.8                         { return "DUMP".into(); }
    if h1 < -5.0  && ratio < 0.9 && h24 > 10.0          { return "DISTRIBUTION".into(); }
    if h1 > 30.0  && ratio > 1.8 && vol_h24 > 100_000.0 { return "MANIA".into(); }
    if h1 > 5.0   && ratio > 1.2                         { return "AWARENESS".into(); }
    "STEALTH".into()
}

// ── Scanner loop ──────────────────────────────────────────────────────────────

// Queries are now stored in AppState::scan_queries so the frontend can
// read and update them without restarting the backend.

pub async fn start_scanner(state: Arc<AppState>) {
    info!("🔍 Scanner started — polling DexScreener every 30s");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default();
    let mut query_idx = 0usize;

    loop {
        // Read the current query list — lock must be dropped before any .await
        let maybe_query: Option<String> = {
            let queries = state.scan_queries.read();
            if queries.is_empty() { None }
            else { Some(queries[query_idx % queries.len()].clone()) }
        }; // lock dropped here

        let query = match maybe_query {
            None    => { sleep(Duration::from_secs(30)).await; continue; }
            Some(q) => q,
        };
        query_idx += 1;

        let url = format!(
            "https://api.dexscreener.com/latest/dex/search?q={}",
            urlencoding::encode(&query)
        );

        match client.get(&url).send().await {
            Err(e) => warn!("Scanner fetch error: {}", e),
            Ok(resp) => match resp.json::<DexResponse>().await {
                Err(e) => warn!("Scanner parse error: {}", e),
                Ok(data) => {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;

                    let tokens: Vec<DexToken> = data.pairs
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|p| p.chain_id == "solana")
                        .filter_map(|p| {
                            let liq   = p.liquidity.as_ref()?.usd?;
                            if liq < 5_000.0 { return None; }
                            let price: f64 = p.price_usd.as_deref()?.parse().ok()?;
                            if price <= 0.0 { return None; }
                            let vol   = p.volume.as_ref().and_then(|v| v.h24).unwrap_or(0.0);
                            let h1    = p.price_change.as_ref().and_then(|c| c.h1).unwrap_or(0.0);
                            let h24   = p.price_change.as_ref().and_then(|c| c.h24).unwrap_or(0.0);
                            let buys  = p.txns.as_ref().and_then(|t| t.h1.as_ref()).and_then(|h| h.buys).unwrap_or(0);
                            let sells = p.txns.as_ref().and_then(|t| t.h1.as_ref()).and_then(|h| h.sells).unwrap_or(0);
                            let mc    = p.market_cap.unwrap_or(0.0);
                            let age_h = p.pair_created_at.map(|ts| {
                                now_ms.saturating_sub(ts) as f64 / 3_600_000.0
                            }).unwrap_or(99.0);

                            let score = score_token(liq, vol, h1, buys, sells, age_h, mc);
                            if score < 20 { return None; }

                            let phase = detect_phase(h1, h24, vol, buys, sells);
                            Some(DexToken {
                                pair_address:     p.pair_address,
                                symbol:           p.base_token.symbol,
                                mint_address:     p.base_token.address,
                                price_usd:        price,
                                liquidity_usd:    liq,
                                volume_h24:       vol,
                                price_change_h1:  h1,
                                price_change_h24: h24,
                                buys_h1:          buys,
                                sells_h1:         sells,
                                age_hours:        age_h,
                                market_cap:       mc,
                                score,
                                risk_level:       risk_of(score).to_string(),
                                dex_url:          p.url.unwrap_or_default(),
                                phase,
                                rug_score:        None,
                                lp_locked_pct:    None,
                                mint_disabled:    None,
                                top10_pct:        None,
                                rug_flags:        Vec::new(),
                                boost_amount:     None,
                            })
                        })
                        .collect();

                    // Merge into accumulated pool (update price/score, preserve rug enrichment)
                    {
                        let mut pool = state.scanner_tokens.write();
                        for token in tokens {
                            if let Some(existing) = pool.iter_mut().find(|t| t.pair_address == token.pair_address) {
                                // Preserve rug enrichment set by rug_checker background task
                                let rug_score     = existing.rug_score;
                                let lp_locked_pct = existing.lp_locked_pct;
                                let mint_disabled = existing.mint_disabled;
                                let top10_pct     = existing.top10_pct;
                                let rug_flags     = std::mem::take(&mut existing.rug_flags);
                                let boost_amount  = existing.boost_amount;
                                *existing = token;
                                existing.rug_score     = rug_score;
                                existing.lp_locked_pct = lp_locked_pct;
                                existing.mint_disabled = mint_disabled;
                                existing.top10_pct     = top10_pct;
                                existing.rug_flags     = rug_flags;
                                existing.boost_amount  = boost_amount;
                            } else {
                                pool.push(token);
                            }
                        }
                        // Re-rank and keep the top 100 across all queries
                        pool.sort_by(|a, b| b.score.cmp(&a.score));
                        pool.truncate(100);
                    }
                    let count = state.scanner_tokens.read().len();
                    info!("📊 Scanner: {} tokens in pool (query: \"{}\")", count, query);
                }
            },
        }

        sleep(Duration::from_secs(30)).await;
    }
}

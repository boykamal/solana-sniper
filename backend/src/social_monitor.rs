use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};
use serde::Deserialize;

use crate::state::AppState;

// ── DexScreener token-boost API types ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoostEntry {
    token_address: String,
    chain_id: String,
    amount: Option<f64>,
}

// ── Background task ───────────────────────────────────────────────────────────

pub async fn start_social_monitor(state: Arc<AppState>) {
    info!("📣 Social monitor started — polling DexScreener boosts every 5 min");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("sodagar-sniper/1.0")
        .build()
        .unwrap_or_default();

    loop {
        let url = "https://api.dexscreener.com/token-boosts/top/v1";
        match client.get(url).send().await {
            Err(e) => warn!("Social monitor fetch error: {}", e),
            Ok(resp) => match resp.json::<Vec<BoostEntry>>().await {
                Err(e) => warn!("Social monitor parse error: {}", e),
                Ok(boosts) => {
                    // Build a map: mint_address → boost amount (Solana only)
                    let boost_map: std::collections::HashMap<String, f64> = boosts
                        .into_iter()
                        .filter(|b| b.chain_id == "solana")
                        .filter_map(|b| b.amount.map(|a| (b.token_address, a)))
                        .collect();

                    {
                        let mut tokens = state.scanner_tokens.write();
                        let mut updated = 0usize;
                        for t in tokens.iter_mut() {
                            if let Some(&amt) = boost_map.get(&t.mint_address) {
                                t.boost_amount = Some(amt);
                                updated += 1;
                            }
                        }
                        if updated > 0 {
                            info!("📣 Social: updated boost for {} tokens", updated);
                        }
                    }
                }
            },
        }

        sleep(Duration::from_secs(300)).await; // poll every 5 minutes
    }
}

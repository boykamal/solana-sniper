use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};
use serde::Deserialize;

use crate::state::AppState;

// ── Rugcheck API response types ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RugReport {
    pub score: Option<u64>,                      // 0-1000, higher = safer
    pub risks: Option<Vec<RugRisk>>,
    #[serde(rename = "topHolders")]
    pub top_holders: Option<Vec<TopHolder>>,
    pub markets: Option<Vec<RugMarket>>,
    #[serde(rename = "mintAuthority")]
    pub mint_authority: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct RugRisk {
    pub name: Option<String>,
    pub level: Option<String>,                   // "warn" | "danger"
}

#[derive(Debug, Deserialize)]
pub struct TopHolder {
    pub pct: Option<f64>,                        // decimal fraction (0.0–1.0)
}

#[derive(Debug, Deserialize)]
pub struct RugMarket {
    pub lp: Option<RugLp>,
}

#[derive(Debug, Deserialize)]
pub struct RugLp {
    #[serde(rename = "lpLockedPct")]
    pub lp_locked_pct: Option<f64>,
}

// ── Data extraction ───────────────────────────────────────────────────────────

/// Extract normalised fields from a raw Rugcheck report.
/// Returns: (rug_score 0-100, lp_locked_pct, mint_disabled, top10_pct_0_to_100, flags)
pub fn extract_rug_data(
    report: RugReport,
) -> (u8, Option<f64>, Option<bool>, Option<f64>, Vec<String>) {
    // score 0-1000 → normalise to 0-100
    let rug_score = report.score
        .map(|s| (s.min(1000) / 10) as u8)
        .unwrap_or(0);

    let lp_locked_pct = report.markets.as_ref()
        .and_then(|m| m.first())
        .and_then(|m| m.lp.as_ref())
        .and_then(|lp| lp.lp_locked_pct);

    // null mintAuthority means the mint authority has been revoked (good)
    let mint_disabled = report.mint_authority
        .as_ref()
        .map(|v| v.is_null());

    // topHolders pct is a decimal fraction → convert to %
    let top10_pct = report.top_holders.as_ref().map(|holders| {
        holders.iter().take(10)
            .filter_map(|h| h.pct)
            .sum::<f64>() * 100.0
    });

    let rug_flags: Vec<String> = report.risks
        .unwrap_or_default()
        .into_iter()
        .filter(|r| matches!(r.level.as_deref(), Some("danger") | Some("warn")))
        .filter_map(|r| r.name)
        .collect();

    (rug_score, lp_locked_pct, mint_disabled, top10_pct, rug_flags)
}

// ── Background task ───────────────────────────────────────────────────────────

pub async fn start_rug_checker(state: Arc<AppState>) {
    info!("🛡️  Rug checker started — enriching scanner tokens via Rugcheck API");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("sodagar-sniper/1.0")
        .build()
        .unwrap_or_default();

    loop {
        // Collect up to 8 tokens that still lack rug data (lock dropped immediately)
        let mints: Vec<(String, String)> = {
            let tokens = state.scanner_tokens.read();
            tokens.iter()
                .filter(|t| t.rug_score.is_none())
                .take(8)
                .map(|t| (t.mint_address.clone(), t.pair_address.clone()))
                .collect()
        };

        if mints.is_empty() {
            sleep(Duration::from_secs(60)).await;
            continue;
        }

        for (mint, pair_addr) in mints {
            let url = format!("https://api.rugcheck.xyz/v1/tokens/{}/report", mint);
            let result = client.get(&url).send().await;

            match result {
                Err(e) => warn!("Rugcheck error {}: {}", &mint[..8], e),
                Ok(resp) => {
                    if !resp.status().is_success() {
                        warn!("Rugcheck HTTP {} for {}", resp.status(), &mint[..8]);
                        // Mark with score=0 so we don't retry indefinitely
                        let mut tokens = state.scanner_tokens.write();
                        if let Some(t) = tokens.iter_mut().find(|t| t.pair_address == pair_addr) {
                            t.rug_score = Some(0);
                        }
                    } else {
                        match resp.json::<RugReport>().await {
                            Err(e) => warn!("Rugcheck parse {}: {}", &mint[..8], e),
                            Ok(report) => {
                                let (rug_score, lp_locked_pct, mint_disabled, top10_pct, rug_flags) =
                                    extract_rug_data(report);

                                {
                                    let mut tokens = state.scanner_tokens.write();
                                    if let Some(t) = tokens.iter_mut()
                                        .find(|t| t.pair_address == pair_addr)
                                    {
                                        t.rug_score     = Some(rug_score);
                                        t.lp_locked_pct = lp_locked_pct;
                                        t.mint_disabled = mint_disabled;
                                        t.top10_pct     = top10_pct;
                                        t.rug_flags     = rug_flags;
                                        info!(
                                            "🛡️  {} score={}/100 lp={:.0}% top10={:.0}% mint_disabled={:?}",
                                            t.symbol, rug_score,
                                            lp_locked_pct.unwrap_or(0.0),
                                            top10_pct.unwrap_or(0.0),
                                            mint_disabled,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ~1.5 s between calls to stay within Rugcheck rate limits
            sleep(Duration::from_millis(1500)).await;
        }

        // Wait before the next batch
        sleep(Duration::from_secs(30)).await;
    }
}

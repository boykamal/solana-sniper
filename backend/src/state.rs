use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::broadcast;
use chrono::Utc;

use crate::models::*;

pub struct AppState {
    pub config:      AppConfig,
    pub http:        reqwest::Client,
    pub portfolio:   RwLock<Portfolio>,
    pub tokens:      RwLock<std::collections::HashMap<String, ScoredToken>>,
    pub whales:      RwLock<Vec<WhaleActivity>>,
    pub scan_filter: RwLock<ScanFilter>,   // ← live filter from frontend
    pub tx:          broadcast::Sender<WsMessage>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Arc<Self> {
        let (tx, _) = broadcast::channel(512);

        let portfolio = Portfolio {
            total_capital_usd:  config.initial_capital_usd,
            available_cash_usd: config.initial_capital_usd,
            invested_usd:       0.0,
            unrealized_pnl:     0.0,
            realized_pnl:       0.0,
            total_value_usd:    config.initial_capital_usd,
            win_count:          0,
            loss_count:         0,
            win_rate_pct:       0.0,
            positions:          Vec::new(),
            recent_trades:      Vec::new(),
            updated_at:         Utc::now(),
        };

        // Seed filter from .env values if set, else use defaults
        let scan_filter = ScanFilter {
            min_liquidity: config.min_liquidity_usd,
            min_volume:    config.min_volume_24h,
            max_age_hours: config.max_age_hours,
            min_score:     config.min_score,
            ..ScanFilter::default()
        };

        Arc::new(Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .user_agent("SolanaSniper/1.0")
                .build()
                .expect("HTTP client init failed"),
            portfolio:   RwLock::new(portfolio),
            tokens:      RwLock::new(std::collections::HashMap::new()),
            whales:      RwLock::new(Vec::new()),
            scan_filter: RwLock::new(scan_filter),
            config,
            tx,
        })
    }

    pub async fn broadcast(&self, msg: WsMessage) {
        let _ = self.tx.send(msg);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsMessage> {
        self.tx.subscribe()
    }
}
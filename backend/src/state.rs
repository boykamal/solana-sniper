use crate::models::{AppConfig, Portfolio, WsMessage, DexToken};
use parking_lot::RwLock;
use std::sync::Arc;
use tokio::sync::broadcast::{self, Sender};

pub const DEFAULT_SCAN_QUERIES: &[&str] = &[
    // Tier 1: narrative-agnostic broad sweep
    "solana",
    "solana new",
    "sol",
    // Tier 2: current active narratives
    "solana ai agent",
    "solana defi",
    "solana gaming",
    "solana rwa",
    "solana pump",
    // Tier 3: evergreen meme narratives
    "solana meme",
    "solana dog cat",
    "solana pepe frog",
];

pub struct AppState {
    pub config: AppConfig,
    pub portfolio: RwLock<Portfolio>,
    pub scanner_tokens: RwLock<Vec<DexToken>>,
    pub scan_queries: RwLock<Vec<String>>,
    tx: Sender<WsMessage>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Arc<Self> {
        let initial = Portfolio {
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
            updated_at:         chrono::Utc::now(),
            is_paper_trade:     config.dry_run,
        };
        let (tx, _rx) = broadcast::channel(128);
        Arc::new(Self {
            config,
            portfolio:      RwLock::new(initial),
            scanner_tokens: RwLock::new(Vec::new()),
            scan_queries:   RwLock::new(DEFAULT_SCAN_QUERIES.iter().map(|s| s.to_string()).collect()),
            tx,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsMessage> {
        self.tx.subscribe()
    }

    pub async fn broadcast(&self, msg: WsMessage) {
        let _ = self.tx.send(msg);
    }
}

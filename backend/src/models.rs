use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── App Config ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub dry_run: bool,
    pub initial_capital_usd: f64,
    pub max_position_pct: f64,
    pub stop_loss_pct: f64,
    pub max_open_positions: usize,
    pub auto_trading_enabled: bool,
    pub auto_buy_pct_capital: f64,
    pub auto_buy_min_score: u8,
    pub auto_buy_interval_secs: u64,
    pub auto_buy_max_per_trade: f64,
    pub min_rug_score: u8,           // 0 = bypass rug gate; >0 = require Rugcheck score ≥ this
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            dry_run: std::env::var("DRY_RUN").unwrap_or_else(|_| "true".into()) == "true",
            initial_capital_usd: std::env::var("INITIAL_CAPITAL_USD").unwrap_or_else(|_| "100.0".into()).parse()?,
            max_position_pct: std::env::var("MAX_POSITION_PCT").unwrap_or_else(|_| "0.10".into()).parse()?,
            stop_loss_pct: std::env::var("STOP_LOSS_PCT").unwrap_or_else(|_| "0.15".into()).parse()?,
            max_open_positions: std::env::var("MAX_OPEN_POSITIONS").unwrap_or_else(|_| "5".into()).parse()?,
            auto_trading_enabled: std::env::var("AUTO_TRADING_ENABLED").unwrap_or_else(|_| "false".into()) == "true",
            auto_buy_pct_capital: std::env::var("AUTO_BUY_PCT_CAPITAL").unwrap_or_else(|_| "0.05".into()).parse()?,
            auto_buy_min_score: std::env::var("AUTO_BUY_MIN_SCORE").unwrap_or_else(|_| "60".into()).parse()?,
            auto_buy_interval_secs: std::env::var("AUTO_BUY_INTERVAL_SECS").unwrap_or_else(|_| "30".into()).parse()?,
            auto_buy_max_per_trade: std::env::var("AUTO_BUY_MAX_PER_TRADE").unwrap_or_else(|_| "0.15".into()).parse()?,
            min_rug_score: std::env::var("MIN_RUG_SCORE").unwrap_or_else(|_| "0".into()).parse()?,
        })
    }
}

// ── Portfolio types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TakeProfitLevel {
    pub level: u8,
    pub target_multiplier: f64,  // e.g. 1.5 = +50%
    pub sell_pct: f64,           // fraction of position to sell at this TP
    pub hit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub symbol: String,
    pub mint_address: String,
    pub pair_address: String,
    pub entry_price: f64,
    pub current_price: f64,
    pub quantity: f64,
    pub invested_usd: f64,
    pub current_value_usd: f64,
    pub unrealized_pnl: f64,
    pub unrealized_pnl_pct: f64,
    pub stop_loss_price: f64,
    pub take_profit_levels: Vec<TakeProfitLevel>,
    pub risk_level: String,
    pub score_at_entry: u8,
    pub opened_at: DateTime<Utc>,
    pub decimals: u8,
    pub tx_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub trade_type: String,   // "Buy" | "Sell"
    pub usd_value: f64,
    pub pnl: Option<f64>,
    pub tx_signature: Option<String>,
    pub executed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Portfolio {
    pub total_capital_usd: f64,
    pub available_cash_usd: f64,
    pub invested_usd: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub total_value_usd: f64,
    pub win_count: u32,
    pub loss_count: u32,
    pub win_rate_pct: f64,
    pub positions: Vec<Position>,
    pub recent_trades: Vec<Trade>,
    pub updated_at: DateTime<Utc>,
    pub is_paper_trade: bool,
}

// ── Scanner token (shared between scanner + state) ────────────────────────────

fn default_phase() -> String { "STEALTH".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexToken {
    pub pair_address: String,
    pub symbol: String,
    pub mint_address: String,
    pub price_usd: f64,
    pub liquidity_usd: f64,
    pub volume_h24: f64,
    pub price_change_h1: f64,
    pub price_change_h24: f64,
    pub buys_h1: u64,
    pub sells_h1: u64,
    pub age_hours: f64,
    pub market_cap: f64,
    pub score: u8,
    pub risk_level: String,
    pub dex_url: String,
    // ── Market intelligence (phase + rug enrichment) ──────────────────────────
    #[serde(default = "default_phase")]
    pub phase: String,               // STEALTH | AWARENESS | MANIA | DISTRIBUTION | DUMP
    #[serde(default)]
    pub rug_score: Option<u8>,       // 0-100 (Rugcheck), higher = safer
    #[serde(default)]
    pub lp_locked_pct: Option<f64>,  // % of LP tokens locked
    #[serde(default)]
    pub mint_disabled: Option<bool>, // mint authority revoked
    #[serde(default)]
    pub top10_pct: Option<f64>,      // % held by top-10 wallets
    #[serde(default)]
    pub rug_flags: Vec<String>,      // risk flags from Rugcheck
    #[serde(default)]
    pub boost_amount: Option<f64>,   // DexScreener boost (social-attention proxy)
}

// ── WebSocket message types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    PortfolioUpdate(Portfolio),
    Alert { level: AlertLevel, message: String },
    TradeExecuted(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AlertLevel {
    Info,
    Warning,
    Critical,
    Profit,
}

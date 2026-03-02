use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── DEXSCREENER MODELS ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexPair {
    #[serde(rename = "chainId")]
    pub chain_id: String,
    #[serde(rename = "dexId")]
    pub dex_id: String,
    pub url: Option<String>,
    #[serde(rename = "pairAddress")]
    pub pair_address: String,
    #[serde(rename = "baseToken")]
    pub base_token: Token,
    #[serde(rename = "quoteToken")]
    pub quote_token: Token,
    #[serde(rename = "priceNative")]
    pub price_native: Option<String>,
    #[serde(rename = "priceUsd")]
    pub price_usd: Option<String>,
    pub txns: Option<Txns>,
    pub volume: Option<Volume>,
    #[serde(rename = "priceChange")]
    pub price_change: Option<PriceChange>,
    pub liquidity: Option<Liquidity>,
    #[serde(rename = "fdv")]
    pub fdv: Option<f64>,
    #[serde(rename = "marketCap")]
    pub market_cap: Option<f64>,
    #[serde(rename = "pairCreatedAt")]
    pub pair_created_at: Option<i64>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub address: String,
    pub name: String,
    pub symbol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Txns {
    pub m5: Option<BuySell>,
    pub h1: Option<BuySell>,
    pub h6: Option<BuySell>,
    pub h24: Option<BuySell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuySell {
    pub buys: i64,
    pub sells: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Volume {
    pub h24: Option<f64>,
    pub h6: Option<f64>,
    pub h1: Option<f64>,
    pub m5: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceChange {
    pub m5: Option<f64>,
    pub h1: Option<f64>,
    pub h6: Option<f64>,
    pub h24: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Liquidity {
    pub usd: Option<f64>,
    pub base: Option<f64>,
    pub quote: Option<f64>,
}

// ─── SCORED TOKEN ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredToken {
    pub pair: DexPair,
    pub score: u8,
    pub risk_level: RiskLevel,
    pub signals: Vec<Signal>,
    pub recommended_position_usd: f64,
    pub age_hours: f64,
    pub scanned_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum RiskLevel {
    Safe,
    Moderate,
    Degen,
    Blacklisted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    pub kind: SignalKind,
    pub message: String,
    pub weight: i8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SignalKind {
    BullishMomentum,
    WhaleBuy,
    HighLiquidity,
    LowLiquidity,
    HighVolume,
    SuspiciousActivity,
    NewToken,
    RugRisk,
    BuySellImbalance,
    PriceAcceleration,
}

// ─── POSITION / TRADE ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: Uuid,
    pub symbol: String,
    pub mint_address: String,
    pub pair_address: String,
    pub entry_price: f64,
    pub quantity: f64,
    pub invested_usd: f64,
    pub stop_loss_price: f64,
    pub take_profit_levels: Vec<TakeProfit>,
    pub score_at_entry: u8,
    pub risk_level: RiskLevel,
    pub status: PositionStatus,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub realized_pnl: f64,
    pub tx_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PositionStatus {
    Open,
    PartiallyTaken,
    Closed,
    StopLossHit,
    Liquidated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TakeProfit {
    pub level: u8,
    pub target_multiplier: f64,
    pub sell_pct: f64,
    pub hit: bool,
    pub hit_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Uuid,
    pub position_id: Uuid,
    pub trade_type: TradeType,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub usd_value: f64,
    pub fee_usd: f64,
    pub pnl: Option<f64>,
    pub tx_signature: Option<String>,
    pub executed_at: DateTime<Utc>,
    pub execution_source: ExecutionSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TradeType {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExecutionSource {
    Jupiter,
    Raydium,
    PumpFun,
}

// ─── PORTFOLIO ───────────────────────────────────────────────────────────────

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
}

// ─── WHALE ACTIVITY ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhaleActivity {
    pub id: Uuid,
    pub wallet_address: String,
    pub action: WhaleAction,
    pub token_mint: String,
    pub token_symbol: String,
    pub amount_usd: f64,
    pub token_amount: f64,
    pub price_impact_pct: f64,
    pub signature: String,
    pub detected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum WhaleAction {
    Buy,
    Sell,
    AddLiquidity,
    RemoveLiquidity,
}



// ─── CONFIG ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub rpc_endpoint: String,
    pub rpc_ws_endpoint: String,
    pub initial_capital_usd: f64,
    pub max_position_pct: f64,
    pub stop_loss_pct: f64,
    pub min_liquidity_usd: f64,
    pub min_volume_24h: f64,
    pub max_age_hours: f64,
    pub min_score: u8,
    pub max_open_positions: usize,
    pub slippage_bps: u32,
    pub priority_fee_lamports: u64,
    pub telegram_bot_token: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub dry_run: bool,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenv::dotenv().ok();
        Ok(Self {
            rpc_endpoint:         std::env::var("RPC_ENDPOINT").unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into()),
            rpc_ws_endpoint:      std::env::var("RPC_WS_ENDPOINT").unwrap_or_else(|_| "wss://api.mainnet-beta.solana.com".into()),
            initial_capital_usd:  std::env::var("INITIAL_CAPITAL_USD").unwrap_or_else(|_| "100.0".into()).parse()?,
            max_position_pct:     std::env::var("MAX_POSITION_PCT").unwrap_or_else(|_| "0.10".into()).parse()?,
            stop_loss_pct:        std::env::var("STOP_LOSS_PCT").unwrap_or_else(|_| "0.15".into()).parse()?,
            min_liquidity_usd:    std::env::var("MIN_LIQUIDITY_USD").unwrap_or_else(|_| "30000.0".into()).parse()?,
            min_volume_24h:       std::env::var("MIN_VOLUME_24H").unwrap_or_else(|_| "10000.0".into()).parse()?,
            max_age_hours:        std::env::var("MAX_AGE_HOURS").unwrap_or_else(|_| "72.0".into()).parse()?,
            min_score:            std::env::var("MIN_SCORE").unwrap_or_else(|_| "45".into()).parse()?,
            max_open_positions:   std::env::var("MAX_OPEN_POSITIONS").unwrap_or_else(|_| "5".into()).parse()?,
            slippage_bps:         std::env::var("SLIPPAGE_BPS").unwrap_or_else(|_| "300".into()).parse()?,
            priority_fee_lamports:std::env::var("PRIORITY_FEE_LAMPORTS").unwrap_or_else(|_| "500000".into()).parse()?,
            telegram_bot_token:   std::env::var("TELEGRAM_BOT_TOKEN").ok(),
            telegram_chat_id:     std::env::var("TELEGRAM_CHAT_ID").ok(),
            dry_run:              std::env::var("DRY_RUN").unwrap_or_else(|_| "true".into()) == "true",
        })
    }
}

// ─── API RESPONSES ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None, timestamp: Utc::now() }
    }
    pub fn err(msg: impl Into<String>) -> ApiResponse<()> {
        ApiResponse { success: false, data: None, error: Some(msg.into()), timestamp: Utc::now() }
    }
}

// ─── WEBSOCKET BROADCAST ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WsMessage {
    TokenUpdate(Vec<ScoredToken>),
    PortfolioUpdate(Portfolio),
    WhaleAlert(WhaleActivity),
    TradeExecuted(Trade),
    Alert { level: AlertLevel, message: String },
    PriceUpdate { pair_address: String, price: f64, change_pct: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AlertLevel {
    Info,
    Warning,
    Critical,
    Profit,
}

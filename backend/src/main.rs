mod models;
mod state;
mod scanner;
mod executor;
mod risk;
mod api;

use std::net::SocketAddr;
use anyhow::Result;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use models::AppConfig;
use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    // ── LOGGING ───────────────────────────────────────────────────────────────
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into())
        ))
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    info!("╔═══════════════════════════════════════╗");
    info!("║       SOLANA SNIPER v1.0.0            ║");
    info!("║   Rust + Jupiter + Raydium + Pump     ║");
    info!("╚═══════════════════════════════════════╝");

    // ── CONFIG ─────────────────────────────────────────────────────────────────
    let config = AppConfig::from_env()?;

    if config.dry_run {
        warn!("⚠️  DRY RUN MODE — No real trades will be executed");
        warn!("   Set DRY_RUN=false in .env to go live");
    } else {
        info!("🔴 LIVE TRADING MODE — Wallet signing via frontend");
    }

    info!("💰 Initial capital: ${:.2}", config.initial_capital_usd);
    info!("📊 Max position: {:.0}%", config.max_position_pct * 100.0);
    info!("🛑 Stop loss: {:.0}%", config.stop_loss_pct * 100.0);
    info!("🔢 Max open positions: {}", config.max_open_positions);

    // ── STATE ─────────────────────────────────────────────────────────────────
    let state = AppState::new(config);

    // ── BACKGROUND TASKS ──────────────────────────────────────────────────────

    // Scanner: poll DexScreener every 30s
    let scanner_state = state.clone();
    tokio::spawn(async move {
        scanner::start_scanner(scanner_state).await;
    });

    // Risk monitor: check TP/SL every 10s
    let risk_state = state.clone();
    tokio::spawn(async move {
        risk::start_risk_monitor(risk_state).await;
    });

    // ── HTTP / WS SERVER ──────────────────────────────────────────────────────
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()?;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let router = api::build_router(state);

    info!("🚀 Server listening on http://0.0.0.0:{}", port);
    info!("📡 WebSocket: ws://0.0.0.0:{}/ws", port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;

    Ok(())
}

mod models;
mod state;
mod scanner;
mod risk;
mod auto_trader;
mod rug_checker;
mod social_monitor;
mod api;

use std::net::SocketAddr;
use anyhow::Result;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use models::AppConfig;
use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into())
        ))
        .with(tracing_subscriber::fmt::layer().with_target(false).without_time())
        .init();

    info!("╔═══════════════════════════════════════╗");
    info!("║      SODAGAR SNIPER v1.0.0            ║");
    info!("║   Rust + Jupiter + Raydium + Pump     ║");
    info!("╚═══════════════════════════════════════╝");

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

    let state = AppState::new(config);

    let scan_state = state.clone();
    tokio::spawn(async move { scanner::start_scanner(scan_state).await; });
    let risk_state = state.clone();
    tokio::spawn(async move { risk::start_risk_monitor(risk_state).await; });
    let auto_state = state.clone();
    tokio::spawn(async move { auto_trader::start_auto_trader(auto_state).await; });
    let rug_state = state.clone();
    tokio::spawn(async move { rug_checker::start_rug_checker(rug_state).await; });
    let social_state = state.clone();
    tokio::spawn(async move { social_monitor::start_social_monitor(social_state).await; });

    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "8080".into()).parse()?;
    let addr = SocketAddr::from(([0,0,0,0], port));
    let router = api::build_router(state);
    info!("🚀 Server listening on http://0.0.0.0:{}", port);
    info!("📡 WebSocket: ws://0.0.0.0:{}/ws", port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;
    Ok(())
}

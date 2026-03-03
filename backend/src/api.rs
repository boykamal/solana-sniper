use std::sync::Arc;
use std::time::Duration;
use axum::{
    Router,
    routing::get,
    extract::{ws::{WebSocketUpgrade, WebSocket, Message}, Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use tower_http::cors::{CorsLayer, Any};

use crate::state::AppState;
use crate::models::WsMessage;
use tracing::info;

pub fn build_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health",          get(health))
        .route("/ws",              get(ws_handler))
        .route("/api/portfolio",   get(portfolio_handler))
        .route("/api/tokens",      get(tokens_handler))
        .route("/api/config",      get(config_handler))
        .route("/api/scan-filter",  get(scan_filter_get).post(scan_filter_post))
        .route("/api/scan-queries", get(scan_queries_get).post(scan_queries_post))
        .route("/api/rug/:mint",    get(rug_handler))

        .layer(cors)
        .with_state(state)
}

// ── Health ────────────────────────────────────────────────────────────────────

async fn health() -> &'static str { "ok" }

// ── Portfolio ─────────────────────────────────────────────────────────────────

async fn portfolio_handler(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let port = state.portfolio.read().clone();
    Json(json!({ "data": port }))
}

// ── Tokens (scanner results) ──────────────────────────────────────────────────

async fn tokens_handler(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let tokens = state.scanner_tokens.read().clone();
    Json(json!({ "data": tokens }))
}

// ── Config ────────────────────────────────────────────────────────────────────

async fn config_handler(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    Json(json!({
        "data": {
            "dry_run":                state.config.dry_run,
            "auto_trading_enabled":   state.config.auto_trading_enabled,
            "initial_capital_usd":    state.config.initial_capital_usd,
            "auto_buy_min_score":     state.config.auto_buy_min_score,
            "auto_buy_pct_capital":   state.config.auto_buy_pct_capital,
            "max_open_positions":     state.config.max_open_positions,
            "stop_loss_pct":          state.config.stop_loss_pct,
            "max_position_pct":       state.config.max_position_pct,
        }
    }))
}

// ── Scan filter (stub — filters applied in frontend scanner) ──────────────────

async fn scan_filter_get() -> impl IntoResponse {
    Json(json!({ "data": null }))
}

async fn scan_filter_post(
    Json(_body): Json<serde_json::Value>,
) -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

// ── Scan queries — readable/writable from the frontend ────────────────────────

async fn scan_queries_get(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let queries = state.scan_queries.read().clone();
    Json(json!({ "data": queries }))
}

async fn scan_queries_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Some(arr) = body.get("queries").and_then(|v| v.as_array()) {
        let queries: Vec<String> = arr.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .filter(|s| !s.trim().is_empty())
            .collect();
        if !queries.is_empty() {
            *state.scan_queries.write() = queries;
            info!("📝 Scan queries updated via API");
        }
    }
    Json(json!({ "ok": true }))
}

// ── Rug check — on-demand fetch with cache ────────────────────────────────────

async fn rug_handler(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Json<serde_json::Value> {
    // Return cached data if the token was already enriched by rug_checker
    let cached = {
        let tokens = state.scanner_tokens.read();
        tokens.iter()
            .find(|t| t.mint_address == mint)
            .filter(|t| t.rug_score.is_some())
            .map(|t| json!({
                "rug_score":    t.rug_score,
                "lp_locked_pct": t.lp_locked_pct,
                "mint_disabled": t.mint_disabled,
                "top10_pct":    t.top10_pct,
                "rug_flags":    &t.rug_flags,
                "boost_amount": t.boost_amount,
                "phase":        &t.phase,
                "cached":       true,
            }))
    };
    if let Some(data) = cached {
        return Json(json!({ "data": data }));
    }

    // Fetch fresh from Rugcheck API
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("sodagar-sniper/1.0")
        .build()
        .unwrap_or_default();
    let url = format!("https://api.rugcheck.xyz/v1/tokens/{}/report", mint);

    let resp = match client.get(&url).send().await {
        Err(e)  => return Json(json!({ "error": e.to_string() })),
        Ok(r)   => r,
    };
    if !resp.status().is_success() {
        return Json(json!({ "error": format!("Rugcheck HTTP {}", resp.status()) }));
    }
    let report = match resp.json::<crate::rug_checker::RugReport>().await {
        Err(e)  => return Json(json!({ "error": e.to_string() })),
        Ok(r)   => r,
    };

    let (rug_score, lp_locked_pct, mint_disabled, top10_pct, rug_flags) =
        crate::rug_checker::extract_rug_data(report);

    // Update cache in scanner_tokens if the token is already in the pool
    {
        let mut tokens = state.scanner_tokens.write();
        if let Some(t) = tokens.iter_mut().find(|t| t.mint_address == mint) {
            t.rug_score     = Some(rug_score);
            t.lp_locked_pct = lp_locked_pct;
            t.mint_disabled = mint_disabled;
            t.top10_pct     = top10_pct;
            t.rug_flags     = rug_flags.clone();
        }
    }

    Json(json!({
        "data": {
            "rug_score":    rug_score,
            "lp_locked_pct": lp_locked_pct,
            "mint_disabled": mint_disabled,
            "top10_pct":    top10_pct,
            "rug_flags":    rug_flags,
            "cached":       false,
        }
    }))
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

async fn ws_handler(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    info!("🔌 WS client connected");
    let mut rx = state.subscribe();

    // Push current portfolio snapshot immediately on connect
    {
        let port = state.portfolio.read().clone();
        let msg  = serde_json::to_string(&WsMessage::PortfolioUpdate(port)).unwrap_or_default();
        if socket.send(Message::Text(msg)).await.is_err() {
            return;
        }
    }

    while let Ok(ws_msg) = rx.recv().await {
        let json = match serde_json::to_string(&ws_msg) {
            Ok(s)  => s,
            Err(_) => continue,
        };
        if socket.send(Message::Text(json)).await.is_err() {
            break;
        }
    }
}

use std::sync::Arc;
use axum::{
    Router,
    routing::{get, post, delete},
    extract::{State, Path, Query, WebSocketUpgrade},
    response::{IntoResponse, Response},
    Json,
    http::StatusCode,
};
use axum::extract::ws::{WebSocket, Message};
use tower_http::cors::{CorsLayer, Any};
use serde::Deserialize;
use tracing::{info, warn};
use uuid::Uuid;

use crate::models::*;
use crate::state::AppState;
use crate::executor::TradeExecutor;
use crate::risk::{open_position, send_telegram};
use crate::scanner::calc_position_size;

// ─── ROUTER ──────────────────────────────────────────────────────────────────

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Tokens
        .route("/api/tokens",                get(list_tokens))
        .route("/api/tokens/:pair",          get(get_token))
        // Portfolio
        .route("/api/portfolio",             get(get_portfolio))
        // Trades
        .route("/api/trade/buy",             post(execute_buy))
        .route("/api/trade/sell/:position_id", post(execute_sell))
        .route("/api/positions/:id/close",   delete(close_position))
        // Whales
        .route("/api/whales",                get(get_whales))
        // Config
        .route("/api/config",                get(get_config))
        // Scan filter
        .route("/api/scan-filter",           get(get_scan_filter))
        .route("/api/scan-filter",           post(update_scan_filter))
        // Health
        .route("/health",                    get(health))
        // WebSocket
        .route("/ws",                        get(ws_handler))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        )
        .with_state(state)
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TokensQuery {
    min_score:  Option<u8>,
    risk_level: Option<String>,
    limit:      Option<usize>,
}

async fn list_tokens(
    State(state): State<Arc<AppState>>,
    Query(q): Query<TokensQuery>,
) -> Json<ApiResponse<Vec<ScoredToken>>> {
    let tokens = state.tokens.read();
    let mut result: Vec<ScoredToken> = tokens.values()
        .filter(|t| {
            let score_ok = t.score >= q.min_score.unwrap_or(0);
            let risk_ok  = q.risk_level.as_ref().map_or(true, |r| {
                format!("{:?}", t.risk_level).to_uppercase() == r.to_uppercase()
            });
            score_ok && risk_ok
        })
        .cloned()
        .collect();
    result.sort_by(|a, b| b.score.cmp(&a.score));
    result.truncate(q.limit.unwrap_or(50));
    Json(ApiResponse::ok(result))
}

async fn get_token(
    State(state): State<Arc<AppState>>,
    Path(pair): Path<String>,
) -> impl IntoResponse {
    let tokens = state.tokens.read();
    match tokens.get(&pair) {
        Some(t) => Json(ApiResponse::ok(t.clone())).into_response(),
        None    => (StatusCode::NOT_FOUND, Json(ApiResponse::<()>::err("Token not found"))).into_response(),
    }
}

async fn get_portfolio(
    State(state): State<Arc<AppState>>,
) -> Json<ApiResponse<Portfolio>> {
    Json(ApiResponse::ok(state.portfolio.read().clone()))
}

#[derive(Deserialize)]
struct BuyRequest {
    pair_address: String,
    usd_amount:   Option<f64>, // if None, uses auto-sizing
}

async fn execute_buy(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BuyRequest>,
) -> impl IntoResponse {
    // Check position limits
    let (position_count, available_cash) = {
        let p = state.portfolio.read();
        (p.positions.len(), p.available_cash_usd)
    };

    if position_count >= state.config.max_open_positions {
        return (StatusCode::BAD_REQUEST,
                Json(ApiResponse::<()>::err("Max open positions reached"))).into_response();
    }

    // Find token
    let token = {
        let tokens = state.tokens.read();
        tokens.get(&req.pair_address).cloned()
    };

    let token = match token {
        Some(t) => t,
        None => {
            // Try fetching from DexScreener directly
            let url = format!("https://api.dexscreener.com/latest/dex/pairs/solana/{}", req.pair_address);
            match state.http.get(&url).send().await {
                Ok(r) => match r.json::<serde_json::Value>().await {
                    Ok(_data) => {
                        // Parse and score on-the-fly
                        return (StatusCode::NOT_FOUND,
                                Json(ApiResponse::<()>::err("Token not in scanner, fetching... retry in 30s"))).into_response();
                    }
                    Err(_) => return (StatusCode::NOT_FOUND,
                                      Json(ApiResponse::<()>::err("Token not found"))).into_response(),
                },
                Err(_) => return (StatusCode::NOT_FOUND,
                                   Json(ApiResponse::<()>::err("Token not found"))).into_response(),
            }
        }
    };

    // Check minimum score
    if token.score < state.config.min_score {
        return (StatusCode::BAD_REQUEST,
                Json(ApiResponse::<()>::err(format!("Token score {} below minimum {}", 
                                                     token.score, state.config.min_score)))).into_response();
    }

    let usd = req.usd_amount.unwrap_or_else(|| {
        calc_position_size(token.score, available_cash, &state.config)
    });

    if usd > available_cash {
        return (StatusCode::BAD_REQUEST,
                Json(ApiResponse::<()>::err("Insufficient cash"))).into_response();
    }

    let executor = TradeExecutor::new(state.clone());
    match executor.buy(&token, usd).await {
        Ok(trade) => {
            let position = open_position(&state, &token, &trade).await;
            send_telegram(&state, &format!(
                "⚡ BUY: {} @ ${:.8}\nSize: ${:.2} | Score: {}\nTx: {}",
                trade.symbol, trade.price, trade.usd_value, token.score,
                trade.tx_signature.as_deref().unwrap_or("N/A")
            )).await;
            state.broadcast(WsMessage::TradeExecuted(trade.clone())).await;
            info!("✅ BUY API: {} ${:.2}", trade.symbol, trade.usd_value);
            Json(ApiResponse::ok(serde_json::json!({
                "trade": trade,
                "position": position,
            }))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR,
                   Json(ApiResponse::<()>::err(e.to_string()))).into_response(),
    }
}

#[derive(Deserialize)]
struct SellRequest {
    sell_pct: Option<f64>, // 0.0 - 1.0, defaults to 1.0
}

async fn execute_sell(
    State(state): State<Arc<AppState>>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<SellRequest>,
) -> impl IntoResponse {
    let position = {
        let p = state.portfolio.read();
        p.positions.iter().find(|p| p.id == position_id).cloned()
    };

    let position = match position {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND,
                        Json(ApiResponse::<()>::err("Position not found"))).into_response(),
    };

    let sell_pct = req.sell_pct.unwrap_or(1.0).clamp(0.01, 1.0);
    let executor = TradeExecutor::new(state.clone());

    match executor.sell(&position, sell_pct).await {
        Ok(trade) => {
            info!("✅ SELL API: {} {:.0}%", position.symbol, sell_pct * 100.0);
            Json(ApiResponse::ok(trade)).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR,
                   Json(ApiResponse::<()>::err(e.to_string()))).into_response(),
    }
}

async fn close_position(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    execute_sell(
        State(state),
        Path(id),
        Json(SellRequest { sell_pct: Some(1.0) }),
    ).await
}

async fn get_whales(
    State(state): State<Arc<AppState>>,
) -> Json<ApiResponse<Vec<WhaleActivity>>> {
    Json(ApiResponse::ok(state.whales.read().clone()))
}

async fn get_config(
    State(state): State<Arc<AppState>>,
) -> Json<ApiResponse<serde_json::Value>> {
    let c = &state.config;
    Json(ApiResponse::ok(serde_json::json!({
        "dry_run":              c.dry_run,
        "initial_capital_usd": c.initial_capital_usd,
        "max_position_pct":    c.max_position_pct,
        "stop_loss_pct":       c.stop_loss_pct,
        "min_liquidity_usd":   c.min_liquidity_usd,
        "min_volume_24h":      c.min_volume_24h,
        "max_age_hours":       c.max_age_hours,
        "min_score":           c.min_score,
        "max_open_positions":  c.max_open_positions,
        "slippage_bps":        c.slippage_bps,
    })))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "version": "1.0.0" }))
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    info!("🔌 WS client connected");
    let mut rx = state.subscribe();

    // Send initial state
    {
        let portfolio = state.portfolio.read().clone();
        let msg = serde_json::to_string(&WsMessage::PortfolioUpdate(portfolio)).unwrap_or_default();
        if socket.send(Message::Text(msg)).await.is_err() { return; }
    }

    loop {
        match rx.recv().await {
            Ok(ws_msg) => {
                let json = match serde_json::to_string(&ws_msg) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                if socket.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("WS client lagged {} messages", n);
            }
            Err(_) => break,
        }
    }
    info!("🔌 WS client disconnected");
}

// ─── SCAN FILTER ──────────────────────────────────────────────────────────────

async fn get_scan_filter(
    State(state): State<Arc<AppState>>,
) -> Json<ApiResponse<ScanFilter>> {
    Json(ApiResponse::ok(state.scan_filter.read().clone()))
}

async fn update_scan_filter(
    State(state): State<Arc<AppState>>,
    Json(new_filter): Json<ScanFilter>,
) -> Json<ApiResponse<ScanFilter>> {
    info!("⚙ Scan filter updated: liq≥{} vol≥{} score≥{}",
        new_filter.min_liquidity, new_filter.min_volume, new_filter.min_score);
    *state.scan_filter.write() = new_filter.clone();
    Json(ApiResponse::ok(new_filter))
}
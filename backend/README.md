# ◈ SOLANA SNIPER PRO

> **Full-stack meme coin trading platform** — Rust backend + React dashboard + Docker deployment

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SOLANA SNIPER                            │
├──────────────┬──────────────────┬───────────────────────────┤
│  DATA LAYER  │  ENGINE LAYER    │   EXECUTION LAYER         │
│              │                  │                           │
│ DexScreener  │  Token Scorer    │  Jupiter V6 (primary)     │
│ REST API     │  Risk Manager    │  Raydium AMM              │
│ (30s poll)   │  TP/SL Monitor   │  Pump.fun sniper          │
│              │  (10s check)     │  Jito MEV ready           │
└──────────────┴──────────────────┴───────────────────────────┘
        │                │                    │
        └────────────────▼────────────────────┘
                   ┌──────────┐
                   │  Axum    │  Rust HTTP/WS server
                   │  API     │  port 8080
                   └────┬─────┘
                        │
              ┌─────────▼──────────┐
              │  React Dashboard   │  Vite + Recharts
              │  + WebSocket live  │  port 3000/80
              └────────────────────┘
                        │
              ┌─────────▼──────────┐
              │  Telegram Bot      │  Trade alerts
              └────────────────────┘
```

---

## 📁 File Structure

```
solana-sniper/
├── backend/                    # Rust engine
│   ├── src/
│   │   ├── main.rs             # Entry point, tokio runtime
│   │   ├── models.rs           # All data types
│   │   ├── state.rs            # Shared app state (Arc<RwLock>)
│   │   ├── scanner.rs          # DexScreener polling + scoring
│   │   ├── executor.rs         # Jupiter/Raydium/Pump.fun trades
│   │   ├── risk.rs             # Auto TP/SL + trailing stop
│   │   └── api.rs              # REST + WebSocket server
│   ├── Cargo.toml
│   └── Dockerfile
├── frontend/                   # React dashboard
│   ├── src/
│   │   ├── App.jsx             # Main dashboard
│   │   └── hooks/
│   │       └── useWebSocket.js # Live WS hook
│   ├── index.html
│   ├── vite.config.js
│   └── Dockerfile
├── nginx/
│   └── nginx.conf              # Reverse proxy + WS upgrade
├── docker-compose.yml          # Full stack deployment
├── .env.example                # Config template
├── setup.sh                    # One-command VPS setup
└── README.md
```

---

## 🚀 Quick Deploy on Contabo VPS

```bash
# 1. SSH into your VPS
ssh root@YOUR_VPS_IP

# 2. Clone repo
git clone https://github.com/yourusername/solana-sniper /opt/solana-sniper
cd /opt/solana-sniper

# 3. Run setup (installs Docker, builds everything)
chmod +x setup.sh
./setup.sh

# 4. Configure your wallet and RPC
nano .env
# Set: WALLET_PRIVATE_KEY, RPC_ENDPOINT

# 5. Restart with new config
docker compose restart

# 6. Open dashboard
# http://YOUR_VPS_IP
```

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `true` | **Start here!** No real trades |
| `WALLET_PRIVATE_KEY` | - | Base58 or JSON array |
| `RPC_ENDPOINT` | mainnet-beta | Use Helius for speed |
| `INITIAL_CAPITAL_USD` | 100 | Starting capital |
| `MAX_POSITION_PCT` | 0.10 | 10% max per trade |
| `STOP_LOSS_PCT` | 0.15 | -15% stop loss |
| `MIN_LIQUIDITY_USD` | 30000 | Skip thin tokens |
| `MIN_SCORE` | 60 | Minimum quality score |
| `SLIPPAGE_BPS` | 300 | 3% slippage tolerance |
| `TELEGRAM_BOT_TOKEN` | - | Optional: mobile alerts |

---

## 🧠 Scoring Algorithm (0-100)

| Factor | Max Points | Logic |
|---|---|---|
| Liquidity | 25 | >$500k = 25, <$5k = -10 |
| Volume 24h | 20 | >$1M = 20 |
| Buy/Sell Ratio | 20 | 3:1 buys = max score |
| Price Momentum | 20 | h1 > h24/4 = acceleration |
| Token Age | 10 | 6-72h sweet spot |
| Liq/MCap Ratio | -20 | <1% = manipulation flag |
| Extreme Dump | -40 | h1 < -50% = rug |

**Risk levels:**
- 🟢 70-100: SAFE — up to 10% capital
- 🟡 45-69: MODERATE — up to 6% capital  
- 🔴 0-44: DEGEN — up to 2% capital (use manually)

---

## 📊 Take Profit Strategy

| Level | Target | Sell |
|---|---|---|
| TP1 | +50% (1.5x) | 40% of position |
| TP2 | +100% (2x)  | 30% of position |
| TP3 | +400% (5x)  | 20% of position |
| 🌙  | +900% (10x) | Moonbag — never auto-sell |

After TP1 hit → trailing stop raised to entry +10%

---

## 🔌 API Endpoints

```
GET  /api/tokens?min_score=60&limit=50   # Scanned tokens
GET  /api/portfolio                       # Portfolio state
GET  /api/whales                          # Whale activity
GET  /api/config                          # Current config
POST /api/trade/buy                       # Execute buy
POST /api/trade/sell/:position_id         # Execute sell
DEL  /api/positions/:id/close             # Close position
GET  /ws                                  # Live WebSocket
GET  /health                              # Health check
```

---

## 🔑 Getting Your RPC (Recommended)

Free mainnet-beta RPC is rate-limited. For real trading:

1. **Helius** (best for Solana): https://helius.dev — 100k requests/day free
2. **QuickNode**: https://quicknode.com — fast, reliable
3. **Triton**: https://triton.one — premium, for serious traders

---

## ⚠️ Risk Warnings

- Meme coins can go to zero instantly (rug pulls, honeypots)
- Always start with `DRY_RUN=true` and verify behavior
- Never risk more than you can afford to lose completely
- Smart contract exploits can drain wallets instantly
- Use a dedicated hot wallet — **never** your main wallet
- The $100 starting capital is educational sizing

---

## 🛠 Development

```bash
# Backend local dev
cd backend
cargo run

# Frontend local dev  
cd frontend
npm install
npm run dev

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Rebuild after changes
docker compose up --build -d
```

---

## 📱 Telegram Alerts

1. Message @BotFather → `/newbot` → save token
2. Message @userinfobot → save your chat ID
3. Set in `.env`: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
4. You'll receive: buy signals, TP hits, stop losses, whale alerts

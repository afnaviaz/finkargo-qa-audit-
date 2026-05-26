#!/bin/bash
# ----------------------------------------------------------
# Playwright Runner - Flujo de pago
# Recibe: $1 = ENV_EXPORT path, $2 = SCRIPTS_DIR path
# ----------------------------------------------------------

ENV_EXPORT="${1:-}"
SCRIPTS_DIR="${2:-}"
MODE="${3:-happy_path}"

if [[ -z "$ENV_EXPORT" || -z "$SCRIPTS_DIR" ]]; then
    echo "⚠️ Uso: run_playwright.sh <ENV_EXPORT> <SCRIPTS_DIR> [mode]"
    exit 0
fi

# Extraer payment_link del environment exportado por Newman
# NOTA: pasar ENV_EXPORT como sys.argv[1] para que Git Bash traduzca el path Windows
PAYMENT_LINK=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        env = json.load(f)
    values = env.get('values', [])
    match = next((v['value'] for v in values if v['key'] == 'payment_link' and v['value']), None)
    print(match or '')
except Exception as e:
    sys.stderr.write('run_playwright: ' + str(e) + '\n')
    print('')
" "$ENV_EXPORT" 2>/dev/null)

if [[ "$MODE" == "stripe_oxxo" ]]; then
    echo "[$(date +'%H:%M:%S')] 🧾 Modo STRIPE OXXO — validando pago en dashboard Stripe..."
    export CI="true"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    export NEWMAN_ENV_FILE="$ENV_EXPORT"
    node "$SCRIPTS_DIR/playwright/run_stripe_validation.js" "$ENV_EXPORT" \
        || echo "[$(date +'%H:%M:%S')] ⚠️ Stripe OXXO Playwright terminó con errores (no bloquea el pipeline)"

elif [[ "$MODE" == "stripe_card" ]]; then
    echo "[$(date +'%H:%M:%S')] 💳 Modo STRIPE CARD — buscando stripe_checkout_url en environment..."
    export CI="true"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    node "$SCRIPTS_DIR/playwright/run_stripe_card_checkout.js" "$ENV_EXPORT" \
        || echo "[$(date +'%H:%M:%S')] ⚠️ Stripe Card Playwright terminó con errores (no bloquea el pipeline)"

elif [[ "$MODE" == "stripe_balance" ]]; then
    echo "[$(date +'%H:%M:%S')] 🏦 Modo STRIPE BALANCE RECURRING — aplicando pago externo en dashboard..."
    export CI="true"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    node "$SCRIPTS_DIR/playwright/run_stripe_balance_validate.js" "$ENV_EXPORT" \
        || echo "[$(date +'%H:%M:%S')] ⚠️ Stripe Balance Playwright terminó con errores (no bloquea el pipeline)"

elif [[ "$MODE" == "stripe_balance_onetime" ]]; then
    echo "[$(date +'%H:%M:%S')] 🏦 Modo STRIPE BALANCE ONE TIME — aplicando pago único en dashboard..."
    export CI="true"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    node "$SCRIPTS_DIR/playwright/run_stripe_onetime_validate.js" "$ENV_EXPORT" \
        || echo "[$(date +'%H:%M:%S')] ⚠️ Stripe Balance One Time Playwright terminó con errores (no bloquea el pipeline)"

elif [[ "$MODE" == "stripe_card_recurring" ]]; then
    echo "[$(date +'%H:%M:%S')] 🔄 Modo STRIPE CARD RECURRING EPAYMENTS — buscando stripe_checkout_url en environment..."
    export CI="true"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    node "$SCRIPTS_DIR/playwright/run_stripe_recurring_card_checkout.js" "$ENV_EXPORT" \
        || echo "[$(date +'%H:%M:%S')] ⚠️ Stripe Card Recurring Playwright terminó con errores (no bloquea el pipeline)"

elif [ -n "$PAYMENT_LINK" ]; then
    export PAYMENT_LINK="$PAYMENT_LINK"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    export CI="true"
    if [[ "$MODE" == "rejected" ]]; then
        echo "[$(date +'%H:%M:%S')] 🎭 Playwright REJECTED: abriendo link sin completar..."
        node "$SCRIPTS_DIR/playwright/payment_flow_rejected.js" "$PAYMENT_LINK" \
            || echo "[$(date +'%H:%M:%S')] ⚠️ Playwright REJECTED terminó con errores (no bloquea el pipeline)"
    else
        echo "[$(date +'%H:%M:%S')] 🎭 payment_link detectado. Iniciando Playwright..."
        node "$SCRIPTS_DIR/playwright/payment_flow.js" "$PAYMENT_LINK" \
            || echo "[$(date +'%H:%M:%S')] ⚠️ Playwright terminó con errores (no bloquea el pipeline)"
    fi
else
    echo "[$(date +'%H:%M:%S')] ℹ️ No se encontró payment_link. Saltando Playwright."
fi

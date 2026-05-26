#!/usr/bin/env python3
"""
validate_db_states.py — Valida estados en PostgreSQL después de Newman.
Uso: python3 validate_db_states.py <env_export_path> <pais> <ambiente>

Valida según escenario:
  SUPRA (happy_path / rejected / expired):
    - supra.exchange_quote  WHERE external_id = supra_quote_id → status CREATED
    - supra."transaction"   WHERE external_id = payin_id       → status PAID / REJECTED / EXPIRED
  EPAYMENTS (epayments_happy):
    - epayment."transaction" WHERE process_internal_id = payin_id → status SUCCESSFUL
"""
import json, sys, os

def get_db_config(pais, ambiente):
    suffix = f"{ambiente.upper()}_{pais.upper()}"
    return {
        'host':     os.environ.get(f'DB_HOST_{suffix}', ''),
        'port':     int(os.environ.get(f'DB_PORT_{suffix}', '').strip() or '5432'),
        'dbname':   os.environ.get(f'DB_NAME_{suffix}', ''),
        'user':     os.environ.get(f'DB_USER_{suffix}', ''),
        'password': os.environ.get(f'DB_PASSWORD_{suffix}', ''),
    }

def get_env_var(env_export_path, key):
    try:
        with open(env_export_path, encoding='utf-8') as f:
            env = json.load(f)
        values = env.get('values', [])
        match = next((v['value'] for v in values if v['key'] == key and v['value']), None)
        return match
    except Exception as e:
        sys.stderr.write(f'validate_db: error leyendo env export: {e}\n')
        return None

def write_result(output_path, ran, pais, ambiente, results):
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump({'ran': ran, 'pais': pais, 'ambiente': ambiente, 'results': results}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        sys.stderr.write(f'validate_db: error escribiendo resultado: {e}\n')

def main():
    if len(sys.argv) < 5:
        print('Uso: validate_db_states.py <env_export> <pais> <ambiente> <output_json>')
        sys.exit(1)

    env_export      = sys.argv[1]
    pais            = sys.argv[2]
    ambiente        = sys.argv[3]
    output_path     = sys.argv[4]
    scenario        = sys.argv[5] if len(sys.argv) > 5 else 'happy_path'

    supra_quote_id = get_env_var(env_export, 'supra_quote_id')
    payin_id       = get_env_var(env_export, 'payin_id')

    if not supra_quote_id and not payin_id:
        print('INFO No se encontraron IDs en el environment. Saltando validacion DB.')
        write_result(output_path, False, pais, ambiente, [])
        sys.exit(0)

    db_config = get_db_config(pais, ambiente)
    if not db_config['host']:
        print(f'INFO No hay configuracion DB para {pais}/{ambiente}. Saltando validacion.')
        write_result(output_path, False, pais, ambiente, [])
        sys.exit(0)

    try:
        import psycopg2
    except ImportError:
        print('WARN psycopg2 no instalado. Saltando validacion DB.')
        write_result(output_path, False, pais, ambiente, [])
        sys.exit(0)

    errors  = 0
    results = []

    try:
        import time
        conn = psycopg2.connect(**db_config)
        cur  = conn.cursor()

        print('')
        print('=' * 55)
        print('  VALIDACION DE ESTADOS - BASE DE DATOS')
        print(f'  Ambiente: {ambiente} | Pais: {pais} | Escenario: {scenario}')
        print('=' * 55)

        # ============================================================
        # EPAYMENTS: epayment."transaction" → status SUCCESSFUL
        # ============================================================
        if scenario == 'epayments_happy':
            if payin_id:
                POLL_INTERVAL = 15
                POLL_TIMEOUT  = 120
                elapsed       = 0
                status        = None

                print(f'INFO Esperando status SUCCESSFUL en epayment.transaction (timeout: {POLL_TIMEOUT}s)...')
                while elapsed <= POLL_TIMEOUT:
                    cur.execute(
                        'SELECT process_internal_id, status FROM epayment."transaction" WHERE process_internal_id = %s',
                        (payin_id,)
                    )
                    row = cur.fetchone()
                    if row:
                        status = row[1]
                        print(f'  [{elapsed}s] epayment.transaction status: {status}')
                        if status == 'SUCCESSFUL':
                            break
                        if status in ('FAILED', 'REJECTED', 'EXPIRED'):
                            break
                    else:
                        status = 'NOT FOUND'
                        break
                    time.sleep(POLL_INTERVAL)
                    elapsed += POLL_INTERVAL

                if status == 'SUCCESSFUL':
                    result = 'OK'
                elif status in ('NOT FOUND', 'FAILED', 'REJECTED', 'EXPIRED'):
                    result = 'FAIL'
                    errors += 1
                else:
                    result = 'WARN'  # Timeout, aún pendiente

                print(f'[{result}] epayment.transaction | process_internal_id: {payin_id[:12]}... | status: {status} (esperado: SUCCESSFUL)')
                results.append({'table': 'epayment.transaction', 'external_id': payin_id, 'status': status, 'expected': 'SUCCESSFUL', 'result': result})
            else:
                print('WARN No se encontró payin_id para validar epayment.transaction.')

        # ============================================================
        # SUPRA: exchange_quote + supra."transaction"
        # ============================================================
        else:
            expected_tx_status = {
                'happy_path': 'PAID',
                'rejected':   'REJECTED',
                'expired':    'EXPIRED',
            }.get(scenario, 'PAID')

            # --- 1. exchange_quote ---
            if supra_quote_id:
                cur.execute(
                    'SELECT external_id, status FROM supra.exchange_quote WHERE external_id = %s',
                    (supra_quote_id,)
                )
                row = cur.fetchone()
                if row:
                    status   = row[1]
                    expected = 'CREATED'
                    ok       = status == expected
                    result   = 'OK' if ok else 'FAIL'
                    print(f'[{result}] exchange_quote | external_id: {supra_quote_id[:12]}... | status: {status} (esperado: {expected})')
                    results.append({'table': 'exchange_quote', 'external_id': supra_quote_id, 'status': status, 'expected': expected, 'result': result})
                    if not ok:
                        errors += 1
                else:
                    print(f'[FAIL] exchange_quote | external_id: {supra_quote_id[:12]}... | NO ENCONTRADO en BD')
                    results.append({'table': 'exchange_quote', 'external_id': supra_quote_id, 'status': 'NOT FOUND', 'expected': 'CREATED', 'result': 'FAIL'})
                    errors += 1

            # --- 2. supra.transaction (polling) ---
            if payin_id:
                POLL_INTERVAL = 15
                POLL_TIMEOUT  = 300 if scenario == 'expired' else 120
                elapsed       = 0
                status        = None

                print(f'INFO Esperando status {expected_tx_status} en supra.transaction (timeout: {POLL_TIMEOUT}s)...')
                while elapsed <= POLL_TIMEOUT:
                    cur.execute(
                        'SELECT external_id, status FROM supra."transaction" WHERE external_id = %s',
                        (payin_id,)
                    )
                    row = cur.fetchone()
                    if row:
                        status = row[1]
                        print(f'  [{elapsed}s] transaction status: {status}')
                        if status == expected_tx_status:
                            break
                        if status in ('EXPIRED', 'REJECTED', 'PAID'):
                            break
                    else:
                        status = 'NOT FOUND'
                        break
                    time.sleep(POLL_INTERVAL)
                    elapsed += POLL_INTERVAL

                if status == expected_tx_status:
                    result = 'OK'
                elif status in ('CREATED', 'in_progress', 'pending'):
                    result = 'WARN'
                else:
                    result = 'FAIL'
                    errors += 1

                print(f'[{result}] supra.transaction | external_id: {payin_id[:12]}... | status: {status} (esperado: {expected_tx_status})')
                results.append({'table': 'transaction', 'external_id': payin_id, 'status': status, 'expected': expected_tx_status, 'result': result})

        print('=' * 55)
        cur.close()
        conn.close()

    except Exception as e:
        print(f'WARN Error conectando a BD ({pais}/{ambiente}): {e}')
        write_result(output_path, False, pais, ambiente, [])
        sys.exit(0)

    write_result(output_path, True, pais, ambiente, results)

    if errors > 0:
        print(f'WARN {errors} validacion(es) de BD fallaron.')
        sys.exit(2)
    else:
        print('OK Todas las validaciones de BD pasaron.')
        sys.exit(0)

if __name__ == '__main__':
    main()
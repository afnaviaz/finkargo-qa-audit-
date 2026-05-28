#!/usr/bin/env python3
"""
extract_metrics.py — Extrae métricas del reporte JSON de Newman.
Uso: python3 extract_metrics.py <newman_json_path> <metrics_output_path>
"""
import json, sys

def main():
    if len(sys.argv) < 3:
        print(f"Uso: {sys.argv[0]} <newman_json> <metrics_output>", file=sys.stderr)
        sys.exit(1)

    report_path  = sys.argv[1]
    metrics_path = sys.argv[2]

    try:
        with open(report_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: No se encontró {report_path}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: JSON inválido: {e}", file=sys.stderr)
        sys.exit(1)

    run      = data.get('run', {})
    stats    = run.get('stats', {})
    timings  = run.get('timings', {})
    failures = run.get('failures', [])

    total_requests  = stats.get('requests',   {}).get('total',  0)
    failed_requests = stats.get('requests',   {}).get('failed', 0)
    total_tests     = stats.get('assertions', {}).get('total',  0)
    failed_tests    = stats.get('assertions', {}).get('failed', 0)
    passed_tests    = total_tests - failed_tests
    started         = timings.get('started',   0)
    completed       = timings.get('completed', 0)
    duration_ms     = completed - started if completed and started else 0
    pass_rate       = round((passed_tests / total_tests * 100), 1) if total_tests > 0 else 0

    clean_failures = []
    for fail in failures:
        source  = fail.get('source', {})
        error   = fail.get('error',  {})
        req     = source.get('request', {})
        url_obj = req.get('url', {})
        url     = url_obj.get('raw', '') if isinstance(url_obj, dict) else str(url_obj)
        method  = req.get('method', 'N/A')
        clean_failures.append({
            "escenario": source.get('name', 'N/A'),
            "error":     error.get('message', 'N/A'),
            "test":      error.get('test', 'N/A'),
            "url":       url,
            "method":    method,
            "type":      "assertion" if error.get('name') == 'AssertionError' else "request"
        })

    # Desglose por endpoint desde run.executions
    endpoint_breakdown = []
    for execution in run.get('executions', []):
        item       = execution.get('item', {})
        name       = item.get('name', 'N/A')
        assertions = execution.get('assertions', [])
        total_ep   = len(assertions)
        failed_ep  = sum(1 for a in assertions if a.get('error') is not None)
        passed_ep  = total_ep - failed_ep

        req_ep     = execution.get('request', {})
        if not req_ep:
            resp_ep = execution.get('response', {})
            req_ep  = (resp_ep.get('originalRequest', {}) if isinstance(resp_ep, dict) else {})
        method_ep  = req_ep.get('method', '') if isinstance(req_ep, dict) else ''

        failed_tests_ep = [
            a.get('error', {}).get('message', 'N/A')
            for a in assertions if a.get('error') is not None
        ]

        endpoint_breakdown.append({
            "name":         name,
            "method":       method_ep,
            "total_tests":  total_ep,
            "passed_tests": passed_ep,
            "failed_tests": failed_ep,
            "status":       "PASS" if failed_ep == 0 else "FAIL",
            "errors":       failed_tests_ep,
        })

    metrics = {
        "total_requests":    total_requests,
        "failed_requests":   failed_requests,
        "total_tests":       total_tests,
        "passed_tests":      passed_tests,
        "failed_tests":      failed_tests,
        "pass_rate":         pass_rate,
        "duration_ms":       duration_ms,
        "duration_s":        round(duration_ms / 1000, 2),
        "status":            "PASS" if failed_tests == 0 else "FAIL",
        "failures":          clean_failures,
        "endpoint_breakdown": endpoint_breakdown,
    }

    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    # Resumen a stdout para el log
    status_icon = "✅" if failed_tests == 0 else "❌"
    print(f"  Requests : {total_requests} total / {failed_requests} fallidos")
    print(f"  Tests    : {total_tests} total / {passed_tests} pasaron / {failed_tests} fallaron")
    print(f"  Pass Rate: {pass_rate}%")
    print(f"  Duración : {round(duration_ms/1000,2)}s")
    print(f"  Estado   : {'PASS ' + status_icon if failed_tests == 0 else 'FAIL ' + status_icon}")

if __name__ == '__main__':
    main()
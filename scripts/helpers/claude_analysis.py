#!/usr/bin/env python3
"""
claude_analysis.py — Llama a Claude API para generar análisis de causa raíz.
Uso: python3 claude_analysis.py <metrics_json> <output_html> <proyecto> <folder> <pais> <ambiente> <timestamp>
"""
import json, subprocess, os, re, sys, tempfile

def call_claude(api_key: str, prompt: str, max_tokens: int = 4000) -> str:
    payload = {
        "model": "claude-sonnet-4-5",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }
    # Escribir payload a archivo temporal para evitar "Argument list too long" en Windows
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json',
                                     delete=False, encoding='utf-8') as tmp:
        json.dump(payload, tmp, ensure_ascii=False)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            ["curl", "-s", "--insecure", "--max-time", "60",
             "https://api.anthropic.com/v1/messages",
             "-H", f"x-api-key: {api_key}",
             "-H", "anthropic-version: 2023-06-01",
             "-H", "content-type: application/json",
             "--data", f"@{tmp_path}"],
            capture_output=True, 
            text=True,
            encoding='utf-8',
            errors='replace'
        )
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if result.returncode != 0:
        raise RuntimeError(f"curl falló (exit {result.returncode}): {result.stderr}")
    resp = json.loads(result.stdout)
    if "error" in resp:
        raise RuntimeError(f"API error: {resp['error'].get('message', str(resp['error']))}")
    return resp["content"][0]["text"]

def clean_html(raw: str) -> str:
    return re.sub(r'```html\s*|```\s*', '', raw).strip()

def build_success_html(metrics: dict) -> str:
    return f"""
<div style="font-family:'Segoe UI',Arial,sans-serif; padding:20px;">
  <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);
              border-left:5px solid #2e7d32; padding:16px 20px;
              border-radius:6px; margin-bottom:16px;">
    <h2 style="margin:0 0 8px; color:#1b5e20; font-size:18px;">
      ✅ Auditoría Exitosa — Sin Fallos Detectados
    </h2>
    <p style="margin:0; color:#2e7d32; font-size:14px;">
      Todos los escenarios pasaron las validaciones de contrato y seguridad.<br/>
      <strong>Pass Rate:</strong> {metrics.get('pass_rate', 0)}% &nbsp;|&nbsp;
      <strong>Tests:</strong> {metrics.get('total_tests', 0)} ejecutados &nbsp;|&nbsp;
      <strong>Duración:</strong> {metrics.get('duration_s', 0)}s
    </p>
  </div>
</div>"""

def build_rca_prompt(metrics: dict, proyecto: str, folder: str,
                     pais: str, ambiente: str, timestamp: str) -> str:
    failures = metrics.get('failures', [])
    return f"""Eres un Auditor Senior de QA especializado en APIs REST y microservicios financieros (Finkargo).

Contexto de ejecución:
- Proyecto  : {proyecto}
- Módulo    : {folder}
- País      : {pais}
- Ambiente  : {ambiente}
- Fecha     : {timestamp}
- Pass Rate : {metrics.get('pass_rate', 0)}%
- Fallados  : {metrics.get('failed_tests', 0)} de {metrics.get('total_tests', 0)} tests

Fallos detectados:
{json.dumps(failures, ensure_ascii=False, indent=2)}

Genera un reporte técnico de análisis de causa raíz en HTML.
REGLAS ESTRICTAS:
- Devuelve SOLO el contenido del div principal. Sin DOCTYPE, sin <html>, sin <body>.
- Usa únicamente estilos CSS inline.
- Estructura requerida:
  1. Encabezado con badge de severidad (CRÍTICO si pass_rate < 50%, ALTO si < 80%, MEDIO si >= 80%).
  2. Tabla de fallos: Escenario | Endpoint | Tipo | Causa Raíz | Impacto | Acción.
  3. Sección "Patrones detectados" si hay fallos similares.
  4. Sección "Próximos pasos" priorizados por impacto.
- Colores: CRÍTICO=#c62828, ALTO=#e65100, MEDIO=#f9a825.
- Headers de tabla: fondo #1a237e (azul Finkargo), texto blanco.
- Fuente: 'Segoe UI', sans-serif.
- Sé técnico, específico y accionable."""

def main():
    if len(sys.argv) < 8:
        print(f"Uso: {sys.argv[0]} <metrics_json> <output_html> <proyecto> <folder> <pais> <ambiente> <timestamp>",
              file=sys.stderr)
        sys.exit(1)

    metrics_path = sys.argv[1]
    output_path  = sys.argv[2]
    proyecto     = sys.argv[3]
    folder       = sys.argv[4]
    pais         = sys.argv[5]
    ambiente     = sys.argv[6]
    timestamp    = sys.argv[7]
    api_key      = os.environ.get("ANTHROPIC_API_KEY", "")

    try:
        with open(metrics_path, 'r', encoding='utf-8') as f:
            metrics = json.load(f)
    except Exception as e:
        error_html = f'<div style="background:#ffebee;padding:16px;border-left:4px solid #c62828;font-family:sans-serif;"><strong>⚠️ Error leyendo métricas:</strong><pre style="font-size:12px;">{e}</pre></div>'
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(error_html)
        sys.exit(0)

    failures = metrics.get('failures', [])

    try:
        if not failures:
            html = build_success_html(metrics)
            print("✅ Sin fallos — reporte de éxito generado.")
        elif not api_key:
            rows = ""
            for fail in failures:
                rows += f"""<tr>
                  <td style="padding:8px;border:1px solid #ddd;">{fail.get('escenario','N/A')}</td>
                  <td style="padding:8px;border:1px solid #ddd;font-size:12px;">{fail.get('method','')}&nbsp;{fail.get('url','N/A')}</td>
                  <td style="padding:8px;border:1px solid #ddd;color:#c62828;">{fail.get('error','N/A')}</td>
                </tr>"""
            html = f"""<div style="font-family:'Segoe UI',sans-serif;">
  <div style="background:#fff3e0;border-left:4px solid #e65100;padding:12px 16px;margin-bottom:16px;border-radius:4px;">
    <strong>⚠️ Análisis de IA omitido</strong> — ANTHROPIC_API_KEY no configurada.
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:#1a237e;color:#fff;">
      <th style="padding:10px;text-align:left;">Escenario</th>
      <th style="padding:10px;text-align:left;">Endpoint</th>
      <th style="padding:10px;text-align:left;">Error</th>
    </tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>"""
            print(f"⚠️ Tabla básica generada ({len(failures)} fallos) — sin análisis IA.")
        else:
            prompt = build_rca_prompt(metrics, proyecto, folder, pais, ambiente, timestamp)
            raw = call_claude(api_key, prompt)
            html = clean_html(raw)
            print(f"✅ Análisis Claude generado ({len(failures)} fallos analizados).")

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)

    except Exception as e:
        error_html = f'<div style="background:#ffebee;padding:16px;border-left:4px solid #c62828;font-family:sans-serif;border-radius:4px;"><strong>⚠️ Error en análisis de IA:</strong><pre style="margin:8px 0 0;font-size:12px;color:#555;">{e}</pre></div>'
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(error_html)
        print(f"ERROR en análisis Claude: {e}", file=sys.stderr)
        sys.exit(0)

if __name__ == '__main__':
    main()
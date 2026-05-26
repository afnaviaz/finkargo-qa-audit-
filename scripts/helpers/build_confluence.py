#!/usr/bin/env python3
"""
build_confluence.py — Construye el body HTML enriquecido para publicar en Confluence.
Uso: python3 build_confluence.py <metrics_json> <claude_html> <log_txt>
                                  <proyecto> <folder> <pais> <ambiente> <timestamp> <exec_num>
Imprime el HTML resultante por stdout.
"""
import json, sys, html as htmllib

def build_db_section(db_data):
    if not db_data or not db_data.get('ran') or not db_data.get('results'):
        return ''

    result_colors = {
        'OK':   ('#e8f5e9', '#2e7d32', '✅'),
        'WARN': ('#fff8e1', '#f57f17', '⚠️'),
        'FAIL': ('#ffebee', '#c62828', '❌'),
    }

    rows = ''
    for r in db_data['results']:
        bg, color, icon = result_colors.get(r['result'], ('#f5f5f5', '#333', '❓'))
        rows += f"""
        <tr style="background:{bg};">
          <td style="padding:10px 14px; font-weight:600; color:#37474f;">{r['table']}</td>
          <td style="padding:10px 14px; font-family:monospace; font-size:12px;">{r['external_id']}</td>
          <td style="padding:10px 14px; font-weight:700; color:{color};">{r['status']}</td>
          <td style="padding:10px 14px; color:#666;">{r['expected']}</td>
          <td style="padding:10px 14px; font-weight:700; color:{color}; text-align:center;">{icon} {r['result']}</td>
        </tr>"""

    return f"""<div style="margin-bottom:24px;">
    <h2 style="font-size:16px; color:#1b5e20; border-bottom:2px solid #1b5e20; padding-bottom:8px; margin-bottom:12px;">
      🗄️ Validación de Estados — Base de Datos ({db_data.get('ambiente','')}/{db_data.get('pais','')})
    </h2>
    <table style="width:100%; border-collapse:collapse; border-radius:8px; overflow:hidden; font-size:13px;">
      <tr style="background:#1b5e20; color:#fff;">
        <th style="padding:10px 14px; text-align:left;">Tabla</th>
        <th style="padding:10px 14px; text-align:left;">external_id</th>
        <th style="padding:10px 14px; text-align:left;">Status BD</th>
        <th style="padding:10px 14px; text-align:left;">Esperado</th>
        <th style="padding:10px 14px; text-align:center;">Resultado</th>
      </tr>
      {rows}
    </table>
  </div>"""

def main():
    if len(sys.argv) < 10:
        print(f"Uso: {sys.argv[0]} <metrics_json> <claude_html> <log_txt> "
              "<proyecto> <folder> <pais> <ambiente> <timestamp> <exec_num>", file=sys.stderr)
        sys.exit(1)

    metrics_path = sys.argv[1]
    claude_path  = sys.argv[2]
    log_path     = sys.argv[3]
    proyecto     = sys.argv[4]
    folder       = sys.argv[5]
    pais         = sys.argv[6]
    ambiente     = sys.argv[7]
    timestamp    = sys.argv[8]
    exec_num     = sys.argv[9]
    db_path      = sys.argv[10] if len(sys.argv) > 10 else None

    # --- Cargar datos ---
    try:
        with open(metrics_path, 'r', encoding='utf-8') as f:
            m = json.load(f)
    except Exception:
        m = {"status": "ERROR", "pass_rate": 0, "total_requests": 0,
             "failed_requests": 0, "total_tests": 0, "passed_tests": 0,
             "failed_tests": 0, "duration_s": 0, "failures": []}

    try:
        with open(claude_path, 'r', encoding='utf-8') as f:
            rca_html = f.read()
    except Exception:
        rca_html = "<p>Análisis de IA no disponible.</p>"

    db_data = None
    if db_path:
        try:
            with open(db_path, 'r', encoding='utf-8') as f:
                db_data = json.load(f)
        except Exception:
            db_data = None

    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            log_raw = f.read()
        truncated = len(log_raw) > 8000
        # CDATA no necesita HTML escape; solo proteger el cierre accidental de CDATA
        log_clean = log_raw[:8000].replace(']]>', ']] >')
        if truncated:
            log_clean += "\n\n... [log truncado — ver artefacto completo en GitHub Actions]"
    except Exception:
        log_clean = "Log no disponible."

    # --- Determinar badge y colores ---
    status    = m.get("status", "UNKNOWN")
    pass_rate = m.get("pass_rate", 0)
    failed    = m.get("failed_tests", 0)

    if status == "PASS" or failed == 0:
        badge_color, badge_text, badge_icon = "#2e7d32", "PASS", "✅"
    elif pass_rate >= 80:
        badge_color, badge_text, badge_icon = "#e65100", "DEGRADADO", "⚠️"
    else:
        badge_color, badge_text, badge_icon = "#c62828", "FAIL", "❌"

    env_color   = "#1565c0" if ambiente == "Testing" else "#6a1b9a"
    fail_bg     = "#ffebee" if failed > 0 else "#e8f5e9"
    fail_border = "#c62828" if failed > 0 else "#2e7d32"
    fail_color  = "#c62828" if failed > 0 else "#1b5e20"

    body = f"""<div style="font-family:'Segoe UI',Arial,sans-serif; max-width:900px; color:#212121;">

  <!-- ENCABEZADO -->
  <table style="width:100%; border-collapse:collapse; margin-bottom:24px;
                background:linear-gradient(135deg,#0d47a1,#1565c0); border-radius:8px; overflow:hidden;">
    <tr>
      <td style="padding:20px 24px; color:#fff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; opacity:0.75; margin-bottom:6px;">
          Finkargo · QA Audit Pipeline
        </div>
        <div style="font-size:22px; font-weight:700; margin-bottom:4px;">
          {proyecto} &rsaquo; {folder}
        </div>
        <div style="font-size:13px; opacity:0.85;">
          🕐 {timestamp} &nbsp;|&nbsp; Run #{exec_num} &nbsp;|&nbsp;
          <span style="background:rgba(255,255,255,0.2); padding:2px 10px; border-radius:12px; font-size:12px;">{pais}</span>
          &nbsp;
          <span style="background:{env_color}; padding:2px 10px; border-radius:12px; font-size:12px;">{ambiente}</span>
        </div>
      </td>
      <td style="padding:20px 24px; text-align:right; vertical-align:middle;">
        <div style="display:inline-block; background:{badge_color}; color:#fff;
                    padding:10px 22px; border-radius:6px; font-size:20px; font-weight:700;">
          {badge_icon} {badge_text}
        </div>
        <div style="color:rgba(255,255,255,0.85); font-size:28px; font-weight:800; margin-top:6px;">
          {pass_rate}%
        </div>
        <div style="color:rgba(255,255,255,0.6); font-size:11px;">Pass Rate</div>
      </td>
    </tr>
  </table>

  <!-- TARJETAS DE MÉTRICAS -->
  <table style="width:100%; border-collapse:separate; border-spacing:8px; margin-bottom:24px;">
    <tr>
      <td style="background:#e3f2fd; border-radius:8px; padding:16px 20px; text-align:center; border-top:3px solid #1565c0; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#0d47a1;">{m.get('total_requests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Requests</div>
      </td>
      <td style="background:#e8f5e9; border-radius:8px; padding:16px 20px; text-align:center; border-top:3px solid #2e7d32; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#1b5e20;">{m.get('passed_tests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Tests OK</div>
      </td>
      <td style="background:{fail_bg}; border-radius:8px; padding:16px 20px; text-align:center; border-top:3px solid {fail_border}; width:20%;">
        <div style="font-size:28px; font-weight:800; color:{fail_color};">{m.get('failed_tests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Tests Fallados</div>
      </td>
      <td style="background:#fff3e0; border-radius:8px; padding:16px 20px; text-align:center; border-top:3px solid #e65100; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#bf360c;">{m.get('total_tests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Total Tests</div>
      </td>
      <td style="background:#f3e5f5; border-radius:8px; padding:16px 20px; text-align:center; border-top:3px solid #6a1b9a; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#4a148c;">{m.get('duration_s',0)}s</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Duración</div>
      </td>
    </tr>
  </table>

  <!-- VALIDACIÓN BASE DE DATOS -->
  {build_db_section(db_data)}

  <!-- ANÁLISIS CLAUDE AI -->
  <div style="margin-bottom:24px;">
    <h2 style="font-size:16px; color:#0d47a1; border-bottom:2px solid #0d47a1; padding-bottom:8px; margin-bottom:16px;">
      🤖 Análisis de Causa Raíz — Claude AI
    </h2>
    {rca_html}
  </div>

  <!-- LOG DE CONSOLA -->
  <div style="margin-bottom:16px;">
    <h2 style="font-size:16px; color:#37474f; border-bottom:2px solid #b0bec5; padding-bottom:8px; margin-bottom:12px;">
      💻 Output de Consola (Newman)
    </h2>
    <ac:structured-macro ac:name="code">
      <ac:parameter ac:name="language">text</ac:parameter>
      <ac:parameter ac:name="collapse">true</ac:parameter>
      <ac:plain-text-body><![CDATA[{log_clean}]]></ac:plain-text-body>
    </ac:structured-macro>
  </div>

  <!-- FOOTER -->
  <div style="background:#eceff1; border-radius:6px; padding:12px 16px;
              font-size:11px; color:#90a4ae; text-align:center;">
    Generado automáticamente por Finkargo QA Audit Pipeline v2.1 · {timestamp}
  </div>

</div>"""

    print(body)

if __name__ == '__main__':
    main()

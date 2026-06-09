#!/usr/bin/env python3
"""
build_confluence.py — Construye el body HTML enriquecido para publicar en Confluence.
Uso: python3 build_confluence.py <metrics_json> <claude_html> <log_txt>
                                  <proyecto> <folder> <pais> <ambiente> <timestamp> <exec_num>
Imprime el HTML resultante por stdout.
"""
import json, sys, html as htmllib


def build_failures_callout(metrics):
    """Panel de alerta nativo de Confluence — visible inmediatamente al abrir la página."""
    failures = metrics.get('failures', [])
    failed_tests = metrics.get('failed_tests', 0)
    if not failures and failed_tests == 0:
        return ''

    seen = set()
    items_html = ''
    for f in failures[:15]:
        scenario = htmllib.escape(f.get('escenario', 'N/A'))
        method   = htmllib.escape(f.get('method', ''))
        url      = htmllib.escape(f.get('url', 'N/A'))
        error    = htmllib.escape(f.get('error', 'Sin detalle'))
        key      = f"{scenario}|{error}"
        if key in seen:
            continue
        seen.add(key)
        items_html += (
            f'<li><strong>{scenario}</strong>'
            + (f' — <code>{method} {url}</code>' if method or url else '')
            + f'<br/><em style="color:#b71c1c;">{error}</em></li>'
        )

    extra = len(failures) - len(seen)
    if extra > 0:
        items_html += f'<li>... y {extra} fallo(s) adicional(es) — ver sección "Detalle de Fallos" abajo.</li>'

    return f"""<ac:structured-macro ac:name="warning" ac:schema-version="1">
  <ac:parameter ac:name="title">&#10060; {failed_tests} prueba(s) fallaron — se requiere acción del equipo</ac:parameter>
  <ac:rich-text-body>
    <ul>{items_html}</ul>
  </ac:rich-text-body>
</ac:structured-macro>"""


def build_failures_detail_section(breakdown):
    """Sección expandible con el detalle completo de errores por endpoint fallado."""
    failing = [ep for ep in breakdown if ep.get('failed_tests', 0) > 0]
    if not failing:
        return ''

    method_styles = {
        'GET':    ('#e3f2fd', '#1565c0'),
        'POST':   ('#e8f5e9', '#1b5e20'),
        'PUT':    ('#fff3e0', '#e65100'),
        'PATCH':  ('#f3e5f5', '#6a1b9a'),
        'DELETE': ('#ffebee', '#c62828'),
    }

    cards = ''
    for ep in failing:
        name   = htmllib.escape(ep.get('name', 'N/A'))
        method = ep.get('method', '').upper()
        errors = ep.get('errors', [])
        failed = ep.get('failed_tests', 0)
        total  = ep.get('total_tests', 0)
        mbg, mcolor = method_styles.get(method, ('#f5f5f5', '#333'))

        error_items = ''.join(
            f'<li style="margin-bottom:8px;">'
            f'<code style="background:#fce8e8; padding:3px 8px; border-radius:4px; '
            f'font-size:12px; color:#b71c1c; display:block; white-space:pre-wrap;">'
            f'{htmllib.escape(e)}</code></li>'
            for e in errors
        ) or '<li>Sin detalle de error disponible.</li>'

        cards += f"""<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">&#10060; {name} — {failed}/{total} tests fallados</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Método:</strong>
       <code style="background:{mbg}; color:{mcolor}; padding:2px 8px; border-radius:3px; font-weight:700;">{method}</code>
    </p>
    <p><strong>Errores detectados:</strong></p>
    <ul style="padding-left:20px;">{error_items}</ul>
  </ac:rich-text-body>
</ac:structured-macro>
"""

    return f"""<div style="margin-bottom:24px;">
  <h2 style="font-size:14px; font-weight:700; color:#b71c1c; border-bottom:2px solid #ef9a9a;
             padding-bottom:6px; margin-bottom:12px; text-transform:uppercase; letter-spacing:0.5px;">
    &#128269; Detalle de Fallos por Endpoint
  </h2>
  {cards}
</div>"""


def build_endpoint_breakdown_section(breakdown):
    if not breakdown:
        return ''

    method_styles = {
        'GET':    ('#e3f2fd', '#1565c0'),
        'POST':   ('#e8f5e9', '#1b5e20'),
        'PUT':    ('#fff3e0', '#e65100'),
        'PATCH':  ('#f3e5f5', '#6a1b9a'),
        'DELETE': ('#ffebee', '#c62828'),
    }

    rows = ''
    for i, ep in enumerate(breakdown, 1):
        failed  = ep.get('failed_tests', 0)
        total   = ep.get('total_tests', 0)
        passed  = ep.get('passed_tests', 0)
        method  = ep.get('method', '').upper()
        name    = htmllib.escape(ep.get('name', ''))
        errors  = ep.get('errors', [])

        row_bg       = '#fff5f5' if failed > 0 else ('#f7fbf7' if i % 2 == 0 else '#ffffff')
        status_color = '#c62828' if failed > 0 else '#2e7d32'
        status_icon  = '❌' if failed > 0 else '✅'
        fail_color   = '#c62828' if failed > 0 else '#bdbdbd'
        fail_weight  = '700' if failed > 0 else '400'
        mbg, mcolor  = method_styles.get(method, ('#f5f5f5', '#333'))

        error_note = ''
        if errors and failed > 0:
            error_note = (
                f'<div style="margin-top:4px; font-size:11px; color:#b71c1c; font-style:italic;">'
                f'&#9660; Ver detalle en sección "Detalle de Fallos" abajo</div>'
            )

        border = '1px solid #fce8e8' if failed > 0 else '1px solid #f0f0f0'
        rows += f"""
        <tr style="background:{row_bg};">
          <td style="padding:5px 8px; text-align:center; color:#bdbdbd; font-size:12px; border-bottom:{border};">{i}</td>
          <td style="padding:5px 10px; font-size:13px; border-bottom:{border}; line-height:1.5;">{name}{error_note}</td>
          <td style="padding:5px 8px; text-align:center; border-bottom:{border};">
            <span style="background:{mbg}; color:{mcolor}; padding:2px 7px; border-radius:3px; font-size:11px; font-weight:700; font-family:monospace; white-space:nowrap;">{method}</span>
          </td>
          <td style="padding:5px 8px; text-align:center; font-size:13px; font-weight:600; color:#546e7a; border-bottom:{border};">{total}</td>
          <td style="padding:5px 8px; text-align:center; font-size:13px; color:#2e7d32; font-weight:700; border-bottom:{border};">{passed}</td>
          <td style="padding:5px 8px; text-align:center; font-size:13px; color:{fail_color}; font-weight:{fail_weight}; border-bottom:{border};">{failed}</td>
          <td style="padding:5px 8px; text-align:center; font-size:14px; border-bottom:{border};">
            <span style="color:{status_color};">{status_icon}</span>
          </td>
        </tr>"""

    total_eps  = len(breakdown)
    failed_eps = sum(1 for ep in breakdown if ep.get('failed_tests', 0) > 0)
    badge_bg   = '#ffebee' if failed_eps > 0 else '#e8f5e9'
    badge_col  = '#c62828' if failed_eps > 0 else '#1b5e20'

    return f"""<div style="margin-bottom:20px;">
    <h2 style="font-size:14px; font-weight:700; color:#37474f; border-bottom:2px solid #cfd8dc;
               padding-bottom:6px; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">
      &#128203; Desglose por Endpoint &nbsp;
      <span style="font-size:12px; font-weight:400; color:#78909c; text-transform:none; letter-spacing:0;">
        {total_eps} requests &nbsp;·&nbsp;
        <span style="background:{badge_bg}; color:{badge_col}; padding:2px 9px; border-radius:10px; font-weight:700;">{failed_eps} con fallos</span>
      </span>
    </h2>
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <tr style="background:#546e7a; color:#fff; font-size:12px; text-transform:uppercase; letter-spacing:0.3px;">
        <th style="padding:7px 8px; text-align:center; width:3%; font-weight:600;">#</th>
        <th style="padding:7px 10px; text-align:left; font-weight:600;">Endpoint / Escenario</th>
        <th style="padding:7px 8px; text-align:center; width:7%; font-weight:600;">Método</th>
        <th style="padding:7px 8px; text-align:center; width:8%; font-weight:600;">Total</th>
        <th style="padding:7px 8px; text-align:center; width:8%; font-weight:600;">&#10003; Pass</th>
        <th style="padding:7px 8px; text-align:center; width:8%; font-weight:600;">&#10007; Fail</th>
        <th style="padding:7px 8px; text-align:center; width:7%; font-weight:600;">OK?</th>
      </tr>
      {rows}
    </table>
  </div>"""


def build_db_section(db_data):
    if not db_data or not db_data.get('ran') or not db_data.get('results'):
        return ''

    result_colors = {
        'OK':   ('#f1faf2', '#2e7d32', '✅'),
        'WARN': ('#fffde7', '#f57f17', '⚠️'),
        'FAIL': ('#fff5f5', '#c62828', '❌'),
    }

    rows = ''
    for r in db_data['results']:
        bg, color, icon = result_colors.get(r['result'], ('#f5f5f5', '#333', '❓'))
        rows += f"""
        <tr style="background:{bg};">
          <td style="padding:6px 10px; font-weight:600; color:#37474f; font-size:13px; border-bottom:1px solid #e8f5e9;">{r['table']}</td>
          <td style="padding:6px 10px; font-family:monospace; font-size:12px; color:#546e7a; border-bottom:1px solid #e8f5e9;">{r['external_id']}</td>
          <td style="padding:6px 10px; font-weight:600; color:{color}; font-size:13px; border-bottom:1px solid #e8f5e9;">{r['status']}</td>
          <td style="padding:6px 10px; color:#757575; font-size:13px; border-bottom:1px solid #e8f5e9;">{r['expected']}</td>
          <td style="padding:6px 10px; font-weight:700; color:{color}; text-align:center; font-size:13px; border-bottom:1px solid #e8f5e9;">{icon} {r['result']}</td>
        </tr>"""

    return f"""<div style="margin-bottom:20px;">
    <h2 style="font-size:14px; font-weight:700; color:#1b5e20; border-bottom:2px solid #a5d6a7;
               padding-bottom:6px; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">
      &#128193; Validación BD &nbsp;
      <span style="font-size:12px; font-weight:400; color:#78909c; text-transform:none; letter-spacing:0;">{db_data.get('ambiente','')}/{db_data.get('pais','')}</span>
    </h2>
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <tr style="background:#2e7d32; color:#fff; font-size:12px; text-transform:uppercase; letter-spacing:0.3px;">
        <th style="padding:7px 10px; text-align:left; font-weight:600;">Tabla</th>
        <th style="padding:7px 10px; text-align:left; font-weight:600;">external_id</th>
        <th style="padding:7px 10px; text-align:left; font-weight:600;">Status BD</th>
        <th style="padding:7px 10px; text-align:left; font-weight:600;">Esperado</th>
        <th style="padding:7px 10px; text-align:center; font-weight:600;">Resultado</th>
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

  <!-- PANEL DE ALERTA (solo si hay fallos) -->
  {build_failures_callout(m)}

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

  <!-- DESGLOSE POR ENDPOINT -->
  {build_endpoint_breakdown_section(m.get('endpoint_breakdown', []))}

  <!-- VALIDACIÓN BASE DE DATOS -->
  {build_db_section(db_data)}

  <!-- DETALLE DE FALLOS POR ENDPOINT (expandible) -->
  {build_failures_detail_section(m.get('endpoint_breakdown', []))}

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

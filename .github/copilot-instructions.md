# Finkargo QA Audit — Instrucciones para Agentes IA

## Arquitectura General

Este proyecto automatiza auditorías de APIs Postman (contratos, seguridad) para ms-core-entities usando un pipeline de tres fases ejecutadas desde `scripts/run_all.sh`:

1. **Newman Execution** — Ejecuta colecciones Postman contra ambientes (CO/MX × Testing/Staging)
2. **Metrics Extraction** — Extrae estadísticas del reporte JSON (pass rate, duración, fallos)
3. **AI Analysis + Confluence** — Claude API genera RCA (Root Cause Analysis) si hay fallos; construye HTML enriquecido para publicación en Confluence

**Flujo de datos:**
```
Postman Collection (ID en collections.json)
    ↓ [Newman + environment UIDs]
    ↓ reporte_visual_newman.html, results_final.json
    ↓ [extract_metrics.py]
    ↓ metrics_summary.json
    ↓ [claude_analysis.py si ANTHROPIC_API_KEY está disponible]
    ↓ claude_report.html
    ↓ [build_confluence.py]
    ↓ Confluence page (QA space)
```

## Convenciones Críticas

### 1. **Collections Configuration** (`scripts/config/collections.json`)
Estructura de entrada para resolver colecciones Postman:
```json
{
  "nombre-proyecto": {
    "collection_id": "UUID-completo",
    "description": "...",
    "folders": {
      "CO": "🇨🇴 Colombia",
      "MX": "🇲🇽 Mexico",
      "Nombre-Carpeta": "Nombre-Carpeta"
    }
  }
}
```
- **Cada proyecto requiere UUID exacto** de Postman (obtener en Settings → API keys → Collections)
- Los folders mapean nombres anidados en Postman (la carpeta debe existir en la colección)

### 2. **Environment Mapping** (`scripts/run_all.sh` líneas 121-129)
Hardcodeado según país/ambiente:
```bash
CO:Testing  → ENV_UID "19103266-4be86e2c-b894-4577-95c4-f4b827281933"
CO:Staging  → ENV_UID "19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf"
MX:Testing  → ENV_UID "19456853-52efb174-794f-4837-a1bf-fc913c9b0f10"
MX:Staging  → ENV_UID "19103266-8187ac0e-07bd-497d-a228-fefdeec90492"
```
**Cambios aquí afectan qué valores de variable se inyectan en Newman.** Si ambientes no resuelven correctamente, revisar UIDs en Postman.

### 3. **Execution Parameters** (entrada a `run_all.sh`)
```bash
bash scripts/run_all.sh <PROYECTO> <FOLDER> <PAIS> <AMBIENTE>
# Ejemplo: bash scripts/run_all.sh ms-core-entities "01-Register Company" CO Testing
```
- `PROYECTO` → Clave exacta en collections.json
- `FOLDER` → Nombre visible en Postman (debe existir en la colección)
- `PAIS` → CO | MX | ALL (expande a ambos países automáticamente)
- `AMBIENTE` → Testing | Staging (solo dos valores permitidos)

### 4. **Helper Scripts** — Data Transformations
Cada script es una pieza del pipeline con entrada/salida clara:

| Script | Entrada | Salida | Propósito |
|--------|---------|--------|-----------|
| `get_config.py` | `collections.json`, proyecto, modo | stdout (UUID o lista folders) | Resolver IDs desde config JSON |
| `extract_metrics.py` | `results_final.json` (Newman) | `metrics_summary.json` | Parse resultados Newman → métricas legibles |
| `claude_analysis.py` | `metrics_summary.json` + API key | `claude_report.html` | RCA con Claude si hay fallos |
| `build_confluence.py` | Métricas + RCA + log | stdout (HTML) → `confluence_body.html` | Ensambla HTML para publicar en Confluence |

**Patrón:** cada script valida existencia de archivos, maneja encoding UTF-8, usa `sys.exit(1)` en errores.

## Debugging Workflows

### "Proyecto no encontrado"
```bash
# Listar proyectos disponibles en collections.json
python3 scripts/helpers/get_config.py scripts/config/collections.json | jq keys
# O directamente:
cat scripts/config/collections.json | jq keys
```

### Newman falla silenciosamente
1. Verificar credenciales en `.env`:
   - `POSTMAN_API_KEY` (v10+ de Postman API, formato PMAK-xxxxxx)
   - Validar longitud (≥40 chars)
2. Comprobar acceso a VPN (obligatorio para Testing/Staging corporativos)
3. Revisar `log_<PROYECTO>.txt` generado en `scripts/`
4. Verificar que collection y environment UIDs existen:
   ```bash
   curl -H "X-Api-Key: ${POSTMAN_API_KEY}" \
     "https://api.getpostman.com/collections/<COLLECTION_UID>"
   ```

### IA Analysis (Claude) no disponible
- Si `ANTHROPIC_API_KEY` no está definida, el script lo reporta con WARN pero continúa
- No es error fatal — reporte Confluence sigue publicándose sin RCA
- En GitHub Actions, agregar secret: `ANTHROPIC_API_KEY` con modelo `sonnet-2023-06-01`

### Confluence publish falla
- Revisar `CONF_TOKEN` (Atlassian API token, no contraseña)
- Verificar `CONF_USER` es email exacto registrado en Atlassian
- Space key es hardcodeado: `QA` (cambiar en línea 76 de `run_all.sh` si necesario)

## Key Files for Modification

| Archivo | Cambios Comunes | Nota |
|---------|-----------------|------|
| `scripts/config/collections.json` | Agregar proyectos, mapear folders Postman | Requiere UUIDs exactos de Postman |
| `scripts/run_all.sh` | Nuevas combinaciones país/ambiente (línea 121), formato report, timeouts Newman | Usa pipes: `\|` para cambios no triviales |
| `scripts/helpers/extract_metrics.py` | Campos adicionales en `metrics_summary.json`, cálculos de pass_rate | Mantener estructura JSON; algunos campos son usados por Confluence |
| `scripts/helpers/build_confluence.py` | Colores badges, formato encabezado, HTML CSS | Confluence interpreta HTML inline — evitar etiquetas no soportadas |
| `.env` / GitHub Secrets | API keys, usuarios | Nunca commitear en `.env` real; usar `.env.example` como template |

## Testing Locally

```bash
# Minimal test (ejecuta sin IA analysis, solo Newman)
unset ANTHROPIC_API_KEY
bash scripts/run_all.sh ms-core-entities "01-Register Company" CO Testing

# Con análisis IA (requiere API key Anthropic)
export ANTHROPIC_API_KEY="sk-ant-..."
bash scripts/run_all.sh ms-core-entities "01-Register Company" CO Testing

# Ver salida enriquecida
cat scripts/confluence_body.html | open -f -a "Safari"
```

## Multi-Project Expansion (Branch: `feature/multi-project-qa`)

Estructura para soportar múltiples microservicios:
- Duplicar entrada en `collections.json` (con proyecto nuevo + UUIDs)
- GitHub Actions: crear archivo `qa-audit-<PROYECTO>.yml` en `.github/workflows/`
- Reutilizar `run_all.sh` — parámetros parametrizan el comportamiento

**Ejemplo agregar `ms-payment-flow`:**
1. Crear colección en Postman, obtener UUID
2. En `collections.json`:
   ```json
   "ms-payment-flow": {
     "collection_id": "<NEW-UUID>",
     "folders": { "CO": "...", "MX": "..." }
   }
   ```
3. En `.github/workflows/qa-audit-ms-payment-flow.yml`: replicar trigger, cambiar `ms-core-entities` → `ms-payment-flow`

## Important Context

- **VPN Requirement**: Staging/Testing ambientes están detrás de VPN corporativa — local runs fallarán sin conexión activa
- **Postman API v10+**: API keys antiguas (formato `PMAK_old`) no funcionan; actualizar desde web Postman
- **Confluence HTML**: No soporta todos los atributos CSS (ej: `filter`, `backdrop-filter`) — mantener simple
- **Data-Driven Testing**: Si `test/data/scenarios.json` existe, Newman lo inyecta como dataset

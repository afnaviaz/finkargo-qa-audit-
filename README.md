# Finkargo QA Audit

Automatización de pruebas de API con Newman, análisis de causa raíz con Claude AI (Anthropic) y publicación de reportes en Confluence.

---

## Requisitos previos

- Node.js (v18 o superior)
- Python 3
- VPN de Finkargo activa
- Acceso a Postman y Confluence
- API Key de Anthropic (para análisis con Claude AI)

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/afnaviaz/finkargo-qa-audit-.git
cd finkargo-qa-audit-
```

### 2. Instalar dependencias de Node

```bash
npm install
```

### 3. Configurar credenciales

Copia el archivo de ejemplo y completa con tus credenciales reales:

```bash
cp .env.example .env
```

Edita `.env` con tus valores:

```bash
export POSTMAN_API_KEY=PMAK-xxxxxxxxxxxxxxxxxxxx
export CONF_USER=tu.email@finkargo.com
export CONF_TOKEN=ATATTxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

> Las credenciales se obtienen en:
> - **Postman API Key:** https://web.postman.co/settings/me/api-keys
> - **Atlassian Token:** https://id.atlassian.com/manage-profile/security/api-tokens
> - **Anthropic API Key:** https://console.anthropic.com

---

## Ejecución local

Asegúrate de tener la **VPN activa** antes de ejecutar.

El script principal recibe 4 parámetros:

```bash
bash scripts/run_all.sh <PROYECTO> [FOLDER] <CO|MX|ALL> <Testing|Staging>
```

| Parámetro | Descripción | Ejemplo |
|-----------|-------------|---------|
| `PROYECTO` | Nombre del proyecto (debe coincidir con una clave en `scripts/config/`) | `QA Audit - Operations` |
| `FOLDER` | *(Opcional)* Carpeta específica dentro de la colección | `Financing Orchestrator API` |
| `PAIS` | País de ejecución: `CO`, `MX` o `ALL` | `CO` |
| `AMBIENTE` | Ambiente de ejecución: `Testing` o `Staging` | `Testing` |

### Ejemplos de uso

```bash
# QA Operations - Colombia Testing
bash scripts/run_all.sh "QA Audit - Operations" "Financing Orchestrator API" CO Testing

# Flujos críticos - Onboarding Colombia
bash scripts/run_all.sh "Flows APP" "Onboarding Colombia MD" CO Testing

# OB v2 MX - Staging
bash scripts/run_all.sh "OB v2 - MX" Flow MX Staging

# ms-core-entities - Ambos países
bash scripts/run_all.sh "ms-core-entities-k8s" "" ALL Testing
```

---

## Ejecución desde GitHub Actions

El workflow se ejecuta en tu máquina local mediante un **self-hosted runner**, lo que permite acceso a la VPN corporativa.

### Workflows disponibles

| Workflow | Descripción |
|----------|-------------|
| `QA-Flujos-Criticos` | Onboarding CO/MX, flujos de pago, decisión crediticia |
| `QA Integrations - Flows APP` | Integraciones SUPRA (happy path, rejected, expired, epayments, wallet) |
| `QA Audit - Operations` | Financing Orchestrator API y operaciones MX |
| `QA Audit - OB v2 - MX` | Onboarding v2 México |
| `core-entities` | Microservicio ms-core-entities (k8s) |

### 1. Instalar el runner (solo la primera vez)

Ve a tu repositorio en GitHub:

**Settings → Actions → Runners → New self-hosted runner**

Selecciona:
- **OS:** macOS
- **Architecture:** ARM64 (Apple Silicon)

Crea la carpeta del runner **fuera** del repositorio y ejecuta los comandos que GitHub te muestra en pantalla:

```bash
mkdir ~/actions-runner && cd ~/actions-runner

# Descargar el paquete (usa la URL exacta que te da GitHub)
curl -o actions-runner-osx-arm64.tar.gz -L <URL_DE_GITHUB>
tar xzf ./actions-runner-osx-arm64.tar.gz

# Configurar el runner (el token expira ~1 hora, úsalo de inmediato)
./config.sh --url https://github.com/afnaviaz/finkargo-qa-audit- --token <TOKEN_DE_GITHUB>
```

Durante la configuración, acepta los valores por defecto presionando Enter. Al finalizar verás:

```
√ Runner successfully added
√ Runner connection is good
```

> **Tip:** Si el token expiró, genera uno nuevo en **Settings → Actions → Runners → New self-hosted runner**.

### 2. Verificar que el runner aparece en GitHub

Ve a **Settings → Actions → Runners** y confirma que el runner aparece con estado **Idle** (en gris). Si aparece **Offline**, debes iniciarlo (ver paso 4).

### 3. Configurar secretos en GitHub

Ve a: **Settings → Secrets and variables → Actions → New repository secret**

Agrega los siguientes secretos:

| Nombre | Descripción | Dónde obtenerlo |
|--------|-------------|-----------------|
| `POSTMAN_API_KEY` | API Key de Postman | [web.postman.co/settings/me/api-keys](https://web.postman.co/settings/me/api-keys) |
| `CONF_USER` | Email de Atlassian | Tu email corporativo |
| `CONF_TOKEN` | Token de Atlassian | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ANTHROPIC_API_KEY` | API Key de Anthropic (Claude AI) | [console.anthropic.com](https://console.anthropic.com) |

### 4. Iniciar el runner

Cada vez que vayas a ejecutar un workflow desde GitHub, **activa la VPN** y luego inicia el runner:

```bash
cd ~/actions-runner
./run.sh
```

Cuando veas el mensaje `Listening for Jobs`, el runner está listo y conectado.

> **Para dejarlo corriendo en segundo plano:**
> ```bash
> # Instalar como servicio del sistema (se inicia automáticamente)
> sudo ./svc.sh install
> sudo ./svc.sh start
>
> # Ver estado del servicio
> sudo ./svc.sh status
>
> # Detener el servicio
> sudo ./svc.sh stop
> ```
> Con el servicio instalado, el runner se inicia solo al arrancar la máquina, pero **recuerda activar la VPN antes de lanzar el workflow**.

### 5. Lanzar el workflow

Ve a GitHub: **Actions → [nombre del workflow] → Run workflow**

Elige la carpeta, país y ambiente según las opciones del workflow seleccionado.

### 6. Ver el reporte

Al finalizar, el pipeline publica automáticamente en **Confluence (espacio QA)**. También puedes descargar los artefactos desde la ejecución en GitHub Actions:

- `reporte_visual_newman.html` — Reporte visual de Newman (htmlextra)
- `results_final.json` — Resultados en formato JSON
- `log_<PROYECTO>.txt` — Log completo de ejecución
- `claude_report.html` — Análisis de causa raíz generado por Claude AI
- `metrics_summary.json` — Resumen de métricas extraídas
- `db_validation.json` — Resultado de validación de estados en BD

---

## Pipeline interno

El script `run_all.sh` ejecuta las siguientes fases en orden:

1. **Validación de parámetros y credenciales**
2. **Resolución de configuración** — lee `scripts/config/<proyecto>.json`
3. **Obtención de UIDs** — collection y environment desde Postman API
4. **Filtrado de colección** *(cuando aplica)* — para colecciones tipo `items`
5. **Newman Fase 1** — ejecución de la carpeta principal
6. **Playwright** — automatización del flujo de pago en UI (happy path / rejected)
7. **Newman Fase 2** — ejecución de `Post payment` si se generó un `payment_link`
8. **Validación de BD** — verifica estados esperados según escenario
9. **Extracción de métricas** — parse del reporte JSON
10. **Análisis Claude AI** — diagnóstico de fallos con IA
11. **Publicación en Confluence** — crea/actualiza la página del run
12. **Adjuntar artefactos** — HTML de Newman y JSON de métricas

### Escenarios soportados

| Folder | Escenario | Playwright | Espera |
|--------|-----------|------------|--------|
| `Rejected flow` | `rejected` | Sí (flujo rechazado) | No |
| `Expired flow` | `expired` | No | 34 min (expiración automática) |
| `Happy path epayments` | `epayments_happy` | Sí | No |
| `Happy path wallet epayments` | `wallet_epayments_happy` | Sí | No |
| `Happy path integration wallet` | `wallet_happy` | Sí | No |
| `Happy path cobre` | `cobre_happy` | Sí | No |
| *(cualquier otro)* | `happy_path` | Sí | No |

---

## Agregar un nuevo proyecto

1. Crea un archivo JSON en `scripts/config/<nombre>.json` con la configuración de la colección.
2. Agrega el mapeo en el `case` de `run_all.sh` si el nombre del proyecto no sigue el patrón por defecto.
3. Crea o actualiza el workflow en `.github/workflows/` con las opciones de carpeta disponibles.

---

## Estructura del proyecto

```
finkargo-qa-audit-/
├── .github/
│   └── workflows/
│       ├── qa-flujos-criticos.yaml       # Onboarding y flujos críticos
│       ├── qa-integrations.yml           # Integraciones SUPRA
│       ├── qa-audit-operations.yml       # Operations
│       ├── qa-audit-OB-v2-MX.yml         # OB v2 México
│       └── qa-audit-core-entities.yaml   # ms-core-entities
├── scripts/
│   ├── run_all.sh                        # Pipeline principal (v2.2)
│   ├── config/                           # Configuración por proyecto (JSON)
│   │   ├── collections.json
│   │   ├── qa-flujos-criticos.json
│   │   ├── ms-core-entities-k8s.json
│   │   ├── OB-V2-mx.json
│   │   └── QA Audit - Operations.json
│   ├── helpers/                          # Scripts Python de soporte
│   │   ├── get_config.py                 # Lectura de config JSON
│   │   ├── filter_collection.py          # Filtrado de colecciones por IDs
│   │   ├── extract_metrics.py            # Extracción de métricas Newman
│   │   ├── claude_analysis.py            # Análisis con Claude AI
│   │   ├── build_confluence.py           # Construcción del HTML de Confluence
│   │   └── validate_db_states.py         # Validación de estados en BD
│   └── playwright/                       # Automatización de UI
│       ├── payment_flow.js               # Flujo de pago (happy path)
│       ├── payment_flow_rejected.js      # Flujo de pago rechazado
│       └── run_playwright.sh             # Lanzador de Playwright
├── test/
│   ├── data/
│   │   └── scenarios.json                # Datos para pruebas data-driven
│   └── fixtures/                         # Archivos de prueba (PDFs)
├── .env.example                          # Plantilla de variables de entorno
├── .gitignore
└── package.json
```

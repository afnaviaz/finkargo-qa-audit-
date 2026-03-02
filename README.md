# Finkargo QA Audit

Automatización de pruebas de API con Newman, análisis de causa raíz con IA local (Ollama) y publicación de reportes en Confluence.

---

## Requisitos previos

- Node.js (v18 o superior)
- Python 3
- [Ollama](https://ollama.com) con el modelo `llama3` instalado
- VPN de Finkargo activa
- Acceso a Postman y Confluence

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
```

> Las credenciales se obtienen en:
> - **Postman API Key:** https://web.postman.co/settings/me/api-keys
> - **Atlassian Token:** https://id.atlassian.com/manage-profile/security/api-tokens

---

## Ejecución local

Asegúrate de tener la **VPN activa** antes de ejecutar.

```bash
# Colombia - Testing
bash scripts/run_all.sh CO Testing

# México - Testing
bash scripts/run_all.sh MX Testing

# Colombia - Staging
bash scripts/run_all.sh CO Staging

# México - Staging
bash scripts/run_all.sh MX Staging

# Ambos países
bash scripts/run_all.sh ALL Testing
```

---

## Ejecución desde GitHub Actions

El workflow se ejecuta en tu máquina local mediante un **self-hosted runner**, lo que permite acceso a la VPN corporativa.

### 1. Instalar el runner (solo la primera vez)

Ve a tu repositorio en GitHub:

**Settings → Actions → Runners → New self-hosted runner**

Selecciona:
- **OS:** macOS
- **Architecture:** ARM64 (Apple Silicon)

Crea la carpeta del runner **fuera** del repositorio y ejecuta los comandos que GitHub te muestra en pantalla:

```bash
# Crear carpeta fuera del repo
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

Ve a **Settings → Actions → Runners** y confirma que el runner aparece con estado **Idle** (en gris). Si aparece **Offline**, debes iniciarlo (ver paso 3).

### 3. Configurar secretos en GitHub

Ve a: **Settings → Secrets and variables → Actions → New repository secret**

Agrega los siguientes secretos:

| Nombre | Descripción | Dónde obtenerlo |
|--------|-------------|-----------------|
| `POSTMAN_API_KEY` | API Key de Postman | [web.postman.co/settings/me/api-keys](https://web.postman.co/settings/me/api-keys) |
| `CONF_USER` | Email de Atlassian | Tu email corporativo |
| `CONF_TOKEN` | Token de Atlassian | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ANTHROPIC_API_KEY` | API Key de Anthropic (Claude AI) | [console.anthropic.com](https://console.anthropic.com) |
| `SLACK_WEBHOOK_URL` | Webhook de Slack para notificaciones | Canal de Slack del equipo de QA |

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

Ve a GitHub: **Actions → QA Audit → Run workflow**

Elige:
- **País:** `CO`, `MX`, o `ALL`
- **Ambiente:** `Testing` o `Staging`

### 6. Ver el reporte

Al finalizar la ejecución, ve a la ejecución en GitHub Actions y busca la sección **Artifacts** al final de la página. Descarga el archivo `qa-report-<PAIS>-<AMBIENTE>` con:

- `report_*.html` — Reporte visual de Newman
- `results_*.json` — Resultados en formato JSON
- `log_*.txt` — Log completo de ejecución
- `claude-analysis.md` — Análisis de causa raíz generado por Claude AI

---

## Estructura del proyecto

```
finkargo-qa-audit-/
├── .github/
│   └── workflows/
│       └── qa-audit.yml      # Workflow de GitHub Actions
├── scripts/
│   └── run_all.sh            # Script principal de ejecución
├── collections/              # Colecciones de Postman (referencia)
├── environments/             # Ambientes de Postman (referencia)
├── .env.example              # Plantilla de variables de entorno
├── .gitignore
└── package.json
```

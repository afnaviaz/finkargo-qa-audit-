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

El workflow se ejecuta en tu máquina local mediante un **self-hosted runner**, lo que permite acceso a la VPN.

### 1. Instalar el runner (solo la primera vez)

Ve a tu repositorio en GitHub:

**Settings → Actions → Runners → New self-hosted runner**

Selecciona:
- **OS:** macOS
- **Architecture:** ARM64

Ejecuta los comandos que aparecen en pantalla:

```bash
# Crear carpeta (fuera del repositorio recomendado, o dentro en actions-runner/)
mkdir actions-runner && cd actions-runner

# Descargar y extraer (usa la URL exacta que te da GitHub)
curl -o actions-runner-osx-arm64.tar.gz -L <URL_DE_GITHUB>
tar xzf ./actions-runner-osx-arm64.tar.gz

# Configurar (usa el token exacto que te da GitHub, expira en ~1 hora)
./config.sh --url https://github.com/afnaviaz/finkargo-qa-audit- --token <TOKEN_DE_GITHUB>
```

### 2. Configurar secretos en GitHub

Ve a: **Settings → Secrets and variables → Actions → New repository secret**

Agrega estos tres secretos:

| Nombre | Descripción |
|--------|-------------|
| `POSTMAN_API_KEY` | Tu API Key de Postman |
| `CONF_USER` | Tu email de Atlassian |
| `CONF_TOKEN` | Tu token de Atlassian |

### 3. Iniciar el runner

Cada vez que quieras ejecutar desde GitHub, activa la VPN e inicia el runner:

```bash
cd actions-runner
./run.sh
```

Cuando veas `Listening for Jobs`, el runner está listo.

### 4. Lanzar el workflow

Ve a GitHub: **Actions → QA Audit → Run workflow**

Elige:
- **País:** `CO`, `MX`, o `ALL`
- **Ambiente:** `Testing` o `Staging`

### 5. Ver el reporte

Al finalizar la ejecución, ve a la ejecución en GitHub Actions y busca la sección **Artifacts** al final de la página. Descarga el archivo `qa-report-<PAIS>-<AMBIENTE>` con el reporte HTML completo.

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

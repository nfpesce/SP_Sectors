# SP Sectors – CLAUDE.md

Documentación de arquitectura, decisiones de diseño y estado del proyecto para referencia futura de Claude.

---

## Descripción

PWA (Progressive Web App) de pantalla completa que muestra los 11 sectores del S&P 500 como un **treemap heatmap**:
- El **tamaño** de cada rectángulo es proporcional al peso del sector en el índice
- El **color** (rojo/gris/verde) refleja la variación diaria del precio del ETF
- Los precios se actualizan cada 60 segundos vía Finnhub API

**URL producción:** https://nfpesce.github.io/SP_Sectors/  
**Repo:** https://github.com/nfpesce/SP_Sectors

---

## Arquitectura

### Stack
- **Frontend**: Vanilla JS + CSS + HTML — sin frameworks, sin bundler, sin dependencias npm
- **Backend local**: Node.js HTTP server (`server.js`) — solo para desarrollo local; sirve archivos estáticos y proxea la llamada a us500.com para evitar CORS
- **Hosting**: GitHub Pages (solo estáticos) — el proxy no corre en producción

### Archivos clave

| Archivo | Rol |
|---------|-----|
| `index.html` | Shell HTML, registra service worker |
| `app.js` | Toda la lógica de la aplicación |
| `treemap.js` | Algoritmo squarified treemap (puro, sin efectos secundarios) |
| `style.css` | Estilos: posicionamiento absoluto de tiles + overlay del slider |
| `server.js` | Servidor Node.js: archivos estáticos + ruta `/api/sectors` |
| `service-worker.js` | PWA: cache-first para shell, bypass para APIs |
| `sectors.json` | Pesos de sectores estáticos (actualizado por GitHub Action) |
| `manifest.json` | Configuración PWA |
| `.github/workflows/update-sectors.yml` | Action que actualiza `sectors.json` cada día hábil |

### Flujo de datos al iniciar

```
DOMContentLoaded
  └── init()
        ├── fetchSectorWeights()
        │     ├── intenta ./sectors.json          ← funciona en GH Pages y local
        │     ├── intenta /api/sectors            ← solo funciona local (Node proxy)
        │     └── fallback: DEFAULT_WEIGHTS       ← hardcodeado en app.js
        ├── doLayout()  ← polling con setInterval(50ms) hasta que offsetWidth > 0
        │     ├── computeLayout()  ← llama a squarify() en treemap.js
        │     └── renderTiles()    ← crea divs con position: absolute
        ├── fetchQuotes()  ← 11 llamadas Finnhub en paralelo (Promise.all)
        └── setInterval(fetchQuotes, 60_000)
```

### Flujo de actualización de precios (cada 60s)

```
fetchQuotes()
  ├── fetch Finnhub para cada ticker (Promise.all)
  ├── quoteHistory.push({ ts, data })   ← snapshot para el slider
  └── updateColors()                    ← actualiza backgroundColor + texto de % en tiles existentes
```

---

## Algoritmo de layout: Squarified Treemap

**Archivo:** `treemap.js`  
**Referencia:** Bruls, Huizing, van Wijk (2000)

### Por qué no CSS Grid
CSS Grid puede hacer filas/columnas proporcionales pero NO puede hacer que el **área** de una celda sea proporcional a un valor. Con 11 sectores que van de 32% a 1.8%, se necesita un treemap real.

### Cómo funciona `squarify(items, rect)`
1. Ordena items por peso descendente
2. Elige el lado más corto del rectángulo disponible como "strip"
3. Agrega items al strip mientras mejore el aspect ratio (más cuadrado = mejor)
4. Cuando agregar un item empeoraría el ratio, cierra el strip y recursea con el rectángulo restante

**Entrada:** `[{ ticker, sector, weight, ... }]` + `{ x, y, w, h }`  
**Salida:** mismos items con `{ x, y, w, h }` agregados (en píxeles)

### Posicionamiento
Los tiles usan `position: absolute` dentro de un contenedor `position: absolute` (el `#grid`). Las coordenadas vienen directamente del treemap. Se aplica un `TILE_GAP = 1.5px` por lado (3px de separación visual entre tiles).

### Problema de viewport al inicio
`offsetWidth/offsetHeight` del grid puede ser 0 en el evento `DOMContentLoaded` (especialmente en el preview headless y en algunas situaciones de iOS). Solución: `doLayout()` hace polling cada 50ms hasta que el grid tenga dimensiones reales, con un máximo de 100 intentos (5 segundos).

---

## Esquema de colores

Interpolación lineal entre stops fijos (igual que la app StocksDisplay de referencia):

| % cambio | Color |
|----------|-------|
| -3% | `rgb(100, 10, 10)` rojo oscuro |
| -2% | `rgb(160, 25, 25)` rojo |
| -1% | `rgb(190, 55, 55)` rojo claro |
|  0% | `rgb(65, 65, 65)` gris neutro |
| +1% | `rgb(55, 130, 55)` verde claro |
| +2% | `rgb(25, 160, 25)` verde |
| +3% | `rgb(10, 120, 10)` verde oscuro |

Función: `pctToColor(pct)` — clampea a [-3, 3], interpola RGB entre los dos stops adyacentes.

---

## Contenido de los tiles (font sizing dinámico)

El tamaño del texto se calcula en función de `minDim = min(tileW, tileH)`:

| Condición | Contenido mostrado |
|-----------|-------------------|
| `minDim > 120` | sector name + ticker + % cambio + peso% |
| `60 < minDim ≤ 120` | ticker + % cambio |
| `minDim ≤ 60` | solo ticker |

Font sizes: `minDim * factor` con mínimos absolutos para legibilidad.

---

## Pesos de sectores

### Fuente
- **Producción (GH Pages):** `sectors.json` estático en el repo
- **Desarrollo local:** proxy `/api/sectors` en `server.js` que scrapea us500.com
- **Fallback:** `DEFAULT_WEIGHTS` hardcodeado en `app.js`

### Scraping en `server.js`
La página `https://us500.com/sp500-companies-by-sector` es una app Next.js. Los datos están en el JSON embebido en `<script id="__NEXT_DATA__">`. El proxy extrae `props.pageProps.sectors.info.labelsData` y `holdData`.

### Actualización automática vía GitHub Action
`.github/workflows/update-sectors.yml` corre **lunes a viernes a las 14:00 UTC (10am ET)**. Hace el mismo scraping que el proxy local, actualiza `sectors.json` y commitea si hay cambios. También se puede disparar manualmente desde GitHub Actions.

### Tickers y mapeo
```
XLK  Information Technology     XLY  Consumer Discretionary
XLF  Financials                  XLC  Communication Services
XLV  Health Care                 XLI  Industrials
XLP  Consumer Staples            XLE  Energy
XLU  Utilities                   XLB  Materials
XLRE Real Estate
```

---

## API de precios: Finnhub

- **Endpoint:** `https://finnhub.io/api/v1/quote?symbol={ticker}&token={API_KEY}`
- **Campo usado:** `dp` (daily percent change)
- **API key:** hardcodeada en `app.js` (key personal, free tier: 60 calls/min)
- **Rate limit:** 11 calls/min → muy por debajo del límite
- **Llamadas:** en paralelo con `Promise.all`, error por ticker no interrumpe las demás

---

## Feature: History Slider

### Comportamiento
- Después de **2 snapshots** (≥ 2 minutos de ejecución), tocar la pantalla muestra un slider en la parte inferior
- Arrastrar el slider muestra el estado histórico (colores + porcentajes) de cada snapshot
- Soltar el slider (o tocar fuera del overlay) vuelve al dato live
- El slider y la etiqueta de hora son amarillos (`#ffe033`) para diferenciarse del heatmap

### Implementación
```
quoteHistory: [{ ts: Date, data: { TICKER: { dp } } }]   ← un entry por fetchQuotes()
```

**Eventos para abrir/cerrar:**
- `touchend` en `document` (mobile, sin delay de 300ms) → abre o cierra
- `click` en `document` (desktop) → abre o cierra
- `pointerup` en el slider → cierra (cuando el usuario suelta el dedo del slider)
- `lastTouchWasSlider` flag → evita que el `click` sintético post-touchend dispare dos veces

**Función `applySnapshot(data, withTransition)`:** aplica un snapshot a los tiles. Sin transición CSS mientras se arrastra (respuesta inmediata), con transición al volver al live.

### Por qué no `pointerup` solo
`pointerup` en `input[type=range]` es inconsistente en iOS/Safari. Se reemplazó con la combinación `touchend` (mobile) + `click` (desktop).

---

## Service Worker

**Cache name:** `spsectors-v2`  
Para forzar que los usuarios descarten cache viejo, hay que incrementar este número cada vez que se hacen cambios significativos al app shell.

**Estrategia:**
- `./` y archivos de app shell → cache-first (funciona offline)
- `finnhub.io` y `/api/` → always network (nunca cachear precios)

---

## Convenciones de código

- **Vanilla JS ES2020+** — no transpilación, el target es browsers modernos
- **Funciones declaradas** (`function foo()`) en lugar de arrow functions para el scope global, para que sean hoistables y accesibles entre sí sin orden de declaración
- **`let` para estado mutable**, `const` para configuración y datos inmutables
- **Sin clases** — el estado es módulo-level con variables sueltas
- **Comentarios de sección** con `// ── Título ──────` para separar bloques lógicos
- **Nombres descriptivos en inglés** para el código; comentarios en inglés

---

## Estado actual

### Hecho ✅
- Treemap proporcional con 11 sectores del S&P 500
- Colores por variación diaria (Finnhub API)
- Actualización de precios cada 60 segundos
- Pesos de sectores desde us500.com (proxy local / sectors.json / fallback)
- GitHub Action para actualizar sectores diariamente
- PWA installable (service worker v2, manifest, íconos)
- History slider con scrubbing temporal
- Font sizing dinámico por tamaño de tile
- Resize handler (recomputa treemap al cambiar orientación/tamaño)
- Deployado en GitHub Pages

### Pendiente / posibles mejoras 🔲
- Indicador visual mientras la app está esperando los primeros datos (loading state)
- El slider actualmente acumula snapshots sin límite — considerar un máximo (ej: últimas 8 horas = 480 snapshots)
- Edición de tickers (la app StocksDisplay original lo tenía; aquí los 11 sectores son fijos por diseño)
- Modo demo / datos simulados cuando no hay API key

---

## Problemas conocidos

### Viewport 0x0 en algunos entornos headless
En el preview tool del IDE y potencialmente en algunos browsers iOS con apertura "cold", `offsetWidth/offsetHeight` del grid puede reportar 0 en `DOMContentLoaded`. El poller de 50ms lo resuelve en la práctica. En un browser real de escritorio o móvil normal no se manifiesta.

### Service worker cache
Cada vez que se cambia `app.js`, `style.css` o `treemap.js`, se debe incrementar `CACHE_NAME` en `service-worker.js` (actualmente `spsectors-v2`) para que los usuarios existentes reciban el código nuevo. Sin esto, el browser sirve los archivos cacheados indefinidamente.

### us500.com scraping frágil
Si us500.com cambia la estructura de su `__NEXT_DATA__`, el scraping en `server.js` y en el GitHub Action falla. El `sectors.json` queda desactualizado pero la app sigue funcionando (con los pesos del último update exitoso o con el fallback hardcodeado). Los pesos del S&P 500 cambian lentamente (pocos puntos base por semana), así que el impacto es mínimo.

### GitHub Pages delay
Después de un `git push`, GitHub Pages tarda 1-3 minutos en publicar el nuevo `index.html`. Los usuarios con service worker activo además necesitan cerrar y reabrir la app para que el nuevo SW tome efecto.

### API key expuesta
La Finnhub API key está hardcodeada en `app.js` (visible en el código fuente público). Es una key personal del free tier. Si se agota o se revoca, los precios dejan de aparecer (los tiles quedan en gris neutro). Para rotar la key, editar `API_KEY` en `app.js` e incrementar `CACHE_NAME` en `service-worker.js`.

# TradeMetrics

Aplicación local para analizar historiales de futuros exportados desde distintos exchanges, con conexión opcional de solo lectura a MEXC.

## Uso

1. Abre la web publicada desde Google Sites/Netlify. Para trabajar localmente, ejecuta `Abrir analizador.bat`.
2. Selecciona el exchange de origen.
3. Pulsa **Seleccionar Excel de posiciones** y elige el archivo descargado desde ese exchange.
4. La app analiza las posiciones cerradas y muestra métricas, gráficos y detalle.

## Probar Netlify Functions localmente

Requiere Node.js 18.14 o superior y conexión a internet para que la consulta local llegue a MEXC.

1. Instala Netlify CLI una vez: `npm install -g netlify-cli`.
2. Abre PowerShell en la carpeta del proyecto y ejecuta `netlify login`.
3. Vincula la carpeta con el sitio Netlify existente: `netlify link` (selecciona el proyecto correcto cuando lo pregunte).
4. Inicia el entorno local: `netlify dev`.
5. Abre la dirección local que indique la CLI, normalmente `http://localhost:8888`, selecciona MEXC e ingresa una API key de solo lectura.
6. Al terminar, detén Netlify Dev con `Ctrl+C`.

Netlify Dev ejecuta la función en esta PC; al introducir las claves en este entorno local, no se envían a Netlify. La función sí firma solicitudes de lectura y consulta la API real de MEXC. No uses `Abrir analizador.bat` para probar esta ruta: ese acceso inicia el servidor local anterior, no el emulador de Netlify Functions.

La app acepta archivos Excel `.xlsx` y `.xls` y los procesa en el navegador. En la versión publicada, una Netlify Function firma las solicitudes de lectura a MEXC. Las claves se envían por HTTPS y se usan solo durante cada invocación; no se guardan en el código, en variables de entorno ni en una base de datos. La función no registra las claves ni el cuerpo de la solicitud. Netlify procesa cada invocación y su función requiere conexión a internet. La primera carga también necesita internet para las librerías de Excel y gráficos desde sus CDN.

## Conexión MEXC

1. En MEXC crea una API key exclusiva para TradeMetrics con permiso **View Order Details** (lectura de órdenes) únicamente. No habilites trading ni retiros.
2. Selecciona MEXC, ingresa la API Key y la Secret Key, y pulsa **Consultar posiciones cerradas**.
3. La web envía las claves por HTTPS a la función, que firma la solicitud con HMAC-SHA256. Las claves se borran de los campos al terminar; la función no las escribe en disco, base de datos ni logs de la aplicación.

La función consulta el historial por bloques de hasta 10 páginas por invocación para ajustarse a los límites de ejecución y respuesta de Netlify. Cada invocación procesa sus credenciales solo en memoria. Utiliza `closeProfitLoss`/`totalFee` cuando la respuesta los incluye; en respuestas antiguas, consulta órdenes completadas y las relaciona por `positionId`. Aplica el ajuste de financiación `holdFee` (un crédito reduce el fee neto). Las posiciones abiertas se excluyen.

## Métricas incluidas

- PNL neto, fees totales, promedio por trade y drawdown máximo.
- Tasa de acierto y profit factor.
- Curva de capital y resultados ganadoras/perdedoras.
- PNL por día, dirección, activo y hora de apertura.
- Tabla completa de trades cerrados.

La tabla también muestra la duración entre `Open Time` y `Close Time`, y el volumen de cierre tomado de `Closing Qty (Cont.)`.

El resultado analizado es PNL neto por trade: PNL bruto menos fees. En MEXC API la función usa el PNL bruto y fee total del historial de posiciones cuando están disponibles; para respuestas antiguas suma las comisiones maker/taker de las órdenes asociadas y resta los créditos de `holdFee`. Este valor neto se utiliza en las métricas, gráficos y tabla de resultados.

Lectores disponibles:

- MEXC: posiciones cerradas con `Status`.
- Binance: posiciones cerradas con `Opened`, `Closed` y `Closing PNL`. Si el archivo no incluye fees, usa fee `0`.
- BingX: historial de ejecuciones `Open`/`Close`; empareja aperturas y cierres por símbolo y dirección.
- Bitget: posiciones cerradas con `Opening time`, `Closed time`, `Position Pnl`, `Opening fee` y `Closing fee`.
- Bitunix: posiciones cerradas con `opening time`, `closed time`, `position pnl` y `position fee`.

El lector localiza automáticamente la fila de encabezados de cada formato, incluso cuando el exchange deja filas informativas antes de la tabla. El resultado analizado es PNL neto por trade: PNL reportado menos los fees detectados. También agrupa `GOLD(XAU)USDT` y `GOLD(XAUT)USDT` como un mismo activo.

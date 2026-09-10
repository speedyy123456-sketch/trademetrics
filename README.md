# TradeMetrics

Aplicación local para analizar historiales de futuros exportados desde distintos exchanges.

## Uso

1. Abre `index.html` con Chrome o Edge.
2. Selecciona el exchange de origen.
3. Pulsa **Seleccionar historial** y elige el archivo descargado desde ese exchange.
4. La app analiza las posiciones cerradas y muestra métricas, gráficos y detalle.

El procesamiento ocurre en el navegador. El archivo no se envía a ningún servidor. La app acepta archivos `.xlsx`, `.xls` y `.csv`. La primera vez necesita conexión a internet para cargar las librerías de Excel y gráficos desde sus CDN.

## Métricas incluidas

- PNL neto, fees totales, promedio por trade y drawdown máximo.
- Tasa de acierto y profit factor.
- Curva de capital y resultados ganadoras/perdedoras.
- PNL por día, dirección, activo y hora de apertura.
- Tabla completa de trades cerrados.

La tabla también muestra la duración entre `Open Time` y `Close Time`, y el volumen de cierre tomado de `Closing Qty (Cont.)`.

El resultado analizado es PNL neto por trade: `Realized PNL - Fee`. Este valor neto se utiliza en las métricas, gráficos y tabla de resultados.

Lectores disponibles:

- MEXC: posiciones cerradas con `Status`.
- Binance: posiciones cerradas con `Opened`, `Closed` y `Closing PNL`. Si el archivo no incluye fees, usa fee `0`.
- BingX: historial de ejecuciones `Open`/`Close`; empareja aperturas y cierres por símbolo y dirección.
- Bitget: posiciones cerradas con `Opening time`, `Closed time`, `Position Pnl`, `Opening fee` y `Closing fee`.
- Bitunix: posiciones cerradas con `opening time`, `closed time`, `position pnl` y `position fee`.

El lector localiza automáticamente la fila de encabezados de cada formato, incluso cuando el exchange deja filas informativas antes de la tabla. El resultado analizado es PNL neto por trade: PNL reportado menos los fees detectados. También agrupa `GOLD(XAU)USDT` y `GOLD(XAUT)USDT` como un mismo activo.

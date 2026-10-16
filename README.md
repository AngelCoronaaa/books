# Folio · Lector de libros

Aplicación web para buscar y leer libros en **español e inglés**, usando la
[Open Library API](https://openlibrary.org/developers/api), los escaneos de **Internet Archive** y la
[Google Books API](https://developers.google.com/books).
HTML, CSS y JavaScript puro, sin dependencias ni compilación.

## Cómo ejecutarla

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

(También funciona abriendo `index.html` directamente, pero un servidor local es más fiable.)

## Funciones

**Fuentes**
| Fuente | Qué aporta | Cómo se lee |
| --- | --- | --- |
| Open Library / Internet Archive (dominio público) | Clásicos completos | En el lector de Folio, con animación de hoja |
| Open Library (préstamo) | Libros modernos con derechos (Orwell, tecnología…) | Préstamo gratuito en openlibrary.org con cuenta |
| Google Books | Vista previa oficial de libros modernos y ebooks gratuitos | Visor de Google incrustado en Folio |

**Explorar**
- Buscador por título, autor o tema, con resultados mezclados de todas las fuentes.
- Filtros: idioma (ambos / español / inglés), fuente, disponibilidad (lectura completa gratis /
  gratis, préstamo o vista previa / todo), género (incluye tecnología, programación, distopías…),
  autor, rango de años y orden.
- Accesos rápidos por género, scroll infinito y filtros activos como etiquetas.
- Los filtros se guardan en la URL, así que puedes compartir una búsqueda.

**Ficha del libro**
- Portada, descripción, temas, idiomas y número de ediciones.
- Lista de ediciones escaneadas en el idioma elegido.
- Favoritos y enlace a Open Library.

**Lector**
- Dos modos: **Texto** (texto OCR repaginado y ajustable) y **Páginas** (escaneos originales).
- Animación 3D de pasar hoja: con clic, teclado (← →), rueda o **arrastrando la hoja** con el ratón o el dedo.
- Vista de una o dos páginas (automática según la pantalla) y sonido de página opcional.
- Temas claro, sepia y oscuro; tamaño de letra, tipografía, interlineado, márgenes y justificado.
- Marcadores (tecla B), búsqueda dentro del libro con resaltado, barra de progreso,
  tiempo de lectura restante y pantalla completa (tecla F).
- Recuerda en qué página te quedaste.

**Mi biblioteca**
- "Continuar leyendo" con el progreso de cada libro y tus favoritos (guardado en `localStorage`).

## Google Books API key (opcional)

Sin key, Google Books usa una cuota anónima compartida que a veces se agota (la app lo avisa y sigue
funcionando con Open Library). Para evitarlo, crea una key gratuita en
[Google Cloud Console](https://console.cloud.google.com/apis/library/books.googleapis.com),
restríngela por *HTTP referrer* a tu dominio y ponla en `js/config.js`.

## Estructura

```
index.html
css/styles.css
js/config.js   # configuración opcional (API key de Google Books)
js/store.js    # persistencia local (progreso, marcadores, favoritos, preferencias)
js/api.js      # Open Library + Internet Archive + Google Books
js/reader.js   # lector: paginación, animación de hoja, marcadores, búsqueda
js/app.js      # buscador, filtros, resultados, ficha y biblioteca
```

## Notas

- Los libros con derechos de autor nunca se descargan completos: se leen con el préstamo de Open Library
  o con la vista previa oficial de Google Books, que muestra solo una parte de las páginas.
- El modo Texto usa el OCR de Internet Archive, así que en libros antiguos puede tener errores;
  el modo Páginas muestra el escaneo original.

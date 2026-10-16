# Folio · Lector de libros

Aplicación web para buscar y leer libros de dominio público en **español e inglés**, usando la
[Open Library API](https://openlibrary.org/developers/api) y los escaneos de **Internet Archive**.
HTML, CSS y JavaScript puro, sin dependencias ni compilación.

## Cómo ejecutarla

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

(También funciona abriendo `index.html` directamente, pero un servidor local es más fiable.)

## Funciones

**Explorar**
- Buscador por título, autor o tema.
- Filtros: idioma (ambos / español / inglés), solo lectura gratuita, género, autor, rango de años y orden.
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

## Estructura

```
index.html
css/styles.css
js/store.js    # persistencia local (progreso, marcadores, favoritos, preferencias)
js/api.js      # Open Library + Internet Archive
js/reader.js   # lector: paginación, animación de hoja, marcadores, búsqueda
js/app.js      # buscador, filtros, resultados, ficha y biblioteca
```

## Notas

- Solo se pueden leer las ediciones de dominio público. Las de préstamo muestran un aviso con
  enlace a Internet Archive.
- El modo Texto usa el OCR de Internet Archive, así que en libros antiguos puede tener errores;
  el modo Páginas muestra el escaneo original.

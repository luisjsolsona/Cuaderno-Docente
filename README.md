# Cuaderno Docente

Aplicación web para crear y gestionar **cuadernos docentes interactivos**. Cada docente puede tener múltiples cuadernos organizados por ciclo formativo. Los datos se guardan automáticamente en el servidor.

---

## Características generales

- **Gestión de múltiples cuadernos** por docente con pantalla de inicio organizada por ciclo formativo
- Navegación por **4 pestañas** dentro de cada cuaderno:
  - **Temporalización** — Configuración del curso (fechas, festivos, FEOE, evaluaciones, módulos, RAs)
  - **Planificación** — Distribución de sesiones por RA (se genera desde Temporalización)
  - **Calendario** — Calendario completo con filtros por tipo, módulo, RA y observaciones
  - **Seguimiento** — Editor de seguimiento mensual por módulo
- Importación guiada de RAs y CEs desde CATEDU (Familia → Ciclo → Módulo), a través del servidor del centro con caché compartida (sin extensiones CORS ni proxies públicos)
- **Temporalizaciones de centro**: jefatura publica una única fuente de verdad (fechas del curso, festivos, FEOE y evaluaciones) y cada docente la aplica a sus cuadernos con un clic; si jefatura la modifica, el cuaderno avisa y permite actualizar
- **Importar/exportar temporalización** desde fichero `.json` o `.csv` (alternativa sin servidor central)
- Planificación automática ponderada de sesiones por RA
- Exportación a `.xlsx` (multihojas) y `.csv`
- **Duplicar cuadernos** con un clic
- Sistema de roles con 3 niveles: **Admin**, **Jefatura**, **Docente**
- Compatible con Docker en cualquier plataforma (Linux, Windows, macOS, CasaOS)

---

## Roles

### Admin
- Gestión de usuarios (crear, editar, eliminar)
- Panel de administración completo

### Jefatura
- Control total sobre todos los cuadernos (ver y editar)
- Publica y mantiene las **temporalizaciones de centro**
- Crea **cuadernos asignados a un docente** (panel admin → Cuadernos → *+ Nuevo cuaderno para un docente*), opcionalmente con la temporalización de centro ya aplicada
- Gestión de usuarios
- Acceso al panel de administración

### Docente
- Control total sobre sus propios cuadernos (los que crea él y los que le asigna jefatura)
- **Solo ve sus cuadernos**; los de otros docentes no son visibles ni accesibles
- Los cuadernos propios aparecen organizados por ciclo formativo

---

## Acceso por defecto

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | Administrador |

> ⚠️ Cambia la contraseña del administrador tras el primer acceso.

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/luisjsolsona/Cuaderno-Docente.git
cd Cuaderno-Docente
```

### 2. Arrancar con Docker Compose

```bash
docker compose up -d
```

La aplicación queda disponible en `http://localhost:9000`

### Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `PORT` | `3000` | Puerto interno del servidor |
| `JWT_SECRET` | *(inseguro)* | Secreto para firmar tokens JWT — **cámbialo en producción** |
| `DB_PATH` | `/data/cuaderno.db` | Ruta de la base de datos SQLite |
| `TZ` | `UTC` | Zona horaria |
| `CATEDU_TTL_DAYS` | `30` | Días que se conserva en caché cada página de CATEDU (RAs/CEs) |

---

## Navegación

- **Logo / cabecera** → Vuelve a la pantalla de inicio
- **← Cuadernos** → Vuelve a la lista de cuadernos desde dentro de un cuaderno
- **🧠 Proponer planificación por RAs** → Genera la planificación y abre la pestaña Planificación
- **⚡ Generar Calendario** → Genera el calendario y abre la pestaña Calendario
- **Calendario** → Filtros en tiempo real por tipo, módulo, RA y observaciones
- **📋 Seguimiento** → Editor mensual por módulo (se genera automáticamente según fechas y módulos)

---

## Uso del cuaderno docente

1. **Inicia sesión** → verás la pantalla con todos tus cuadernos agrupados por ciclo formativo
2. **Crea un cuaderno nuevo** o abre uno existente
3. En la pestaña **Temporalización**:
   - Indica el **Ciclo formativo** y el **Título** del cuaderno
   - Añade **Festivos**, **FEOE** y **Evaluaciones** (a mano o importando un fichero, ver abajo)
   - Define los **Módulos** (día de la semana y horario)
   - Añade **RAs y CEs** (manualmente o importando desde CATEDU)
4. Pulsa **🧠 Proponer planificación por RAs** → abre la pestaña **Planificación**
5. Pulsa **⚡ Generar Calendario** → abre la pestaña **Calendario**
6. En **Calendario**: filtra filas, edita Observaciones y RA Planificado, exporta a `.xlsx` o `.csv`
7. En **Seguimiento**: escribe el seguimiento mensual para cada módulo

---

## Temporalización de centro (fuente única)

1. **Jefatura/Admin** → panel de administración → pestaña **📅 Temporalizaciones** → **+ Nueva temporalización**. Las fechas de inicio y fin de curso se escriben en el formulario; festivos, FEOE y evaluaciones se cargan desde un fichero `.json`/`.csv` (formato de abajo) o copiando de uno de sus propios cuadernos.
   - Crea **una general** por curso escolar (ciclo vacío) con las fechas del curso y los **festivos, que son iguales para todos**.
   - Crea **una por nivel** (CFGB/FP Básica, CFGM, CFGS, Curso de especialización) solo con lo que difiere: la **FEOE** y las evaluaciones del nivel. Al aplicarse hereda fechas y festivos de la general del mismo curso.
2. **Docente** → en su cuaderno, pestaña **Temporalización** → desplegable *Temporalización del centro* → **📌 Aplicar del centro**. Se preselecciona la del nivel deducido del ciclo del cuaderno (p. ej. "FPB Informática" → CFGB, "1º SMR CFGM" → CFGM); si no se deduce, elige la del desplegable. Se reemplazan los festivos, FEOE y evaluaciones del cuaderno por los oficiales (después puede añadir los suyos).
3. Si jefatura **modifica el contenido** de una temporalización (o de la general de la que hereda), los cuadernos que la aplicaron muestran un aviso 🔔 con botón **Actualizar ahora**. Los cuadernos nunca se modifican solos: el docente decide cuándo actualizar. Cambiar solo el nombre/curso/ciclo no genera aviso.
4. Tras aplicar o actualizar hay que volver a pulsar **⚡ Generar Calendario**.

Endpoints: `GET /api/temporalizaciones` (todos los usuarios), `POST/PUT/DELETE /api/temporalizaciones/:id` (admin/jefatura).

---

## Importación de RAs desde CATEDU

El navegador no puede leer `centrosdocentes.catedu.es` directamente (CORS). El servidor hace de proxy: `GET /api/catedu?url=…` (solo ese dominio, solo HTTPS, usuario autenticado) descarga la página y la guarda en la tabla `catedu_cache`. Cada módulo se consulta una vez para todo el centro; las siguientes importaciones son inmediatas. Si CATEDU no responde y hay copia antigua, se sirve la copia. Jefatura puede vaciar la caché desde el panel admin (pestaña Cuadernos) o con `DELETE /api/catedu/cache`. Si el proxy falla, el cliente conserva los antiguos fallbacks (acceso directo y proxies públicos).

---

## Importar temporalización desde fichero

En la pestaña **Temporalización** → tarjeta **📌 Fechas del curso y festivos** → desplegable *Más opciones* puedes cargar de golpe los pasos 1–4 desde un fichero. Se admiten dos formatos:

**CSV** (separador `;`, `,` o tabulador; fechas `AAAA-MM-DD` o `DD/MM/AAAA`):

```csv
tipo;inicio;fin;descripcion;bloquea
curso;15/09/2026;23/06/2027;Curso 2026-2027;
festivo;12/10/2026;;Fiesta Nacional;
festivo;23/12/2026;07/01/2027;Navidad;
feoe;15/03/2027;11/06/2027;FEOE 2º curso;
evaluacion;18/12/2026;;1ª Evaluación;si
```

| Columna | Valores |
|---------|---------|
| `tipo` | `curso`, `festivo`, `feoe`, `evaluacion` |
| `inicio` / `fin` | Rango de fechas (`fin` opcional = mismo día) |
| `descripcion` | Motivo / empresa / nombre de la evaluación |
| `bloquea` | Solo para `evaluacion`: `si` / `no` |

También se acepta un listado de festivos sin columna `tipo` (todas las filas se tratan como festivo), como `festivos_zaragoza_2026-27.csv` incluido en el repo:

```csv
fecha_inicio,fecha_fin,descripcion,ambito
2026-10-12,2026-10-12,Fiesta Nacional / Día del Pilar,nacional
```

Una fila con `ambito` = `curso` (o descripción "inicio de curso" / "fin de curso") fija las fechas del curso.

El botón **📄 Plantilla .csv** descarga la temporalización de Zaragoza 2026-27 (fechas oficiales de FP presencial 10/09/2026 → 18/06/2027 y festivos; FEOE y evaluaciones de ejemplo a ajustar).

**Botón 📅 Calendario oficial Aragón 2026-27** (en el formulario de temporalización de centro y en la tarjeta de importar del cuaderno): carga las fechas de FP presencial (10/09/2026 → 18/06/2027), las festividades nacionales/autonómicas, las vacaciones de Navidad y Semana Santa y los días no lectivos de la provincia elegida (Zaragoza, Huesca o Teruel). Para Zaragoza incluye además los dos festivos locales de la capital (San Valero y Cincomarzada). Los datos están en la constante `CALENDARIO_OFICIAL` de `index.html`; para el curso siguiente basta con actualizarla. Copia del PDF oficial en `docs_calendario_escolar_2026-2027_educaragon.pdf`.

**Fuente oficial curso 2026-27:** [Calendario escolar 2026-2027 (Educaragon, PDF)](https://educa.aragon.es/documents/20126/2820569/Calendario+Escolar+2026-2027+-+Educaragon.pdf/50447fc8-06ec-56ce-0fb0-3906719f4b18?t=1786103855636) · [Resolución de 29 de abril de 2025, BOA nº 88 de 12/05/2025](https://www.boa.aragon.es/cgi-bin/EBOA/BRSCGI?CMD=VEROBJ&MLKOB=1392479120808).

Los festivos y FEOE de varios días se muestran como un único chip de rango (`2026-12-23 → 2027-01-06 (15 d)`); la ✕ elimina el rango completo.

**JSON** (el mismo que genera **📤 Exportar**):

```json
{
  "inicio": "2026-09-15", "fin": "2027-06-23",
  "festivos": [{ "inicio": "2026-12-23", "fin": "2027-01-07", "motivo": "Navidad" }],
  "feoes": [{ "inicio": "2027-03-15", "fin": "2027-06-11", "empresa": "FEOE 2º" }],
  "evaluaciones": [{ "fecha": "2026-12-18", "desc": "1ª Evaluación", "bloquea": true }]
}
```

Junto al botón de importar eliges si **reemplazar** los festivos/FEOE/evaluaciones actuales o **añadir** a los existentes; antes de aplicar se muestra un resumen y avisa de las entradas que quedan fuera de las fechas del curso. Exportar funciona también en modo lectura (jefatura viendo un cuaderno ajeno). Tras importar, vuelve a pulsar **⚡ Generar Calendario**. El botón **📄 Plantilla .csv** descarga un ejemplo listo para editar.

---

## Stack técnico

- **Backend**: Node.js + Express
- **Base de datos**: SQLite (better-sqlite3)
- **Auth**: JWT + bcrypt
- **Frontend**: HTML + CSS + JavaScript vanilla (sin dependencias)
- **Contenedor**: Docker Alpine (imagen ~60 MB)

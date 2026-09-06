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
- Importación guiada de RAs y CEs desde CATEDU (Familia → Ciclo → Módulo)
- **Importar/exportar temporalización** (fechas del curso, festivos, FEOE y evaluaciones) desde un fichero `.json` o `.csv`, para repartir un único calendario a todo el departamento
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
- Gestión de usuarios
- Acceso al panel de administración

### Docente
- Control total sobre sus propios cuadernos
- Puede **ver** los cuadernos de otros docentes en modo lectura
- Los cuadernos propios aparecen organizados por ciclo formativo
- Sección "Cuadernos de compañeros" en la pantalla de inicio

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

## Importar temporalización desde fichero

En la pestaña **Temporalización** → **📥 Importar / exportar temporalización** puedes cargar de golpe los pasos 1–4. Se admiten dos formatos:

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

**JSON** (el mismo que genera **📤 Exportar**):

```json
{
  "inicio": "2026-09-15", "fin": "2027-06-23",
  "festivos": [{ "inicio": "2026-12-23", "fin": "2027-01-07", "motivo": "Navidad" }],
  "feoes": [{ "inicio": "2027-03-15", "fin": "2027-06-11", "empresa": "FEOE 2º" }],
  "evaluaciones": [{ "fecha": "2026-12-18", "desc": "1ª Evaluación", "bloquea": true }]
}
```

Al importar se pregunta si **reemplazar** los datos actuales o **añadir** a los existentes. El botón **📄 Plantilla .csv** descarga un ejemplo listo para editar.

---

## Stack técnico

- **Backend**: Node.js + Express
- **Base de datos**: SQLite (better-sqlite3)
- **Auth**: JWT + bcrypt
- **Frontend**: HTML + CSS + JavaScript vanilla (sin dependencias)
- **Contenedor**: Docker Alpine (imagen ~60 MB)

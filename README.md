# Cuaderno Docente

Aplicación web para crear y gestionar **cuadernos docentes interactivos**. Cada docente puede tener múltiples cuadernos, cada uno con calendario de sesiones, módulos, festivos, FEOE, evaluaciones y Resultados de Aprendizaje. Los datos se guardan automáticamente en el servidor.

---

## Características generales

- **Gestión de múltiples cuadernos** por docente con pantalla de inicio propia
- Navegación por pestañas dentro de cada cuaderno: **Temporalización**, **Planificación**, **Calendario**
- Generador de calendarios docentes con módulos, festivos, FEOE y evaluaciones
- Importación guiada de RAs y CEs desde CATEDU mediante asistente por pasos (Familia → Ciclo → Módulo)
- Planificación automática ponderada de sesiones por RA (se abre en su propia pestaña)
- Exportación a `.xlsx` (multihojas) y `.csv`
- Guardado automático en sesión (sin perder datos al recargar)
- Edición online del calendario generado (observaciones y RA planificado)
- Sistema de usuarios con roles (Administrador / Docente)
- Panel de administración para gestionar docentes y ver sus cuadernos
- Compatible con Docker en cualquier plataforma (Linux, Windows, macOS, CasaOS)

---

## Acceso por defecto

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `admin` | `admin123` | Administrador |

> ⚠️ Cambia la contraseña del administrador tras el primer acceso.

---

## Roles

### Administrador
- Gestiona docentes (crear, editar, eliminar)
- Visualiza el cuaderno de cualquier docente (solo lectura)
- Tiene acceso a su propio cuaderno desde el encabezado

### Docente
- Ve todos sus cuadernos en la pantalla de inicio al hacer login
- Crea, abre y elimina cuadernos desde la pantalla de inicio
- Dentro de cada cuaderno, navega entre 3 pestañas:
  - **Temporalización** — Configuración del curso (fechas, festivos, FEOE, evaluaciones, módulos, RAs)
  - **Planificación** — Distribución de sesiones por RA (se genera desde Temporalización)
  - **Calendario** — Calendario completo de sesiones (se genera desde Temporalización)
- Exporta a Excel / CSV

---

## Navegación

- **Logo / cabecera** → Vuelve a la pantalla de inicio (lista de cuadernos)
- **← Cuadernos** → Botón dentro de cada cuaderno para volver a la lista
- **🧠 Proponer planificación por RAs** → Genera la planificación y abre la pestaña Planificación
- **⚡ Generar Calendario** → Genera el calendario y abre la pestaña Calendario

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

## Uso del cuaderno docente

1. **Inicia sesión** → verás la pantalla con todos tus cuadernos
2. **Crea un cuaderno nuevo** o abre uno existente
3. En la pestaña **Temporalización**:
   - Indica **Fechas del curso**
   - Añade **Festivos**, **FEOE** y **Evaluaciones**
   - Define los **Módulos** (día de la semana y horario)
   - Añade **RAs y CEs** (manualmente o importando desde CATEDU)
4. Pulsa **🧠 Proponer planificación por RAs** → se genera la distribución de sesiones y abre la pestaña **Planificación**
5. Pulsa **⚡ Generar Calendario** → se genera el calendario completo y abre la pestaña **Calendario**
6. En la pestaña **Calendario**: edita **Observaciones** y **RA Planificado** directamente en la tabla, y exporta con **⬇ .xlsx** o **⬇ .csv**

---

## Stack técnico

- **Backend**: Node.js + Express
- **Base de datos**: SQLite (better-sqlite3)
- **Auth**: JWT + bcrypt
- **Frontend**: HTML + CSS + JavaScript vanilla (sin dependencias)
- **Contenedor**: Docker Alpine (imagen ~60 MB)

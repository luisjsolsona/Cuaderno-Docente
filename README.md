# Cuaderno Docente

Aplicación web para crear y gestionar **cuadernos docentes interactivos**. Cada docente tiene su propio cuaderno con calendario de sesiones, módulos, festivos, FEOE, evaluaciones y Resultados de Aprendizaje. Los datos se guardan automáticamente en el servidor.

---

## Características generales

- Generador de calendarios docentes con módulos, festivos, FEOE y evaluaciones
- Importación automática de RAs y CEs desde el catálogo CATEDU
- Planificación automática ponderada de sesiones por RA
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
- Tiene acceso a su propio cuaderno

### Docente
- Crea y edita su propio cuaderno docente
- Genera el calendario de sesiones
- Exporta a Excel / CSV

---

## Instalación con Docker

### Docker Compose (recomendado)

```bash
docker compose up -d
```

La aplicación queda disponible en `http://localhost:7001`

### Docker Run

```bash
docker run -d \
  --name cuaderno-docente \
  -p 7001:3000 \
  -v cuaderno_data:/data \
  -e JWT_SECRET=tu_secreto_seguro \
  -e TZ=Europe/Madrid \
  ghcr.io/luisjsolsona/cuaderno-docente:latest
```

### Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `PORT` | `3000` | Puerto interno del servidor |
| `JWT_SECRET` | *(inseguro)* | Secreto para firmar tokens JWT — **cámbialo en producción** |
| `DB_PATH` | `/data/cuaderno.db` | Ruta de la base de datos SQLite |
| `TZ` | `UTC` | Zona horaria |

---

## Uso del cuaderno docente

1. **Fechas del curso** — Indica inicio y fin del año académico
2. **Festivos** — Añade días o rangos de días festivos con motivo opcional
3. **FEOE** — Marca periodos de Formación en Empresa u Organismo Equiparado
4. **Evaluaciones** — Añade fechas de evaluación (opcionalmente bloqueantes)
5. **Módulos** — Define cada módulo con el día de la semana y horario
6. **RAs y CEs** — Importa automáticamente desde CATEDU o añade manualmente
7. Pulsa **⚡ Generar calendario** — El resultado se muestra y guarda en el servidor
8. Edita **Observaciones** y **RA Planificado** directamente en la tabla
9. Exporta con **⬇ .xlsx** o **⬇ .csv**

---

## Stack técnico

- **Backend**: Node.js + Express
- **Base de datos**: SQLite (better-sqlite3)
- **Auth**: JWT + bcrypt
- **Frontend**: HTML + CSS + JavaScript vanilla (sin dependencias)
- **Contenedor**: Docker Alpine (imagen ~60 MB)

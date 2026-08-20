# Lotes en espera de licencia

Los lotes de este directorio están **listos para sembrar pero no sembrados**. Provienen de
libros de problemas cuya licencia todavía se está gestionando; el material se prepara por
adelantado para que el día que la licencia llegue, sembrar sea un solo comando.

El seeder de arranque solo lee `db/data/collected/`, así que nada de aquí entra a producción
por sí solo. Para sembrar un lote una vez autorizado, desde `apps/api/`:

```bash
DOTENV_CONFIG_PATH=../../.env ts-node -r dotenv/config -r tsconfig-paths/register \
  src/scripts/seed-gap-topic-with-image.ts src/db/data/license-pending/<lote>.json
DOTENV_CONFIG_PATH=../../.env ts-node -r dotenv/config -r tsconfig-paths/register \
  src/scripts/seed-image-question.ts src/db/data/license-pending/<lote>-image.json
```

Reglas que se respetan igual, sin importar la licencia:

- La clave sale siempre de la obra misma. Ninguna respuesta se deduce.
- Nada generado por IA: se descarta por fiabilidad, no por licencia.

| Lote | Libro | Repo | URL | Licencia (citada) | Preguntas | Extraído |
| --- | --- | --- | --- | --- | --- | --- |

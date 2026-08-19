# Por qué la suite e2e es lenta, y qué la acelera (2026-08-18)

Research pedido tras ver el `pnpm test` e2e colgar >600s. Todo lo de abajo está **medido**
en esta máquina (wall-clock real), no citado.

## Dónde se va el tiempo (medido)

| Corte | Tiempo | Por test |
|---|---|---|
| 54 tests SIN Typst (cross-tenant) | 1.7s | **0.03s** |
| 14 tests que compilan Typst REAL (exam-versions) | 8.7s | **0.62s** |
| 1 archivo chico (dashboard, 3 tests) | 4.88s real / 1.58s jest | ~3.3s de overhead fijo |

Tres costos, en orden de impacto:

1. **Overhead fijo por archivo (~3.3s)**: `ts-jest` type-checkea + transpila cada archivo, y
   cada suite bootea el AppModule ENTERO (Nest DI, pino, throttler, pool de pg, conexión
   BullMQ a Redis). 26 archivos = 26 boots.
2. **Compilación Typst real**: 20× más lenta por test (0.62s vs 0.03s). Es I/O de subprocesos
   `typst`, correcto que sea lento — es lo que esos tests verifican de verdad.
3. **`--runInBand` sobre 26 archivos en UN proceso**: acumula 26 AppModules con sus workers de
   BullMQ y conexiones a Redis sin teardown completo entre archivos. El proceso se ahoga en la
   cola — de ahí que el full run pase de 600s aunque cada suite aislada sea de segundos.

## Palancas, ordenadas por relación beneficio/riesgo

### ✅ 1. `isolatedModules: true` en ts-jest — HECHO (`fbdce37`)
Salta el type-check cruzado en el transform (lo hace igual `tsc -p tsconfig.build.json` y el
editor). Mismo transformer, sin riesgo para la DI.
**Medido**: dashboard 4.88→3.02s (−38%), cross-tenant 3.84→2.95s (−23%). ~1.8s por suite, ~45s
sobre las 26, y aplica a las 3 invocaciones de jest del CI. 875 non-e2e y e2e siguen verdes.

### 🟡 2. `@swc/jest` en vez de ts-jest — NO aplicado
Transform Rust, 2–10× más rápido que ts-jest. **Pero**: SWC mangostea la metadata de
decoradores de NestJS (`emitDecoratorMetadata`), lo que rompe la inyección de dependencias si
no se configura `.swcrc` con `keepClassNames` + `decoratorMetadata: true`, y aun así es frágil
en tests de integración. `isolatedModules` ya captura buena parte de la ganancia sin ese
riesgo. Reevaluar solo si el transform sigue siendo el cuello después de las otras palancas.

### 🟡 3. Bootear el AppModule UNA vez (globalSetup) en vez de por archivo — NO aplicado
La ganancia estructural más grande (mata los 26 boots), y el cambio más invasivo: los 26
archivos hacen su propio `Test.createTestingModule` con puertos/mocks distintos (el
`QuestionGeneratorPort` scripteado cambia por suite). Requiere una app compartida + limpieza
de DB por test en `setupFilesAfterEnv`. Alto valor, alto costo — es un proyecto, no un fix.

### 🟡 4. Quitar `--runInBand` de e2e — EN MEDICIÓN
El `jest-setup.ts` ya aísla el namespace de BullMQ por archivo (prefijo `bull-test-w<N>-p<PID>-<uuid>`)
justamente para que las suites sean paralelo-seguras. `--runInBand` estaba por el proyecto
`db-serial` (que reescribe la taxonomía global), NO por e2e. Correr e2e con `--maxWorkers=N`
usa procesos worker que reciclan, evitando la acumulación del punto 3.
**Cuidado medido**: en 5 suites sin Typst, paralelo (6.77s) ≈ serie (6.15s) — la contención
sobre un Postgres compartido come la ganancia en lotes chicos. El upside real está en el total
(evitar el ahogo del proceso único), que es lo que esta medición decide.

## Recomendación

`isolatedModules` ya está. Si la medición de la palanca 4 confirma que `--maxWorkers=4`
completa el full e2e de forma fiable y más rápido que el runInBand, cambiar el script de test.
Las palancas 2 y 3 quedan documentadas para cuando el transform o los boots vuelvan a ser el
cuello — no antes, para no pagar su riesgo sin necesidad.

## Fuentes
- https://www.jameslmilner.com/posts/speeding-up-typescript-jest-tests/ (ts-jest vs @swc/jest vs vitest, benchmarks)
- https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/
- http://www.inextenso.dev/speed-up-nestjs-test-executions-with-jest
- https://dev.to/kasir-barati/when-e2e-tests-in-nestjs-gives-me-a-headache-59ed (BullMQ + @Processor en e2e)

## Resultado (aplicado)

### Palanca 4 — `--maxWorkers=4` en vez de `--runInBand` — HECHO
La medición decidió: el full e2e con `--runInBand` **cuelga >600s** (26 AppModules en un
proceso, workers de BullMQ acumulándose), mientras que con `--maxWorkers=4` cada worker recicla
su proceso y el total es **~18s, dos rondas seguidas verdes** (266/266).

Destapó un hueco de aislamiento genuino, no un flake: un test creaba una pregunta central
(`tenantId=null`, visible a todos por diseño) sobre el `courseId` compartido a nivel de archivo
y `primaria_1`, y exigía que el pool fuera EXACTAMENTE esa pregunta. Sin `--runInBand` el orden
cambió y la central de una suite hermana se coló. Arreglado dándole a ese test su propio curso
+ topic, provablemente aislado — no bajando la exigencia del assert.

**Antes**: `pnpm test` e2e sin terminar en 10 min. **Después**: ~18s. El script de test y el
comentario del CI-manual actualizados.

## Números finales

| | Antes | Después |
|---|---|---|
| Full e2e (`pnpm test`) | >600s (colgaba) | **~18s** |
| Overhead por suite (ts-jest) | ~3.3s | ~1.5s (isolatedModules) |
| dashboard.e2e (3 tests) | 4.88s | 3.02s |

Dos cambios, ambos medidos: `isolatedModules` (transform) + `--maxWorkers=4` (paralelismo real
sobre el aislamiento por-archivo que ya existía). Sin swc, sin reescribir el boot — esas quedan
documentadas para cuando hagan falta.

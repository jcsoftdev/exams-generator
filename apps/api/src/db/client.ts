import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolvePoolConfig } from "./env";
import * as schema from "./schema";

/** Settings and the reasoning behind each live in `resolvePoolConfig` (`./env`). */
export const pool = new Pool(resolvePoolConfig());

export const db = drizzle(pool, { schema });

/** The concrete Drizzle database type — used for constructor injection (see `DRIZZLE_DB`). */
export type Database = typeof db;

/**
 * DI token for the Drizzle `db` instance. Repositories inject this via the
 * constructor instead of importing the `db` singleton directly, so the
 * database dependency is explicit and a test can bind a fake. The token is
 * provided (`{ provide: DRIZZLE_DB, useValue: db }`) by each module that
 * instantiates a repository (bank, exams).
 */
export const DRIZZLE_DB = Symbol("DRIZZLE_DB");

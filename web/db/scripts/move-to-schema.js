'use strict';

// One-time (idempotent) migration of the Sequelize deployment out of `public`
// into its own schema (DB_SCHEMA, default `app`).
//
// Run with:  npm run db:schema:move
//
// Moves: tables, ENUM types and sequences owned by those tables, including the
// `SequelizeMeta` bookkeeping table, so sequelize-cli keeps its migration
// history. Safe to re-run: it only touches objects still living in `public`.

const path = require('path');

try {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {
    // dotenv not installed; rely on environment already being populated
}

const { Client } = require('pg');

const dialect = process.env.DB_DIALECT || 'postgres';
const target = process.env.DB_SCHEMA || 'app';

// Tables owned by Sequelize (see db/migrations/*-init-schema.ts).
const TABLES = [
    'AgentTasks',
    'Columns',
    'Comments',
    'Groups',
    'IssueLabels',
    'Issues',
    'Labels',
    'Logs',
    'Projects',
    'SequelizeMeta',
];

async function main() {
    if (dialect !== 'postgres') {
        console.log(`DB_DIALECT=${dialect} — schemas only apply to postgres, nothing to do.`);
        return;
    }
    if (target === 'public') {
        console.log('DB_SCHEMA=public — already in the default schema, nothing to do.');
        return;
    }

    const client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'postgres',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    await client.connect();
    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${target}"`);

        const { rows: tables } = await client.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ANY($1)
             ORDER BY table_name`,
            [TABLES]
        );
        for (const { table_name } of tables) {
            await client.query(`ALTER TABLE "public"."${table_name}" SET SCHEMA "${target}"`);
            console.log(`moved table  public.${table_name} -> ${target}.${table_name}`);
        }

        const { rows: types } = await client.query(
            `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname LIKE 'enum\\_%'
             ORDER BY 1`
        );
        for (const { typname } of types) {
            await client.query(`ALTER TYPE "public"."${typname}" SET SCHEMA "${target}"`);
            console.log(`moved type   public.${typname} -> ${target}.${typname}`);
        }

        // Sequences follow their owning table explicitly (belt and braces).
        const { rows: seqs } = await client.query(
            `SELECT c.relname AS seq
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
             JOIN pg_class t ON d.refobjid = t.oid
             JOIN pg_namespace tn ON t.relnamespace = tn.oid
             WHERE c.relkind = 'S' AND n.nspname = 'public'
               AND tn.nspname = $1
             ORDER BY 1`,
            [target]
        );
        for (const { seq } of seqs) {
            await client.query(`ALTER SEQUENCE "public"."${seq}" SET SCHEMA "${target}"`);
            console.log(`moved seq    public.${seq} -> ${target}.${seq}`);
        }

        const { rows: left } = await client.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ANY($1)
             ORDER BY table_name`,
            [TABLES]
        );
        if (left.length) {
            throw new Error(`still in public: ${left.map((r) => r.table_name).join(', ')}`);
        }

        const { rows: now } = await client.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = $1 ORDER BY table_name`,
            [target]
        );
        console.log(`\nschema "${target}" now holds ${now.length} table(s): ${now.map((r) => r.table_name).join(', ')}`);
        console.log('Done.');
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
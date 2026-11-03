const path = require("path");

// Load .env so sequelize-cli sees variables even when run standalone
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
} catch {
  // dotenv not installed; rely on environment already being populated
}

const dialect = process.env.DB_DIALECT || "postgres";
const base = {
  dialect,
  logging: process.env.DB_LOGGING === "true" ? console.log : false,
};

// Build a single config object so we don't repeat vars in every env
const pgConfig = {
  ...base,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "postgres",
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  // Sequelize-protocol-level SSL default: off for local dev
  dialectOptions: process.env.DB_SSL === "true"
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : undefined,
};

module.exports = {
  development: dialect === "sqlite"
    ? { ...base, storage: process.env.DB_STORAGE || "./db/database.sqlite" }
    : pgConfig,

  test: dialect === "sqlite"
    ? { ...base, storage: process.env.DB_STORAGE_TEST || "./db/database_test.sqlite" }
    : { ...pgConfig, database: process.env.DB_NAME_TEST || `${pgConfig.database}_test` },

  production: dialect === "sqlite"
    ? { ...base, storage: process.env.DB_STORAGE_PROD || "./db/database_production.sqlite" }
    : { ...pgConfig, database: process.env.DB_NAME_PROD || `${pgConfig.database}_prod` },
};

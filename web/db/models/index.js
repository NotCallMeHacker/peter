'use strict';

// Allow requiring TypeScript model files from Node / sequelize-cli
// Install ts-node first: npm install -D ts-node
// eslint-disable-next-line no-useless-catch
try {
    require('ts-node/register');
} catch {
    // ts-node not installed — .ts models will not load in plain Node
}

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;
if (config.use_env_variable) {
    sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
    sequelize = new Sequelize(
        config.database,
        config.username,
        config.password,
        config
    );
}

const isModelFile = (file) => {
    return (
        file.indexOf('.') !== 0 &&
        file !== basename &&
        (file.slice(-3) === '.js' || file.slice(-3) === '.ts') &&
        file.indexOf('.test.js') === -1 &&
        file.indexOf('.test.ts') === -1 &&
        file.indexOf('.d.ts') === -1 &&
        file !== 'index.ts'
    );
};

fs.readdirSync(__dirname)
    .filter(isModelFile)
    .forEach((file) => {
        const imported = require(path.join(__dirname, file));
        const modelFactory = imported && imported.default ? imported.default : imported;
        const model = modelFactory(sequelize, Sequelize.DataTypes);
        db[model.name] = model;
    });

Object.keys(db).forEach((modelName) => {
    if (db[modelName].associate) {
        db[modelName].associate(db);
    }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;

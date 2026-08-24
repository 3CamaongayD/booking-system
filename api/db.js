const postgres = require('postgres');

let sql;
function getDb() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1, prepare: false });
  }
  return sql;
}

module.exports = { getDb };

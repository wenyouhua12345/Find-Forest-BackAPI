const { Pool, types } = require('pg')

// 配置bytea类型的处理
types.setTypeParser(types.builtins.BYTEA, (val) => {
  return val
})

//require('dotenv').config() //读取当前目录下.env文件中的环境变量,然后存到process.env中,因为在入口文件已经调用了
//所以这个文件不用

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '113.219.237.121',
  database: process.env.DB_NAME || 'user_profile',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 40693,
  max: 35,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// 测试数据库连接，数据库的一个监听器成功了就是connect，error等
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database')
})

pool.on('error', (err) => {
  console.error('Database connection error:', err)
})

module.exports = pool
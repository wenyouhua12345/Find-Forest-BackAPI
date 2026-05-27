const fs = require('fs')
const path = require('path')

const { Client } = require('pg');
require('dotenv').config();

async function initializeDatabase() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'forestry_system'
  });

  try {
    await client.connect();
    console.log('PostgreSQL 连接成功，开始初始化数据库...');

    // 创建用户表 - 确保包含所有必要字段
    const createTableSQL = `
      -- 删除已存在的表（谨慎使用）
      -- DROP TABLE IF EXISTS users;
      
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255),
        nickname VARCHAR(100),
        avatar VARCHAR(500),
        wechat_openid VARCHAR(100) UNIQUE,
        phone VARCHAR(20),
        email VARCHAR(100),
        real_name VARCHAR(50),
        department VARCHAR(100),
        position VARCHAR(100),
        user_type SMALLINT DEFAULT 1,
        status SMALLINT DEFAULT 1,
        register_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_time TIMESTAMP,
        login_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 创建索引
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid);
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);
    `;

    await client.query(createTableSQL);
    console.log('用户表创建/检查成功');

    // 创建更新时间触发器
    const triggerSQL = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `;

    await client.query(triggerSQL);
    console.log('触发器创建成功');

    


    // 插入测试数据
    const insertDataSQL = `
      INSERT INTO users (username, password, nickname, phone, email, real_name, department, position, user_type) 
      VALUES 
        ('admin', '123456', '系统管理员', '13800138000', 'admin@forestry.com', '张管理员', '林业局信息中心', '系统管理员', 2),
        ('zhangsan', '123456', '张三', '13900139000', 'zhangsan@forestry.com', '张三', '林业局资源科', '科员', 1),
        ('lisi', '123456', '李四', '13700137000', 'lisi@forestry.com', '李四', '林业局保护科', '科长', 1)
      ON CONFLICT (username) DO NOTHING;
    `;

    const userxin=`create table users(id varchar(50), name varchar(50), role varchar(50), employee_id varchar(50),
department varchar(50), phone varchar(50), email varchar(50));`

    const insertResult = await client.query(insertDataSQL);
    console.log('测试数据插入完成，影响行数:', insertResult.rowCount);

    // 验证表结构
    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position;
    `);

    console.log('用户表结构:');
    tableInfo.rows.forEach(col => {
      console.log(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    console.log('数据库初始化完成！');

  } catch (error) {
    console.error('数据库初始化失败:', error);
  } finally {
    await client.end();
  }
}

// 执行初始化
initializeDatabase();
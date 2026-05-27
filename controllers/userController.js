const pool = require('../config/database')
const fs = require('fs')
const path = require('path')

const axios = require('axios');
const bcrypt = require('bcrypt') 
const schedule = require('node-schedule');

const crypto = require("crypto");

const safeDeleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)   //unlinkSync同步删除文件
      console.log(`✓ 已删除临时文件: ${path.basename(filePath)}`)
    }
  } catch (error) {
    console.error(`✗ 删除文件失败 ${filePath}:`, error.message)
  }
}


// 测试数据库连
exports.testDbConnection = async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    
    // 测试用户表
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'users'
    `);
    
    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    
    return res.json({
      code: 200,
      message: '数据库连接正常',
      data: {
        currentTime: result.rows[0].current_time,
        usersTableExists: tableCheck.rows.length > 0,
        userCount: userCount.rows[0].count
      }
    });
  } catch (error) {
    console.error('数据库连接测试失败:', error);
    return res.status(500).json({
      code: 500,
      message: '数据库连接失败',
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};


//用户登录
exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      code: 400,
      message: '用户名和密码不能为空'
    });
  }

  try {
    // 查询数据库 - 支持用户名或手机号登录
    const query = `
      SELECT * FROM logins 
      WHERE id = $1`;
    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        code: 401,
        message: '用户不存在'
      });
    }

    const user = result.rows[0];
    
    // 使用 bcrypt 验证密码（比较明文密码和加密密码）,bcrypt.compare(明文,加密密码)返回值为true与false
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        code: 401,
        message: '密码错误'
      });
    }


    // 更新最后登录时间
    await pool.query(
      'UPDATE logins SET updated_at = NOW() WHERE id = $1',
      [user.id]
    );

    res.json({
      code: 200,
      message: '登录成功',
      data: {
        username: user.id,
        phone: user.phone,
        loginTime: new Date().getTime(),
      }
    });

  } catch (error) {
    console.error('数据库查询错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器错误'
    });
  }
};


//用户注册
exports.register = async (req, res) => {
  const { userid, phone, password, openid} = req.body;

  try {
    // 检查用户名是否已存在
    const usernameCheck = await pool.query(
      'SELECT id FROM logins WHERE id = $1',
      [userid]
    );
    console.log("查看用户是否存在数据库返回的值",usernameCheck);
    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({
        code: 400,
        message: '用户名已存在'
      });
    }

    // 检查手机号是否已注册
    const phoneCheck = await pool.query(
      'SELECT id FROM logins WHERE phone = $1',
      [phone]
    );

    if (phoneCheck.rows.length > 0) {
      return res.status(400).json({
        code: 400,
        message: '手机号已注册'
      });
    }
    console.log("密码",password)
    // 加密密码,bcrypt.hash(明文,加密强度),返回值为加密后的密码
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 插入新用户到数据库
    const insertQuery = `
      INSERT INTO logins (id, phone, password, openid,created_at, updated_at) 
      VALUES ($1, $2, $3,$4, NOW(), NOW()) 
      RETURNING id, phone, created_at
    `;
    //这里的now()是获取当前时间，是postgresql的自带函数，可以直接使用获取当前时间

    const result = await pool.query(insertQuery, [
      userid,
      phone,
      hashedPassword,
      openid
    ]);

    const usersQuery = `
      INSERT INTO users (id,phone) 
      VALUES ($1, $2)
    `;

    const resultUsers = await pool.query(usersQuery, [
      userid, phone
    ]);

    // 注册成功
    res.json({
      code: 200,
      message: '注册成功',
      data: {
        username: result.rows[0].id,
        phone: result.rows[0].phone,
        registerTime: result.rows[0].created_at
      }
    });

  } catch (error) {
    console.error('注册错误:', error);
    
    // 处理数据库唯一约束错误
    if (error.code === '23505') {
      return res.status(400).json({
        code: 400,
        message: '用户名或手机号已存在'
      });
    }

    res.status(500).json({
      code: 500,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 确保头像目录存在
const ensureAvatarDir = () => {
  const avatarDir = path.join(__dirname, '../public/avatars')
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true })
  }
  return avatarDir
}

// 生成唯一的文件名
const generateAvatarFileName = (userId, originalName) => {
  const ext = path.extname(originalName)
  //extname方法返回文件的扩展名，包括点号
  const timestamp = Date.now()
  return `avatar_${userId}_${timestamp}${ext}`
}

// 获取用户信息
exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.query
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '用户ID不能为空'
      })
    }

    const result = await pool.query(
      `SELECT 
        id, name, role, employee_id, department, phone, email, 
        avatar_url,introduction
       FROM users WHERE id = $1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      })
    }

    const user = result.rows[0]
    
    // 构建完整的头像URL
    let avatarUrl = null
    if (user.avatar_url) {
      // 获取服务器的基础URL（协议+域名+端口）,req.get('host')获取主机名和端口号如localhost:3000
      const baseUrl = `${req.protocol}://${req.get('host')}`
      avatarUrl = `${baseUrl}${user.avatar_url}`
    } else {
      avatarUrl = `${req.protocol}://${req.get('host')}/images/default-avatar.png`
    }
    
    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        employeeId: user.employee_id,
        department: user.department,
        phone: user.phone,
        email: user.email,
        avatarUrl: avatarUrl,
        introduction:user.introduction
      }
    })
  } catch (error) {
    console.error('获取用户信息错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
}

exports.getUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, name, role, employee_id, department, phone, email, 
        avatar_url, updated_at
      FROM users 
      ORDER BY name ASC
    `);
    console.log('Fetched users:', result.rows);
    res.status(200).json({
      code: 200,
      message: '获取用户列表成功',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      code: 500,
      message: '获取用户列表失败',
      error: error.message
    });
  }
};

// 更新用户头像
exports.updateAvatar = async (req, res) => {
  let tempFileDeleted = false
  try {
    const { userId } = req.body
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '用户ID不能为空'
      })
    }

    console.log("上传的文件信息:",req.file);
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '请选择头像文件'
      })
    }

    // 检查文件是否存在
    if (!fs.existsSync(req.file.path)) {
      return res.status(400).json({
        success: false,
        message: '上传的文件不存在，请重新上传'
      })
    }

    // 验证文件类型
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif']
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      safeDeleteFile(req.file.path)
      tempFileDeleted = true
      return res.status(400).json({
        success: false,
        message: '不支持的文件格式，请上传 JPEG、PNG 或 GIF 图片'
      })
    }

    // 检查文件大小（限制为 8MB）
    const stats = fs.statSync(req.file.path)
    if (stats.size > 8 * 1024 * 1024) {
      safeDeleteFile(req.file.path)
      tempFileDeleted = true
      return res.status(400).json({
        success: false,
        message: '文件大小不能超过 2MB'
      })
    }

    // 确保头像目录存在
    const avatarDir = ensureAvatarDir()
    
    // 生成唯一的文件名
    const fileName = generateAvatarFileName(userId, req.file.originalname)
    const filePath = path.join(avatarDir, fileName)
    
    // 移动文件到永久存储位置
    fs.renameSync(req.file.path, filePath)
    tempFileDeleted = true

    // 构建可访问的URL路径
    const avatarUrl = `/avatars/${fileName}`

    // 先查询用户当前的头像URL，以便删除旧文件
    const currentUser = await pool.query(
      'SELECT avatar_url FROM users WHERE id = $1',
      [userId]
    )

    // 删除旧的头像文件（如果有的话）,这里的&&是逻辑与的关系就是前后都符合才true，而||是逻辑与，只要一方好了就行
    if (currentUser.rows.length > 0 && currentUser.rows[0].avatar_url) {
      const oldAvatarPath = path.join(__dirname, '../public', currentUser.rows[0].avatar_url)
      safeDeleteFile(oldAvatarPath)
      //path.join方法用于连接路径片段，形成一个完整的路径,之后在用safeDeleteFile函数删除旧文件
    }

    // 更新数据库中的头像URL
    const result = await pool.query(
      `UPDATE users 
       SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, avatar_url`,
      [avatarUrl, userId]
    )

    if (result.rows.length === 0) {
      // 如果更新失败，删除已保存的文件
      safeDeleteFile(filePath)
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      })
    }

    res.json({
      success: true,
      message: '头像更新成功',
      data: {
        avatarUrl: avatarUrl
      }
    })

  } catch (error) {
    // 确保临时文件被删除
    if (!tempFileDeleted && req.file) {
      safeDeleteFile(req.file.path)
    }
    
    console.error('更新头像错误:', error)
    
    let errorMessage = '服务器内部错误'
    if (error.code === 'ENOENT') {
      errorMessage = '上传的文件不存在或已被删除'
    } else if (error.code === 'LIMIT_FILE_SIZE') {
      errorMessage = '文件大小超过限制'
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage
    })
  }
}

//更改任务状态
exports.updateTask=async(req,res)=>{
  const taskId = req.params.taskId;
  const status=req.body.status;
  console.log("任务ID:",taskId,"新状态:",status);
  try{
    const result = await pool.query(
      `UPDATE tasks SET status = $1 WHERE task_id = $2 RETURNING *`,
      [status, taskId]
    );
    console.log("更新任务状态结果:",result);
    res.status(200).json({
      code: 200,
      message: '任务状态更新成功',
      data: result.rows[0]
    });
  }catch(err){
    res.status(500).json({
      code: 500,
      message: err.message
    });
  }
}

exports.createTask = async (req, res) => {
  const {selectedUsers, name, description, deadline, priority, type, assigneeIds, createdBy, areaRange } = req.body;
  console.log(selectedUsers)
  // 1. 验证必填字段
  if (!name || !deadline || !priority || !type || !assigneeIds || assigneeIds.length === 0) {
    return res.status(400).json({
      code: 400,
      message: '请提供所有必填字段和至少一个执行人'
    });
  }

  const client = await pool.connect();

  try {
    // 1. 开始数据库事务
    await client.query('BEGIN');
    // 2. 为每个执行人创建任务分配记录
    let taskResult;
    for (userId of selectedUsers){
      taskResult = await client.query(
        `INSERT INTO tasks 
        (id,name, description, deadline, priority, type, status, created_by, created_at, area_range) 
        VALUES ($1, $2, $3, $4, $5, $6, $7,$8, NOW(),$9) 
        RETURNING *`,
        [userId,name, description, deadline, priority, type, 'pending', createdBy || 'admin', areaRange]
      );
    }
    const task = taskResult.rows[0];

    // 3. 提交事务
    await client.query('COMMIT');

    res.status(201).json({
      code: 200,
      message: '任务创建并分配成功',
      data: task
    });

  } catch (error) {
    // 4. 如果出错则回滚事务
    await client.query('ROLLBACK');
    console.error('创建任务失败:', error);
    res.status(500).json({
      code: 500,
      message: '创建任务失败',
      error: error.message
    });

  } finally {
    // 5. 释放数据库连接
    client.release();
  }
};


/**
 * 获取系统中所有任务
 */
exports.getAllTasks = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tasks.*, users.name AS user_name FROM tasks 
      LEFT JOIN users ON tasks.id = users.id ORDER BY tasks.created_at DESC`
    );

    res.status(200).json({
      code: 200,
      data: result.rows
    });
  } catch (error) {
    console.error('获取所有任务失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取所有任务失败'
    });
  }
};


// 根据用户ID获取任务列表
exports.getTasksByUserId = async (req, res) => {
  try {
    // 从请求查询参数中获取 userId
    const userId = req.query.userId;
    console.log("获取任务的用户ID:",userId);
    // 验证 userId 是否提供
    if (!userId) {
      return res.status(400).json({
        code: 400,
        message: '用户ID (userId) 不能为空'
      });
    }

    // 构造SQL查询，获取该用户创建的所有任务
    // 你可以根据实际需求调整查询条件，例如 `WHERE assignee_id = $1` 来获取分配给该用户的任务
    const result = await pool.query(
      `SELECT * FROM tasks WHERE id=$1 ORDER BY created_at DESC;`,
      [userId]
    );

    // 返回查询到的任务列表
    res.status(200).json({
      code: 200,
      message: `成功获取用户 ${userId} 的任务`,
      data: result.rows
    });
  } catch (error) {
    console.error('根据用户ID获取任务失败:', error);
    res.status(500).json({
      code: 500,
      message: '服务器错误，获取任务失败'
    });
  }
};


// 删除用户头像（不一定用到）
exports.deleteAvatar = async (req, res) => {
  try {
    const { userId } = req.body
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '用户ID不能为空'
      })
    }

    // 先查询用户当前的头像URL
    const currentUser = await pool.query(
      'SELECT avatar_url FROM users WHERE id = $1',
      [userId]
    )

    if (currentUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      })
    }

    // 删除物理文件
    if (currentUser.rows[0].avatar_url) {
      const avatarPath = path.join(__dirname, '../public', currentUser.rows[0].avatar_url)
      safeDeleteFile(avatarPath)
    }

    // 更新数据库，清空头像URL
    const result = await pool.query(
      'UPDATE users SET avatar_url = NULL WHERE id = $1 RETURNING id',
      [userId]
    )

    res.json({
      success: true,
      message: '头像删除成功'
    })
  } catch (error) {
    console.error('删除头像错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
}

// 更新用户信息（保持不变）
exports.updateUserProfile = async (req, res) => {
  try {
    // 1. 新增 introduction 字段接收
    const { userId, name, role, employeeId, department, phone, email, introduction } = req.body
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '用户ID不能为空'
      })
    }

    // 构建更新字段和值
    const updateFields = []
    const values = []
    let paramCount = 1

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount}`)
      values.push(name)
      paramCount++
    }
    if (role !== undefined) {
      updateFields.push(`role = $${paramCount}`)
      values.push(role)
      paramCount++
    }
    if (employeeId !== undefined) {
      updateFields.push(`employee_id = $${paramCount}`)
      values.push(employeeId)
      paramCount++
    }
    if (department !== undefined) {
      updateFields.push(`department = $${paramCount}`)
      values.push(department)
      paramCount++
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCount}`)
      values.push(phone)
      paramCount++
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCount}`)
      values.push(email)
      paramCount++
    }

    // 2. 新增 introduction 字段的更新逻辑
    if (introduction !== undefined) {
      updateFields.push(`introduction = $${paramCount}`)
      values.push(introduction)
      paramCount++
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的字段'
      })
    }

    values.push(userId)
    
    // 3. 查询语句中新增返回 introduction 字段
    const query = `
      UPDATE users 
      SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING id, name, role, employee_id, department, phone, email, avatar_url, introduction
    `

    const result = await pool.query(query, values)

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      })
    }

    const updatedUser = result.rows[0]
    
    res.json({
      success: true,
      message: '用户信息更新成功',
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        role: updatedUser.role,
        employeeId: updatedUser.employee_id,
        department: updatedUser.department,
        phone: updatedUser.phone,
        email: updatedUser.email,
        avatarUrl: updatedUser.avatar_url || '/images/default-avatar.png',
        // 4. 返回数据中新增 introduction 字段
        introduction: updatedUser.introduction
      }
    })
  } catch (error) {
    console.error('更新用户信息错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
}
//获取天气并创建巡林任务的逻辑
async function getWeather() {
  const appid="65479839"
  const appsecret='i8dAo4u7'
  const version='v63'
  const unescape=1
  const CITY_ID = '南平';


  const url = `http://gfeljm.tianqiapi.com/api?appid=${appid}&city=${CITY_ID}&appsecret=${appsecret}&version=${version}&unescape=${unescape}`;

  try {
    const response = await axios.get(url);
    if (response.data) {
      const now = response.data.wea;      
      return {
        nowtext: now
      };
    }
  }catch (error) {
    console.error('❌ 调用天气 API 出错:', error.message);
    return null;
  }
}

/**
 * 步骤 2: 为所有用户创建巡林任务
 */
async function createPatrolTasksForAllUsers() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const today = new Date();

    // 提取年、月、日
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // getMonth() 返回 0-11，所以要 +1
    const day = String(today.getDate()).padStart(2, '0');

    // 拼接成 'YYYY-MM-DD 18:00:00' 格式的字符串
    const deadlineString = `${year}-${month}-${day} 18:00:00`;
    console.log(`ℹ️ 任务截止时间设置为: ${deadlineString}`);
    const { rows: users } = await client.query('SELECT id FROM users');
    console.log(`ℹ️ 查询到 ${users.length} 个用户。`);
    if (users.length === 0) {
      console.log('ℹ️ 数据库中没有用户，跳过任务创建。');
      await client.query('COMMIT');
      return;
    }

    console.log(`ℹ️ 找到 ${users.length} 个用户，开始为每个用户创建任务...`);

    const taskPromises = users.map(user => {
      return client.query(
        `INSERT INTO tasks (name, description, status, id, created_at, deadline,priority,type,created_by)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8)`,
        [
          '每日巡林任务',
          '今日天气良好，请完成指定区域的巡林工作。',
          'pending',
          user.id,
          deadlineString,
          'low',
          'environment',
          'system'
        ]
      );
    });

    await Promise.all(taskPromises);
    await client.query('COMMIT');
    console.log(`✅ 成功为 ${users.length} 个用户创建了巡林任务。`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 创建巡林任务失败:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 核心逻辑：检查天气并决定是否创建任务
 */
async function checkWeatherAndCreateTasks() {
  console.log('\n==========================================');
  console.log('---------- 开始执行每日任务检查 ----------');
  //获取巡逻区域的天气
  const weather = await getWeather();

  if (!weather) {
    console.error('❌ 无法获取天气信息，任务创建流程中止。');
    console.log("err:",weather);
    console.log('------------------------------------------');
    console.log('==========================================\n');
    return;
  }

  console.log(`ℹ️ 当前 ${weather.nowtext}`);

  const isRainy = weather.nowtext.includes('雨');

  if (isRainy) {
    console.log(`ℹ️ 今日${weather.nowtext}，不适合巡林，取消今日任务。`);
  } else {
    console.log(`ℹ️ 今日${weather.nowtext}，适合巡林，开始创建任务...`);
    await createPatrolTasksForAllUsers();
  }
  
  console.log('---------- 每日任务检查执行完毕 ----------');
  console.log('==========================================\n');
}

//添加自动创建任务
// checkWeatherAndCreateTasks()
/**
 * 步骤 3: 设置并启动定时任务
 */
function scheduleDailyTask() {
  // 每天早上 8:00 执行
  // 格式：秒 分 时 日 月 星期
  
  
  const rule = '0 0 8 * * *'; 
  
  const job = schedule.scheduleJob(rule, async () => {
    console.log('\n==================================================');
    console.log(`📅 每日任务调度开始执行 (${new Date().toLocaleString()})`);
    console.log('==================================================');
    
    // 1. 先更新过期任务
    await getAllTasks();
    
    // 2. 再创建新任务
    await checkWeatherAndCreateTasks();
    
    console.log('==================================================');
    console.log('📅 每日任务调度执行完毕');
    console.log('==================================================\n');
  });

  
  console.log(`✅ 每日巡林任务调度已启动，将在每天 08:00 执行。`);
  
}
scheduleDailyTask();


const OpenAI = require('openai');


const openai = new OpenAI({
  apiKey: '02b6f5dc-d6a2-4395-91a5-113fe424de0d',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
});

// 图片存储目录
const UPLOAD_DIR = path.join(__dirname, '../uploads/chat_images');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * 安全删除文件函数
 */


/**
 * 清理临时文件和图片文件
 */
function cleanupFiles(files) {
  files.forEach(filePath => {
    if (filePath && filePath !== '') {
      safeDeleteFile(filePath);
    }
  });
}

exports.chatai = async (req, res) => {
  console.log("智能助手AI调用开始,并连接知识库成功");
  
  // 用于记录需要清理的文件
  const filesToCleanup = [];
  
  try {
    let { message = '', history = [] } = req.body;
    const uploadedFile = req.file;

    console.log("后端接收到的前端参数:", {
      message: message ? `有文本，长度: ${message.length}` : '无文本',
      hasFile: !!uploadedFile,
      fileSize: uploadedFile ? `${(uploadedFile.size / 1024 / 1024).toFixed(2)}MB` : '无文件'
    });

    // 记录临时文件，确保最终被清理
    if (uploadedFile && uploadedFile.path) {
      filesToCleanup.push(uploadedFile.path);
    }

    // 处理history参数
    let validHistory = [];
    if (typeof history === 'string') {
      try {
        validHistory = JSON.parse(history);
      } catch (e) {
        validHistory = [];
      }
    } else if (Array.isArray(history)) {
      validHistory = history;
    }

    validHistory = validHistory.filter(item => 
      item && item.role && (item.content || item.content === '')
    );

    // 基础校验
    if (!message.trim() && !uploadedFile) {
      // 响应前清理临时文件
      cleanupFiles(filesToCleanup);
      return res.status(400).json({
        success: false,
        error: '请输入文本消息或上传图片'
      });
    }

    let finalImagePath = '';
    let imageUrl = '';

    // 构造用户消息内容
    let userContent = [];
    
    // 添加文本内容
    if (message.trim()) {
      userContent.push({ type: 'text', text: message.trim() });
    }
    
    // 添加图片内容
    if (uploadedFile) {
      try {
        // 生成唯一的文件名
        const fileExt = path.extname(uploadedFile.originalname);
        const uniqueFilename = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${fileExt}`;
        finalImagePath = path.join(UPLOAD_DIR, uniqueFilename);
        
        // 将临时文件移动到永久存储位置
        fs.renameSync(uploadedFile.path, finalImagePath);
        
        // 记录最终图片路径，用于后续清理
        filesToCleanup.push(finalImagePath);
        
        // 构造可公开访问的图片URL
        imageUrl = `${req.protocol}://${req.get('host')}/uploads/chat_images/${uniqueFilename}`;
        
        console.log("图片已保存:", imageUrl);
        
        // 直接使用图片URL
        userContent.push({
          type: 'image_url',
          image_url: {
            url: imageUrl,
            detail: 'high'
          }
        });
        
      } catch (imageError) {
        console.error("图片处理错误:", imageError);
        
        // 清理所有相关文件
        cleanupFiles(filesToCleanup);
        
        return res.status(400).json({
          success: false,
          error: `图片处理失败: ${imageError.message}`
        });
      }
    }

    // 构造完整的AI消息体
    const messages = [
      { role: 'system', content: '你是一个智能助手，能够理解图片内容并回答相关问题' },
      ...validHistory.map(item => ({
        role: item.role,
        content: item.content
      })),
      {
        role: 'user',
        content: userContent
      }
    ];

    console.log("发送给AI的消息结构:", {
      hasText: message.trim().length > 0,
      hasImage: uploadedFile !== null,
      historyLength: validHistory.length
    });

    // 调用AI接口
    const completion = await openai.chat.completions.create({
      messages: messages,
      model: 'doubao-seed-1-6-251015',
      reasoning_effort: "medium",
      max_tokens: 200
    });
    // const reply=completion.choices[0]?.message?.content || ''
    // reply2 = reply
    //   .replace(/\n/g, '<br/>')       
    //   .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;') 
    //   .replace(/  /g, '&nbsp;&nbsp;');
    console.log("响应成功");
    
    // 构造返回结果
    const result = {
      success: true,
      response: completion.choices[0]?.message?.content || ''
    };




    console.log("生成反馈结果并返回至前端",result.response)
    // 在发送响应前，我们不确定AI是否已经处理完图片
    // 所以先发送响应，然后延迟清理
    
    res.json(result);
    
    // 响应发送完成后，延迟清理图片文件
    // 给AI服务足够的时间下载和处理图片
    setTimeout(() => {
      console.log('开始清理图片文件...');
      cleanupFiles(filesToCleanup);
    }, 30000); // 30秒后清理，确保AI服务已经处理完图片

  } catch (error) {
    console.error('ChatAI接口异常:', error);
    
    // 发生错误时立即清理文件
    cleanupFiles(filesToCleanup);
    
    let errorMessage = '服务器内部错误';
    if (error.message.includes('URL')) {
      errorMessage = '图片处理失败，请确保图片URL可公开访问';
    } else if (error.message.includes('size')) {
      errorMessage = '图片文件过大，请压缩后重试';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
};




//上传任务图片
exports.uploadTaskFile = async (req, res) => {
  try {
    // 检查是否有文件上传
    if (!req.file) {
      return res.status(400).json({
        code: 400,
        message: '请选择要上传的图片'
      });
    }
    const taskFileName = req.file.filename;
    const taskFilePath = path.join(__dirname, '../uploads/temp', taskFileName);
    const taskspath=path.join(__dirname,'../uploads/tasks',taskFileName)
    fs.renameSync(taskFilePath,taskspath);
    // 构建图片的访问 URL（前端可直接访问）
    const baseUrl = `${req.protocol}://${req.get('host')}`; // 服务器基础 URL（如 http://localhost:3000）
    const fileUrl = `${baseUrl}/uploads/tasks/${req.file.filename}`; // 图片完整 URL

    // 返回成功响应（包含图片 URL）
    res.status(200).json({
      code: 200,
      message: '图片上传成功',
      data: {
        url: fileUrl, // 图片访问 URL
        filename: req.file.filename, // 图片文件名（可选）
        path: req.file.path // 图片在服务器的存储路径（可选）
      }
    });

  } catch (error) {
    console.error('任务图片上传失败:', error);
    res.status(500).json({
      code: 500,
      message: '图片上传失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器错误'
    });
  }
};

//任务上传
exports.submitTask = async (req, res) => {
  try {
    // 1. 获取请求参数（匹配你的task_submissions表字段）
    const { task_id, user_id, description, files ,submitted_at,longitude,latitude,address } = req.body;
    console.log("提交的任务信息:",req.body);

    // 2. 校验必填字段
    if (!task_id || !user_id) {
      return res.status(400).json({
        code: 400,
        message: '任务ID（task_id）和提交人ID（user_id）不能为空'
      });
    }

    // 3. 构建SQL插入语句（严格对应你的表结构）
    const query = `
      INSERT INTO task_submissions (
        task_id, 
        submitted_by, 
        description, 
        upload_path,
        submitted_at,
        longitude,
        latitude, location_address
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7)
      RETURNING submission_id;
    `;
    const values = [task_id, user_id, description, files, longitude, latitude, address];

    // 4. 执行SQL并获取结果
    const result = await pool.query(query, values);

    // 5. 返回成功响应
    res.status(201).json({
      code: 200,
      message: '任务提交成功',
      data: {
        submission_id: result.rows[0].submission_id
      }
    });

  } catch (error) {
    // 6. 错误处理
    console.error('提交任务失败:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误，提交任务失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '请联系管理员'
    });
  }
};
//获取所有任务并自动更新过期任务状态
getAllTasks = async (req, res) => {
  const client = await pool.connect();
  try {
    // --- 核心逻辑开始 ---
    // 1. 开启事务
    await client.query('BEGIN');

    // 2. 查询所有已过期但状态未完成的任务ID
    // 注意：这里没有加 user_id 的过滤条件
    const expiredTasksQuery = `
      SELECT task_id FROM tasks
      WHERE status NOT IN ('completed','expired') 
      AND deadline < NOW()
    `;
    const { rows: expiredTaskIds } = await client.query(expiredTasksQuery);

    // 3. 如果存在过期任务，就更新它们的状态
    if (expiredTaskIds.length > 0) {
      const idsToUpdate = expiredTaskIds.map(task => task.task_id);
      console.log("需要更新为过期状态的任务ID:",idsToUpdate);
      const updateQuery = `
        UPDATE tasks
        SET status = 'expired'
        WHERE task_id = ANY($1)
      `;
      
      await client.query(updateQuery, [idsToUpdate]);
      console.log(`自动更新了 ${idsToUpdate.length} 个过期任务。`);
    }
    
    // 4. 提交事务
    await client.query('COMMIT');
    // --- 核心逻辑结束 ---

    // 5. 查询所有任务（此时已包含被更新为 'expired' 的任务）
    const { rows: tasks } = await client.query('SELECT * FROM tasks');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("获取所有任务失败:", error);
    res.status(500).json({
      code: 500,
      message: "服务器错误"
    });
  } finally {
    client.release();
  }
};

exports.getTaskDetails = async (req, res) => {
  const client = await pool.connect();
  try {
    const { taskId } = req.params;

    // 1. 查询任务基本信息 (tasks表)
    const taskQuery = {
      text: `
        SELECT 
          id,
          task_id,
          name,
          description,
          deadline,
          priority,
          type,
          status,
          created_at,
          created_by,
          area_range
        FROM tasks 
        WHERE task_id = $1;
      `,
      values: [taskId]
    };
    const taskResult = await client.query(taskQuery);

    // 如果任务不存在，返回 404
    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '任务不存在'
      });
    }
    const task = taskResult.rows[0];

    // 2. 查询该任务的所有提交记录 (task_submission表)
    const submissionQuery = {
      text: `
        SELECT 
          submission_id,
          submitted_by,
          description,
          upload_path,
          submitted_at,
          longitude,
          latitude,
          location_address
        FROM task_submissions
        WHERE task_id = $1
        ORDER BY submitted_at DESC;
      `,
      values: [taskId]
    };
    const submissionResult = await client.query(submissionQuery);
    let submissions = submissionResult.rows;
    
    // 3. 【关键】处理图片URL，确保前端可访问
    // 这是后端唯一需要做的格式化操作，因为涉及资源的正确定位。
    const processedSubmissions = submissions.map(sub => ({
      ...sub,
      // 如果 upload_path 存在且不是完整的 URL，则拼接上服务器地址
      upload_path: sub.upload_path && !sub.upload_path.startsWith('https')
        ? `${sub.upload_path}` // 替换为你的服务器公网IP或域名
        : sub.upload_path
    }));
    console.log("sub的数据：",processedSubmissions)
    // 4. 返回原始的、未经格式化的聚合数据
    res.status(200).json({
      code: 200,
      data: {
        task: task,           // 来自 tasks 表的原始数据
        submissions: processedSubmissions // 来自 task_submission 表的原始数据（仅处理了图片URL）
      }
    });

  } catch (error) {
    console.error('获取任务详情失败:', error);
    res.status(500).json({
      code: 500,
      message: '服务器错误，获取任务详情失败'
    });
  } finally {
    client.release(); // 确保数据库连接被释放
  }
};


//修改天气保证数据返回前端与每日派发任务
exports.getWeatherInfo = async(req,res)=> {
  const appid="65479839"
  const appsecret='i8dAo4u7'
  const version='v63'
  const unescape=1
  let currentCity='南平'
  if(req.query.currentCity){
     currentCity=req.query.currentCity
  }
  console.log("获取请求参数天气城市",req.query.currentCity)
  currentCity = currentCity.slice(0, 2); 
    console.log("获取请求参数天气城市",currentCity)
  const url = `http://gfeljm.tianqiapi.com/api?appid=${appid}&city=${currentCity}&appsecret=${appsecret}&version=${version}&unescape=${unescape}`;

  try {
    const response = await axios.get(url);
    
    if (response.data) {
      const now = response.data;   
      console.log(now)
      res.status(200).json({
        code:200,
        message:'获取天气成功',
        data: now          //修改模拟天气区域
      });
    }
  }catch (error) {
    console.error('❌ 调用天气 API 出错:', error.message);
    res.status(500).json({
      code:500,
      message:'获取天气失败'
    });
  }
}

exports.uploadFeedbackImage = async (req, res) => {
  let tempFileDeleted = false
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请选择要上传的图片'
      })
    }

    // 确保反馈图片目录存在
    const feedbackImageDir = path.join(__dirname, '../public/feedback');
    if (!fs.existsSync(feedbackImageDir)) {
      fs.mkdirSync(feedbackImageDir, { recursive: true });
    }

    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileName = `feedback-${uniqueSuffix}${path.extname(req.file.originalname)}`;
    const targetPath = path.join(feedbackImageDir, fileName);

    // 移动临时文件到永久目录
    fs.renameSync(req.file.path, targetPath);
    tempFileDeleted = true;

    // 构建图片访问URL的
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const imageUrl = `${baseUrl}/feedback/${fileName}`;

    res.json({
      success: true,
      imageUrl: imageUrl,
      fileName: fileName
    });

  } catch (error) {
    // 清理临时文件
    if (!tempFileDeleted && req.file) {
      safeDeleteFile(req.file.path);
    }
    console.error('反馈图片上传失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '图片上传失败'
    });
  }
};

// ========== 新增：反馈提交入库 ==========
exports.submitFeedback = async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. 校验必填字段
    const { userid, username, feedback_type_name, urgency_level, description ,latitude,longitude,location_address} = req.body;
    if (!userid || !username || !feedback_type_name || !urgency_level || !description) {
      return res.status(400).json({
        success: false,
        error: '必填字段缺失（userid/username/feedback_type_name/urgency_level/description）'
      });
    }

    // 2. 开启事务
    await client.query('BEGIN');

    // 3. 构造入库SQL（匹配PostgreSQL表结构）
    const sql = `
      INSERT INTO forest_feedback (
        userid, username, feedback_type_name, urgency_level, 
        description, status, handle_note, image_url,latitude,longitude,location_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id;
    `;
    const params = [
      userid,
      username,
      feedback_type_name,
      urgency_level,
      description.trim(),
      req.body.status || 'pending', // 默认待审核
      req.body.handle_note || '',   // 初始为空
      req.body.image_url || '',      // 图片URL（无则为空）
      latitude || null,
      longitude || null,
      location_address || ''
    ];

    // 4. 执行入库
    const result = await client.query(sql, params);
    await client.query('COMMIT');

    res.json({
      success: true,
      message: '反馈提交成功',
      feedbackId: result.rows[0].id
    });

  } catch (error) {
    // 回滚事务
    await client.query('ROLLBACK');
    console.error('反馈入库失败:', error);
    res.status(500).json({
      success: false,
      error: '反馈提交失败：' + error.message
    });
  } finally {
    // 释放连接
    client.release();
  }
};

// 查询当前用户的反馈列表
exports.getFeedbackList = async (req, res) => {
  try {
    const { userId } = req.query
    if (!userId) {
      return res.json({
        success: false,
        error: '用户ID不能为空'
      })
    }

    // 查询该用户的所有反馈（按提交时间倒序）
    const result = await pool.query(
      `SELECT * FROM forest_feedback 
       WHERE userid = $1 
       ORDER BY submit_time DESC`,
      [userId]
    )

    res.json({
      success: true,
      data: result.rows
    })
  } catch (error) {
    console.error('查询反馈列表失败:', error)
    res.json({
      success: false,
      error: '查询失败：' + error.message
    })
  }
}


// 管理员查询所有反馈列表
exports.getAdminFeedbackList = async (req, res) => {
  try {
    // 查询所有反馈，按提交时间倒序
    const query = `
      SELECT * FROM forest_feedback 
      ORDER BY submit_time DESC
    `;
    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('管理员查询反馈列表失败:', error);
    res.json({
      success: false,
      error: '查询失败：' + error.message
    });
  }
};

// ========== 审核反馈（更新状态+备注） ==========
exports.auditFeedback = async (req, res) => {
  const client = await pool.connect();
  try {
    const { feedbackId, status, handle_note } = req.body;

    // 校验必填字段
    if (!feedbackId || !status) {
      return res.json({
        success: false,
        error: '反馈ID和审核状态不能为空'
      });
    }

    // 校验状态合法性
    const validStatus = ['passed', 'rejected', 'pending'];
    if (!validStatus.includes(status)) {
      return res.json({
        success: false,
        error: '状态只能是 passed（已通过）/rejected（已拒绝）/pending（待审核）'
      });
    }

    // 开启事务
    await client.query('BEGIN');

    // 更新反馈状态和备注
    const updateQuery = `
      UPDATE forest_feedback 
      SET status = $1, handle_note = $2, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $3 
      RETURNING *
    `;
    const params = [status, handle_note || '', feedbackId];
    const result = await client.query(updateQuery, params);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        error: '反馈记录不存在'
      });
    }

    // 提交事务
    await client.query('COMMIT');

    res.json({
      success: true,
      message: '审核操作成功',
      data: result.rows[0]
    });
  } catch (error) {
    // 回滚事务
    await client.query('ROLLBACK');
    console.error('审核反馈失败:', error);
    res.json({
      success: false,
      error: '审核失败：' + error.message
    });
  } finally {
    // 释放连接
    client.release();
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    // 1. 获取参数（userId=用户名/ID，newPassword=新密码）
    const { userId, newPassword } = req.body;
    
    // 2. 校验必填参数
    if (!userId || !newPassword) {
      return res.status(400).json({
        code: 400,
        message: '用户ID（userId）和新密码（newPassword）不能为空'
      });
    }

    // 3. 密码规则校验（和注册逻辑保持一致）
    if (newPassword.length < 6) {
      return res.status(400).json({
        code: 400,
        message: '密码长度不能少于6位'
      });
    }

    // 4. bcrypt 加密新密码（复用注册的加密规则）
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // 5. 更新 logins 表中的密码
    const updateQuery = `
      UPDATE logins 
      SET password = $1, updated_at = NOW() 
      WHERE id = $2 
      RETURNING id, phone
    `;
    const result = await pool.query(updateQuery, [hashedPassword, userId]);

    // 6. 校验用户是否存在
    if (result.rows.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在'
      });
    }

    // 7. 返回成功响应
    res.status(200).json({
      code: 200,
      message: '密码重置成功',
      data: {
        userId: result.rows[0].id,
        phone: result.rows[0].phone
      }
    });

  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(500).json({
      code: 500,
      message: '服务器错误，密码重置失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '请联系管理员'
    });
  }
};


// 移除 gcj02ToWgs84 方法

// 上传轨迹（简化版：直接存储原始GCJ02坐标）
exports.uploadTrack = async (req, res) => {
  try {
    const {
      taskId,
      taskTitle,
      distance,
      duration,
      avgSpeed,
      totalSeconds,
      pointCount,
      startTime,
      endTime,
      trackPoints
    } = req.body;

    // 1. 参数校验
    if (!taskId || !trackPoints || trackPoints.length === 0) {
      return res.status(400).json({
        code: 400,
        msg: '任务ID和轨迹点不能为空'
      });
    }

    // 2. 直接使用前端传入的GCJ02坐标（无需转换）
    // 仅做精度格式化，避免冗余小数
    const formattedPoints = trackPoints.map(point => ({
      lng: parseFloat(point.lng.toFixed(6)),
      lat: parseFloat(point.lat.toFixed(6))
    }));

    // 3. 时间转换
    const startTs = new Date(startTime);
    const endTs = new Date(endTime);

    // 4. 插入数据库（直接存储GCJ02坐标的JSON字符串）
    const query = `
      INSERT INTO track_records (
        task_id, task_title, distance, duration, avg_speed, 
        total_seconds, point_count, start_time, end_time, track_points
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id;
    `;

    const values = [
      taskId,
      taskTitle || '轨迹记录',
      distance,
      duration,
      avgSpeed,
      totalSeconds,
      pointCount,
      startTs,
      endTs,
      JSON.stringify(formattedPoints) // 直接存储GCJ02坐标
    ];

    const result = await pool.query(query, values);

    // 5. 返回响应
    res.json({
      code: 200,
      msg: '轨迹上传成功',
      data: {
        trackId: result.rows[0].id,
        taskId
      }
    });

  } catch (err) {
    console.error('轨迹入库失败:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器错误：' + err.message
    });
  }
};

/**
 * 查询轨迹（直接返回GCJ02坐标）
 */
exports.getTrackByTaskId = async (req, res) => {
  try {
    console.log("taskId的值", req.query)
    const { taskId } = req.query;
    if (!taskId) {
      return res.status(400).json({ code: 400, msg: 'taskId不能为空' });
    }

    const query = `
      SELECT 
        id, task_id, task_title, distance, duration, avg_speed,
        total_seconds, point_count, start_time, end_time,
        track_points 
      FROM track_records 
      WHERE task_id = $1;
    `;

    const result = await pool.query(query, [taskId]);

    if (result.rows.length === 0) {
      return res.json({ code: 200, msg: '无轨迹数据', data: null });
    }

    // 格式化返回（直接透传GCJ02坐标给前端）
    const track = result.rows[0];
    res.json({
      code: 200,
      msg: '查询成功',
      data: {
        ...track,
        trackPoints: track.track_points, // 前端可直接渲染到微信地图
        track_points: undefined // 统一字段名
      }
    });

  } catch (err) {
    console.error('查询轨迹失败:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器错误：' + err.message
    });
  }
};


exports.updateTrack = async (req, res) => {
  try {
    const {
      taskId,
      taskTitle,
      distance,
      duration,
      avgSpeed,
      totalSeconds,
      pointCount,
      startTime,
      endTime,
      trackPoints
    } = req.body;

    // 参数校验
    if (!taskId || !trackPoints) {
      return res.status(400).json({
        code: 400,
        msg: '任务ID和轨迹点不能为空'
      });
    }

    // 时间转换（毫秒戳转PostgreSQL时间戳）
    const startTs = new Date(startTime);
    const endTs = new Date(endTime);

    // 更新SQL（覆盖所有字段）
    const query = `
      UPDATE track_records 
      SET 
        task_title = $1,
        distance = $2,
        duration = $3,
        avg_speed = $4,
        total_seconds = $5,
        point_count = $6,
        start_time = $7,
        end_time = $8,
        track_points = $9,
        created_at = CURRENT_TIMESTAMP
      WHERE task_id = $10
      RETURNING id;
    `;

    const values = [
      taskTitle || '轨迹记录',
      distance,
      duration,
      avgSpeed,
      totalSeconds,
      pointCount,
      startTs,
      endTs,
      JSON.stringify(trackPoints), // 转为JSONB存储
      taskId
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        code: 404,
        msg: '未找到该任务的轨迹数据'
      });
    }

    res.json({
      code: 200,
      msg: '轨迹更新成功',
      data: { trackId: result.rows[0].id }
    });

  } catch (err) {
    console.error('更新轨迹失败:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器错误：' + err.message
    });
  }
};


exports.getFeedbackDetail = async (req, res) => {
  try {
    const { id, userId } = req.query; // 从GET参数获取：反馈ID + 用户ID

    // 参数校验
    if (!id || !userId) {
      return res.json({
        success: false,
        error: '反馈ID和用户ID不能为空',
        data: null
      });
    }

    // 查询详情（加权限校验：只能查自己的反馈）
    const query = `
      SELECT * FROM forest_feedback 
      WHERE id = $1 AND userid = $2
    `;
    const result = await pool.query(query, [id, userId]);

    // 无数据判断
    if (result.rows.length === 0) {
      return res.json({
        success: false,
        error: '反馈记录不存在或无权限查看',
        data: null
      });
    }

    // 返回详情数据
    res.json({
      success: true,
      data: result.rows[0], // 单条反馈数据
      error: ''
    });

  } catch (err) {
    console.error('查询反馈详情失败:', err);
    res.json({
      success: false,
      error: '服务器内部错误',
      data: null
    });
  }
};

async function getTaskStats(userId) {
  const query = `
    SELECT 
      priority,
      type,
      status,
      COUNT(*) as count
    FROM tasks
    WHERE 
      id = $1  
      AND deadline >= NOW() - INTERVAL '30 days'
    GROUP BY priority, type, status;
  `;
  try {
    const res = await pool.query(query, [userId]);
    const stats = {
      priority: { high: { done: 0, expired: 0, inProgress: 0, pending: 0 }, 
                  medium: { done: 0, expired: 0, inProgress: 0, pending: 0 }, 
                  low: { done: 0, expired: 0, inProgress: 0, pending: 0 } },
      type: {},
      total: { done: 0, expired: 0, inProgress: 0, pending: 0, total: 0 }
    };
    res.rows.forEach(row => {
      const { priority, type, status, count } = row;
      const num = parseInt(count);
      stats.total.total += num;

      // 适配你的status值：completed=完成，in_progress=进行中，pending=待处理，expired=过期
      let statusKey = '';
      if (status === 'completed') statusKey = 'done';
      else if (status === 'in_progress') statusKey = 'inProgress';
      else if (status === 'pending') statusKey = 'pending';
      else if (status === 'expired') statusKey = 'expired';
      else return; // 未知状态不统计

      // 1. 按紧急程度统计
      stats.priority[priority][statusKey] += num;
      // 2. 按整体状态统计
      stats.total[statusKey] += num;
      // 3. 按任务类型统计
      if (!stats.type[type]) {
        stats.type[type] = { done: 0, expired: 0, inProgress: 0, pending: 0 };
      }
      stats.type[type][statusKey] += num;
    });
    return stats;
  } catch (err) {
    console.error('任务统计失败:', err);
    throw err;
  }
}
// 2. 生成周报核心方法（统计 + AI 调用合并）
exports.getWeeklyReport = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({
        code: 400,
        msg: '用户ID不能为空'
      });
    }

    // 第一步：统计用户任务数据
    const taskStats = await getTaskStats(userId);

    // 第二步：构造 AI 月报提示词
    const reportPrompt = `
      请以专业、简洁的风格为林场巡林用户${userId}生成近30天工作周报，要求如下：
      1. 结构包含：任务完成总览、紧急程度分析、任务类型分析、过期任务改进建议；
      2. 根据以下统计数据生成：
         - 整体完成情况：总计${taskStats.total.total}个任务，完成${taskStats.total.done}个，过期${taskStats.total.expired}个；
         - 紧急程度：高优先级完成${taskStats.priority.high.done}个（过期${taskStats.priority.high.expired}个）、中优先级完成${taskStats.priority.medium.done}个（过期${taskStats.priority.medium.expired}个）、低优先级完成${taskStats.priority.low.done}个（过期${taskStats.priority.low.expired}个）；
         - 任务类型：${Object.entries(taskStats.type).map(([type, data]) => 
           `${type}类型完成${data.done}个，过期${data.expired}个`
         ).join('；')}；
      3. 语言正式，字数200-350字；
      4. 过期任务需分析可能原因，并给出具体改进建议。
      5.指出用户是属于什么类型的人，有什么优点与缺点
    `;

    // 第三步：直接调用 AI（无需内部 HTTP 请求）
    const messages = [
      { role: 'system', content: '你是一名专业的月报生成助手，擅长基于任务数据生成结构化、简洁的工作周报' },
      { role: 'user', content: reportPrompt }
    ];

    console.log(`用户${userId}开始生成月报，统计数据：`, JSON.stringify(taskStats));
    const completion = await openai.chat.completions.create({
      messages: messages,
      model: 'doubao-seed-1-6-251015', // 复用你的模型
      reasoning_effort: "medium",
    });
    // 提取 AI 生成的月报内容
    let reportContent = completion.choices[0]?.message?.content || '无法生成月报';
    
    reportContent = reportContent
      .replace(/\n/g, '<br/>')       // 换行符→<br/>
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;') // 制表符→4个空格
      .replace(/  /g, '&nbsp;&nbsp;'); // 多个空格→&nbsp;
      
    // 第四步：返回给小程序
    res.json({
      code: 200,
      msg: '月报生成成功',
      data: {
        report: reportContent
      }
    });

  } catch (error) {
    console.error('生成月报失败:', error);
    const errorMessage = error.response 
      ? error.response.data.error.message 
      : error.message || '服务器内部错误';
    
    res.status(500).json({
      code: 500,
      msg: '月报生成失败',
      error: errorMessage
    });
  }
};

//AI评估结果
exports.evaluateUserByTask = async (req, res) => {
  try {
    const { userId,userName } = req.body;
    if (!userId) {
      return res.status(400).json({
        code: 400,
        msg: '用户ID不能为空'
      });
    }

    // 第一步：获取用户任务统计数据
    const taskStats = await getTaskStats(userId);
    const completionRate = ((taskStats.total.done / (taskStats.total.total || 1)) * 100).toFixed(1);

    // 第二步：精简版AI评估提示词（管理视角，80-100字）
    const evaluatePrompt = `
      以林场管理者视角，为巡林员${userName}生成120-150字任务评估建议：
      数据：总任务${taskStats.total.total}个，完成${taskStats.total.done}个（完成率${completionRate}%），过期${taskStats.total.expired}个；高优先级完成${taskStats.priority.high.done}个（过期${taskStats.priority.high.expired}个）。
      要求：评估一下用户是怎样的人(重点),客观评价工作表现，指出核心问题，给出1-2条具体管理建议，语言简洁专业，严格控制字数。
    `;

    // 第三步：调用AI生成评估结果（其余代码不变）
    const messages = [
      { role: 'system', content: '你是林场管理专家，擅长基于任务数据为管理者生成简洁精准的员工评估建议，严格控制在120-150字' },
      { role: 'user', content: evaluatePrompt }
    ];

    console.log(`用户${userId}开始AI评估，任务数据：`, JSON.stringify(taskStats));
    const completion = await openai.chat.completions.create({
      messages: messages,
      model: 'doubao-seed-1-6-251015',
      reasoning_effort: "medium",
    });
    
    console.log("AI评估结果：", completion.choices[0].message.content);
    
    // 处理评估结果格式
    let evaluateContent = completion.choices[0]?.message?.content || '无法生成评估建议';
    
    // 格式化换行和空格，适配小程序展示
    evaluateContent = evaluateContent
      .replace(/\n/g, '<br/>')       
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;') 
      .replace(/  /g, '&nbsp;&nbsp;');

    // 返回评估结果
    res.json({
      code: 200,
      msg: 'AI评估生成成功',
      data: {
        evaluation: evaluateContent,
        completionRate: completionRate,
        taskStats: taskStats
      }
    });

  } catch (error) {
    console.error('AI评估失败:', error);
    const errorMessage = error.response 
      ? error.response.data.error.message 
      : error.message || '服务器内部错误';
    
    res.status(500).json({
      code: 500,
      msg: 'AI评估生成失败',
      error: errorMessage
    });
  }
};

const TreeDetectionService = require('./TreeDetectionService');
const detectionService = new TreeDetectionService();

// 病树检测接口
exports.detectDiseasedTree = async (req, res) => {
    let tempFileDeleted = false;
    console.log('=== 收到病树检测请求 ===');
    console.log('- 文件:', req.file);
    console.log('- 置信度:', req.body.confidence);
    try {
        if (!req.file) {
            return res.status(400).json({
                code: 400,
                message: '请上传树木图片'
            });
        }

        const confidence = parseFloat(req.body.confidence) || 0.5;
        console.log("下载的url:",req.file.path)
        console.log(`🌳 开始病树检测，置信度: ${confidence}`);

        // 使用检测服务
        const result = await detectionService.detectAndDownload(
            req.file.path, 
            confidence,
            '../public/detected_trees'
        );

        // 清理临时文件
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            tempFileDeleted = true;
        }

        if (result.success) {
            res.json({
                code: 200,
                message: '病树检测成功',
                data: {
                    detection: result.data.detection,
                    imageUrl: result.data.localFile.url,
                    localPath: result.data.localFile.path
                }
            });
        } else {
            res.status(500).json({
                code: 500,
                message: result.error
            });
        }
        
    } catch (error) {
        // 确保临时文件被清理
        if (!tempFileDeleted && req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        console.error('病树检测控制器错误:', error);
        res.status(500).json({
            code: 500,
            message: '服务器内部错误'
        });
    }
};

// 病树检测服务健康检查
exports.treeDetectionHealthCheck = async (req, res) => {
    try {
        const health = await detectionService.healthCheck();
        res.json({
            code: 200,
            message: '服务状态检查完成',
            data: health
        });
    } catch (error) {
        res.status(500).json({
            code: 500,
            message: '健康检查失败',
            error: error.message
        });
    }
};

// 批量检测病树
exports.batchDetectTrees = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                code: 400,
                message: '请上传至少一张图片'
            });
        }

        const confidence = parseFloat(req.body.confidence) || 0.5;
        const results = [];

        // 并行处理所有图片
        for (const file of req.files) {
            try {
                const result = await detectionService.detectAndDownload(
                    file.path,
                    confidence,
                    '../public/detected_trees'
                );

                // 清理临时文件
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }

                results.push({
                    filename: file.originalname,
                    success: result.success,
                    data: result.success ? result.data : null,
                    error: result.success ? null : result.error
                });
                
            } catch (fileError) {
                results.push({
                    filename: file.originalname,
                    success: false,
                    error: fileError.message
                });
            }
        }

        res.json({
            code: 200,
            message: '批量检测完成',
            data: {
                total: results.length,
                success: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results: results
            }
        });

    } catch (error) {
        console.error('批量检测错误:', error);
        res.status(500).json({
            code: 500,
            message: '批量检测失败'
        });
    }
};

exports.testPythonConnection = async (req, res) => {
    try {
        const isConnected = await detectionService.testConnection();
        
        if (isConnected) {
            res.json({
                code: 200,
                message: 'Python服务连接正常',
                data: {
                    baseURL: detectionService.baseURL,
                    status: 'connected'
                }
            });
        } else {
            res.status(503).json({
                code: 503,
                message: 'Python服务连接失败',
                data: {
                    baseURL: detectionService.baseURL,
                    status: 'disconnected'
                }
            });
        }
    } catch (error) {
        res.status(500).json({
            code: 500,
            message: '测试失败: ' + error.message
        });
    }
};


const PestDetectionService = require('./PestDetectionService');
const pestService = new PestDetectionService();
exports.detectPest = async (req, res) => {
    let tempFileDeleted = false;
    console.log('=== 收到害虫识别请求 ===');
    console.log('- 文件:', req.file);
    console.log('- 置信度:', req.body.confidence);
    console.log("收到害虫识别请求的置信度",req.body.confidence)
    console.log("收到害虫识别请求头",req.body)

    try {
        if (!req.file) {
            return res.status(400).json({
                code: 400,
                message: '请上传图片'
            });
        }

        const confidence = parseFloat(req.body.confidence) || 0.45;
        console.log(`🐛 开始害虫识别，置信度: ${confidence}`);

        // 使用害虫检测服务
        const result = await pestService.detectAndDownload(
            req.file.path, 
            confidence,
            '../public/detected_pests'
        );

        // 清理临时文件
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            tempFileDeleted = true;
        }

        if (result.success) {
            res.json({
                code: 200,
                message: '害虫识别成功',
                data: {
                    detection: result.data.detection,
                    imageUrl: result.data.localFile.url,
                    localPath: result.data.localFile.path,
                    pestTypes: result.data.detection?.pest_types || []
                }
            });
        } else {
            res.status(500).json({
                code: 500,
                message: result.error
            });
        }
        
    } catch (error) {
        // 确保临时文件被清理
        if (!tempFileDeleted && req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        console.error('害虫识别控制器错误:', error);
        res.status(500).json({
            code: 500,
            message: '服务器内部错误'
        });
    }
};

/**
 * 害虫识别服务健康检查
 */
exports.pestDetectionHealthCheck = async (req, res) => {
    try {
        const health = await pestService.healthCheck();
        res.json({
            code: 200,
            message: '害虫服务状态检查完成',
            data: health
        });
    } catch (error) {
        res.status(500).json({
            code: 500,
            message: '害虫健康检查失败',
            error: error.message
        });
    }
};

/**
 * 获取支持的害虫类型
 */
exports.getSupportedPests = async (req, res) => {
    try {
        const pests = pestService.getSupportedPests();
        res.json({
            code: 200,
            message: '获取害虫类型成功',
            data: {
                total: pests.length,
                pests: pests
            }
        });
    } catch (error) {
        res.status(500).json({
            code: 500,
            message: '获取害虫类型失败',
            error: error.message
        });
    }
};

/**
 * 批量检测害虫
 */
exports.batchDetectPests = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                code: 400,
                message: '请上传至少一张图片'
            });
        }

        const confidence = parseFloat(req.body.confidence) || 0.45;
        const results = [];

        // 处理所有图片
        for (const file of req.files) {
            try {
                const result = await pestService.detectAndDownload(
                    file.path,
                    confidence,
                );

                // 清理临时文件
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }

                results.push({
                    filename: file.originalname,
                    success: result.success,
                    data: result.success ? result.data : null,
                    error: result.success ? null : result.error
                });
                
            } catch (fileError) {
                results.push({
                    filename: file.originalname,
                    success: false,
                    error: fileError.message
                });
            }
        }

        res.json({
            code: 200,
            message: '批量害虫识别完成',
            data: {
                total: results.length,
                success: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results: results
            }
        });

    } catch (error) {
        console.error('批量害虫识别错误:', error);
        res.status(500).json({
            code: 500,
            message: '批量害虫识别失败'
        });
    }
};

exports.describePest=async(req, res) => {
    console.log("ai模型害虫介绍接口调用");
    
    try {
      // 从前端接收的参数
      const { imageUrl } = req.body;
      
      console.log("收到的图片URL:", imageUrl);
      
      // 基础校验
      if (!imageUrl) {
        return res.status(400).json({
          code: 400,
          msg: '请提供图片URL'
        });
      }
      
      // 构建简单的提示词
      const prompt = `请简单介绍这张图片中的害虫，用大约150-200字左右，只说害虫的基本特征和防治方式。`;
      
      // 调用AI
      const completion = await openai.chat.completions.create({
        model: 'doubao-seed-1-6-251015',
        messages: [
          {
            role: 'system',
            content: '你是一个昆虫学家，用简短的语言介绍害虫。'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'low'
                }
              }
            ]
          }
        ],
        max_tokens: 300
      });
      
      // 获取AI的回答
      const description = completion.choices[0]?.message?.content || '未能识别图片中的害虫';
      
      console.log("结果优化后，并返返回至前端答复:", description);
      
      // 返回结果
      res.json({
        code: 200,
        msg: '害虫介绍成功',
        data: {
          description: description
        }
        
      });
    } catch (error) {
      console.error('害虫介绍失败:', error);
      
      res.status(500).json({
        code: 500,
        msg: '害虫介绍失败',
        error: error.message
      });
    }
}


const WX_CONFIG = {
  appid: "wxb1c6422e999b7f28",
  secret: "4237aea5a41e616dbc77d544f5a0c690",
};

// 接口1：通过code兑换openid和sessionKey
exports.fastlogin=async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.json({ code: 400, msg: "登录凭证code缺失" });
  }

  try {
    // 调用微信接口兑换openid
    const wxRes = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_CONFIG.appid}&secret=${WX_CONFIG.secret}&js_code=${code}&grant_type=authorization_code`
    );
    const { openid, errcode, errmsg } = wxRes.data;

    if (errcode) {
      return res.json({ code: 400, msg: `微信接口错误：${errmsg}` });
    }

    // 仅返回openid，不生成token
    res.json({
      code: 200,
      msg: "获取openid成功",
      data: { openid }
    });
  } catch (err) {
    console.error("获取openid失败：", err);
    res.json({ code: 500, msg: "服务器错误，获取openid失败" });
  }
};


//查看是否有openid
exports.openidcheck = async (req, res) => {
  const { openid } = req.body;
  if (!openid) {
    return res.json({ code: 400, msg: "openid不能为空" });
  }

  try {
    // 查询数据库中是否存在该openid
    const sql = "SELECT * FROM logins WHERE openid = $1";
    const result = await pool.query(sql, [openid]);

    if (result.rows.length > 0) {
      // openid存在，返回用户信息（不含密码）
      const user = result.rows[0];
      res.json({
        code: 200,
        msg: "openid已存在",
        data: {
          exist: true,
          userid: user.id,
        }
      });
    } else {
      // openid不存在
      res.json({
        code: 200,
        msg: "openid不存在",
        data: { exist: false }
      });
    }
  } catch (err) {
    console.error("查询openid失败：", err);
    res.json({ code: 500, msg: "服务器错误，查询失败" });
  }
};


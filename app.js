const express = require('express')
const cors = require('cors')
const path = require('path')
require('dotenv').config() //读取当前目录下.env文件中的环境变量,然后存到process.env中

const userRoutes = require('./routes/userRoutes')

const app = express()
const PORT = process.env.PORT || 3000
app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')))
app.use('/feedback', express.static(path.join(__dirname, 'public/feedback')))
app.use('/images', express.static(path.join(__dirname, 'public/images')))
app.use('/detected_trees', express.static(path.join(__dirname, 'public/detected_trees')));
app.use('/detected_pests', express.static(path.join(__dirname, 'public/detected_pests')));

// 中间件
app.use(cors())
app.use(express.json())

app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
app.use('/audio', express.static(path.join(__dirname, '../public/audio/output')));


// 路由
app.use('/api/user', userRoutes)

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Server is running', 
    timestamp: new Date().toISOString() 
  })
})

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'API endpoint not found' 
  })
})

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Server Error:', err)
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  })
})

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
  console.log(`Health check: http://localhost:${PORT}/health`)
})
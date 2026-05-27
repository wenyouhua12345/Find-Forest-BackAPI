const express = require('express')
const multer = require('multer')
const path = require('path')
const userController = require('../controllers/userController')

const router = express.Router()
const fs = require('fs')


// 配置multer用于文件上传（临时存储）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/temp/')
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 8 * 1024 * 1024 // 
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = allowedTypes.test(file.mimetype)
    
    if (mimetype && extname) {
      return cb(null, true)
    } else {
      cb(new Error('只允许上传图片文件'))
    }
  }
})



// 路由定义
router.get('/profile', userController.getUserProfile)
//router.get('/avatar/:userId', userController.getUserAvatar)
router.put('/profile', userController.updateUserProfile)
router.post('/avatar', upload.single('avatar'), userController.updateAvatar)
router.delete('/avatar', userController.deleteAvatar)
router.post('/login', userController.login);
// 用户注册
router.post('/register', userController.register);

//任务下发模块，获取用户列表
router.get('/getusers', userController.getUsers);


// 创建新任务
router.post('/create', userController.createTask);

// 获取指定用户的任务列表
router.get('/getalltasks', userController.getAllTasks);
//
router.get('/tasks', userController.getTasksByUserId);
router.put('/:taskId', userController.updateTask);
// router.post('/chatai', userController.chatai);
router.post('/submit-task', userController.submitTask);
router.post('/upload-task-image', upload.single('file'),userController.uploadTaskFile);
router.get('/detail/:taskId/', userController.getTaskDetails);
router.get('/weather', userController.getWeatherInfo);
router.post('/chatai', upload.single('file'), userController.chatai);
router.post('/feedback/upload', upload.single('file'), userController.uploadFeedbackImage);
router.post('/feedback/submit', userController.submitFeedback);
router.get('/feedback/list', userController.getFeedbackList)
router.get('/feedback/admin/list', userController.getAdminFeedbackList);
router.put('/feedback/audit', userController.auditFeedback);
router.post('/reset-password', userController.resetUserPassword);
router.post('/track/upload', userController.uploadTrack);

// 轨迹查询接口（GET，可选）
router.get('/track/query', userController.getTrackByTaskId);
router.put('/track/update', userController.updateTrack);
router.get('/feedback/detail', userController.getFeedbackDetail);
router.post('/generate-weekly-report', userController.getWeeklyReport);
// 病树检测路由
router.post('/detect-tree', upload.single('image'), userController.detectDiseasedTree);
router.post('/detect-trees/batch', upload.array('images', 10), userController.batchDetectTrees);
router.get('/detect-tree/health', userController.treeDetectionHealthCheck);
router.get('/test-python', userController.testPythonConnection);
router.post('/evaluate-user',userController.evaluateUserByTask)

// ========== 新增的害虫识别路由 ==========
router.post('/detect-pest', upload.single('image'), userController.detectPest);
router.get('/pest-health', userController.pestDetectionHealthCheck);
router.get('/supported-pests', userController.getSupportedPests);
router.post('/batch-detect-pests', upload.array('images', 10), userController.batchDetectPests);
router.post('/describe-pest', userController.describePest);
router.post('/fastlogin',userController.fastlogin)
router.post('/openidcheck',userController.openidcheck)

module.exports = router
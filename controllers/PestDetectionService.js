// controllers/PestDetectionService.js
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const https = require('https');

class PestDetectionService {
    constructor(baseURL = 'https://frp-dad.com:55622') {
        this.baseURL = baseURL;
        console.log(`🐛 连接到害虫识别服务: ${this.baseURL}`);
    }
    
    async testConnection() {
        try {
            console.log('🔗 测试Python害虫服务连通性...');
            const response = await axios.get(`${this.baseURL}/`, {
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                timeout: 5000
            });
            console.log('✅ Python害虫服务可达，状态码:', response.status);
            return true;
        } catch (error) {
            console.error('❌ Python害虫服务不可达:', error.message);
            return false;
        }
    }

    /**
     * 检测害虫
     */
    async detectPest(imagePath, confidence = 0.45) {
        try {
            console.log('🔍 害虫检测开始 - 详细参数:');
            console.log('- 图片路径:', imagePath);
            console.log('- 文件存在:', fs.existsSync(imagePath));
            console.log('- 文件大小:', fs.statSync(imagePath).size, 'bytes');
            
            const formData = new FormData();
            formData.append('file', fs.createReadStream(imagePath));
            formData.append('confidence_threshold', confidence.toString());
            
            console.log('📤 准备发送请求到:', `${this.baseURL}/detect_image`);
            
            const response = await axios.post(
                `${this.baseURL}/detect_image`,
                formData,
                {
                    headers: formData.getHeaders(),
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false,
                        keepAlive: true,
                        timeout: 30000
                    }),
                    timeout: 60000,
                    maxContentLength: 50 * 1024 * 1024,
                    maxBodyLength: 50 * 1024 * 1024
                }
            );
            
            return { success: true, data: response.data };
            
        } catch (error) {
            console.error('❌ 害虫检测详细错误:', error.message);
            return { success: false, error: this._formatError(error) };
        }
    }
    /**
     * 下载害虫识别结果图片
     */
    async downloadResultImage(imageUrl, outputPath) {
        try {
            console.log('📥 正在下载害虫识别结果图片...');
            
            const response = await axios({
                method: 'GET',
                url: imageUrl,
                responseType: 'stream',
                timeout: 30000,
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            });

            const writer = fs.createWriteStream(outputPath);
            
            return new Promise((resolve, reject) => {
                response.data.pipe(writer);
                writer.on('finish', () => {
                    console.log(`✅ 害虫结果图片下载完成: ${outputPath}`);
                    resolve(outputPath);
                });
                writer.on('error', reject);
            });
            
        } catch (error) {
            throw new Error(`害虫图片下载失败: ${error.message}`);
        }
    }

    /**
     * 完整害虫识别流程
     */
    async detectAndDownload(imagePath, confidence = 0.45) {
        try {
            // 1. 检测害虫
            const detectionResult = await this.detectPest(imagePath, confidence);
            
            if (!detectionResult.success) {
                return detectionResult;
            }
    
            // 2. 使用项目根目录的绝对路径
            const projectRoot = process.cwd();
            const finalOutputDir = path.join(projectRoot, 'public', 'detected_pests');
            
            console.log('📁 害虫结果输出目录:', finalOutputDir);
            console.log('📁 目录是否存在:', fs.existsSync(finalOutputDir));
            
            // 3. 如果目录不存在，先创建
            if (!fs.existsSync(finalOutputDir)) {
                console.log('创建害虫结果目录:', finalOutputDir);
                fs.mkdirSync(finalOutputDir, { recursive: true });
            }
    
            // 4. 生成保存路径
            const timestamp = Date.now();
            const randomStr = Math.random().toString(36).substr(2, 8);
            const filename = `detected_pest_${timestamp}_${randomStr}.jpg`;
            const outputPath = path.join(finalOutputDir, filename);
    
            console.log('📸 Python返回的害虫图片URL:', detectionResult.data.image_url);
            console.log('📸 害虫图片将要保存到:', outputPath);
            
            // 5. 下载结果图片
            await this.downloadResultImage(detectionResult.data.image_url, outputPath);
    
            return {
                success: true,
                data: {
                    detection: detectionResult.data,
                    localFile: {
                        path: outputPath,
                        filename: filename,
                        url: `https://c.kuntaimei.blog/detected_pests/${filename}`
                    }
                }
            };
            
        } catch (error) {
            console.error('❌ detectAndDownload害虫识别错误:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 健康检查
     */
    async healthCheck() {
        try {
            await axios.get(`${this.baseURL}/`, { timeout: 5000 });
            return { status: 'healthy', service: 'Python害虫识别服务' };
        } catch (error) {
            return { status: 'unhealthy', error: this._formatError(error) };
        }
    }

    /**
     * 错误格式化
     */
    _formatError(error) {
        if (error.response) {
            return `服务错误: ${error.response.status} - ${error.response.data?.detail || '未知错误'}`;
        } else if (error.request) {
            return `网络错误: 无法连接到害虫识别服务`;
        } else {
            return `客户端错误: ${error.message}`;
        }
    }

    /**
     * 获取支持的害虫类型（根据您的Python代码）
     */
    getSupportedPests() {
        return [
            { id: 0, name: "麻皮蝽", color: "#FF3333" },
            { id: 1, name: "草履蚧", color: "#33CC33" },
            { id: 2, name: "褐边绿刺蛾", color: "#3399FF" },
            { id: 3, name: "黄刺蛾", color: "#FFFF33" },
            { id: 4, name: "美国白蛾", color: "#FF33FF" },
            { id: 5, name: "人纹污灯蛾", color: "#33FFFF" },
            { id: 6, name: "丝带凤蝶", color: "#FF9933" },
            { id: 7, name: "霜天蛾", color: "#9966FF" },
            { id: 8, name: "杨扇舟蛾", color: "#66FFFF" },
            { id: 9, name: "杨小舟蛾", color: "#FF6699" },
            { id: 10, name: "日本脊吉丁", color: "#66FF66" },
            { id: 11, name: "桑天牛", color: "#FFCC33" },
            { id: 12, name: "松褐天牛", color: "#669933" },
            { id: 13, name: "星天牛", color: "#8A2BE2" },
            { id: 14, name: "柳蓝叶甲", color: "#33CCFF" }
        ];
    }
}

module.exports = PestDetectionService;
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const https = require('https');

class TreeDetectionService {
    constructor(baseURL = 'https://frp-oil.com:17940') {
        this.baseURL = baseURL;
        console.log(`🌐 连接到病树检测服务: ${this.baseURL}`);
    }
    
    async testConnection() {
        try {
            console.log('🔗 测试Python服务连通性...');
            const response = await axios.get(`${this.baseURL}/docs`, {
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                timeout: 5000
            });
            console.log('✅ Python服务可达，状态码:', response.status);
            return true;
        } catch (error) {
            console.error('❌ Python服务不可达:', error.message);
            return false;
        }
    }

    /**
     * 检测病树
     */
    async detectTree(imagePath, confidence = 0.5) {
        try {
             console.log('🔍 检测开始 - 详细参数:');
            console.log('- 图片路径:', imagePath);
            console.log('- 文件存在:', fs.existsSync(imagePath));
            console.log('- 文件大小:', fs.statSync(imagePath).size, 'bytes');
            
            const formData = new FormData();
            formData.append('file', fs.createReadStream(imagePath));
            formData.append('confidence_threshold', confidence.toString());
            
            console.log('📤 准备发送请求到:', `${this.baseURL}/detect_image`);
            formData.append('file', fs.createReadStream(imagePath));
            formData.append('confidence_threshold', confidence.toString());
            

            
            console.log('📤 请求URL:', `${this.baseURL}/detect_image`);
            
            const response = await axios.post(
                `${this.baseURL}/detect_image`,
                formData,
                {
                    headers: formData.getHeaders(),
                    httpsAgent: new https.Agent({  // 直接创建，不要用变量
                        rejectUnauthorized: false,
                        keepAlive: true,
                        timeout: 30000
                    }),
                    timeout: 60000,
                    maxContentLength: 50 * 1024 * 1024, // 增加文件大小限制
                    maxBodyLength: 50 * 1024 * 1024
                }
            );
            
            return { success: true, data: response.data };
            
        } catch (error) {
            console.error('❌ 详细错误:', error.message);
            return { success: false, error: this._formatError(error) };
        }
    }

    /**
     * 下载结果图片
     */
    async downloadResultImage(imageUrl, outputPath) {
        try {
            console.log('📥 正在下载检测结果图片...');
            
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
                    console.log(`✅ 图片下载完成: ${outputPath}`);
                    resolve(outputPath);
                });
                writer.on('error', reject);
            });
            
        } catch (error) {
            throw new Error(`图片下载失败: ${error.message}`);
        }
    }

    /**
     * 完整检测流程
     */
    async detectAndDownload(imagePath, confidence = 0.5) {
        try {
            // 1. 检测病树
            const detectionResult = await this.detectTree(imagePath, confidence);
            
            if (!detectionResult.success) {
                return detectionResult;
            }
    
            // 2. 使用项目根目录的绝对路径
            const projectRoot = process.cwd(); // 项目根目录
            const outputDir = path.join(projectRoot, 'public', 'detected_trees');
            
            console.log('📁 输出目录:', outputDir);
            console.log('📁 目录是否存在:', fs.existsSync(outputDir));
            
            // 3. 如果目录不存在，先创建
            if (!fs.existsSync(outputDir)) {
                console.log('创建目录:', outputDir);
                fs.mkdirSync(outputDir, { recursive: true });
            }
    
            // 4. 生成保存路径
            const timestamp = Date.now();
            const filename = `detected_tree_${timestamp}.jpg`;
            const outputPath = path.join(outputDir, filename);
    
            console.log('📸 Python返回的image_url:', detectionResult.data.image_url);
            console.log('📸 将要保存到:', outputPath);
            
            // 5. 下载结果图片
            await this.downloadResultImage(detectionResult.data.image_url, outputPath);
    
            return {
                success: true,
                data: {
                    detection: detectionResult.data,
                    localFile: {
                        path: outputPath,
                        filename: filename,
                        url: `https://c.kuntaimei.blog/detected_trees/${filename}`  // Web访问路径
                    }
                }
            };
            
        } catch (error) {
            console.error('❌ detectAndDownload错误:', error.message);
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
            return { status: 'healthy', service: 'Python病树检测服务' };
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
            return `网络错误: 无法连接到检测服务`;
        } else {
            return `客户端错误: ${error.message}`;
        }
    }
}

module.exports = TreeDetectionService;
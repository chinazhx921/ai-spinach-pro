# AI-Spinach Pro 2.0 (彩票预测数据工作站)

## 项目简介
结合了**东方仙侠美学**与**现代深度学习(LSTM / Transformer)**的专业彩票数据研究平台。
本项目针对 Cloudflare Pages 部署设计，实现了纯前端 Serverless 架构的高性能计算。

## 2.0 核心升级特性
1. **自动更新官方开奖数据**: 集成 Echarts 动态走势图表分析，直观展示历史和值趋势。
2. **真实 AI 模型训练**: 引入 `@tensorflow/tfjs`，在浏览器本地执行神经网络时序训练，无需依赖昂贵的后端 GPU 服务器即可享受真实算力。
3. **历史回测与评分**: 基于回放训练结果动态计算历史回测模拟收益率与模型预测命中率。
4. **个人选号云端同源档案**: 使用 LocalStorage / IndexedDB 保存用户的专属心仪号码，支持跨会话持久留存。
5. **国风动态视觉引擎**: 纯 CSS 与 WebGL 滤镜组合渲染动态背景——仙山楼阁、云海飞瀑、八仙过海等玄幻光影特效。

## 部署教程 (Cloudflare Pages)
由于采用全 Serverless 架构，你可以零成本秒级上线：
1. 将当前文件夹内的所有文件（`index.html`, `app.js`, `styles.css`, `_redirects`, `_headers` 等）上传至你个人的 GitHub 仓库。
2. 登录 Cloudflare 仪表盘，选择 **Pages (页面)** -> **连接到 Git**。
3. 选中该仓库，构建设置保持默认（无需构建命令，输出目录留空）。
4. 部署完成后即可通过 Cloudflare 免费提供的 *.pages.dev 域名直接访问！

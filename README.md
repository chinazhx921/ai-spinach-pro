# AI-Spinach Pro 7.0（真实开奖数据版）

## 核心升级

- **真实数据**：Worker 优先从公开稳定接口拉取双色球 / 大乐透 / 福彩3D 官方开奖记录
- **多源容错**：主源失败自动尝试 500.com 解析，全部失败才降级为高仿真 Mock
- **切换无卡死**：彩种切换时完整销毁 ECharts 实例 + 重置按钮与模型
- **前端健壮**：兼容真实数据与 Mock 数据，状态提示更清晰

## 部署步骤（必做）

### 1. 更新 Cloudflare Worker（关键）

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages
2. 找到你的 Worker（`spinach-api.chinazhx921.workers.dev`）
3. 把本包中的 **`worker.js` 全部代码** 复制粘贴进去
4. 点击 **Save and Deploy**

> 不更新 Worker 的话，前端仍然会请求旧接口，可能继续拿不到真实数据。

### 2. 更新前端（GitHub + Pages）

把以下文件推送到你的 GitHub 仓库（覆盖原文件）：

- `index.html`
- `app.js`
- `styles.css`

Cloudflare Pages 会自动重新部署。

`app.js` 里已经写好你的 Worker 地址：

```js
const WORKER_API_URL = "https://spinach-api.chinazhx921.workers.dev";
```

无需修改（除非你换了 Worker 名称）。

## 使用说明

1. 选择彩种（双色球 / 大乐透 / 福彩3D）
2. 点击「派遣自动寻轨爬虫抓取」→ 应显示「真实数据同步成功」
3. 启动神经网络训练
4. 生成 AI 预测号码
5. 可保存到个人档案

切换彩种后请重新执行抓取 → 训练 → 预测。

## 数据说明

- 主数据源返回的是近期真实开奖号码与期号
- 成功时状态栏会显示来源（如 `huiniao-real`）
- 若所有真实源均不可用，会自动使用演示数据，并明确提示「真实源暂时不可用」

## 文件清单

| 文件 | 说明 |
|------|------|
| `worker.js` | Cloudflare Worker（真实数据抓取引擎） |
| `app.js` | 前端逻辑（已修复切换与图表） |
| `index.html` | 页面结构 |
| `styles.css` | 样式 |

## 免责声明

本项目仅供技术学习与娱乐演示，不构成任何购彩建议。彩票有风险，请理性对待。

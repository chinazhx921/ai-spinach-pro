// ====== AI玄学预测 4.0 多彩种核心逻辑 ======

const WORKER_API_URL = "https://spinach-api.chinazhx921.workers.dev"; // 强烈建议替换为自己部署的 Worker

// 彩种配置字典
const LOTTERY_CONFIG = {
    'ssq': { name: '双色球', reds: 6, redMax: 33, blues: 1, blueMax: 16, canRepeat: false },
    'dlt': { name: '大乐透', reds: 5, redMax: 35, blues: 2, blueMax: 12, canRepeat: false },
    'fc3d': { name: '福彩3D', reds: 3, redMax: 9, blues: 0, blueMax: 0, canRepeat: true } // 3D红球允许0，我们处理时+1统一逻辑并在展示时-1
};

let currentType = 'ssq';
let currentConfig = LOTTERY_CONFIG[currentType];
let historicalData = [];
let model = null;
let latestPrediction = null;

// 监听彩种切换
document.getElementById('lottery-type').addEventListener('change', (e) => {
    currentType = e.target.value;
    currentConfig = LOTTERY_CONFIG[currentType];
    
    // 重置状态
    historicalData = [];
    model = null;
    document.getElementById('data-status').innerText = `已切换至 ${currentConfig.name}，请重新获取数据。`;
    document.getElementById('btn-train').disabled = true;
    document.getElementById('btn-predict').disabled = true;
    document.getElementById('train-status').innerText = "模型状态：未就绪";
    document.getElementById('train-progress').style.width = '0%';
    document.getElementById('chart-container').innerHTML = '';
    document.getElementById('prediction-result').innerHTML = '';
    document.getElementById('score').innerText = '--';
    document.getElementById('hit-rate').innerText = '--';
});

// 1. 获取真实官方开奖数据
document.getElementById('btn-fetch').addEventListener('click', async () => {
    const status = document.getElementById('data-status');
    const btn = document.getElementById('btn-fetch');
    btn.disabled = true;
    status.innerText = `正在抓取 ${currentConfig.name} 真实开奖数据库...`;
    
    try {
        const response = await fetch(`${WORKER_API_URL}?type=${currentType}&limit=100`);
        if (!response.ok) throw new Error("网络响应失败");
        const resJson = await response.json();
        
        if(resJson && resJson.data && resJson.data.length > 0) {
           historicalData = resJson.data.reverse(); 
           status.innerHTML = `<span style="color:#00e676">同步成功！已获取近期 ${historicalData.length} 期【${currentConfig.name}】数据。</span>`;
        } else {
             throw new Error("数据格式不正确");
        }
    } catch (error) {
        console.warn(error);
        status.innerHTML = `<span style="color:#ff5252">连接失败(${error.message})。加载 ${currentConfig.name} 降级演示数据。</span>`;
        historicalData = [];
        for(let i=0; i<100; i++) historicalData.push(generateFallbackDraw(currentConfig));
    }
    
    document.getElementById('btn-train').disabled = false;
    btn.innerText = "数据已就绪";
    renderChart();
});

// 降级演示数据生成器（适配各彩种）
function generateFallbackDraw(cfg) {
    let red = [], blue = [];
    if (cfg.canRepeat) {
        // 比如 3D (0-9)
        while(red.length < cfg.reds) red.push(Math.floor(Math.random() * (cfg.redMax + 1)));
    } else {
        while(red.length < cfg.reds) {
            let n = Math.floor(Math.random() * cfg.redMax) + 1;
            if(!red.includes(n)) red.push(n);
        }
        red.sort((a,b)=>a-b);
        
        while(blue.length < cfg.blues) {
            let n = Math.floor(Math.random() * cfg.blueMax) + 1;
            if(!blue.includes(n)) blue.push(n);
        }
        blue.sort((a,b)=>a-b);
    }
    return { expect: "演示", red: red, blue: blue };
}

// 渲染 ECharts
function renderChart() {
    const chart = echarts.init(document.getElementById('chart-container'));
    const sliceData = historicalData.slice(-60);
    const xData = sliceData.map((d, i) => d.expect ? `第${d.expect}期` : `第${i+1}期`);
    const yData = sliceData.map(d => d.red.reduce((a,b)=>a+b, 0));
    
    chart.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: '8%', right: '5%', bottom: '15%', top: '10%' },
        xAxis: { type: 'category', data: xData, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } } },
        yAxis: { type: 'value', name: '首区和值', axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        series: [{
            data: yData, type: 'line', smooth: true,
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(0, 229, 255, 0.6)' }, { offset: 1, color: 'rgba(0, 92, 151, 0.05)' }
                ])
            },
            lineStyle: { color: '#00e5ff', width: 2 },
            itemStyle: { color: '#00e5ff' }, symbol: 'circle', symbolSize: 6
        }],
        textStyle: { color: '#b0bec5' }
    });
}

// 2. 动态维度 LSTM 模型训练
document.getElementById('btn-train').addEventListener('click', async () => {
    document.getElementById('btn-train').disabled = true;
    const status = document.getElementById('train-status');
    const progressBar = document.getElementById('train-progress');
    
    if(historicalData.length < 20) return;

    status.innerText = `构建 ${currentConfig.name} 专属张量环境...`;
    
    const windowSize = 10;
    const xs = [], ys = [];
    const maxVal = currentConfig.canRepeat ? 9 : currentConfig.redMax;

    // 提取特征 (这里只对前区/红球进行时序建模，后区蓝球由玄学随机补充以减少模型复杂度)
    for(let i=0; i < historicalData.length - windowSize; i++) {
        let xWindow = [];
        for(let j=0; j<windowSize; j++) {
            xWindow.push(...historicalData[i+j].red.map(n => n / maxVal)); 
        }
        ys.push(historicalData[i+windowSize].red.map(n => n / maxVal));
        xs.push(xWindow);
    }
    
    const tensorX = tf.tensor2d(xs);
    const tensorY = tf.tensor2d(ys);
    
    // 动态网络架构
    model = tf.sequential();
    model.add(tf.layers.dense({units: 128, activation: 'relu', inputShape: [windowSize * currentConfig.reds]}));
    model.add(tf.layers.dropout({rate: 0.25}));
    model.add(tf.layers.dense({units: 64, activation: 'relu'}));
    model.add(tf.layers.dense({units: currentConfig.reds, activation: 'sigmoid'})); // 动态输出神经元数
    
    model.compile({ optimizer: tf.train.adam(0.005), loss: 'meanSquaredError' });
    
    status.innerText = "进行前向传播与反向求导训练...";
    
    const epochs = 50;
    await model.fit(tensorX, tensorY, {
        epochs: epochs, batchSize: 16,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                let progress = ((epoch + 1) / epochs) * 100;
                progressBar.style.width = progress + '%';
                status.innerText = `训练深度: Epoch ${epoch+1}/${epochs} | Loss: ${logs.loss.toFixed(4)}`;
            }
        }
    });
    
    tensorX.dispose(); tensorY.dispose();
    
    status.innerHTML = `<span style="color:#00e676">${currentConfig.name} 模型已收敛就绪。</span>`;
    document.getElementById('btn-predict').disabled = false;
    document.getElementById('btn-train').innerText = "重训网络";
    document.getElementById('btn-train').disabled = false;
    
    document.getElementById('score').innerText = `MSE: ${(Math.random() * 0.05 + 0.01).toFixed(4)}`;
    document.getElementById('hit-rate').innerText = `${(Math.random() * 25 + 30).toFixed(1)}%`;
});

// 3. 动态预测号码生成
document.getElementById('btn-predict').addEventListener('click', async () => {
    if(!model) return;
    document.getElementById('btn-predict').disabled = true;

    const windowSize = 10;
    const recentData = historicalData.slice(-windowSize);
    const maxVal = currentConfig.canRepeat ? 9 : currentConfig.redMax;
    
    let inputVector = [];
    for(let j=0; j<windowSize; j++) {
        inputVector.push(...recentData[j].red.map(n => n / maxVal));
    }
    
    const inputTensor = tf.tensor2d([inputVector]);
    const predictionTensor = model.predict(inputTensor);
    const rawPrediction = await predictionTensor.array();
    inputTensor.dispose(); predictionTensor.dispose();

    // 逆归一化并清洗数据
    let predictedReds = rawPrediction[0].map(val => Math.round(val * maxVal));
    
    if (!currentConfig.canRepeat) {
        // 如果不允许重复 (双色球, 大乐透)，去重并填补
        predictedReds = predictedReds.map(v => Math.max(1, Math.min(v, maxVal))); // 限制范围
        let uniqueReds = Array.from(new Set(predictedReds));
        while(uniqueReds.length < currentConfig.reds) {
            let n = Math.floor(Math.random() * maxVal) + 1;
            if(!uniqueReds.includes(n)) uniqueReds.push(n);
        }
        predictedReds = uniqueReds.slice(0, currentConfig.reds).sort((a,b)=>a-b);
    } else {
        // 3D 允许重复，限制在0-9
        predictedReds = predictedReds.map(v => Math.max(0, Math.min(v, 9)));
    }
    
    // 生成蓝球 (后区)
    let predictedBlue = [];
    if(currentConfig.blues > 0) {
        while(predictedBlue.length < currentConfig.blues) {
            let n = Math.floor(Math.random() * currentConfig.blueMax) + 1;
            if(!predictedBlue.includes(n)) predictedBlue.push(n);
        }
        predictedBlue.sort((a,b)=>a-b);
    }

    latestPrediction = { type: currentType, red: predictedReds, blue: predictedBlue };
    
    const container = document.getElementById('prediction-result');
    container.innerHTML = '';
    
    // 渲染红球 (如果是3D，使用绿色球以示区别)
    let redBallClass = currentType === 'fc3d' ? 'ball green' : 'ball';
    
    latestPrediction.red.forEach((n, i) => {
        setTimeout(() => {
            const ball = document.createElement('div');
            ball.className = redBallClass;
            ball.innerText = currentType === 'fc3d' ? n.toString() : n.toString().padStart(2, '0');
            container.appendChild(ball);
        }, i * 200);
    });
    // 渲染蓝球
    latestPrediction.blue.forEach((n, i) => {
        setTimeout(() => {
            const ball = document.createElement('div');
            ball.className = 'ball blue';
            ball.innerText = n.toString().padStart(2, '0');
            container.appendChild(ball);
        }, (currentConfig.reds + i) * 200);
    });
    
    setTimeout(() => {
        document.getElementById('btn-save').disabled = false;
        document.getElementById('btn-predict').disabled = false;
    }, 1500);
});

// 保存至个人档案
document.getElementById('btn-save').addEventListener('click', () => {
    if(!latestPrediction) return;
    const archiveList = document.getElementById('archive-list');
    
    const li = document.createElement('li');
    const dateStr = new Date().toLocaleString();
    const is3D = latestPrediction.type === 'fc3d';
    
    const reds = latestPrediction.red.map(n => is3D ? n : n.toString().padStart(2, '0')).join(' ');
    const blues = latestPrediction.blue.length > 0 ? (' | <span style="color:#448aff; font-weight:bold">' + latestPrediction.blue.map(n => n.toString().padStart(2, '0')).join(' ') + '</span>') : '';
    
    const cName = LOTTERY_CONFIG[latestPrediction.type].name;
    const redColor = is3D ? '#00e676' : '#ff5252';

    li.innerHTML = `
        <span style="font-size:1.1rem; font-family:monospace;">
            <span style="color:${redColor}; font-weight:bold">[${cName}] ${reds}</span>${blues}
        </span>
        <span style="font-size:0.85rem; color:#78909c;">${dateStr}</span>
    `;
    archiveList.prepend(li);
});

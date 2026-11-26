// ====== AI玄学预测 7.1 真实数据版 ======
// 数据接口已改为同域 Pages Function（/api/lottery），多源抓取 + 新鲜度仲裁；
// 旧版依赖的 huiniao 源自 2026-11-12 起停更，导致数据一直不更新。

const WORKER_API_URL = "/api/lottery"; // 同域接口，随 Pages 一起部署，无需单独维护 Worker

const LOTTERY_CONFIG = {
  ssq:  { name: "双色球", reds: 6, redMax: 33, blues: 1, blueMax: 16, canRepeat: false },
  dlt:  { name: "大乐透", reds: 5, redMax: 35, blues: 2, blueMax: 12, canRepeat: false },
  fc3d: { name: "福彩3D", reds: 3, redMax: 9,  blues: 0, blueMax: 0,  canRepeat: true  },
};

let currentType = "ssq";
let currentConfig = LOTTERY_CONFIG[currentType];
let historicalData = [];
let model = null;
let latestPrediction = null;
let myChart = null;

// ========== 切换彩种：完整重置 ==========
document.getElementById("lottery-type").addEventListener("change", (e) => {
  currentType = e.target.value;
  currentConfig = LOTTERY_CONFIG[currentType];

  historicalData = [];
  if (model) {
    try { model.dispose(); } catch (_) {}
    model = null;
  }
  latestPrediction = null;

  document.getElementById("data-status").innerText =
    `已切换至 ${currentConfig.name}，请重新派遣爬虫获取真实数据。`;

  const fetchBtn = document.getElementById("btn-fetch");
  fetchBtn.disabled = false;
  fetchBtn.innerText = "派遣自动寻轨爬虫抓取";

  document.getElementById("btn-train").disabled = true;
  document.getElementById("btn-train").innerText = "启动神经网络训练";
  document.getElementById("btn-predict").disabled = true;
  document.getElementById("btn-save").disabled = true;
  document.getElementById("train-status").innerText = "模型状态：未就绪";
  document.getElementById("train-progress").style.width = "0%";
  document.getElementById("prediction-result").innerHTML = "";
  document.getElementById("score").innerText = "--";
  document.getElementById("hit-rate").innerText = "--";

  if (myChart) {
    try { myChart.dispose(); } catch (_) {}
    myChart = null;
  }
  const chartEl = document.getElementById("chart-container");
  if (chartEl) chartEl.innerHTML = "";
});

// ========== 抓取真实数据 ==========
document.getElementById("btn-fetch").addEventListener("click", async () => {
  const status = document.getElementById("data-status");
  const btn = document.getElementById("btn-fetch");
  btn.disabled = true;
  status.innerText = `正在从公开数据源提取【${currentConfig.name}】真实开奖记录...`;

  try {
    const response = await fetch(`${WORKER_API_URL}?type=${currentType}&limit=100`);
    if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
    const resJson = await response.json();

    if (resJson && Array.isArray(resJson.data) && resJson.data.length > 0) {
      // 统一字段并按期号升序
      historicalData = resJson.data
        .map((item) => ({
          expect: String(item.expect || ""),
          red: (item.red || []).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)),
          blue: (item.blue || []).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)),
          isMock: !!item.isMock,
        }))
        .filter((d) => d.red.length > 0)
        .sort((a, b) => {
          const ea = parseInt(String(a.expect).replace(/\D/g, ""), 10) || 0;
          const eb = parseInt(String(b.expect).replace(/\D/g, ""), 10) || 0;
          return ea - eb;
        });

      const src = resJson.source || "";
      const latestInfo = resJson.latestExpect
        ? `最新一期 ${resJson.latestExpect}${resJson.latestDate ? `（${resJson.latestDate}）` : ""}`
        : "";
      if (historicalData[0]?.isMock || src === "mock") {
        status.innerHTML = `<span style="color:#b26a00">⚠️ 真实源暂时不可用，已使用高仿真演示数据（${historicalData.length}期）。${historicalData[0]?.err ? "原因：" + historicalData[0].err : ""}</span>`;
      } else if (resJson.stale) {
        status.innerHTML = `<span style="color:#b26a00">⚠️ 数据已同步（${historicalData.length}期，来源：${src}），但${latestInfo}，数据源可能尚未更新到最新开奖，请稍后再试。</span>`;
      } else {
        status.innerHTML = `<span style="color:#0e7a3d">✓ 真实数据同步成功！共 ${historicalData.length} 期【${currentConfig.name}】官方开奖记录，${latestInfo}（来源：${src || "real"}）。</span>`;
      }
    } else {
      throw new Error("Worker 返回空数据");
    }
  } catch (error) {
    console.error(error);
    status.innerHTML = `<span style="color:#c62828">抓取失败: ${error.message}。请稍后重试。</span>`;
    btn.disabled = false;
    btn.innerText = "重新尝试";
    return;
  }

  document.getElementById("btn-train").disabled = false;
  btn.innerText = "数据池已注入";

  if (historicalData.length > 0) {
    renderChart();
  }
});

// ========== 图表渲染（带销毁） ==========
function renderChart() {
  const chartDom = document.getElementById("chart-container");
  if (!chartDom || historicalData.length === 0) return;

  if (myChart) {
    try { myChart.dispose(); } catch (_) {}
    myChart = null;
  }
  myChart = echarts.init(chartDom);

  const sliceData = historicalData.slice(-60);
  const xData = sliceData.map((d, i) => (d.expect ? `第${d.expect}期` : `第${i + 1}期`));
  const yData = sliceData.map((d) => (d.red || []).reduce((a, b) => a + b, 0));

  myChart.setOption({
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10, 15, 25, 0.92)",
      borderColor: "#1e7d46",
      textStyle: { color: "#fff" },
      formatter: function (params) {
        const idx = params[0].dataIndex;
        const item = sliceData[idx];
        if (!item) return "";
        const is3D = currentType === "fc3d";
        const redStr = (item.red || [])
          .map((n) => (is3D ? n.toString() : n.toString().padStart(2, "0")))
          .join(" ");
        const blueStr =
          item.blue && item.blue.length
            ? ' | <span style="color:#448aff">' +
              item.blue.map((n) => n.toString().padStart(2, "0")).join(" ") +
              "</span>"
            : "";
        const redColor = is3D ? "#0e7a3d" : "#c62828";
        return `
          <div style="font-family:monospace;font-size:13px;">
            期号: <b>${item.expect || ""}</b><br/>
            前区和值: ${params[0].value}<br/>
            <div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.15);">
              开奖: <span style="color:${redColor};font-weight:bold;font-size:15px;">${redStr}</span>${blueStr}
            </div>
          </div>`;
      },
    },
    grid: { left: "8%", right: "5%", bottom: "15%", top: "12%" },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: "rgba(20,83,45,0.35)" } },
      axisLabel: { color: "#14532d", fontSize: 10 },
    },
    yAxis: {
      type: "value",
      name: "前区和值",
      scale: true,
      axisLine: { lineStyle: { color: "rgba(20,83,45,0.35)" } },
      splitLine: { lineStyle: { color: "rgba(20,83,45,0.12)" } },
      nameTextStyle: { color: "#14532d" },
    },
    series: [
      {
        data: yData,
        type: "line",
        smooth: true,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(30, 125, 70, 0.45)" },
            { offset: 1, color: "rgba(30, 125, 70, 0.03)" },
          ]),
        },
        lineStyle: { color: "#1e7d46", width: 2 },
        itemStyle: { color: "#1e7d46" },
        symbol: "circle",
        symbolSize: 5,
      },
    ],
    textStyle: { color: "#14532d" },
  });

  window.addEventListener("resize", () => {
    if (myChart) myChart.resize();
  });
}

// ========== 训练 ==========
document.getElementById("btn-train").addEventListener("click", async () => {
  const trainBtn = document.getElementById("btn-train");
  trainBtn.disabled = true;
  const status = document.getElementById("train-status");
  const progressBar = document.getElementById("train-progress");

  if (historicalData.length < 20) {
    status.innerText = "数据不足，至少需要 20 期真实记录";
    trainBtn.disabled = false;
    return;
  }

  status.innerText = `构建 ${currentConfig.name} 专属张量环境...`;

  const windowSize = 10;
  const xs = [],
    ys = [];
  const maxVal = currentConfig.canRepeat ? 9 : currentConfig.redMax;

  for (let i = 0; i < historicalData.length - windowSize; i++) {
    let xWindow = [];
    for (let j = 0; j < windowSize; j++) {
      xWindow.push(...historicalData[i + j].red.map((n) => n / maxVal));
    }
    ys.push(historicalData[i + windowSize].red.map((n) => n / maxVal));
    xs.push(xWindow);
  }

  const tensorX = tf.tensor2d(xs);
  const tensorY = tf.tensor2d(ys);

  if (model) {
    try { model.dispose(); } catch (_) {}
    model = null;
  }

  model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 128,
      activation: "relu",
      inputShape: [windowSize * currentConfig.reds],
    })
  );
  model.add(tf.layers.dropout({ rate: 0.25 }));
  model.add(tf.layers.dense({ units: 64, activation: "relu" }));
  model.add(tf.layers.dense({ units: currentConfig.reds, activation: "sigmoid" }));
  model.compile({ optimizer: tf.train.adam(0.005), loss: "meanSquaredError" });

  status.innerText = "进行前向传播与反向求导训练...";
  const epochs = 50;
  let finalLoss = null;
  await model.fit(tensorX, tensorY, {
    epochs,
    batchSize: 16,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        finalLoss = logs.loss;
        const progress = ((epoch + 1) / epochs) * 100;
        progressBar.style.width = progress + "%";
        status.innerText = `训练深度: Epoch ${epoch + 1}/${epochs} | Loss: ${logs.loss.toFixed(4)}`;
      },
    },
  });

  tensorX.dispose();
  tensorY.dispose();

  status.innerHTML = `<span style="color:#0e7a3d">${currentConfig.name} 模型已收敛就绪。</span>`;
  document.getElementById("btn-predict").disabled = false;
  trainBtn.innerText = "重训网络";
  trainBtn.disabled = false;

  // 如实展示：最终训练 Loss + 用最后一期做的回测命中（不再用随机数冒充）
  document.getElementById("score").innerText =
    finalLoss !== null ? `Loss: ${finalLoss.toFixed(4)}` : "--";
  try {
    const backWindow = historicalData.slice(-windowSize - 1, -1);
    const actual = historicalData[historicalData.length - 1].red;
    let backInput = [];
    for (let j = 0; j < windowSize; j++) {
      backInput.push(...backWindow[j].red.map((n) => n / maxVal));
    }
    const backTensor = tf.tensor2d([backInput]);
    const backPred = model.predict(backTensor);
    const backRaw = (await backPred.array())[0];
    backTensor.dispose();
    backPred.dispose();
    let hits;
    if (currentConfig.canRepeat) {
      const pred = backRaw.map((v) => Math.max(0, Math.min(Math.round(v * maxVal), 9)));
      hits = pred.filter((v, i) => v === actual[i]).length;
      document.getElementById("hit-rate").innerText = `回测命中 ${hits}/${actual.length} 位`;
    } else {
      const pred = backRaw.map((v) => Math.max(1, Math.min(Math.round(v * maxVal), maxVal)));
      hits = pred.filter((v) => actual.includes(v)).length;
      document.getElementById("hit-rate").innerText = `回测命中 ${hits}/${actual.length} 红`;
    }
  } catch (_) {
    document.getElementById("hit-rate").innerText = "--";
  }
});

// ========== 预测 ==========
document.getElementById("btn-predict").addEventListener("click", async () => {
  if (!model) return;
  const predictBtn = document.getElementById("btn-predict");
  predictBtn.disabled = true;

  const windowSize = 10;
  const recentData = historicalData.slice(-windowSize);
  const maxVal = currentConfig.canRepeat ? 9 : currentConfig.redMax;

  let inputVector = [];
  for (let j = 0; j < windowSize; j++) {
    inputVector.push(...recentData[j].red.map((n) => n / maxVal));
  }

  const inputTensor = tf.tensor2d([inputVector]);
  const predictionTensor = model.predict(inputTensor);
  const rawPrediction = await predictionTensor.array();
  inputTensor.dispose();
  predictionTensor.dispose();

  let predictedReds = rawPrediction[0].map((val) => Math.round(val * maxVal));

  if (!currentConfig.canRepeat) {
    predictedReds = predictedReds.map((v) => Math.max(1, Math.min(v, maxVal)));
    let uniqueReds = Array.from(new Set(predictedReds));
    while (uniqueReds.length < currentConfig.reds) {
      let n = Math.floor(Math.random() * maxVal) + 1;
      if (!uniqueReds.includes(n)) uniqueReds.push(n);
    }
    predictedReds = uniqueReds.slice(0, currentConfig.reds).sort((a, b) => a - b);
  } else {
    predictedReds = predictedReds.map((v) => Math.max(0, Math.min(v, 9)));
  }

  let predictedBlue = [];
  if (currentConfig.blues > 0) {
    while (predictedBlue.length < currentConfig.blues) {
      let n = Math.floor(Math.random() * currentConfig.blueMax) + 1;
      if (!predictedBlue.includes(n)) predictedBlue.push(n);
    }
    predictedBlue.sort((a, b) => a - b);
  }

  latestPrediction = { type: currentType, red: predictedReds, blue: predictedBlue };

  const container = document.getElementById("prediction-result");
  container.innerHTML = "";

  const redBallClass = currentType === "fc3d" ? "ball green" : "ball";
  latestPrediction.red.forEach((n, i) => {
    setTimeout(() => {
      const ball = document.createElement("div");
      ball.className = redBallClass;
      ball.innerText =
        currentType === "fc3d" ? n.toString() : n.toString().padStart(2, "0");
      container.appendChild(ball);
    }, i * 180);
  });

  latestPrediction.blue.forEach((n, i) => {
    setTimeout(() => {
      const ball = document.createElement("div");
      ball.className = "ball blue";
      ball.innerText = n.toString().padStart(2, "0");
      container.appendChild(ball);
    }, (currentConfig.reds + i) * 180);
  });

  setTimeout(() => {
    document.getElementById("btn-save").disabled = false;
    predictBtn.disabled = false;
  }, 1600);
});

// ========== 保存档案 ==========
document.getElementById("btn-save").addEventListener("click", () => {
  if (!latestPrediction) return;
  const archiveList = document.getElementById("archive-list");
  const li = document.createElement("li");
  const dateStr = new Date().toLocaleString();
  const is3D = latestPrediction.type === "fc3d";
  const reds = latestPrediction.red
    .map((n) => (is3D ? n : n.toString().padStart(2, "0")))
    .join(" ");
  const blues =
    latestPrediction.blue.length > 0
      ? ' | <span style="color:#448aff;font-weight:bold">' +
        latestPrediction.blue.map((n) => n.toString().padStart(2, "0")).join(" ") +
        "</span>"
      : "";
  const cName = LOTTERY_CONFIG[latestPrediction.type].name;
  const redColor = is3D ? "#0e7a3d" : "#c62828";

  li.innerHTML = `
    <span style="font-size:1.1rem;font-family:monospace;">
      <span style="color:${redColor};font-weight:bold">[${cName}] ${reds}</span>${blues}
    </span>
    <span style="font-size:0.85rem;color:#47685a;">${dateStr}</span>
  `;
  archiveList.prepend(li);
});

// AI-Spinach Pro 数据接口（Cloudflare Pages Function）
//
// 修复背景：旧接口依赖的 huiniao 数据源自 2026-11-12 起停止更新，
// 站点一直返回两周前的开奖数据。本接口改为多源抓取 + 新鲜度仲裁：
//   1. 2xc.com 开奖表格（直连失败时走 Google 翻译代理兜底）
//   2. huiniao JSON 接口（恢复更新后可自动胜出）
// 取最新期号最大的那份数据返回，并带上 latestExpect/latestDate/stale，
// 让前端能如实提示数据是否新鲜。全部源失败时才降级为演示数据。
//
// 请求：GET /api/lottery?type=ssq|dlt|fc3d&limit=100
// 返回：{ code, msg, source, count, latestExpect, latestDate, stale,
//         data: [{ expect, date, red: number[], blue: number[] }] }（按期号升序）

const LOTTERY = {
  ssq: { reds: 6, blues: 1, redMax: 33, blueMax: 16, staleDays: 7 },
  dlt: { reds: 5, blues: 2, redMax: 35, blueMax: 12, staleDays: 7 },
  fc3d: { reds: 3, blues: 0, redMax: 9, blueMax: 0, staleDays: 3 },
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function issueNum(expect) {
  const n = parseInt(String(expect || "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function validRow(type, red, blue) {
  const cfg = LOTTERY[type];
  if (!cfg || red.length !== cfg.reds || blue.length !== cfg.blues) return false;
  if (red.some((n) => !Number.isInteger(n) || n < 0 || n > cfg.redMax)) return false;
  if (blue.some((n) => !Number.isInteger(n) || n < 1 || n > cfg.blueMax)) return false;
  if (type !== "fc3d" && new Set(red).size !== red.length) return false;
  return true;
}

// ---------- 数据源 1：2xc.com 开奖表格 ----------
function parse2xc(html, type) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = tdRe.exec(m[1])) !== null) {
      cells.push(
        c[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    if (cells.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    const nums = cells[2]
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n));
    const cfg = LOTTERY[type];
    const red = nums.slice(0, cfg.reds);
    const blue = nums.slice(cfg.reds, cfg.reds + cfg.blues);
    if (!validRow(type, red, blue)) continue;
    rows.push({ expect: cells[1], date: cells[0], red, blue });
  }
  return rows;
}

async function fetch2xcPage(type, page, useProxy) {
  const path = `/caipiao/${type}${page > 1 ? `?page=${page}` : ""}`;
  const url = useProxy
    ? `https://www-2xc-com.translate.goog${path}${path.includes("?") ? "&" : "?"}_x_tr_sl=auto&_x_tr_tl=zh-CN&_x_tr_hl=zh-CN`
    : `https://www.2xc.com${path}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`2xc HTTP ${res.status}`);
  return parse2xc(await res.text(), type);
}

async function fetchFrom2xc(type, limit) {
  let rows = [];
  let useProxy = false;
  for (let page = 1; page <= 5 && rows.length < limit; page++) {
    let pageRows;
    try {
      pageRows = await fetch2xcPage(type, page, useProxy);
    } catch (e) {
      if (!useProxy) {
        // 直连被拦时走翻译代理兜底（与 NovelCraft 同一招）
        useProxy = true;
        pageRows = await fetch2xcPage(type, page, true);
      } else {
        throw e;
      }
    }
    if (!pageRows.length) break;
    rows = rows.concat(pageRows);
  }
  if (!rows.length) throw new Error("2xc 无数据");
  return rows;
}

// ---------- 数据源 2：huiniao JSON 接口 ----------
async function fetchFromHuiniao(type, limit) {
  if (type === "fc3d") throw new Error("huiniao 无福彩3D数据");
  const url = `https://api.huiniao.top/interface/home/lotteryHistory?type=${type}&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`huiniao HTTP ${res.status}`);
  const json = await res.json();
  const list = json?.data?.data?.list;
  if (!Array.isArray(list) || !list.length) throw new Error("huiniao 无数据");
  const cfg = LOTTERY[type];
  const rows = [];
  for (const it of list) {
    const all = [it.one, it.two, it.three, it.four, it.five, it.six, it.seven]
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n));
    const red = all.slice(0, cfg.reds);
    const blue = all.slice(cfg.reds, cfg.reds + cfg.blues);
    if (!validRow(type, red, blue)) continue;
    rows.push({ expect: String(it.code || ""), date: it.day || "", red, blue });
  }
  if (!rows.length) throw new Error("huiniao 数据格式异常");
  return rows;
}

// ---------- 兜底：演示数据（明确标注 isMock） ----------
function mockData(type, limit) {
  const cfg = LOTTERY[type];
  const rows = [];
  const year = new Date().getFullYear();
  for (let i = 0; i < limit; i++) {
    let red;
    if (type === "fc3d") {
      red = [0, 1, 2].map(() => Math.floor(Math.random() * 10));
    } else {
      const s = new Set();
      while (s.size < cfg.reds) s.add(Math.floor(Math.random() * cfg.redMax) + 1);
      red = [...s].sort((a, b) => a - b);
    }
    const blue = [];
    while (blue.length < cfg.blues) {
      const n = Math.floor(Math.random() * cfg.blueMax) + 1;
      if (!blue.includes(n)) blue.push(n);
    }
    blue.sort((a, b) => a - b);
    const seq = String(limit - i).padStart(3, "0");
    rows.push({ expect: `${year}${seq}`, date: "", red, blue, isMock: true });
  }
  return rows;
}

function finalize(rows, limit) {
  const byExpect = new Map();
  for (const r of rows) {
    if (r.expect) byExpect.set(String(r.expect), r);
  }
  return [...byExpect.values()]
    .sort((a, b) => issueNum(a.expect) - issueNum(b.expect))
    .slice(-limit);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = (url.searchParams.get("type") || "ssq").toLowerCase();
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit"), 10) || 100));

  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };

  if (!LOTTERY[type]) {
    return new Response(
      JSON.stringify({ code: 400, msg: `未知彩种: ${type}`, data: [] }),
      { status: 400, headers }
    );
  }

  const attempts = await Promise.allSettled([
    fetchFrom2xc(type, limit).then((rows) => ({ source: "2xc-real", rows })),
    fetchFromHuiniao(type, limit).then((rows) => ({ source: "huiniao-real", rows })),
  ]);

  const candidates = attempts
    .filter((a) => a.status === "fulfilled" && a.value.rows.length)
    .map((a) => {
      const rows = finalize(a.value.rows, limit);
      const latest = rows[rows.length - 1];
      return { source: a.value.source, rows, latestNum: issueNum(latest?.expect) };
    })
    .filter((c) => c.rows.length);

  let payload;
  if (candidates.length) {
    // 新鲜度仲裁：最新期号最大者胜出，避免某源停更时还拿旧数据冒充实时
    candidates.sort((a, b) => b.latestNum - a.latestNum);
    const best = candidates[0];
    const latest = best.rows[best.rows.length - 1];
    let stale = false;
    if (latest?.date) {
      const ageDays = (Date.now() - new Date(latest.date + "T21:30:00+08:00").getTime()) / 86400000;
      stale = ageDays > LOTTERY[type].staleDays;
    }
    payload = {
      code: 200,
      msg: "success",
      source: best.source,
      count: best.rows.length,
      latestExpect: latest?.expect || "",
      latestDate: latest?.date || "",
      stale,
      data: best.rows,
    };
  } else {
    const rows = finalize(mockData(type, limit), limit);
    payload = {
      code: 200,
      msg: "success",
      source: "mock",
      count: rows.length,
      latestExpect: rows[rows.length - 1]?.expect || "",
      latestDate: "",
      stale: true,
      data: rows,
    };
  }

  return new Response(JSON.stringify(payload), { headers });
}

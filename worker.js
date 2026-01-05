import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

// --- 1. 资源清单处理 ---
let assetManifest;
try {
  assetManifest = JSON.parse(manifestJSON);
} catch (e) {
  assetManifest = {};
}

// --- 常量配置 ---
const BASE_URL = "https://yktyd.ecust.edu.cn/epay/wxpage/wanxiao/eleresult";
const USER_AGENT = "Mozilla/5.0 (Linux; U; Android 4.1.2; zh-cn; Chitanda/Akari) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30 MicroMessenger/6.0.0.58_r884092.501 NetType/WIFI";
const REGEX = /(-?\d+(\.\d+)?)度/;

// --- 自动初始化 SQL ---
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS electricity (
  timestamp TEXT,
  room_id TEXT,
  kWh REAL,
  UNIQUE(timestamp, room_id)
);
`;

const BUILDING_MAP = {
    "奉贤1号楼":"1", "奉贤2号楼":"2", "奉贤3号楼":"3", "奉贤4号楼":"4",
    "奉贤5号楼":"27", "奉贤6号楼":"28", "奉贤7号楼":"29", "奉贤8号楼":"30",
    "奉贤9号楼":"31", "奉贤10号楼":"32", "奉贤11号楼":"33", "奉贤12号楼":"34",
    "奉贤13号楼":"35", "奉贤14号楼":"36", "奉贤15号楼":"37", "奉贤16号楼":"38",
    "奉贤17号楼":"39", "奉贤18号楼":"40", "奉贤19号楼":"41", "奉贤20号楼":"42",
    "奉贤21号楼":"43", "奉贤22号楼":"44", "奉贤23号楼":"45", "奉贤24号楼":"46",
    "奉贤25号楼":"49", "奉贤26号楼":"50", "奉贤27号楼":"51", "奉贤28号楼":"52",
    "奉贤后勤职工宿舍":"55",
    "徐汇1号楼":"64", "徐汇2号楼":"47", "徐汇3号楼":"5", "徐汇4号楼":"6",
    "徐汇5号楼":"7", "徐汇6号楼":"8", "徐汇7号楼":"9", "徐汇8号楼":"10",
    "徐汇9号楼":"11", "徐汇10号楼":"12", "徐汇11号楼":"13", "徐汇12号楼":"14",
    "徐汇13号楼":"15", "徐汇14号楼":"16", "徐汇15号楼":"17", "徐汇16号楼":"18",
    "徐汇17号楼":"19", "徐汇18号楼":"20", "徐汇19号楼":"21", "徐汇20号楼":"22",
    "徐汇21号楼":"23", "徐汇22号楼":"24", "徐汇23号楼":"25", "徐汇24号楼":"26",
    "徐汇25号楼":"48",
    "徐汇晨园公寓":"53", "徐汇励志公寓":"54",
    "徐汇南区第一宿舍楼":"66", "徐汇南区第二宿舍楼":"65",
    "徐汇南区第三宿舍楼":"67", "徐汇南区4A宿舍楼":"68", "徐汇南区4B宿舍楼":"69"
};
const SPECIAL_NAMES = {
    "后勤职工": "后勤职工宿舍",
    "晨园": "晨园公寓",
    "励志": "励志公寓",
    "南区1": "南区第一宿舍楼", "南区2": "南区第二宿舍楼",
    "南区3": "南区第三宿舍楼", "南区4A": "南区4A宿舍楼", "南区4B": "南区4B宿舍楼"
};

// --- 辅助函数 ---
function autoGenerateUrl(env) {
    const roomId = env.ROOM_ID;
    let partId = env.PART_ID; 
    const buildIdRaw = env.BUILD_ID;
    if (!roomId || !partId || !buildIdRaw) return null;

    let campusName = "", areaId = "";
    if (partId === "0" || partId === "奉贤") { campusName = "奉贤"; areaId = "2"; }
    else if (partId === "1" || partId === "徐汇") { campusName = "徐汇"; areaId = "3"; }
    else return null;

    let matchedBuildId = SPECIAL_NAMES[buildIdRaw] ? BUILDING_MAP[`${campusName}${SPECIAL_NAMES[buildIdRaw]}`] : (BUILDING_MAP[`${campusName}${buildIdRaw}号楼`] || BUILDING_MAP[`${campusName}${buildIdRaw}`]);
    if (!matchedBuildId) return null;
    return `${BASE_URL}?sysid=1&roomid=${roomId}&areaid=${areaId}&buildid=${matchedBuildId}`;
}

// 数据库初始化辅助函数
async function ensureTableExists(env) {
    try {
        await env.DB.prepare(INIT_SQL).run();
        console.log("DB Table Initialized/Verified");
    } catch (e) {
        console.error("DB Init Failed:", e);
    }
}

async function scrape(env) {
    const roomId = env.ROOM_ID;
    if (!roomId) return { error: "ROOM_ID not set" };
    let url = env.ROOM_URL || autoGenerateUrl(env);
    if (!url) url = `${BASE_URL}?sysid=1&areaid=3&buildid=20&roomid=${roomId}`;

    try {
        // 1. 在每次写入前，确保表存在 (Self-Healing)
        if (env.DB) {
            await ensureTableExists(env);
        } else {
            return { error: "DB binding missing" };
        }

        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) return { error: `HTTP ${response.status}` };
        const text = await response.text();
        const match = text.match(REGEX);
        if (match && match[1]) {
            const kwh = parseFloat(match[1]);
            const timestamp = new Date().toISOString();
            await env.DB.prepare("INSERT OR IGNORE INTO electricity (timestamp, room_id, kWh) VALUES (?, ?, ?)").bind(timestamp, roomId, kwh).run();
            return { success: true, kwh };
        }
        return { error: "Parse failed" };
    } catch (e) {
        return { error: e.message };
    }
}

// --- HTML 渲染函数 ---
function renderHtml(result) {
    const isSuccess = result.success;
    const title = isSuccess ? "更新成功" : "更新失败";
    const colorClass = isSuccess ? "text-green-500 bg-green-500/10" : "text-red-500 bg-red-500/10";
    const icon = isSuccess 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

    const content = isSuccess
        ? `<div class="py-6">
             <div class="text-sm text-zinc-400 mb-2">当前剩余电量</div>
             <div class="text-6xl font-mono font-bold tracking-tight text-white">${result.kwh} <span class="text-2xl text-zinc-500">kWh</span></div>
             <div class="mt-4 text-xs text-zinc-500 font-mono">已同步至数据库</div>
           </div>`
        : `<div class="bg-red-950/30 border border-red-900/50 rounded-lg p-4 text-left my-4">
             <div class="text-xs text-red-400 mb-1 font-semibold">ERROR DETAILS:</div>
             <code class="text-xs text-red-200 break-all font-mono">${result.error || 'Unknown Error'}</code>
           </div>`;

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Nakiri - ${title}</title><script src="https://cdn.tailwindcss.com"></script><style>body{font-family:system-ui,-apple-system,sans-serif}</style></head><body class="bg-black text-zinc-100 min-h-screen flex items-center justify-center p-4"><div class="max-w-sm w-full bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-8 text-center animate-[fade-in_0.5s_ease-out]"><div class="w-20 h-20 ${colorClass} rounded-full flex items-center justify-center mx-auto mb-6">${icon}</div><h1 class="text-2xl font-bold text-white mb-2">${title}</h1>${content}<div class="pt-6 border-t border-zinc-800 mt-2"><a href="/" class="group inline-flex items-center justify-center w-full py-3 px-4 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all active:scale-95"><span>返回仪表盘</span><svg class="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></a></div></div></body></html>`;
}

// --- 主入口 ---
export default {
    async fetch(request, env, ctx) {
        // 处理 CORS 预检请求
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                }
            });
        }

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
        };

        const url = new URL(request.url);
        
        // 1. GET /api/config
        if (url.pathname === '/api/config') {
            const roomId = env.ROOM_ID || 'Unset';
            const buildId = env.BUILD_ID;
            const partId = env.PART_ID;
            let displayName = `Room ${roomId}`;
            if (buildId && partId) {
                let campus = (partId === '0' || partId === '奉贤') ? "奉贤" : ((partId === '1' || partId === '徐汇') ? "徐汇" : partId);
                let buildDisplay = /^\d+$/.test(buildId) ? `${buildId}号楼` : buildId;
                displayName = `${campus}-${buildDisplay}-${roomId}`;
            }
            return new Response(JSON.stringify({ roomId, displayName, version: 'Worker-AutoInit-v2.0' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 2. GET /api/data
        if (url.pathname === '/api/data') {
            if (!env.DB) return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            try {
                let query = "SELECT * FROM electricity WHERE timestamp > datetime('now', '-30 days')";
                const params = [];
                if (env.ROOM_ID) {
                    query += " AND room_id = ?";
                    params.push(env.ROOM_ID);
                }
                query += " ORDER BY timestamp ASC";
                const { results } = await env.DB.prepare(query).bind(...params).all();
                return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            } catch (e) {
                // 2. 智能恢复：如果是因为表不存在导致的错误，尝试初始化并重试
                if (e.message && e.message.includes("no such table")) {
                    console.log("Table missing detected on read, initializing...");
                    await ensureTableExists(env);
                    // 重试查询
                    try {
                        let query = "SELECT * FROM electricity WHERE timestamp > datetime('now', '-30 days')";
                        // 注意：这里需要重新构建查询，或者复用上面的逻辑。为简单起见，这里假设空表返回空数组。
                        // 其实最简单的是初始化后返回空数组，因为刚初始化肯定没数据
                        return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
                    } catch (retryErr) {
                        return new Response(JSON.stringify({ error: "Init failed: " + retryErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
                    }
                }
                return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
            }
        }

        // 3. GET /api/scrape
        if (url.pathname === '/api/scrape') {
            const result = await scrape(env); // scrape 内部已经包含了 ensureTableExists
            const accept = request.headers.get("Accept");
            if (accept && accept.includes("application/json")) {
                return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
            }
            return new Response(renderHtml(result), { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        // 4. Static Assets (SPA)
        try {
            return await getAssetFromKV(
                { request, waitUntil: ctx.waitUntil.bind(ctx) },
                {
                    ASSET_NAMESPACE: env.__STATIC_CONTENT,
                    ASSET_MANIFEST: assetManifest,
                }
            );
        } catch (e) {
            try {
                return await getAssetFromKV(
                    { request, waitUntil: ctx.waitUntil.bind(ctx) },
                    {
                        ASSET_NAMESPACE: env.__STATIC_CONTENT,
                        ASSET_MANIFEST: assetManifest,
                        mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/index.html`, req),
                    }
                );
            } catch (err) {
                return new Response(`Not Found`, { status: 404 });
            }
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(scrape(env));
    }
};
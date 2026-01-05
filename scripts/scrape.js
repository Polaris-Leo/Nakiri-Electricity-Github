import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 配置与常量 ---
const DATA_FILE = path.join(__dirname, '../public/data.json');
const BASE_URL = "https://yktyd.ecust.edu.cn/epay/wxpage/wanxiao/eleresult";
const USER_AGENT = "Mozilla/5.0 (Linux; U; Android 4.1.2; zh-cn; Chitanda/Akari) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30 MicroMessenger/6.0.0.58_r884092.501 NetType/WIFI";
const REGEX = /(-?\d+(\.\d+)?)度/;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const MAX_HISTORY_ITEMS = 2000; // 保留最近2000条记录，约2-3个月数据

// 从环境变量获取配置
const ENV = {
    ROOM_ID: process.env.ROOM_ID,
    PART_ID: process.env.PART_ID,
    BUILD_ID: process.env.BUILD_ID
};

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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function autoGenerateUrl() {
    const { ROOM_ID, PART_ID, BUILD_ID } = ENV;
    if (!ROOM_ID || !PART_ID || !BUILD_ID) return null;

    let campusName = "", areaId = "";
    if (PART_ID === "0" || PART_ID === "奉贤") { campusName = "奉贤"; areaId = "2"; }
    else if (PART_ID === "1" || PART_ID === "徐汇") { campusName = "徐汇"; areaId = "3"; }
    else {
        console.error(`[Config Error] Invalid PART_ID: ${PART_ID}. Must be '0'/'奉贤' or '1'/'徐汇'.`);
        return null;
    }

    let matchedBuildId = SPECIAL_NAMES[BUILD_ID] ? BUILDING_MAP[`${campusName}${SPECIAL_NAMES[BUILD_ID]}`] : (BUILDING_MAP[`${campusName}${BUILD_ID}号楼`] || BUILDING_MAP[`${campusName}${BUILD_ID}`]);
    
    if (!matchedBuildId) {
        console.error(`[Config Error] Could not find build ID in map.`);
        console.error(`Campus: ${campusName}, Input Build: ${BUILD_ID}`);
        console.error(`Please check if your building exists in the BUILDING_MAP in scripts/scrape.js`);
        return null;
    }
    
    return `${BASE_URL}?sysid=1&roomid=${ROOM_ID}&areaid=${areaId}&buildid=${matchedBuildId}`;
}

function getDisplayName() {
    const { ROOM_ID, PART_ID, BUILD_ID } = ENV;
    if (!BUILD_ID || !PART_ID) return `Room ${ROOM_ID}`;
    
    let campus = (PART_ID === '0' || PART_ID === '奉贤') ? "奉贤" : ((PART_ID === '1' || PART_ID === '徐汇') ? "徐汇" : PART_ID);
    let buildDisplay = /^\d+$/.test(BUILD_ID) ? `${BUILD_ID}号楼` : BUILD_ID;
    return `${campus}-${buildDisplay}-${ROOM_ID}`;
}

// --- 主逻辑 ---
async function fetchWithRetry(url, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Attempt ${i + 1}/${retries}...`);
            const response = await fetch(url, { 
                headers: { "User-Agent": USER_AGENT },
                timeout: 10000 // 10s timeout
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return await response.text();
        } catch (error) {
            console.warn(`Attempt ${i + 1} failed:`, error.message);
            if (i < retries - 1) {
                console.log(`Retrying in ${RETRY_DELAY/1000}s...`);
                await sleep(RETRY_DELAY);
            } else {
                throw error;
            }
        }
    }
}

async function main() {
    console.log("Starting scrape job...");
    
    // 1. 准备 URL
    const url = autoGenerateUrl();
    if (!url) {
        console.error("Error: Could not generate URL. Check environment variables (ROOM_ID, PART_ID, BUILD_ID).");
        process.exit(1);
    }
    console.log(`Target URL generated for Room ${ENV.ROOM_ID}`);

    // 2. 读取现有数据
    let data = { room_info: {}, history: [] };
    if (fs.existsSync(DATA_FILE)) {
        try {
            data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (e) {
            console.warn("Could not parse existing data.json, starting fresh.");
        }
    }

    // 3. 抓取数据
    try {
        const text = await fetchWithRetry(url);
        const match = text.match(REGEX);

        if (match && match[1]) {
            const kwh = parseFloat(match[1]);
            const now = new Date();
            const timestamp = now.toISOString();

            console.log(`✓ Successfully fetched: ${kwh} kWh`);

            // 更新基本信息
            data.room_info = {
                roomId: ENV.ROOM_ID,
                displayName: getDisplayName(),
                updatedAt: timestamp
            };

            // 智能去重：如果最后一条记录在同一小时内且电量变化小于0.01kWh，跳过
            const lastEntry = data.history[data.history.length - 1];
            let shouldAdd = true;
            
            if (lastEntry) {
                const lastTime = new Date(lastEntry.timestamp);
                const timeDiff = now - lastTime;
                const kwhDiff = Math.abs(lastEntry.kWh - kwh);
                
                // 同一小时内 且 电量变化小于0.01kWh = 跳过
                if (timeDiff < 3600000 && kwhDiff < 0.01) {
                    shouldAdd = false;
                    console.log('⊘ Skipping duplicate entry (same hour, minimal change)');
                }
            }
            
            if (shouldAdd) {
                data.history.push({
                    timestamp: timestamp,
                    room_id: ENV.ROOM_ID,
                    kWh: kwh
                });
                console.log(`✓ Added new entry to history (${data.history.length} total)`);
            }

            // 数据清理：保留最近的记录
            if (data.history.length > MAX_HISTORY_ITEMS) {
                const removed = data.history.length - MAX_HISTORY_ITEMS;
                data.history = data.history.slice(-MAX_HISTORY_ITEMS);
                console.log(`🗑️  Trimmed ${removed} old entries (keeping last ${MAX_HISTORY_ITEMS})`);
            }

            // 4. 写入文件
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
            console.log("✓ Data saved to public/data.json");
            console.log(`📊 Total history entries: ${data.history.length}`);
        } else {
            console.error("✗ Error: Regex match failed. Content might have changed.");
            console.log("Response text preview:", text.substring(0, 200));
            process.exit(1);
        }
    } catch (e) {
        console.error("✗ Fetch failed after retries:", e.message);
        process.exit(1);
    }
}

main();

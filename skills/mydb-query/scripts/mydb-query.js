const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const OUTPUT_DIR = __dirname;
const LOG_FILE = 'mydb-query-log.txt';

function log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}`;
    console.error(line);
    fs.appendFileSync(path.join(OUTPUT_DIR, LOG_FILE), line + '\n');
}

// Python does cookie reading + HTTP request; command passed via stdin JSON to avoid shell escaping
const PY_FETCH = `
import browser_cookie3, json, sys, http.client
from urllib.parse import urlencode

def get_cookie_str():
    cj = browser_cookie3.chrome(domain_name='mydb.jdfmgt.com')
    pairs = [(c.name, c.value) for c in cj if 'mydb.jdfmgt.com' in c.domain and c.value]
    return '; '.join(f'{k}={v}' for k, v in pairs)

def fetch(path):
    cookie_str = get_cookie_str()
    conn = http.client.HTTPConnection('mydb.jdfmgt.com', timeout=15)
    conn.request('GET', path, headers={
        'Host': 'mydb.jdfmgt.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'http://mydb.jdfmgt.com/',
        'Cookie': cookie_str,
    })
    resp = conn.getresponse()
    body = resp.read().decode('utf-8')
    if resp.status == 403:
        return {'__error__': 'unauthorized'}
    if resp.status != 200:
        return {'__error__': f'http_{resp.status}', 'body': body[:500]}
    try:
        return json.loads(body)
    except Exception as e:
        return {'__error__': 'parse_failed', 'body': body[:500]}

try:
    args = json.loads(sys.stdin.read())
    action = args.get('action')
    if action == 'list':
        print(json.dumps(fetch('/dataSourceList')))
    elif action == 'query':
        params = urlencode({'sqlText': args['sql'], 'dbId': args['dbId']})
        print(json.dumps(fetch(f'/commitSql?resultSetIndex=0&{params}')))
    else:
        print(json.dumps({'__error__': 'unknown_action'}))
except Exception as e:
    print(json.dumps({'__error__': str(e)}))
`;

function mydbFetch(command) {
    const tempPy = path.join(os.tmpdir(), 'mydb_fetch.py');
    fs.writeFileSync(tempPy, PY_FETCH);
    try {
        const out = execSync(`python3 "${tempPy}"`, {
            input: JSON.stringify(command),
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024
        }).trim();
        return JSON.parse(out);
    } finally {
        try { fs.unlinkSync(tempPy); } catch (_) {}
    }
}

function generateDataSourceReport(sources) {
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const total = sources.length;
    return [
        `# 📦 MyDB 数据源列表`, ``,
        `---`, ``,
        `共 **${total}** 个数据源，输入序号选择：`, ``,
        sources.map(ds => `**${ds.seq}** · ${ds.name}`).join('\n'), ``,
        `---`, ``,
        `*获取时间: ${now}*`,
    ].join('\n');
}

function generateQueryReport(result, dbName) {
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    if (result.errMsg) {
        return [`# ❌ MyDB 查询失败`, ``, `**错误信息：** ${result.errMsg}`, ``, `---`, ``, `*查询时间: ${now}*`].join('\n');
    }
    const info = result.resultInfo;
    const data = info.data || [];
    const total = data.length;
    const display = data.slice(0, 50);
    const lines = [
        `# 📊 MyDB 查询结果`, ``, `---`, ``,
        `## 🔍 查询信息`, ``,
        `| 项目 | 内容 |`, `|:-----|:-----|`,
        `| 🗄️ 数据源 | \`${dbName}\` |`,
        `| ⏱️ 耗时 | \`${info.duration}ms\` |`,
        `| 📊 结果 | \`${info.tip}\` |`,
        ``, `---`, ``, `## 📋 数据明细`, ``,
    ];
    if (total === 0) {
        lines.push(`> 查询结果为空`);
    } else {
        const cols = Object.keys(display[0]);
        // 计算每列最大宽度（考虑中文字符占2个宽度）
        const strWidth = s => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
        const colWidths = cols.map(c => {
            const maxDataWidth = display.reduce((max, row) => {
                const val = row[c] == null ? '' : String(row[c]);
                return Math.max(max, strWidth(val));
            }, 0);
            return Math.max(strWidth(c), maxDataWidth, 3);
        });
        const pad = (s, width) => {
            const w = strWidth(s);
            return s + ' '.repeat(Math.max(0, width - w));
        };
        // 表头
        lines.push(`| ${cols.map((c, i) => pad(c, colWidths[i])).join(' | ')} |`);
        // 分隔线
        lines.push(`| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`);
        // 数据行
        for (const row of display) {
            const vals = cols.map((c, i) => {
                const v = row[c] == null ? '' : String(row[c]).replace(/\|/g, '\\|').replace(/\n/g, '↵');
                return pad(v, colWidths[i]);
            });
            lines.push(`| ${vals.join(' | ')} |`);
        }
        lines.push(``);
        lines.push(total > 50 ? `> 共 ${total} 行，已展示前 50 行` : `> 共 ${total} 行`);
    }
    lines.push(``, `---`, ``, `*查询时间: ${now}*`);
    return lines.join('\n');
}

function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === '--help') {
        console.log('用法:\n  node mydb-query.js list [keyword]                    # 列出数据源\n  node mydb-query.js query <dbId> "<sql>" [dbName]     # 执行 SQL');
        process.exit(0);
    }

    if (command === 'list') {
        const keyword = args[1] || null;
        const showAll = keyword === '--all';
        log('获取数据源列表...');
        const resp = mydbFetch({ action: 'list' });

        if (resp.__error__ === 'unauthorized') {
            console.log('# ❌ 未登录\n\n请先用 Chrome 访问 http://mydb.jdfmgt.com/ 完成登录。');
            process.exit(1);
        }
        if (resp.__error__) {
            console.log(`# ❌ 请求失败\n\n${resp.__error__}${resp.body ? '\n\n' + resp.body : ''}`);
            process.exit(1);
        }
        if (!resp.success) {
            console.log(`# ❌ 获取数据源失败\n\n${resp.errMsg || '未知错误'}`);
            process.exit(1);
        }

        let sources = resp.resultInfo.map((ds, i) => ({ seq: i + 1, id: ds.id, name: ds.dbName }));
        if (keyword && !showAll) {
            sources = sources.filter(s => s.name.toLowerCase().includes(keyword.toLowerCase()));
            if (sources.length === 0) {
                console.log(`# 📦 MyDB 数据源列表\n\n> 未找到包含 "${keyword}" 的数据源`);
                process.exit(0);
            }
            // 关键词过滤后展示全部匹配结果，不截断
        } else if (!showAll) {
            sources = sources.slice(0, 20);
        }
        fs.writeFileSync(path.join(OUTPUT_DIR, 'mydb-datasources.json'), JSON.stringify({ sources }, null, 2));
        console.log(generateDataSourceReport(sources));

    } else if (command === 'query') {
        let dbId = args[1];
        const sql = args[2];
        let dbName = args[3] || `ID:${dbId}`;
        if (!dbId || !sql) {
            console.log('用法: node mydb-query.js query <dbId> "<sql>" [dbName]');
            process.exit(1);
        }
        // Auto-resolve sequence number to actual database ID
        const seqNum = parseInt(dbId, 10);
        if (!isNaN(seqNum) && String(seqNum) === String(dbId)) {
            try {
                const dsData = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'mydb-datasources.json'), 'utf-8'));
                const ds = dsData.sources.find(s => s.seq === seqNum);
                if (ds) {
                    log(`序号 ${seqNum} 解析为数据源 ID: ${ds.id} (${ds.name})`);
                    dbId = String(ds.id);
                    if (!args[3]) dbName = ds.name;
                }
            } catch (_) {}
        }
        const sqlLower = sql.trim().toLowerCase();
        const allowed = ['select', 'show', 'desc', 'explain'];
        const denied = ['insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create'];
        if (!allowed.some(k => sqlLower.startsWith(k))) {
            console.log('# ❌ SQL 安全校验失败\n\n该技能仅支持查询语句（SELECT / SHOW / DESC / EXPLAIN），不支持数据修改操作。');
            process.exit(1);
        }
        if (denied.some(k => new RegExp(`\\b${k}\\b`).test(sqlLower))) {
            console.log('# ❌ SQL 安全校验失败\n\n检测到危险关键词，该技能仅支持查询语句。');
            process.exit(1);
        }
        log(`执行 SQL 查询，dbId=${dbId}`);
        const resp = mydbFetch({ action: 'query', dbId, sql });

        if (resp.__error__ === 'unauthorized') {
            console.log('# ❌ 未登录\n\n请先用 Chrome 访问 http://mydb.jdfmgt.com/ 完成登录。');
            process.exit(1);
        }
        if (resp.__error__) {
            const detail = resp.body ? `\n\n**服务器响应：**\n\`\`\`\n${resp.body}\n\`\`\`` : '';
            console.log(`# ❌ 请求失败\n\n${resp.__error__}${detail}`);
            process.exit(1);
        }
        fs.writeFileSync(path.join(OUTPUT_DIR, 'mydb-query-result.json'), JSON.stringify(resp, null, 2));
        console.log(generateQueryReport(resp, dbName));

    } else {
        console.log(`未知命令: ${command}`);
        process.exit(1);
    }
}

try {
    main();
} catch (e) {
    log(`执行失败: ${e.message}`);
    console.log(`# ❌ 执行失败\n\n${e.message}`);
    process.exit(1);
}


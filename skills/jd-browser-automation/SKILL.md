---
name: jd-browser-automation
description: 京东内网网页自动化操作规范。通过 browser-use + 独立 Chrome 调试 profile 连接到 *.jd.com 内网系统(如 magicflow、ERP、内部后台),自动填写表单、点击按钮、批量操作。包含 Vue/iView 表格的高效批量修改套路。
---

# 京东内网浏览器自动化

适用于任何需要在 `*.jd.com` 内网系统自动操作的场景: magicflow 工单填写、内部后台批量配置、ERP 数据录入等。

## 触发条件

用户提到以下任一情况:
- "帮我填工单 / 帮我提交工单 / magicflow"
- "在京东内网/ERP/后台 帮我点 / 填 / 操作"
- 给出 `*.jd.com` 链接并要求自动化操作

## 核心套路:独立调试 Chrome profile

Chrome 148+ 出于安全考虑,**默认 user-data-dir 上的 `--remote-debugging-port` 会被静默忽略**(进程跑起来了但端口不监听)。所以必须用独立 profile。

### profile 位置

```
~/.chrome-debug-profile
```

已在 2026/05/20 首次配置时登录: **magicflow.jd.com**(ERP: liuzhijie5)。SSO 会话长期有效,无需重新登录。

### 启动流程

**1. 优雅关闭原 Chrome(如果在跑)**

```bash
osascript -e 'tell application "Google Chrome" to quit'
sleep 2
pgrep -x "Google Chrome" | wc -l   # 必须为 0
```

⚠️ 这会关闭用户所有 Chrome 标签页。**操作前必须征得用户同意**,Chrome 重启时会自动恢复标签页。

**2. 用独立 profile 启动**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-debug-profile" \
  >/tmp/chrome-debug.log 2>&1 &
disown
sleep 4
```

**3. 验证端口就绪**

```bash
curl -s http://localhost:9222/json/version
```

返回 JSON(含 `Browser: Chrome/...`)即成功。如果 connection refused,说明 Chrome 静默忽略了 `--remote-debugging-port`,八成是 user-data-dir 用了默认目录或者旧 Chrome 实例没退干净。

**4. 用 browser-use 连接并操作**

```bash
browser-use --connect open "https://magicflow.jd.com/workflow/create/xxx"
browser-use --connect state           # 看可点击元素和索引
browser-use --connect screenshot /tmp/x.png
browser-use --connect eval "JSON.stringify({rows: document.querySelectorAll('tr').length})"
browser-use --connect click 1159 572  # 按坐标点击
```

## browser-use 已知坑

### 1. `connect` 不是子命令

错误: `browser-use connect`
正确: `browser-use --connect open <url>`(`--connect` 是顶层标志,跟子命令一起用)

### 2. eval 用 `const` / `let` 顶层声明会返回 `None`

```bash
# 错误 — 返回 None
browser-use --connect eval "const x = foo(); x"

# 正确 — 包成 IIFE
browser-use --connect eval "(() => { const x = foo(); return JSON.stringify(x); })()"

# 或者用最后表达式,但不能用 const
browser-use --connect eval "foo()"
```

复杂 JS 写到 `/tmp/script.js`,然后 `eval "$(cat /tmp/script.js)"`,可读性更好。

### 3. 截图不要 `--full`

`--full` 在很多场景会渲染失败,出来全白图。直接 `screenshot path.png` 配合 `scrollIntoView` 局部截图最稳。

### 4. 跨命令滚动位置容易丢

页面用了内层 scrollable 容器时,`browser-use scroll` 可能滚的不是目标容器。优先用 JS:

```bash
browser-use --connect eval "document.querySelectorAll('xxx')[0].scrollIntoView({block:'start'}); 'ok'"
```

## Vue 组件批量操作套路(高优先级)

京东内网大量页面是 Vue 2 + iView / Element UI。**遇到表格批量改字段,千万别一行一行点 dropdown** —— 直接改 Vue data 数组,响应式自动同步 UI。

### 步骤

**1. 找到表格的 Vue 实例**

```js
const tbl = document.querySelector('.el-table');
let vm = tbl.__vue__;
while (vm && vm.$options.name !== 'ElTable') vm = vm.$parent;
const data = vm.data || vm.$props?.data;  // 39 行的数据数组
```

**2. 看每行结构**

```js
data[0]  // { table_name: '...', sql_info: '...', dump_num: '100万以下' }
```

**3. 批量改字段**

```js
data.forEach(row => { row.dump_num = '100万以上'; });
```

Vue 响应式会立刻把 UI 全部更新,**比 39 次 click dropdown 快 100 倍**。

### 找父 Vue 组件链

排查某个元素归属时,顺着 `__vue__.$parent` 上溯:

```js
let vm = el.__vue__;
const path = [];
for (let i = 0; i < 10 && vm; i++) {
  path.push({name: vm.$options.name, dataKeys: Object.keys(vm._data||{})});
  vm = vm.$parent;
}
JSON.stringify(path);
```

通常表格数据在 `ElTable` / `iTable` 的 `data` 上,表单数据在外层 form 组件的 `formData` / `model` 上。

## 普通 input / textarea 设值

直接 `el.value = 'x'` 不会触发 Vue 的响应式,要走 native setter:

```js
const setVal = (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
};
```

textarea 同理但用 `HTMLTextAreaElement.prototype`。

## iView Select 选项点击

如果 Vue data 路径走不通,只能 UI 点选:

```js
// 1. 打开 select
tr.querySelector('.ivu-select-selection').click();
// 2. 短暂等待 dropdown 渲染
// 3. 点击想要的选项
for (const item of document.querySelectorAll('.ivu-select-item')) {
  if (item.innerText.trim() === '100万以上') { item.click(); break; }
}
```

注意: iView 把 dropdown 渲染到 body,只有当前展开的那个 select 有可见 `.ivu-select-item`。

## 整体工作流模板

```
1. 用户给链接 → 我先确认 Chrome 调试 profile 是否在跑
   curl -s http://localhost:9222/json/version

2. 没在跑 → 征得用户同意,关闭原 Chrome → 启动调试 profile

3. browser-use --connect open <url> → screenshot 看页面

4. 用 eval 探查 DOM 结构和 Vue 实例

5. 优先方案:Vue data 批量改;退化方案:UI 点击

6. 关键节点截图给用户确认

7. 是否提交工单 → 必须问用户,绝对不能自己点提交
```

## 不要自动点的按钮

- **提交 / 确认无误,提交** —— 工单提交是不可逆的(会触发审批流和邮件),**必须用户手动点**
- **删除 / 清空** —— 同理,操作前确认
- **保存到草稿箱** —— 一般安全,但仍建议告知用户

我的职责到"填好等你确认"为止,提交按钮自己点。

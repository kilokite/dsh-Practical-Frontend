# 实用前端改造（dsh-practical-frontend）

DeepSeek Harness 的前端小改造集合。当前包含两个功能：**工作区项目染色** 与 **对话书签**。

## 功能

### 1. 工作区项目染色

工作区多的时候，侧边栏里一长串同名目录很难区分。这个功能给每个工作区行加一层背景色：

1. 鼠标移到侧边栏某个工作区行上，点行尾的 `…`（更多）。
2. 原本只有「重命名 / 删除工作区」的菜单里，多出一行「项目颜色…」。
3. 点它，行下方弹出白色卡片：8 个颜色 + 末尾一个「无颜色」圆环，共 9 个选项。点选即生效；再点一次已选颜色、或点最后的圆环，都回到默认背景。选中项是浅灰描边，切换有过渡效果。
4. 颜色立即生效，并写入磁盘；刷新页面、重启 Desktop、换 GUI 端口都还在。

颜色是「色相 + 低透明度」叠在主题底色上，所以浅色与深色主题都不用改色值，文字对比度也不会被破坏。
「未分组」这个虚拟分组没有工作区 ID，因此不提供染色。

### 2. 对话书签

任意会话里都可以把一段内容收藏成书签，之后按项目分类查看：

1. 在对话正文中选中一段文字，选区右下方会浮出一个「书签」按钮。
2. 点它打开编辑框：标题会按选区第一行自动填好，也可以自己改；下方是选中的原文预览和来源会话 / 项目。
3. 保存后，点侧边栏里的「书签」行，主区域打开书签页：
   - 按项目分组，每个项目下按收藏时间倒序排列；
   - 顶部搜索框可搜标题、正文、会话名或项目名；
   - 点一条书签会打开对应会话，并把收藏的那段文字**高亮**、滚动到视野中间；
   - 悬停一条书签可以看全文、改标题或删除，删除会二次确认。
4. 书签写入磁盘，刷新页面、重启 Desktop 都还在。

书签面板使用 DSH 自己的全局面板机制（`sidebar.panellist` + 主区域 `main`），所以外观、折叠行为、选中态和原生「自动化任务」等面板一致。

如果书签所在的消息还没有加载（较早的历史），打开后不会马上高亮；先向上滚动加载更早消息，再点一次书签即可。高亮使用浏览器 CSS Custom Highlight API，不修改 React 管理的消息 DOM。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：在 `webServer` 上注册 `GET/POST /dsh-practical-frontend/project-colors` 与 `GET/POST /dsh-practical-frontend/bookmarks`。颜色写入 `workspace-colors.json`，书签写入 `bookmarks.json`，都在 `$DSH_HOME/plugin-data/dsh-practical-frontend/` 下；两者都使用临时文件 + rename 的串行原子写入。 |
| `client.js` | 浏览器半：`shell.overlay` 槽位里的色板弹层、项目菜单追加行；书签的选区浮钮、编辑框、`sidebar.panellist` 入口、`main` 书签面板，以及打开书签后的定位 / 高亮。 |
| `cordis.patch.yml` | Bundle patch，插入 `practical-frontend` 这一行。 |
| `locale/*.json` | 插件列表里显示的名称与说明。 |

### 为什么染色不用 DOM 改背景

行背景由一张 `<style>` 表控制：

```css
[data-row-key="workspace:<id>"] { background: rgba(…) !important }
[data-row-key="workspace:<id>"]:hover { background: rgba(…) !important }
```

`data-row-key` 是工作区行自带的稳定属性（`ui-workspace` 用它做排序与展开）。React 重渲染不会影响样式，主题切换也不会，插件卸载时整张表被移除。

### 书签如何定位「哪段内容、哪个项目」

选区与回访分三层定位：

1. **容器**：只认两个宿主公开的容器属性——`[data-conversation-content]`（当前对话正文）和它上面的 `data-conversation-session`（当前会话 ID）。选区的起点和终点都落在这个容器里，且不在输入框 / 可编辑区域里，才认为是一次可收藏的对话选区。
2. **锚点**：保存时同时记录选区起点、终点所在的 `[data-chat-node-key]` 消息包装节点，以及节点内的字符偏移。打开书签时先按这两个锚点重建 `Range`，再用保存的正文做一次忽略空白的校验；对得上就直接高亮。
3. **兜底**：旧版本书签（没有锚点）或消息结构变化导致校验失败时，优先在 `turn` / `role` 匹配的消息里搜正文，最后在整个对话正文里搜。匹配后同样高亮并滚动到视野中间。

项目归属不靠路径猜测：从 `sessions` / `workspaces` 客户端服务读当前会话摘要，优先用 `workspace.sessionIds` 找到所属工作区，其次用会话的 `cwd` 匹配工作区路径；都找不到时归入「未归类」。这样项目改名、会话改名后书签页也会跟着更新。

高亮使用 `CSS.highlights` + `Highlight` 注册一段 `Range`，由 `::highlight(dsh-pf-bookmark)` 上色。它只画在文本上，不改写 React 管理的消息 DOM；切换到别的会话时会自动清掉。

### 染色唯一读取宿主 DOM 的地方

工作区行的「…」菜单由 `ui-workspace` 硬编码（`rename` / `delete`），没有对应槽位，因此这一行只能靠 DOM 追加：

- 触发判定：点击必须落在工作区行 `[data-row-key^="workspace:"]` 的最后一个子容器里，且是其中第 1 个按钮（第 2 个是「新会话」）；
- 菜单判定：`[data-menu-material][role="menu"]` 且当前恰好只有 2 个 `role="menuitem"`（即「重命名 / 删除工作区」）；
- 新行由**克隆**现有菜单行得到，所以样式、间距、hover 都跟随宿主，不用复制任何 class 名；
- 关闭菜单用 Escape 事件，与宿主自己的关闭路径一致。

任何一步对不上（例如未来版本改了行结构），插件只会静默不加这一行，不会破坏侧边栏。已知取舍：这一行是宿主未开放的能力，升级后可能需要跟着调整。

### 数据上限

Host 端会做一次规范化与限流，避免一份坏数据拖垮面板：

- 单条书签正文最多 20000 字符，标题最多 300 字符；
- 最多保留 5000 条；
- 无 ID 或无正文的记录直接丢弃；
- 时间戳、会话 / 项目字段都以 Host 规范化后的值为准。

## 安装

```powershell
dsh plugin install "C:\Users\Administrator\Documents\selfCode\dsh-Practical-Frontend"
```

或在 DSH 的插件设置页用“从目录安装”。安装后插件出现在插件列表里，名称「实用前端改造」。

## 兼容

- 面向 DSH `0.2.1-rc.3`（`ui-workspace` 的 `data-row-key` / `role="menu"` 契约，`ui-sidebar` 的 `sidebar.panellist`，`ui-layout` 的 `main` / `shell.overlay`，`ui-chat` 的 `data-chat-node-key` / `data-chat-turn`）；
- 高亮依赖 Chromium 的 CSS Custom Highlight API；不支持该 API 的浏览器仍会打开会话并滚动到消息，只是不显示底色；
- 主题只使用 `--dsw-alias-*` 变量，缺省时有回退值；
- 书签入口与面板使用宿主槽位，不覆盖、不移动宿主自己的面板；升级后若槽位契约变化，插件会随声明消失而不是残留半截 UI。

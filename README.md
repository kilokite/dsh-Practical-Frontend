# 实用前端改造（dsh-practical-frontend）

DeepSeek Harness 的前端小改造集合。当前包含第一个功能：**工作区项目染色**。

## 功能

工作区多的时候，侧边栏里一长串同名目录很难区分。这个功能给每个工作区行加一层背景色：

1. 鼠标移到侧边栏某个工作区行上，点行尾的 `…`（更多）。
2. 原本只有「重命名 / 删除工作区」的菜单里，多出一行「项目颜色…」。
3. 点它，行下方弹出白色卡片：8 个颜色 + 末尾一个「无颜色」圆环，共 9 个选项。点选即生效；再点一次已选颜色、或点最后的圆环，都回到默认背景。选中项是浅灰描边，切换有过渡效果。
4. 颜色立即生效，并写入磁盘；刷新页面、重启 Desktop、换 GUI 端口都还在。

颜色是「色相 + 低透明度」叠在主题底色上，所以浅色与深色主题都不用改色值，文字对比度也不会被破坏。
「未分组」这个虚拟分组没有工作区 ID，因此不提供染色。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：在 `webServer` 上注册 `GET/POST /dsh-practical-frontend/project-colors`，把「工作区 ID → 颜色」读写到 `$DSH_HOME/plugin-data/dsh-practical-frontend/workspace-colors.json`（临时文件 + rename，串行写入）。 |
| `client.js` | 浏览器半：`shell.overlay` 槽位里的色板弹层、`data-row-key` 驱动的染色样式表、给工作区行菜单追加的一行。 |
| `cordis.patch.yml` | Bundle patch，插入 `practical-frontend` 这一行。 |
| `locale/*.json` | 插件列表里显示的名称与说明。 |

### 为什么染色不用 DOM 改背景

行背景由一张 `<style>` 表控制：

```css
[data-row-key="workspace:<id>"] { background: rgba(…) !important }
[data-row-key="workspace:<id>"]:hover { background: rgba(…) !important }
```

`data-row-key` 是工作区行自带的稳定属性（`ui-workspace` 用它做排序与展开）。React 重渲染不会影响样式，主题切换也不会，插件卸载时整张表被移除。

### 唯一读取宿主 DOM 的地方

工作区行的「…」菜单由 `ui-workspace` 硬编码（`rename` / `delete`），没有对应槽位，因此这一行只能靠 DOM 追加：

- 触发判定：点击必须落在工作区行 `[data-row-key^="workspace:"]` 的最后一个子容器里，且是其中第 1 个按钮（第 2 个是「新会话」）；
- 菜单判定：`[data-menu-material][role="menu"]` 且当前恰好只有 2 个 `role="menuitem"`（即「重命名 / 删除工作区」）；
- 新行由**克隆**现有菜单行得到，所以样式、间距、hover 都跟随宿主，不用复制任何 class 名；
- 关闭菜单用 Escape 事件，与宿主自己的关闭路径一致。

任何一步对不上（例如未来版本改了行结构），插件只会静默不加这一行，不会破坏侧边栏。已知取舍：这一行是宿主未开放的能力，升级后可能需要跟着调整。

## 安装

```powershell
dsh plugin install "C:\Users\Administrator\Documents\selfCode\dsh-Practical-Frontend"
```

或在 DSH 的插件设置页用“从目录安装”。安装后插件出现在插件列表里，名称「实用前端改造」。

## 兼容

- 面向 DSH `0.2.1-rc.3`（`ui-workspace` 的 `data-row-key` / `role="menu"` 契约）。
- 主题只使用 `--dsw-alias-*` 变量，缺省时有回退值。

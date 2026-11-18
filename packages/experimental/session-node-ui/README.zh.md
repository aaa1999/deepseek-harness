---
description: "在浏览器中保存会话节点并从节点派生会话的界面。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-node-ui

[English](README.md) | 中文

## 概述

Session Node UI 在宿主 Session Node 服务之上添加四个浏览器界面：消息输入框上方可保存当前会话、也可从已存节点派生的停靠条，助手消息操作区里保存该轮的图钉，侧栏中管理已存节点的区块，以及 New Session 里从节点开始的选项。所有列表只显示当前项目的节点。需要与 `dsh-session-node` 组合包一起安装；派生后会立即打开新会话。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 安装到 profile

经过验证的安装路径——宿主组合包提供此界面调用的服务：

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-session-node
dsh plugin --profile <name> add @deepseek-ai/dsh-session-node-ui
```

### 你能得到什么

- **输入框停靠条**：输入标题并选择保存，即可保存当前会话最近完成的节点。芯片菜单列出当前 workspace 的已存节点；派生按钮从所选节点启动新会话，删除按钮移除该节点。
- **轮次图钉**：助手消息操作行中的图钉保存该轮的包含边界，标题由会话显示标题和轮次号组成，例如 `Fix login #3`。保存成功后图标显示为对勾两秒。
- **侧栏管理器**：侧栏的**保存的节点**列出当前 workspace 的节点。点击行标题可从该节点派生；悬停可重命名（行内编辑器，回车保存）和删除。在收起的侧栏轨道中，该区块渲染为一个展开控件。
- **New Session 选择器**：暂存会话的 workspace 存在已存节点时，New Session 中的**从节点新建**芯片会列出它们；选中即可派生并立即打开子会话。

每个节点界面只显示其会话 workspace 的节点；未解析出 workspace 而保存的节点，仅在当前上下文同样没有 workspace 时出现。失败会在触发操作的控件旁内联报告，操作进行中所有动作都会禁用。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明——点击展开</summary>

插件的宿主半边是一个空的 `apply`，只让这一行对 Loader 可见；浏览器半边通过包的 `dsh.client` 声明及其 `./client` 导出发布。它自行挂载生成的 `sessionNodes` Remote，然后在解析出 `remote.sessionNodes` 的作用域中注册四个插槽条目——`sidebar.sections`、`conversation.chat.assistant-actions`、`conversation.hero.options` 和 `conversation.input.dock`。

一个注册表修订计数器在任一界面成功保存、重命名或删除后递增，使其他界面刷新；它是手写的 subscribe/getSnapshot 组合，因为为一个数字引入完整的快照存储会把状态引擎拖进组合包。派生成功后通过 `ctx.uiWorkspace.openSession` 打开子会话。Workspace 过滤集中在一个共享函数中：节点匹配其界面所在的 workspace id，无 workspace 的节点只匹配无 workspace 的上下文。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[Session Node 服务与命令](../session-node/README.zh.md#use-this-package)

[管理可选插件](../../client/ui-plugin-manager/README.zh.md#use-this-package)

-----

<a id="model-experience"></a>
## 模型体验

间接影响：四个界面驱动宿主 `sessionNodes` Remote；`dsh-session-node` 拥有已存节点，以及派生子会话随后提交的继承历史。

#### KV Cache 影响

无；浏览器界面从不组装或发送 provider 请求。派生子会话的请求由 `dsh-session-node` 拥有。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 这些界面需要同一 profile 中安装宿主 `@deepseek-ai/dsh-session-node` 组合包；缺失时所有操作都会以 Remote 错误失败。
- 侧栏列表跟随主视图会话的 workspace；全局面板覆盖对话时，它只显示未解析出 workspace 而保存的节点。
- 轮次图钉仅出现在记录了已结算 turn tail 的那一轮的收尾消息上，并且需要 `sessionNodes/save` 访问授权。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明——点击展开</summary>

无。

</details>

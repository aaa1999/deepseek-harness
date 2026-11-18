---
description: "在项目下保存会话检查点，稍后从该检查点派生新会话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-node

[English](README.md) | 中文

## 概述

Session Node（会话节点）保存会话的具名检查点——截至最近一个已完成轮次的历史——并挂在会话所属的项目（workspace）下，之后可以随时从该检查点派生新会话。安装此组合包的 profile 中，`/save-node`、`/nodes`、`/fork-node`、`/rename-node` 和 `/delete-node` 命令在每个会话里都可用。已存节点保存在全局存储中，重启后仍然存在，每条记录来源会话、边界、标题和可选备注。`dsh-session-node-ui` 的浏览器界面和任意宿主插件驱动的都是同一个 `ctx.sessionNodes` 服务。

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

经过验证的安装路径：

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-session-node
dsh plugin --profile <name> remove @deepseek-ai/dsh-session-node
```

补丁插入两行——`ctx.sessionNodes` 服务与命令插件——作为全局层，安装此组合包的 profile 都会加载这两行，命令在每个会话和项目中可用。

### 你能得到什么

在交互客户端的消息框中输入这些命令：

- `/save-node [title]` 将当前会话最近一个已完成轮次的前缀保存到其项目下。省略标题时默认为 `node-<timestamp>`；程序化调用方还可以传入可选备注和精确边界（`atSeq`）。
- `/nodes` 列出全部已存节点：id、标题、来源会话与边界序号、项目和备注。
- `/fork-node <id-or-title>` 创建一个完整继承已保存前缀的子会话，挂到来源项目下，并打印新会话的 id。
- `/rename-node <id-or-title> <new-title>` 重命名已存节点。
- `/delete-node <id-or-title>` 删除已存节点。

选择器按完整 id、id 前缀或大小写不敏感的标题匹配；第一个匹配（最近保存的）生效。宿主插件在进程内调用 `ctx.sessionNodes`；GUI 客户端通过 `ctx.remote.sessionNodes` 命名空间使用同一组操作。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明——点击展开</summary>

已存节点是全局注册表状态，因此通过持久化存储域（`session_nodes`，版本 1）保存——一张以节点 id 为键的 `nodes` 表，加上按新到旧排列的 `order` 全局数组——而不是通过会话事件日志。启动时打开存储域并重建内存缓存；读取直接走缓存，每次变更都通过存储域写入链持久化。

保存时先按注册表成员关系解析所属 workspace，再按来源头部的 `cwd` 解析。省略边界时默认取最近一个已完成轮次的前缀（包含下一轮开始前的独立事件），因此已存节点总是稳定的轮次间位置。派生时按来源会话的 preset 组装子智能体——与会话控制器保持一致——通过 `inheritedEventCount` 继承前缀，为未闭合的轮次补上合成收尾事件，并把子会话挂到 workspace 下。

该服务同时是 `ctx.remote.sessionNodes` 的 Remote 持有者；线上导出名为 `delete`，因为 `remove` 被客户端的 Remote 命名空间服务保留。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[命令注册表](../../interaction/commands/README.zh.md)

[浏览器界面](../session-node-ui/README.zh.md#use-this-package)

[会话日志与派生](../../core/session/README.zh.md)

[管理可选插件](../../client/ui-plugin-manager/README.zh.md#use-this-package)

-----

<a id="model-experience"></a>
## 模型体验

### 人类节点命令

#### 模型收到的内容

`/save-node`、`/nodes`、`/fork-node`、`/rename-node` 和 `/delete-node` 在人类命令平面运行：斜杠输入和直接的成功或错误文本都不会进入模型请求。每次获准的执行会以 `command/run` 和 `command/done` 生命周期事件记录到来源会话的日志。分发与准入由 [dsh-commands](../../interaction/commands/README.zh.md) 负责。

#### Token 影响

无。命令发现、节点变更和直接输出都不会增加模型 Token。

#### KV Cache 影响

无。节点注册表状态保存在存储域中，命令记录仅写入日志；二者都不会进入请求，因此不会导致缓存复用失效。

### 派生会话的历史

#### 模型收到的内容

派生创建的子会话，其对话前缀就是已保存边界处的前缀：来源会话截至 `atSeq` 的消息事件，随后是继承切割标记和为未闭合轮次生成的合成收尾事件。子会话的请求把该前缀当作普通历史携带；来源会话的请求不变。

#### Token 影响

派生本身不增加 Token。子会话在自己的请求中按普通对话 Token 支付继承的前缀；保存、列出、重命名和删除节点都不增加 Token。

#### KV Cache 影响

继承的前缀在子会话中是稳定的消息历史，并随子会话继续只追加增长。来源会话可复用的请求前缀不受影响。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 节点的生命周期长于来源会话。删除来源会话后节点仍在列表中，之后派生会以 `SESSION_NODE_SESSION_NOT_FOUND` 失败；来源日志中已不存在的边界以 `SESSION_NODE_STALE` 失败。
- 保存需要已完成的轮次。没有 `turn/end` 的会话以 `SESSION_NODE_INVALID_BOUNDARY` 失败；显式 `atSeq` 必须指向已存在的事件序号。
- `/fork-node` 只打印新会话的 id，不会打开它；打开子会话属于界面（如 [session-node-ui](../session-node-ui/README.zh.md#use-this-package)）的职责。
- 命令选择器按完整 id、id 前缀或大小写不敏感的标题取第一个匹配；有歧义的标题解析为最近保存的节点。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明——点击展开</summary>

无。

</details>

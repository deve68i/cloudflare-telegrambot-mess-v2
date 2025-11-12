# Cloudflare 免费部署 Telegram Bot 双向机器人

一个部署在 Cloudflare Workers 上的 Telegram 消息转发机器人，用于在隐藏管理员真实账号的前提下接收、回复用户消息。机器人内置乘法验证码、快捷操作、自动回复及屏蔽管理等能力，适合个人场景使用。

---

## ✨ 功能概览

- **消息双向转发**：访客消息自动复制到管理员私聊，管理员直接回复即可同步回访客。
- **内联乘法验证码**：首次对话或重置验证后，访客需解答个位数乘法题；支持 4 个按钮选项，5 分钟过期。
- **自动回复体系**：关键词匹配触发自动回复，可通过命令增删列表，支持最多 50 条规则。
- **快捷回复面板**：内联按钮一键发送常用回复（默认模板 + 自定义模板），并自动标记处理状态。
- **屏蔽/解封管理**：快捷按钮或命令屏蔽访客，支持查询当前状态，防止骚扰。
- **管理员操作菜单**：Telegram 输入框旁的自定义键盘提供教程、命令、自动回复、快捷回复入口。
- **用户信息卡片**：转发消息前附带用户名/UID 信息，支持点击跳转至原用户。
- **状态标记**：自动记录消息是否已回复、是否自动回复、是否屏蔽，并同步更新内联按钮。
- **Cloudflare KV 持久化**：存储验证状态、消息映射、快捷回复、自定义配置等数据。
- **可扩展性**：可在 Cloudflare Workers 环境中轻松拓展日志、统计、通知等功能。

---

## 🧾 目录结构

```
.
├── worker_v2.js          # Cloudflare Worker 主代码
├── images/               # 运行截图、二维码
│   ├── imge_demo_*.png   # 成功运行截图（示例）
│   └── photo_2025-11-12_16-06-50.jpg  # TRC20 打赏二维码
└── README.md             # 当前文档
```


---

## 📋 部署前准备

1. **Telegram 机器人**
   - 与 `@BotFather` 对话，发送 `/newbot` 创建机器人，获取 Bot Token。
   - 使用 `/setjoingroups` 禁止机器人被邀请入群。
   - 视需要使用 `/setprivacy` 关闭隐私模式，以便接收所有消息。

2. **管理员 UID**
   - 与 `@username_to_id_bot` 对话获取自己 Telegram 账号的数字 UID。

3. **随机 Secret**
   - 前往 [UUID Generator](https://www.uuidgenerator.net/) 生成一个随机 UUID 作为 `ENV_BOT_SECRET`。该站点提供符合 RFC 4122 的 UUID，可以直接复制使用。[^uuid]

4. **Cloudflare 账号**
   - 需要具备可用的 Cloudflare Workers 服务及 KV 存储。

[^uuid]: UUID 随机生成工具：[https://www.uuidgenerator.net/](https://www.uuidgenerator.net/)

---

## 🚀 快速部署

### 1. 创建 Worker

1. 登录 Cloudflare Dashboard → Pages & Workers → Workers → Create Application → Create Worker。
2. 进入 Worker，删除默认脚本，将 `worker_v2.js` 全量复制粘贴到编辑器中。

### 2. 配置环境变量

在 Worker 的 “Settings → Variables” 中新增以下文本变量：

| 变量名            | 示例值                              | 说明                                   |
|------------------|-------------------------------------|----------------------------------------|
| `ENV_BOT_TOKEN`   | `123456:ABC-DEF1234...`             | BotFather 返回的机器人令牌             |
| `ENV_BOT_SECRET`  | `a5eb3993-cb9c-4a26-94f1-49a313b83b18` | 随机 UUID（来自 uuidgenerator.net） |
| `ENV_ADMIN_UID`   | `123456789`                         | 管理员 Telegram 数字 UID               |

### 3. 绑定 KV

1. 在 Cloudflare Dashboard → Workers KV 中创建一个新的命名空间（例如 `nfd`）。
2. 回到 Worker 的 Settings → “KV Namespace Bindings”，新增绑定：
   - **Variable name**：`nfd`
   - **KV namespace**：选择刚刚创建的命名空间

### 4. 保存并部署

在编辑器点击 “Save and Deploy” 部署最新脚本。

### 5. 注册 Telegram Webhook

假设 Worker 对外地址为 `https://your-worker.example.workers.dev`，部署后访问：

```
https://your-worker.example.workers.dev/registerWebhook
```

若需要取消，可访问：

```
https://your-worker.example.workers.dev/unRegisterWebhook
```

---

## ✅ 验证与使用

1. **访客首聊**：首次发送 `/start` 或第一条消息时，机器人会返回乘法验证码，访客完成验证后才能正常聊天。
2. **管理员视角**：
   - `/start` 会显示完整命令菜单，包含自动回复、快捷回复、屏蔽操作等。
   - 转发消息附带可点击的用户信息卡片和内联按钮，支持快捷操作。
3. **重置测试**：
   - 如需重新测试，可在 Cloudflare KV 中删除 `user:verified:<用户ID>` 相关键。

---

## 🔧 常用命令

| 命令 | 说明 |
|------|------|
| `/help` | 查看使用教程（管理员专用） |
| `/menu` | 显示管理员命令菜单 |
| `/block` / `/unblock` / `/checkblock` | 屏蔽、解除屏蔽、查询状态（需回复消息使用） |
| `/addreply <关键词> <回复>` | 新增自动回复规则 |
| `/delreply <关键词>` / `/listreply` | 删除 / 列出自动回复 |
| `/addquickreply <名称> <内容>` | 新增自定义快捷回复 |
| `/delquickreply <名称>` | 删除自定义快捷回复 |

普通用户仅能使用 `/start`。

---

## 📸 运行截图

请将运行示例图片放入 `images/` 目录后，在此引用，例如：

![功能示例](images/imge_demo_captcha.png)
[命令示例](9fb1b8c9-384f-4a25-b3f8-37bbe35ac609.png)
![管理员操作界面](d7ddcb5e-c61e-4c02-9b78-4884b70eedbe.png)


---

## ☕️ 打赏支持

- **TRC20-USDT 地址**：`TFeY7mf386s66cti4NBw4zy7nCUhyREEo7`
- **二维码**：

![TRC20 收款码](images/photo_2025-11-12_16-06-50.jpg)

感谢支持！

---

## 📄 许可证 & 声明

本项目由作者原创开发，保留全部权利。除非获得书面授权，任何主体不得将本项目或其衍生版本用于商业盈利、再分发或提供付费服务。默认许可条款如下：

- **版权归属**：Copyright © 2025 Diya（@Diauid）。  
- **使用范围**：仅限个人学习、测试或非商业演示使用。部署时保留开源地址。
- **修改要求**：如需修改代码，必须在 README 或 About 页面显著注明 “基于 Cloudflare 免费部署 Telegram Bot 双向机器人项目修改”，并附上原仓库地址或作者联系方式。
- **禁止事项**：禁止未经许可的销售、出租、代部署、提供付费托管或将本项目并入商业产品；禁止将源码重新打包发布到第三方平台；禁止移除版权声明或替换为他人署名。
- **责任声明**：本项目按 “现状” 提供，作者不对使用结果负责。使用者需自行承担部署和运营风险。


---

## 🙌 贡献建议

欢迎提交 Issue / PR 反馈问题或提出改进需求。Telegram 反馈联系 [@Diauid](https://t.me/Diauid)

如采纳，请在 README 中增补相关说明并保持目录结构一致。

---

有手就行，如果还不会就氪金吧


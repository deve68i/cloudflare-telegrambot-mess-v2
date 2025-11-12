const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const VERIFY_CODE_EXPIRE = 300 * 1000; // 验证码5分钟过期

const COMMAND_USAGE_HINT = `📘 操作提示

屏蔽管理:
  /block - 屏蔽用户（需回复消息）
  /unblock - 解除屏蔽（需回复消息）
  /checkblock - 检查状态（需回复消息）

自动回复:
  /addreply <关键词> <回复>
  /delreply <关键词>
  /listreply

快捷回复:
  /addquickreply <名称> <内容>
  /delquickreply <名称>

其他:
  /help - 使用教程
  /menu - 显示菜单`;

const START_MESSAGE = `使用方法：

- 当你给bot发消息时，会被转发到bot创建者
- 用户"回复"或"引用"普通文字给转发的消息时，会回复到原消息发送者`;

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl (methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook (event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate (update) {
  if ('message' in update) {
    await onMessage(update.message)
  } else if ('callback_query' in update) {
    await handleCallbackQuery(update.callback_query)
  }
}

/**
 * ============================================
 * 验证码功能（图形验证码）
 * ============================================
 */

// 生成验证码（个位数乘法）
function generateVerifyCode() {
  const a = Math.floor(Math.random() * 9) + 1 // 1-9
  const b = Math.floor(Math.random() * 9) + 1 // 1-9
  const code = (a * b).toString()
  return {
    code,
    question: `${a} × ${b} = ?`,
    operands: { a, b }
  }
}

// 生成错误选项（与正确答案不同的3个结果）
function generateWrongOptions(correctCode) {
  const options = new Set()
  while (options.size < 3) {
    const a = Math.floor(Math.random() * 9) + 1
    const b = Math.floor(Math.random() * 9) + 1
    const result = a * b
    const candidate = result.toString()
    if (candidate !== correctCode) {
      options.add(candidate)
    }
  }
  return Array.from(options)
}

// 检查用户是否已验证
async function isUserVerified(chatId) {
  const verified = await nfd.get(`user:verified:${chatId}`, { type: "json" })
  return !!verified
}

// 标记用户为已验证
async function markUserVerified(chatId) {
  await nfd.put(`user:verified:${chatId}`, JSON.stringify(true))
}

// 生成并发送乘法验证码
async function sendVerifyCode(chatId) {
  const { code, question } = generateVerifyCode()
  const expireTime = Date.now() + VERIFY_CODE_EXPIRE
  
  // 生成错误选项
  const wrongOptions = generateWrongOptions(code)
  const allOptions = [code, ...wrongOptions]
  
  // 随机打乱选项顺序
  for (let i = allOptions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]]
  }
  
  // 找到正确答案在新数组中的位置
  const correctIndex = allOptions.indexOf(code)
  
  // 存储验证码信息
  await nfd.put(`verify:code:${chatId}`, JSON.stringify({
    code: code,
    correctIndex: correctIndex,
    expireTime: expireTime,
    options: allOptions
  }))

  // 创建内联按钮（4个选项，2x2布局）
  const buttons = allOptions.map((option, index) => ({
    text: option,
    callback_data: `verify:${index}:${chatId}`
  }))
  
  const keyboard = [
    [buttons[0], buttons[1]],
    [buttons[2], buttons[3]]
  ]
  
  return sendMessage({
    chat_id: chatId,
    text: `🔐 乘法验证码\n\n请计算下方乘法题并从选项中选择正确答案：\n\n${question}\n\n验证码5分钟内有效`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  })
}

// 验证验证码（通过回调）
async function verifyCodeByCallback(chatId, selectedIndex) {
  const verifyData = await nfd.get(`verify:code:${chatId}`, { type: "json" })
  
  if (!verifyData) {
    return {
      success: false,
      message: '验证码不存在或已过期，请重新发送消息获取验证码'
    }
  }
  
  const now = Date.now()
  if (now > verifyData.expireTime) {
    await nfd.put(`verify:code:${chatId}`, null)
    return {
      success: false,
      message: '验证码已过期，请重新发送消息获取新的验证码'
    }
  }
  
  // 检查选择的索引是否正确
  if (selectedIndex !== verifyData.correctIndex) {
    return {
      success: false,
      message: '验证码错误，请重新选择'
    }
  }
  
  // 验证成功
  await markUserVerified(chatId)
  await nfd.put(`verify:code:${chatId}`, null)
  
  return {
    success: true,
    message: '✅ 验证成功！现在可以正常发送消息了。'
  }
}

/**
 * ============================================
 * 自动回复功能
 * ============================================
 */
async function checkAutoReply(message) {
  const text = message.text || ''
  const autoReplies = await nfd.get('auto_reply:list', { type: "json" }) || []
  
  for (const reply of autoReplies) {
    let pattern
    try {
      pattern = new RegExp(reply.keyword, 'i')
    } catch (e) {
      // 如果不是正则，使用简单包含匹配
      pattern = new RegExp(reply.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
    
    if (pattern.test(text)) {
      return reply.response
    }
  }
  
  return null
}

async function handleAddAutoReply(message) {
  const match = message.text.match(/^\/addreply\s+([^\s]+)\s+(.+)$/)
  if (!match) {
    return sendMessage({
      chat_id: message.chat.id,
      text: '用法: /addreply <关键词> <回复内容>\n\n示例: /addreply 你好 您好，有什么可以帮助您的吗？\n\n' + COMMAND_USAGE_HINT
    })
  }

  const keyword = match[1]
  const response = match[2]
  const replies = await nfd.get('auto_reply:list', { type: "json" }) || []

  replies.push({ keyword, response })
  await nfd.put('auto_reply:list', JSON.stringify(replies))

  return sendMessage({
    chat_id: message.chat.id,
    text: `✅ 自动回复添加成功\n\n关键词: ${keyword}\n回复: ${response}`
  })
}

async function handleDelAutoReply(message) {
  const match = message.text.match(/^\/delreply\s+(.+)$/)
  if (!match) {
    return sendMessage({
      chat_id: message.chat.id,
      text: '用法: /delreply <关键词>\n\n' + COMMAND_USAGE_HINT
    })
  }

  const keyword = match[1]
  let replies = await nfd.get('auto_reply:list', { type: "json" }) || []
  const beforeCount = replies.length
  replies = replies.filter(r => r.keyword !== keyword)
  await nfd.put('auto_reply:list', JSON.stringify(replies))

  if (replies.length < beforeCount) {
    return sendMessage({
      chat_id: message.chat.id,
      text: `✅ 自动回复 "${keyword}" 已删除`
    })
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: `❌ 未找到关键词 "${keyword}"`
    })
  }
}

async function handleListAutoReply(message) {
  const replies = await nfd.get('auto_reply:list', { type: "json" }) || []
  
  if (replies.length === 0) {
    return sendMessage({
      chat_id: message.chat.id,
      text: '📋 暂无自动回复规则'
    })
  }

  const text = '📋 自动回复列表:\n\n' + replies.map((r, i) => `${i + 1}. "${r.keyword}" → ${r.response}`).join('\n')
  
  return sendMessage({
    chat_id: message.chat.id,
    text: text
  })
}

/**
 * ============================================
 * 快捷操作功能（内联菜单）
 * ============================================
 */

// 创建管理员快捷操作菜单（用于转发消息）
async function createAdminInlineMenu(messageId) {
  // 获取用户屏蔽状态
  const guestChatId = await nfd.get(`msg-map-${messageId}`, { type: "json" })
  let isBlocked = false
  let autoReplied = false
  if (guestChatId) {
    isBlocked = await nfd.get('isblocked-' + guestChatId, { type: "json" }) || false
    autoReplied = await nfd.get(`auto_replied:${messageId}`, { type: "json" }) || false
  }
  
  // 获取自定义快捷回复
  const customReplies = await getCustomQuickReplies()
  
  const keyboard = []
  
  // 第一行：屏蔽和自动回复状态
  keyboard.push([
    { text: isBlocked ? '🔓 解除屏蔽' : '🚫 屏蔽用户', callback_data: `admin:toggle_block:${messageId}` },
    { text: autoReplied ? '✅ 已自动回复' : '❌ 未自动回复', callback_data: `admin:toggle_auto_reply:${messageId}` }
  ])
  
  // 第二行：状态按钮
  keyboard.push([
    { text: '📋 状态', callback_data: `admin:check_status:${messageId}` }
  ])
  
  // 如果有自定义快捷回复，每个模板一行显示
  if (customReplies.length > 0) {
    customReplies.forEach((reply, index) => {
      keyboard.push([
        { text: formatQuickReplyLabel(reply.name, reply.content), callback_data: `custom_quick_reply:${index}:${messageId}` }
      ])
    })
  } else {
    // 如果没有自定义快捷回复，显示快捷回复菜单按钮
    keyboard.push([
      { text: '💬 快捷回复', callback_data: `admin:quick_reply:${messageId}` }
    ])
  }
  
  return {
    inline_keyboard: keyboard
  }
}

// 创建快捷回复菜单（预设模板2*2布局）
function createQuickReplyMenu(messageId) {
  const replies = [
    { name: '收到', content: '收到，我会尽快处理' },
    { name: '稍等', content: '请稍等，正在处理中' },
    { name: '已处理', content: '已处理完成' },
    { name: '好的', content: '好的，明白了' }
  ]
  
  const buttons = replies.map((reply, index) => ({
    text: formatQuickReplyLabel(reply.name, reply.content),
    callback_data: `quick_reply:${index}:${messageId}`
  }))
  
  // 2行2列布局
  const keyboard = [
    [buttons[0], buttons[1]],
    [buttons[2], buttons[3]]
  ]
  
  // 添加返回按钮
  keyboard.push([{ text: '🔙 返回', callback_data: `admin:menu:${messageId}` }])
  
  return {
    inline_keyboard: keyboard
  }
}

function formatQuickReplyLabel(name, content) {
  const base = `${name} -- ${content}`
  const trimmed = base.length > 55 ? `${base.slice(0, 52)}...` : base
  return `💬 ${trimmed}`
}

// 获取自定义快捷回复
async function getCustomQuickReplies() {
  return await nfd.get('quick_reply:custom', { type: "json" }) || []
}

// 创建自定义快捷回复菜单（一行一个）
async function createCustomQuickReplyMenu(messageId) {
  const replies = await getCustomQuickReplies()
  
  if (replies.length === 0) {
    return {
      inline_keyboard: [
        [{ text: '📝 添加快捷回复', callback_data: `admin:add_quick_reply:${messageId}` }],
        [{ text: '🔙 返回', callback_data: `admin:menu:${messageId}` }]
      ]
    }
  }
  
  // 每个模板一行
  const keyboard = replies.map((reply, index) => [
    { text: formatQuickReplyLabel(reply.name, reply.content), callback_data: `custom_quick_reply:${index}:${messageId}` }
  ])
  
  keyboard.push([
    { text: '➕ 添加', callback_data: `admin:add_quick_reply:${messageId}` },
    { text: '🔙 返回', callback_data: `admin:menu:${messageId}` }
  ])
  
  return {
    inline_keyboard: keyboard
  }
}

// 处理回调查询
async function handleCallbackQuery(callbackQuery) {
  const data = callbackQuery.data
  const message = callbackQuery.message
  const parts = data.split(':')
  const action = parts[0]
  const subAction = parts[1]
  let messageId = parts[2] || (message.reply_to_message ? message.reply_to_message.message_id : null)
  
  // 如果messageId是"temp"，使用当前消息的message_id
  if (messageId === 'temp') {
    messageId = message.message_id
  }

  try {
    // 处理验证码验证
    if (action === 'verify') {
      const selectedIndex = parseInt(parts[1])
      const chatId = parts[2]
      
      const result = await verifyCodeByCallback(chatId, selectedIndex)
      
      await requestTelegram('answerCallbackQuery', makeReqBody({
        callback_query_id: callbackQuery.id,
        text: result.message,
        show_alert: result.success
      }))
      
      if (result.success) {
        // 验证成功，删除验证码消息
        try {
          await requestTelegram('deleteMessage', makeReqBody({
            chat_id: message.chat.id,
            message_id: message.message_id
          }))
        } catch (error) {
          console.error('Failed to delete verification message:', error)
        }

        // 发送欢迎提示
        try {
          await sendMessage({
            chat_id: chatId,
            text: START_MESSAGE
          })
        } catch (error) {
          console.error('Failed to send start message after verification:', error)
        }
      }
      
      return
    }
    
    // 管理员操作
    if (action === 'admin') {
      if (subAction === 'toggle_block') {
        const guestChatId = await nfd.get(`msg-map-${messageId}`, { type: "json" })
        if (guestChatId && guestChatId !== ADMIN_UID) {
          const isBlocked = await nfd.get('isblocked-' + guestChatId, { type: "json" }) || false
          const newStatus = !isBlocked
          await nfd.put('isblocked-' + guestChatId, JSON.stringify(newStatus))
          
          // 更新按钮文本
          try {
            await requestTelegram('editMessageReplyMarkup', makeReqBody({
              chat_id: message.chat.id,
              message_id: message.message_id,
              reply_markup: await createAdminInlineMenu(messageId)
            }))
          } catch (error) {
            console.error('Failed to update button:', error)
          }
          
          await requestTelegram('answerCallbackQuery', makeReqBody({
            callback_query_id: callbackQuery.id,
            text: newStatus ? '✅ 用户已屏蔽' : '✅ 已解除屏蔽'
          }))
        } else {
          await requestTelegram('answerCallbackQuery', makeReqBody({
            callback_query_id: callbackQuery.id,
            text: '❌ 操作失败'
          }))
        }
        return
      }
      
      if (subAction === 'toggle_auto_reply') {
        const autoReplied = await nfd.get(`auto_replied:${messageId}`, { type: "json" }) || false
        const newStatus = !autoReplied
        await nfd.put(`auto_replied:${messageId}`, JSON.stringify(newStatus))
        
        // 更新按钮文本
        try {
          await requestTelegram('editMessageReplyMarkup', makeReqBody({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: await createAdminInlineMenu(messageId)
          }))
        } catch (error) {
          console.error('Failed to update auto reply button:', error)
        }
        
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id,
          text: newStatus ? '✅ 已标记为自动回复' : '✅ 已取消自动回复标记'
        }))
        return
      }
      
      if (subAction === 'check_status') {
        const guestChatId = await nfd.get(`msg-map-${messageId}`, { type: "json" })
        if (guestChatId) {
          const blocked = await nfd.get('isblocked-' + guestChatId, { type: "json" })
          const status = await nfd.get(`msg:status:${messageId}`, { type: "json" }) || 'pending'
          await requestTelegram('answerCallbackQuery', makeReqBody({
            callback_query_id: callbackQuery.id,
            text: `状态: ${blocked ? '已屏蔽' : '正常'} | 消息: ${status === 'replied' ? '已回复' : '待处理'}`,
            show_alert: true
          }))
        }
        return
      }
      
      if (subAction === 'quick_reply') {
        const customMenu = await createCustomQuickReplyMenu(messageId)
        try {
          await requestTelegram('editMessageReplyMarkup', makeReqBody({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: customMenu
          }))
        } catch (error) {
          console.error('Failed to edit quick reply menu:', error)
        }
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id
        }))
        return
      }
      
      if (subAction === 'menu') {
        try {
          await requestTelegram('editMessageReplyMarkup', makeReqBody({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: await createAdminInlineMenu(messageId)
          }))
        } catch (error) {
          console.error('Failed to edit menu:', error)
        }
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id
        }))
        return
      }
      
      if (subAction === 'add_quick_reply') {
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id,
          text: '请使用 /addquickreply <名称> <内容> 命令添加快捷回复',
          show_alert: true
        }))
        return
      }
    }
    
    // 快捷回复（预设模板）
    if (action === 'quick_reply') {
      const index = parseInt(subAction)
      const replies = [
        { name: '收到', content: '收到，我会尽快处理' },
        { name: '稍等', content: '请稍等，正在处理中' },
        { name: '已处理', content: '已处理完成' },
        { name: '好的', content: '好的，明白了' }
      ]
      const reply = replies[index]
      const guestChatId = await nfd.get(`msg-map-${messageId}`, { type: "json" })

      if (reply && guestChatId) {
        await sendMessage({
          chat_id: guestChatId,
          text: reply.content
        })
        await nfd.put(`msg:status:${messageId}`, JSON.stringify('replied'))
        await nfd.put(`auto_replied:${messageId}`, JSON.stringify(true))
        try {
          await requestTelegram('editMessageReplyMarkup', makeReqBody({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: await createAdminInlineMenu(messageId)
          }))
        } catch (error) {
          console.error('Failed to refresh inline menu after quick reply:', error)
        }
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id,
          text: '✅ 已发送（已标记自动回复）'
        }))
      }
      return
    }
    
    // 自定义快捷回复
    if (action === 'custom_quick_reply') {
      const index = parseInt(subAction)
      const replies = await getCustomQuickReplies()
      const reply = replies[index]
      const guestChatId = await nfd.get(`msg-map-${messageId}`, { type: "json" })

      if (reply && guestChatId) {
        await sendMessage({
          chat_id: guestChatId,
          text: reply.content
        })
        await nfd.put(`msg:status:${messageId}`, JSON.stringify('replied'))
        await nfd.put(`auto_replied:${messageId}`, JSON.stringify(true))
        try {
          await requestTelegram('editMessageReplyMarkup', makeReqBody({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reply_markup: await createAdminInlineMenu(messageId)
          }))
        } catch (error) {
          console.error('Failed to refresh inline menu after custom quick reply:', error)
        }
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id,
          text: '✅ 已发送（已标记自动回复）'
        }))
      }
      return
    }
  } catch (error) {
    console.error('Error handling callback query:', error)
    await requestTelegram('answerCallbackQuery', makeReqBody({
      callback_query_id: callbackQuery.id,
      text: '❌ 操作失败，请重试'
    }))
  }
}

// 添加快捷回复
async function handleAddQuickReply(message) {
  const match = message.text.match(/^\/addquickreply\s+([^\s]+)\s+(.+)$/)
  if (!match) {
    return sendMessage({
      chat_id: message.chat.id,
      text: '用法: /addquickreply <名称> <内容>\n\n示例: /addquickreply 收到 收到，我会尽快处理\n\n' + COMMAND_USAGE_HINT
    })
  }

  const name = match[1]
  const content = match[2]
  const replies = await getCustomQuickReplies()

  replies.push({ name, content })
  await nfd.put('quick_reply:custom', JSON.stringify(replies))

  return sendMessage({
    chat_id: message.chat.id,
    text: `✅ 快捷回复 "${name}" 添加成功`
  })
}

// 删除快捷回复
async function handleDelQuickReply(message) {
  const match = message.text.match(/^\/delquickreply\s+(.+)$/)
  if (!match) {
    return sendMessage({
      chat_id: message.chat.id,
      text: '用法: /delquickreply <名称>\n\n' + COMMAND_USAGE_HINT
    })
  }

  const name = match[1]
  let replies = await getCustomQuickReplies()
  const beforeCount = replies.length
  replies = replies.filter(r => r.name !== name)
  await nfd.put('quick_reply:custom', JSON.stringify(replies))

  if (replies.length < beforeCount) {
    return sendMessage({
      chat_id: message.chat.id,
      text: `✅ 快捷回复 "${name}" 已删除`
    })
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: `❌ 未找到快捷回复 "${name}"`
    })
  }
}

/**
 * ============================================
 * 帮助命令和命令菜单
 * ============================================
 */

// 创建命令菜单按钮（在输入框旁边）
function createCommandMenu() {
  return {
    keyboard: [
      [
        { text: '📖 使用教程' },
        { text: '📋 命令列表' }
      ],
      [
        { text: '🤖 自动回复管理' },
        { text: '💬 快捷回复管理' }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
}

// 处理命令菜单按钮点击（仅管理员可用，已在调用处检查）
async function handleCommandMenu(message) {
  const text = message.text
  
  if (text === '📖 使用教程') {
    return handleHelp(message, true)
  }
  
  if (text === '📋 命令列表') {
    return handleCommandList(message)
  }
  
  if (text === '🤖 自动回复管理') {
    return handleListAutoReply(message)
  }
  
  if (text === '💬 快捷回复管理') {
    const replies = await getCustomQuickReplies()
    if (replies.length === 0) {
      return sendMessage({
        chat_id: message.chat.id,
        text: '📋 暂无自定义快捷回复\n\n使用 /addquickreply <名称> <内容> 添加'
      })
    }
    const text = '📋 快捷回复列表:\n\n' + replies.map((r, i) => `${i + 1}. ${r.name} → ${r.content}`).join('\n')
    return sendMessage({
      chat_id: message.chat.id,
      text: text
    })
  }
}

// 帮助命令
async function handleHelp(message, isMenu = false) {
  const helpText = `📖 使用教程

━━━━━━━━━━━━━━━━
🤖 基础功能
━━━━━━━━━━━━━━━━

1️⃣ 消息转发
   • 用户发送消息会自动转发给你
   • 回复转发的消息即可回复用户

2️⃣ 快捷操作
   • 转发消息下方有操作按钮
   • 点击按钮可快速执行操作

━━━━━━━━━━━━━━━━
🔧 管理命令
━━━━━━━━━━━━━━━━

屏蔽管理:
  /block - 屏蔽用户（回复消息）
  /unblock - 解除屏蔽（回复消息）
  /checkblock - 检查屏蔽状态（回复消息）

自动回复:
  /addreply <关键词> <回复> - 添加自动回复
  /delreply <关键词> - 删除自动回复
  /listreply - 列出所有自动回复

快捷回复:
  /addquickreply <名称> <内容> - 添加快捷回复
  /delquickreply <名称> - 删除快捷回复

其他:
  /help - 显示此帮助信息
  /menu - 显示命令菜单

━━━━━━━━━━━━━━━━
💡 使用技巧
━━━━━━━━━━━━━━━━

• 首次使用需要完成验证码验证
• 使用内联按钮快速操作，无需输入命令
• 设置自动回复可自动处理常见问题
• 添加快捷回复可快速回复常用内容
• 点击输入框旁的按钮可快速访问功能

━━━━━━━━━━━━━━━━`

  return sendMessage({
    chat_id: message.chat.id,
    text: helpText,
    reply_markup: message.chat.id.toString() === ADMIN_UID ? createCommandMenu() : undefined
  })
}

// 命令列表
async function handleCommandList(message) {
  const commandText = `📋 命令列表

━━━━━━━━━━━━━━━━
🔧 管理员命令
━━━━━━━━━━━━━━━━

屏蔽管理:
  /block - 屏蔽用户
  /unblock - 解除屏蔽
  /checkblock - 检查状态

自动回复:
  /addreply <关键词> <回复>
  /delreply <关键词>
  /listreply

快捷回复:
  /addquickreply <名称> <内容>
  /delquickreply <名称>

其他:
  /help - 使用教程（图文教程）
  /menu - 显示菜单（含教程提示）

━━━━━━━━━━━━━━━━
👤 用户命令
━━━━━━━━━━━━━━━━

  /start - 开始使用

━━━━━━━━━━━━━━━━
🔐 验证码说明
━━━━━━━━━━━━━━━━

首次使用需要验证：
  • 第一次发送消息会自动收到验证码
  • 验证码5分钟内有效
  • 验证成功后即可正常使用

━━━━━━━━━━━━━━━━
⚠️ 提示: 屏蔽管理命令需在回复用户消息的情况下使用。`

  return sendMessage({
    chat_id: message.chat.id,
    text: commandText,
    reply_markup: message.chat.id.toString() === ADMIN_UID ? createCommandMenu() : undefined
  })
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {
  // 如果是管理员，确保命令已设置（每次消息都设置，确保命令提示可用）
  if (message.chat.id.toString() === ADMIN_UID) {
    await setBotCommands(message.chat.id)
  }
  
  // 处理 /start 命令
  if(message.text === '/start'){
    const isAdmin = message.chat.id.toString() === ADMIN_UID

    // 设置Bot命令提示
    await setBotCommands(message.chat.id)
    
    if (!isAdmin) {
      const verified = await isUserVerified(message.chat.id)
      if (!verified) {
        await sendVerifyCode(message.chat.id)
        return
      }

      return sendMessage({
        chat_id: message.chat.id,
        text: START_MESSAGE
      })
    }
    
    // 管理员：发送欢迎消息
    return sendMessage({
      chat_id:message.chat.id,
      text: START_MESSAGE,
      reply_markup: createCommandMenu()
    })
  }
  
  // 处理 /help 命令（仅管理员可用）
  if(message.text === '/help' || message.text === '/menu'){
    if (message.chat.id.toString() !== ADMIN_UID) {
      return // 普通用户忽略此命令
    }
    return handleHelp(message)
  }
  
  // 处理命令菜单按钮（仅管理员可用）
  if(message.text && ['📖 使用教程', '📋 命令列表', '🤖 自动回复管理', '💬 快捷回复管理'].includes(message.text)){
    if (message.chat.id.toString() !== ADMIN_UID) {
      return // 普通用户忽略此按钮
    }
    return handleCommandMenu(message)
  }
  
  // 管理员消息处理
  if(message.chat.id.toString() === ADMIN_UID){
    // 自动回复管理
    if(/^\/addreply\s+/.exec(message.text)){
      return handleAddAutoReply(message)
    }
    if(/^\/delreply\s+/.exec(message.text)){
      return handleDelAutoReply(message)
    }
    if(/^\/listreply/.exec(message.text)){
      return handleListAutoReply(message)
    }
    
    // 快捷回复管理
    if(/^\/addquickreply\s+/.exec(message.text)){
      return handleAddQuickReply(message)
    }
    if(/^\/delquickreply\s+/.exec(message.text)){
      return handleDelQuickReply(message)
    }
    
    // 屏蔽相关命令
    if(!message?.reply_to_message?.chat){
      return sendMessage({
        chat_id:ADMIN_UID,
        text:`⚠️ 请先回复用户的转发消息再执行屏蔽相关命令。\n\n${COMMAND_USAGE_HINT}`,
        reply_markup: createCommandMenu()
      })
    }
    
    if(/^\/block$/.exec(message.text)){
      return handleBlock(message)
    }
    if(/^\/unblock$/.exec(message.text)){
      return handleUnBlock(message)
    }
    if(/^\/checkblock$/.exec(message.text)){
      return checkBlock(message)
    }
    
    // 普通回复
    let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id, { type: "json" })
    if(!guestChantId){
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 未找到对应的用户ID'
      })
    }
    
    // 更新消息状态
    await nfd.put(`msg:status:${message.reply_to_message.message_id}`, JSON.stringify('replied'))
    
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id:message.chat.id,
      message_id:message.message_id,
    })
  }
  
  // 普通用户消息处理
  return handleGuestMessage(message)
}

async function handleGuestMessage(message){
  let chatId = message.chat.id;
  
  // 检查是否被屏蔽
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  if(isblocked){
    return sendMessage({
      chat_id: chatId,
      text:'You are blocked'
    })
  }

  // 检查用户是否已验证
  const verified = await isUserVerified(chatId)
  if (!verified) {
    // 用户未验证，发送验证码
    await sendVerifyCode(chatId)
    return // 不转发消息
  }

  // 用户已验证，正常处理消息
  // 检查自动回复（在转发前检查）
  const autoReply = await checkAutoReply(message)
  let autoReplyTriggered = false
  if (autoReply) {
    await sendMessage({
      chat_id: chatId,
      text: autoReply
    })
    autoReplyTriggered = true
    // 自动回复后仍然转发给管理员
  }

  // 获取用户信息
  let userInfo = ''
  try {
    const chatInfo = await requestTelegram('getChat', makeReqBody({ chat_id: chatId }))
    if (chatInfo.ok) {
      const user = chatInfo.result
      const username = user.username ? `@${user.username}` : '无用户名'
      const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || '未知'
      userInfo = `👤 用户: <a href="tg://user?id=${chatId}">${name}</a> ${username}\n🆔 ID: <code>${chatId}</code>`
      if (autoReplyTriggered) {
        userInfo += '\n🤖 已自动回复'
      }
    }
  } catch (error) {
    console.error('Failed to get user info:', error)
    userInfo = `🆔 用户ID: <code>${chatId}</code>`
    if (autoReplyTriggered) {
      userInfo += '\n🤖 已自动回复'
    }
  }

  // 先发送用户信息（包含可点击的用户名）
  if (userInfo) {
    await sendMessage({
      chat_id: ADMIN_UID,
      text: userInfo,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  }

  // 使用copyMessage代替forwardMessage，这样可以在消息上直接添加内联按钮
  // 先创建临时菜单（messageId稍后更新）
  const tempMenu = {
    inline_keyboard: [
      [
        { text: '🚫 屏蔽用户', callback_data: `admin:toggle_block:temp` },
        { text: '❌ 未自动回复', callback_data: `admin:toggle_auto_reply:temp` }
      ],
      [
        { text: '📋 状态', callback_data: `admin:check_status:temp` }
      ],
      [
        { text: '💬 快捷回复', callback_data: `admin:quick_reply:temp` }
      ]
    ]
  }
  
  // 复制消息并添加内联按钮
  let copyReq = await copyMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
    reply_markup: tempMenu
  })
  
  console.log(JSON.stringify(copyReq))
  if(copyReq.ok){
    const copiedMessageId = copyReq.result.message_id
    await nfd.put('msg-map-' + copiedMessageId, chatId)
    await nfd.put(`msg:status:${copiedMessageId}`, JSON.stringify('pending'))
    
    // 如果触发了自动回复，记录状态
    if (autoReplyTriggered) {
      await nfd.put(`auto_replied:${copiedMessageId}`, JSON.stringify(true))
    }
    
    // 更新内联按钮，使用正确的messageId和状态
    try {
      await requestTelegram('editMessageReplyMarkup', makeReqBody({
        chat_id: ADMIN_UID,
        message_id: copiedMessageId,
        reply_markup: await createAdminInlineMenu(copiedMessageId)
      }))
    } catch (error) {
      console.error('Failed to update message reply markup:', error)
      // 如果编辑失败，至少消息已经复制了，按钮虽然messageId不对但功能仍可用
    }
  }
}

async function handleBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  if(!guestChantId){
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '❌ 未找到对应的用户ID'
    })
  }
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  await nfd.put('isblocked-' + guestChantId, JSON.stringify(true))

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `✅ UID: ${guestChantId} 屏蔽成功`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  if(!guestChantId){
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '❌ 未找到对应的用户ID'
    })
  }

  await nfd.put('isblocked-' + guestChantId, JSON.stringify(false))

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`✅ UID: ${guestChantId} 解除屏蔽成功`,
  })
}

async function checkBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  if(!guestChantId){
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '❌ 未找到对应的用户ID'
    })
  }
  let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" })

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `📋 UID: ${guestChantId} ${blocked ? '已屏蔽' : '未屏蔽'}`,
  })
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}


/**
 * ============================================
 * Bot命令提示功能
 * ============================================
 */
async function setBotCommands(chatId) {
  const chatIdStr = chatId.toString()
  const chatIdNum = parseInt(chatIdStr, 10)

  if (Number.isNaN(chatIdNum)) {
    return
  }

  if (chatIdStr === ADMIN_UID) {
    // 清理默认作用域，避免普通用户看到管理员命令
    try {
      await requestTelegram('deleteMyCommands', makeReqBody({
        scope: { type: 'default' }
      }))
    } catch (error) {
      console.warn('Failed to clear default command scope:', error)
    }

    // 管理员命令只在管理员聊天范围内显示
    await requestTelegram('setMyCommands', makeReqBody({
      commands: [
        { command: 'help', description: '显示使用教程' },
        { command: 'menu', description: '显示命令菜单' },
        { command: 'block', description: '屏蔽用户（回复消息）' },
        { command: 'unblock', description: '解除屏蔽（回复消息）' },
        { command: 'checkblock', description: '检查屏蔽状态（回复消息）' },
        { command: 'addreply', description: '添加自动回复' },
        { command: 'delreply', description: '删除自动回复' },
        { command: 'listreply', description: '列出自动回复' },
        { command: 'addquickreply', description: '添加快捷回复' },
        { command: 'delquickreply', description: '删除快捷回复' }
      ],
      scope: { type: 'chat', chat_id: chatIdNum }
    }))
    return
  }

  // 普通用户仅保留 /start，并限定在用户聊天作用域
  try {
    await requestTelegram('deleteMyCommands', makeReqBody({
      scope: { type: 'chat', chat_id: chatIdNum }
    }))
  } catch (error) {
    console.warn(`Failed to clear commands for chat ${chatIdNum}:`, error)
  }

  await requestTelegram('setMyCommands', makeReqBody({
    commands: [
      { command: 'start', description: '开始使用' }
    ],
    scope: { type: 'chat', chat_id: chatIdNum }
  }))
}


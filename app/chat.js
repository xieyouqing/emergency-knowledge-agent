/* =========================================================
   应急助手 · 消息流（聊天式界面）
   2026-11-19 新增。依据用户裁决：演示界面做成聊天式，可回看对话记录。

   为什么用消息流替代「日常/紧急两个视图」：
     双视图是「切换后旧内容消失」。聊天式要求「旧内容留在上面」，
     而两者无法共存 —— 双视图靠 hidden 隐藏，隐藏的内容用户看不到，
     也就无法回看。因此合并为单一流，模式改为「消息上的标记」。

   ★ 核心设计：当前回答容器的 id 是**动态**的
     每条新回答都会创建一个新容器，并接过 `dailyAnswer` / `emgAnswer` 这个 id；
     旧容器的 id 被摘掉，但 DOM 完整保留。
     这样做的三个理由：
       1. 623 条既有断言按 `getElementById('dailyAnswer')` 取「最新回答」，
          语义不变，测试无需重写（这是改动可控的关键）。
       2. 旧消息的 DOM 不被搬动 → 打勾、朗读按钮、分诊选项**仍然可交互**
          （若改成「快照静态 HTML」，旧消息就变成死的，违背「可回看」）。
       3. 保留「同一时刻只有一个 #dailyAnswer」的 DOM 合法性
          （id 必须唯一，不能多条消息共用同一个 id）。

   数据结构（一档，已声明）：
     message = { id, role, kind, mode, at, el }
       - role: 'user' | 'assistant'
       - kind: 'text' | 'steps' | 'daily' | 'dialonly' | 'refuse' | 'triage' | 'notice'
       - mode: 该条消息所属模式，S8 靠它判断而不是靠隐藏视图
       - el:   气泡节点（不存文本 —— 内容唯一真相在 DOM，避免双份状态不同步）
   ========================================================= */
(function (global) {
  'use strict';

  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }

  var seq = 0;
  var messages = [];
  var flow = null;
  var scroller = null;

  function ensure() {
    if (flow) return flow;
    flow = document.getElementById('msgFlow');
    scroller = document.getElementById('msgScroll') || flow;
    return flow;
  }

  /* 滚到底部。只在**用户主动发起**新输入时调用（见 scrollToLatest 的注释），
     系统消息追加时不强制滚动，否则老人正读到第 3 步会被拽走。 */
  function scrollToEnd(smooth) {
    if (!ensure()) return;
    try {
      scroller.scrollTop = scroller.scrollHeight;
      if (smooth && scroller.scrollTo) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      }
    } catch (e) {
      /* 沙箱/旧浏览器没有 scrollTop 也无所谓，滚动失败不影响内容可见 */
    }
  }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* 追加一条用户消息（用户说过的话，原样显示，不改写） */
  function appendUser(text) {
    if (!ensure()) return null;
    var bubble = el('article', 'msg msg-user');
    var p = el('p', 'msg-text');
    p.textContent = String(text == null ? '' : text);
    bubble.appendChild(p);
    flow.appendChild(bubble);
    var m = {
      id: 'm' + ++seq,
      role: 'user',
      kind: 'text',
      mode: (global.APP_STATE && global.APP_STATE.mode) || 'daily',
      at: Date.now(),
      el: bubble,
    };
    messages.push(m);
    lg('debug', '消息追加（用户）', { id: m.id, mode: m.mode });
    return m;
  }

  /* 创建一条助手消息，并返回**其中的答案容器**。
     kind 只用于样式与统计，渲染仍由 render.js 完成（保持职责单一）。
     同一时刻只有一个容器持有 dailyAnswer/emgAnswer 这两个 id：
     先把旧容器的 id 摘掉，再给新容器。 */
  function answerHost(kind, mode) {
    if (!ensure()) return null;
    var id = mode === 'emergency' ? 'emgAnswer' : 'dailyAnswer';

    var bubble = el('article', 'msg msg-assistant');
    if (mode === 'emergency') bubble.className += ' is-emergency';
    if (kind) bubble.setAttribute('data-kind', kind);

    var host = el('div', 'answer-area');
    host.setAttribute('aria-live', mode === 'emergency' ? 'assertive' : 'polite');
    bubble.appendChild(host);
    flow.appendChild(bubble);

    /* 摘掉旧容器的 id（不是删除节点）。旧消息照常显示、照常可交互，
       只是不再是「最新的那条」。 */
    var prev = document.getElementById(id);
    if (prev && prev !== host && prev.removeAttribute) prev.removeAttribute('id');
    /* 新容器接管 id。注意顺序：必须先摘旧、再设新，
       否则 getElementById 会先拿到旧的那个，导致后面连摘带设互相打架。 */
    host.setAttribute('id', id);

    var m = {
      id: 'm' + ++seq,
      role: 'assistant',
      kind: kind || 'text',
      mode: mode || 'daily',
      at: Date.now(),
      el: bubble, // 气泡节点
      /* host = 答案容器。为什么单独记一份：
         ① 测试要读「这条消息的回答内容」，而气泡的 innerHTML 在真实 DOM 里
            包含容器包装，在沙箱 stub 里则不会随子节点更新 —— 有 host 就不用猜层级。
         ② 后续工具化时调度器要知道「往哪条消息追加」，靠 el 找子节点太脆。 */
      host: host,
    };
    messages.push(m);
    lg('debug', '消息追加（助手）', { id: m.id, kind: m.kind, mode: m.mode });
    return host;
  }

  /* 一条轻量提示消息（例如「当前离线」「语音不可用」）。
     独立成条，不塞进答案容器 —— 塞进去会被下一次渲染覆盖掉。 */
  function appendNotice(text, isWarn) {
    if (!ensure()) return null;
    var bubble = el('article', 'msg msg-notice' + (isWarn ? ' is-warn' : ''));
    var p = el('p', 'msg-text');
    p.textContent = String(text == null ? '' : text);
    bubble.appendChild(p);
    flow.appendChild(bubble);
    messages.push({
      id: 'm' + ++seq,
      role: 'assistant',
      kind: 'notice',
      mode: (global.APP_STATE && global.APP_STATE.mode) || 'daily',
      at: Date.now(),
      el: bubble,
    });
    return bubble;
  }

  /* 清空消息流（目前只在测试与「重新开始」时用） */
  function clear() {
    if (!ensure()) return;
    flow.innerHTML = '';
    messages.length = 0;
    seq = 0;
  }

  function stats() {
    var byMode = { daily: 0, emergency: 0 };
    for (var i = 0; i < messages.length; i++) byMode[messages[i].mode]++;
    return { total: messages.length, daily: byMode.daily, emergency: byMode.emergency };
  }

  if (!document.getElementById) {
    // 极端环境（无 DOM）下静默禁用，不影响其它模块加载
    lg('warn', '消息流不可用：无 document.getElementById');
  }

  global.CHAT = {
    appendUser: appendUser,
    answerHost: answerHost,
    appendNotice: appendNotice,
    scrollToEnd: scrollToEnd,
    clear: clear,
    messages: messages,
    stats: stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);

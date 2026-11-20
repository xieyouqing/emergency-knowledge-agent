/* =========================================================
   应急助手 · 跨模块共享状态
   依据：docs/10-代码质量门槛.md §6「横切模块必须可摘除」

   为什么单独一个文件（而不是留在 app.js）：
     state.mode / state.locked 被 render / speak / talk 三个模块读，
     若定义在最后加载的 app.js 里，前面三个模块在**加载期**读不到。
     函数体内运行时读没问题，但「加载期就能读」这条更不容易写出隐蔽 bug。

   为什么这些状态不能进 localStorage：
     docs/03 §2.6.5 R4 —— 会话记忆不落盘。老人可能把手机给别人用，
     持久化会把上一个人的紧急锁定状态带过来（S8 锁定本应刷新即解）。
   ========================================================= */
(function (global) {
  'use strict';

  var KB = global.KNOWLEDGE || { slots: [], entries: {}, data_date: '' };

  global.APP_STATE = {
    // 模式：'daily' | 'emergency'
    mode: 'daily',
    // S8：命中危险信号后锁定，不可回日常。刷新页面才解。
    locked: false,
    /* 会话上文（2026-11-20）：只存用户原话，不存模型结论。
       为什么只存原话：模型判定的 intent/scene 一旦进记忆，第一轮判错，
       后面每轮都在错的基础上继续，且没有机制能发现。
       为什么放这里而不落盘：与 locked 同理 —— 刷新即清，避免把上一个人的会话带给下一个人。
       条数与字数**不在这里裁剪**：上限唯一实现在代理 normalizeContext，
       两处各裁一次会让数字对不上。 */
    utterances: [],
    // 自动朗读静默位：用户按过「停止」= 明确表示不想听，本会话内不再自动读
    autoRead: { muted: false },
    // 语音输入的跨按钮状态（两个按钮共用一份，见 talk.js 注释）
    talk: { busy: false },
  };

  // 知识库与条目表：多个模块都要读，统一从这里取，避免各自 window.KNOWLEDGE
  global.APP_KB = {
    slots: KB.slots || [],
    entries: KB.entries || {},
    data_date: KB.data_date || '',
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================
   ESLint 配置（flat config，ESLint 9）
   职责: 只做「语义/错误类」静态检查，不做格式检查（格式交给 prettier）
   范围: app/ 下的手写代码；app/knowledge.js 为构建产物，豁免

   为什么 ecmaVersion 定 2022（不是 5）:
     现有代码的「写法」是 ES5（var + IIFE + 回调，无 let/const/async/=>），
     但它调用了 Promise / globalThis / Float32Array —— 运行时 API 属 ES2015+。
     定 5 会让 ESLint 认为这些全局对象不存在，报一堆假 no-undef。
     故语法级别放到 2022（只影响解析与内置全局，不强制改写现有 var 写法）。
     结论：ES5 是风格选择，不是兼容性保证；真正的兼容边界由用到的 API 决定。
   ========================================================= */
import globals from 'globals';

export default [
  {
    files: ['app/**/*.js'],
    ignores: ['app/knowledge.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // ---- 错误类：能明确判定对错 ----
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
      'no-implicit-globals': 'error',
      // null: 'ignore' —— `x == null` 是同时判 null 和 undefined 的惯用写法，
      // 改成 `=== null` 会让 undefined 漏判（行为变更）。其余一律要求 ===
      'eqeqeq': ['error', 'always', { null: 'ignore' }],

      // ---- 预留：现在全是 var，此规则暂不生效；将来写 let 时自动生效 ----
      'prefer-const': 'error',
    },
  },
];

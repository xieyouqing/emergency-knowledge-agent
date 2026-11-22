# 安伴 · 云服务器部署（Nginx + Node 代理）

> 目标：一个 HTTPS 域名同时提供静态页面和 `/judge` `/act` `/expand` `/asr` `/log`，评审期可直接打开。
> 前提：云服务器（1C2G 足够，无 GPU）、域名、HTTPS 证书。

## 0. 为什么必须同域

前端 `app/log.js` 会按当前页面推导 API base：

- `localhost:8899` → `http://127.0.0.1:8787`
- 其他域名/端口 → 当前 origin

所以只要 Nginx 在同一个域名下反代 API，前端**不需要改代码**，也不会产生 CORS。

## 1. 服务器准备

以 Ubuntu 22.04 为例：

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
# Node 20 LTS（示例，按官方源安装）
node -v   # 需要 >= 18
```

创建运行用户与目录：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin anban
sudo mkdir -p /opt/anban
sudo chown -R anban:anban /opt/anban
```

把仓库放到 `/opt/anban`（git clone 或 rsync），然后：

```bash
cd /opt/anban
cp .env.example .env
chmod 600 .env
# 编辑 .env：DEEPSEEK_API_KEY、LLM_PROXY_ORIGIN=https://你的域名
```

## 2. systemd 启动代理

```bash
sudo cp deploy/anban-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now anban-proxy
sudo systemctl status anban-proxy --no-pager
curl -s http://127.0.0.1:8787/health
```

代理默认只监听 `127.0.0.1`，公网只能经 Nginx 进来。

## 3. Nginx 同域反代

```bash
sudo cp deploy/nginx.anban.conf /etc/nginx/sites-available/anban
sudo ln -s /etc/nginx/sites-available/anban /etc/nginx/sites-enabled/anban
sudo nginx -t
sudo systemctl reload nginx
```

把配置里的 `anban.example.com` 换成你的域名、`/opt/anban/app` 换成实际路径，再申请证书：

```bash
sudo certbot --nginx -d 你的域名
```

## 4. 验收

```bash
# 静态页
curl -I https://你的域名/
# 代理
curl -s https://你的域名/health
curl -s -X POST https://你的域名/judge \
  -H 'Content-Type: application/json' \
  -d '{"text":"煤气漏了"}'
```

手机/桌面打开 `https://你的域名/`：

- 必须 HTTPS，否则麦克风权限拿不到
- 桌面 Chrome/Edge 才有 `speechSynthesis`；Android 浏览器没有，语音输出会退化为提示
- ASR 录音上传走 `/asr`，Nginx 已放开 16MB 请求体

## 5. 安全与额度

- `.env` 只放服务器，`chmod 600`，绝不进 Git
- `LLM_PROXY_ORIGIN=https://你的域名`，不要留 `*`
- 代理内置额度闸：`LLM_RATE_LIMIT`（默认 40/分/IP）、`LLM_DAILY_CAP`（默认 2000/天）
- 日志保留 7 天，位置 `/opt/anban/logs/`
- 防火墙只开 80/443；8787 不对公网开放

## 6. 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面能开，提问没反应 | API 路径没反代 / `/judge` 404 | 检查 Nginx location 与 `proxy_pass` |
| 麦克风点不动 | 不是 HTTPS | 用域名 + 证书；IP 证书浏览器不信任 |
| ASR 413 | 请求体超限 | `client_max_body_size 16m` |
| 评审期额度耗尽 | 被刷 / 配额小 | 调 `LLM_DAILY_CAP`，看 `/opt/anban/logs` |
| Android 没声音 | 浏览器无 `speechSynthesis` | 用桌面演示；Android 需 M3 原生 TTS |

## 7. 没有域名/备案时

- 香港/海外服务器：可跳过 ICP，直接域名 + Let's Encrypt；延迟略高
- 国内服务器：80/443 通常需要 ICP 备案；没有备案先用海外或临时隧道
- Cloudflare Tunnel：可快速拿 HTTPS 链接，但依赖你本地电脑常开，不适合评审期

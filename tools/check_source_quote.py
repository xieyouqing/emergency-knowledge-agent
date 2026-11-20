"""
来源逐字比对（机器强制比对层）
用法:
    python tools/check_source_quote.py                # 检查全部条目，只报告
    python tools/check_source_quote.py --write        # 检查并回写 review.agent_check
    python tools/check_source_quote.py --id gas_leak  # 只查某一条

判据（每条都能失败）:
  1. 抓到原文且 quote 逐字存在      -> pass
  2. 抓到原文但找不到 quote         -> fail
  3. 抓不到原文（网络/403/404/超时/需登录/无法解码） -> unverified
核心原则: unverified 不等于 pass。抓不到就如实标 unverified，转人工。

退出码:
  0 = 全部 pass
  1 = 存在 fail
  2 = 存在 unverified（无 fail 时）
"""
import argparse
import gzip
import json
import re
import ssl
import sys
import unicodedata
import urllib.error
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"

TIMEOUT = 25
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# 占位值：出现这些说明来源还没填，直接判 unverified
PLACEHOLDERS = {"待补", "待定", "", "TODO", "todo"}

# 默认严格校验证书；--insecure 时降级，并在 detail 里注明
INSECURE = False


def normalize(s: str) -> str:
    """归一化：全角转半角、去空白、去标点差异、统一引号。
    只做不影响字义的处理，避免把不同内容误判为相同。"""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\u3000", " ")
    # 中文标点统一（不同官网排版不一致，但字不能变）
    table = {
        "“": '"', "”": '"', "‘": "'", "’": "'",
        "、": "、", "，": ",", "。": ".", "；": ";", "：": ":",
    }
    for k, v in table.items():
        s = s.replace(k, v)
    # 去掉所有空白
    s = re.sub(r"\s+", "", s)
    return s


def fetch(url: str):
    """返回 (text, error_reason)。text 为 None 表示抓不到。"""
    if url.strip() in PLACEHOLDERS or not url.startswith("http"):
        return None, f"url 为占位或非法值: {url!r}"

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            # 明确要求不压缩；部分站点仍会返回 gzip，下面兜底解压
            "Accept-Encoding": "identity",
        },
    )
    ctx = None
    if INSECURE:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
            ctype = resp.headers.get("Content-Type", "")
            cenc = (resp.headers.get("Content-Encoding") or "").lower()
            raw = resp.read()
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}（{e.reason}）"
    except urllib.error.URLError as e:
        reason = e.reason
        if isinstance(reason, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(reason):
            return None, (
                "TLS 证书校验失败（可能经过代理/MITM）。"
                "如确认可信，可加 --insecure 重试（会在 detail 中注明未校验证书）"
            )
        return None, f"网络错误: {reason}"
    except Exception as e:
        return None, f"请求失败: {type(e).__name__}: {e}"

    # ---- 解压：服务器可能无视 identity 仍返回压缩内容 ----
    # 不解压会得到乱码，进而把合法来源误判为 fail（假 FAIL 比 unverified 更糟）
    try:
        if "gzip" in cenc or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        elif "deflate" in cenc:
            try:
                raw = zlib.decompress(raw)
            except zlib.error:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        elif "br" in cenc:
            return None, "服务器返回 br 压缩，当前环境无 brotli 解压能力，需人工核对"
    except Exception as e:
        return None, f"解压失败（Content-Encoding={cenc or '无'}）: {e}"

    if "pdf" in ctype.lower() or url.lower().endswith(".pdf"):
        return None, "PDF 无法直接逐字比对，需人工核对"

    # ---- 解码：只接受能确认的编码，不做 latin-1 兜底 ----
    # latin-1 对任何字节都能"成功"，会把乱码当正文，导致假 FAIL
    html = None
    for enc in ("utf-8", "gb18030"):
        try:
            html = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if html is None:
        head = raw[:16].hex()
        return None, f"页面编码无法确认（前 16 字节: {head}），需人工核对"

    # 去 script / style，去标签，反转义常见实体
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                 ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        text = text.replace(a, b)
    return text, None


def _check_quote(quote: str, url: str) -> dict:
    """判一条摘录：pass / fail / unverified。主源与 supplementary 共用同一套判据。"""
    text, err = fetch(url)
    if text is None:
        return {"result": "unverified", "reason": err}

    if len(normalize(quote)) < 10:
        return {"result": "fail", "reason": "quote 过短，视为概括"}

    if normalize(quote) in normalize(text):
        return {"result": "pass", "reason": "原文中逐字定位成功"}

    # 找不到时给一点诊断：取 quote 前 12 字再试一次，判断是整体不在还是部分不在
    head = normalize(quote)[:12]
    hint = "连首 12 字都找不到" if head not in normalize(text) else "首段能对上，后面不一致"
    return {"result": "fail", "reason": f"抓到原文但未找到该句（{hint}）"}


# v0.6（契约 §4.3.1）：取最差值。有 fail → fail；否则有 unverified → unverified；全 pass → pass
_RANK = {"pass": 0, "unverified": 1, "fail": 2}


def worst(results) -> str:
    return max(results, key=lambda r: _RANK[r]) if results else "unverified"


def check_entry(d) -> dict:
    sid = d.get("id", "?")
    src = d.get("source") or {}
    quote = str(src.get("quote", "")).strip()
    url = str(src.get("url", "")).strip()

    main = _check_quote(quote, url)

    # ---- v0.6: 主源 + supplementary 全部逐条比，取最差值 ----
    supp_out = []
    supp_src = src.get("supplementary")
    if isinstance(supp_src, list):
        for item in supp_src:
            item = item or {}
            r = _check_quote(
                str(item.get("quote", "")).strip(),
                str(item.get("url", "")).strip(),
            )
            supp_out.append({
                "url": str(item.get("url", "")).strip(),
                "result": r["result"],
                "detail": r["reason"],
            })

    overall = worst([main["result"]] + [s["result"] for s in supp_out])

    out = {
        "id": sid,
        "result": overall,
        "reason": main["reason"],
        "quote": quote[:40] + ("..." if len(quote) > 40 else ""),
    }
    if supp_out:
        n_ok = sum(1 for s in supp_out if s["result"] == "pass")
        out["reason"] = f"主源：{main['reason']}；补强 {n_ok}/{len(supp_out)} pass"
        out["supplementary"] = supp_out
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="回写 review.agent_check")
    ap.add_argument("--id", help="只检查指定 id")
    ap.add_argument(
        "--insecure",
        action="store_true",
        help="跳过 TLS 证书校验（代理/MITM 环境用；结果 detail 会注明）",
    )
    args = ap.parse_args()

    global INSECURE
    INSECURE = args.insecure

    files = sorted(
        f for f in KNOWLEDGE.glob("*.json")
        if f.name not in ("manifest.json", "index.json")
        and not f.name.startswith(("_", "."))
    )
    if not files:
        print("knowledge/ 下没有条目文件")
        return 2

    import datetime
    today = datetime.date.today().isoformat()

    results = []
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        if args.id and d.get("id") != args.id:
            continue
        r = check_entry(d)
        r["file"] = f.name
        results.append(r)

        if args.write:
            detail = r["reason"]
            if INSECURE:
                detail += "（本次未校验证书，仅确认字面一致）"
            review = d.setdefault("review", {})
            ac = {
                "source_quote": r["result"],
                "checked_at": today,
                "detail": detail,
            }
            # v0.6（契约 §4.3.1）：supplementary 逐条留结果，条数与 source.supplementary 对齐
            if r.get("supplementary"):
                ac["supplementary"] = [
                    {
                        "url": s["url"],
                        "result": s["result"],
                        "checked_at": today,
                        "detail": s["detail"] + ("（未校验证书）" if INSECURE else ""),
                    }
                    for s in r["supplementary"]
                ]
            review["agent_check"] = ac
            # 契约 §7.2：source_quote_verbatim 由机器判，人不得手填。
            # 因此这一项只能由本脚本回写，pass 才置 true，fail/unverified 一律置 false。
            checklist = review.setdefault("checklist", {})
            checklist["source_quote_verbatim"] = (r["result"] == "pass")
            f.write_text(
                json.dumps(d, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    icon = {"pass": "PASS", "fail": "FAIL", "unverified": "UNVER"}
    print("=" * 64)
    for r in results:
        print(f"[{icon[r['result']]:<6}] {r['id']}")
        print(f"         原因: {r['reason']}")
        print(f"         quote: {r.get('quote', '')}")
        for s in r.get("supplementary") or []:
            print(f"         [补强 {icon[s['result']]}] {s['detail']}  {s['url'][:56]}")
    print("=" * 64)

    n_pass = sum(1 for r in results if r["result"] == "pass")
    n_fail = sum(1 for r in results if r["result"] == "fail")
    n_unv = sum(1 for r in results if r["result"] == "unverified")
    print(f"合计 {len(results)} 条: pass={n_pass}  fail={n_fail}  unverified={n_unv}")
    if n_unv:
        print("注意: unverified 不等于 pass，需人工核对原文后再发布。")

    if n_fail:
        return 1
    if n_unv:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

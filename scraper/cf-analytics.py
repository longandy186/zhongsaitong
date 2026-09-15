#!/usr/bin/env python3
"""
中塞通站点流量分析 —— 通过 Cloudflare GraphQL Analytics API 拉取。

用法:
    CF_API_TOKEN=<token> python3 scraper/cf-analytics.py [--days 30] [--dim-days 7]

Token 权限要求（只读）:
    Zone → Analytics → Read   流量数据（必需）
    Zone → Zone → Read        按域名查 zone_id（必需）
    Account → Cloudflare Pages → Read   看 Pages 项目（可选）
    Account → Account Settings → Read   遍历 /accounts（可选）

Free 套餐限制:
    - httpRequestsAdaptiveGroups 单次查询时间窗口 ≤ 1 天 → 维度统计按天循环累加
    - clientRefererHost（来料域名）无权限，改用 userAgent 判断真人/爬虫

可选环境变量: CF_ZONE_NAME（默认 zhongsaitong.com）

依赖: 仅 Python 标准库（CI 环境可直接跑）
"""

import os
import sys
import json
import datetime
import collections
import urllib.request

# 自动加载 ~/.workbuddy/cloudflare.env（已显式设置的环境变量优先，不被覆盖）
_envf = os.path.expanduser("~/.workbuddy/cloudflare.env")
if os.path.exists(_envf):
    try:
        with open(_envf, encoding="utf-8") as _f:
            for _line in _f:
                _m = _line.strip()
                if not _m or _m.startswith("#") or "=" not in _m:
                    continue
                _k, _v = _m.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())
    except Exception:
        pass

TOKEN = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")
ZONE_NAME = os.environ.get("CF_ZONE_NAME", "zhongsaitong.com")
API = "https://api.cloudflare.com/client/v4"

if not TOKEN:
    print("❌ 缺少 CF_API_TOKEN", file=sys.stderr)
    sys.exit(1)

DAYS = 30
if "--days" in sys.argv:
    DAYS = int(sys.argv[sys.argv.index("--days") + 1])
if "--zone" in sys.argv:
    ZONE_NAME = sys.argv[sys.argv.index("--zone") + 1]

# 维度查询天数。Free 套餐的 httpRequestsAdaptiveGroups 单次查询窗口上限为 1 天，
# 因此「热门页面/国家/设备/UA/状态码」只能按天循环再本地累加，天数多则请求数线性增长。
DIM_DAYS = 7
if "--dim-days" in sys.argv:
    DIM_DAYS = int(sys.argv[sys.argv.index("--dim-days") + 1])


def http_json(url, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        method="POST" if body else "GET",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def rest(path):
    d = http_json(API + path)
    if not d.get("success"):
        raise RuntimeError(f"REST 失败 {path}: {d.get('errors')}")
    return d.get("result")


def gql(query):
    d = http_json(API + "/graphql", {"query": query})
    if d.get("errors"):
        raise RuntimeError(f"GraphQL: {d['errors']}")
    return (d.get("data") or {}).get("viewer", {}).get("zones", [])


def hr(t):
    print("\n" + "=" * 66)
    print(t)
    print("=" * 66)


def main():
    zones = rest(f"/zones?name={ZONE_NAME}")
    if not zones:
        print(f"❌ 找不到 zone {ZONE_NAME}（token 可能无此域名权限）", file=sys.stderr)
        sys.exit(1)
    z = zones[0]
    zid = z["id"]
    hr(f"站点 {ZONE_NAME}")
    print(f"zone_id: {zid}")
    print(f"套餐: {z.get('plan', {}).get('name')} | 状态: {z.get('status')} | 创建: {z.get('created_on', '')[:10]}")

    today = datetime.date.today()
    d_from = (today - datetime.timedelta(days=DAYS)).isoformat()
    d_to = today.isoformat()

    # ---------- 每日趋势 ----------
    hr(f"每日流量 {d_from} ~ {d_to}")
    try:
        q = (
            '{viewer{zones(filter:{zoneTag:"%s"}){'
            "httpRequests1dGroups(limit:%d,filter:{date_geq:\"%s\",date_leq:\"%s\"},orderBy:[date_ASC]){"
            "dimensions{date} sum{requests pageViews bytes threats} uniq{uniques}"
            "}}}}" % (zid, DAYS + 2, d_from, d_to)
        )
        rows = gql(q)
        groups = rows[0].get("httpRequests1dGroups", []) if rows else []
        if not groups:
            print("（无数据返回）")
        else:
            print(f"{'日期':<12}{'请求':>9}{'页面浏览':>10}{'独立访客':>10}{'流量MB':>10}   趋势")
            print("-" * 66)
            tr = tp = tu = tb = 0
            mx = max([g.get("sum", {}).get("requests", 0) for g in groups] + [1])
            for g in groups:
                s = g.get("sum", {})
                r, pv, b = s.get("requests", 0), s.get("pageViews", 0), s.get("bytes", 0)
                u = g.get("uniq", {}).get("uniques", 0)
                tr += r; tp += pv; tu += u; tb += b
                bar = "█" * max(0, round(r / mx * 22))
                print(f"{g['dimensions']['date']:<12}{r:>9,}{pv:>10,}{u:>10,}{b/1048576:>10.2f}   {bar}")
            print("-" * 66)
            print(f"{'合计':<12}{tr:>9,}{tp:>10,}{tu:>10,}{tb/1048576:>10.2f}")
            nz = sum(1 for g in groups if g.get("sum", {}).get("requests", 0) > 0)
            print(f"\n有流量天数: {nz}/{len(groups)}  |  日均请求: {tr/len(groups):,.0f}  |  日均访客: {tu/len(groups):,.0f}")
            recent = groups[-7:]
            r7 = sum(g.get("sum", {}).get("requests", 0) for g in recent)
            u7 = sum(g.get("uniq", {}).get("uniques", 0) for g in recent)
            prev = groups[-14:-7]
            if prev:
                p7 = sum(g.get("sum", {}).get("requests", 0) for g in prev)
                print(f"近7天: {r7:,} 请求 / {u7:,} 访客", end="")
                if p7:
                    print(f"   前7天: {p7:,} 请求   环比: {(r7-p7)/p7*100:+.1f}%")
                else:
                    print()
    except Exception as e:
        print(f"⚠️ 失败: {e}")

    # ---------- 维度 ----------
    # Free 套餐的限制：httpRequestsAdaptiveGroups 的时间窗口必须 ≤ 1 天
    # （报错 'cannot request a time range wider than 1d'），所以按天循环再本地累加。
    def dim(title, dim_field, limit, days=DIM_DAYS):
        hr(f"{title} (Top {limit}，近 {days} 天累计)")
        totals = collections.Counter()
        ok_days = 0
        for i in range(days):
            d = (today - datetime.timedelta(days=i)).isoformat()
            q = (
                '{viewer{zones(filter:{zoneTag:"%s"}){'
                "httpRequestsAdaptiveGroups(limit:400,"
                'filter:{datetime_geq:"%sT00:00:00Z",datetime_leq:"%sT23:59:59Z",'
                'requestSource:"eyeball"},orderBy:[count_DESC]){count dimensions{%s}}'
                "}}}" % (zid, d, d, dim_field)
            )
            try:
                rows = gql(q)
                gs = rows[0].get("httpRequestsAdaptiveGroups", []) if rows else []
                for g in gs:
                    totals[g["dimensions"].get(dim_field) or "(无/直接访问)"] += g["count"]
                ok_days += 1
            except Exception:
                continue  # 单天失败不影响整体
        if ok_days == 0:
            print(f"  ⚠️ 全部 {days} 天查询均失败（字段无权限或套餐不支持）")
            return
        if not totals:
            print("  （无数据）")
            return
        if ok_days < days:
            print(f"  （注：{days - ok_days}/{days} 天无数据）")
        for v, c in totals.most_common(limit):
            print(f"  {c:>8,}  {str(v)[:58]}")

    dim("热门页面", "clientRequestPath", 15)
    dim("请求域名", "clientRequestHTTPHost", 5)
    dim("访客国家", "clientCountryName", 12)
    dim("设备类型", "clientDeviceType", 5)
    dim("响应状态码", "edgeResponseStatus", 8)
    # 注：clientRefererHost（来料域名）在 Free 套餐下报 authz 无权限，改用 userAgent
    # 判断真实流量 vs 爬虫/扫描器，对「有没有真人看」这个判断更有用。
    dim("User-Agent", "userAgent", 15)
    # 爬虫与扫描器占比（按 UA 关键词粗判）
    hr("真人与机器流量（近 %d 天，按 UA 粗判）" % DIM_DAYS)
    try:
        bot_kw = ("bot", "crawl", "spider", "python", "curl", "wget", "go-http", "java",
                  "scrapy", "headless", "monitor", "scan", "probe", "zgrab", "masscan")
        human = bot = 0
        for i in range(DIM_DAYS):
            d = (today - datetime.timedelta(days=i)).isoformat()
            q = (
                '{viewer{zones(filter:{zoneTag:"%s"}){'
                "httpRequestsAdaptiveGroups(limit:400,"
                'filter:{datetime_geq:"%sT00:00:00Z",datetime_leq:"%sT23:59:59Z",'
                'requestSource:"eyeball"},orderBy:[count_DESC]){count dimensions{userAgent}}'
                "}}}" % (zid, d, d)
            )
            rows = gql(q)
            for g in (rows[0].get("httpRequestsAdaptiveGroups", []) if rows else []):
                ua = (g["dimensions"].get("userAgent") or "").lower()
                if any(k in ua for k in bot_kw):
                    bot += g["count"]
                else:
                    human += g["count"]
        total = human + bot
        if total:
            print(f"  疑似真人: {human:>8,}  ({human/total*100:.1f}%)")
            print(f"  疑似机器: {bot:>8,}  ({bot/total*100:.1f}%)")
            print("  （UA 粗判，仅供参考：部分正常工具/预取也会被计入机器）")
    except Exception as e:
        print(f"  ⚠️ 失败: {e}")

    # ---------- Pages ----------
    hr("Cloudflare Pages")
    try:
        accts = rest("/accounts")
        if not accts:
            print("  （token 无账户级权限，读不到 Pages 项目——需要 Account → Pages → Read）")
        hit = False
        for a in accts[:5]:
            try:
                for p in rest(f"/accounts/{a['id']}/pages/projects"):
                    if "zhongsai" in p["name"].lower():
                        hit = True
                        ld = p.get("latest_deployment") or {}
                        print(f"  项目: {p['name']}")
                        print(f"    子域: {p.get('subdomain')}")
                        print(f"    最近部署: {ld.get('created_on')} ({ld.get('environment')})")
                        print(f"    部署域名: {ld.get('url')}")
            except Exception:
                continue
        if not hit:
            print("  （未找到名称含 zhongsai 的 Pages 项目）")
    except Exception as e:
        print(f"  ⚠️ 无法读取: {e}")

    print()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
中塞通站点流量分析 —— 通过 Cloudflare GraphQL Analytics API 拉取。

用法:
    CF_API_TOKEN=<token> python3 scraper/cf-analytics.py [--days 30]

Token 权限要求: Zone → Analytics → Read（只读）
可选环境变量: CF_ZONE_NAME（默认 zhongsaitong.com）

依赖: 仅 Python 标准库（CI 环境可直接跑）
"""

import os
import sys
import json
import datetime
import urllib.request

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
    ts_geq = f"{d_from}T00:00:00Z"
    ts_leq = f"{d_to}T23:59:59Z"

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
    def dim(title, dim_field, limit):
        hr(f"{title} (Top {limit})")
        try:
            q = (
                '{viewer{zones(filter:{zoneTag:"%s"}){'
                "httpRequestsAdaptiveGroups(limit:%d,"
                'filter:{datetime_geq:"%s",datetime_leq:"%s",requestSource:"eyeball"},'
                "orderBy:[count_DESC]){count dimensions{%s}}"
                "}}}" % (zid, limit, ts_geq, ts_leq, dim_field)
            )
            rows = gql(q)
            gs = rows[0].get("httpRequestsAdaptiveGroups", []) if rows else []
            if not gs:
                print("（无数据）")
            for g in gs:
                v = g["dimensions"].get(dim_field) or "(直接访问/无)"
                print(f"  {g['count']:>8,}  {str(v)[:58]}")
        except Exception as e:
            print(f"  ⚠️ 失败: {e}")

    dim("热门页面", "clientRequestPath", 15)
    dim("流量来源", "refererHost", 12)
    dim("访客国家", "clientCountryName", 12)
    dim("设备类型", "clientDeviceType", 5)
    dim("响应状态码", "edgeResponseStatus", 8)

    # ---------- Pages ----------
    hr("Cloudflare Pages")
    try:
        for a in rest("/accounts")[:5]:
            try:
                for p in rest(f"/accounts/{a['id']}/pages/projects"):
                    if "zhongsai" in p["name"].lower():
                        ld = p.get("latest_deployment") or {}
                        print(f"  项目: {p['name']}")
                        print(f"    子域: {p.get('subdomain')}")
                        print(f"    最近部署: {ld.get('created_on')} ({ld.get('environment')})")
                        print(f"    部署域名: {ld.get('url')}")
            except Exception:
                continue
    except Exception as e:
        print(f"  ⚠️ 无法读取: {e}")

    print()


if __name__ == "__main__":
    main()

// functions/_middleware.js
// Cloudflare Pages Functions 中间件：在边缘拦掉漏洞扫描 / 目录爆破流量。
//
// 背景：2026-09 流量分析发现 ~89% 请求是机器流量，其中法国来源的 `curl/8.7.1`
// 在 14 天内打了 8,339 次系统性漏洞扫描（/drush/drush.tmp、/wp-backup.sql、
// /lms/.env.dev、/home/ec2-user/aws-credentials.json 等 495 个路径）。
// 静态站无 PHP / 无后端，扫描必然落空，但白耗带宽并污染统计。
//
// 判定策略（保守，宁可漏拦不可误伤）：
//   ① 路径特征命中 → 拦（.php/.env/.sql/.git 等，本站不存在这些路径）
//   ② 攻击工具 UA 命中 → 拦（nikto/sqlmap/nmap 等）
//   ③ 裸命令行 UA（curl/wget/python-requests…）→ 仅当访问的不是首页/API 时拦
// 任何异常一律放行（fail-open），绝不让中间件本身把站点搞挂。
//
// 想临时关掉：把下面 ENABLED 改成 false，或直接删除本文件 + public/_routes.json。

const ENABLED = true;

// ① 路径特征：本站不可能存在的路径
const SCANNER_PATH = [
  // 任意脚本后缀 —— 本站是纯静态站，一个都不该有
  /\.(php|php[0-9]|phtml|phar|asp|aspx|ashx|asmx|jsp|jspx|do|cgi|pl|py|rb)$/i,
  // 配置 / 备份 / 密钥文件
  /\.(env|env\.[a-z0-9]+|sql|sql\.gz|dump|bak|backup|old|orig|save|swp|swo|log|ini|conf|cfg|yml|yaml|tfstate|pem|ppk|htaccess|htpasswd)$/i,
  /(^|\/)\.(git|svn|hg|bzr|aws|ssh|docker|idea|vscode|npmrc|htpasswd)(\/|$)/i,
  // 建站程序
  /^\/(wp|wp-admin|wp-content|wp-includes|wp-json|wp-login|wp-config|wp-cron|wp-backup|wordpress|xmlrpc\.php|wlwmanifest\.xml)(\/|$|\.)/i,
  /^\/(administrator|components\/com_|modules\/mod_|templates\/|language\/[a-z]{2}-[A-Z]{2}\.)/i,
  /^\/(drush|vendor|laravel|thinkphp|yii|symfony|drupal|joomla|typo3|magento|prestashop|opencart|moodle|lms)\b/i,
  // 数据库 / 中间件管理面板
  /^\/(phpmyadmin|pma|adminer|myadmin|mysql|sqlweb|dbadmin|sqladmin|webadmin|redis|memcached)\b/i,
  /^\/(actuator|jolokia|solr|jenkins|nacos|druid|swagger-ui|api-docs|v2\/api-docs|graphql|telescope|_ignition)\b/i,
  // 云主机 / 系统路径探针（如 /home/ec2-user/aws-credentials.json）
  /^\/(home|root|Users|tmp|var|etc|usr|opt|proc|boot|srv)\//i,
  /^\/(aws-credentials|credentials\.json|id_rsa|id_dsa|\.bash_history|docker-compose|Dockerfile)\b/i,
  // 邮件与目录爆破
  /^\/(owa|autodiscover|exchange|ecp|rpc|cgi-bin)\b/i,
  /^\/(fckeditor|ckfinder|elfinder|tinymce|upload|uploads\/(file|shell|cmd))/i,
  /^\/(shell|cmd|eval|test|info|debug|temp|xyz|1|2|a|aa)\.(php|txt|jsp)$/i,
];

// ② 攻击工具 UA
const ATTACK_UA =
  /(nikto|sqlmap|nmap|masscan|zmap|zgrab|acunetix|netsparker|wpscan|gobuster|dirbuster|dirb|nuclei|w3af|openvas|qualys|nexpose|burpsuite|hydra|xray|whatweb|arachni|commix|havij|morfeus|internetmeasurement|censysinspect|netcraftsurveyagent|expanse|palo alto networks|rapid7|shodan)/i;

// ③ 裸命令行 / 脚本 UA（可能是自家监控，所以只在非首页、非 API 时拦）
const BARE_TOOL_UA =
  /^(curl|wget|python-requests|python-urllib|go-http-client|okhttp|libwww-perl|java|axios|node-fetch|guzzlehttp|httpclient)/i;

function blocked(reason) {
  return new Response('403 Forbidden', {
    status: 403,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-zst-block': reason,
    },
  });
}

export async function onRequest(context) {
  if (!ENABLED) return context.next();

  try {
    const { request } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const ua = request.headers.get('user-agent') || '';

    // ① 路径特征
    for (const re of SCANNER_PATH) {
      if (re.test(path)) return blocked('path');
    }

    // ② 攻击工具
    if (ATTACK_UA.test(ua)) return blocked('attack-ua');

    // ③ 裸工具 UA：放行首页与 API（保留自家监控 / 审核回调的可能）
    if (BARE_TOOL_UA.test(ua.trim()) && path !== '/' && !path.startsWith('/api/')) {
      return blocked('bare-ua');
    }

    return context.next();
  } catch (err) {
    // fail-open：中间件出错一律放行，不能因为拦截逻辑把站点搞挂
    return context.next();
  }
}

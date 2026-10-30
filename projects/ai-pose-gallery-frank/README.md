# ai-pose-gallery-frank

> Frank 侧留存副本：中文版 AI 姿势参考图库（上游 `anhao/ai-pose-gallery-zh`）的**代码 + 中文数据镜像**，零依赖静态画廊。图片不入库，本地一条脚本自取。

## 为什么有这个副本

上游 2026-10-27 建仓、三天到 3.2k★，站点、域名与素材授权都可能随时调整。本目录固定到上游 commit `072a3690`，供长期回溯与本地私有素材检索。目录名带 `-frank` 后缀，标明这是 **Frank 侧留存副本**，不是上游官方仓库。

## 这是什么

| 项 | 内容 |
|---|---|
| 上游内容 | AI 人体姿势参考图库中文版：**288 组 / 1439 张**，原站日文元数据全量汉化 |
| 前端 | 单页零依赖（`index.html`），体系页签 / 分类 / 5 视角筛选、关键词搜索、分组与逐张双模式、灯箱原图下载、键盘与触屏导航 |
| 本副本范围 | `index.html` + `data/`（中文数据）+ `scripts/`（下载 / 汉化 / 校验 / 构建）+ `docs/` 预览图 + 站点配置（`_headers`、`robots.txt`、`sitemap.xml`、`og-cover.jpg`） |
| **不含** | `img/`（1439 张 PNG 原图，637 MB）与 `thumbs/`（1439 张 JPG 缩略图，22 MB） |

## 为什么不含图片

上游 LICENSE 只把 **MIT 授予源码**（`index.html`、`scripts/`、`_headers` 等）；`img/`、`thumbs/` 以及 `data/pose.json`、`data/meta.json` 的著作权属原作者 **ギア（@giaaibusi）**，明确 **不适用 MIT、不得商用、权利人提出异议即移除**。

本仓是公开仓且默认 MIT，把 637 MB 第三方图片整包推上来，等于用我们的协议去覆盖别人的未授权素材，因此**不落地**。权利边界与联系方式见 [NOTICE.md](./NOTICE.md)。

## 本地起私有素材库（含图片）

```bash
cd projects/ai-pose-gallery-frank
python3 scripts/download.py        # 从原站拉 thumbs + img（48 线程 / 断点续传 / 可反复执行）
python3 -m http.server 8000        # 浏览器打开 http://127.0.0.1:8000
```

图片落在 `img/`、`thumbs/`，这两处已在 `.gitignore` 里排除，**不会被误提交**。

- 并发可调：`WORKERS=64 python3 scripts/download.py`
- 完整性校验：`python3 scripts/verify.py`（存在性 / 大小 / 图片头）
- 只要页面不要图也能开：`python3 -m http.server 8000`，图位为空，但检索、筛选、分组逻辑仍可验证

## 协议

| 对象 | 协议 |
|---|---|
| `index.html`、`scripts/` 代码 | 上游 **MIT**，见 [LICENSE](./LICENSE)（该协议**不覆盖**图片与原始数据） |
| `img/`、`thumbs/`、`data/pose.json`、`data/meta.json` | 原作者所有，**不在本仓**、不得商用 |
| 本副本新增文档（`README.md` / `NOTICE.md` / `UPSTREAM.md` / `PROJECT-LOG.md`） | MIT |

## 内容提示

上游图库含成人向姿势参考，部分分类名涉及性行为术语，定位为艺术创作与动作参考。未成年人请勿使用。本仓只镜像代码与中文元数据，**不含任何图片**。

## 上游与改动

上游地址、固定 commit、取件校验方法与**本副本相对上游的两处改动**，见 [UPSTREAM.md](./UPSTREAM.md)。

上游原始 README（脚本用法、数据结构、Cloudflare Pages 部署步骤）原样保留在 [README.upstream.md](./README.upstream.md)。

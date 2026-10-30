# UPSTREAM — 上游锚点与取件校验

| 项 | 值 |
|---|---|
| 上游仓库 | <https://github.com/anhao/ai-pose-gallery-zh> |
| 上游在线站 | <https://ai-pose-gallery.anhao.app/> |
| 原始站点（图片与数据来源） | <https://ai-pose-gallery.pages.dev/> · 原作者 ギア（[@giaaibusi](https://x.com/giaaibusi)） |
| 固定 commit | `072a3690af6e7e0011abbe0fa1ccc08939fbb47d`（`main`，2026-10-27，"chore: 接入站点访问统计脚本"） |
| 首次镜像 | 2026-10-30 |
| 取件范围 | 上游 `2899` 个 blob 中，排除 `img/`、`thumbs/` 后的 **21 件 / 1,546,934 B** |
| 完整性自证 | 逐件用 **git blob sha1**（`sha1("blob <len>\0" + content)`）与上游 tree 比对，**21/21 命中，0 失配** |
| 上游仓库体量 | 2899 文件 / 661.0 MB（PNG 原图 1439 件 637.57 MB + JPG 缩略图 1442 件 22.31 MB） |

## 本副本相对上游的改动（共 3 处）

1. **`index.html`：删除 1 行** —
   原第 920 行 `<script defer src="https://u.authbox.cn/script.js" data-website-id="cde8a23b-…"></script>`。
   理由：该 `data-website-id` 属于上游站点的统计账户，副本原样保留会把本地访问计入上游后台，且等于在我们仓里引入一个与项目无关的第三方脚本。
   影响：**零功能影响**（纯埋点）。文件 58,619 B → 58,447 B。
2. **`.gitignore`：追加 3 行** — `img/`、`thumbs/` 与说明注释。
   理由：图片按 `NOTICE.md` 不入库；上游 `.gitignore` 未排除它们（上游是把图提交进仓库的），若不改，跑过 `download.py` 后 2878 个图片文件会全部显示为未跟踪，极易误提交。

3. **`.gitignore` 与 `.assetsignore`：各删除 1 行「内部协作工具目录」** —
   上游把某个内部协作工具的目录写进了忽略清单；对本副本是空操作，但公仓不该出现内部工具名（脱敏硬门）。
   被删的那一行具体是什么，记在本地管理面，不在本仓复述。

> 除上述 **3 个文件**外，其余 **18 件与上游逐字节一致**（可用 `git blob sha1` 逐件复核）。

## 如何重新取件 / 更新到新 commit

```bash
# 1) 取上游指定 commit 的树清单
curl -s "https://api.github.com/repos/anhao/ai-pose-gallery-zh/git/trees/<commit>?recursive=1"

# 2) 逐件按 blob sha 取（打包下载会连 637 MB 图片一起拉，勿用 tarball）
curl -s "https://api.github.com/repos/anhao/ai-pose-gallery-zh/git/blobs/<blob_sha>"   # base64

# 3) 落盘后用 git blob sha1 复核，再与本文件比对差异
```

⚠️ 注意两点环境坑：
- `git clone` 后再 `git sparse-checkout set '!/img/'`，在 Git for Windows（MSYS）下 `!/img/` 会被改写成 `C:/Program Files/Git/img/`，**排除失效**，结果照样拉 637 MB。取件请走 blob API 逐件取。
- `raw.githubusercontent.com` 在部分大陆网络下不可达，走 `api.github.com` 稳定。

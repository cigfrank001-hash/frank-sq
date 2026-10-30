# NOTICE — 权利归属与许可边界

本目录是上游 <https://github.com/anhao/ai-pose-gallery-zh> 的**代码与中文数据镜像**，
固定于 commit `072a3690af6e7e0011abbe0fa1ccc08939fbb47d`（2026-10-27）。

## 一、许可分层（照抄上游 LICENSE 的边界，未作放宽）

| 对象 | 权利人 | 许可 |
|---|---|---|
| `index.html`、`scripts/*.py`、`scripts/build.sh`、`_headers` 等源码与构建文件 | Anhao（上游维护者） | **MIT**（见 `LICENSE`） |
| `img/` 全部原图、`thumbs/` 全部缩略图 | **ギア（@giaaibusi）**，原站 <https://ai-pose-gallery.pages.dev/> | **不适用 MIT**；未授权再分发；**不得商用**；权利人提出异议即移除 |
| `data/pose.json`、`data/meta.json`（原始日文数据） | 同上 | 同上 |
| `data/pose-zh.json`、`data/meta-zh.json`、`data/translations.csv`（汉化派生数据） | Anhao（译文） | 随源码 MIT；**其内容仍源自上述原始数据**，商用前请自行确权 |
| 本副本新增的说明文档 | Frank 侧 | MIT |

## 二、本副本做了什么、没做什么

- **没有**收录任何图片（`img/`、`thumbs/` 均不入库，且在 `.gitignore` 中排除）。
- **没有**主张对图片或原始数据的任何权利，也**不构成**对原作品的商业使用授权。
- **没有**改写上游的 MIT 声明；`LICENSE` 原样保留。
- **移除了**上游 `index.html` 末尾的一行站点统计脚本（`https://u.authbox.cn/script.js`，携带上游站点自己的 `data-website-id`）——那是上游站点的埋点，不应在我们这边执行。详见 `UPSTREAM.md`。

## 三、权利人异议通道

图片与原始数据如权利人认为本副本或上游仓库侵犯权益，请在本仓库提 Issue，我们会在确认后立即移除相关派生数据。
上游仓库本身的异议请直接提给上游：<https://github.com/anhao/ai-pose-gallery-zh/issues>。

## 四、使用建议

- 个人研究、动作参考、前端技术学习：可用。
- 商业项目（含对外产品配图、素材包分发、模型训练集打包）：**不要直接用**，先向原作者取得授权。

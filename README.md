# course-accuracy-calculator

osu!mania 段位成绩计算器：输入谱面（.osu）与回放（.osr），输出五种判定体系下的准确率、判定细值、分段成绩与过段判定。纯浏览器本地运行，双击 index.html 即用，全程无网络请求。

## 判定体系

| 体系 | acc 计权 | LN 结算 | 窗口 |
|---|---|---|---|
| stb（stable / ScoreV1） | MAX 计 300 | 头尾合并单判 | MAX ±16.5 固定，其余 64−3OD 系 |
| stb + ScoreV2（MAX=305） | MAX 计 305 | 头尾独立判定 | 同上，MAX 分段线性 |
| lzr（lazer，MAX=320） | MAX 计 320 | 头尾独立、尾窗 ×1.5 | floor(分段线性×倍率)+0.5 |
| Malody C判（电脑判） | BEST=1 / COOL=0.75 / GOOD=0.4 | 头尾各计一次 | ±36/76/110/150 ms |
| Malody B判（手机判） | 同上 | 同上 | ±44/84/118/150 ms |

## 段位包

标题匹配后按社区标准判定（全曲整体口径）：

| 包 | 门槛 |
|---|---|
| Dan ~ REFORM ~ | stb ≥96%（intro 95%） |
| 4K LN Dan Courses v2（underjoy） | ScoreV2 ≥97%（2023-01-26 起） |
| Dan: Signicial's | stb ≥96%（进阶/精通分档见 TASK.md） |
| Malody 4K Regular Dans v3 | C判 ≥95% 与 B判 ≥95% 分别判定 |
| Dan: Celestial | 分谱制，每谱 stb ≥97% / lzr ≥96% |

合谱（马拉松）自动按空隙切四段，输出每段单曲 acc 与累计 sumup。非段位谱输出五体系计算值。降难（NF/EZ/HT/DC）、不可控（Random）、自动（Auto）类 mod 会禁用过段判定，各体系计算值照常输出。

## 使用

浏览器打开 `index.html`（file:// 直接可用），拖入或选择 .osu 与 .osr 两份文件。页面输出：

- MD5 配对校验、mod 明细（含 .osr 尾块中的自定义变速倍率）、暂停记录
- 五体系整体 acc 与判定细值（各档窗口 ±ms 与计数）
- lzr 对账表（重判计数 vs 回放内嵌计数）
- 段位判定与分段表

## 开发

```
node tools/build-ui.mjs    # src/ 模块内联生成 index.html（改 src 后须重跑）
node test/harness.mjs      # 八份真实回放夹具：lzr 重判计数 vs 内嵌计数对账
node test/smoke-ui.mjs     # bundle 冒烟：无 DOM 执行/双实现一致性/计数抽查/DOM id
```

`references/` 为本地对账夹具（含个人回放，不入库，见 `.gitignore`）。设计文档与全部规格决策见 [TASK.md](TASK.md)。

## 机制要点

- 回放解压后为逗号分隔文本帧；mania 按键位在 x 字段；帧时间为谱面 track 时间
- lazer 回放在 onlineId 后追加 `LegacyReplaySoloScoreInfo` 尾块（ppy/osu `LegacyScoreEncoder`）：mods 含设置（自定义变速倍率在此）、判定统计、暂停时间戳
- notelock（`OrderedHitPolicy`：可击范围被下一 note 开始时间截断）与 LN 尾判（±1.5×miss 内首释放、偏移 /1.5 判定、断裂封顶 MEH）按 ppy/osu 源码实现
- 窗口随变速倍率缩放（倍率优先取尾块，缺省 DC/HT=0.75、DT/NC=1.5）；Mirror 自动镜像轨道后对齐

## 参考文档

**各段位过段说明**

Dan ~ REFORM ~ by DDMYTHICAL
https://sites.google.com/view/danreform/home

Malody 4K段位考核（v3）
https://www.bilibili.com/opus/628463670870260863

4K LN Dan Courses v2 by _underjoy
- https://osu.ppy.sh/beatmapsets/891143#mania/1862816
- https://osu.ppy.sh/beatmapsets/891152#mania/1862834
- https://osu.ppy.sh/beatmapsets/891157#mania/1862841
- https://osu.ppy.sh/beatmapsets/891164#mania/1862876

Dan: Signicial's Courses by signupredir111
https://osu.ppy.sh/community/forums/topics/2135031

Dan: Celestial by Transcendence
https://osu.ppy.sh/community/forums/topics/1803173

一些其他段位在此不做列出。

**关于判定的说明**

《4K下落式音游齐民要术》by 幽幽子的饲养员
https://www.bilibili.com/opus/1140164949285273625

## 致谢与许可

- [ppy/osu](https://github.com/ppy/osu) (MIT)
- [LZMA-js](https://github.com/nmrugg/LZMA-js) (MIT，© 2015 Nathan Rugg)：`src/vendor/lzmaD.js`
- [uzxn/acc](https://github.com/uzxn/acc) （物量表）
- [Source Han Sans](https://github.com/adobe-fonts/source-han-sans) 思源黑体（SIL OFL 1.1）：`resources/SourceHanSansLite.ttf` 为其精简子集版，全文见 `resources/SourceHanSansLite-OFL.txt`
- [LXGW Neo XiHei](https://github.com/lxgw/LxgwNeoXiHei) 霞鹜新晰黑（IPA Font License v1.0）：`resources/LXGWNeoXiHeiPlus.ttf` 备用字体，全文见 `resources/LXGWNeoXiHeiPlus-LICENSE.md`

本项目以 [MIT](LICENSE) 许可发布。

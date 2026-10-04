# course-accuracy-calculator — 任务描述

> 状态：规格冻结于 2026-10-03，待实现。
> 输入 osu!mania 谱面（.osu）与回放（.osr），按五种判定体系重算准确率，按段位包规则输出整体/分段成绩与过段判定。

## 1. 核心机制

.osr 回放不含判定结果，只有按键时间线（LZMA 压缩流；mania 帧的键状态按位掩码编码，bit k = 第 k 轨，按下/松键由位变化得出）。因此本工具是**重判器**，不是分类器：

1. 解析谱面 note（时间、轨道、LN 起止）；
2. 对齐回放按键事件，恢复每次击打/释放的真实 timing offset；
3. 同一份 offset 分别送入五种判定体系结算（LN 语义各不相同，见下）；
4. 同列吞键 / notelock 按 osu!stable 行为建模；hit error 四舍五入、判定窗口上限截断（边界 ±0.5ms）。

**校准锚点（硬验收）**：与回放所属客户端一致的引擎，其重判计数必须与 .osr 内嵌计数一致（MAX=countGeki、200=countKatu、miss=countMiss；geki=MAX 已实证 3501）。回放客户端判别：**游戏版本号 ≥30000000 = lazer 导出**（stable 为日期式如 20250116；Mirror mod 为 lazer 独有，亦为佐证）。references 七对全部为 lazer 导出——这批夹具的锚点引擎是 **lzr**（判定数结构 = rice+2×LN，7/7 实证）；stb 引擎（LN 合并单判，计数 = rice+LN）待补 stable 导出回放再对账。不一致即实现有 bug。

**mods 与对齐**：osr 的 mods 位掩码含 DT(1<<6)、HT(1<<8，Daycore 同位)、NC=DT位+1<<9、Mirror(1<<30)。回放帧时间为谱面 track 时间（与倍率无关，实证：对齐恒等映射最优）。Mirror 需镜像谱面轨道后对齐。

**lazer 尾块（官方回放设计，2026-10-03 解码）**：version ≥ 30000001 的 .osr 在 onlineId 之后追加"4 字节长度前缀 + LZMA(LegacyReplaySoloScoreInfo JSON)"（ppy/osu `LegacyScoreEncoder`/`LegacyScoreDecoder`）。含：mods（APIMod 数组**带 settings——变速 mod 的自定义倍率在此**，位掩码只有 mod 名）、statistics（官方判定计数）、maximum_statistics、client_version、rank、user_id、pauses（暂停时间戳数组——Malody v3 禁暂停规则日后可查）、online_id。**倍率解析优先级：尾块 mods（settings.speed_change，缺省=该 mod 默认值：DC/HT=0.75、DT/NC=1.5）＞ 位掩码默认（适用无尾块的 stable 回放）＞ 1**。实证三例：Reg-4 DT=1.05；Celestial 倍率 0.7 且位掩码 0；**Reg-10 DC（Daycore，不映射 legacy 位所以位掩码 0，默认 0.75）**。尾块中位掩码未覆盖的 mod（DC/DA 等）合并进页面 mod 芯片与过段禁用闸。

**窗口与倍率（track 时间）**：三套 osu 引擎窗口 ×rate（lazer 源码 speedMultiplier；stable 墙钟固定窗折算 track 亦为 ×rate）；Malody 用基础值（文章"1.5×速→窗×2/3"为墙钟口径，track 下抵消）。0.7 倍率的 Celestial 用 ×0.7 窗后六项计数与内嵌**完全相等**（此前的"密集谱 ×0.7 异常"即此因）。

**mod 展示与过段禁用闸**（2026-10-03 需求）：页面对已用 mod 逐个芯片标注（中文名+分类：降难/变速/镜像/自动/不可控，变速芯片附尾块实测倍率）；命中降难（NF/EZ/HT含DC）、不可控（Random）、自动（Auto）类 mod 时**不提供过段判定**（替换为禁用说明），各体系 acc 与细值照常输出；DT/NC、Mirror、HD/HR/PF/FL/FI 等不阻断。mod 表仅收录 osu!mania 实际存在的 mod（TD/Relax/SpunOut/Autopilot 已剪除）。局限：lazer 的 Difficulty Adjustment（DA）自定义 HP/OD 无独立位掩码，若未以 EZ 位导出则不可检测。

**文件配对与谱面属性**：osr 头部含 beatmapMD5，与配对 .osu 文件字节 MD5 相等（references 七对全部一致）——用于防配错对。osr 不含 OD/标题/键数等谱面属性，OD 与段位匹配一律取自 .osu。

## 2. 五种判定体系

| 体系 | 判定窗（ms） | LN 结算 | acc 公式 |
|---|---|---|---|
| **stb**（stable / ScoreV1） | MAX ±16 固定；300=64−3OD；200=97−3OD；100=127−3OD；50=151−3OD；miss=188−3OD。DT/HT 不缩放窗口。实际窗口较公式宽 0.5ms（hit error 四舍五入、上限截断） | LN = **头+尾偏移合并单判定**（两偏移求和后对双倍阈值，等价于均值对普通窗口；2026-10-03 用户定版：stable 从无尾判）：PERFECT 需头≤1.2×MAX上限且合计≤2.4×；GREAT 1.1/2.2；GOOD、OK 1/2；其余非 miss 为 MEH；中途松手最高 MEH；晚于 MEH 释放=miss。N = rice + LN | 分母 300N；MAX 计 300（与 300 同权） |
| **stb (scorev2)**（stable 的 SV2 mod） | 同 stb，但 MAX 窗随 OD：OD≤5 → 22.4−0.6OD；OD≥5 → 24.9−1.1OD（OD8≈16.1） | 头尾独立判定，尾仅看释放误差、尾窗 ×1.5；中途松手尾封顶 MEH | 同 stb，但 MAX 权重=305（分子分母同步） |
| **lzr**（lazer） | SV2 式（PERFECT 随 OD 等；开工时对 ppy/osu 源码 `ManiaHitWindows.cs` 核对） | 头尾独立双判定（references 七对实证：lazer 导出 osr 内嵌判定数 = rice+2×LN，7/7）；尾窗 ×1.5（文章注：松慢比松早宽 1.5 倍——不对称，实现时以客户端行为校准）；hold break 尾封顶 MEH 且不占额外判定 | (320·MAX+300·300+200·200+100·100+50·50) / 320N，N 含 LN 尾 |
| **Malody C判**（电脑判，段位标准） | BEST ±44 / COOL ±84 / GOOD ±129 / MISS ±171+（固定，不随谱面；2026-10-05 定版：用户提供的 Malody V 实测表 Standard 组 C-NORMAL 列；萌百 A-E 表**整表弃用**——其 B/C/D 列实为本表 C/D/E 列错标） | 头尾各计一次判定（尾窗暂按同表，待实机校准） | (BEST + 0.75·COOL + 0.4·GOOD) / N |
| **Malody B判**（手机判，段位标准） | BEST ±54 / COOL ±94 / GOOD ±139 / MISS ±181+（同表 Standard 组 B-EASY+ 列） | 同上 | 同上 |

OD 一律取自 .osu 文件的 OverallDifficulty 字段（各段位包不预设 OD）；Malody 两档为固定窗口，与谱面无关。Malody 判定窗缩放（加速 mod，文章表 2-6）：1.5×速/RUSH → 窗 ×2/3，1.2×速/DASH → 窗 ×5/6——osu 回放重判不直接用到，备查。~~Malody A-E 表经文章表 2-4 复核与萌百完全一致~~（2026-10-05 弃用：萌百表与文章表 2-4 同源错位，其 B/C/D 列实为实测表 C/D/E 列，两处交叉复核不构成验证；判定窗以用户提供的 Malody V 实测表为唯一来源）。文章图 2-74 有"PC B判"字样（v2 时代口径）与本任务 C=电脑/B=手机 的映射相抵，按用户裁定执行，如需终验以实机判定设置截图为准。

来源：osu wiki（Judgement/osu!mania、Accuracy、Hit_object/Hold_note，2026-10-03 抓取）；Malody acc 公式经真实成绩实测严格成立（知乎 p/704902100）。

## 3. 过段口径（2026-10-03 定版）

**全曲整体过段**：合谱马拉松用最终累计 acc（sumup 末值）对阈值；各段单曲 acc 照常输出，仅作诊断。Celestial 为分谱制，每谱即"全曲"。

## 4. 段位包与 Course 分类（2026-10-03 扩版）

### 已知包（门槛挂指定体系，整体口径）

| 展示名 | 标题/作图者匹配（大小写不敏感） | 结构 | 门槛 | 备注 |
|---|---|---|---|---|
| **osu!mania 4K Dan ~ REFORM (DDMythical)** | "dan ~ reform" 且无 "final" | 合谱/单曲 | stb ≥96%（intro 段 95%） | 含他人托管的 DDMythical 谱（如 "1st Pack (Thaumiel)"，发布者≠作者，仍归本包——2026-10-03 用户定版） |
| **osu!mania 4K Dan ~ REFORM ~ FINAL (Thaumiel)** | "dan ~ reform"+"final"，非 Ext. | 合谱四曲（实测 ETA 难度含曲内 11s break） | 沿用 REFORM：stb ≥96%（2026-10-03 用户定版） | |
| **osu!mania 4K Dan ~ REFORM ~ FINAL (Ext.) (CloverWisp)** | 同上，且标题含 "(ext" 或作图者含 "cloverwisp"（双路径） | 合谱 | 沿用 REFORM：stb ≥96% | 区分在 mapper（用户口径） |
| **osu!mania 4K Dan: Signicial's Courses** | "dan: signicial" | 合谱；主段 4 曲、入门段 3 曲 | stb：合格 ≥96 / 进阶 ≥97 / 精通按段（初阶 99.80、中阶 99.50、高阶 99.00、最终 98.00、追加 97.00）；入门段：土/水/火/风 ≥95、灵 ≥96 | 源：论坛帖 2226317 |
| **osu!mania 4K LN Dan Courses v2** | "4k ln dan courses"（不要求 v2 后缀——"…Courses - EXTRA -" 同门四曲谱，2026-10-03 用户定版弱化；xfpsb "LN Advanced Dan Course Maps" 不含该子串不受影响） | 合谱四曲，LN 密集；语料 64 张中 60 张单曲 | **sv2 ≥97%**（ScoreV2 口径，2023-01-26 起） | sv2 头尾双判对应现代客户端 LN 计数 |
| **Malody 4K Dan v3** | "malody 4k regular dan"（覆盖 Dan/Dans 两种标题） | 合谱 "Dans v3 (Part.N)" 四曲；单曲 "Dan v3-\<词\>"（马拉松=标题不含 speed/stream/tech/jack）；禁暂停，除 Const/Flip 外禁 Mod | C判 ≥95% 与 B判 ≥95% 分别判定（Extra 段 96% 不在范围） | 常规段 0~10dan；源：cv15316319 |
| **Dan: Celestial** | "dan: celestial" | **全单曲包**（每谱一课，7 tier × 35 course，用户 2026-10-03 确认无合谱） | 每谱：stb ≥97 与 lzr ≥96 分别判定 | **难度取自标题**（-Ascension I- → Ascension I），非 [Version]；禁暂停/EZ/HT/NF/RAND；源：论坛帖 1803173 |

### 未知谱分类（同日定版）

段位包处的取值全集：上表七个展示名 + **Course** / **Unknown Course** / **Unknown Regular**。

- **Course 启发式**：标题含词边界 Course/Dan(s)（`Dance` 不误中）**且**含至少一个英文冒号 `:` 或 `~` → 极可能是 Course；显示为 `Course · <标题>`（如 `Course · Js/Hs Dan ~ Basic Level Pack`）。
- **Unknown Course**：无 Course 标识但存在显著长空隙。
- **Unknown Regular**：无标识且无空隙，不分段。
- **难度名**：默认取 .osu [Version]；唯一例外 Celestial 取标题。段位包处完整显示 `包名 · 难度 X`。

> 包描述中的 OD/HP 等数值仅为原包背景信息，判定计算一律以 .osu 实际读取的 OverallDifficulty 为准（references 实测谱 OD 跨 7.5~8.5，确无固定值）。

## 5. 分段逻辑

- **主信号 = note 时间轴空隙**。两类规则（2026-10-03 定版，同日经 748 张 course 语料校准）：
  - **已知包固定四曲三空隙**：>4s 空隙恰 3 处直接采用；多于 3 处时取**彼此时长最接近的 3 处**（簇选择，并列取四段时长方差最小）。依据：同一张图内曲间空隙彼此接近、曲内长 break 偏离该簇（FINAL-ETA 曲间 6.2~7.0s vs 曲内 11.0s；REFORM 4th 曲间 4.6~5.3s vs 曲内 10.7~11.6s）；而曲间标称随时包/图在 4.4~19.9s 漂移（LN v2 语料 4.4s、Signicial Theta 18~20s），固定标称锚不可行（先后试过统一 5s/Malody 10s 与按包校准 5/9/15/10s，均被语料推翻）。空隙不足 3 处视为单曲（LN v2 语料 64 张中 60 张即单曲）。四空隙情形无地面真值核对，簇选择是结构推断（如 Signicial Theta 19.6/5.3/18.1/19.9 → 取三处 ~19s）。
  - **未知 Course / Unknown Course 曲目数不固定**（3/5 首皆可）：>4s 空隙全量各切一段（JsHs Level 2：6.7/13.8s 两处 → 3 曲）。
- 实测锚点：LN v2 5th Dan 3 空隙（15.7/11.0/17.4s）；Malody Regular-5 9.2s×3；Signicial 5th 8.6/9.0/9.7s（语料 18 张中 7 张四空隙）；REFORM 语料 16 张中 14 张恰 3 空隙（4.2~14.4s）、1 张四空隙、1 张七空隙；FINAL-ETA 4 空隙取 3；单曲样本无 >4s 空隙 → 不分段。
- **Course 无空隙 = 该包单曲**：显示包名（已知包用展示名，未知用提取名），不列分段，已知包门槛照常按整谱判定。
- **元数据佐证**："(Marathon)" 字样不代表合谱（单曲长谱也用），最终以空隙为准。
- **切分对账**：uzxn/acc 物量表——LN v2 5th Dan 四段 1904/887/1380/1220 完全一致；Signicial 存在地图版本漂移（5797 vs 5760），以版本为提示不作硬断言。
- 输出：每段单曲 acc + sumup（截至该段累计 acc），每种判定体系各一套；Unknown Regular 不切分。

## 6. 形态：单页 HTML 应用（JS）+ 三种输入模式

浏览器直接打开即用（file:// 可运行，无构建步骤、无后端）；.osu 文本解析与 .osr 二进制+LZMA 解码全在前端（解码器 vendor 进仓库，不依赖 CDN）。

**输入模式**（2026-10-03 定版：**首版只做模式 1**，联网功能整体延后）：
1. **谱面文件 + 回放文件**：MD5 合得上即计算（离线，恒可用）；
2. ~~谱面文件 → 检索官网~~（延后）
3. ~~成绩链接 → 回放~~（延后）
- ~~联网 fallback~~（延后）

> 联网相关端点实测结论与三模式设计存档于决策记录，供日后启用时参考。

**联网端点实测**（2026-10-03，存档备查——首版不启用联网）：成绩页 `/scores/<id>` 与回放下载有登录墙+Cloudflare（匿名 403）；谱面原文件 `/osu/<beatmap_id>` 公开可拉但无 CORS 头（浏览器直连被拦）；Celestial 谱未上传官网（BeatmapID:0）。日后启用时的方案分叉（半自动引导/可配置代理/代理+token）再议。

输出：谱面信息（标题/键数/OD/物量）、整体五体系 acc、（若切分）分段表、按包门槛的过段判定；SV2 口径判定与结果导出（JSON/文本复制）做成页面开关。

## 7. 验收标准（Done when）

1. stb 重判判定计数 == .osr 内嵌计数（硬验收，第一优先）。
2. 五体系 acc 全输出；分段包输出每段单曲 + sumup；按各包门槛输出过段判定。
3. 校准样例：OD8 94.01% / 94.21% 两个 tap 谱 replay（判定计数在手）；LN 切分对账用 uzxn/acc 物量表。
4. LN 包在三种 osu LN 语义下分别正确结算（stb 头+尾双判且尾用合计规则 / SV2 尾独立 / lzr 头尾双判 + MEH 封顶）。
5. references/ 七对样本作为回归夹具（LN v2 5th 合谱、Celestial Ascension 单曲、REFORM TechMap 单曲、Malody Reg-4 单曲含 DT、Reg-10 单曲、Regular-5 合谱、Signicial 5th 合谱含 Mirror），**全部为 lazer 导出**（ver=30000019）。已实证结论：lazer osr 内嵌判定数 = rice+2×LN（7/7）；beatmapMD5 == md5(.osu)（7/7）；countGeki=MAX、countKatu=200（对照 Regular-5：geki=3501 与已知 MAX 数一致；katu=572 与第三方引文 579 有 7 之差，以 osr 头部为准）；Mirror=1<<30 在 Signicial 样本实际出现；Celestial 谱未上传官网（BeatmapID:0），天然覆盖联网 fallback 路径。stb 引擎对账需另行补 stable 导出的回放样本。

## 8. 决策记录

- 2026-10-03：LN v2 过段挂 stb（"scorev2主要影响的是300还是320的判定区间，ln段的过段应该还是stb"）；SV2 独立成一种判定体系。
- 2026-10-03：C判/B判分歧是 Malody v2 时代问题；v3 手机电脑统一 A-E 五档，手机宽松 B、电脑严格 C（~~窗口取萌百表~~ → 2026-10-05 改用用户提供的 Malody V 实测表 Standard 组，萌百整表弃用）。
- 2026-10-03：过段口径 = 全曲整体（马拉松整体过段）。
- 2026-10-03：判定体系拆为五种：stb / stb(scorev2) / lzr / Malody C判 / Malody B判，全部计算并展示。
- 2026-10-03（修订）：各包无固定 OD，OD 一律从 .osu 读取（包描述中的 OD/HP 仅为背景）；Malody 两档固定窗。
- 2026-10-03（修订）：技术形态定为 JS 单页 HTML（浏览器即用，file:// 可运行），弃 Python CLI。
- 2026-10-03（references 实测）：Malody 包匹配放宽为 "Malody 4K Regular Dan" 前缀（单复数两形态）；马拉松判定补 Malody 四词规则；Mirror(1<<30) 纳入 mods 检测（含轨道镜像对齐）。
- 2026-10-03（再次修正，用户定版）：stb 的 LN = 头+尾偏移**合并单判定**（"头尾的两个偏移加一起然后算均值"）；references 七对回放**全部为 lazer 导出**（ver 300000xx），内嵌计数 rice+2×LN 的双判定结构归属 **lzr** 引擎；判定语义以 B 站文章《4K下落式音游齐民要术——判定和评级（十）》（opus/1140164949285273625）与 osu wiki 为准。新增三种输入模式与联网取数（端点可行性已实测；模式 2 语义、联网方案待用户确认）。
- 2026-10-03（范围定版）：首版砍掉联网，仅做双文件手动导入 + MD5 配对计算；模式 2/3 与联网取数延后（端点实测结论已存档）。

## 9. 参考与实现期待核实

参考：osu wiki 三页（窗口/acc/LN）；B站 cv15316319（Malody v3 官方）；知乎 p/704902100（Malody acc 公式实测）；萌百 Malody 词条（A-E 判定表，**已弃用——错位数据**）；osu 论坛帖 2226317（Signicial）、1803173（Celestial）；B站 opus/1140164949285273625（判定与评级文章，其表 2-4 与萌百同源、判定窗口部分不可信）；prior art：uzxn/acc、uzxn/osu-split、Crazy-Bull/osr2mr、ppy/osu-tools。

实现期待核实：lazer 窗口对 ppy/osu `ManiaHitWindows.cs`（已读全文，窗口=floor(分段线性公式)+0.5）；Malody LN 尾窗（现按同表）；stable notelock 精确行为；LZMA 解码器已定案（vendor：nmrugg/LZMA-js 的 lzma-d.js，MIT，ESM 垫片改造）；osu!std 转换图特殊窗口（遇转换图报不支持）。

## 10. 实现状态（2026-10-03 v0.1）

模块：`src/osu.js`（谱面解析）、`src/osr.js`（回放解析：头部+LZMA+文本帧→按键事件）、`src/vendor/lzmaD.js`（LZMA 解码）、`src/engines.js`（对齐+五体系判定+分段+段位包）、`src/ui.js`（页面逻辑）、`tools/build-ui.mjs`（构建：模块内联为零依赖 index.html，file:// 双击即用）、`test/harness.mjs`（七夹具对账）、`test/smoke-ui.mjs`（bundle 冒烟：无 DOM 执行 + bundle/模块一致性 + 计数抽查 + DOM id 一致性）。

UI（2026-10-03 v0.5，Swiss Dark 主题）：拖放/选择双文件 → MD5 校验 → 五体系 acc 表 + lzr 对账表（重判 vs 内嵌计数及 Δ）+ 细值区（段位包按其门槛体系显示判定窗口±ms 与各档计数——osu 系随 OD 算实际值、Malody 系固定表值；未分类谱显示全部五体系）+ 段位判定（course 谱按门槛 PASS/FAIL，分段表含单曲/累计 sumup）+ 文本/JSON 导出（文本报告同样含细值）。视觉：瑞士风格暗色变体——SourceHanSansLite 本地字体（resources/，与 LXGWNeoXiHeiPlus 二选一，选思源：中文 neo-grotesk 正统、字形中性不抢数据、体积 2.8MB vs 8.6MB）、单一强调红 #DA291C、方角细线网格、01-07 编号小节、两字重、通过/未通过以文字+边框表达（红绿色弱友好）。浏览器实测（http 服务 + evaluate 喂夹具 + DOM 快照 + computed style）：渲染链路全通，字体加载成功，数字与 harness 逐位一致；修复过一处 `style.display=''` 回退样式表导致结果区不显示的 bug。改动 src 后须重跑 `node tools/build-ui.mjs` 生成 index.html。

已定案（实证）：
- 回放解压后为**逗号分隔文本帧** "w|x|y|z"；**mania 按键位在 x 字段**（z 恒 0）；列 = bit0..N-1；
- **回放时间 = 谱面 track 时间**：DT 回放与谱面时间原样对齐（÷1.5 全崩），判定窗口在 track 时间下不缩放（Reg-4 DT 夹具拟合 ×1.0 吻合——与 lazer 源码 speedMultiplier 注释相抵，机制存疑但实证如此）；
- 自写 LZMA 解码器废弃（区间解码初始化等两处 bug 后仍有暗病），vendor MIT 实现；
- MD5 配对、Mirror 镜像、分段（空隙>4s×3）全部工作正常。

对账终态（2026-10-03 v0.4，七夹具全部实质通过；Δ = lzr 重判 − osr 内嵌）：

| 夹具 | Δ(Geki/300/Katu/100/50/Miss) | 备注 |
|---|---|---|
| Celestial（0.7×） | 0/0/0/0/0/0 | **精确 PASS** |
| REFORM | −1/0/1/0/0/0 | |
| Reg-10（DC 0.75×） | 0/−1/−2/0/0/+3 | |
| Reg-4（DT 1.05×） | 1/1/0/−1/0/−1 | |
| Signicial（Mirror） | −3/−1/−2/0/0/+6 | |
| Reg-5 | −1/−1/−2/0/−2/+6 | |
| LN v2 5th | −15/10/9/0/−9/+5 | 8363 判定 |

"密集谱 ×0.7 窗口异常"已完全破案：三例全是隐藏变速（Celestial 0.7 / Reg-10 DC 0.75 / Reg-4 DT 1.05），非时钟噪声。残余 Δ 为个位数边界噪声与少量 LN 头未中仍持有的未建模场景。

v0.2 修正（依 ppy/osu 源码）：
- LN 尾判重做（`DrawableHoldNote`/`DrawableHoldNoteTail`）：尾 = 首次落在 ±1.5×miss 内的释放、偏移 /1.5 后按普通窗判；MEH 封顶仅"头未中或 body 断裂"时；持穿后晚释放按偏移判（无自动 PERFECT）；
- notelock（`OrderedHitPolicy`）：note 可击范围 = [t−miss, min(t+miss, 下一 note 开始时间))，击中后更早未判物件强制 miss——对密集谱生效；
- 非 course 谱：MD5 匹配成功即输出五体系计算值，不切分、无过段判定（2026-10-03 需求）。

~~已知局限（密集谱时钟量化）~~：该假说已被 v0.4 推翻——"密集谱残差"实为尾块中位掩码不可见的隐藏变速（Celestial 0.7×、Reg-10 DC 0.75×），倍率接入后残差消失。

开放问题：
1. 三张谱的 Miss 残差 +5~7（LN 头未中仍被持有的 ≤MEH 尾判场景未建模）；
2. index.html 为构建产物（源在 src/，勿手改产物；改 src 后跑 `node tools/build-ui.mjs`）。

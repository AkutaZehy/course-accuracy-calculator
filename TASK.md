# course-accuracy-calculator — 规格

输入 osu!mania 谱面（.osu）与回放（.osr），按五种判定体系重算准确率，按段位包规则输出整体/分段成绩与过段判定。

本文是终态规格：只描述工具当前的行为与门槛。规格的形成过程（决定、理由、被推翻的方案）见 [DECISIONS.md](DECISIONS.md)。

## 1. 核心机制

.osr 回放不含判定结果，只有按键时间线（LZMA 压缩流；mania 帧的键状态按位掩码编码，bit k = 第 k 轨，按下/松键由位变化得出）。因此本工具是**重判器**，不是分类器：

1. 解析谱面 note（时间、轨道、LN 起止）；
2. 对齐回放按键事件，恢复每次击打/释放的真实 timing offset；
3. 同一份 offset 分别送入五种判定体系结算（LN 语义各不相同，见下）；
4. 同列吞键 / notelock 按 osu!stable 行为建模；hit error 四舍五入、判定窗口上限截断（边界 ±0.5ms）。

**校准锚点（硬验收）**：与回放所属客户端一致的引擎，其重判计数必须与 .osr 内嵌计数一致（MAX=countGeki、200=countKatu、miss=countMiss；geki=MAX 已实证 3501）。回放客户端判别：**游戏版本号 ≥30000000 = lazer 导出**（stable 为日期式如 20250116；Mirror mod 为 lazer 独有，亦为佐证）。references 八对全部为 lazer 导出（ver=30000019）——这批夹具的锚点引擎是 **lzr**（判定数结构 = rice+2×LN）；stb 引擎（LN 合并单判，计数 = rice+LN）待补 stable 导出回放再对账。不一致即实现有 bug。

**mods 与对齐**：osr 的 mods 位掩码含 DT(1<<6)、HT(1<<8，Daycore 同位)、NC=DT位+1<<9、Mirror(1<<30)。回放帧时间为谱面 track 时间（与倍率无关，实证：对齐恒等映射最优）。Mirror 需镜像谱面轨道后对齐。

**lazer 尾块（官方回放设计）**：version ≥ 30000001 的 .osr 在 onlineId 之后追加「4 字节长度前缀 + LZMA(LegacyReplaySoloScoreInfo JSON)」（ppy/osu `LegacyScoreEncoder`/`LegacyScoreDecoder`）。含：mods（APIMod 数组**带 settings——变速 mod 的自定义倍率在此**，位掩码只有 mod 名）、statistics、maximum_statistics、client_version、rank、user_id、pauses（暂停时间戳数组）、online_id。**倍率解析优先级：尾块 mods（settings.speed_change，缺省=该 mod 默认值：DT/NC=1.5、DC/HT=0.75）＞ 位掩码默认（适用无尾块的 stable 回放）＞ 1**。尾块中位掩码未覆盖的 mod（DC/DA 等）合并进页面 mod 芯片与过段禁用闸。

**窗口与倍率（track 时间）**：三套 osu 引擎窗口 ×rate（lazer 源码 speedMultiplier；stable 墙钟固定窗折算 track 亦为 ×rate）；Malody 用基础值（文章「1.5×速→窗×2/3」为墙钟口径，track 下抵消）。所有 osu 系窗口按 `floor(值 × 倍率) + 0.5` 取整，倍率为 1 时即公式值 + 0.5ms。

**mod 展示与过段禁用闸**：页面对已用 mod 逐个芯片标注（中文名+分类：降难/变速/镜像/自动/不可控，变速芯片附尾块实测倍率）；命中降难（NF/EZ/HT，含尾块 DC）、不可控（Random）、自动（Auto）类 mod 时**不提供过段判定**（替换为禁用说明），各体系 acc 与细值照常输出；DT/NC、Mirror、HD/HR/PF/FL/FI 等不阻断。mod 表仅收录 osu!mania 实际存在的 mod（TD/Relax/SpunOut/Autopilot 已剪除）。局限：lazer 的 Difficulty Adjustment（DA）自定义 HP/OD 无独立位掩码，若未以 EZ 位导出则不可检测。

**文件配对与谱面属性**：osr 头部含 beatmapMD5，与配对 .osu 文件字节 MD5 相等（references 八对全部一致）——用于防配错对。osr 不含 OD/标题/键数等谱面属性，OD 与段位匹配一律取自 .osu。

## 2. 五种判定体系

| 体系 | 判定窗（ms） | LN 结算 | acc 公式 |
|---|---|---|---|
| **stb**（stable / ScoreV1） | MAX ±16 固定（实际窗宽 16.5ms）；300=64−3OD；200=97−3OD；100=127−3OD；50=151−3OD；miss=188−3OD。DT/HT 不缩放窗口 | LN = **头+尾偏移合并单判定**（两偏移求和后对双倍阈值，等价于均值对普通窗口）：PERFECT 需头≤1.2×MAX上限且合计≤2.4×；GREAT 1.1/2.2；GOOD、OK 1/2；其余非 miss 为 MEH；中途松手最高 MEH；晚于 MEH 释放=miss。N = rice + LN | 分母 300N；MAX 计 300（与 300 同权） |
| **stb (scorev2)**（stable 的 SV2 mod） | 同 stb：MAX ±16 固定、其余 64−3OD 系（wiki Hold_note：ScoreV2 改头尾分判与尾窗 ×1.5，**不改基础窗**） | 头尾独立判定，尾仅看释放误差、尾窗 ×1.5；中途松手尾封顶 MEH | 同 stb，但 MAX 权重=305（分子分母同步） |
| **lzr**（lazer） | lazer 分段线性：OD≤5 → 22.4−0.6OD；OD≥5 → 24.9−1.1OD（ppy/osu `ManiaHitWindows.cs`；与 sv2 的差异即此 MAX 窗） | 头尾独立双判定（内嵌判定数 = rice+2×LN 全中）；尾 = 首次落在 ±1.5×miss 内的释放，偏移 /1.5 后按普通窗判，此前出现过更早的释放即 hold 断裂（尾封顶 MEH）；无合格释放=miss。hold break 尾封顶 MEH 且不占额外判定 | (305·MAX+300·300+200·200+100·100+50·50) / 305N，N 含 LN 尾 |
| **Malody C判**（电脑判，段位标准） | BEST ±44 / COOL ±84 / GOOD ±129 / MISS ±171+（固定，不随谱面） | 头尾各计一次判定。尾：释放不早于 LN 结束时间记 BEST；早于结束时间时按尾偏移与本表窗口判档 | (BEST + 0.75·COOL + 0.4·GOOD) / N |
| **Malody B判**（手机判，段位标准） | BEST ±54 / COOL ±94 / GOOD ±139 / MISS ±181+ | 同上 | 同上 |

OD 一律取自 .osu 文件的 OverallDifficulty 字段（各段位包不预设 OD）；Malody 两档为固定窗口，与谱面无关。Malody 判定窗缩放（加速 mod，文章表 2-6）：1.5×速/RUSH → 窗 ×2/3，1.2×速/DASH → 窗 ×5/6——osu 回放重判不直接用到，备查。

来源：osu wiki（Judgement/osu!mania、Accuracy、Hit_object/Hold_note）；Malody acc 公式经真实成绩实测严格成立（知乎 p/704902100）；Malody 判定窗取 Malody V 实测表 Standard 组（C-NORMAL 列 / B-EASY+ 列）。

## 3. 过段口径

**全曲整体过段**：合谱马拉松用最终累计 acc（sumup 末值）对阈值；各段单曲 acc 照常输出，仅作诊断。Celestial 为分谱制，每谱即「全曲」。

## 4. 段位包与 Course 分类

### 已知包（门槛挂指定体系，整体口径）

| 展示名 | 标题/作图者匹配（大小写不敏感） | 结构 | 门槛 | 备注 |
|---|---|---|---|---|
| **osu!mania 4K Dan ~ REFORM (DDMythical)** | "dan ~ reform" 且无 "final" | 合谱/单曲 | stb ≥96% | 含他人托管的 DDMythical 谱（如 "1st Pack (Thaumiel)"，发布者≠作者，仍归本包） |
| **osu!mania 4K Dan ~ REFORM ~ FINAL (Thaumiel)** | "dan ~ reform"+"final"，非 Ext. | 合谱四曲 | stb ≥96% | 沿用 REFORM 门槛 |
| **osu!mania 4K Dan ~ REFORM ~ FINAL (Ext.) (CloverWisp)** | 同上，且标题含 "(ext" 或作图者含 "cloverwisp"（双路径） | 合谱 | stb ≥96% | 区分在 mapper |
| **osu!mania 4K Dan: Signicial's Courses** | "dan: signicial" | 合谱；主段 4 曲、入门段 3 曲 | stb ≥96% | 源：论坛帖 2226317 |
| **osu!mania 4K LN Dan Courses v2** | "4k ln dan courses"（不要求 v2 后缀——"…Courses - EXTRA -" 同门四曲谱同门；xfpsb "LN Advanced Dan Course Maps" 不含该子串不受影响） | 合谱四曲，LN 密集 | **sv2 ≥97%**（ScoreV2 口径，2023-01-26 起） | sv2 头尾双判对应现代客户端 LN 计数 |
| **Malody 4K Dan v3** | "malody 4k regular dan"（覆盖 Dan/Dans 两种标题） | 合谱 "Dans v3 (Part.N)" 四曲；单曲 "Dan v3-\<词\>"（马拉松=标题不含 speed/stream/tech/jack） | C判 ≥95% 与 B判 ≥95% 分别判定（Extra 段 96% 不在范围） | 常规段 0~10dan；源：cv15316319 |
| **Dan: Celestial** | "dan: celestial" | **全单曲包**（每谱一课，7 tier × 35 course） | 每谱：stb ≥97% 与 lzr ≥96% 分别判定 | **难度取自标题**（-Ascension I- → Ascension I），非 [Version]；源：论坛帖 1803173 |

### 已知包中尚未实现的门槛

以下门槛写在段位包规则里，但当前判定只覆盖上表所列的那一档：

- REFORM 的 intro 段 95% 例外——当前按整体 96% 判定，不对 intro 段单独放宽。
- Signicial 的进阶 ≥97%、精通分档（初阶 99.80 / 中阶 99.50 / 高阶 99.00 / 最终 98.00 / 追加 97.00）与入门段分档（土/水/火/风 ≥95、灵 ≥96）——当前只判合格档 ≥96%。
- Malody 的禁暂停、除 Const/Flip 外禁 Mod——当前只按 mod 类别闸禁（见 §1），暂停次数仅在页面显示。
- Celestial 的禁暂停——同上。

### 未知谱分类

段位包处的取值全集：上表七个展示名 + **Course** / **Unknown Course** / **Unknown Regular**。

- **Course 启发式**：标题含词边界 Course/Dan(s)（`Dance` 不误中）**且**含至少一个英文冒号 `:` 或 `~` → 极可能是 Course；显示为 `Course · <标题>`（如 `Course · Js/Hs Dan ~ Basic Level Pack`）。
- **Unknown Course**：无 Course 标识但存在显著长空隙。
- **Unknown Regular**：无标识且无空隙，不分段。
- **难度名**：默认取 .osu [Version]；唯一例外 Celestial 取标题。段位包处完整显示 `包名 · 难度 X`。

> 包描述中的 OD/HP 等数值仅为原包背景信息，判定计算一律以 .osu 实际读取的 OverallDifficulty 为准（references 实测谱 OD 跨 7.5~8.5，确无固定值）。

## 5. 分段逻辑

- **主信号 = note 时间轴空隙**，阈值 4 秒（>4000ms）。
- **已知包**：空隙 ≤3 处直接采用；多于 3 处时取**彼此时长最接近的 3 处**（簇选择，并列时取四段时长方差最小）。依据：同一张图内曲间空隙彼此接近、曲内长 break 偏离该簇（FINAL-ETA 曲间 6.2~7.0s vs 曲内 11.0s；REFORM 4th 曲间 4.6~5.3s vs 曲内 10.7~11.6s）；而曲间标称随时包/图在 4.4~19.9s 漂移（LN v2 语料 4.4s、Signicial Theta 18~20s），固定标称锚不可行。四空隙情形无地面真值核对，簇选择是结构推断（如 Signicial Theta 19.6/5.3/18.1/19.9 → 取三处 ~19s）。空隙 1~2 处时按实际空隙数切段，不强制四段。
- **未知 Course / Unknown Course 曲目数不固定**（3/5 首皆可）：全部 >4s 空隙各切一段（JsHs Level 2：6.7/13.8s 两处 → 3 曲）。
- **无空隙 = 整谱不分段**：显示包名（已知包用展示名，未知用提取名），已知包门槛照常按整谱判定。
- **元数据佐证**："(Marathon)" 字样不代表合谱（单曲长谱也用），最终以空隙为准。
- **切分对账**：uzxn/acc 物量表——LN v2 5th Dan 四段 1904/887/1380/1220 完全一致；Signicial 存在地图版本漂移（5797 vs 5760），以版本为提示不作硬断言。
- 输出：每段单曲 acc + sumup（截至该段累计 acc），每种判定体系各一套；Unknown Regular 不切分。

## 6. 形态与输入模式

浏览器直接打开即用（file:// 可运行，无构建步骤、无后端）；.osu 文本解析与 .osr 二进制+LZMA 解码全在前端（解码器 vendor 进仓库，不依赖 CDN）。

**输入模式**：首版只做模式 1——**谱面文件 + 回放文件**，MD5 合得上即计算（离线，恒可用）。谱面检索、成绩链接取回放、联网 fallback 三条路径延后，其端点实测结论见 [DECISIONS.md](DECISIONS.md)。

输出：谱面信息（标题/键数/OD/物量）、整体五体系 acc、（若切分）分段表、按包门槛的过段判定；判定结果可导出 JSON / 文本报告（页面开关）。

## 7. 验收标准（Done when）

1. lzr 重判判定计数 == .osr 内嵌计数（硬验收，第一优先）。
2. 五体系 acc 全输出；分段包输出每段单曲 + sumup；按各包门槛输出过段判定。
3. 校准样例：OD8 94.01% / 94.21% 两个 tap 谱 replay（判定计数在手）；LN 切分对账用 uzxn/acc 物量表。
4. LN 包在三种 osu LN 语义下分别正确结算（stb 头+尾双判且尾用合计规则 / SV2 尾独立 / lzr 头尾双判 + MEH 封顶）。
5. references/ 八对样本作为回归夹具（JsHs Basic Level Pack、LN v2 5th 合谱、Celestial Ascension 单曲、Signicial 5th 合谱含 Mirror、REFORM TechMap 单曲、Malody Reg-4 单曲含 DT、Reg-10 单曲、Regular-5 合谱），**全部为 lazer 导出**（ver=30000019）。已实证结论：beatmapMD5 == md5(.osu)（8/8）；countGeki=MAX（对照 Regular-5：geki=3501 与已知 MAX 数一致；katu=572 与第三方引文 579 有 7 之差，以 osr 头部为准）；Mirror=1<<30 在 Signicial 样本实际出现；Celestial 谱未上传官网（BeatmapID:0）。stb 引擎对账需另行补 stable 导出的回放样本。

## 8. 实现现状

### 模块

`src/osu.js`（谱面解析）、`src/osr.js`（回放解析：头部+LZMA+文本帧→按键事件）、`src/vendor/lzmaD.js`（LZMA 解码）、`src/engines.js`（对齐+五体系判定+分段+段位包）、`src/ui.js`（页面逻辑）、`tools/build-ui.mjs`（构建：模块内联为零依赖 index.html）、`test/harness.mjs`（夹具对账）、`test/smoke-ui.mjs`（bundle 冒烟）。

改动 `src/` 后须重跑 `node tools/build-ui.mjs` 生成 index.html；index.html 是构建产物，勿手改。

### 页面输出

拖放/选择双文件 → MD5 校验 → 五体系 acc 表 + lzr 对账表（重判 vs 内嵌计数及 Δ）+ 细值区（段位包按其门槛体系显示判定窗口 ±ms 与各档计数；未分类谱显示全部五体系）+ 段位判定（course 谱按门槛 PASS/FAIL，分段表含单曲/累计 sumup）+ 文本/JSON 导出。

### 对账现状

夹具在 `references/`（本地目录，不入库）。`node test/harness.mjs` 跑全部八对，Δ = lzr 重判 − osr 内嵌：

| 夹具 | Δ(Geki/300/Katu/100/50/Miss) | 备注 |
|---|---|---|
| Celestial（0.7×） | 0/0/0/0/0/0 | **精确 PASS** |
| REFORM TechMap | −1/0/1/0/0/0 | |
| Reg-10（DC 0.75×） | 0/−1/−2/0/0/+3 | |
| Reg-4（DT 1.05×） | 1/1/0/−1/0/−1 | |
| Signicial（Mirror） | −3/−1/−2/0/0/+6 | |
| Reg-5 | −1/−1/−2/0/−2/+6 | |
| LN v2 5th | −15/10/9/0/−9/+5 | 8363 判定 |
| JsHs Basic Level Pack | 0/−30/−6/2/−19/+53 | 未知 Course，两处空隙切三段 |

Celestial 用 ×0.7 窗后六项计数与内嵌完全相等。残余 Δ 为个位数边界噪声；JsHs 的残差明显偏大，来源未定位（见下方开放问题）。

### 已知限制与开放问题

1. 已知包中尚未实现的门槛见 §4。
2. Malody LN 尾窗按同表推定，未与实机判定设置逐档核对。
3. lazer 的 DA（自定义 HP/OD）无独立位掩码，未以 EZ 位导出时不可检测。
4. osu!std 转换图的特殊窗口未建模，遇到转换图不保证结果正确。
5. JsHs 夹具的对账残差（−30/−6/+2/−19/+53）来源未定位；已知候选是 LN 头未中仍被持有的尾判场景。

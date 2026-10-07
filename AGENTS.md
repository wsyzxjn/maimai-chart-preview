# VS Code maimai 插件 Agent 指南

## 项目定位

`vscode-maimai` 是 VS Code 内的 maimai DX 谱面播放预览插件，支持 Simai 和 MA2。Marketplace 名称为 `maimai Chart Preview`，包名为 `maimai-chart-preview`，Publisher 为个人 `amatsuka`，命令和设置使用 `maimai` 命名空间。核心工作流是：在编辑器中修改谱面文本，在右侧 Webview 实时查看 Note、播放伴奏和打击音效。

MA2 必须复用共享引擎的 `parseMa2Chart`；插件的 `buildMa2SourceMap` 只提取记录的 bar/tick 来做行映射，不解析 Note。引擎前奏固定为 4 拍，行映射必须同样偏移。MA2 每文件一张谱面，难度选择器显示 MA2 并禁用，不能把默认渲染难度 4 当作文件实际难度。MA2 记录可能按类型分组而非按时间排序，反向行映射不能假设 Beat 有序。

插件定位以“可靠播放和写谱反馈”为主，不要把它扩展成独立的可视化谱面编辑器。新增功能应优先服务于谱面解析、播放、音画同步、Note 可读性和 VS Code 编辑器联动。

本项目作者和许可证署名使用 `Amatsuka`，不能再把组织设为 Publisher。依赖原作者的版权与许可声明放在 `THIRD_PARTY_NOTICES.md` 和 `licenses/`，不作为本插件作者署名。

Simai 的 `&inote_1..6` 对应 EASY、BASIC、ADVANCED、EXPERT、MASTER、Re:MASTER，不能用少了 EASY 的数组或把 6 标为 Original。难度探测复用 `getAvailableDifficulties`，标签复用 `DIFFICULTY_NAMES`，等级来自解析后的 `chart.level`。

自定义编号为正的安全整数，`&inote_7`、`&inote_10` 等显示为“谱面 n”，等级/谱师由同编号 `lv_n`/`des_n` 提供。标准难度联合类型仍为 1..6，自定义 ID 是段落号，不得强制断言为标准难度；共享 `readSimaiSections` 同时服务发现、解析、行映射和光标所属段落判断。无分段正文内部兼容 ID=4，UI 必须显示“单谱面”，不能猜 EXPERT。声明格式允许 BOM、CRLF、大小写、等号前后的空白；非法/重复声明阻止回退到单谱面，空段落给出明确内容错误。

## 关键语义

- `Hi-Speed` 指 **Note 的下落速度**，不是伴奏或打击音效的播放倍速。
- 伴奏和打击音默认以 `1.0x` 播放；不要把 `playbackSpeed` 与 `hiSpeed` 混用。
- UI 的 Hi-Speed 沿用 `MainRenderer.setHiSpeed()` 原有范围 `3.0` 到 `9.0`、步长 `0.1`；不得为插件放宽引擎下限。宽面板显示滑条和数值输入，窄面板展开调节，不能显示音频倍速的 x 标记。
- 打击音时间偏移是用户偏移，必须叠加在引擎的 `ANSWER_SOUND_BASE_OFFSET_MS` 上；不要用 UI 的 `0ms` 覆盖引擎基础前置偏移。
- 当前播放区不提供小节循环。播放控制保持简单：播放/暂停、时间轴、前后小节、Note Hi-Speed、音效和音量/偏移调节。
- 时间轴通过共享 TimingTimeline 换算当前/总时长及悬停目标时间；拖动暂停并在释放后按原播放状态恢复。输入框、滑条、下拉和按钮使用各自的键盘语义，不拦截这些控件的空格/方向键。SE 偏移位于播放设置面板并标明 ms 单位。

## 目录职责

- `src/extension.ts`
  - Extension Host 入口。
  - 注册命令、创建 Webview、查找同目录伴奏、发送资源 URI 和设置。
  - 监听文档变化、难度切换、编辑器光标和播放进度。
  - 按文件格式选择 Simai / MA2 解析器，管理解析诊断和播放时的编辑器行高亮。
- `src/webview/webviewApp.ts`
  - Webview UI、Canvas 渲染、时间轴、播放循环和键盘控制。
  - 使用共享 `MainRenderer`、`TimingTimeline`、`AudioManager` 和 `prepareAudioEvents`。
  - `AudioManager` 负责打击音；`HTMLAudioElement` 负责伴奏。不要再实现第二套音频调度器或第二套时钟。
- `src/webview/customAudioManager.ts`
  - 已移除。共享引擎的 `AudioManager` 是唯一音效调度实现。
- `src/parser/sourceMap.ts`
  - 建立编辑器行号与 Beat 的映射，供光标定位和播放时反向跟随使用。
  - 注释与段落解析复用引擎 `readSimaiSections` 的清理后正文，注释用等长空格屏蔽，必须保留原始行列。评论中假 metadata/Note 不得影响段落、时间或光标。引擎解析错误携带 line/column/length，Problems 优先定位记号并通过 doc.validateRange 裁剪；没有位置才回退整个文档。
- `src/parser/chartFormat.ts`、`src/languageDetection.ts`
  - 前者仅用多行组合特征判别格式，不能另造 Note 解析器；后者通过官方 `setTextDocumentLanguage` 为已打开的 plaintext `.txt` 启用对应语言。只读取前 64 KiB，不扫描工作区，编辑检测防抖 200ms，`autoDetectCharts` 可以关闭。`files.associations`、其他语言模式及本会话内手动语言变更优先；必须防止语言更改引起的 close/open 递归，不因为正文暂时错误而取消语言。
- `src/types/protocol.ts`
  - Extension Host 与 Webview 的消息协议。修改消息字段时同步更新发送方、接收方和设置类型。
- `syntaxes/simai.tmLanguage.json`
  - Simai TextMate 语法高亮。
- `syntaxes/ma2.tmLanguage.json`、`ma2-language-configuration.json`
  - MA2 指令、数字和注释的语法高亮与注释规则。
- `snippets/simai.json`
  - 常用 Simai 元数据、Note 和分拍代码片段。
- `web/styles/app.css`
  - Webview 的 VS Code 主题适配样式。
- `media/assets/chart/`
  - 内置打击音效和判定线资源，用户已明确要求随公开 Git 仓库提供，保留第三方声明。通过 `yarn assets:import` 可替换用于测试。伴奏由谱面所在目录提供。
- `media/icons/`、`media/icon.png`
  - 编辑器标题栏按钮的浅色/深色 SVG 和插件清单中的彩色 PNG 图标。
- `dist/`
  - `node build.mjs` 生成的运行时产物。不要直接手改；源代码变更后重新构建。

## 现有播放契约

1. `AudioManager` 使用引擎的音频资源加载、前瞻调度、密集事件合并和 Touch Hold 持续音逻辑。
   保持原有单声部规则，后继 Touch Hold 在起点替换前一个持续音，不合并重叠或首尾相接区间；共享引擎的 `setEnabled` 行为保持原样。插件恢复 SE 时通过已有 `reset(currentMs, true)` 重建调度状态，播放中再调用 `schedule`，暂停时不发声。
2. Webview 通过 `soundBaseUrl` 将引擎默认的 `/assets/maimai/chart/*.wav` 映射到 VS Code Webview 资源 URI。
3. 插件仅提供两个音量：`musicVolume` 控制伴奏，`seVolume` 通过统一的 GainNode 控制所有 SE（正解音、判定音、持续音及烘焙段）。共享 AudioManager 的两层增益固定为 1，输出接到 SE 总增益；修改 SE 音量不 reset 或重建音源。伴奏尚未加载或切换谱面时也要保留音乐音量。SE 开关及 M 键只影响音效，`timingOffsetMs` 是用户偏移。
4. 播放、暂停、Seek、谱面切换和静音都必须清理或重置音频调度状态，避免旧音源与新位置重叠。
5. 播放进度通过 `cursorSync` 发回 Host，携带文档 URI 和难度，旧谱面进度必须忽略。Host 仅高亮当前行，不写 `editor.selection`。跟随按钮独立控制自动滚动，播放中用户点击/滚动编辑器即停止跟随，Host 自己的 reveal 事件不得当成用户滚动；不要用计时器猜来源。
   跟随状态由 Host 在 VS Code `globalState` 的 `followPlayback` 中持久化，页面模板和 ready 消息都恢复同一状态；切换难度/文件和从光标播放不得强制开启。点击、滚动产生的关闭状态也保存；用户点击跟随按钮才重新开启。
   自动 Seek 仅在暂停时且光标精确命中当前难度正文行时发生，其他难度、元数据、空白不映射到开头或末尾。Webview 必须再次检查 `onlyWhenPaused`，防止状态消息竞争。返回同一编辑器不重载谱面；下拉选择难度会暂停并揭示正文，`maimai.playFromCursor` 才根据光标所在难度显式切谱面并开始播放。
6. 伴奏候选文件名目前是 `track.mp3`、`track.wav`、`track.ogg`、`bgm.mp3`、`music.mp3`、`audio.mp3`。修改候选顺序或同步算法时要同时考虑 `seekTo()` 和 `startPlay()`。

## 构建与验证

从 `vscode-maimai` 目录构建：

```bash
yarn install --immutable
yarn test
yarn typecheck
yarn build
```

引擎通过固定 Git 提交的 workspace 依赖安装，`.yarn/patches/` 包含资源 URL 适配、自定义 Simai 段落、等长注释屏蔽和可定位的解析/参数校验。保持单一补丁，不能直接手改 node_modules，也不能硬编码相邻 checkout 路径。更新引擎和补丁按 `CONTRIBUTING.md` 执行。

诊断目前仍由打开的预览为所选谱面计算。完整实时诊断和上下文补全尚未实现；扩展时用官方 DiagnosticCollection/CompletionItemProvider，复用引擎规则，不能另造第二个 Note 解析器。零时长 Hold/Slide 保持兼容；BPM、分拍及延迟 BPM 必须正值，未知/字段缺失不能静默跳过。

如需要在上游 checkout 验证音频改动，相关测试从前端仓库运行：

```bash
cd ../maimai-prober-frontend
./node_modules/.bin/vitest run packages/maimai-chart-engine/tests/chart-audio-scheduling.test.ts
./node_modules/.bin/oxlint packages/maimai-chart-engine/src/core/audio/AudioManager.ts packages/maimai-chart-engine/tests/chart-audio-scheduling.test.ts --deny-warnings
./node_modules/.bin/oxfmt --check packages/maimai-chart-engine/src/core/audio/AudioManager.ts packages/maimai-chart-engine/tests/chart-audio-scheduling.test.ts
```

涉及 Webview 控件时，至少验证：

- `package.json` 设置和消息协议字段一致。
- `dist/extension.js`、`dist/webviewApp.js` 已重新生成。
- 新控件的 DOM id 在生成的 Webview 模板和事件绑定中都存在。
- 如果能操作已解锁的 VS Code，执行一次 Reload Window，打开 `.simai`、`maidata.txt` 和 `.ma2`，确认播放按钮、Note Hi-Speed、音量和偏移控件可用，并验证 MA2 单谱面提示和两种格式间切换。
- 如果 VS Code 或 macOS 锁屏导致无法做 UI 验证，应明确报告为未验证，不要只凭构建通过声称界面已验证。

## 修改边界

- 优先复用 Git workspace 依赖 `@lxns-network/maimai-chart-engine` 的解析、时间线、渲染和音频能力；只有共享引擎无法满足插件边界时才新增实现，并说明缺口。
- 不要把伴奏倍速当作 Hi-Speed，也不要为了播放控制修改引擎的 Note 速度语义。
- 不要直接编辑 `dist/`、source map 或打包文件。
- 修改音频调度时必须增加或更新共享引擎测试，至少覆盖长时间播放、Seek、持续音和静音恢复。
- 修改用户可见功能时同步更新 `README.md`、`package.json` 配置描述和本文件的约定。
- 不要提交或推送远程 Git 仓库。任何远程仓库改动（尤其是 `git push`）都必须先得到用户明确确认；提交必须遵守用户当前的签名提交要求。
- 保留工作区已有改动，不使用 `git reset --hard` 或 `git checkout --` 覆盖其他人的修改。

# 收紧 World Model biological_type 分类 Contract

## Goal

修正 World Model Prompt 的分类边界，使模型只把同一 species 内稳定、直接属于生理或生殖机制的分类放入 `biological_types`，不再把普通子类、派生称呼、身份、职业、等级、阶段或临时状态当成 biological type。

## Requirements

### R1. 收紧生产 Prompt 的 biological_type Contract

- 明确 `species` 回答“这是什么生物”，`biological_type` 只回答“该 species 内属于哪一种稳定的生理/生殖分类”。
- 候选 type 必须同时满足：位于同一 species 内、稳定存在、直接涉及身体结构/生理机制/生殖角色或能力、移除非生物分类背景后仍成立、且有当前 `AnalysisInput` 的充分证据。
- 明确排除 species 别名或普通 taxonomy 子类、职业、身份、社会/组织/文化归属、阵营、能力体系、等级/境界、成长阶段、训练状态、临时/可逆身体变化、疾病/异常、个体特质和行为模式。
- 信息不足时输出 `biological_types: []`；只有一个候选也必须单独确认它是独立稳定的 biological classification，不能因数量为一自动保留。
- 输出前进行内部 A–E 分类自检，但不输出推理过程；无法可靠回答时删除 type 或降为 `null`。
- 合并现有重复规则，不加入任何具体物种、世界观、测试角色卡或专用示例。

### R2. 保留已有通用字段语义

- 五个 capability 继续逐字段执行 true/false/null 的局部证据原则。
- Human Male/Female baseline 继续作为唯一内置生物知识例外；非 Human 不因类型名称继承 Human physiology。
- `fertilization`、`lifecycle.maturation`、`lifecycle.aging` 的现有通用语义继续保留。
- 不修改 World Model v1 schema、五个 capability、统一 UI renderer、Event/State/Projection 或 Runtime。

### R3. Analyzer 只保留通用结构边界

- 本轮不新增具体世界观关键词、物种 registry、alias、fixture regex、species→type 映射或 blacklist。
- 只有测试暴露出确定性的结构/证据边界缺陷时，才允许做最小通用 guard；需要理解陌生概念语义的判断仍由 Prompt + AnalysisInput 完成。
- 当前工作区已有的未提交 `ai/analyzer.js`、UI、测试和 Trellis 文件改动视为用户已有工作，不能回滚或用本任务覆盖。

### R4. 回归测试

使用本轮新建且不进入生产代码的原创 fixture，覆盖：派生/近义成员称呼、职业/身份、等级/阶段、临时/可逆状态、真正稳定生理分类、无分类证据的空数组、单候选额外检查、多稳定分类、Nonhuman capability 保持 null，以及完全陌生世界无需修改 JS 即可通过统一结构。

保留现有必要回归；如需修复当前未提交测试中的语法错误，只做保持原意的最小测试修复，使验证链可运行。

## Acceptance Criteria

- [ ] Prompt 中存在无具体示例的完整 biological_type 成立/排除/未知 Contract，并且没有重复冲突规则。
- [ ] Prompt 要求单一候选额外复核和输出前 A–E 内部分类检查。
- [ ] Analyzer 没有新增具体世界观知识；如有改动，仅是通用结构 guard 并有对应回归。
- [ ] 五个 capability schema、Human baseline、final consistency guard、fertilization/lifecycle 语义保持不变。
- [ ] 新增原创 fixture 回归覆盖全部 R4 场景。
- [ ] World Model tests、`npm test`、`npm run check`、变更 JS 的 `node --check` 和 `git diff --check` 通过。
- [ ] Git diff 只包含本任务修改和为使既有测试可运行的最小语法修复；没有新增依赖或修改无关模块。
- [ ] 使用中文提交说明并记录 commit hash。

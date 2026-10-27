# 怀孕状态生产 UI 实装

## Goal

将已确认的妊娠状态、孕周和按人物分组的知情名单接入生产人物页与推演页 UI。

## Requirements

- 只修改生产 `ui/*.js`、`style.css`、Runtime/Core 的只读派生 DTO 和对应测试；不写入新的 Chat/Floor 持久化字段，不把原型演示数据带入生产。
- 人物详情沿用现有“当前状态”三个格：在“受孕事实”格显示确认状态，只有已确认时显示小型“知情名单”按钮；“妊娠状态”格显示 Runtime 提供的孕周，疑似/未知状态分别显示观察中/暂无结论。
- 知情名单必须按妊娠人物分组读取，只显示该人物当前已确认妊娠对应的已知情人物；未列入名单的人显示为默认不知情。弹层复用现有人物编辑器的尺寸、层级和关闭习惯，点击外部区域或 Escape 关闭。
- 推演详情复用现有详情 meta 的第一个状态徽标；已确认时改为可点击的“已确认怀孕”入口并打开同一名单弹层，不新增顶端妊娠栏目。
- 总览页不新增妊娠摘要模块。
- UI 只能消费 Runtime/Core 经过校验的 `pregnancy_status` 与 `pregnancy_knowledge` DTO，不在详情层重新从 Event 文本推导状态或孕周；未有可比较时间锚点时不得伪造周数。

## Acceptance Criteria

- [ ] 当前状态区在 confirmed/suspected/unknown 三种真实 DTO 下分别渲染确认事实、孕周/观察中/暂无结论。
- [ ] confirmed 人物的名单按钮与弹层只显示该人物名单，多个妊娠人物之间不串名单；无名单时明确显示暂无已记录知情人。
- [ ] 人物页和推演页均可打开/关闭名单弹层；外部点击、Escape、切换人物、切换页面都会关闭，内部点击不会误关闭。
- [ ] 总览页 HTML 不出现新的妊娠摘要模块；普通 UI 不显示 character_id、pregnancy_id、Floor 或 hash。
- [ ] Runtime 读取仍遵守当前有效 Floor/Swipe owner；knowledge/status 读取失败时只回退为空 DTO，不清除已有人物、Event 或健康状态。
- [ ] 通过 `npm run check`，并补充 Core 派生孕周、Runtime DTO 和生产 UI 的自动化测试。

## Notes

- 原型基准见父任务 `.trellis/tasks/10-26-pregnancy-status-ui-design/`；生产实现必须以现有 `ui/app.js`、`ui/characters.js`、`ui/projection.js` 与 `style.css` 为准。
- 生产推演/人物状态不新增编辑入口；名单仍是只读展示。

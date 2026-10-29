# 司机手机端 PWA：第一阶段审查与实施设计

审查日期：2026-10-27。当前状态：**经用户授权，司机端与预约后台已正式上线；独立试用版继续保留并连接隔离库**。下文保留分阶段实施记录，试用发布见第27节，备份见第28节，正式发布及验证边界见第29节。

**业务边界更新（2026-10-27，用户明确确认）：** 以现有 `region_id` 为隔离边界，不再要求同地域内按公司隔离；这取代最初“两家公司互不可见”的要求。后台普通用户保留现有权限，后台管理员保留现有跨地域权限。司机必须同时满足地域一致、唯一账号绑定和本人有效派单/日报所有权，不能读取同地域其他司机或公司财务。`region_id` 仍不是 `tenant_id`，本方案不再引入独立租户模型。以下内容已按该边界调整。

## 1. 本阶段范围与工作区保护

- 实际应用目录：`hire-car-system-main`；父目录不是 Git 仓库。
- 进入时分支为 `main`，HEAD 为 `e84269ba956f355fe7455a735143283bb19f2bd5`。
- 原有 21 个已修改文件、3 个未跟踪文件，共 24 个文件；没有合并冲突或进行中的 merge/rebase/cherry-pick。未跟踪内容包括两项移动日历 hook 及司机手动工资迁移。
- 已在会话私有目录 `files/driver-pwa-prebranch` 保存原文件、工作区/暂存区二进制补丁和 SHA-256 清单；创建并切换到 `feature/driver-pwa` 后验证原文件哈希不变。
- 新分支与 main 起点相同；原有修改仍作为未提交内容保留，未 stash、覆盖、恢复或提交它们。**分支切换本身并不隔离未提交文件**，后续提交必须仅选择本阶段文档；不得 `git add .`。
- 本阶段仅新增本文件；不改业务页面、依赖、SQL 迁移或正式配置，不创建提交，不访问生产业务数据，不迁移、不部署。main 引用不变。

已读取根目录 `AGENTS.md`、`README.md`、`PROGRESS.md`、`package.json`，以及下述实际业务和数据库代码。`PROGRESS.md` 最后标记日期为 2026-10-15，部分描述已经过时（例如弹窗关闭规则、请求书超时金额），不能作为当前实现的替代依据。

当前依赖声明 Next.js `^16.4.0`、React `19.2.8`、TypeScript `^5`、Supabase SSR `^0.12.7`、supabase-js `^2.117.3`、Zod `^4.6.5`；本机实际 Next.js 为 `16.4.0`。已有 `security/next-upgrade` 分支，不在此阶段合并。已参考本机 Next.js 的 PWA 指南 `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`；后续实现需继续按本机版本文档验证 API。

## 2. 已有能力与证据

| 范围 | 实际情况 | 证据 |
|---|---|---|
| Auth | 已有 Supabase 邮箱密码登录、找回密码、管理员创建/修改账号 | [authorization](../lib/supabase/authorization.ts)、[账号 API](../app/api/admin/accounts/route.ts)、[proxy](../proxy.ts) |
| 用户身份 | profiles.id 主键关联 auth.users，角色仅 admin/user，company 为文本，region_id 为地域外键 | [初始 schema](../supabase/migrations/20261011000000_initial_schema.sql)、[地域迁移](../supabase/migrations/20261014000000_region_isolation.sql) |
| 地域隔离 | 普通用户按 current_region_id；admin 跨地域；核心业务表已有 RLS | 地域迁移第 63–127 行 |
| 公司资料 | companies 有 UUID、地域、名称、银行资料、T 番号、印章；不是已确认的租户表 | [domain](../lib/domain.ts)、[数据库类型](../lib/supabase/database.types.ts) |
| 司机/车辆 | drivers 有 UUID、地域、姓名、联系方式、驾照；车辆有 UUID、车牌、所属会社文本 | domain；订单中 driver/vehicle/company 仍主要为文本关联 |
| 每日财务 | finance_by_date JSON 含每日司机/车辆覆盖、行程、车费、成本、超时请求/工资、出金资料 | [data API](../app/api/data/route.ts)、[每日财务迁移](../supabase/migrations/20261013000000_daily_order_finance.sql) |
| 调度 | 已有整单移动、跨日范围拆分、休运日、批次导入、按车牌关联 | [page](../app/page.tsx) 的 moveOrderToCell、moveSplitRangeToVehicle；[批次迁移](../supabase/migrations/20261102000000_order_import_batches.sql) |
| 报表 | 已有订单、司机工资、车辆、收支平衡、请求书及独立会社立替 PDF | lib 中现有各 print/summary 模块；不再重复实现 |
| 审计 | 数据库生成 last_operation、before/after 审计，管理员专用日志 API | [审计迁移](../supabase/migrations/20261026000000_business_audit.sql)、[审计 API](../app/api/admin/audit/route.ts) |
| 防缓存 | jsonResponse 已设置 private/no-store/Vary: Cookie，页面请求 /api/data 使用 no-store | [api-response](../lib/api-response.ts)、page |
| PWA/司机专属模型 | 当前 app/lib/supabase 迁移未发现 driver 路由、manifest/SW 注册、司机 Auth 关联或拟议的司机业务表 | 当前源码范围搜索；不代表已查询生产 schema |

Supabase helper 审查：`browser.ts` 使用浏览器 publishable key；`server.ts` 使用 SSR cookie；`authorization.ts` 在服务器 getUser 后读本人 profile；`admin.ts` 带 server-only 且使用服务密钥；`pagination.ts` 分页读取已有集合，不能直接给司机复用“读取整个集合”的行为。`database.types.ts` 是手写结构（Relationships 为空、Insert 为 Partial），不能代替实际 FK/约束目录。

迁移目录现有 25 个 SQL，范围涵盖初始 schema、订单/每日财务、地域、存款/请求书、车辆月费、收支项目、发票流水、印章、审计、车牌、车辆排序、来源简称、导入批次及手动工资。文件时间号有晚于今天的条目，且两份迁移共用 `20261014000000` 前缀：后续必须核对实际迁移记录，**不能按“当前日期以前”猜测是否应用，也不能一键重跑整个目录**。

### 2.1 数据库核实边界

以上是**源码与迁移意图**，不是生产数据库的现状认证。本阶段未使用生产凭证、未连接生产 SQL Editor、未读取客户/司机明细。过去会话中的“已执行”陈述也不能替代本次实际约束与策略检查。

因此：生产已应用迁移、数据量、重复/空名称、手动修改过的 RLS、Storage bucket/策略及回填可行性均标为**待授权只读核查**，属于实施前门禁。不能宣称已完成真实数据检查或直接给出可在生产执行的回填脚本。

### 2.2 开发环境隔离核实（2026-10-27）

下一步启动时发现：本机 `.env.local` 的 Supabase 主机、已打开的 `hire-car-system-dev` Dashboard 项目，以及正式站 `https://hire-car-system.vercel.app/login` 当前公开 JavaScript 中的 Supabase 主机，均指向 `acuhvzpsitnevfztbbtv.supabase.co`。仅提取主机名，没有输出密钥；正式登录页的 9 个同源脚本已检查。

因此该名为 dev 的项目**同时被正式站使用，不能作为隔离测试库**。项目名称不足以证明环境隔离。本次未运行 SQL、未迁移、未创建测试账号或测试业务记录，也未更改环境变量。后续实施前须建立独立的 Supabase 开发项目或本地开发实例，使用虚构数据，并再次验证与正式库主机不同；Preview 和开发进程也须单独配置，不能继承现有正式数据库凭证。独立项目可能涉及费用，创建前另行确认。

用户随后同意尝试建立独立云端测试项目；Dashboard 提示账号已达到 2 个免费项目上限，创建按钮不可用。本次未升级、付费、暂停或删除任何项目。

经用户授权，只读核查另一个项目 `zsipqwipauzgbqvppwjf`（显示名 `zhangsiliangvip-star's Project`）：其主机与已核实的当前正式站不同，但不是空库。使用 `BEGIN TRANSACTION READ ONLY`、10 秒语句超时及 `ROLLBACK`，仅获取结构与聚合计数：public 有 8 张表、0 个视图、3 个函数；Auth 有 2 个用户；Storage bucket/object 均为 0。实际计数确认 orders 7、drivers 7、vehicles 7、companies 1、profiles 2。未查询姓名、邮箱、乘客或订单明细。它是否仍被其他应用使用无法据此确定，须由用户确认其用途及允许的改动范围；未授权复用前，不迁移、不覆盖、不暂停该项目。

**测试项目选定：** 用户随后明确确认上述另一个项目是闲置测试库，允许用于司机端开发，必须保留原有数据。项目不必删除或暂停，也不需要升级付费。本机 `.env.local` 仍指向现有正式数据库，未切换；不能直接启动现有开发命令就认定在使用选定测试库。

选定库的结构预检进一步确认：

| 项目 | 实际结果 | 后续处理 |
|---|---|---|
| 地域基础 | 无 public.regions；public 无任何 region_id 列 | 属于旧版 schema，不能直接运行当前后台或司机端；先准备保留数据的地域扩展与归属核验 |
| 司机身份/派单 | 无 profiles.account_type、driver_auth_links、driver_assignments | 按本计划增量建设，旧 Auth/profile 不自动变成司机 |
| RLS 开关 | public 8 张表均启用 RLS，未启用 FORCE RLS | 开关不等于策略正确；仍需逐条核验 policy、函数及直接 REST/RPC 权限，不能宣称隔离测试通过 |
| 迁移记录 | 无 supabase_migrations.schema_migrations | 不能用 `db push` 或重放全部历史迁移猜测基线；先对实际结构生成显式增量差异 |
| profiles | 已有 id/email/full_name/company/position/role/email_confirmed/created_at，无地域 | 保留 2 个旧账号，不按公司文本推断地域或授予司机权限 |
| orders | 已有 finance_by_date 等旧业务字段，无地域 | 保留 7 条订单及所有原有财务 JSON；未知地域记录先待确认，不默认东京，不进入司机派单 |

下一实施单元为：读取并比较现有迁移与该库的实际结构，准备独立测试启动配置和仅面向选定测试项目的增量迁移/验证脚本；执行前校验项目引用，禁止指向 `acuhvzpsitnevfztbbtv`。现有测试数据的地域归属未确认，涉及回填/NOT NULL 的步骤必须暂缓，不能通过删库、重建或填默认地域绕过。此次只读预检未执行 DDL/DML、未创建账号、未复制生产数据，司机真实登录与派单功能尚未实现。

### 2.3 已实施的测试基础（2026-10-27）

用户要求继续后，实际变更如下，取代前文初始“本阶段仅文档/未迁移”的当前状态描述；前文保留为审查历史：

- 新增 [独立启动脚本](../scripts/driver-pwa-dev.mjs) 及 [测试](../tests/driver-pwa-dev.test.mjs)。仅接受选定测试项目的精确 HTTPS URL；公开配置拒绝服务密钥及其他项目 legacy JWT；启动前向该测试项目的 Auth settings 验证 publishable key。第21节新增可选、显式配置的隔离账号管理密钥，默认仍禁用。禁止自动跳转，不打印密钥或响应正文。
- 测试子进程屏蔽现有 dotenv 文件中的配置和继承的数据库/服务密钥，避免 Next 环境加载顺序补回正式凭证；原 `.env.local` 不修改。测试模式专用 `.next-driver-pwa` 构建目录，端口 3100，现有普通启动方式和 `.next` 目录不变。此入口只负责环境隔离，不证明 schema/权限已就绪，不自动启动服务器。
- 在 Dashboard 中先确认路径是 `zsipqwipauzgbqvppwjf`，执行 [测试库增量扩展](../supabase/driver-pwa-test/001-region-expand.sql) 的等价 SQL：仅新增空 regions 表及 8 张旧表的 nullable region_id 外键列。regions 已开启 RLS 并撤销 public/anon/authenticated 权限；没有插入地域、默认值、回填、替换旧策略或创建司机身份。
- 同事务锁定 8 张旧表，比较扩展前后的行数与按 id 排序的 JSON 内容校验值（排除新增 region_id）；实际返回 `region_expand_verified / 8 / 31`，确认原有 31 行业务内容保留。
- 在后续独立只读事务执行 [验证 SQL](../supabase/driver-pwa-test/001-region-verify.sql)：8 个地域列均 nullable、无默认值；regions 为 0 行、RLS 已启用、匿名和 authenticated 均无 SELECT；7 条旧订单和 2 个旧 profile 的地域仍为空。未知归属没有被自动填平。
- [受限回滚脚本](../supabase/driver-pwa-test/001-region-rollback.sql) 只适用于尚无地域数据/赋值、尚无后续司机 schema 的情况；不使用 CASCADE，不删除旧业务表/记录。尚未执行回滚演练，不可声称已验证回滚。后续有数据则先停功能并保留新增数据，不执行该脚本。

上述 SQL 单独存放 `supabase/driver-pwa-test`，不是通用生产迁移，不混入历史迁移目录、不通过 db push 自动应用。脚本本身不能可靠判断远端项目引用，执行人员必须核对 Dashboard URL；原子 schema 前置检查会拒绝在已存在地域结构时重跑。此轮未访问生产 SQL、未调整生产权限、未部署；旧测试库权限尚未收紧，**仍不得创建或启用司机账号**。

测试配置准备方法（需要选定测试库的 publishable key；不要从正式 `.env.local` 复制）：

```dotenv
# Save locally as .env.driver-pwa.local (already ignored by Git).
NEXT_PUBLIC_SUPABASE_URL=https://zsipqwipauzgbqvppwjf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=REPLACE_WITH_TEST_PROJECT_PUBLISHABLE_KEY
```

```powershell
node scripts\driver-pwa-dev.mjs --check
# Only after test schema and permissions are ready:
node scripts\driver-pwa-dev.mjs --start
```

本阶段当时未创建该私有配置、未读取或落盘测试密钥、未启动3100服务器（后续状态见第14节）。配置缺失/不符时脚本显式退出。`--check` 不联网、不启动服务器；`--start` 验证 key 后才启动。默认禁用服务密钥；后续受控司机账号管理配置见第21节，始终不允许沿用正式服务密钥。

本轮验证：`node --test tests\driver-pwa-dev.test.mjs` 的 5 个测试通过；修改代码的 ESLint 和 `tsc --noEmit` 通过；实际执行缺少配置的 `--check` 得到预期退出码 1；两个私有配置/构建路径均被 Git 忽略。原 24 个业务文件 SHA-256 不变，main 引用不变。以上不是完整司机端验收，也不代表旧测试库的原有宽策略已经安全。

接下来的阻断项：旧数据地域归属、完整旧 schema 差异、staff/driver 的 API+RLS+RPC 门禁、唯一 Auth 绑定、派单事务；这些通过后才启用虚构测试司机。不能因为地域列已存在就声称地域隔离或司机权限已实现。

### 2.4 已实施的司机身份基础（2026-10-27）

用户再次批准“开始”后，仅在选定测试项目 `zsipqwipauzgbqvppwjf` 执行了 [002 身份扩展](../supabase/driver-pwa-test/002-driver-identity.sql) 的等价事务 SQL。执行前核对 Dashboard 路径和旧 schema；迁移返回 `driver_identity_prepared / preserved_profiles=2 / driver_links=0`。

- profiles 新增 account_type；原有 2 个已核查的后台 profile 标为 staff，其余旧字段逐行 JSON 比较不变。新 Auth 用户经现有触发器生成的 profile 默认为 pending；user_metadata 中伪造 staff/admin 不会提升身份。
- 新增 is_staff，is_admin 同时要求 staff+admin。对 7 张现有业务表叠加 `AS RESTRICTIVE` staff 门禁，与旧 permissive policy 以 AND 组合；不删除或改写旧后台规则。这是保留旧规则且封锁司机的显式限制策略，不是通过新增更严格的 permissive policy 期待覆盖旧权限。
- 测试库原来没有地域隔离规则，本次不声称为旧 staff 数据完成地域回填/隔离；原 staff 仍沿用旧规则，司机只有专用受控身份投影。后续新增业务/财务表必须同时加身份门禁，不能套用历史 migration 中 authenticated 全放行策略。
- 新增 driver_auth_links：driver_id 主键、user_id UNIQUE、地域复合 FK，并将 profile 的地域、driver 身份及 user 角色纳入复合 FK。后台修改已绑定 profile 的地域/身份/角色不能绕过约束。司机不能直读/写关联表。
- bind_driver_identity 仅允许 staff 管理员把 pending/user 账号绑定到有明确地域的司机，不自动匹配姓名，不允许管理员自绑定、跨地域或重复绑定；身份切换与关联写入在同一事务。
- set_driver_identity_status 使用版本锁，支持挂起、恢复及撤销；撤销不可恢复。挂起/撤销后每次 driver_identity 查询立即失效，不依赖 JWT 过期。关联和身份审计不对客户端开放，actor/time/version 由服务器生成。
- 未创建持久测试登录账号、密码、地域或派单；没有触碰生产数据库。

应用层只在受控测试环境激活：

| 位置 | 当前行为 |
|---|---|
| [test-runtime](../lib/driver/test-runtime.ts) | 默认关闭；同时校验显式测试标识和精确测试库 URL，不能在正式库上开司机功能 |
| [proxy](../proxy.ts) | 测试模式中拒绝非 staff 访问后台页面和后台 API（403）；司机路径仍需登录，具体司机资源由其接口再授权；身份查询失败为503，不放行 |
| [authorization](../lib/supabase/authorization.ts) | 测试模式在加载后台 profile 前独立校验 is_staff，非 staff 不返回后台授权 profile；不是仅依赖导航或 proxy |
| [身份接口](../app/api/driver/me/route.ts) | 测试模式 GET /api/driver/me；getUser 验证会话并调用 driver_identity，仅返回 driverId/regionId/name/version；无绑定或挂起撤销403，未登录401，Auth/RPC故障503；no-store |
| [数据库类型](../lib/supabase/database.types.ts) | 仅增加本次 RPC 类型，保留所有原有工资等未提交类型变更 |

未开启测试标识时，新增身份接口返回404，proxy/后台授权逻辑不调用新 RPC；正式库没有新函数也不会触发请求。当前仍未配置 `.env.driver-pwa.local` 或启动3100服务，因此以上是已测试的代码与数据库基础，不是可登录的手机功能。旧后台“创建账号”流程尚未适配显式 staff 启用，新建账号保持 pending；测试入口服务密钥继续禁用，不要用旧后台页面创建/管理新测试账号。

验证及边界：

1. 在测试库运行 [身份测试](../supabase/driver-pwa-test/002-driver-identity-test.sql) 的等价用例：事务内创建 6 个无登录密码的虚构 Auth 用户、3 名司机、2 个地域；切换真实数据库角色 authenticated/anon 和请求主体，执行18组断言，返回 `18 / true`。覆盖同地域与跨地域身份、自提升、直表 SELECT/INSERT/UPDATE/DELETE、管理员绑定限制、唯一/复合约束、挂起/撤销、版本冲突及审计。
2. 整个测试事务 ROLLBACK 后另起只读事务确认：Auth/profile 仍各2，staff profile为2，orders=7、drivers=7，regions/links/identity_audit均0；7条restrictive门禁已持久生效；authenticated 无 profile 表/列 UPDATE，anon 无身份 RPC EXECUTE。无持久测试用户或业务夹具残留。
3. Node回归共80项通过（既有业务66项、司机身份9项、独立启动5项）；修改代码 ESLint、TypeScript 检查通过。数据库 role 测试不是实际手机登录、PostgREST HTTP或生产验收；后续仍须测试完整请求链路。
4. 仍在 feature/driver-pwa，未提交、未合并、未部署。原工作区24个快照文件中，仅 database.types.ts 因本次 RPC 类型有13行新增，其余23个保持原内容；授权helper和proxy为本次另行批准的代码改动。

回滚：先停测试入口、禁止创建/启用身份，保留身份表和审计。不要撤销 staff 门禁后让 driver/pending 落入旧全放行策略，也不要把所有 profile 改回 staff。当前不提供删除身份表的常规 down 脚本；需要还原到002前时先在克隆中验证完整依赖和授权状态，再单独批准。001回滚脚本会因存在身份schema而拒绝，不能强行执行。

下一单元：独立登录/账号启用流程及测试启动配置、本人行程的稳定 assignment 模型和白名单投影。后台调度拆分事务及完整地域一致性尚未实现；不要将这次“身份可识别”误当作“订单授权已完成”。

## 3. 安全发现与阻断项

### 3.1 已确认的代码级权限不一致

| 编号 | 级别 | 证据 | 影响与限制 |
|---|---|---|---|
| S1 | 原审查评级 HIGH，置信度 9/10；后台范围已获业务接受 | `20261103000000_driver_wage_items.sql` 第 19–23 行授予 authenticated CRUD，RLS 为 admin OR 同地域；data API 第 891–901、964–969 行却将此功能限制为管理员 | 普通同地域账号可绕过 Next API 直接访问司机手动工资。静态确认；本次未验证生产是否存在此策略。用户接受现有后台普通用户范围，本阶段不收紧其权限；这不适用于司机，司机必须在数据库/API 双层拒绝。 |

同样需要核查车辆月费、收支项目的 API 管理员限制与 `20261020000000_finance_region_isolation.sql` 同地域 RLS 的差异。不得将 API 的角色检查误认为数据库层已拒绝直接访问。

### 3.2 司机 PWA 的必须先完成项

1. **地域是已确认的业务边界。** `region_id` 是东京/大阪/北海道；同地域可以有多家公司，本期不要求公司间隔离。companies.name、orders.company、vehicles.owner_company、profiles.company 保留现有业务含义，不作为司机授权依据。实施前仍须核查真实地域约束和策略；地域一致不等于司机能读取全地域数据。
2. **不能把司机创建成普通 user 后只隐藏导航。** /api/data GET 第 797–826 行向已登录 profile 读取 orders/drivers/vehicles/sources/companies 的 `select("*")`，包含订单财务、公司银行和印章等字段。POST 允许普通账号在地域内提交 orders 等全对象。司机必须在 API 和数据库同时被拒绝这些后台能力。
3. **RLS 只保护行，不保护列。** 即使将 orders 限到获派司机，直接 SELECT 一整行仍会暴露 finance_by_date、order_price 等。司机不得获授基础 orders/companies/财务表的读取权；需要专用白名单投影与受控函数。
4. **没有受信司机唯一登录关联。** 不能以姓名、邮箱字符串、手机号或 profiles.position/company 自动授予司机权限；也不能使用可由用户编辑的 user_metadata 作为授权依据。
5. **现有调度多记录保存不等于事务。** moveSplitRangeToVehicle 可能保留原 ID 并新建剩余/移动订单；data API 的 applyMutation 独立 upsert/delete。新派单、事件和通知不能在这些操作之外松散拼接。
6. **保留后台 admin 边界，阻断司机继承。** 现有 is_admin() 的跨地域能力仅保留给后台 staff 管理员；司机鉴权不能因 profile.role 或旧宽策略跳过地域及本人所有权检查。

**放行条件：** 地域和司机绑定已人工确认；API+RLS+RPC+Storage 的跨地域及同地域跨司机拒绝测试全部通过；旧权限策略已加 staff 身份门禁且后台原权限回归通过；调度原子同步已实现；无映射或含歧义记录不能发给司机。此前仅允许本地/隔离测试环境开发。

## 4. 推荐架构与路由

采用同一 Next.js 仓库中独立 `/driver` 路由和 `/api/driver` API，不从现有巨型后台页面拆出一份客户端全量数据。共享 SSR/Auth、校验、错误响应和审计基础设施，不共享后台整对象 DTO 或全量持久化 hook。

| 路由 | 用途 | 允许数据 |
|---|---|---|
| `/driver` | 今日/待执行获派任务列表 | 自己有效派单的日期、时间、必要标题、地点、车牌、执行状态 |
| `/driver/orders/[id]` | 一张订单的本人派单片段 | 必须同时匹配本人的 assignment；同单由其他司机执行的日期/片段不返回 |
| `/driver/report` | 本人日况、草稿、提交/更正 | 本人当日里程、服务时段、必要费用申报和附件；不是公司财务编辑 |
| `/driver/notifications` | 本人站内通知和已读 | 不带乘客隐私的通知标题、类型、时间；点击后二次授权获取详情 |
| `/driver/profile` | 本人资料与登出 | 姓名、允许的联系方式、驾照状态提示；身份绑定/地域/权限不可自行改 |

订单详情的 `id` 为订单 ID；当同日多段或跨日换司机，响应包含本人可见 assignment ID，写入动作必须指定 assignment ID。不能仅校验“这个人曾经执行过订单”就返回整单。

使用 Supabase Auth 现有登录机制，扩展服务器角色分流：后台 staff 与 driver account_type 区分，profile.role 暂保留 admin/user 兼容；所有后台 RLS helper 必须明确校验 staff 身份。不能只加一条 `driver` permissive policy，因为旧地域 policy 会以 OR 合并继续放行。

建议新增 profiles.account_type 的迁移先将**已存在且确认的后台用户**标记 staff；新账号默认 pending，无任何业务访问。管理员创建 staff 的现有流程需显式赋值；司机受控邀请流程先 pending，事务中验证/建立 driver link 后才启用。Auth trigger、注册关闭设置、profile 无客户端写权限均须复核；不可默认把未来任意 Auth 用户变成 staff。

## 5. 地域与身份数据模型（拟议，未创建）

### 5.1 复用地域边界

- 不新增 tenants、tenant_memberships、tenant_regions 或 tenant_id；复用现有 regions 和各业务表 region_id。
- profiles 增加受控 account_type（staff/driver/pending），保留 admin/user 角色语义；身份类型不可由客户端自行提升。
- 后台 staff 按现有地域/管理员规则工作；司机权限必须额外验证 active link 与本人所有权。
- 派单使用明确 order_id、driver_id、vehicle_id 关联，**保留订单旧文本字段兼容历史显示**，不为司机端顺带改造会社关联。
- profiles.company 仅展示；orders.company 是开票主体；vehicle.owner_company 是车主；来源是客户/代理，四者都不能作为租户身份。
- 首版一账号绑定一个司机、一个地域；同地域不同会社的订单可派给该司机，但只能看到明确获派的服务片段。跨地域司机服务暂不开放。
- 复用或补充基础表 `(region_id,id)` 唯一键，新增业务表使用复合外键，防止合法 region_id 搭配其他地域 order_id/driver_id/vehicle_id。同地域内仍校验本人 assignment，不因外键成立直接放行。

### 5.2 司机与 auth.users 唯一关联

新增 `driver_auth_links`：

- `driver_id` 主键、`user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id)`、`region_id`、`status(pending/active/suspended/revoked)`、`linked_at`、`linked_by`、`version`。
- `(region_id,driver_id)` 引用司机复合键；数据库验证 user 的受信 driver profile 与关联司机地域一致。
- 唯一约束覆盖所有未删除关联，不能用多个 active partial index 的空隙让同一账号绑定多个司机；重新绑定走管理员核验、撤销旧权限及审计流程。
- 只有现有后台管理员的受控函数可写入，司机无 INSERT/UPDATE 权限；禁止按相同名字自动连上。
- 挂起/解绑在每次 API/RPC/下载鉴权时检查，不等待 JWT 过期。历史事件保留 actor_user_id/driver_id，不级联删除。
- 删除 Auth 用户前先审计撤销关联，历史主体使用 tombstone 或 `ON DELETE RESTRICT`；首版不允许自动 cascade 清理业务历史。

### 5.3 新表草案

所有新增业务表至少有 UUID 主键、region_id、created_at、updated_at、created_by、updated_by、version；actor 由 auth.uid/受控系统流程生成，不信任客户端字段。

| 表 | 核心字段与约束 | 访问与生命周期 |
|---|---|---|
| `driver_assignments` | order_id、driver_id、vehicle_id 可空、service_date、segment_key、status、order_revision、supersedes_id；主键外另有防重复有效派单约束 | 以单服务日/片段授权；普通情况每单每日仅一个有效司机；撤派/改派不删历史 |
| `trip_events` | assignment_id、event_type、from_state/to_state、occurred_at_server、reported_at_client、actor_user_id、request_id、payload 白名单 | append-only；唯一 `(actor_user_id,request_id)`；不能客户端改历史或伪造服务器时间 |
| `driver_daily_reports` | driver_id、report_date、revision、state、受限服务/里程/申报 JSON、submitted_at、reviewed_by/at、correction_of | 唯一 `(region_id,driver_id,report_date,revision)`，同一天一个当前版本；本人草稿可改，已提交只走更正 |
| `driver_report_items` | report_id、assignment_id、申报类型、非负金额/小时等限额数据 | 明确关联本人当天有效派单；无权限提交其他司机费用；费用尚未进入核算 |
| `driver_notifications` | recipient_driver_id、type、assignment_id 可空、标题、created_at、read_at、dedup_key | 服务端生成；本人可读，已读只能本人受控更新，不可改收件人或通知内容 |
| `driver_attachments` | region_id、uploader_user_id、driver_id、report_id/item_id、storage_path UNIQUE、MIME、size、sha256、scan_status、created_at | 私有附件元数据；关联同地域本人报告；状态 pending_upload/quarantined/ready/rejected |

assignment 的 segment_key 是稳定服务片段标识，而不是起止日期字符串或 import_batch_id。ID 应在调度事务生成并维护；批次只表明导入归组，不能当授权凭证。

复用现有审计设计并核查 region_id，扩展 request_id、assignment/order 关联；`trip_events` 不是 `audit_logs` 的替代。新表需兼容 record_business_audit 的 last_operation 结构或新建专用触发函数，不能直接挂上而漏列。司机不能读取全量审计 before/after（含财务和其他人隐私）；只允许经过净化的本人事件时间线。审计只追加，金额/乘客联系信息按必要性脱敏并按确定的保留期归档。

## 6. 最小权限与状态机

| 资源/动作 | driver | staff |
|---|---|---|
| `/api/data`、基础 orders、companies、drivers/vehicles 全列表 | 全部拒绝，即使同地域 | 保留现有后台地域/角色权限 |
| 本人任务只读投影 | 有效身份+同地域+本人有效 assignment+允许状态/日期 | 受控调度权限 |
| 接单/确认/行程事件 | 只能本人 assignment，服务器验证状态 | 改派/取消走独立动作并审计 |
| 日报 | 仅本人草稿、提交、更正；无权审批自己 | 受权岗位审核 |
| 通知 | 仅本人读取/标记已读 | 系统发布，无任意客户端广播 |
| 工资、公司成本、profit、invoice、收支平衡、其他司机 PII | 拒绝 | 财务岗位授权 |
| 附件 | 本人合法报告所需访问；每次授权 | 按现有地域/管理员规则授权的审核者 |

必要行程 DTO 建议只含 assignmentId/orderId、服务日期、当地出车时间、上下车地点、车辆车牌、经审查的行程说明、执行状态、必要联系人。**不返回** orderPrice、dailyFare、financeByDate、driverWage、成本、利润、公司银行/印章、来源电话簿、其他司机信息。原 notes/tripSummary 可能包含财务信息，默认不原样输出；先建立 dispatcher-approved `driver_instructions`。乘客姓名/电话仅在履约必要且限定窗口内提供，并记录敏感访问策略。

状态机按 assignment 独立于现有 OrderStatus：

`assigned -> acknowledged -> en_route -> arrived -> in_service -> completed`

- driver 只能前进一步，不可修改 driver_id、region_id、order_id、车费/工资、取消或改派。
- `assigned/acknowledged` 可由调度改为 revoked/superseded；`in_service` 后改派必须人工确认交接；司机不自动重置状态。
- 到达/开始时间有服务器记录；客户端时间仅作参考，未来时间、逆序、重复、非法状态返回明确错误。
- RPC 事务中锁 assignment、检查 auth/link/region/current state/version，插入事件后更新状态；expectedVersion 过期返回 409。
- 重试 request_id 相同且 payload 相同返回原结果；相同 ID 不同 payload 拒绝，避免双写。
- 日报：draft -> submitted -> approved/rejected；rejected 可创建修订 draft；approved 不可静默改写，只能追加更正与审批。

数据库执行模型：使用当前用户 SSR client 调用小粒度受控 RPC；基础表不向 driver 开放；RPC 可在必要处 security definer，但必须固定 search_path、显式 auth.uid 与 region/link 校验、列白名单、revoke PUBLIC/anon，并只授予所需 execute。不能把绕 RLS 的 service_role 当作每个司机请求的普通查询客户端。若使用安全视图须确认 invoker/owner 权限，避免 view 绕过 RLS。

## 7. 与现有调度、财务的兼容

### 7.1 派单来源与拆分

现有优先级按每天 finance_by_date[date].driver/vehicle 覆盖，再退回订单级 driver/vehicle；driver-selection 已有最近服务日统计。司机侧必须引用 UUID 司机，不以姓名作为授权键。

迁移初期生成“候选映射清单”：相同 region 且唯一司机名/车牌才可候选；空白、手动司机、重名、外包、无法确认归属的记录一律人工确认。仅因旧数据中同名，不能给新登录司机历史订单权限。首次回填不自动向司机公开全部历史，设明确授权日期范围。

下一阶段需新增调度服务器事务：

1. 对原订单、派单及受影响服务片段加锁，校验订单 version 与调度权限。
2. 计算旧逻辑相同的前段/移动段/后段，按原方法分配 finance_by_date、off_dates、import_batch_*、orderPrice，保存 source_order_id/lineage（追加元数据，不挪作批次字段）。
3. 新 assignment 继承服务片段，不复制“已确认/已完成”状态到无关新司机；旧 assignment 设 superseded，关联新的 assignment，原事件保留不搬写。
4. 已发生事件/已提交日报引用的片段不得无审计移动日期；在途片段阻止普通拖拽，走受控交接；完成片段更正需追加记录。
5. 所有订单、assignment、lineage、通知 outbox 一次提交；失败全部回滚。不能先写订单再异步猜测派单。
6. 全量 /api/data orders upsert 必须接入相同校验/禁止绕过；否则“新 RPC 安全、旧接口可随意改”的方案不能放行。

当前客户端拆分行为不会在本阶段修改。实现原子调度必然触及后台保存入口，是**下一阶段专门批准的兼容工程**，不是先上线司机端再补。

### 7.2 财务原则

- 现有请求金额 = 当日车费 + ETC旅报 + 司机立替旅报 + 会社立替旅报 + 超时请求。
- 超时请求与超时工资独立；比例工资仍按现有请求减成本/立替的基数；历史缺失字段/零单价兼容不能被日报覆盖。
- 日报是申报源，不是核算事实；司机只能报小时、里程、凭据和批准允许的申报项，不能写 finance_by_date 或最终工资。
- 审核通过后由财务显式导入白名单字段，保存 report_revision、reviewer、applied_at 和幂等键。重复审核不重复计费；司机更正产生新版本，不回写已结算账。
- 未指定社报/旅报分类的司机费用不自动归类；不会向司机展示公司单价、奖金、比例工资或请求书状态。
- 回归包括旧整单价格、每日车费、跨月归属、出金分类、PDF、拆分前后金额守恒及财务覆盖字段保留。

## 8. 拟议 API（全部身份检查 + private/no-store）

| 接口 | 行为 |
|---|---|
| `GET /api/driver/me` | 当前 active link 的最小本人资料；无关联/挂起拒绝 |
| `GET /api/driver/orders?date=...&cursor=...` | 有界分页的本人派单；本地日期以 Asia/Tokyo 为准 |
| `GET /api/driver/orders/[id]?assignmentId=...` | 只返回本人的获派片段，越权与不存在统一 404 |
| `POST /api/driver/assignments/[id]/acknowledge` | 幂等确认；版本检查 |
| `POST /api/driver/assignments/[id]/events` | 严格事件枚举和状态机 RPC |
| `GET/PUT /api/driver/reports/[date]` | 本人草稿；可提交字段白名单；expectedVersion |
| `POST /api/driver/reports/[id]/submit` | 完整性校验，锁版本并提交 |
| `GET /api/driver/notifications`、`POST .../[id]/read` | 本人分页及幂等已读 |
| `POST /api/driver/attachments/init`、`POST .../[id]/complete` | 受控私有上传与隔离检查 |
| `GET /api/driver/attachments/[id]/download` | 每次复核身份/报告所有权/附件 ready 状态 |
| `POST /api/staff/dispatch/*`、`POST /api/staff/reports/[id]/review` | 调度、审核专用，不复用司机写接口 |

参数由服务器从身份派生 region/driver/actor，客户端传这些字段应严格拒绝。使用已有 Zod `.strict()` 和 jsonResponse 模式。401 未登录；403 身份无权限；404 资源不可见；409 冲突；422 非法业务状态。日志不打印完整请求、令牌、签名链接或乘客资料。

Cookie 写请求需校验同源 Origin/Host（代理头仅信任部署平台）、JSON Content-Type、必要 CSRF token；配合 SameSite 与安全 cookie，不单靠它们。对登录、事件、附件发签名、提交日报及通知查询设置按账号/地域限流，不能在 Vercel 单实例内存里假装全局限流。

## 9. 附件与通知安全

- 新建专用私有 Storage bucket，禁止 public ACL 和 getPublicUrl。
- 对象路径由服务器生成 `regionUUID/driverUUID/reportUUID/attachmentUUID`，不含姓名/手机号；客户端路径不可信，元数据/报告/派单复合约束一致。
- 限制首版 PNG/JPEG/WebP/PDF、单文件不超过拟议 5MB、报告附件数量及地域总量；实际上线阈值需确认。校验 MIME+文件签名，图片转码清除 EXIF；PDF 隔离扫描，禁止 HTML/SVG/脚本类型。
- init 创建 pending 元数据，上传完成后核查对象真实大小/哈希/类型再转 ready；恶意文件 quarantined，未完成孤儿上传按留存策略清理，不能删除业务已引用附件。
- 桶策略与服务端双层校验，司机不能罗列其他目录；短期上传签名仅可目标 key、不能覆盖已有对象。下载优先鉴权代理流，若签名下载 URL 最多短时有效并明确撤权后剩余有效窗口；不缓存、不在通知/日志暴露。
- 通知首版站内为主，不需要推送权限也能工作。以后 Web Push 使用独立本人订阅表、VAPID 服务端密钥，锁屏文本仅“有新的行程消息”，不带客户/行程地址；点击必须重新认证。iPhone 安装到主屏幕且 iOS 16.4+ 的推送能力不能当所有 Safari 浏览器都支持。

## 10. PWA 安装与缓存策略

首个可运行版本再实现，本阶段不创建 manifest 或 SW：

- `/driver/manifest.webmanifest`：稳定 id `/driver/`，start_url `/driver`，scope `/driver/`，display standalone，语言/主题色；192/512 PNG、独立 maskable 图标、180px apple-touch-icon。图标必须自有或获许可，无公司敏感印章素材。
- `/driver/layout.tsx` 独立 metadata/viewport；不改变现有后台 viewport 或手机日历缩放。支持 safe-area-inset、动态视口和竖横屏。
- HTTPS 为线上前提，localhost 为开发例外。Android 提供支持时的安装提示，iPhone 提供“分享 -> 添加到主屏幕”说明，不强行模拟 beforeinstallprompt。
- `/driver/sw.js` 只注册 `/driver/` scope，不设全站 Service-Worker-Allowed；manifest/SW/图标/通用离线页需要在 proxy 中按精确路径公开，不能把 `/driver/*` 整段放到公共访问。
- **缓存白名单**：只缓存明确列出的不带用户信息的壳、图标、离线提示和静态不可变资源。认证页面 HTML、RSC/Flight 响应、API、Supabase Auth/REST、附件、签名 URL、请求/重定向错误响应全部 network-only，禁止先缓存再过滤。
- 不使用 cache-first/stale-while-revalidate 缓存订单；不将 token/订单/日报/附件写入 CacheStorage、localStorage 或 IndexedDB。现有后台 usePersistedCollection 不作为司机离线队列。
- 断网显示“需联网查看/提交”，不展示上一个账号的快照；首阶段无离线写、无 background sync、无持续定位，也不申请定位权限。
- API 和认证 HTML 使用 private/no-store/max-age=0；动态鉴权页不使用 use cache/静态预渲染用户数据。共享 CDN 不缓存 Cookie/Authorization 请求，检查实际 Vercel Cache-Control；Vary 不是缓存授权机制。
- 退出先服务端 signOut，再清空客户端内存、清除应用自有旧缓存并广播其他标签/窗口；撤派/解绑/切账号重新请求鉴权。pageshow/BFCache 恢复不显示旧敏感 DOM，先遮盖再核验；离线不能恢复私人任务。
- SW 升级只清除 driver 前缀缓存，不能清理后台其他存储；使用版本化静态资源、处理旧 worker 与打开窗口，不在有待提交表单时强制 reload。

## 11. 数据库迁移前检查（只读模板，未执行）

仅由获授权人员在开发克隆/只读会话运行并返回**计数和结构**，不要导出客户资料或密钥。先确认环境与角色；不读取连接串、不调用 service_role 数据接口探查生产。

```sql
BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user;
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT c.relname AS table_name, k.conname, pg_get_constraintdef(k.oid)
FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, k.conname;

SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema IN ('public','storage')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY table_schema, table_name, grantee;

SELECT count(*) AS missing_company_match
FROM public.orders o
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.region_id = o.region_id AND c.name = o.company
);
SELECT count(*) AS missing_driver_match
FROM public.orders o
WHERE o.driver <> '' AND NOT EXISTS (
  SELECT 1 FROM public.drivers d
  WHERE d.region_id = o.region_id AND d.name = o.driver
);
SELECT count(*) AS non_object_finance
FROM public.orders
WHERE jsonb_typeof(finance_by_date) IS DISTINCT FROM 'object';
SELECT count(*) AS repeated_region_driver_names
FROM (SELECT region_id, name FROM public.drivers
      GROUP BY region_id, name HAVING count(*) > 1) x;
SELECT count(*) AS auth_profile_orphans
FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
ROLLBACK;
```

扩展核查清单：schema_migrations 是否存在以及实际 version/name（目录存在重复前缀，不自动解决）；pg_indexes、pg_class.relrowsecurity/relforcerowsecurity、SECURITY DEFINER owner/search_path/EXECUTE ACL、profiles 写入限制、Auth 注册设置、Storage bucket public/limit、audit 触发器是否启用。查询 Auth 与 Storage 目录若权限不足记录为未核实，不提权绕过。

业务预检另需聚合：每日 finance_by_date 的司机/车牌匹配（展开 JSON 前检查类型）；跨地域引用、空地域、orders.company 与 profiles.company 的不同含义、休运日/范围外日期、历史已拆分订单、现存发票及日报关联、孤儿 FK。司机/地域映射必须人工批准，不能用默认东京填平歧义；同地域会社不同本身不构成错误或阻断。输出只放匿名统计和待决映射编号，不在此文档保存真实个人数据。

## 12. 安全迁移与回滚顺序

以下为**候选新迁移**，本阶段未生成可执行 SQL；时间戳在实施时按实际最新已应用版本重新分配，不直接使用今天日期覆盖仓库未来编号。

1. 核对 S1 及同类财务表的实际策略，记录后台已接受的权限基线；不因本次司机开发收紧后台普通用户权限。
2. `*_driver_account_type.sql`：新增 account_type 与受控 helper；确认的旧账号回填 staff，新账号 pending；新表先 RLS deny-by-default。权限切换前不得创建 active 司机账号。
3. 独立受审计回填批次：人工确认地域、Auth/司机映射与冲突清单，受控小批量回填，保留原值/映射版本/checksum；不新增租户归属或批量改动会社数据。
4. `*_driver_region_constraints.sql`：补充所需索引与地域复合 FK，能用 NOT VALID 的 FK/CHECK 先加后验证；确认数据无误后再 NOT NULL。唯一索引需专门预检，CONCURRENTLY 不能放常规事务。短 lock_timeout/statement_timeout，锁争用即退出。
5. 替换旧地域 permissive policies，保留原后台地域/管理员逻辑但加 staff 门禁；在同一受控发布窗口中禁用旧宽权限和开放新授权，避免 OR 策略泄漏。全面拒绝 driver 对旧表/API/RPC 的权限；包括工资、车辆月费、收支及开票 RPC。
6. `*_driver_identity_assignments.sql`、`*_driver_events_reports.sql`、`*_driver_notifications_attachments.sql`：新表/索引/复合约束/审计/RPC/私有 Storage 策略，默认功能关闭。
7. 调度事务与旧客户端兼容改造测试通过，才建立派单候选并人工批准；完成跨地域/跨司机对抗测试后启用少量测试司机。

每步保存 schema/policy 快照、约束验证结果、行数/金额 checksum；在开发克隆先执行 up/down 演练，再由用户单独批准生产窗口。不得使用 drop/recreate 业务表、truncate、数据库 reset、覆盖 seed 或直接回滚到初始 schema。备份只放受控存储，不进 Git。

回滚分界：

- **尚无新写入**：关闭 feature flag、停用司机入口，撤销新 RPC/Storage 签发权限；新增表/列保留，必要时仅撤销本批新约束。不会重放历史迁移。
- **已有司机写入**：首先阻断新写、保留新表及事件/报告/附件；按 outbox 幂等状态核对，不删除已收数据。后台旧字段继续兼容读取，必要时使用已验证的适配层。
- 身份门禁**不能回滚成司机也能按普通用户访问后台财务**。回滚前停用所有司机身份/入口并撤销关联，保留原后台权限；不能让仍有效的司机账号落入旧宽策略。
- 回填回退仅依据事先记录的映射版本与原值，且检查之后没有业务写入；若有新引用则不自动逆向覆盖。
- PITR 是灾难恢复选项，不能作为普通功能回滚；会丢失回滚点后的正常写入，需另行批准。

## 13. 拟修改文件与后续顺序

最初审查阶段仅新增本文件；后续已批准的测试基础变更见 §2.3（启动脚本、测试配置开关、测试 SQL 和校验测试）。以下为整体后续候选，不代表已经实现：

| 文件/范围 | 用途 |
|---|---|
| `supabase/migrations/*`（新文件）、`supabase/tests/driver_*.sql` | 地域/身份/派单/日报/附件/审计/RLS/回滚演练；旧测试库差异脚本单独放 `supabase/driver-pwa-test` |
| `lib/supabase/database.types.ts` | 从已验证开发 schema 更新，检查生成类型与旧 DTO 兼容 |
| `lib/driver/{authorization,schemas,service,projection,state-machine}.ts` | 权限、字段白名单、状态机、错误语义；不要复用后台完整 Order 类型 |
| `app/driver/{layout,page}.tsx`、`orders/[id]/page.tsx`、`report/page.tsx`、`notifications/page.tsx`、`profile/page.tsx` | 独立司机体验 |
| `app/api/driver/**/route.ts`、受权 staff dispatch/review API | 小粒度数据与事务入口 |
| `app/api/data/route.ts`、`app/api/admin/accounts/route.ts`、`app/api/invoices/number/route.ts`、`proxy.ts`、SSR authorization helper | 阻断 driver 进入后台、兼容受控账号创建和精确公共 PWA 资源；数据库 allocate_invoice_number 同时拒绝 driver，不能只拦 HTTP |
| `app/page.tsx` 的调度保存入口 | 下一阶段单独批准后接入原子拆分/改派；不顺带改其他正式 UI |
| `app/driver/manifest.ts`（最终 URL 需核验）、`public/driver/sw.js`、`public/driver/icons/*`、安装提示组件 | 司机限定 scope 的静态 PWA 资源；manifest 文件命名需以实际 Next 路由生成结果验证 |
| `tests/driver-*.test.mjs`、隔离测试环境浏览器脚本、README | API/状态机/隐私/安装说明与回归 |

阶段顺序：

1. 授权只读 DB 预检，确认地域和账号/司机归属，记录后台已接受的普通用户权限基线。
2. 在隔离开发库演练地域约束及 staff/driver 权限，未通过前不开放司机身份。
3. 原子调度/拆分及稳定 assignment 关联，金额守恒与旧后台回归。
4. 只读司机路由和白名单 API，先验收跨地域及同地域不同司机互不可见；同地域不同会社可由后台正常派单。
5. 确认/事件状态机、日报及人工审核、附件，严格幂等和版本控制。
6. 站内通知、PWA 静态安装壳、缓存/切账号/断网测试。
7. 经单独批准进行 Preview/测试司机试点；再单独申请生产迁移及 Production 部署。本计划不是生产授权。

## 14. 验收测试矩阵

| 类别 | 必测案例与预期 |
|---|---|
| 身份 | 未登录401；pending/解绑/挂起拒绝；同名司机不自动获权；同账号二次绑定被唯一约束拒绝 |
| 地域/所有权 | 跨地域司机、同地域其他司机、猜测 UUID、伪造 region_id、跨地域组合 FK 均拒绝；同地域跨会社本人派单允许；后台普通用户原权限及管理员跨地域权限不变 |
| 旁路 | 直接 PostgREST SELECT/INSERT/PATCH/DELETE、RPC execute、Storage 路径枚举均测试；不是只测 Next API |
| 数据投影 | 抓取 JSON/HTML/RSC/React props，断言不含 finance_by_date、order_price、工资/银行/印章/其他司机 PII；选列固定、无 select(*) |
| 派单 | 同单跨日换司机、off_dates、取消、撤派、外包/未知司机、过期 version；只返回本人服务片段；撤派后立刻不可读/下载 |
| 状态机 | 合法逐步推进、非法跳步、重复 request_id、相同 ID 不同 payload、并发确认、时间异常；成功仅一条事件 |
| 日报 | 本人编辑、跨人攻击、提交后修改拒绝、驳回更正、审批身份限制、重复导入不计两次 |
| 拆分 | 全段移动、前/中/后拆分、跨月、日期移动、每日覆盖、在途/完成片段限制；订单/assignment/outbox 同事务回滚 |
| 财务 | 拆分前后日费/旧整单价总额守恒；超时旅报/工资独立；比例工资旧公式、JSON 其他字段及各报表不变 |
| 附件 | MIME 伪造、超限/恶意 PDF、EXIF、越权 key、跨地域/跨司机下载、签名过期、撤权、未完成上传、孤儿清理 |
| 缓存 | A 登录->登出->B 登录、浏览器后退/BFCache、SW 升级、离线重开、CacheStorage/IndexedDB/CDN检查；不得出现A私人数据 |
| PWA | iPhone Safari 主屏幕/横屏/安全区、Android Chrome 安装；无安装/推送权限仍可工作；拒绝定位；无离线写 |
| 审计 | actor/region/version/request_id 服务器生成、司机不能伪造/读他人审计；系统操作有显式来源 |
| 保留行为 | 现有 `tests/business-audit.test.mjs`、`supabase/tests/business_audit.sql`、`balance_other_income.sql` 全部回归（数据库测试只用隔离库） |

## 15. 测试行程接入进展（2026-10-27）

- 已在独立测试库应用 [003 行程扩展](../supabase/driver-pwa-test/003-driver-trips.sql) 的等价事务 SQL。新增显式单日 assignment、最小行程投影和带 version/request_id 的幂等接单 RPC；基础派单/事件表不对客户端开放。已执行 [事务测试](../supabase/driver-pwa-test/003-driver-trips-test.sql) 的等价12组检查，全部通过并回滚虚构夹具。
- 测试限定的保守同步规则：任何订单 UPDATE 都在同事务撤销其旧派单并记事件。它防止过期派单继续可见，但不是最终生产调度兼容方案；财务编辑也会撤派。正式版必须实现明确的原子拆分/改派，不能直接把此规则推广上线。旧7条订单未创建派单，旧数据地域仍不回填。
- 新增独立 `/driver/login`、`/driver`、`/driver/orders/[id]?assignmentId=...` 手机界面，及本人订单 GET、确认接单 POST。独立测试开关默认关闭；不使用 `/api/data` 或完整 Order DTO。API strict 参数、同源 JSON 写请求、错误状态、no-store，界面处理切账号/隐藏/返回重新鉴权。日报/通知/个人页尚未接入。
- 已从选定测试项目读取其公开 publishable key，写入被 Git 忽略的 `.env.driver-pwa.local`，不含服务密钥或密码；原正式 `.env.local` 未修改。独立3100服务已启动并验证 LAN 登录页200。首次启动 Next.js 提示当前版本有安全更新建议；未执行升级、未合并已有升级分支，生产仍需单独处理依赖升级。
- 用户手动创建测试登录账号并自设密码；只核验指定邮箱及确认状态，不读取密码。实际仅发现 `driver-a@pwa-test.example.com`，B账号未找到，未猜测或改动其他账号。
- 已执行 [A账号演示初始化](../supabase/driver-pwa-test/004-demo-driver-a.sql) 的等价 SQL，新增明确标记的虚构测试地域、司机A和今天/明天各一单。该受控 SQL 设置现有 staff admin 为初始化审计主体，不代表经过该管理员登录会话。没有改动旧后台账号或旧订单。
- 以A账号主体和 authenticated 数据库角色只读验证：本人身份1条、今日1条待确认、明日1条；is_staff=false，直接 orders 可见0条；另核实旧订单仍7条。新真实测试记录持久保留供用户手机验收，不再属于回滚夹具。
- 代码回归88项通过，相关 ESLint 和 TypeScript 通过；LAN HTTP 预览的 request_id 使用 getRandomValues 生成合法 UUIDv4，兼容无 randomUUID 的非安全上下文。手机正式安装仍要求 HTTPS。
- 仍未用用户密码完成真实手机登录/接单验收。用户可在同网络打开 `http://172.20.10.4:3100/driver/login`，用A邮箱及自行设置密码验收；地址随网络变化。B账号可后续补建用于真实双账号对抗测试。没有部署或修改生产数据库。

## 16. 测试行程执行进度（2026-10-27）

- 用户已在手机成功登录，确认可进入司机端；接单后的执行链路另行验收。
- 在独立测试库增量执行 [005 行程状态扩展](../supabase/driver-pwa-test/005-driver-execution.sql) 的等价事务 SQL。保留所有订单/派单/事件，扩展状态约束和事件版本字段，已有接单事件按确定的原始 `v1 -> v2` 补充版本，不改原 actor、时间或 request_id。
- 状态仅允许 `assigned -> acknowledged -> en_route -> arrived -> in_service -> completed`；现有接单 RPC 复用受控状态转换函数。沿用 order/link/assignment 锁顺序、active identity、地域和本人校验；撤派或挂起即使持有旧 request_id 也拒绝。
- 事件使用服务器 actor/时间；新增事件记录 expected/result version。相同 request_id 和完整相同参数返回原结果，即使该行程后来又前进了；改变 assignment、目标状态或版本则冲突。基础事件表仍不可直接读取或写入，匿名无 RPC execute 权限。
- 新增 `POST /api/driver/assignments/[id]/events`，只接受 state、expectedVersion、requestId，不接受客户端时间、司机/地域或费用。与接单共用 [请求校验](../lib/driver/assignment-action.ts)，保留同源、JSON、体积、strict schema、身份及 no-store；API 返回原操作结果，界面随后刷新当前状态，避免旧幂等结果覆盖新状态。
- 手机详情每次只显示下一合法操作，完成后无继续按钮；列表显示执行状态，已完成不再当作待执行推荐。记录执行时间不代表持续定位或轨迹记录，无任何财务写入。
- [005 事务测试](../supabase/driver-pwa-test/005-driver-execution-test.sql) 使用独立虚构账号、同地域其他司机和跨地域司机，不使用或修改手机A账号。测试结束回滚所有夹具。原003测试事件计数改为仅统计自己的夹具，避免用户手机接单后干扰断言。
- 验证结果：005等价SQL的9组数据库检查通过（含每步幂等重试和挂起后拒绝旧请求）；94项代码回归、相关ESLint和TypeScript通过。手机尺寸390×844登录页无横向溢出，匿名事件POST返回401/no-store，LAN登录HTTP200。事务后只读核实9订单、8司机、1地域、2派单，旧订单7条、新测试夹具Auth用户0条；profile当前4条，仅记录数量，不推断额外账号归属。执行链路数据库和详情渲染已测，真实手机逐步点击、双账号HTTP对抗和并发压力仍未验收。
- 边界不变：这仍是测试实现，订单任意编辑仍会保守撤销派单（包括在途/完成），不能作为正式调度方案；尚无服务日时间窗口限制、执行历史页面或纠错审批；完成按钮不可由司机自行撤回。不要用真实行程试运行。
- 回退方案：若验收失败，先停止3100测试服务或关闭测试模式，保留新增列和事件，不删除数据，不恢复旧的状态约束，也不要让不识别新增状态的旧客户端继续运行。根据审计记录做前向修复；不得把 completed 批量改回 assigned。正式迁移及正式回滚方案仍需在原子调度工程完成后单独评审。
- 手机写请求联调发现来源校验误拒绝：实际 Origin 为 `http://172.20.10.4:3100`、Host 为 `172.20.10.4:3100`，但 Next dev 的 request.url Origin 为 `http://0.0.0.0:3100`。已修正为仅独立测试且 development 下、该精确内部绑定允许列明的LAN/localhost/127.0.0.1来源，并必须匹配Host；不信任 forwarded headers，不放开任意来源，正式环境仍严格同源。界面展示接口的具体安全错误，不再统一掩盖为“未获确认”。29项相关测试、ESLint、TypeScript通过；仍待用户手机实际重试。诊断不记录密码、Cookie或行程正文，临时代理日志已移除。

## 17. 出入库式司机日报（2026-10-27）

**12:30规则更新：用户取消修改原因及修改内容留痕。下述006实施记录是历史状态，当前以本节“直接修改更新”为准。**

### 用户确认的规则

- 出库和归库按钮以服务器时间自动生成日期时间；日本时间，跨午夜仍归出库当天。一名司机同时只能有一份出库中的日报；归库后可新建下一份，不强制按午夜切分。
- 出库、经由地到着/出发、归库均录入**公里表累计读数**，最多一位小数，不是单段距离；归库公里表减出库公里表为全程公里数。
- 经由地逐站添加、到着、出发；也可手动补录/修正日本当地日期时间、地址和公里表，必须填原因并保留修改前后快照。时间/公里表成对填写、不能逆序、公里表不能倒退；不能补未来时间。
- 休息使用独立开始/结束按钮，累加多段明确休息，不把所有停车/等候算作休息。归库前必须结束所有经由地和休息。
- 默认营业所名称/地址以后再提供。目前账号没有默认地址，司机手填；已有默认配置时，出库/归库表单默认选择该地址，取消勾选可自由填写。不是自动定位。

### 已实现的测试范围

- 新增 [006 测试迁移](../supabase/driver-pwa-test/006-driver-reports.sql)：`driver_daily_reports` 保存出入库和经由地/休息，`driver_report_events` 追加服务器actor、request_id、命令、修改前后快照，`driver_report_depots` 仅保存各司机被分配的营业所默认地址。三表启用RLS并撤销客户端全部直表权限；默认地址只可通过受控数据库管理配置，尚无后台配置页面，司机不能修改配置。
- 两个受控RPC：`driver_reports()` 返回本人最近31份和本人默认营业所投影；`driver_report_command(...)` 处理出库、经由地、休息、归库和修正。每次验证active link/region/本人身份，以身份行锁串行化本人命令，检查expectedVersion，按完整命令校验幂等键。旧请求重试只返回原结果，客户端重新读取当前报告；挂起后旧请求也不允许执行。
- 每份测试报告上限100个经由地、100段休息，地址/原因300字符，公里表0至9,999,999 km。它们是测试版输入保护，不是正式营运工时规则。
- 新增 [日报页面](../app/driver/report/report.tsx) `/driver/report`、本人GET及命令POST `/api/driver/reports`，从我的行程/详情可进入。沿用测试开关、联网、同源写请求、strict字段、no-store和切后台清敏感内容/返回重鉴权；不缓存私人日报，不提供离线写入。
- 展示出库至归库总时长（含休息）、独立累计休息和全程公里数；出库中的时长随设备时钟实时显示，最终时长由服务器打卡时间差计算，不等于工资工时。跨午夜/跨年按完整时间戳计算，不截成24小时。
- 日报独立于订单执行状态，不引用或修改orders/finance_by_date、工资或任何财务表。本版没有费用申报、附件、后台审核/提交审批、司机可见修改历史列表或日报导出；修改留痕已保存到受限审计表，归库后仅可带原因修正已有经由地，不可继续出入库/休息打卡。

### 实施与验证

- 先只读确认测试库三张新表均不存在、旧订单9条/派单2条；再在 **zsipqwipauzgbqvppwjf** 执行006等价事务SQL，结果 `driver_reports_prepared`。投影函数标记为stable，因为timestamptz JSON输出受会话时区影响。没有改生产库、main或正式业务页面。
- [006事务测试](../supabase/driver-pwa-test/006-driver-reports-test.sql) 的等价9组检查通过并回滚：默认地址与自由归库、自动时间、唯一进行中、重试幂等、经由地顺序、公里表倒退、多段休息/重叠拒绝、非法补录/原因、同地域他人/跨地域访问、归库关闭、审计快照、直表和匿名拒绝、挂起立即拒绝。
- 另补2组回滚验证并合入同一测试脚本：仅对独立夹具模拟25小时前出库，手动补录经由地真实有效的到着/出发时间，再归库，确认25小时不切分且保留原服务日期；绕过Next直接RPC提交额外字段/null公里表均拒绝。累计11组数据库检查通过，未修改用户A的日报。
- 事务后独立只读核实：日报0、日报事件0、默认营业所0、c1测试Auth用户0；原订单9、派单2。没有给A账号制造已出库记录，留给用户手机体验。
- 106项代码回归（含既有业务、身份/行程、11项日报计算/API/渲染测试）通过，相关ESLint和TypeScript通过。跨午夜示例23:00至次日02:30为3小时30分，两段休息累计45分、142.5−100=42.5 km；超过24小时不回绕。
- 使用真实日报组件的自动生成**虚构静态渲染夹具**在360/390/844宽度检查表单、长地址和状态，无横向溢出。它不是已登录手机全链路验收；真实出库/经由地/休息/归库尚待用户在测试账号验证。未读取用户密码。
- LAN `/driver/report` 未登录正确跳到司机登录页；匿名 `/api/driver/reports` 返回401及private/no-store。原24份受保护文件中23份hash仍完全一致，数据库类型文件只作已批准扩展；main仍为`e84269ba956f355fe7455a735143283bb19f2bd5`。临时布局夹具已清理。
- 回退：停止测试服务/关闭测试模式，保留日报和审计。不要DROP新表、删除报告或将归库状态重置；已有记录通过受控前向修复保留历史。生产数据库迁移、正式审核与回滚需要另行授权。

### 直接修改更新（12:30后）

- 追加按钮改为左侧等宽“＋”“−”两键，右侧保留统一“保存修改”，均36px等高。＋继续立即保存新增空白行；用户确认−每次从下往上删一条全空经由地，无需确认或另点保存。前端同时检查服务器原记录及当前表单：地点、公里数（包括0）、到着/出发时间任意有值或原生输入无效，均跳过，防止误删未保存内容；没有空行时禁用或明确提示。增减均保留其他未保存内容及dirty状态，失败/脏表版本冲突不刷新清空表单。
- [017迁移](../supabase/driver-pwa-test/017-report-remove-blank-stop.sql) 只应用隔离测试库，新增严格 `remove_stop {stopId}` 命令，沿用本人/地域鉴权、行锁、版本及指纹幂等。数据库再次检查地址、两端公里/时间和plannedKm全空，只移除目标行且保持其他ID/顺序不变；非空、无目标、他人报告、旧版本均拒绝。[事务回滚测试](../supabase/driver-pwa-test/017-report-remove-blank-stop-test.sql) 返回 `blank_stop_removal_checks_passed`，覆盖删除最后/中间空行、幂等、非空/公里0拒绝、权限/版本、失败不变、删除后再追加及读取持久；45项日报/行程测试、相关ESLint和TypeScript通过，未改真实司机记录及生产。
- 顶部为两列紧凑手填表头：第一行日期／客数，第二行車両番号／運転手，第三行出勤点呼时间／退勤点呼时间。标签行距统一，六项输入框均36px等高，日期/时间控件处理原生外观差异；360/390/430宽度静态组件验证无横向溢出。两项点呼时间为可空的日本当地时分（HH:mm），允许跨午夜，不代替出库/归库时间，也不改变行程时长统计。旧日报默认为空，清空后保存为null。表头与出库/经由地/归库共用“保存修改”，首次出库一并保存；追加空白行不提交或覆盖未保存表头。車両番号/運転手最多100字符，可留空，客数可空或0–999整数；手填運転手仅展示，不更改登录身份及日报归属。
- [018迁移](../supabase/driver-pwa-test/018-report-duty-times.sql) 只应用隔离测试库，扩展既有header JSON并严格校验时分；省略字段的旧客户端保留原点呼时间，显式null可清空，不改原鉴权/版本/幂等逻辑。[回滚测试](../supabase/driver-pwa-test/018-report-duty-times-test.sql) 返回 `report_duty_time_checks_passed`，覆盖跨午夜、省略保留、清空和非法输入拒绝；46项日报/行程测试及TypeScript、相关ESLint通过。未部署或迁移生产。
- 用户确认表头日期作为实际日报日期：更改日期时，完整出库/经由地/归库及旧休息时间按日数整体平移，保留时分、秒/微秒、跨午夜关系及已完成日报的总时长/公里数；未归库的实时总时长仍随实际当前时间计算。只改时分仍按既有顺序换日规则，不为出库时分冲突自动搬移经由地；未来时间或顺序冲突明确拒绝，失败保留输入、不刷新。
- [016迁移](../supabase/driver-pwa-test/016-report-header.sql) 只应用隔离测试库，新增最小手填表头投影，保留原本人/地域鉴权、行锁、版本及指纹幂等；旧无表头命令兼容。[事务回滚测试](../supabase/driver-pwa-test/016-report-header-test.sql) 返回 `report_header_checks_passed`，覆盖首次出库持久化、集中改日期并归库、读取、重复请求、归库后再次改日期、人数0/null、8类非法数据全回滚及手填姓名不改身份；未修改真实司机记录或生产。42项日报/行程测试、相关ESLint和TypeScript通过；静态虚构组件在360/390/430宽度下四个表头框均36px等高、无横向溢出，历史默认折叠在汇总后；非真实iPhone登录全链路验收。
- 归库取消打卡：改为单行可编辑地点、公里数、到着列时分（出发列空），与上方输入框同高居中。用户选择“统一保存即完成归库，之后仍可编辑”，仅填HH:mm，早于最后一项则顺延次日；未改分钟且仍符合顺序保留原始秒/微秒。全空时不归库，部分填写明确提示补全，已归库不能清空来撤销状态；全部经由地及出库修改、归库三项通过 `edit_stops` 的可选严格 `return` 对象一次原子写入。归库后仍可改时间/地点/公里数，新增日报前有未保存内容时确认放弃。
- [015迁移](../supabase/driver-pwa-test/015-report-manual-return.sql) 只应用隔离测试库，沿用本人/地域鉴权、行锁、版本及指纹幂等，保留旧return命令兼容；手填归库须非未来、时间公里有序且经由地全完成，同事务结束旧手动休息。完整日期仍持久保存，不改工资规则。[回滚测试](../supabase/driver-pwa-test/015-report-manual-return-test.sql) 返回 `manual_return_checks_passed`，覆盖未完成拒绝、7类非法内容全回滚、经由地与归库同事务、重试、归库后更正读取及旧版本冲突；39项日报/行程回归、相关ESLint和TypeScript通过，未修改真实司机记录或生产。
- 追加空白行自动保存：用户选择仅新增自动保存、填写修改仍手动保存。点击“追加经由地”立即调用幂等 `add_stop` 保存全空记录，成功后直接显示正常可编辑行，不再有展开草稿、确认/取消追加；允许前项未填完仍继续追加（最多100行），请求中暂禁按钮防重复。新增不提交其他字段，也不清除已有未保存标志；稳定行/字段key保留输入，新增失败或脏表单版本冲突不清空编辑内容。原来的“未完成不能追加”规则被本条覆盖，归库仍须先补完全部记录。
- [014迁移](../supabase/driver-pwa-test/014-report-multiple-drafts.sql) 只应用隔离测试库，允许多个无实际时间草稿，但实际时间仍必须逐项有序，不能跳过前项未结束记录。[回滚测试](../supabase/driver-pwa-test/014-report-multiple-drafts-test.sql) 返回 `multiple_drafts_checks_passed`，实测100次空白追加及各次重试不重复、读取持久、第101条拒绝、空表归库拒绝、跳过未完成行填时间拒绝、全部补完后归库。36项日报/行程测试及相关ESLint、TypeScript通过；没有修改真实日报或生产。
- 修复出库编辑行与未归库输入行同时使用日报ID作为同层key，造成React重复key警告；分别以departure/return前缀区分，仍按日报切换重置表单。渲染回归检查所有同层显式key唯一，覆盖出库中和已归库状态；不改数据或保存规则。
- 取消经由地“时间打卡”及对应提示/按钮行；经由地只保留单行输入，手填到着/出发时分后统一“保存修改”。归库提示同步改为先填写并保存经由地出发时间。出库/归库打卡按钮及旧API动作保留兼容，不修改数据库；空白行保存、跨午夜推算、自动休息计算不变。
- 用户允许新增经由地四项全空保存：地点保留空字符串，公里数未填则不传、持久为null，不能转换成0；到着/出发仍为null，不伪造打卡。已保存空白行也可再次集中保存/补填，刷新读取保留。空地址仅允许未打卡草稿；填时间/打卡前必须有地点及有效公里数，未完成记录继续阻止追加和归库。[013迁移](../supabase/driver-pwa-test/013-report-blank-stop.sql) 已在隔离测试库应用，[回滚测试](../supabase/driver-pwa-test/013-report-blank-stop-test.sql) 返回 `blank_stop_checks_passed`，覆盖持久读取、幂等、空白再次保存、追加/归库/空地址打卡拒绝、补填后完整打卡归库；真实司机数据和生产未改。
- 出库记录支持直接编辑地点、公里数、出库时分，与经由地共用末尾“保存修改”。用户明确只改时分、不改原日本日期；未改分钟保留原始秒/微秒。`edit_stops` 新增可选严格 `departure` 对象，既有仅经由地调用保持兼容；[012迁移](../supabase/driver-pwa-test/012-report-departure-edit.sql) 沿用身份/地域/本人锁、版本及幂等规则，原子写入出库和所有经由地，只增一个版本，归库后亦允许。服务端拒绝改日期、未来时间、非法公里数、空地址及与经由地/归库时间公里顺序冲突；不自动挪动经由地日期来迎合出库更改。完整日期仍留在标题，出库编辑时分居中且34px等高，新增草稿期间暂禁编辑。
- 出库编辑验证：012仅应用隔离测试库，[回滚测试](../supabase/driver-pwa-test/012-report-departure-edit-test.sql) 返回 `departure_edit_checks_passed`，覆盖无站修改、出库+经由地原子修改、9种非法输入/顺序冲突及失败不写、幂等、旧版本、归库后修改。33项日报/行程回归、相关ESLint和TypeScript通过；没有修改真实司机日报、生产或部署。
- 输入框高度兼容修正：所有记录输入显式使用border-box、34px最小/最大/实际高度、零外边距及统一28px内容行高；时间控件取消WebKit原生外观，其内部日期时间编辑区域同步28px高度和零内外边距，避免只统一表格行高但手机时间控件视觉高度仍不同。时间仍居中、可直接选择，不更改输入值或打卡逻辑。
- 记录行统一40px：出库/经由地/归库各字段过长时保持单行截断，静态内容显示省略号，不因完整地址或公里数换行增高；输入框仍保留完整可编辑内容，默认营业所选项也限制单行高度。不截断存储数据。
- 出库/归库统一为与经由地对齐的单行：地点、公里数、到着、出发，不再另列日期/时间行。出库时间放出发列、归库时间放到着列，仅显示HH:mm；完整日期仍留在日报标题和数据中。未打卡对应时间暂显示破折号，服务端打卡方式不变。所有时分输入及记录时间居中显示。
- 经由地址栏再加宽：到着/出发各固定56px，地址占剩余宽度，公里数维持18%；保持单行40px及原输入字号。360/390/430宽度实测地址列约81/106/139px，时间列均56px，无横向溢出；19项日报回归通过。
- 经由地再压缩为一行：地址、公里数、到着、出发从左到右排列；新增空白记录保持相同五列表格（含窄项目列）。移除经由地之间加粗分隔和独立时间行，末尾统一追加/保存按钮。时间输入只保留 `HH:mm`，用户选择以“早于前项自动顺延次日”处理跨午夜；新增以上站出发或出库为基准，批量修改按新结果依次推算。未改时分且仍符合顺序时保留原始完整日期与秒/微秒，避免旧记录无意丢精度；同一分钟的新记录不早于前项实际秒数。服务器仍接收完整带时区时间，未来及归库时间限制照旧，休息按完整时间计算；无数据库迁移。
- 本次单行布局验证：32项日报/行程测试、相关ESLint和TypeScript通过，含跨午夜/月末/年末、保留原始微秒和顺序换日后休息时长。使用真实3100编译CSS搭配虚构组件，在360/390/430宽度确认既有/新增记录都为40px行高、34px输入框，四个字段同排、跨单元格表单关联完整，无横向溢出；未代替真实手机登录验收。
- 追加交互简化：点击“追加经由地”立即在同一表格生成空白地点/公里数行和到着/出发时间行，末尾统一“保存修改”提交；不再显示“确认添加”。空白草稿不先写数据库，可“取消追加”，失败保留四项输入。新增草稿期间暂禁已有行编辑和归库，避免新增保存覆盖未保存修改；切换日报和刷新仍提示放弃草稿。复用既有原子 `add_stop`，不改数据库规则。
- 表格统一保存：取消逐段“保存修改”，改为最后时间行下方与“追加经由地”并排的唯一按钮，等宽、36px等高。已归库日报保留集中修改入口。`edit_stops` 一次提交全部现有经由地，同ID、顺序及数量；数据库锁定本人日报并校验完整时间/公里顺序，一次写入、只增一个版本，任一项失败全部不写。旧 `edit_stop` 保持兼容。[011迁移](../supabase/driver-pwa-test/011-report-table-save.sql) 只应用隔离测试库；[回滚测试](../supabase/driver-pwa-test/011-report-table-save-test.sql) 覆盖相邻时间同步调整、幂等、非法整批回滚、过期版本及归库后修改。
- 保存成功直接合并服务器返回日报，不清空表格、不触发额外GET；错误保留编辑内容，冲突需明确刷新核对。编辑未保存时暂禁打卡、归库和追加，避免覆盖其他段；切换日报/刷新前提示放弃确认。稳定行标识，字段随各自服务器值更新，不再因整个日报版本变化重建所有行。分钟输入未变时仍保留原始秒/微秒、旧不同两端公里数。批量API允许至131072字符、最多100项；其他动作仍限4096字符。
- 集中保存验证：隔离测试库011已应用，事务回滚测试返回 `table_save_checks_passed`，未保留虚构日报；31项日报/行程回归、相关ESLint和TypeScript通过。真实3100编译CSS搭配虚构组件，在360/390/430宽度实测两个按钮分别为130/145/165px，均36px高，无横向溢出。这是布局与接口/数据库验证，不代替用户手机真实登录验收；没有生产变更。

- 用户进一步降低行高：输入框34px、按钮36px、基础记录行40px，单元格上下padding降至2px；字体保持16px输入/13px按钮，长内容自然换行。覆盖上一版40px控件/48px基础行规格。
- 紧凑等高调整：日报内地点、公里表、日期时间输入框和操作按钮统一40px；基础地点/记录行最小48px，双时间行共享同一标签及输入高度。取消经由地公里表上方重复标题（保留可访问名称和表头），缩小单元格内提示/按钮间距。内容过长仍可自然增高，不裁剪地址/错误，不改变打卡和保存逻辑。
- 最新追加交互覆盖此前modal方案：点“＋追加经由地”后，在同一表格当前位置直接展开待保存表单；上排地点/公里数，下排到着/出发日期时间，不使用弹窗或遮罩。确认添加仍一次原子保存四项，时间可留空，失败保留输入并行内显示错误，取消不写数据库。追加入口保持在最后一个时间行下方；已存记录、010协议和自动休息统计不变。
- 追加弹窗现同时显示经由地、公里数、到着日期时间、出发日期时间四项。两个时间可留空后打卡，可只填到着或补齐到着/出发；不允许只填出发或出发早于到着。填写时间按日本时区转换，显示到分钟；API和010命令函数一次原子新增地点/公里表/时间，不拆成多次保存或自动伪造当前时间。填齐时间的停留时长直接进入自动休息统计。错误在弹窗内可见，失败保持输入，成功才关闭。
- 010仅执行隔离测试库，回滚验证8类非法输入（无到着、逆序、未来、早于出库、类型、缺offset、缺公里表、公里倒退）均拒绝，完整补录一次递增版本、幂等重试、只到着/空时间后续打卡和归库通过。28项代码测试与ESLint/TypeScript通过；生产未修改，未创建司机真实日报。
- **当前休息规则覆盖006手动休息方案**：经用户确认，累计休息仅为各经由地到着→出发时间差之和，未出发按当前时间实时显示，修改时间后重新计算。旧`rests`不再纳入统计，UI移除手动开始/结束休息，API拒绝新手动休息命令。已有历史不删；008在归库时原子结束可能遗留的手动休息，避免隐藏按钮后无法归库，旧RPC分支保留兼容。测试库008已应用，回滚检查覆盖有/无旧休息的归库及重试。显示含等候的停留时长，不宣称法定劳动休息。
- **追加弹窗**：点“＋追加经由地”后使用原生modal dialog填写经由地与单个公里数，支持取消/确认及浏览器输入校验。用户选择只保存地点和公里数，**不自动到着打卡**。009保存可选`plannedKm`于当前stop JSON，API严格schema同步支持；旧无公里数命令兼容，未到着仍保持`arrivedAt/arrivedKm=NULL`，不能伪造时间配对。行内公里数优先显示实际记录，再读待打卡读数；直接修改未到着地点也能保存公里数。服务器验证类型、精度、范围及不可低于上一地点公里表，顺序/身份/版本/请求指纹保护保留，旧记录无批量修改。
- 008、009仅应用隔离测试项目。009事务回滚检查覆盖倒退/字符串公里表拒绝、添加不打卡、重复提交、重新读取、修改待打卡公里数、到着→出发→归库。28项日报/行程代码测试、ESLint、TypeScript通过；新增弹窗交互与失败不关闭/成功关闭测试，保留单表连续布局。
- 追加入口保持连续：只在最后一个经由地的到着/出发时间行正下方显示“追加经由地”，不插入独立卡片；新增成功后自动随最后一个地点下移。没有经由地时入口紧接出库，归库后隐藏；原有上一站出发后才可追加的校验不变。
- 公里数后续简化覆盖此前双输入：每个经由地右侧仅一个“公里数”（仍是公里表累计读数），到着打卡后出发沿用已填值，可按需修改。直接补录时同一读数用于已填写时间的两端，未填写时间的一端保持NULL。现有历史若两端不同且只改地址/时间，保留原始两读数；司机明确修改公里数才同步两端。不迁移或删除已有记录，API/数据库仍使用兼容的两端字段和原有顺序校验。
- 手机截图反馈表格数据存在，但网格/输入框样式未应用；服务器共享CSS包含规则，尚未直接确认手机缓存状态。将日报专用规则移入日报组件显式导入的`report.module.css`，限定在模块根节点下，提高页面与样式加载一致性，不改全局后台CSS或权限。验证实际Next编译生成的模块CSS响应200，并用同源开发服务器的全局CSS、司机CSS和模块CSS加载虚构组件：360/390/430宽度下固定表格布局、单元格/输入框边框和时间grid全部生效，无横向溢出。此前纯静态CSS预览不能代替实际样式管线验证；仍待用户手机刷新确认。
- 经由地最新单元格排列：缩短地点输入至中间一列，右侧放到着/出发公里表；下方到着时间、出发时间两列平铺，日期时间仍合并且精确显示到分钟。不合并两次公里表数据，打卡和直接修改协议不变。
- 最新排列覆盖此前分组小表：出库→各经由地→归库全部放进**一张HTML表格**，只保留一组表头和连续单元格边框；地点占一行，下面按同一日期时间/公里表列填写，到达与出发仍各一行。归库输入、默认地址选择、归库打卡也在表格末尾；已归库显示最终地点/时间/公里表，不重复放在汇总卡片。表格内各段使用独立form ID关联单元格输入和按钮，避免表格内嵌套表单，仍分别提交原有受控命令。已归库后点“开始新一次出库”进入空白出库表格，不将两次日报混写。
- 单表验证：26项日报/行程测试、ESLint、TypeScript通过；断言每份日报只有一张表/一组表头、出库→经由地→归库顺序、首份及下一次出库的空白表格。浏览器360/390/430像素无横向溢出，检查跨单元格form关联及FormData字段完整，LAN入口200。未新增司机真实打卡数据。
- 出库与经由地合并为同一“出库 · 经由地”区域：未出库时紧凑并排填写地点/公里表并打卡；已出库后，第一条显示出库地点、分钟时间和公里表，下面接经由地及添加入口。默认营业所选择保留，出库仍是独立的服务器打卡命令，不作为经由地重复写入或开放修改。时长/休息/距离移至后面的“本次汇总”；历史日报与新一次出库保持区分。
- 后续简化：经由地只保留一个统一名称的“时间打卡”按钮，自动按到达→出发顺序执行，小字提示本次记录的时点，不再切换“一键到达／一键出发”按钮名称。两次完成后不再显示打卡按钮；直接补录的“保存修改”保留。
- 手机经由地改为集中式紧凑表格：每个地点一组，地址在上方，到达／出发各一行，合并的日期时间与公里表并排。日期时间使用单个`datetime-local`输入，精度到分钟；日报其他时间显示也省略秒。所有修改字段直接展示，“保存修改”提交；填写对应行公里表后点击“一键到达打卡／一键出发打卡”，仍由服务器自动记时，无需手填时间。仅隐藏秒，不截断原始服务器时间，未改分钟的时间保留原始秒及小数秒，避免只改地址引起时间顺序冲突。添加下一经由地也收在同一区域。不改数据库、API及校验规则。
- 紧凑表格验证：25项日报/行程测试、ESLint、TypeScript通过；新增提交测试覆盖未改时间时保留隐藏的秒/小数秒、无效日期拒绝、跨日分钟时间转换、空/无效公里表不可打卡。真实组件虚构数据在360/390/430像素宽度下无横向溢出，LAN日报入口响应200；不代司机新增实际打卡。
- 已从经由地表单、客户端命令schema、API错误提示和数据库RPC同步移除原因要求；按钮改为“手动补录／修改”“保存修改”，不显示留痕提示。
- 通过 [007测试迁移](../supabase/driver-pwa-test/007-report-direct-edit.sql) 前向替换命令函数，只在隔离测试库执行。后续命令不再存完整payload或修改前后快照，`before_data=NULL`、`after_data={}`；command仅保存SHA-256指纹，保留report/actor/request_id、时间和当前报告版本以防重复提交及冲突，不是可还原修改内容的历史。当前日报仍正常保存司机填写的最新地点、时间及公里表。
- 为不保存旧内容，幂等重试返回本人报告**当前投影**，而非原请求当时的快照；相同request_id不同参数仍拒绝。旧记录不删除、不重写；旧版完整命令的匹配保留兼容，旧客户端携带reason的新修改请求不再支持，需刷新页面。归库后可直接改已有经由地，时间先后、公里表和本人权限限制不变。
- 原006回滚测试标注为007之前的历史测试；新增 [007回滚测试](../supabase/driver-pwa-test/007-report-direct-edit-test.sql)，5组全部通过：无原因直接编辑/重试、参数和版本冲突、未来时间/倒退公里表拒绝、归库后修正、逐条断言无前后快照/完整命令正文。全部夹具回滚，未改用户日报。24项相关代码测试、ESLint与TypeScript通过。
- 不执行历史清理，也不将其他业务审计或行程执行事件一并关闭。本次只取消日报修改原因及修改内容历史；生产未变动。

## 18. 本阶段结论

手机联调修正：Next.js 16 开发资源默认拒绝 LAN Origin，导致 HMR 连接失败、客户端未正常激活，登录页有内容但按钮无响应。仅在独立测试配置增加精确 `allowedDevOrigins: ["172.20.10.4"]`，网络地址变化时需更新并重启，禁止通配开放。开发模式下仅 `/_next/hmr` 跳过 Auth 代理；生产模式、业务页面/API 和相似路径仍保持原门禁。已补配置与门禁回归检查，浏览器已观察到登录提交及明确密码错误提示；真实A账号密码仍由用户保管和验收。

可复用现有认证、地域、财务、审计和报表。用户已确认不做同地域内公司隔离，但**仅有地域隔离仍不足以限制司机本人权限**。最大前置工程是受信司机身份、地域一致性、数据库最小权限、事务化派单及隐藏敏感列，不是先写 manifest 或移动页面；不再以租户模型作为前置工程。

司机端未部署生产；生产实际约束与数据仍未核实。手机登录和行程状态更新已获用户确认正常，出入库式日报及下述财务工资测试版已实现。最终原子调度、双账号HTTP对抗测试、日报审核/附件和PWA安装仍未完成，不可上线。所有生产操作仍需用户另行批准。

## 19. 财务工资测试版（2026-10-27）

- 页面顶部用“立替申报”“月工资”两个按钮切换，默认立替申报；月份共用，切换不提交、不刷新、不丢弃当前申报草稿。
- 入口：司机首页第三板块及日报页的“财务工资”，路径 `/driver/finance`；测试管理员独立审核入口 `/driver-finance-review`。两者只在隔离测试模式开放，未部署正式预约系统。
- 先选月份、用车日期和本人已完成订单，再点击“社报”或“旅报”添加明细及日元金额，填写小数超时小时（如1.5）；当天分类合计覆盖所有已跑订单。合计明确包含待审、退回及当前草稿，不代表已报销。
- 每明细最多5张JPG/PNG/WebP票据，单张不超过5MB，允许无票据；每次最多50条明细，金额及总额不超过99,999,999,999,999日元，超时0–999小时、最多两位小数。可从未提交明细移除票据，或删除整条费用。
- 提交后是待审，不更改订单财务或工资。管理员确认时，社报/旅报分别**追加**到当日 `driverAdvanceCompanyReport` / `driverAdvanceTripReport`，不是会社立替字段；超时小时**替换**原值，工资单价仍由后台设定。初次选订单带入后台现有超时小时，避免只报费用时意外清零。管理员应先核对是否已手工录入同一票据。
- 同一订单派单只保留一份当前申报；待审/已确认不可改，退回须有原因，司机可修改重提。提交带版本及请求ID，同请求同内容重试不重复创建，不同内容复用ID明确报冲突；重复审核不重复追加。审批前核对财务基线，期间后台改过相关金额、司机或单价则拒绝批准，需退回后重提，避免覆盖。
- 月工资只读，复用后台“地域＋司机姓名”工资归属及每日固定/比例、奖励、超时公式，包含后台已有手动加减项；与可申报订单列表分开，不限于完成派单。只返回本人金额、日期和加减项目名称，不返回客户收费、成本、利润或其他司机信息；同地域存在重复司机名则拒绝读取并要求管理员处理。工资是后台当前核算值，不代表已结算/已支付；司机立替单独列示，并按后续用户确认计入应发金额。
- [019迁移](../supabase/driver-pwa-test/019-driver-finance.sql) **仅应用 `zsipqwipauzgbqvppwjf`**。测试库原来没有手动工资表，因此建立与现有后台兼容的 `driver_wage_items` 并限制staff访问；仅在已有通用审计函数时接入其触发器。申报及审核另有不可由司机直接读取/修改的快照事件记录。
- 测试撤派触发器只对不改变实际司机、车辆、车牌、费用归属的纯财务更新放行；其他订单字段或每日派单字段变化仍撤派。兼容测试库没有整单 `vehicle_plate` 列，不新增或猜测该列。
- 票据存入私有 `driver-finance-receipts`，路径为本人Auth ID/派单ID/随机文件ID。司机只可上传本人已完成且可申报的派单，管理员仅可读；待审及确认后不能继续上传。查看使用60秒签名URL，退出登录/隐藏页面清掉图片和敏感状态，在途异步响应不能恢复旧会话数据。原生手机照片选择器短暂隐藏页面时保留草稿，避免选照片导致填写内容消失，退出登录仍清除。
- 普通切后台会丢弃未提交草稿，页面有提示；切日期、订单、月份或刷新前确认放弃。未提交或移除的上传对象不会自动从Storage物理删除，保持私有且不可覆盖；当前测试版**尚无自动孤儿对象清理任务**，管理员清理时必须用Storage API并排除所有当前申报及历史快照引用，不能直接删除Storage数据库元数据。
- [事务回滚测试](../supabase/driver-pwa-test/019-driver-finance-test.sql) 覆盖本人归属、最小工资投影及手动项目、非法输入、无票据提交、票据路径/存在性、待审不入账、批准追加、超时工资、重复请求/批准、后台基线冲突、退回重提及财务变更不撤派/司机变更撤派；全部虚构夹具回滚。另确认RPC和撤派修复已持久化，而非随测试回滚。
- 新增13项财务回归，连同46项日报/行程测试共59项通过；预约业务75项回归、TypeScript及相关ESLint通过。360/390/430布局用真实组件和虚构数据检查；本地3100入口正常，尚未代替真实司机登录、真实照片上传和手机验收。没有生产数据库变更或生产部署。

### 19.1 立替按分类独立提交（后续用户确认，取代上面的整单一次提交规则）

- 月工资将奖励工资、超时工资分行列示，卡片最底部显示“应发金额”＝基本＋奖励＋超时＋手动加减＋后台已记司机立替；按日明细也包含当日立替，待审申报不计入，不代表已支付。
- 费用明细与金额同一行，左明细右金额，列宽3:2、间隔8px、输入36px等高，金额右对齐；照片仍在下一行。
- 交互顺序：选择用车日期 → 选择当天本人已完成订单 → 上下两张独立的“社报立替／旅报立替”卡片 → 超时及燃油费 → 最下面“司机立替汇总”。两张卡同时显示，各有明细、金额、照片、审核状态及保存按钮，不再通过分类按钮切换。汇总是所选日期全部订单，分别显示社报、旅报及合计；仍明确包含待审/退回/草稿，不是已报销金额。
- 社报和旅报各自独立保存提交、独立版本、独立审核。保存社报不会锁住旅报或清除另一类草稿和照片。原有超时填写保留在单独区域，单独提交/审核，不随社报/旅报保存覆盖后台小时。
- [020迁移](../supabase/driver-pwa-test/020-finance-categories.sql) 只应用隔离测试库，将申报主键改为派单＋分类，分类为company/trip/overtime；每类仅允许自己的明细或超时，审核只写本类财务字段。审批基线仅比较本类金额或超时字段及费用归属，司机仍单独核验，因此批准社报不会使旅报或超时过期。
- 既有019申报按分类拆分，保留状态、版本、备注和原始审核时间，不再次入账；原事件快照保留。旧无分类写RPC移除，新RPC必须带category，旧客户端不能误按整单提交。
- 新照片路径为本人Auth ID/派单ID/company或trip/随机文件ID；上传权限只检查本分类状态，一类待审不妨碍另一类上传。旧路径仍可私有读取，旧申报退回重提时只接受原同分类明细已引用的旧照片；新上传不能用旧路径绕过分类锁定。
- [020回滚测试](../supabase/driver-pwa-test/020-finance-categories-test.sql) 验证分类版本/照片权限、非法混类、互不锁定、只审批一类不改变其他类、独立退回重提、跨司机拒绝、幂等/重复审核、只读工资与订单财务一致及派单撤销保护。019测试为旧协议历史测试，020后使用020测试。
- 17项财务回归（含按分类API、司机独立保存、同单多分类后台审核、页面顺序及汇总），TypeScript和相关ESLint通过；既有46项日报/行程回归通过。360/390/430虚构数据组件无横向溢出。未使用真实司机身份/照片完成验收，未改生产、未部署线上。

### 19.2 当日快捷选择及燃油费关联订单

- 日期旁增加“当日”，按日本日期切回今天；跨月自动切换月份，同日点击不清草稿。切换立替订单保留当天独立燃油草稿，切日期／月份／刷新仍确认放弃未提交内容。
- 超时下方增加“当日燃油费”及最多5张油票（可无票据，单张5MB以内的JPG／PNG／WebP）。按用户确认采用公司支付／油卡口径，每位司机每天一笔，必须指定当天本人已完成的一张订单；不自动分摊至当天其他订单。
- 保存只是提交待审，不改变订单成本。后台批准后，同一事务把金额追加至指定订单当天 `finance_by_date[date].fuelCost`，原有订单财务统计直接读取此字段，无需新增统计口径。版本／幂等请求避免重复入账，审核比较提交时燃油费基线，后台已调整则拒绝批准，需退回重提；提醒双方不要重复手工录入同一费用。
- 燃油费不作为司机立替加入应发金额；原有比例工资的成本扣减公式不变，燃油成本可能影响比例工资。固定工资不因本项增加或减少。
- [021迁移](../supabase/driver-pwa-test/021-driver-daily-fuel.sql) 只应用隔离测试库。每日燃油及事件快照表不允许司机直接读写；专用RPC校验身份、地域、订单归属及完成状态。油票私有桶为 `driver-fuel-receipts`，路径为本人Auth ID／日期／随机文件ID；待审／批准后不能追加上传，查看使用60秒签名URL，沿用退出与隐藏清理保护。未引用上传对象的清理限制同19节。
- [021回滚测试](../supabase/driver-pwa-test/021-driver-daily-fuel-test.sql) 使用全合成夹具验证日唯一、指定订单、跨司机拒绝、照片权限、待审不入账、批准仅追加指定订单当日、重复提交／审核、基线冲突与退回重提、固定工资及立替不变、审计快照和不撤派。未修改生产系统；真实司机登录及手机实拍上传仍需单独验收。

## 20. シフト提出（司机希望休）

- 司机端各业务页最上方统一显示“行程／日报／财务／シフト”四个按钮，一排四列并高亮当前板块；行程详情也提供相同导航，登录页不显示。切换日报、财务、シフト前确认放弃未保存草稿，保存或上传期间禁止切换；原分散的跨板块快捷入口移除。
- 行程列表在“明天”后增加日期选择框，与今天／明天共用所选日期，按日本服务日期查询本人有效派单。换日期立即清空旧列表后重新读取，窄屏控件自动换行；详情页不显示日期筛选。

- 司机端最后一个入口为“シフト提出”。按月显示日历，可多选希望休息的日期，日历下方填写本月备注（最多1000字）。提交后可修改重提，整月替换但不影响其他月份；允许空日期列表，用于撤销本月全部希望休或只提交备注。
- 用户确认：**提交立即生效，无需后台批准；只提示，不禁止选任，也不弹二次确认**。未提交草稿不影响后台，切月份或返回前提示放弃修改；切后台／退出清除草稿和私密状态，晚到响应不能恢复旧会话数据。
- 共用司机选任卡片右下角显示红色“休”，悬停／无障碍文字列出匹配的希望休日期。按司机ID匹配，不使用姓名猜测。新建／编辑整单、列表／日历订单及批量选任采用实际服务日期，排除休运日；逐日行程／财务采用对应日期，而不是今天。多日订单只要任一服务日匹配即提示；纯工资司机筛选不提示。
- 选任弹窗每次打开读取最新已提交日期；读取失败明确警告并提供重试，不将失败当作“无休”。后台仅收到司机ID与日期，不返回司机备注。普通后台账号仅本地域，管理员可跨地域，司机无法查询其他人的休息日期。
- [022迁移](../supabase/driver-pwa-test/022-driver-monthly-shifts.sql) 只应用隔离测试库，新增本人每月一条记录、版本与幂等请求、全量事件快照。表开启RLS且拒绝客户端直接读写；专用RPC校验有效司机身份、月份内日期、去重、版本及后台角色／地域。
- [022回滚测试](../supabase/driver-pwa-test/022-driver-monthly-shifts-test.sql) 验证本人／跨司机隔离、后台地域最小投影、跨月和重复日期拒绝、同请求重试不重复写入、过期版本冲突、即时提示更新与移除、空列表撤销、月份互不影响、暂停身份拒绝及审计权限；全合成夹具回滚。13项シフト回归，连同预约／司机回归共162项通过；TypeScript、相关ESLint通过（预约回归文件原有未使用变量警告未改）。360／390／430宽度日历无横向溢出，日期按钮48px高，备注位于日历下方。
- 仍仅测试端，无生产数据库变更或线上部署；真实司机登录提交与调度现场选任需用户验收。

## 21. 運転士登录管理及可跳过的首次资料填写

- 用户确认：密码仅在设置／重置输入时可显示，保存后不回显原密码；不存储可恢复的明文密码。携帯番号、微信号、WhatsApp、免許有効期限四项**全部可选**，首次登录允许跳过，之后从行程页“个人资料”补填。
- 運転士列表增加“登录邮箱／登录密码”列。仅管理员在隔离测试环境可创建独立司机账号及重置密码；已绑定邮箱只读，重置不改变邮箱、身份和启停状态。未登记为正式司机记录的历史姓名不能直接建账号。未配置账号管理密钥时显示明确提示并禁用创建／重置，不显示“操作成功”。
- 邮箱／密码不进入普通drivers集合，不写入浏览器持久存储。后台列表通过专用管理员RPC只读关联Auth邮箱和绑定状态，不读密码哈希；密码仅发送服务端Auth Admin API，保存／失败／隐藏／退出后清空输入和可见状态，不在日志中打印请求或认证错误对象。
- 创建先校验真实司机、再由服务端创建Auth用户、最后复用现有 `bind_driver_identity`。默认pending、role=user，绑定后才能使用司机端，不授予staff权限。邮箱冲突不接管、不改动已有账号；创建成功但绑定失败明确报告用户ID及部分完成状态，不自动重试创建，需管理员核对并完成绑定。密码重置校验司机ID、已绑定用户ID及版本，撤销身份拒绝重置。
- 登录通过有效司机身份核验后读取本人资料提示状态；首次进入资料页，保存或“暂时跳过”均记录已提示。跳过不清除后台已有联系方式及免許日期；保存仅更新这四个字段，不能修改姓名、地域、邮箱或角色。资料直接同步原drivers记录，版本避免本人多窗口覆盖。资料页／导航允许离开，未保存修改先确认。
- [023迁移](../supabase/driver-pwa-test/023-driver-login-profile.sql) 只应用隔离测试库，新增本人资料提示／版本记录及专用RPC。司机身份失效或暂停后不可读写，原drivers表仍保持staff限制，司机不获通用集合读取权限。[023回滚测试](../supabase/driver-pwa-test/023-driver-login-profile-test.sql) 验证管理员邮箱投影无密码、跨司机隔离、跳过保留原资料、全空可保存、字段同步、版本冲突、额外字段拒绝及暂停身份拒绝；夹具全部回滚。
- 测试启动器默认继续清空所有继承和普通dotenv中的服务密钥。仅可在被Git忽略的 `.env.driver-pwa.local` **显式**添加本隔离项目的 `SUPABASE_SERVICE_ROLE_KEY`（legacy service-role JWT或 `sb_secret_` 密钥），不可复制生产凭据。legacy JWT必须匹配 `zsipqwipauzgbqvppwjf` 和service_role；`--start` 还向该隔离项目Auth Admin接口验证密钥后才启动，响应正文／密钥不输出。配置后需重启3100进程；`--check` 仅检查配置格式，不做联网权限验证。
- 当前未配置该可选隔离管理密钥，未创建真实司机账号或实际重置密码；Auth Admin创建／重置使用mock测试验证，需配置后以测试账号完成端到端验收。普通3000／生产环境仅显示未开放提示，不调用新数据库函数。没有生产迁移或线上部署。
- 本次193项预约／司机／身份及启动器回归通过，TypeScript与相关ESLint通过；023事务回滚检查通过并再次核验函数持久、合成夹具未残留。资料页360／390／430宽度无横向溢出，四项均无必填限制且保留跳过按钮。

## 22. 日报按当天订单带入车辆、司机和车库

- 新日报按表头日期读取当前登录司机当天的有效派单，不要求先完成行程。只有一单时自动带入，多单时用户先选择订单，再带入車両番号及车辆所属会社的车库地址；運転手默认当前司机姓名。三项均可手动修改，首次出库一并保存；手填姓名不改变日报归属，也不回写订单、车辆或会社资料。
- 使用订单当天 `finance_by_date` 的车辆／番号，未设置逐日字段时使用整单字段。按同地域車両番号精确匹配车辆；没有番号时只接受唯一同名车辆。车库读取该车辆 `owner_company` 对应同地域会社的 `garage_address`，不使用订单签约会社或司机旧营业所配置。资料缺失或匹配不唯一时明确提示手填，不猜用其他车库。隔离库仍有旧 `orders.plate` 字段，因此读取时兼容该旧字段及正式 `vehicle_plate`，无需修改既有订单表。
- 这些值只是新日报输入默认值，不改变已保存报告。多单未选择时暂不能出库；当天无派单时提示手填，仍可新建日报。切换日期清除旧订单和默认值，取消旧请求，晚到响应不能重新带入其他日期；加载失败明确提示刷新，不当成“无订单”。更换订单前若有草稿先确认，只重带车辆番号和地址，不清其他输入的公里表、客数或点呼时间。
- [024迁移](../supabase/driver-pwa-test/024-report-order-defaults.sql) 只应用隔离测试库，新增本人只读 `driver_report_defaults(date)`。复用有效派单范围，排除撤派、取消、休运及范围外日期，仅返回日期、本人姓名与选择订单所需最小字段；身份暂停和匿名拒绝。专用GET API严格校验唯一日期参数、拒绝司机／地域选择器，返回private/no-store。
- [024事务测试](../supabase/driver-pwa-test/024-report-order-defaults-test.sql) 返回 `report_order_defaults_checks_passed`，覆盖逐日换车、同车型不同车牌、所属会社车库、资料缺失、同名车辆歧义、跨地域会社不泄露、本人／他人和日期范围、撤派／暂停／匿名拒绝、手填内容保存后不被默认查询覆盖。独立复核函数持久且夹具全部回滚。
- 50项日报／行程回归、TypeScript及相关ESLint通过，包含多单选择、手动修改值实际提交、无订单、加载失败及取消旧请求。真实组件静态示例在360／390／430宽度无横向溢出，三个默认字段均可编辑；不是已登录司机端到端验收。未部署线上或修改生产数据库。

## 23. 订单财务显示已批准司机小票

- 用户确认**仅显示已批准的小票**。订单财务弹窗每张订单、每个服务日期下显示紧凑小票区，分别标注社报立替、旅报立替及燃油费；多日和批量订单使用当前分区的真实订单ID／服务日期，不将油票分摊至同日其他订单。未审核、驳回、未提交照片不显示；没有照片时明确显示暂无已批准小票。
- 正式上线后布局调整：小票区从日期摘要下方移至「立替费用」内的「出金备注」正下方，普通及批量财务共用布局，每个订单／服务日仍只挂载一次。出金备注输入框从 `h-24` 缩为 `h-12`（96px→48px），取消桌面端伸展，保留1000字限制及滚动编辑；不改变小票权限、审核或业务数据。
- 订单财务统计对话框的司机选择、费用类型及工资快捷入力集中到「当日车费」下方的同一蓝色信息区；普通及批量订单共用。快捷输入复用财务草稿更新，金额输入会切换为固定工资并保留奖励／超时工资；社报类型禁用工资快捷输入，原详细工资设置和司机选任保存保护保持不变。
- [小票组件](../components/order-receipts.tsx) 使用52×60缩略图，点击打开原生模态大窗，图片按窗口等比显示，支持关闭按钮、Esc及点击遮罩关闭，不触发表单提交。图片加载失败明确提示刷新。只读展示，不改变金额、审核状态、报销或工资。
- [025迁移](../supabase/driver-pwa-test/025-order-approved-receipts.sql) 只应用隔离测试库，新增 `staff_order_receipts(order,date)` 最小投影及已批准小票Storage读取策略。普通staff仅本地域，管理员可跨地域，司机／匿名不能调用后台投影；保留原司机本人和管理员审核票据权限，不公开存储桶。已记账的批准小票在后来撤派后仍保留订单历史关联。
- [GET接口](../app/api/order-receipts/route.ts) 严格校验唯一订单ID和日期，拒绝path、司机和地域注入；仅对受控RPC返回的小票生成300秒私有签名地址，部分签名失败也明确报错，不伪装成无小票。前端240秒重读、刷新或切后台清除图片地址／大窗；旧请求取消，晚到响应不能恢复退出后的数据。非测试环境直接返回未启用，不调用新函数。
- [025事务测试](../supabase/driver-pwa-test/025-order-approved-receipts-test.sql) 返回 `order_approved_receipts_checks_passed`，覆盖订单／日期／分类精确归属、pending/rejected不展示、燃油关联、普通staff地域、司机／匿名拒绝、Storage RLS仅批准照片、批准后可读和撤派后历史保留。合成照片元数据及业务夹具均回滚；独立检查函数持久和夹具回滚。真实组件静态示例390／1280宽度无横向溢出，缩略图52×60，放大窗适配视口；交互由组件回归验证，尚未代用户登录实测真实票据。
- 33项小票／司机财务回归通过，TypeScript及相关ESLint（含预约主页面）通过；本地3100匿名请求返回401，没有泄露小票地址。
- 未修改生产数据库或部署线上。正式环境启用需与司机身份及财务迁移一并规划，不能直接把隔离表／存储策略写入生产。

## 24. 在订单财务列表审核司机申报

- 用户确认：**驳回相当于从订单待审核区移除，不计入金额；保留申报、照片和审核记录，司机可重新申报。仅处理pending，不能在此撤销已批准入账的数据。** 不物理删除文件、不扣减历史已入账金额。
- 管理员在「経理統計」订单名称下看到“司机申报待审核 N 项”，点击即可在列表内打开该订单本月审核窗。按服务日期、司机及社报立替／旅报立替／超时／燃油费分卡显示数据和明细，每个分类单独批准或驳回。多个订单／多日不会混用，月份／地域切换时清除旧窗口。普通后台用户保留原财务访问，不提供新的审核权限。
- 待审立替及油票使用原私有桶，显示52×60缩略图，点击复用小票大窗；小票窗口的Esc不会冒泡关闭底下审核窗。驳回必须填写原因并确认；成功后只移除该分类的待审项，其他分类和其他订单保持，计数立即更新。已批准小票仍按上一节规则在订单财务详情中展示，驳回照片不进入已批准区。
- [026迁移](../supabase/driver-pwa-test/026-order-finance-pending.sql) 只应用隔离测试库，新增管理员 `admin_order_finance_pending(month)` 最小投影（orderId、date、driverName、kind及原claim），只返回pending，拒绝匿名、司机和普通staff。新GET严格校验月份和参数，不接受状态、司机或地域注入；仅隔离测试模式开放，private/no-store。
- 审核写入复用原受控 `/api/driver-finance-review`，保留管理员／来源／strict命令校验、版本和行锁。立替批准追加到对应日期分类，超时批准替换小时数并沿用后台单价，燃油批准追加指定订单当天；前端不自己加减金额。批准成功后立即重读服务器订单并用现有防本地编辑覆盖的sync机制更新列表金额和汇总；失败明确提示“已批准但金额刷新失败，勿重复批准”，不把刷新失败当审核失败重交。订单有未完成保存或保存错误时禁止审核，避免覆盖入账。
- 写入期间锁重复点击，审核失败保留卡片和备注，冲突要求刷新核对；切后台／退出清除卡片、照片、大窗和备注，取消请求并拒绝晚到响应。签名URL300秒有效、240秒刷新，图片失败明确报错，关闭审核窗前有未提交备注会确认。
- [026回滚测试](../supabase/driver-pwa-test/026-order-finance-pending-test.sql) 返回 `order_finance_pending_checks_passed`：订单／月份／分类归属、角色门禁、驳回不改变金额、审核快照保留、司机按新版本重新申报、分类与燃油准确入账、已批准不能再驳回。夹具全部回滚，独立检查函数持久和夹具回滚均true。
- 41项订单审核／小票／司机财务回归通过，TypeScript与相关ESLint（含预约主页面）通过。覆盖正确POST分类／版本、数据刷新、部分失败、重复点击、隐藏及退出晚响应、待审私有小票签名及放大窗隔离。尚未代用户登录实测真实司机申报；未部署线上、未改生产库。

## 25. 当日预约卡片同步司机执行状态

- 用户确认：司机结束行程后**只隐藏司机状态标签，预约卡片继续保留**。不修改预约自身的预约／确认等状态，不改变财务数据。当天未完成的派单显示“待确认／已确认／已出发／已到达／服务中”，完成、撤派、取消或休运不显示标签。
- 日历跨日订单仅在日本当天对应的日期栏显示标签；紧凑手机、非紧凑手机及桌面卡片为标签预留高度，保留原司机连续日期分组、行程摘要及拆分操作。预约列表同步显示相同标签，不根据司机状态过滤或删除预约。
- [共享读取hook](../lib/use-driver-execution-status.ts) 在已登录后台的日历／预约视图批量读取，响应后每3秒重试读取；这是自动轮询，不是即时推送。页面隐藏或退出清除标签并取消请求，返回前台立即重读；旧请求不能复原已清除的数据。读取失败明确提示并清除旧标签，预约仍保留，不把失败伪装成司机完成。测试模式关闭时不继续轮询。
- [027迁移](../supabase/driver-pwa-test/027-driver-execution-status.sql) 只应用隔离测试库，新增只读 `staff_driver_execution_status()`，服务器确定日本当天，仅返回订单ID、服务日期、执行状态及版本。普通staff仅本地域，管理员可跨地域，司机／匿名不能调用；不返回司机身份或订单财务。新GET不接受日期、司机或地域参数，private/no-store，并验证最小数据结构；客户端再拒绝错日期及重复订单。
- [027回滚测试](../supabase/driver-pwa-test/027-driver-execution-status-test.sql) 返回 `driver_execution_status_checks_passed`：真实司机状态命令逐步推进并立即反映在后台读取，完成后标签数据消失但预约及原状态不变；其他日、其他地域、撤派、休运及取消不显示，匿名及司机权限拒绝。独立检查函数持久和夹具回滚均true，扩展后的回滚测试再次通过。
- 20项司机状态／行程测试及15项日历回归通过，TypeScript通过，相关ESLint无错误（既有业务测试有一处无关未使用变量警告）。覆盖三秒轮询、完成清标签、错误重试、日期与订单归属、隐藏／退出／卸载晚响应及原卡片车道高度。3100匿名接口返回401；尚未代用户登录进行真实手机与后台联动验收。未部署线上、未修改生产数据库。

## 26. 后台运行管理与完整日报打印

- 左侧「予約管理」下新增「运行管理」。按月份读取司机日报，上方可筛选会社、車両番号及具体日期；列表包含出库中和已归库并标明状态，每10秒自动读取，也可手动刷新。按用户后续确认**不显示订单名称**，不猜测旧日报与订单的关联。
- 列表显示日期、状态、会社、車両番号、運転手、出勤点呼日期时间、出库地点／出发时间、第一个及最后一个非空经由地、归库地点／到着时间、退勤点呼日期时间和工作总时长。会社按日报手填車両番号在同地域唯一匹配车辆的 `owner_company`，不是订单签约会社或历史快照；缺失／重复匹配的日报仍在全部列表显示，标为未匹配，不猜用其他会社。
- 工作总时长＝**退勤点呼－出勤点呼**，不扣休息、不使用出库归库时长。司机日报新增独立点呼日期输入：新日报默认当天，退勤时分早于出勤时分时默认次日；日期可手动修改，支持超过24小时和跨年。手动修改过退勤日期后不再被时分变化覆盖。旧日报不批量补猜日期，缺日期或时分显示“日期待确认／点呼未完整”，保存前由用户核对。司机原有全程时长／经由地休息计算保持不变。
- [028隔离迁移](../supabase/driver-pwa-test/028-operations-reports.sql) 扩展原header日期校验，新增 `staff_operation_reports(month,region)` 及 `staff_operation_report_command(command)`。普通后台账号可查看、编辑及删除本人地域日报；管理员沿用原跨地域能力。司机／匿名不能调用后台函数，既有日报表仍禁止客户端直接访问。只修改日报及其事件，不改订单、司机身份、工资或财务。
- [运行管理组件](../components/operations-reports.tsx) 提供完整编辑窗：基本资料、点呼日期时间、出库、全部经由地及各自到着／出发公里表、计划公里表、归库及休息记录，可增减经由地和休息。所有时间明确日本时间，服务日期须与出库日期一致；归库时间和公里表配对、顺序及公里数倒退由原验证器再次校验。编辑必填原因，原事件表保留操作者及修改前后快照，行锁／版本防止覆盖司机或其他后台的较新保存；同一编辑重试幂等，保留未改时间的秒及微秒。
- 用户明确选择**永久删除日报和全部记录，不留删除日志**。点击删除先明确确认不可恢复、司机端同步消失；函数在权限及版本检查后原子删除该日报所有事件／前后快照及日报本体，不软删除、不额外保留删除日志，也不删除司机、订单或其他日报。失败或返回不一致不从列表移除，不提示成功；删除结果未确认时明确要求刷新核对。
- 每行「导出PDF」和「月批量打印」使用[独立日报A4版式](../lib/operations-report-print.ts)，**在系统打印窗口选择“另存为PDF”**完成PDF导出，不是后台自动下载文件。月批量按当前会社／車両番号／日期筛选打印；日期清空即整月。每份日报一页，按日期时间排序，含全部经由地及累计公里数、点呼／工作时长、出归库、客数和已有休息记录；长日报等比缩小以保留整份内容，不截掉中间经由地。所有文本转义，打印前逐页测量，结束／退出清理私有打印iframe。
- 月份／地域变化重新读取，旧请求不能复原其他范围的数据；隐藏或退出清除列表／编辑窗／打印内容并取消请求，返回前台立即重读。普通窗口焦点变化只刷新，不丢正在编辑的草稿。编辑窗关闭有未保存确认，刷新／离开浏览器有草稿保护；切换应用／标签页按既有隐私规则清除草稿，界面提前提示，并在返回时提示核对刚提交的操作。读取失败明确报错，不伪装成空日报；测试模式关闭时只显示尚未启用。
- [028事务回滚测试](../supabase/driver-pwa-test/028-operations-reports-test.sql) 返回 `operations_report_checks_passed`，覆盖普通staff地域权限、跨地域读写拒绝、司机／匿名拒绝、月份／出库中投影、会社匹配、完整编辑、版本冲突／重试、时间／公里数／未知字段拒绝、修改快照、司机继续编辑、永久清除及新司机日报点呼日期保存；旧018点呼测试亦通过。独立只读核对函数持久和夹具回滚均true。仅隔离库 **zsipqwipauzgbqvppwjf** 应用，未修改生产。
- 46项运行管理／司机日报回归、TypeScript和相关ESLint全部通过。真实组件生成的虚构静态列表在390／1280宽度确认仅表格内部横向滚动，编辑窗在360／390／1280无横向溢出；打印虚构两份日报（含100个经由地的极长示例）逐页缩放后无裁切。3100匿名接口401。未代用户登录验收真实日报、打印机或真实PDF文件；未部署线上。

### 按用户提供的「乗務日報」纸表调整打印版型

- 只调整PDF／单份及月批量打印，不改手机填写页、后台列表或数据库。改为黑白细线框「乗務日報」纸表；上半部按现有日报数据填写所属会社、司机、車両番号、客数、出退勤点呼日期时间、工作总时长、出归库、累计公里表及休息信息，不新增猜测的天气、订单或实车／空车数据。
- 经由地**写多少显示多少**，每个已填写经由地分到着／出发两行，按原顺序显示独立公里表及已有计划公里表，不固定12行、不补空白占位。全空草稿行不打印；公里数为0或仅有计划公里数也视为已填写，不能误删。没有经由地时直接显示出库和归库；长日报继续沿用每份一页等比缩放，保留全部内容。
- 下半部保留用户参考表的酒精检查／设施名／确认者、运管签名、报告特记／车体损伤、给油量、日常点检左右双栏、酒精检测仪归还、配车／结束时间、车辆清扫及ETC填写区。未采集项目保持空白，不自动填写合格、签名或给油量；原表预印「○」保留并明确不是检查通过记录。
- 11项运行管理测试、TypeScript及相关ESLint通过；新增0／2／100个经由地、全空／公里0草稿、连续编号、完整数据及下半部模板不随日报变化的验证。真实生成HTML浏览器打印媒体检查2个／100个经由地完整、逐页缩放无裁切，普通2个经由地示例无需缩放。未代验真实打印机或另存PDF操作，未部署生产。

### 所属与运行管理者的字段对应

- 用户确认「所属」对应**车辆所属会社**，「運行管理者＆補助者」姓名栏对应**车辆所属会社资料中的运行管理者**（`operations_manager`），不是整备管理者、订单会社或当前登录人。不将该姓名复制到其他签名／确认栏。
- [029只读迁移](../supabase/driver-pwa-test/029-operations-report-manager.sql) 在原地域权限投影中增加 `operationsManager`：同地域唯一車両番号匹配车辆，再以车辆 `owner_company` 精确匹配同地域会社。匹配不到、匹配不唯一或运行管理者未填写则姓名留空，不猜用其他会社；读取当前会社资料，不创建历史快照。仅隔离测试库应用。
- [029回滚检查](../supabase/driver-pwa-test/029-operations-report-manager-test.sql) 覆盖正确所属与运行管理者、不能误取整备管理者、跨地域会社不泄露及车辆不存在时留空。12项运行管理测试、TypeScript与相关ESLint通过，包含姓名转义、缺失留空和只填指定栏目。其他未确认栏目仍不自动对应。

## 27. 独立线上试用版

- 用户明确选择手机端与预约后台一起发布到**独立试用项目**，不影响正式业务数据。
- 手机入口：https://hire-car-driver-trial.vercel.app/driver/login
- 预约后台：https://hire-car-driver-trial.vercel.app/login
- Vercel 团队 `go-ride3`，新项目 `hire-car-driver-trial`（`prj_vrsIsObU8brugpsXAo2vAXeT677s`）。已验证部署 `dpl_Dq6ew5pvFp5mwopdTdmKZLeWsKwE`。原项目 `hire-car-system`、正式域名及源码目录原有 Vercel 关联均未修改。
- 仅使用隔离 Supabase 项目 `zsipqwipauzgbqvppwjf`。新项目 Production／Preview 环境均已持久配置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 和匹配的 `DRIVER_PWA_TEST_MODE`；未上传任何环境文件或生产凭证，未配置服务管理密钥。这里的 Production 是**独立试用项目的发布目标**，不是正式业务环境。
- 新项目 Framework 为 Next.js，Output Directory 为 `.next-driver-pwa`，与测试模式的 [Next 配置](../next.config.ts) 一致。发布包含根目录 [proxy](../proxy.ts)。关闭的仅为新试用项目的 Vercel SSO 保护，应用账号验证及数据库权限保留；原正式项目配置未动。
- 已验证手机／后台登录页均返回200，匿名访问后台根路径和司机行程重定向至各自登录页；匿名访问运行管理、业务数据和司机日报API均返回401及 `private, no-store`。浏览器390宽度司机登录无横向溢出，两个登录页无致命脚本错误；后台9个脚本均可加载，其中 Supabase 主机仅为隔离项目。
- 发布前完整测试227项通过。本次未代用户登录验证真实业务流程，也未验证真实打印机。只能使用隔离测试账号，正式系统账号不能在此使用；因未配置隔离服务管理密钥，后台创建／重置司机账号仍不可用。
- 后续发布必须明确指定新试用项目和团队，并继续排除环境文件、原项目关联和生产凭证；不得从正式项目继承环境变量或向正式库补迁移。

### 试用项目账号管理配置更新

- 用户在 Vercel 新试用项目的 Production 环境自行保存 `SUPABASE_SERVICE_ROLE_KEY`，未通过聊天传递。随后重新部署成功，部署编号 `dpl_4NkjCpFJjqJZZ4x62VhXwdKfQUbF`，仍使用上述试用域名；本次使用新项目持久环境配置，未读取或修改正式项目配置。
- 两个登录页返回200，匿名账号管理API仍返回401及 `private, no-store`。以上只验证配置存在、部署和匿名权限，尚未验证所填密钥的有效性或登录后的改密操作；不能据此宣称账号管理已完整验收。
- 用户确认目标为试用库已有的 `zhangsiliangvip@gmail.com` 和 `fujiwara@go-ride.jp`，不重复创建。本次没有修改这两个账号的密码，后续由用户在后台自行输入并提交。

## 28. 正式上线准备与本地备份

- 用户已授权正式上线；正式环境仍为 Supabase `acuhvzpsitnevfztbbtv` 与原 Vercel 项目。本节是上线准备记录，不代表已正式发布。只读核对显示正式库 PostgreSQL17.11，已有 `regions` 和 `driver_wage_items`，但没有司机身份、派单、日报新表。测试迁移001／002含测试库结构和固定资料数量前提，禁止原样在正式库执行。
- 正式项目为 Free，控制台未提供项目备份。用户选择本地备份；第一次连接认证失败，后续重新输入数据库连接密码后成功。密码在本机窗口输入并经 Windows DPAPI 加密，未写入源码或通过聊天传递。
- 已于2026-10-27 20:51生成受当前Windows用户访问控制保护的本地归档：`C:\Users\zhang\hire-car-backups\production-20261027\production-full.dump`，883323字节，SHA-256为 `15EAD8C8D7D7B94F1E024008C246FA7985843EC9EB783383B347FC25C4672F44`。配套保存归档目录、schema提取、无角色密码的角色定义及表内容校验结果；备份不进入Git或部署目录。
- 使用官方PostgreSQL17.11工具完成归档目录读取和完整解码。隔离、仅回环地址监听且采用随机密码保护的本机数据库成功恢复 `public`／`auth`／`storage`，逐表比对48张表的数量和内容摘要全部一致；比对显式开启只读事务，统一UTC，未输出业务行或认证令牌。
- **恢复验证范围限制：** 普通Windows PostgreSQL缺少 `supabase_vault` 托管扩展，全库原样恢复在该扩展处停止，因此不能声称已验证整个Supabase平台恢复。随后成功的是业务／认证／Storage元数据三schema恢复，使用本机角色占位且不恢复所有者和ACL；不证明托管服务、Vault、平台权限或登录流程已恢复。数据库dump也不包含Storage实际文件内容。正式迁移前仍需分别核对权限、Storage和相关恢复需求。
- 本次未执行正式库迁移、未修改正式订单或管理员密码、未发布正式项目。正式运行开关适配、迁移演练、权限核对及分阶段发布尚待完成；长时间后正式迁移前须重新取得新备份，不能把本次快照当作持续备份。

## 29. 正式发布与自动派单

- 用户确认正式规则：按每个服务日的司机自动同步；仅同地域唯一姓名、已绑定且启用的司机接收。正式派单首次只同步今天及以后，历史不补派。手机端历史查询只读：仅当服务日订单记录的司机姓名与当前司机同地域唯一匹配、且该订单日没有任何派单记录时显示；不创建派单、不开放状态/财务操作，撤派或重派记录也不会被历史查询重新显示。只改时间／地址／财务保留执行状态；换司机、取消、休运或移除服务日撤销原派单，换司机创建待确认新派单。已有关联派单历史的订单禁止物理删除，提示改为取消，历史及小票保留。
- [生成器](../scripts/build-driver-production-migration.mjs) 复用27份已经隔离验证的增量SQL，记录来源SHA-256，排除地域初始化、演示和测试夹具，移除固定两名员工及重复创建工资项目表的测试假设。结合 [正式前置检查](../supabase/driver-production/prepare.sql) 与 [正式同步实现](../supabase/driver-production/dispatch.sql)，生成单事务 [正式迁移](../supabase/migrations/20261104000000_driver_pwa.sql)；禁止将原测试SQL直接应用正式库。
- 迁移保留现有地域、订单、司机和工资项目数据，现有profile只增加工作人员身份；既有管理员密码不修改。新增账号仍默认pending，不信任Auth metadata传入的角色／身份；后台工作人员创建成功后显式设置staff，司机账号按司机地域绑定。旧测试派发RPC撤销authenticated执行权限，旧全量撤派trigger被正式逐日同步替代。
- 正式开关为 `DRIVER_PWA_PRODUCTION_PROJECT=acuhvzpsitnevfztbbtv`，仅精确匹配正式Supabase URL才生效；原测试开关仍仅允许隔离库，两个模式互斥。司机路由、后台最小投影、账号管理、staff门禁及后台独立DAL均使用正式／测试统一启用判断；局域网开发来源例外仍限独立测试模式。
- 从真实生产归档恢复业务／认证／Storage元数据并恢复原ACL后，重新完整演练原子迁移成功；[派单SQL检查](../supabase/driver-production/dispatch-test.sql) 使用虚构夹具并回滚，覆盖每日覆盖司机、跨地域、历史不补派、保留执行状态、换司机、取消、禁止删除、首次绑定同步、停用与恢复、休运、司机改名、pending防提权、司机不能读取原始订单／工资或开票，以及原地域staff可见性。生产同地域司机姓名已有唯一约束，测试验证该约束保留，不删除索引造重复数据。
- 完整230项Node回归通过，TypeScript与相关ESLint通过；最后新增的工作人员创建身份断言及生成器77项回归也通过。正式候选 `dpl_DZoYNoLWXvxB6v3TFZmTUPfXHKRV` 先构建验证，不立即晋升主域名。
- 用户再次确认继续正式迁移后，重新取得发布前备份：`C:\Users\zhang\hire-car-backups\production-pre-release-20261027\production-full.dump`，SHA-256 `889C088A53A08DB7C87BB7B8AFA0C6A50F82B2F5B77AC42BDDC4674D82DF120F`。完整解码通过，去除归档随机标记后的schema与演练基线完全一致，发布SQL哈希与演练文件相同，随后正式迁移COMMIT。迁移事务内逐行JSON对比核对旧profiles／orders／drivers／driver_wage_items未被改写（profiles仅新增account_type）。
- 正式只读验收：8个staff profile，0个pending，0个司机绑定／派单／日报，没有导入演示数据；正式同步及历史保留trigger、工资staff gate和运行管理RPC存在，旧测试派单RPC不可由authenticated调用。原正式账号服务端管理密钥沿用原项目配置，未复制测试库密钥。
- 已将候选部署晋升到 `https://hire-car-system.vercel.app`。后台入口 `/login`，司机入口 `/driver/login`。两个登录页200，匿名根路径分别重定向对应登录；业务数据、司机身份、司机账号管理与运行管理API均401及private/no-store。司机登录390宽度无横向溢出、无致命脚本错误、脚本全部加载，公开bundle仅指向正式Supabase，未显示测试横幅。
- **尚未代用户登录验收真实业务流程、创建实际司机账号或验证真实打印机。** 当前正式库尚无司机绑定，需管理员在運転士资料中设置独立司机邮箱及密码；绑定后才同步符合条件的已有订单。没有设置或公开司机／管理员默认密码。已停止本机演练数据库并清理临时正式数据库密码；备份仍保留于受限本地目录。
- 旧代码部署 `dpl_EjW35kAaia52bY6C3wLWTRtw6aZQ` 仅作发布前代码版本记录。**代码回退不等于数据库回滚**，不得未经核对删除新表或恢复旧库覆盖上线后新记录。迁移生成器后续改动不能直接重跑这份首次迁移，须另写增量。

## 30. 正式日报时间顺序修正

- 用户确认顺序为：出勤点呼 ≤ 出库 ≤ 各经由地到着／出发 ≤ 归库 ≤ 退勤点呼。允许提前填写未来时间，按日本日期时间比较，支持跨午夜和相等时间；未填写的可选点呼不增加必填限制。经由地、公里表和休息完整性校验保留。
- 手机端和后台编辑使用共享写入预校验；数据库使用同一时序规则作为最终约束，接口仅将明确的 `PDT01`～`PDT04` 映射为可操作提示，不向客户端返回原始数据库错误。读取历史日报不增加跨字段约束。
- [独立增量迁移](../supabase/migrations/20261105000000_report_time_order.sql) 只更新四个函数，移除未归库日报以当前时刻作为上限、手工出归库、调整日期及后台编辑的未来时间限制；未归库时已有退勤时间仍作为经由地／休息上限。不改写已有日报、订单、司机或密码，也不重跑首次上线迁移。
- 50项相关Node测试、TypeScript和相关ESLint通过；从原生产备份另建本机数据库，完整演练首次迁移及本次增量成功。[虚构SQL夹具](../supabase/driver-production/report-time-order-test.sql) 回滚验证司机和工作人员保存未来跨日记录、点呼顺序、相等时间、公里倒退和未完成经由地。
- 正式更新前新备份位于 `C:\Users\zhang\hire-car-backups\production-before-time-order-20261027-214115\production-full.dump`，完整解码通过，SHA-256 为 `06BB161F11BD511E3F41D04A55A51E72E842AE54661947C0EEC59C9544F55651`。正式增量已COMMIT，五项只读函数检查全部通过。
- 候选 `dpl_Cms8NLZxUe3drXRjtiZw57TYanNr` 构建成功；两个登录入口200、匿名日报接口401且private/no-store后，已晋升正式主域名。未代用户登录或写入真实司机日报，真实记录由用户刷新并核对后保存。

## 31. 运行管理日期省略年份

- 运行管理列表、删除确认、单份／月批量打印及PDF里的日报日期统一显示 `MM/DD`；点呼、出归库、打印经由地时间显示 `MM/DD HH:mm`，仍以日本时间转换，跨午夜保留正确月日。
- 仅改变展示；原始日期、跨年排序、工时计算、接口和保存精度不变。编辑日期时间与月份／日期筛选仍使用原生完整日期控件，避免跨年误编辑；不修改数据库和既有记录，司机页面不受影响。
- 13项运行管理测试、相关ESLint和TypeScript通过，覆盖列表、打印各时间字段、跨年时区转换以及原始秒／微秒保留。候选构建和匿名访问检查通过后，`dpl_4BUc7iAfooyjEav63RSq3JRFvSUf` 已晋升正式主域名。

### 列表接客／下客地点命名

- 运行管理列表的「第一个经由地」改名为「接客地点」，「最后一个经由地」改名为「下客地点」。仍分别显示首个、末个非空地点，不改取值规则、日报编辑、打印经由地或业务数据。

### 时间字段仅显示时分（取代上述月日＋时分展示）

- 用户进一步要求运行管理时间字段不显示月日：列表点呼／出归库、打印及PDF点呼／出归库／经由地时间统一显示日本时间 `HH:mm`。独立日报日期仍为 `MM/DD`；编辑和筛选保留完整日期，底层时序、跨日工时和业务数据不变。

### 隐藏列表状态及会社列

- 移除运行管理列表日期后的「状态」「会社」列及对应单元格，空列表跨列数同步调整为13。未归库日报仍正常列出，会社筛选及打印所属保留，不改变底层状态、数据或司机端展示。

### 列表居中对齐

- 运行管理列表所有表头和对应内容均水平居中，操作按钮组同步居中，不改变字段、数据、编辑或打印行为。

## 32. 手机端逐步倒退与当日状态显示

- 用户确认：司机每次只退回上一步，已完成也可退回服务中；已确认可退回待确认。手机端详情增加「退回上一步」，先确认再提交，与前进共用保存锁、版本检查及幂等请求。已撤派／已取消及其他司机派单不可回退。
- [独立增量](../supabase/migrations/20261106000000_driver_status_backwards.sql) 保留既有身份、所属、订单锁和幂等检查，只放开相邻状态的反向转换，并允许事件记录回退到待确认。回退只追加历史、递增版本，不删除订单、小票、财务或既有事件；回到待确认清空当前确认时间，历史仍可追溯。
- 预约信息卡司机状态显示在对应服务日区域的顶部正中间，沿用3秒同步。**已完成不再立即隐藏，保留至日本时间当天24:00**，取代第25节的原完成即隐藏规则。日期切换时本机定时清空状态，旧日期晚到响应拒绝恢复；服务端仍仅投影日本当天，历史状态不删除。
- 59项行程／状态／相关财务测试、TypeScript和相关ESLint通过；[SQL虚构夹具](../supabase/driver-production/driver-status-backwards-test.sql) 在本机恢复库回滚验证所有相邻反向转换、幂等、旧版本、禁止跳步、其他司机及跨地域隔离、完成状态显示、历史保留及取消撤派保护。午夜测试模拟23:59:59→00:00:00，确认不依赖网络请求完成也隐藏旧状态。
- 更新前正式备份已完整解码，位于 `C:\Users\zhang\hire-car-backups\production-before-status-backwards-20261027-221116\production-full.dump`，SHA-256 `90BCA2ACA8DC0BB07C797C95ADA439E2CE75B19728C4D065D3DF2CD96C0F3FDD`。正式增量已COMMIT，反向转换／待确认事件／完成状态投影三项只读检查通过；不改写既有业务记录。
- 候选 `dpl_GHumL4F7Z528v9gNJWD8MgQU4EV2` 构建成功，司机登录200、匿名状态接口401且private/no-store后，已晋升正式主域名。未代用户登录或改变真实订单状态。

## 33. 司机行程详情补充订单信息

- 用户要求手机端行程详情显示订单名称、行程简概及備考。名称读取订单 `customer`，简概仅读取该派单服务日的 `finance_by_date[service_date].tripSummary`，備考读取订单 `notes`；空内容显示未填写，长文字自动换行，简概及備考保留原换行并由React转义。
- 新增 [只读详情投影](../supabase/migrations/20261107000000_driver_trip_details.sql)，复用原 `driver_orders` 的本人有效派单／地域／取消／休运权限检查，不修改既有函数返回类型或影响其依赖；仅额外投影上述三段文字，不返回财务JSON或金额。行程列表保持原九字段，详情接口使用新RPC并验证唯一派单，继续private/no-store。
- 15项行程测试、TypeScript及相关ESLint通过；[回滚SQL夹具](../supabase/driver-production/driver-trip-details-test.sql) 验证本人读取、每天不同简概、多行備考、其他司机／staff／匿名／空选择器／撤派保护及仅12个明确SQL字段，无金额泄露。未代用户登录查看真实订单。
- 正式更新前备份 `C:\Users\zhang\hire-car-backups\production-before-trip-details-20261027-222342\production-full.dump` 完整解码通过，SHA-256 `D626F6E91AD4FB3A22EB9107A2DEC2665DE76F868DB2E0DECDB759E5606430BE`。新增函数已COMMIT，权限与复用原归属检查的四项只读验证通过，不改写业务记录。
- 候选 `dpl_AY1pXQcMaxqWkM4rippTK58DtYfc` 构建成功，司机登录200、匿名详情401后已晋升正式主域名。

### 手机行程首页与地点导航

- 首页「待执行行程」直接显示首个未完成行程的订单名称和当日行程简概；下方每张卡显示配車時間、上／下车地点、備考、日期及车辆，保留详情入口和状态流程。
- 用户选择Google Maps：点击已填写地点使用官方HTTPS路线链接，地址编码为目的地参数，驾驶路线由地图应用处理；可用时由系统打开Google Maps，未安装或系统未接管时进入网页版。空地点不生成链接，不自动发送位置或在页面加载时请求地图。
- 列表接口复用现有本人详情RPC，以每批最多10个并发查询补充三段文字，校验派单、订单和服务日；任何详情读取失败明确返回错误，不把失败伪装成未填写。无需数据库迁移，业务数据不变。长文字保留换行且自动折行，导航地址不能变成任意脚本链接。

### 我的行程及行程详情車両番号

- 两处卡片在「车辆」下方增加「車両番号」，复用现有本人 `driver_report_defaults(service_date)` 的当日车牌解析规则，按派单ID准确匹配，不由车型名称自行猜测。未设置的车牌显示未填写；查询失败、日期或派单不一致明确报错，不伪装成空车牌。每次列表读取只增加一次当日默认资料查询，不修改数据库、车辆或订单记录。

### 車両番号严格对应后台选车

- [增量迁移](../supabase/migrations/20261108000000_driver_selected_vehicle_plate.sql) 修正每日财务默认空字段遮蔽整单车牌的问题：只有当天 `vehicle` 非空时才使用当天 `vehiclePlate`（允许为空），否则使用订单 `vehicle_plate`。与后台当日订单覆盖规则一致，不根据车型推断车牌。
- 同时取代前述旧默认规则中的“无番号时唯一车型匹配”：车库只按已选车牌匹配，不再凭车型猜测。手机行程列表、详情及新日报默认读取同步生效；已保存日报、订单和车辆记录均不改写。
- [回滚夹具](../supabase/driver-production/driver-selected-plate-test.sql) 在本地恢复库验证整单车牌、每日换车及两种清空车牌场景。正式更新前完成备份及完整解码，备份目录 `C:\Users\zhang\hire-car-backups\production-before-selected-plate-20261027-224642`，SHA-256 `111A80EB1724432467BB39A7CA1BD38FFD9426E3F8497F46A96B818B8F2372B3`。增量已COMMIT，三项只读函数检查通过；复用现有线上接口，无需重新部署页面。未登录真实司机账号进行订单核对。

### 全入口按服务日统一最新車両番号

- [增量迁移](../supabase/migrations/20261109000000_service_vehicle_consistency.sql) 新增 `service_vehicle_name/date` 与 `service_vehicle_plate/date` 统一服务日车辆来源；司机行程、日报默认、运行管理、财务及订单详情车牌全部改为按服务日读取，不再出现入口之间车牌不一致。
- 日报新增订单关联能力：保存中的车牌变更（含手机端与运行管理编辑）会回写该服务日订单车辆信息，并即时反映到所有入口；修改日期会清除关联，避免跨日误同步。旧日报仅在“同司机同日唯一订单”时自动回填关联，无法唯一关联时保留原车牌并提示人工确认，不猜测订单。
- 为避免“改整单默认车辆时覆盖已单独换车日期”，每日财务新增 `vehicleOverride` 标记。仅跟随默认的日期会被整单默认更新；已单独选择过的日期保持独立。单日订单仍保持整单与当日完全一致。
- SQL回滚夹具：
  - [service-vehicle-backfill-test.sql](../supabase/driver-production/service-vehicle-backfill-test.sql)：验证旧日报唯一关联回填、歧义保留及手工确认提示。
  - [service-vehicle-consistency-test.sql](../supabase/driver-production/service-vehicle-consistency-test.sql)：验证跨入口同步、反向回写、清空车牌不猜测、跨地域拒绝、跨日期拒绝和不影响状态/金额。

### 全体及个人标语正式环境修复（2026-10-28）

- 正式预约与司机系统使用 Supabase `acuhvzpsitnevfztbbtv`；独立试用项目 `hire-car-driver-trial` 使用隔离库 `zsipqwipauzgbqvppwjf`。不要依据 Supabase 项目显示名称判断环境。
- 标语迁移先前误应用于隔离试用库，导致正式后台的标语接口找不到设置表／RPC，司机资料提交缺少 `personal_slogan` 列。已在正式库应用 `20261113000000_driver_portal_slogans.sql` 对应的增量迁移，并通知 PostgREST 重载 schema；不覆盖现有标语或司机资料。
- 正式库验收：设置表、两个标语 RPC 及司机列均存在；默认全体标语为“平安出行，美好的一天”；5 个现有司机绑定保持不变。工作人员读取 RPC 与司机身份标语读取均通过；个人标语写权限以回滚事务验证，未改写司机记录。
- 正式司机入口为 `https://hire-car-system.vercel.app/driver/login`。不要使用隔离试用站登录正式司机账号；试用账号和正式账号分属不同 Auth 数据库。匿名检查登录页返回200，受保护司机API与账号管理API返回401（符合预期）。

### 历史订单费用补录（待迁移及部署）

- 过去的服务日订单只会在服务日、地域及唯一司机姓名均匹配，并且该订单日没有任何派单记录时显示。历史订单不补建、不伪造 `driver_assignments`，也不开放状态操作。
- 司机打开对应月份的财务页时，服务端为符合条件的历史订单创建幂等 `driver_historical_finance_links` 记录，保存关联的订单/日期/司机/地域、创建账号和时间；司机只能通过受控 RPC 读取和提交。财务申报仍复用原有分类、幂等版本、后台审核和 `finance_by_date` 入账，不开放历史日燃油费或管理端每日字段。
- 历史申报票据仍存于私有司机票据桶，路径使用该审计关联ID；存储策略、司机提交校验、管理员签名阅读和订单已批准票据入口均校验该关联。审批前会再次检查历史订单仍符合本人唯一匹配且未产生派单，或要求退回重提。
- 新增的 [20261115000000 历史财务迁移](../supabase/migrations/20261115000000_driver_historical_finance.sql) 尚未应用于任何数据库，也未部署线上。隔离测试流程为先应用 [030 历史订单读取](../supabase/driver-pwa-test/030-driver-historical-orders.sql)，再应用 [031 历史财务关联](../supabase/driver-pwa-test/031-driver-historical-finance.sql) 并运行 [031 回滚测试](../supabase/driver-pwa-test/031-driver-historical-finance-test.sql)；核对生成的正式迁移后，再单独授权正式库迁移和应用部署。

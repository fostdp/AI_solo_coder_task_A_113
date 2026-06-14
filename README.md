# 战地医院移动ICU患者生命体征与院内感染风险预测系统

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Canvas + ECharts)                   │
│  床位布局 | 实时曲线 | 感染热力图 | 告警中心 | WebSocket推送     │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/WS
┌────────────────────────────▼────────────────────────────────────┐
│                    Go 后端 (Gin 框架)                            │
│  REST API | WebSocket | MQTT订阅 | 预测引擎 | 告警引擎          │
└──────┬────────────────────┬──────────────────────┬──────────────┘
       │ MQTT               │ SQL (pgx/v5)         │ 算法
┌──────▼──────┐     ┌───────▼─────────┐     ┌──────▼──────────────┐
│ MQTT Broker │     │  TimescaleDB    │     │  LSTM + 随机森林    │
│  (Mosquitto)│     │ (PostgreSQL +   │     │  SOFA评分计算       │
│             │     │  时序扩展)      │     │  CRE/MRSA风险预测   │
└─────────────┘     └─────────────────┘     └─────────────────────┘
       ▲
┌──────┴───────────────────────────────────┐
│         200个传感器 / MQTT模拟器          │
│  50床位 × (心电|呼吸|血氧|体温) 每秒上报   │
└──────────────────────────────────────────┘
```

## 目录结构

```
AI_solo_coder_task_A_113/
├── backend/                  # Go 后端服务
│   ├── main.go              # 主入口
│   ├── go.mod               # Go依赖
│   ├── config.yaml          # 配置文件
│   ├── config/              # 配置模块
│   ├── database/            # 数据库模块 (TimescaleDB)
│   ├── models/              # 数据模型
│   ├── mqtt/                # MQTT数据接收模块
│   ├── ml/                  # 机器学习预测模块
│   ├── alert/               # 告警引擎 (WebSocket+短信)
│   └── handlers/            # Gin路由处理
├── frontend/                 # 前端页面
│   ├── index.html           # 主页面
│   ├── css/style.css        # 样式
│   └── js/app.js            # 交互逻辑 (Canvas+ECharts)
├── simulator/                # MQTT传感器模拟器
│   ├── main.go
│   └── go.mod
└── database/                 # 数据库初始化脚本
    └── init.sql
```

## 核心功能

### 1. 数据采集层
- **50张床位**，每张配备4种传感器（共200个）
  - ECG 心电监护 (bpm)
  - Ventilator 呼吸机频率 (rpm)
  - SpO2 血氧饱和度 (%)
  - Temperature 体温 (°C)
- **MQTT协议**：每秒上报一次，主题格式 `icu/bed/{bed_id}/{sensor_type}`
- 批量写入 TimescaleDB 时序表，毫秒级入库

### 2. 预测算法层

#### LSTM 脓毒症早期预警模型
- **输入**：最近60秒的生命体征时间序列（4维特征）
- **架构**：32维隐藏层 LSTM → Sigmoid 输出层
- **输出**：脓毒症发生概率 (0~1)，SOFA评分辅助校准
- **特征工程**：心率、呼吸频率、血氧、体温的归一化时序

#### 随机森林 院内感染风险预测
- **模型**：100棵决策树的随机森林集成
- **输入特征**：
  - 抗生素使用天数
  - 侵入性操作次数
  - 当前体温
  - 呼吸频率
  - 住院天数
- **输出**：
  - CRE (耐碳青霉烯肠杆菌) 感染风险
  - MRSA (耐甲氧西林金黄色葡萄球菌) 感染风险

### 3. 告警系统
- **触发条件**：
  - SOFA评分 ≥ 2分 → 脓毒症预警
  - CRE风险 > 0.7 → CRE感染高风险
  - MRSA风险 > 0.7 → MRSA感染高风险
- **推送渠道**：
  - WebSocket 实时推送到前端 (弹窗+列表)
  - 模拟短信网关推送 (可配置真实SMS API)
- **分级**：warning / high / critical 三级
- **去重**：同一床位同类型告警5分钟内不重复

### 4. 前端可视化

#### Canvas 床位布局 (10列×5行)
- 每张床位实时显示心率、血氧
- 颜色编码风险等级：绿(正常)→黄(警告)→红(危急)
- 高风险床位脉冲动画效果
- 点击床位查看详情面板

#### ECharts 实时曲线
- 4个独立图表：心率/呼吸/血氧/体温趋势
- 支持 1/5/15/60 分钟时间窗口切换
- 平滑曲线 + 渐变填充区域

#### 感染风险热力图
- 5×10 热力网格映射床位布局
- 颜色从绿→黄→红映射 CRE+MRSA 综合风险
- 悬浮显示详细风险数值

#### 告警中心
- 按类型筛选：脓毒症/CRE/MRSA/未确认
- 一键确认告警
- Toast弹窗实时提醒

## 快速启动

### 环境要求
- Go 1.21+
- PostgreSQL 14+ with TimescaleDB 2.x
- MQTT Broker (推荐 Mosquitto)
- 现代浏览器 (Chrome/Edge/Firefox)

### 步骤1：启动基础设施

使用 Docker 快速启动（推荐）：

```bash
# 启动 PostgreSQL + TimescaleDB
docker run -d --name timescaledb \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=field_hospital \
  timescale/timescaledb:latest-pg15

# 启动 MQTT Broker
docker run -d --name mosquitto \
  -p 1883:1883 \
  eclipse-mosquitto:latest
```

### 步骤2：初始化数据库

```bash
# 方法1：使用提供的SQL脚本
psql -h localhost -U postgres -d field_hospital -f database/init.sql

# 方法2：启动Go后端时会自动执行Schema初始化
```

### 步骤3：启动 Go 后端

```bash
cd backend
go mod tidy
go run main.go
```

后端将启动在 `http://localhost:8080`

### 步骤4：启动传感器模拟器（可选）

如果没有真实传感器，启动模拟器生成数据：

```bash
cd simulator
go mod tidy
go run main.go --broker tcp://localhost:1883 --interval 1000
```

参数说明：
- `--broker`: MQTT Broker地址 (默认 tcp://localhost:1883)
- `--interval`: 上报间隔毫秒 (默认 1000)
- `--beds`: 模拟床位数 (默认 50)

### 步骤5：访问前端

打开浏览器访问：`http://localhost:8080`

## API 接口

### 床位管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/beds` | 获取所有床位列表 |
| GET | `/api/beds/:id` | 获取单个床位详情 |

### 生命体征
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/beds/:id/vitals` | 获取床位历史体征 (默认1小时) |
| GET | `/api/beds/:id/vitals/recent?seconds=60` | 获取最近N秒体征 |

### 感染风险
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/infection/risk` | 获取所有床位感染风险热力图数据 |
| GET | `/api/statistics` | 获取全局统计数据 |

### 医疗记录
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/beds/:id/antibiotics` | 记录抗生素使用 |
| POST | `/api/beds/:id/invasive` | 记录侵入性操作 |

### 告警
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/alerts` | 获取告警列表 (默认100条) |
| GET | `/api/alerts/active` | 获取未确认告警 |
| POST | `/api/alerts/:id/acknowledge` | 确认告警 |

### WebSocket
| 路径 | 说明 |
|------|------|
| `/ws` | 实时推送：`vitals_update` 体征更新，`alert` 新告警 |

## MQTT 消息格式

**主题**：`icu/bed/{bed_id}/{sensor_type}`

**Payload (JSON)**:
```json
{
  "bed_id": 1,
  "sensor_type": "ecg",
  "value": 78.5,
  "unit": "bpm",
  "timestamp": 1718342400
}
```

`sensor_type` 枚举：`ecg`, `ventilator`, `spo2`, `temperature`

## 配置说明 (`backend/config.yaml`)

```yaml
server:
  port: "8080"                    # HTTP服务端口

database:
  host: "localhost"               # TimescaleDB地址
  port: "5432"
  user: "postgres"
  password: "postgres"
  dbname: "field_hospital"

mqtt:
  broker: "tcp://localhost:1883"  # MQTT Broker
  qos: 1                          # MQTT QoS等级

alert:
  sofathreshold: 2.0              # SOFA告警阈值
  infectionthreshold: 0.7         # 感染风险告警阈值
  smsgateway: "http://..."        # 短信网关地址

ml:
  lstmsequencelength: 60          # LSTM序列长度
  modelupdateinterval: 300        # 预测间隔(秒)
```

## 设计亮点

1. **时序数据库优化**：TimescaleDB超表 + 连续聚合 + 保留策略，支撑每秒200条数据长期存储
2. **高并发写入**：MQTT消息批量缓冲入库，100ms刷盘，支持万级TPS
3. **双模型预测**：LSTM处理时序依赖，随机森林处理结构化医疗特征
4. **实时告警引擎**：WebSocket广播 + 短信推送，5分钟去重防骚扰
5. **Canvas高性能渲染**：50张床位每秒刷新无卡顿，脉冲动画提示风险
6. **离线模拟模式**：后端内置数据生成，无MQTT也可完整演示

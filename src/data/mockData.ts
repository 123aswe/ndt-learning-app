import type { Question, Category, Achievement, TrainingSet, WrongRecord } from '../types'

/* ============================================================
   NDT Question Bank — Real NDT Questions in Chinese
   ============================================================ */

export const questions: Question[] = [
  // ──── UT · 超声检测 ────
  {
    id: 'ut-001',
    text: '超声波检测中，纵波在钢中的声速约为多少？',
    options: [
      { key: 'A', text: '3230 m/s（横波声速）' },
      { key: 'B', text: '5920 m/s（纵波声速）' },
      { key: 'C', text: '5080 m/s（铝中纵波声速）' },
      { key: 'D', text: '2980 m/s（瑞利波声速）' },
    ],
    correct: 'B',
    explanation: '纵波（压缩波）在钢中的声速约为 5920 m/s。横波约为 3230 m/s，瑞利波约为 2980 m/s。记忆要点：纵波快、横波慢，纵约为横的 1.8 倍。',
    category: 'UT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: '声速与材料',
    standard: 'GB/T 11345',
  },
  {
    id: 'ut-002',
    text: '探头近场区长度 N = D²/(4λ)，下列哪个参数不影响近场区长度？',
    options: [
      { key: 'A', text: '晶片直径 D' },
      { key: 'B', text: '超声波频率 f' },
      { key: 'C', text: '材料中的声速 c' },
      { key: 'D', text: '楔块的折射角 β' },
    ],
    correct: 'D',
    explanation: '近场区长度 N = D²/(4λ) = D²f/(4c)，与晶片直径 D 的平方成正比，与频率 f 成正比，与声速 c 成反比。楔块折射角仅改变声束方向，不影响近场区长度计算。',
    category: 'UT',
    level: 1,
    difficulty: 'medium',
    knowledgePoint: '近场区',
  },
  {
    id: 'ut-003',
    text: 'A 扫描显示中，横轴（水平轴）代表什么物理量？',
    options: [
      { key: 'A', text: '回波信号的幅度（声压）' },
      { key: 'B', text: '声程（飞行时间/距离）' },
      { key: 'C', text: '超声波频率' },
      { key: 'D', text: '扫查位置坐标' },
    ],
    correct: 'B',
    explanation: 'A 扫描是最基本的超声显示方式。横轴代表声程（即超声波传播时间，换算为距离），纵轴代表回波幅度（dB 或百分比）。初始脉冲、底面回波和缺陷回波沿横轴依次排列。',
    category: 'UT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: 'A 扫描显示',
  },
  {
    id: 'ut-004',
    text: '超声检测中，频率越高则（  ）',
    options: [
      { key: 'A', text: '穿透力越强，分辨力越低' },
      { key: 'B', text: '穿透力越强，分辨力越高' },
      { key: 'C', text: '穿透力越弱，分辨力越高' },
      { key: 'D', text: '穿透力越弱，分辨力越低' },
    ],
    correct: 'C',
    explanation: '频率与波长成反比：频率越高，波长越短，能识别的最小缺陷越小（分辨力高）；但高频波在材料中衰减越大，穿透力越弱。工程中需根据工件厚度和晶粒度综合选择频率。',
    category: 'UT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: '频率与分辨力',
  },
  {
    id: 'ut-005',
    text: '钢中纵波声速约为 5920 m/s，使用 5 MHz 探头时，声波在钢中的波长约为？',
    options: [
      { key: 'A', text: '0.65 mm' },
      { key: 'B', text: '1.18 mm' },
      { key: 'C', text: '2.96 mm' },
      { key: 'D', text: '0.12 mm' },
    ],
    correct: 'B',
    explanation: 'λ = c / f = 5920 m/s ÷ 5×10⁶ Hz = 0.001184 m ≈ 1.18 mm。此波长决定了探头能分辨的最小缺陷尺寸（通常约为半波长，即 ~0.59 mm）。',
    category: 'UT',
    level: 1,
    difficulty: 'medium',
    knowledgePoint: '波长计算',
  },
  {
    id: 'ut-006',
    text: '根据 GB/T 11345，超声检测 B 级主要适用于以下哪类焊接接头？',
    options: [
      { key: 'A', text: '一般结构用焊接接头（最低要求）' },
      { key: 'B', text: '对安全性有较高要求的承压焊接接头' },
      { key: 'C', text: '核级和航空航天类最严苛构件' },
      { key: 'D', text: '复合材料和非金属焊接接头' },
    ],
    correct: 'B',
    explanation: 'GB/T 11345 规定三个检测级别：A 级（扫查范围最小，适用于一般结构）、B 级（扫查范围较大，适用于安全性较高的承压设备）、C 级（扫查范围最大，要求最严格）。',
    category: 'UT',
    level: 2,
    difficulty: 'medium',
    knowledgePoint: '检测标准与级别',
    standard: 'GB/T 11345',
  },
  {
    id: 'ut-007',
    text: '斜探头检测横向裂纹（垂直于焊缝轴线方向）时，最合适的探头折射角是？',
    options: [
      { key: 'A', text: '45°（K1）' },
      { key: 'B', text: '60°（K1.73）' },
      { key: 'C', text: '70°（K2.7）' },
      { key: 'D', text: '80°' },
    ],
    correct: 'A',
    explanation: '45° 斜探头的声束与横向裂纹面接近垂直入射，反射最强，最适合检测横向裂纹。此外，45° 探头在厚板中前后移动时覆盖范围合适，是检测横向缺陷的首选。',
    category: 'UT',
    level: 2,
    difficulty: 'hard',
    knowledgePoint: '探头选择',
  },
  {
    id: 'ut-008',
    text: '超声检测中，耦合剂的主要作用是什么？',
    options: [
      { key: 'A', text: '润滑探头，减少磨损' },
      { key: 'B', text: '排除探头与工件间的空气，确保声波传入' },
      { key: 'C', text: '增加超声波的发射频率' },
      { key: 'D', text: '改变声束在工件中的传播方向' },
    ],
    correct: 'B',
    explanation: '空气与金属的声阻抗差异极大（钢 ~47×10⁶ Pa·s/m vs 空气 ~400 Pa·s/m），声波在空气-金属界面反射率接近 100%。耦合剂（水、机油、甘油等）填充微小间隙，排除空气，使声波有效传入工件。',
    category: 'UT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: '耦合技术',
  },
  {
    id: 'ut-009',
    text: '距离-波幅曲线（DAC 曲线）在超声检测中的主要用途是？',
    options: [
      { key: 'A', text: '精确测量缺陷的位置坐标' },
      { key: 'B', text: '确定缺陷的具体形状' },
      { key: 'C', text: '建立灵敏度基准，对不同深度缺陷进行评定' },
      { key: 'D', text: '校正仪器的时基线' },
    ],
    correct: 'C',
    explanation: 'DAC 曲线（距离-波幅曲线）用一系列不同深度的参考反射体（如平底孔、横通孔）建立幅度-距离关系基准线。检测时将缺陷回波与 DAC 比较，判断是否超过评定基准，实现对不同深度缺陷的公平评定。',
    category: 'UT',
    level: 2,
    difficulty: 'medium',
    knowledgePoint: 'DAC 曲线',
  },
  {
    id: 'ut-010',
    text: '对于奥氏体不锈钢焊缝，超声检测最主要的困难是什么？',
    options: [
      { key: 'A', text: '表面粗糙度过大导致耦合困难' },
      { key: 'B', text: '粗大柱状晶粒导致的高声学噪声和声束散射' },
      { key: 'C', text: '不锈钢中纵波声速过低' },
      { key: 'D', text: '不锈钢导热性差导致探头过热' },
    ],
    correct: 'B',
    explanation: '奥氏体不锈钢焊缝凝固形成粗大柱状晶组织，晶粒尺寸可达毫米级。超声波遇到晶界时发生散射，产生大量"草状"噪声，信噪比极低，严重影响缺陷检测灵敏度。通常需使用低频（1~2 MHz）或相控阵技术。',
    category: 'UT',
    level: 2,
    difficulty: 'hard',
    knowledgePoint: '奥氏体材料检测',
  },

  // ──── RT · 射线检测 ────
  {
    id: 'rt-001',
    text: '射线检测中，像质计（IQI）的作用是什么？',
    options: [
      { key: 'A', text: '测量工件受到的实际辐射剂量' },
      { key: 'B', text: '评定本次照相能达到的最小缺陷检出灵敏度' },
      { key: 'C', text: '控制和计时曝光时间' },
      { key: 'D', text: '精确确定缺陷在工件中的位置' },
    ],
    correct: 'B',
    explanation: '像质计（Image Quality Indicator）放置于工件表面（射线源侧），底片冲洗后观察 IQI 上能清晰显示的最细丝径或最小孔径，以此评定该次照相的灵敏度（即可检出的最小缺陷尺寸）。',
    category: 'RT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: '像质计',
    standard: 'GB/T 3323',
  },
  {
    id: 'rt-002',
    text: '在 X 射线照相中，增大焦距（FFD）对图像质量的影响是？',
    options: [
      { key: 'A', text: '几何不清晰度增大，图像清晰度下降' },
      { key: 'B', text: '几何不清晰度减小，但射线强度下降，需延长曝光时间' },
      { key: 'C', text: '对比度明显提高，曝光时间不变' },
      { key: 'D', text: '减小焦距效果相同，只是成本更高' },
    ],
    correct: 'B',
    explanation: '几何不清晰度 Ug = d × b / (F - b)，增大焦距 F 使 Ug 减小，几何清晰度提高。但射线强度按平方反比律随距离平方成反比降低（I ∝ 1/F²），因此需要相应增加曝光量（mA·min）来补偿。',
    category: 'RT',
    level: 2,
    difficulty: 'medium',
    knowledgePoint: '焦距与清晰度',
  },
  {
    id: 'rt-003',
    text: 'γ 射线（如 Ir-192）与 X 射线检测相比，主要优点是？',
    options: [
      { key: 'A', text: '能量连续可调，更灵活' },
      { key: 'B', text: '图像对比度更高，清晰度更好' },
      { key: 'C', text: '不需外部电源，设备轻便，适合野外作业' },
      { key: 'D', text: '对人体辐射剂量远低于 X 射线' },
    ],
    correct: 'C',
    explanation: 'γ 射线源（Ir-192、Co-60 等）本身即是放射源，检测时只需屏蔽防护，不需高压电源。设备体积小、重量轻，特别适合管道内检测、野外施工和高空作业等 X 射线机无法到达的场合。',
    category: 'RT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: 'γ 射线特点',
  },
  {
    id: 'rt-004',
    text: '射线底片上，焊缝中的裂纹影像通常表现为？',
    options: [
      { key: 'A', text: '边缘清晰的圆形或椭圆形黑点' },
      { key: 'B', text: '不规则黑色斑块，边界模糊' },
      { key: 'C', text: '细线状深黑色影像，轮廓清晰，常有分叉' },
      { key: 'D', text: '与母材无明显对比的白色亮点' },
    ],
    correct: 'C',
    explanation: '裂纹为线状开口缺陷，与射线传播方向平行时对比度最强。底片上表现为：细线状（或树枝状）深黑色影像，轮廓相对清晰，可见走向，有时有尖端或分叉。气孔则为圆形黑点，夹渣为不规则黑斑。',
    category: 'RT',
    level: 1,
    difficulty: 'medium',
    knowledgePoint: '缺陷影像识别',
  },
  {
    id: 'rt-005',
    text: '底片上出现白色（亮区）针状或线状影像，最可能是哪种缺陷？',
    options: [
      { key: 'A', text: '气孔（钢中）' },
      { key: 'B', text: '夹钨（TIG 焊中的钨极脱落）' },
      { key: 'C', text: '裂纹' },
      { key: 'D', text: '未熔合' },
    ],
    correct: 'B',
    explanation: '钨的原子序数（74）远高于钢铁，对 X/γ 射线的吸收率极高。夹钨缺陷（TIG 焊中钨极碎片混入焊缝）在底片上因吸收更多射线而显示为白色（亮区）影像，形态通常为针状或不规则白点，是 RT 独特的缺陷特征。',
    category: 'RT',
    level: 2,
    difficulty: 'hard',
    knowledgePoint: '特殊缺陷识别',
  },

  // ──── MT · 磁粉检测 ────
  {
    id: 'mt-001',
    text: '磁粉检测（MT）主要适用于检测哪类缺陷？',
    options: [
      { key: 'A', text: '深层体积型缺陷（如内部夹渣）' },
      { key: 'B', text: '铁磁性材料表面及近表面的线性缺陷' },
      { key: 'C', text: '所有材料任意深度的缺陷' },
      { key: 'D', text: '仅能检测表面开口的裂纹' },
    ],
    correct: 'B',
    explanation: '磁粉检测利用缺陷处的漏磁场吸引磁粉形成磁痕。有效检测深度通常为表面以下 2~3 mm，主要针对铁磁性材料（碳钢、低合金钢、马氏体不锈钢等）的表面裂纹、发纹、折叠等线性缺陷。奥氏体不锈钢、铜铝等非铁磁性材料不能使用 MT。',
    category: 'MT',
    level: 1,
    difficulty: 'easy',
    knowledgePoint: 'MT 检测范围',
  },
  {
    id: 'mt-002',
    text: '检测轴类零件的横向裂纹（垂直于轴线方向），应选用哪种磁化方式？',
    options: [
      { key: 'A', text: '纵向磁化（线圈法）' },
      { key: 'B', text: '周向磁化（通电法）' },
      { key: 'C', text: '复合磁化（摆动磁场）' },
      { key: 'D', text: '感应磁化' },
    ],
    correct: 'B',
    explanation: '检测缺陷的最佳条件：磁场方向与缺陷走向垂直（夹角 >45°）。横向裂纹与轴线垂直，需要轴向（纵向）磁场——即周向磁化法（电流沿轴线方向通过工件，产生环绕轴线的周向磁场）。纵向磁化产生沿轴线的磁场，用于检测纵向缺陷。',
    category: 'MT',
    level: 2,
    difficulty: 'medium',
    knowledgePoint: '磁化方向选择',
  },
  {
    id: 'mt-003',
    text: 'MT 检测完成后，为什么通常需要对工件进行退磁处理？',
    options: [
      { key: 'A', text: '防止剩余磁粉对工件造成腐蚀' },
      { key: 'B', text: '消除剩磁对工件使用性能和后续加工精度的影响' },
      { key: 'C', text: '提高检测灵敏度以便重新检测' },
      { key: 'D', text: '满足国家标准对能耗的限制要求' },
    ],
    correct: 'B',
    explanation: '剩磁的危害：①影响依赖精密仪表的机械（如航空发动机轴承，剩磁会吸引切屑）；②干扰电弧焊（磁偏吹）；③影响使用中相邻磁敏元件精度；④影响后续机加工精度。因此承压设备、精密零件和有特殊要求的工件检测后必须退磁。',
    category: 'MT',
    level: 2,
    difficulty: 'medium',
    knowledgePoint: '退磁',
  },

  // ──── PT · 渗透检测 ────
  {
    id: 'pt-001',
    text: '渗透检测中，渗透剂进入表面开口缺陷的主要驱动力是？',
    options: [
      { key: 'A', text: '单纯的重力作用' },
      { key: 'B', text: '检测人员施加的外部压力' },
      { key: 'C', text: '毛细管力（毛细现象）' },
      { key: 'D', text: '渗透剂与缺陷内气体的化学反应' },
    ],
    correct: 'C',
    explanation: '渗透剂渗入缺陷的主要动力是毛细管力，其大小为 F = 4γcosθ/d（γ 为表面张力，θ 为接触角，d 为缺陷开口宽度）。缺陷越窄，毛细管力越强。良好的渗透剂具有小的表面张力和对工件材料的小接触角（良好润湿性）。',
    category: 'PT',
    level: 1,
    difficulty: 'medium',
    knowledgePoint: '渗透原理',
  },
  {
    id: 'pt-002',
    text: '荧光渗透检测（FP）与着色渗透检测（CP）相比，其主要优势是？',
    options: [
      { key: 'A', text: '操作程序更简单，无需暗室' },
      { key: 'B', text: '灵敏度更高，可检出更细小的缺陷' },
      { key: 'C', text: '不需要专用紫外灯，成本更低' },
      { key: 'D', text: '对工件材料限制更少' },
    ],
    correct: 'B',
    explanation: '荧光渗透剂在紫外线（365 nm 黑光）照射下发出明亮黄绿色荧光，在暗室中与暗色背景形成极高对比度，人眼对亮暗对比极为敏感，因此荧光 PT 的检测灵敏度通常比着色 PT 高 2~10 倍，是航空、核能等高要求行业的首选方法。',
    category: 'PT',
    level: 2,
    difficulty: 'medium',
    knowledgePoint: '检测方法对比',
  },
  {
    id: 'pt-003',
    text: '渗透检测后，清洗多余渗透剂时，操作人员清洗过度会导致？',
    options: [
      { key: 'A', text: '显像剂失效，无法正常工作' },
      { key: 'B', text: '缺陷内的渗透剂被洗除，造成漏检' },
      { key: 'C', text: '工件表面产生腐蚀' },
      { key: 'D', text: '紫外灯（黑光灯）强度下降' },
    ],
    correct: 'B',
    explanation: '清洗过度（过洗）是 PT 最常见、最严重的错误之一。过度清洗不仅去除表面多余渗透剂，还会将已渗入缺陷的渗透剂一并冲出，导致缺陷在显像阶段无法回渗显示，造成漏检。清洗应达到"表面清洁但缺陷内渗透剂保留"的程度。',
    category: 'PT',
    level: 1,
    difficulty: 'medium',
    knowledgePoint: '清洗工序',
  },
]

/* ============================================================
   Categories
   ============================================================ */

export const categories: Category[] = [
  {
    id: 'UT',
    name: 'UT',
    fullName: '超声波检测',
    description: '基于声波传播特性的体积型检测方法',
    color: '#4F7CFF',
    gradient: ['#4F7CFF', '#42D9FF'],
    questionCount: 486,
    completedCount: 142,
    icon: '〜',
  },
  {
    id: 'RT',
    name: 'RT',
    fullName: '射线检测',
    description: 'X 射线与 γ 射线透照成像技术',
    color: '#8B5CF6',
    gradient: ['#8B5CF6', '#A855F7'],
    questionCount: 312,
    completedCount: 58,
    icon: '◉',
  },
  {
    id: 'MT',
    name: 'MT',
    fullName: '磁粉检测',
    description: '铁磁性材料表面缺陷漏磁检测',
    color: '#32D583',
    gradient: ['#32D583', '#0EA472'],
    questionCount: 228,
    completedCount: 0,
    icon: '⊕',
  },
  {
    id: 'PT',
    name: 'PT',
    fullName: '渗透检测',
    description: '表面开口缺陷毛细渗透显示',
    color: '#FFB547',
    gradient: ['#FFB547', '#FF6B35'],
    questionCount: 195,
    completedCount: 0,
    icon: '◈',
  },
  {
    id: 'ET',
    name: 'ET',
    fullName: '涡流检测',
    description: '导电材料电磁感应检测方法',
    color: '#6366F1',
    gradient: ['#4F7CFF', '#8B5CF6'],
    questionCount: 143,
    completedCount: 0,
    icon: '∿',
  },
  {
    id: 'VT',
    name: 'VT',
    fullName: '目视检测',
    description: '直接或借助工具的外观检查',
    color: '#42D9FF',
    gradient: ['#42D9FF', '#32D583'],
    questionCount: 98,
    completedCount: 0,
    icon: '◎',
  },
  {
    id: '综合',
    name: '综合',
    fullName: '综合题库',
    description: '各方法综合与标准规范题目',
    color: '#FF5C7A',
    gradient: ['#FF5C7A', '#8B5CF6'],
    questionCount: 520,
    completedCount: 0,
    icon: '⊛',
  },
]

/* ============================================================
   Training Sets
   ============================================================ */

export const trainingSets: TrainingSet[] = [
  {
    id: 'ts-001',
    title: 'UT 二级 · 超声波基础',
    category: 'UT',
    questionCount: 50,
    completedCount: 12,
    estimatedMinutes: 25,
    difficulty: 'medium',
    description: '涵盖声学基础、探头选择、缺陷定量定性',
    gradient: ['#4F7CFF', '#42D9FF'],
    lastStudied: '2024-09-27',
  },
  {
    id: 'ts-002',
    title: 'RT 一级 · 射线基础',
    category: 'RT',
    questionCount: 40,
    completedCount: 0,
    estimatedMinutes: 20,
    difficulty: 'easy',
    description: '射线物理基础、像质计、底片评定入门',
    gradient: ['#8B5CF6', '#A855F7'],
  },
  {
    id: 'ts-003',
    title: 'UT 缺陷定量精练',
    category: 'UT',
    questionCount: 30,
    completedCount: 0,
    estimatedMinutes: 18,
    difficulty: 'hard',
    description: '当量法、端点衍射法、TOFD 缺陷定量',
    gradient: ['#263B9F', '#4F7CFF'],
  },
  {
    id: 'ts-004',
    title: 'GB/T 标准规范专项',
    category: '综合',
    questionCount: 60,
    completedCount: 0,
    estimatedMinutes: 35,
    difficulty: 'hard',
    description: '高频错题：标准条款、等级划分、验收准则',
    gradient: ['#FF5C7A', '#8B5CF6'],
  },
]

/* ============================================================
   Achievements
   ============================================================ */

export const achievements: Achievement[] = [
  {
    id: 'ach-001',
    title: '破冰者',
    description: '完成第一道题目',
    icon: '🏁',
    color: '#4F7CFF',
    gradient: ['#4F7CFF', '#42D9FF'],
    earned: true,
    earnedDate: '2024-09-15',
  },
  {
    id: 'ach-002',
    title: '连续 7 天',
    description: '连续打卡学习 7 天',
    icon: '🔥',
    color: '#FFB547',
    gradient: ['#FFB547', '#FF6B35'],
    earned: true,
    earnedDate: '2024-09-21',
  },
  {
    id: 'ach-003',
    title: 'UT 先行者',
    description: '完成 100 道 UT 题目',
    icon: '〜',
    color: '#4F7CFF',
    gradient: ['#4F7CFF', '#263B9F'],
    earned: true,
    earnedDate: '2024-09-25',
  },
  {
    id: 'ach-004',
    title: '千题挑战',
    description: '累计答题 1000 道',
    icon: '⚡',
    color: '#8B5CF6',
    gradient: ['#8B5CF6', '#A855F7'],
    earned: false,
    progress: 423,
    maxProgress: 1000,
  },
  {
    id: 'ach-005',
    title: '完美模拟',
    description: '模拟考试获得满分',
    icon: '✦',
    color: '#32D583',
    gradient: ['#32D583', '#0EA472'],
    earned: false,
    progress: 0,
    maxProgress: 1,
  },
  {
    id: 'ach-006',
    title: '标准达人',
    description: '标准规范专项正确率 ≥ 90%',
    icon: '📐',
    color: '#FF5C7A',
    gradient: ['#FF5C7A', '#C9184A'],
    earned: false,
    progress: 68,
    maxProgress: 90,
  },
]

/* ============================================================
   Mock Wrong Records
   ============================================================ */

export const wrongRecords: WrongRecord[] = [
  {
    questionId: 'ut-007',
    wrongCount: 3,
    lastWrongDate: '2024-09-27',
    history: [
      { date: '2024-09-20', answer: 'C', correct: false },
      { date: '2024-09-24', answer: 'B', correct: false },
      { date: '2024-09-27', answer: 'A', correct: true },
    ],
    mastered: false,
  },
  {
    questionId: 'rt-005',
    wrongCount: 2,
    lastWrongDate: '2024-09-26',
    history: [
      { date: '2024-09-22', answer: 'A', correct: false },
      { date: '2024-09-26', answer: 'A', correct: false },
    ],
    mastered: false,
  },
  {
    questionId: 'mt-002',
    wrongCount: 1,
    lastWrongDate: '2024-09-25',
    history: [
      { date: '2024-09-25', answer: 'A', correct: false },
    ],
    mastered: false,
  },
  {
    questionId: 'ut-002',
    wrongCount: 2,
    lastWrongDate: '2024-09-23',
    history: [
      { date: '2024-09-18', answer: 'B', correct: false },
      { date: '2024-09-23', answer: 'D', correct: true },
    ],
    mastered: true,
  },
]

/* ============================================================
   User Stats (mock)
   ============================================================ */

export const userStats = {
  name: '张明远',
  avatar: null,
  level: 12,
  xp: 1280,
  maxXp: 1500,
  todayCorrect: 34,
  todayTotal: 42,
  streak: 12,
  weeklyQuestions: 286,
  totalQuestions: 1423,
  studyMinutes: 204,
  accuracy: 0.81,
  weeklyAccuracy: [0.72, 0.78, 0.83, 0.75, 0.88, 0.81, 0.76],
  knowledgeBreakdown: [
    { topic: '超声波基础', accuracy: 0.92, category: 'UT' },
    { topic: '探头与耦合', accuracy: 0.84, category: 'UT' },
    { topic: '仪器调节', accuracy: 0.76, category: 'UT' },
    { topic: '缺陷评定', accuracy: 0.88, category: 'UT' },
    { topic: '标准规范', accuracy: 0.65, category: '综合' },
    { topic: '射线基础', accuracy: 0.71, category: 'RT' },
  ],
}

/* ============================================================
   Helpers
   ============================================================ */

export function getQuestionById(id: string): Question | undefined {
  return questions.find(q => q.id === id)
}

export function getQuestionsByCategory(category: string): Question[] {
  if (category === '综合') return questions
  return questions.filter(q => q.category === category)
}

export function getCategoryById(id: string): Category | undefined {
  return categories.find(c => c.id === id)
}

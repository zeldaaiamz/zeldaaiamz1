/* 演示数据 — 全部标注为 DEMO，无真实 API */
window.DEMO = {
  product: {
    name: "Sincerez 牛皮纸鼓励卡 54 张",
    asin: "B0DEMO-KRAFT54",
    note: "演示数据 · 参考 Etsy inspirational quote card 洞察 + image_brief_v1",
  },

  archives: {
    amazon: {
      label: "亚马逊 VOC（演示映射）",
      note: "映射：pain←jtbd.pain+未满足需求 · itch←expect+购买动机 · delight←emotion_points>0 · reason←jtbd.main_text+购买动机",
      pain: [
        "竞品纸薄、印刷模糊（参考品差评信号）",
        "尺寸比想象小，无对比参照易差评",
        "语句作者写 unknown，买家想知道出处",
        "包装不够「拿到就能送」",
      ],
      itch: [
        "希望礼盒打开即有仪式感，不用再包装",
        "期待打字机字体 + 牛皮纸复古手作感",
        "需要口袋尺寸，方便夹进礼物 / 圣诞袜",
        "想要每张语句都不重复、内容够振奋",
      ],
      delight: [
        "开箱牛皮纸盒 + 麻绳的「礼物感」（参考 VOC 包装提及率最高）",
        "纸张厚实 350gsm，侧光见纸纹",
        "语句恰到好处，适合送朋友 / 同事 / 老师",
        "一盒 54 张量大，可分发、课堂激励",
      ],
      reason: [
        "作为 stocking stuffer / 小礼物性价比清晰",
        "覆盖 Friends · Coworkers · Teachers · Moms · Self-Care",
        "与彩色印刷卡差异化：牛皮纸 + 打字机字 + 手工散落感",
        "Q4 圣诞季送礼需求集中",
      ],
    },
    etsy: {
      label: "Etsy 评论分析（演示 · 634096770 洞察摘要）",
      note: "来源：评论需求文档 383 条通读摘要 · 演示数据",
      pain: [
        "语句作者大量 unknown / anonymous（≤4★ 高频）",
        "纸张偏薄、印刷不够清晰（差评方向信号）",
        "部分买家觉得语句太泛、不够振奋",
        "尺寸预期不符（偶发）",
      ],
      itch: [
        "gift-ready 包装：牛皮纸盒、麻绳蝴蝶结",
        "variety：每张语句不同",
        "适合夹进贺卡 / 信件 / 礼物的附言卡",
        "晨间抽卡自我激励仪式",
      ],
      delight: [
        "包装开箱体验被提及 130/383，高于卡片本身",
        "情绪价值：made me cry / made my day",
        "卖家人情味（手写感谢卡、附赠）",
        "复古打字机字体 + 牛皮纸像手作而非量产",
      ],
      reason: [
        "88% 明确用途为送礼 / 分发善意",
        "完美 stocking stuffer、关怀包、婚礼伴手",
        "专业人士批量采购（诊室 / 课堂 / 教练）",
        "Q4（11–12 月）评论量约平时 2.5 倍",
      ],
    },
  },

  whitebgUploads: [
    { id: "u1", label: "白底 1", tone: "#e8dcc8" },
    { id: "u2", label: "白底 2", tone: "#dcc9a8" },
    { id: "u3", label: "白底 3", tone: "#cbb892" },
    { id: "u4", label: "白底 4", tone: "#bba57a" },
  ],

  models: [
    { id: "upload", name: "自有上传", cls: "model-upload" },
    { id: "whitebg", name: "白底真修", cls: "model-doubao" },
    { id: "chatgpt", name: "ChatGPT", cls: "model-chatgpt" },
    { id: "banana", name: "Banana", cls: "model-banana" },
    { id: "doubao", name: "豆包", cls: "model-doubao" },
    { id: "midjourney", name: "Midjourney", cls: "model-midjourney" },
  ],

  /* 秋霜：主图 / 细节 / 尺寸 */
  qiushuang: [
    {
      id: "qs-main",
      slotHint: "Listing #1",
      title: "主图（白底）",
      role: "产品占比 ≥85%",
      brief:
        "纯白 RGB255 背景。打开的牛皮纸盒在后，卡片在前错落/扇形叠放，略俯视 3/4。选打字机字最清晰的 3–5 张朝上。靠产品自身排版做出复古氛围，禁止道具与文字叠层。",
      prompt:
        "Amazon main image, pure white background RGB(255,255,255), kraft paper encouragement card box slightly open behind, 4-5 typewriter-font kraft cards fanned in front, product occupying >=85% of frame, 3/4 top-down angle, natural side light showing paper texture and 350gsm edge, no props, no text overlay, no envelope, photorealistic product shot",
    },
    {
      id: "qs-detail",
      slotHint: "Listing #4",
      title: "细节图 · 纸张厚度",
      role: "展现：侧面厚度 + 字迹锐利",
      brief:
        "卡片侧面特写 + 手指轻弯不折。标注 Thick 350gsm Kraft Cardstock；卖点 Sturdy · Natural · Rustic。对标参考品「纸薄、印刷模糊」差评。",
      prompt:
        "Macro detail of kraft cardstock edge thickness 350gsm, fingertip gently flexing card without crease, sharp typewriter print visible, warm side light, rustic natural paper fiber, clean background, Amazon secondary image style, no brand logos of others",
    },
    {
      id: "qs-size",
      slotHint: "Listing #3",
      title: "尺寸图",
      role: "对比物：扑克牌 / 手持",
      brief:
        "手持一张卡，或旁放扑克牌作对比。标注 2.5\" × 3.5\"（63×88 mm）。避免「比想象的小」差评，同时卖口袋大小、好携带。",
      prompt:
        "Size comparison: one kraft encouragement card held beside a standard poker playing card, labels 2.5 x 3.5 inch, soft daylight, shallow depth of field, Amazon infographic-ready still life, no envelope",
    },
  ],

  /* 安然：场景图（对应 Listing 其余槽位 + 扩展） */
  anran: [
    {
      id: "ar-54",
      slotHint: "Listing #2",
      title: "场景图 · 54 张铺开",
      role: "要点：量大、每张不同",
      brief:
        "54 张网格或大扇形铺开。标题意向：54 Unique Encouragement Cards / No Duplicates。买家最在意语句内容与不重复。",
      prompt:
        "Flat lay of many unique kraft typewriter quote cards arranged in a large fan or soft grid, warm wood or linen surface, natural light, variety clearly visible, Amazon A+ secondary image mood, no envelope, no other brand",
    },
    {
      id: "ar-gift",
      slotHint: "Listing #5",
      title: "场景图 · 礼盒半开 A1",
      role: "视觉语言：拿到就能送",
      brief:
        "本品 350gsm 牛皮纸礼盒盖掀开约 45°，鼓励卡斜插盒内。细麻绳/窄丝带 + 一小片干花或松枝（≤3）。标题意向：Gift-Ready · Tuck Into Any Gift。",
      prompt:
        "Sincerez kraft gift box lid open ~45 degrees, encouragement card tucked in filler angled toward camera, thin twine and one dried flower accent, warm side light, card text readable, gift-ready mood, no envelope, product-focused",
    },
    {
      id: "ar-quad",
      slotHint: "Listing #6",
      title: "场景图 · 四宫格用法",
      role: "A2 夹贺卡 + B1 关怀包 + C3 圣诞 + D1 课堂",
      brief:
        "四宫格覆盖 Hongyan 确认的四类场景；Q4 圣诞格优先。标题意向：Brighten Someone's Day。静物、不见人脸。",
      prompt:
        "Four-quadrant collage: card tucked in open greeting card; card in open kraft care pouch with tea; card on kraft gift with pine sprig for holidays; fan of cards on classroom desk with crayons; warm handmade palette, no faces, no envelope",
    },
    {
      id: "ar-who",
      slotHint: "Listing #7",
      title: "场景图 · 送给谁",
      role: "人群标签视觉化",
      brief:
        "美国家庭/职场生活静物暗示。标签：Friends · Coworkers · Teachers · Moms · Self-Care。配合 Q4 stocking stuffer。",
      prompt:
        "Lifestyle still life suggesting gifting to friends coworkers teachers moms self-care, kraft cards as hero, soft icons or small tags, warm American home/office props subtle, stocking stuffer vibe, no faces, Amazon listing image",
    },
    {
      id: "ar-wedding",
      slotHint: "扩展 / A+",
      title: "场景图 · 婚礼伴手 C1",
      role: "支线场景（可进预览替换）",
      brief:
        "白桌布特写；两张鼓励卡细丝带轻捆，靠香槟杯脚或席位名卡。婚礼感靠白 + 丝带 + 蜡封点到为止。",
      prompt:
        "Wedding favor still life: two kraft quote cards lightly tied with thin ribbon beside champagne glass base, wax seal optional, white tablecloth, soft daylight, elegant minimal, no bride, no envelope",
    },
  ],
};

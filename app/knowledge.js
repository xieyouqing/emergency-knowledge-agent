/* 自动生成，请勿手改。源：knowledge/*.json 中 status=published 的条目。重新生成：python tools/build_knowledge_js.py */
window.KNOWLEDGE = {
  "generated_at": "2026-11-21",
  "data_date": "2026-11-21",
  "slot_count": 16,
  "entry_count": 16,
  "slots": [
    {
      "id": "gas_leak",
      "name": "燃气泄漏",
      "icon": "gas_leak",
      "order": 10
    },
    {
      "id": "fire_home",
      "name": "家庭火灾",
      "icon": "fire_home",
      "order": 20
    },
    {
      "id": "co_poisoning",
      "name": "一氧化碳中毒",
      "icon": "co_poisoning",
      "order": 30
    },
    {
      "id": "fall_elderly",
      "name": "老人跌倒",
      "icon": "fall_elderly",
      "order": 40
    },
    {
      "id": "scald_burn",
      "name": "烧烫伤",
      "icon": "scald_burn",
      "order": 50
    },
    {
      "id": "electric_shock",
      "name": "触电",
      "icon": "electric_shock",
      "order": 60
    },
    {
      "id": "electric_fire",
      "name": "电器起火",
      "icon": "electric_fire",
      "order": 65
    },
    {
      "id": "airway_obstruction",
      "name": "气道梗阻",
      "icon": "airway_obstruction",
      "order": 70
    },
    {
      "id": "drowning",
      "name": "溺水",
      "icon": "drowning",
      "order": 80
    },
    {
      "id": "earthquake",
      "name": "地震",
      "icon": "earthquake",
      "order": 90
    },
    {
      "id": "elevator_trapped",
      "name": "电梯困人",
      "icon": "elevator_trapped",
      "order": 100
    },
    {
      "id": "cpr",
      "name": "心肺复苏",
      "icon": "cpr",
      "order": 105
    },
    {
      "id": "severe_bleeding",
      "name": "大出血",
      "icon": "severe_bleeding",
      "order": 110
    },
    {
      "id": "stroke",
      "name": "卒中（中风）",
      "icon": "stroke",
      "order": 120
    },
    {
      "id": "heatstroke",
      "name": "中暑",
      "icon": "heatstroke",
      "order": 130
    },
    {
      "id": "food_poisoning",
      "name": "食物中毒",
      "icon": "food_poisoning",
      "order": 140
    }
  ],
  "entries": {
    "airway_obstruction": {
      "schema_version": "1.0",
      "id": "airway_obstruction",
      "name": "气道梗阻",
      "aliases": [
        "噎住了",
        "噎着",
        "卡住喉咙",
        "呛到气管",
        "被东西噎到",
        "异物卡喉"
      ],
      "category": "airway_obstruction",
      "keywords": [
        "噎住",
        "噎着",
        "卡住喉咙",
        "卡喉",
        "呛到",
        "窒息",
        "异物",
        "喘不上"
      ],
      "life_threatening": true,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "让他低头、身体前倾",
            "tool": null
          },
          {
            "text": "用力拍后背两肩胛骨之间 5 次",
            "tool": null
          },
          {
            "text": "再环抱腹部向内向上冲压 5 次",
            "tool": null
          },
          {
            "text": "拍背和冲压交替，直到东西出来",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "人没气了立刻打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          },
          {
            "text": "没气了接着做按压和人工呼吸",
            "tool": null
          },
          {
            "text": "一岁以下婴儿改用胸部冲击",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要只拍背不冲压，要交替做",
            "tool": null
          },
          {
            "text": "不要给一岁以下婴儿做腹部冲击",
            "tool": null
          },
          {
            "text": "还能咳嗽时不要强行去抠",
            "tool": null
          },
          {
            "text": "不要把人倒过来提脚抖",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "中国红十字会《气道梗阻的急救方法》",
        "url": "https://www.redcross.org.cn/autoweb/hlwmh/third/hlwmh_hlwmhsmjk_250544.html",
        "date": "2026-11-18",
        "quote": "如果患者是成人或儿童，我们应用力拍打患者后背肩胛骨之间的部位5次，以利于把卡在喉咙的东西排出来，然后再冲击按压患者腹部5次。拍打后背和腹部冲击交替进行，直到堵塞物排出。"
      },
      "daily": {
        "summary": "有人噎住说不出话时，拍背 5 次加腹部冲击 5 次，交替做到异物排出。",
        "why": "异物完全堵住气道时，人无法说话、咳嗽，几分钟内就会缺氧。拍背能产生震动和气流把异物松动，腹部冲击能把肺内残气挤压成向上的气流把异物顶出来，两种手法交替比单做一种更有效。婴儿肝脏大、位置低，腹部冲击容易造成损伤，所以改用胸部冲击。",
        "prevention": [
          "吃饭时不要大笑、说话、走动",
          "老人吃肉、年糕要切小块",
          "不要给三岁以下孩子整颗坚果",
          "小孩不要边跑边吃"
        ],
        "misconception": "噎住先喂水冲下去——错，喂水会让异物卡得更紧或呛进气管，先排异物。"
      },
      "offline": true,
      "version": "1.0",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-18",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-18",
          "detail": "原文中逐字定位成功（本次未校验证书，仅确认字面一致）"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-18"
    },
    "co_poisoning": {
      "schema_version": "1.0",
      "id": "co_poisoning",
      "name": "一氧化碳中毒",
      "aliases": [
        "煤气中毒",
        "一氧化碳中毒",
        "烧炭中毒",
        "炭火中毒",
        "煤炉中毒"
      ],
      "category": "co_poisoning",
      "keywords": [
        "一氧化碳",
        "煤气中毒",
        "烧炭",
        "炭火",
        "炭盆",
        "煤炉",
        "中毒",
        "头晕恶心"
      ],
      "life_threatening": true,
      "triage": {
        "question": "人现在是清醒的，还是叫不醒？",
        "options": [
          {
            "value": "unresponsive",
            "label": "叫不醒，但还有呼吸",
            "override": {
              "immediate": [
                {
                  "text": "马上打 120",
                  "tool": {
                    "name": "dial",
                    "number": "120"
                  }
                },
                {
                  "text": "先把人抬到室外通风处",
                  "tool": null
                },
                {
                  "text": "摆成侧卧位，保持气道通",
                  "tool": null
                },
                {
                  "text": "解开衣领，注意保暖",
                  "tool": null
                }
              ]
            }
          },
          {
            "value": "awake",
            "label": "清醒能说话",
            "override": null
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "马上打开门窗通风",
            "tool": null
          },
          {
            "text": "关掉煤气、熄灭炭火",
            "tool": null
          },
          {
            "text": "把人抬到室外通风处",
            "tool": null
          },
          {
            "text": "解开衣领、领带，注意保暖",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "昏迷或呼吸心跳停了立刻打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          },
          {
            "text": "呼吸心跳停了做按压和人工呼吸",
            "tool": null
          },
          {
            "text": "自己进去救人要匍匐前进",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "现场严禁明火",
            "tool": null
          },
          {
            "text": "不要开关电灯、按门铃",
            "tool": null
          },
          {
            "text": "不要站着深呼吸，要匍匐进入",
            "tool": null
          },
          {
            "text": "不要留在屋里等人来",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "国家卫生健康委员会 2025-01-05 新闻发布会（中国疾控中心职业卫生与中毒控制所所长 孙新）",
        "url": "https://www.ndcpa.gov.cn/jbkzzx/c100009/common/content/content_1876073112178118656.html",
        "date": "2026-11-18",
        "quote": "一氧化碳比空气比重稍微轻一点，所以救助人员进入一氧化碳中毒现场，匍匐行动比站立要更安全。进入一氧化碳中毒的现场，要严禁明火，室内一旦一氧化碳浓度比较高，开闭电灯造成的火花往往引起爆炸。",
        "supplementary": [
          {
            "name": "同上（孙新答问「发生一氧化碳中毒如何施救」段）",
            "url": "https://www.ndcpa.gov.cn/jbkzzx/c100009/common/content/content_1876073112178118656.html",
            "date": "2026-11-21",
            "quote": "对待中毒患者，首先要把他移离中毒环境，转移到通风良好的环境。注意患者的保暖，解开衣物，特别是领带、衣领，保持呼吸畅通。",
            "supports": "分诊分支 unresponsive 的 immediate[1..3]：抬到室外通风处、解开衣领、注意保暖"
          },
          {
            "name": "北京市卫生健康委员会《急危重症的家庭急救方法(二)》（昏迷段）",
            "url": "https://wjw.beijing.gov.cn/bmfw_20143/jkzs/jksh/202303/t20230329_2947204.html",
            "date": "2026-11-21",
            "quote": "对有呼吸、心跳的患者，首先保持其呼吸道通畅，然后将他摆放成侧卧位(复苏位)，并紧急呼救。",
            "supports": "分诊分支 unresponsive 的 immediate[2]：叫不醒但有呼吸时摆侧卧位，这是与「心跳停了做按压」分开的关键动作"
          }
        ]
      },
      "daily": {
        "summary": "一氧化碳无色无味，中毒后先开窗、断源、把人搬到通风处，再打 120。",
        "why": "一氧化碳与血红蛋白结合能力远强于氧气，会让人体组织缺氧，所以人会觉得头晕、恶心、乏力，重则昏迷。它比空气略轻，聚集在上方，站着呼吸吸入浓度更高，所以救助者要匍匐进入。达到一定浓度时，开灯、按门铃产生的微小电火花就能引爆。",
        "prevention": [
          "燃气热水器不要装在浴室里",
          "用炭火取暖必须开窗通风",
          "建议装一氧化碳报警器",
          "不要在密闭车内开空调睡觉"
        ],
        "misconception": "屋里放盆水能防中毒——错，一氧化碳几乎不溶于水，放水没有任何作用。"
      },
      "offline": true,
      "version": "1.1",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文中逐字定位成功；补强 2/2 pass",
          "supplementary": [
            {
              "url": "https://www.ndcpa.gov.cn/jbkzzx/c100009/common/content/content_1876073112178118656.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            },
            {
              "url": "https://wjw.beijing.gov.cn/bmfw_20143/jkzs/jksh/202303/t20230329_2947204.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-21"
    },
    "cpr": {
      "schema_version": "1.0",
      "id": "cpr",
      "name": "心肺复苏",
      "aliases": [
        "没有呼吸了",
        "没呼吸了",
        "呼吸停了",
        "心跳停了",
        "没有脉搏",
        "没气了",
        "心肺复苏"
      ],
      "category": "cpr",
      "keywords": [
        "心肺复苏",
        "CPR",
        "按压",
        "人工呼吸",
        "心跳停",
        "没呼吸",
        "没脉搏",
        "猝死"
      ],
      "life_threatening": true,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "打 120，同时开始按压",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          },
          {
            "text": "掌根压两乳头连线中点",
            "tool": null
          },
          {
            "text": "往下压 5 到 6 厘米深",
            "tool": null
          },
          {
            "text": "每分钟压 100 到 120 次",
            "tool": null
          },
          {
            "text": "每压 30 次，吹 2 口气",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "压完让胸口完全弹回来",
            "tool": null
          },
          {
            "text": "清掉嘴里的东西再吹气",
            "tool": null
          },
          {
            "text": "头后仰、抬下巴打开气道",
            "tool": null
          },
          {
            "text": "吹 1 秒，看胸口有没有起伏",
            "tool": null
          },
          {
            "text": "一直压到急救人员来接手",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "别为用 AED 长时间停按压",
            "tool": null
          },
          {
            "text": "按压别中断，掌根别离胸",
            "tool": null
          },
          {
            "text": "吹气别太猛，会过度通气",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "天津市卫生健康委员会《就介绍“季节与健康”月度（7月）有关情况举行新闻发布会（文字实录）》（天津市急救中心演示心肺复苏部分）",
        "url": "https://wsjk.tj.gov.cn/ZMHD5990/HDFT4691/202607/t20260724_7341425.html",
        "date": "2026-11-21",
        "quote": "心肺复苏主要包括三个步骤,依次是胸外按压、开放气道和人工呼吸。 胸外按压:施救者将一只手掌根放在患者两乳头连线中点(即胸骨下半部),四指翘起,另一只手紧扣其上,双上肢绷直,上半身前倾,以髋关节为支点,用上半身的力量垂直向下按压30次。按压深度成人为5-6厘米,儿童约5厘米,婴儿约4厘米,按压频率100-120次/分,保证每次按压后胸廓完全恢复原状。"
      },
      "daily": {
        "summary": "没有呼吸、叫不醒也摸不到脉搏，要一边打 120 一边按压胸口。",
        "why": "心搏骤停后大脑几分钟内就会受损，等救护车来再救往往来不及。胸外按压是替心脏挤压血液，把血送到脑子里。步骤顺序是胸外按压、开放气道、人工呼吸，按压 30 次配合 2 次人工呼吸循环做，一分钟压 100 到 120 次，成人压下去 5 到 6 厘米。",
        "prevention": [
          "全家都学会心肺复苏手法",
          "家里有人有心脏病要定期复查",
          "单元楼里先认一下 AED 在哪"
        ],
        "misconception": "用了 AED 就不用按压了——错，不可因操作 AED 长时间中断按压。"
      },
      "offline": true,
      "version": "0.1",
      "status": "published",
      "review": {
        "author": "待指派",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "原文中逐字定位成功"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-21",
      "updated_at": "2026-11-21"
    },
    "drowning": {
      "schema_version": "1.0",
      "id": "drowning",
      "name": "溺水",
      "aliases": [
        "溺水",
        "淹溺",
        "落水",
        "掉水里",
        "水里捞上来",
        "淹了"
      ],
      "category": "drowning",
      "keywords": [
        "溺水",
        "淹溺",
        "落水",
        "掉水里",
        "水里捞",
        "淹了",
        "呛水",
        "游泳池",
        "浴缸"
      ],
      "life_threatening": true,
      "triage": {
        "question": "人还在水里，还是已经救上岸了？",
        "options": [
          {
            "value": "in_water",
            "label": "还在水里",
            "override": {
              "immediate": [
                {
                  "text": "大声呼救，马上打 120",
                  "tool": {
                    "name": "dial",
                    "number": "120"
                  }
                },
                {
                  "text": "用竹竿、绳子或漂浮物拉人",
                  "tool": null
                },
                {
                  "text": "别下水，也别手拉手救人",
                  "tool": null
                }
              ]
            }
          },
          {
            "value": "on_land",
            "label": "已经上岸",
            "override": null
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "大声呼救，马上打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          },
          {
            "text": "清理口鼻里的泥沙、水草",
            "tool": null
          },
          {
            "text": "没呼吸就开放气道，先吹 2 到 5 口气",
            "tool": null
          },
          {
            "text": "再按压30次、吹气2次，反复做",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "按压每分钟 100 到 120 次",
            "tool": null
          },
          {
            "text": "有呼吸就侧卧，脱去湿衣服保暖",
            "tool": null
          },
          {
            "text": "一直做到呼吸恢复或急救人员到",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要倒挂控水，也不要膝盖顶腹",
            "tool": null
          },
          {
            "text": "不要手拉手下水救人",
            "tool": null
          },
          {
            "text": "不要只按压、不吹气",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "中国红十字会《暑期防淹溺》",
        "url": "https://www.redcross.org.cn/autoweb/hlwmh/third/hlwmh_hlwmhsmjk_250756.html?firstcode=",
        "date": "2026-11-21",
        "quote": "当淹溺者被救上岸后，应放在坚实的地面上，迅速清除口腔、鼻咽部的异物（如淤泥、杂草等）。迅速判断其意识和呼吸，如果已经没有任何反应，没有呼吸，立即进行心肺复苏，直到专业急救人员到达现场为止。",
        "supplementary": [
          {
            "name": "漳州市红十字会《生命教育之溺水岸上救护》（CPR 顺序）",
            "url": "http://www.zzhszh.org.cn/cms/html/zzshszh/2022-07-25/676962101.html",
            "date": "2026-11-21",
            "quote": "抢救溺水者的心肺复苏操作应按照打开气道-人工呼吸-胸外按压的顺序进行。",
            "supports": "steps.immediate[2..3]：溺水是窒息性骤停，先开放气道、吹气，再按压"
          },
          {
            "name": "漳州市红十字会《生命教育之溺水岸上救护》（通气与按压比）",
            "url": "http://www.zzhszh.org.cn/cms/html/zzshszh/2022-07-25/676962101.html",
            "date": "2026-11-21",
            "quote": "对于心搏骤停者，立即给予2至5次人工呼吸，然后开始以30:2的按压/吹气比例（按压30次，吸气2次）实施心肺复苏。",
            "supports": "steps.immediate[2..3] 与 next[0]：先吹 2-5 口，再 30:2，按压 100-120 次/分"
          },
          {
            "name": "漳州市红十字会《生命教育之溺水岸上救护》（不控水）",
            "url": "http://www.zzhszh.org.cn/cms/html/zzshszh/2022-07-25/676962101.html",
            "date": "2026-11-21",
            "quote": "不管溺水者是否还有呼吸，任何情况下都不要对其进行各种形式的控水，如倒挂奔跑、膝盖顶腹、海姆立克等。",
            "supports": "steps.never[0]：任何情况都不控水"
          }
        ]
      },
      "daily": {
        "summary": "溺水救上岸后先清理口鼻；没呼吸就按 A-B-C 做心肺复苏，任何情况都不要控水。",
        "why": "溺水致命的根源是缺氧，不是肺里灌满了水。所以要先开放气道、吹气，再做胸外按压；控水控出来的多是胃里的东西，还会延误抢救。有呼吸的人侧卧保暖、尽快送医。",
        "prevention": [
          "不去不熟悉的水域游泳",
          "在有救生员的泳池游泳",
          "下水前先热身"
        ],
        "misconception": "倒挂控水能救命——错，控出来多是胃里的水，还会延误心肺复苏。"
      },
      "offline": true,
      "version": "1.0",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文中逐字定位成功；补强 3/3 pass（2026-11-21 抓取核对）",
          "supplementary": [
            {
              "url": "http://www.zzhszh.org.cn/cms/html/zzshszh/2022-07-25/676962101.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功（CPR 顺序）"
            },
            {
              "url": "http://www.zzhszh.org.cn/cms/html/zzshszh/2022-07-25/676962101.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功（2-5 次通气与 30:2）"
            },
            {
              "url": "http://www.zzhszh.org.cn/cms/html/zzshszh/2022-07-25/676962101.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功（不控水）"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-21",
      "updated_at": "2026-11-21"
    },
    "earthquake": {
      "schema_version": "1.0",
      "id": "earthquake",
      "name": "地震",
      "aliases": [
        "地震了",
        "地震",
        "余震",
        "楼在晃",
        "房子在晃"
      ],
      "category": "earthquake",
      "keywords": [
        "地震",
        "余震",
        "晃动",
        "房子塌",
        "楼塌",
        "避难",
        "被困",
        "废墟"
      ],
      "life_threatening": true,
      "triage": {
        "question": "你现在在哪儿？",
        "options": [
          {
            "value": "indoor",
            "label": "在室内",
            "override": {
              "immediate": [
                {
                  "text": "就地蹲下或跪下，别跑",
                  "tool": null
                },
                {
                  "text": "躲到桌子下或沙发旁",
                  "tool": null
                },
                {
                  "text": "一只手抓牢固定物，护住头",
                  "tool": null
                },
                {
                  "text": "远离玻璃窗和吊灯",
                  "tool": null
                }
              ]
            }
          },
          {
            "value": "outdoor",
            "label": "在室外",
            "override": {
              "immediate": [
                {
                  "text": "找开阔地就地蹲下",
                  "tool": null
                },
                {
                  "text": "远离高楼、电线杆、广告牌",
                  "tool": null
                },
                {
                  "text": "护住头，别站在围墙下",
                  "tool": null
                }
              ]
            }
          },
          {
            "value": "trapped",
            "label": "被埋或被困",
            "override": {
              "immediate": [
                {
                  "text": "别乱动，先护住口鼻",
                  "tool": null
                },
                {
                  "text": "有节奏地敲管道或墙壁",
                  "tool": null
                },
                {
                  "text": "节省体力，别长时间大喊",
                  "tool": null
                },
                {
                  "text": "能移动就先找水和出口",
                  "tool": null
                }
              ]
            }
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "伏地、遮挡、手抓牢",
            "tool": null
          },
          {
            "text": "蹲伏或跪伏，护住头部",
            "tool": null
          },
          {
            "text": "躲到桌下或沙发旁边",
            "tool": null
          },
          {
            "text": "避开玻璃和吊灯等悬挂物",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "晃动停止后有序撤到室外",
            "tool": null
          },
          {
            "text": "走楼梯，不要坐电梯",
            "tool": null
          },
          {
            "text": "被困时有节奏敲管道求救",
            "tool": null
          },
          {
            "text": "到开阔地，远离建筑物",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要跳楼",
            "tool": null
          },
          {
            "text": "不要乘坐电梯",
            "tool": null
          },
          {
            "text": "被困时不要长时间大声呼救",
            "tool": null
          },
          {
            "text": "晃动时不要往楼梯冲",
            "tool": null
          }
        ]
      },
      "emergency_number": "119",
      "source": {
        "name": "应急管理部、中国地震局新闻发布会（中国政府网转载《人民日报》2025-05-13）",
        "url": "https://www.gov.cn/lianbo/bumen/202505/content_7023490.htm",
        "date": "2026-11-18",
        "quote": "如果身处室内要根据\"伏地、遮挡、手抓牢\"的原则就近躲避，采取蹲伏或跪伏的姿势，寻求牢固的物体来遮挡或者是保护好头部，比如躲在桌子底下或者是沙发旁边，同时手要抓住身边的固定物以防止身体滑动或者被甩出去，也要避开玻璃和吊灯等悬挂物。"
      },
      "daily": {
        "summary": "地震先就地躲避，别往楼下跑。护住头、抓牢固定物，晃动停了再撤。",
        "why": "地震的强晃动通常只有几十秒，大部分伤害来自坠物和摔倒，而不是房子整体垮塌。所以就近躲避、护住头、抓住固定物，比冲向楼梯更安全。晃动时楼梯是最容易失稳和踩踏的地方，电梯可能断电困人。被困时长时间大喊会快速耗尽体力和氧气，有节奏敲击更省力也更容易被听到。",
        "prevention": [
          "高柜和书架用支架固定上墙",
          "床头不要放重物和挂画",
          "家里备手电、口哨、饮用水",
          "提前约定家人集合地点"
        ],
        "misconception": "地震了要马上冲下楼——错，晃动时跑动更容易被坠物砸中，先就近躲避。"
      },
      "offline": true,
      "version": "1.0",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-18",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-18",
          "detail": "原文中逐字定位成功（本次未校验证书，仅确认字面一致）"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-18"
    },
    "electric_fire": {
      "schema_version": "1.0",
      "id": "electric_fire",
      "name": "电器起火",
      "aliases": [
        "插排着火",
        "插排冒烟",
        "插座冒烟",
        "插座着火",
        "插线板着火",
        "电线起火",
        "电器着火"
      ],
      "category": "electric_fire",
      "keywords": [
        "插排",
        "插座",
        "插线板",
        "电线",
        "电器",
        "冒烟",
        "起火",
        "电气火灾"
      ],
      "life_threatening": true,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "先切断电源，关电闸",
            "tool": null
          },
          {
            "text": "用干粉或气体灭火器灭",
            "tool": null
          },
          {
            "text": "断电以后才能用水浇",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "烧到旁边东西也要先断电",
            "tool": null
          },
          {
            "text": "电视机只从侧面靠近",
            "tool": null
          },
          {
            "text": "灭火器别对着屏幕喷",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要直接泼水灭火",
            "tool": null
          },
          {
            "text": "千万不能先用水救火",
            "tool": null
          },
          {
            "text": "电视机起火别用水浇",
            "tool": null
          }
        ]
      },
      "emergency_number": "119",
      "source": {
        "name": "中华人民共和国应急管理部《初期火灾如何救？》（第 2 条 电气起火）",
        "url": "https://www.mem.gov.cn/kp/shaq/201712/t20171213_365921.shtml",
        "date": "2026-11-21",
        "quote": "电气起火：家用电器或线路着火，要先切断电源，再用干粉或气体灭火器灭火，不可直接泼水灭火，以防触电或电器爆炸伤人。"
      },
      "daily": {
        "summary": "插排、插座、电线冒烟着火，必须先断电再灭火，带电泼水会触电。",
        "why": "电气线路和设备起火时通常还带着电，水能导电，直接泼上去电流会顺着水柱回到人身上。所以顺序是固定的：先切断电源，再用干粉或气体灭火器灭火；只有在确定电源已经切断的情况下，才可以用水。火引着了旁边的桌子窗帘，也仍然要先断电再扑救。",
        "prevention": [
          "插排别插太多大功率电器",
          "别把导线裸端直接插进插座",
          "灯泡别用纸灯罩、别用布包"
        ],
        "misconception": "电器着火先泼水降温——错，带电泼水会触电，也可能让电器爆炸伤人。"
      },
      "offline": true,
      "version": "0.1",
      "status": "published",
      "review": {
        "author": "待指派",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "原文中逐字定位成功"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-21",
      "updated_at": "2026-11-21"
    },
    "electric_shock": {
      "schema_version": "1.0",
      "id": "electric_shock",
      "name": "触电",
      "aliases": [
        "触电",
        "被电了",
        "电到了",
        "漏电",
        "电击",
        "有人被电"
      ],
      "category": "electric_shock",
      "keywords": [
        "触电",
        "电到",
        "电击",
        "漏电",
        "被电",
        "电伤",
        "电闸",
        "电线"
      ],
      "life_threatening": true,
      "triage": {
        "question": "碰到的是家里的插座电线，还是外面的高压线？",
        "options": [
          {
            "value": "high_voltage",
            "label": "高压线 / 变压器",
            "override": {
              "immediate": [
                {
                  "text": "别靠近，退出 10 米外",
                  "tool": null
                },
                {
                  "text": "打电话让电网停电",
                  "tool": null
                },
                {
                  "text": "打 120 等专业救援",
                  "tool": {
                    "name": "dial",
                    "number": "120"
                  }
                }
              ]
            }
          },
          {
            "value": "home_220v",
            "label": "家里插座、电器、电线",
            "override": null
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "先切断电源或拉下电闸",
            "tool": null
          },
          {
            "text": "够不到闸就用干木棍挑开电线",
            "tool": null
          },
          {
            "text": "确认自己不会触电再去救人",
            "tool": null
          },
          {
            "text": "把触电者移到安全干燥处",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "烧伤处用干净布轻盖，别乱涂",
            "tool": null
          },
          {
            "text": "清醒的就地平卧，别走动",
            "tool": null
          },
          {
            "text": "昏迷或呼吸心跳停了打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          }
        ],
        "never": [
          {
            "text": "不要徒手去拉触电的人",
            "tool": null
          },
          {
            "text": "不要用湿木棍、金属物挑电线",
            "tool": null
          },
          {
            "text": "看到落地电线千万不要走近",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "中国红十字会《提高意识防触电》",
        "url": "https://www.redcross.org.cn/autoweb/hlwmh/third/hlwmh_hlwmhsmjk_250818.html",
        "date": "2026-11-18",
        "quote": "应迅速切断电源，使触电者尽快脱离电源。确认自己无触电危险再进行救护。",
        "supplementary": [
          {
            "name": "《急诊与灾难医学相关共识》（电击与雷击段），cem.org.cn",
            "url": "http://survey.cem.org.cn/rhtml/20190702/index.htm",
            "date": "2026-11-21",
            "quote": "高压电线下有人触电，应尽快通知电网有关部门停电，禁止进入10米半径区域，以免救援者触电身亡",
            "supports": "分诊分支 high_voltage 的 immediate[0..1]：不靠近、退到 10 米外、通知电网停电。这是「干木棍挑电线」绝对不能套用的情形"
          },
          {
            "name": "同上（电击与雷击段，清醒者处置）",
            "url": "http://survey.cem.org.cn/rhtml/20190702/index.htm",
            "date": "2026-11-21",
            "quote": "若伤者清醒，应让伤者就地平卧，不要站立或走动，防止继发性休克或心衰",
            "supports": "支撑 next 段新增步骤：脱离电源后清醒者应就地平卧，不得站立走动"
          }
        ]
      },
      "daily": {
        "summary": "触电先断电，再救人。自己不安全就别上手，徒手拉人会一起被电。",
        "why": "人体是导电体，触电时电流会持续通过身体。徒手去拉，救护者自己也会成为电流通路，两个人一起受伤。所以第一步永远是切断电源，而不是先碰人。落地电线周围地面可能存在跨步电压，走近就可能被电到。",
        "prevention": [
          "插座加装儿童保护盖",
          "不用湿手插拔插头",
          "老化电线及时更换",
          "装漏电保护器并定期试跳"
        ],
        "misconception": "穿胶鞋去拉人就安全——不可靠，鞋底可能破损或潮湿，正确做法是断电或用干燥绝缘物。"
      },
      "offline": true,
      "version": "1.1",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文中逐字定位成功；补强 2/2 pass",
          "supplementary": [
            {
              "url": "http://survey.cem.org.cn/rhtml/20190702/index.htm",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            },
            {
              "url": "http://survey.cem.org.cn/rhtml/20190702/index.htm",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-21"
    },
    "elevator_trapped": {
      "schema_version": "1.0",
      "id": "elevator_trapped",
      "name": "电梯困人",
      "aliases": [
        "电梯困住",
        "被困电梯",
        "电梯不动了"
      ],
      "category": "elevator_trapped",
      "keywords": [
        "电梯",
        "困住",
        "关在里面",
        "电梯停了"
      ],
      "life_threatening": false,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "按黄色警铃或通话键",
            "tool": null
          },
          {
            "text": "拨打电梯内张贴的救援电话",
            "tool": null
          },
          {
            "text": "说清楼栋、单元和被困人数",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "拍门呼救，等待救援",
            "tool": null
          },
          {
            "text": "报出电梯编号和楼层",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要强行扒门",
            "tool": null
          },
          {
            "text": "不要爬出轿厢顶",
            "tool": null
          },
          {
            "text": "不要跳跃晃动",
            "tool": null
          }
        ]
      },
      "emergency_number": "119",
      "source": {
        "name": "国家市场监督管理总局《3·15国际消费者权益日 特种设备乘坐（用）安全提示》",
        "url": "https://www.samr.gov.cn/xw/zj/art/2023/art_db1260bd5bd24bd7866941dbd48b1c87.html",
        "date": "2026-11-18",
        "quote": "电梯因停电、故障等原因导致乘客被困在轿厢内时，乘客请使用轿内报警装置、警铃按钮、手机等通信设备及时与外界联络，并耐心等待救援。切勿强行扒门、盲目自救。轿厢设计留有通风孔，乘客不会造成窒息。"
      },
      "daily": {
        "summary": "电梯困人是设备保护动作，轿厢内有通风，通常不会窒息。",
        "why": "电梯检测到异常会自动停运并锁门，这是保护机制，不是故障失控。轿厢不是密闭空间，有通风口，短时间不会缺氧。贸然扒门或爬出才是真正的危险来源。",
        "prevention": [
          "进电梯前看清是否超载",
          "不乘坐无年检标志的电梯"
        ],
        "misconception": "被困后会缺氧窒息——通常不会，轿厢不是密闭空间。"
      },
      "offline": true,
      "version": "0.3",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-18",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-18",
          "detail": "原文中逐字定位成功（本次未校验证书，仅确认字面一致）"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-18"
    },
    "fall_elderly": {
      "schema_version": "1.0",
      "id": "fall_elderly",
      "name": "老人跌倒",
      "aliases": [
        "摔倒了",
        "老人摔倒",
        "跌倒了",
        "起不来",
        "摔了一跤"
      ],
      "category": "fall_elderly",
      "keywords": [
        "跌倒",
        "摔倒",
        "摔跤",
        "起不来",
        "老人",
        "骨折",
        "爬不起来"
      ],
      "life_threatening": false,
      "triage": {
        "question": "现在能自己试着动一动胳膊腿吗？",
        "options": [
          {
            "value": "cannot_move",
            "label": "动不了 / 疼得厉害",
            "override": {
              "immediate": [
                {
                  "text": "别动，原地保持姿势",
                  "tool": null
                },
                {
                  "text": "大声喊人或打电话求助",
                  "tool": null
                },
                {
                  "text": "用衣物垫子盖住保暖",
                  "tool": null
                }
              ]
            }
          },
          {
            "value": "can_move",
            "label": "能活动，没有剧痛",
            "override": null
          },
          {
            "value": "unresponsive",
            "label": "叫不醒 / 没反应",
            "override": {
              "immediate": [
                {
                  "text": "马上打 120",
                  "tool": {
                    "name": "dial",
                    "number": "120"
                  }
                },
                {
                  "text": "头偏向一侧",
                  "tool": null
                },
                {
                  "text": "清理口鼻里的呕吐物",
                  "tool": null
                },
                {
                  "text": "别搬动、别摇晃叫醒",
                  "tool": null
                }
              ]
            }
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "别着急起身，先原地不动",
            "tool": null
          },
          {
            "text": "自己感觉哪里疼、能不能动",
            "tool": null
          },
          {
            "text": "身上盖点衣物，别受凉",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "起不来就喊人、敲地板求助",
            "tool": null
          },
          {
            "text": "能起来就先翻身趴着再撑起",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要猛一下站起来",
            "tool": null
          },
          {
            "text": "起不来时别硬撑着起身",
            "tool": null
          },
          {
            "text": "哪怕没受伤也要告诉家人",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "中国疾病预防控制中心慢病中心《预防老年人跌倒健康教育核心信息》（释义第 12 条）",
        "url": "https://ncncd.chinacdc.cn/xzzq/202409/t20240923_311832.htm",
        "date": "2026-11-18",
        "quote": "如果老年人跌倒，首先要保持冷静，不要慌张。不要着急起身，先自行判断有无受伤，受伤部位、程度，能否自行站起等。经尝试后，如自己无法起身，不要强行站起；可以通过大声呼喊，打电话，敲打房门、地板、管道等物品发出声音求助，但要注意保持体力。在等待救助期间，可用垫子、衣物、床单等保暖。",
        "supplementary": [
          {
            "name": "淄博市卫生健康委员会《家有一老,就怕跌倒!这两种突发状况,教你如何应对!》（意识不清段）",
            "url": "https://ws.zibo.gov.cn/art/2023/1/18/art_1338_2655443.html",
            "date": "2026-11-21",
            "quote": "如果老人跌倒后意识不清 请立即拨打急救电话，并做适当的紧急处理。",
            "supports": "分诊分支 unresponsive 的 immediate[0]：叫不醒/没反应时立即打 120，不再问「能不能动胳膊腿」"
          },
          {
            "name": "同上（意识不清且有呕吐段）",
            "url": "https://ws.zibo.gov.cn/art/2023/1/18/art_1338_2655443.html",
            "date": "2026-11-21",
            "quote": "若老人口内有呕吐物，可动作轻缓地将老人头部偏向一侧，清理口鼻腔的呕吐物，以防误吸导致窒息",
            "supports": "分诊分支 unresponsive 的 immediate[1..2]：头偏向一侧、清理口鼻呕吐物"
          },
          {
            "name": "同上（意识不清不要搬动段）",
            "url": "https://ws.zibo.gov.cn/art/2023/1/18/art_1338_2655443.html",
            "date": "2026-11-21",
            "quote": "也不要轻易搬动、摇晃或试图唤醒跌倒者，避免加重损伤",
            "supports": "分诊分支 unresponsive 的 immediate[3]：别搬动、别摇晃叫醒"
          }
        ]
      },
      "daily": {
        "summary": "跌倒是我国 65 岁以上老人因伤害死亡的首位原因，摔倒后最忌猛起身。",
        "why": "老人骨质较脆，摔倒后贸然起身可能让骨折错位或加重损伤。所以第一步不是爬起来，而是原地判断有没有受伤、哪里疼、能不能动。起不来就保持体力呼救，用衣物保暖等待帮助。",
        "prevention": [
          "地面保持干燥防滑",
          "卫生间和床边装扶手",
          "起身、转身都放慢速度"
        ],
        "misconception": "摔倒后赶紧扶起来——错，先判断伤情，盲目扶起可能加重损伤。"
      },
      "offline": true,
      "version": "1.1",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文中逐字定位成功；补强 3/3 pass",
          "supplementary": [
            {
              "url": "https://ws.zibo.gov.cn/art/2023/1/18/art_1338_2655443.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            },
            {
              "url": "https://ws.zibo.gov.cn/art/2023/1/18/art_1338_2655443.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            },
            {
              "url": "https://ws.zibo.gov.cn/art/2023/1/18/art_1338_2655443.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-21"
    },
    "fire_home": {
      "schema_version": "1.0",
      "id": "fire_home",
      "name": "家庭火灾",
      "aliases": [
        "着火了",
        "家里着火",
        "起火了",
        "冒烟了",
        "厨房着火",
        "火烧起来"
      ],
      "category": "fire_home",
      "keywords": [
        "着火",
        "起火",
        "火灾",
        "冒烟",
        "浓烟",
        "火势",
        "逃生",
        "火警"
      ],
      "life_threatening": true,
      "triage": {
        "question": "着火的是你自己屋里，还是门外、楼道或楼下？",
        "options": [
          {
            "value": "outside",
            "label": "门外 / 楼道 / 楼下",
            "override": {
              "immediate": [
                {
                  "text": "门发烫就别开门",
                  "tool": null
                },
                {
                  "text": "用湿被褥堵住门缝",
                  "tool": null
                },
                {
                  "text": "泼水给门降温",
                  "tool": null
                },
                {
                  "text": "到窗口挥衣物求救",
                  "tool": null
                },
                {
                  "text": "在窗口打 119 说清地址",
                  "tool": {
                    "name": "dial",
                    "number": "119"
                  }
                }
              ]
            }
          },
          {
            "value": "own_room",
            "label": "自己屋里起火",
            "override": null
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "大声喊人，马上离开屋子",
            "tool": null
          },
          {
            "text": "贴近地面爬行，别站着跑",
            "tool": null
          },
          {
            "text": "用湿毛巾捂住口鼻",
            "tool": null
          },
          {
            "text": "走安全出口，不要坐电梯",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "到室外安全处拨打 119",
            "tool": {
              "name": "dial",
              "number": "119"
            }
          },
          {
            "text": "门已发烫就别开门，堵门缝",
            "tool": null
          },
          {
            "text": "退回室内泼水降温，等救援",
            "tool": null
          },
          {
            "text": "在窗口挥衣物、打手电求救",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "不要盲目跳楼",
            "tool": null
          },
          {
            "text": "不要乘坐电梯逃生",
            "tool": null
          },
          {
            "text": "门把手烫手时不要开门",
            "tool": null
          },
          {
            "text": "不要为拿东西返回火场",
            "tool": null
          }
        ]
      },
      "emergency_number": "119",
      "source": {
        "name": "中华人民共和国应急管理部《社区消防安全知识常识》（火灾逃生自救常识第 4 条）",
        "url": "https://www.mem.gov.cn/kp/shaq/201904/t20190401_366005.shtml",
        "date": "2026-11-18",
        "quote": "穿过浓烟逃生时，要尽量使身体贴近地面，并用湿毛巾捂住口鼻。",
        "supplementary": [
          {
            "name": "同上（火灾逃生自救常识第 7 条）",
            "url": "https://www.mem.gov.cn/kp/shaq/201904/t20190401_366005.shtml",
            "date": "2026-11-21",
            "quote": "室外着火，门已发烫时，千万不要开门，以防大火窜入室内。要用浸湿的被褥、衣物等堵塞门窗，并泼水降温。",
            "supports": "分诊分支 outside 的 immediate[0..3]：门发烫不开门、堵门缝、泼水降温"
          },
          {
            "name": "同上（火灾逃生自救常识第 8 条）",
            "url": "https://www.mem.gov.cn/kp/shaq/201904/t20190401_366005.shtml",
            "date": "2026-11-21",
            "quote": "若所有逃生路线被大火封锁，要立即退回室内，用打手电筒、挥舞衣物、呼叫等方式向窗外发送求救信号，等待救援。",
            "supports": "分诊分支 outside 的 immediate[3..4]：窗口挥衣物求救；同时支撑 next[2] 退回室内等救援"
          }
        ]
      },
      "daily": {
        "summary": "火灾中最致命的是浓烟，不是火。贴近地面、捂住口鼻、走安全出口，不要坐电梯。",
        "why": "浓烟里有大量有毒气体，且热烟气聚集在上方，贴近地面空气相对干净，能见度也更好。电梯在火灾时会断电或成为烟囱通道，所以必须走安全出口。门已发烫说明门外火势很大，开门会让大火窜入室内。",
        "prevention": [
          "家里装独立式烟感报警器",
          "楼道和阳台不要堆放杂物",
          "提前认好两个方向的安全出口",
          "备一条湿毛巾放在易取处"
        ],
        "misconception": "躲进卫生间最安全——不一定，卫生间常无窗无法求救，且门多为塑料，遇高温会熔化。"
      },
      "offline": true,
      "version": "1.1",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文中逐字定位成功；补强 2/2 pass",
          "supplementary": [
            {
              "url": "https://www.mem.gov.cn/kp/shaq/201904/t20190401_366005.shtml",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            },
            {
              "url": "https://www.mem.gov.cn/kp/shaq/201904/t20190401_366005.shtml",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-21"
    },
    "food_poisoning": {
      "schema_version": "1.0",
      "id": "food_poisoning",
      "name": "食物中毒",
      "aliases": [
        "吃了坏东西",
        "食物中毒了",
        "上吐下泻",
        "饭后都拉肚子",
        "吃坏肚子",
        "剩饭吃完吐了"
      ],
      "category": "food_poisoning",
      "keywords": [
        "食物中毒",
        "吃坏",
        "上吐下泻",
        "腹泻",
        "呕吐",
        "剩饭",
        "变质",
        "一家人"
      ],
      "life_threatening": true,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "马上停吃可疑食物",
            "tool": null
          },
          {
            "text": "意识清醒才能催吐",
            "tool": null
          },
          {
            "text": "留好食物和呕吐物",
            "tool": null
          },
          {
            "text": "别自己吃止泻药",
            "tool": null
          },
          {
            "text": "脱水严重就打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          }
        ],
        "next": [
          {
            "text": "少量多次喝温淡盐水",
            "tool": null
          },
          {
            "text": "给食物拍张照再装袋",
            "tool": null
          },
          {
            "text": "告诉医生吃了什么、几点吃",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "别自己吃止泻药",
            "tool": null
          },
          {
            "text": "别硬扛着观察",
            "tool": null
          },
          {
            "text": "昏迷的人别催吐",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "北京市卫生健康委员会《天越热越要当心!警惕盛夏食物中毒》",
        "url": "https://wjw.beijing.gov.cn/bmfw_20143/jkzs/jksh/202507/t20250722_4154667.html",
        "date": "2026-11-21",
        "quote": "食物中毒了?四步急救法记牢 1. 催吐排险:意识清醒、没剧烈呕吐的话,赶紧喝300-500ml温水,用手指轻抠喉咙催吐,把有毒食物吐出来。2. 补水“续命”:多次喝温淡盐水,别让身体脱水(脱水会心慌、尿少,超危险)。 3. 留好“证据”:给可疑食物拍张照(连盘子一起拍),装干净袋子里带去医院,帮医生快速破案。 4. 火速就医:别自己吃止泻药!"
      },
      "daily": {
        "summary": "食物中毒先停吃、留样本，脱水严重或高烧要立刻就医。",
        "why": "剩饭剩菜在高温天两小时就可能变质，细菌在肠道里繁殖、毒素进到血里，越拖越重。吐和拉本身是身体在排毒，所以不能一味止泻——把毒素关在体内反而加重中毒。真正要补的是水和电解质。",
        "prevention": [
          "剩饭菜冷藏别超过 24 小时",
          "凉菜卤味别在常温久放",
          "豆角必须焯水炒到全软"
        ],
        "misconception": "拉肚子赶紧吃止泻药——错，止泻药会把毒素关在体内，别自己吃。"
      },
      "offline": true,
      "version": "0.1",
      "status": "published",
      "review": {
        "author": "待指派",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "原文中逐字定位成功"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-21",
      "updated_at": "2026-11-21"
    },
    "gas_leak": {
      "schema_version": "1.0",
      "id": "gas_leak",
      "name": "燃气泄漏",
      "aliases": [
        "煤气泄漏",
        "煤气味",
        "燃气漏了",
        "闻到煤气味",
        "天然气泄漏",
        "液化气泄漏"
      ],
      "category": "gas_leak",
      "keywords": [
        "燃气",
        "煤气",
        "天然气",
        "液化气",
        "泄漏",
        "漏气",
        "臭味",
        "煤气味"
      ],
      "life_threatening": true,
      "triage": {
        "question": "关掉总阀门以后，还能闻到很浓的味道吗？",
        "options": [
          {
            "value": "still_strong",
            "label": "还有很浓的味",
            "override": {
              "immediate": [
                {
                  "text": "立刻离开屋子，别回去",
                  "tool": null
                },
                {
                  "text": "到室外拨打 119",
                  "tool": {
                    "name": "dial",
                    "number": "119"
                  }
                },
                {
                  "text": "敲邻居门，让大家一起撤",
                  "tool": null
                }
              ]
            }
          },
          {
            "value": "weaker",
            "label": "味小了或没有了",
            "override": null
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "打开所有门窗通风",
            "tool": null
          },
          {
            "text": "关掉燃气灶和总阀门",
            "tool": null
          },
          {
            "text": "离开屋子，到室外去",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "在室外联系燃气公司报修",
            "tool": null
          },
          {
            "text": "情况严重就在室外打 119",
            "tool": {
              "name": "dial",
              "number": "119"
            }
          }
        ],
        "never": [
          {
            "text": "不要开灯或关灯",
            "tool": null
          },
          {
            "text": "不要使用明火、不要打火机试漏",
            "tool": null
          },
          {
            "text": "关阀后仍有浓味就别回屋",
            "tool": null
          }
        ]
      },
      "emergency_number": "119",
      "source": {
        "name": "中华人民共和国应急管理部《中秋将至，六类安全提示要牢记！》（居家安全第 3 条）",
        "url": "https://www.mem.gov.cn/kp/shaq/202209/t20220909_422147.shtml",
        "date": "2026-11-18",
        "quote": "燃气一旦发生泄漏，一定要确保窗户打开，关闭燃气灶、燃气阀门，远离泄漏地点，联系燃气公司工作人员前来检查，如果关闭总阀还无法阻止漏气，千万不要在室内逗留，不要开灯和关灯，更不能使用明火。"
      },
      "daily": {
        "summary": "燃气泄漏遇明火或电火花可能爆炸，先通风、关阀、离开室内，再报警。",
        "why": "燃气泄漏后会在室内聚集，达到一定浓度时，开灯、按门铃、打电话产生的微小电火花都可能引爆。所以要先把气源关掉、把门窗打开稀释浓度，人先离开，到室外再联系报修和报警。",
        "prevention": [
          "每年检查一次燃气软管",
          "用完燃气关灶具和阀门",
          "建议安装燃气报警器"
        ],
        "misconception": "闻到味道先开抽油烟机把气抽走——错，抽油烟机开关会产生电火花。"
      },
      "offline": true,
      "version": "1.0",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-18",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-18",
          "detail": "原文中逐字定位成功（本次未校验证书，仅确认字面一致）"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-18"
    },
    "heatstroke": {
      "schema_version": "1.0",
      "id": "heatstroke",
      "name": "中暑",
      "aliases": [
        "中暑了",
        "热射病",
        "热得头晕恶心",
        "晒晕了",
        "高温中暑",
        "老人在太阳下晕倒"
      ],
      "category": "heatstroke",
      "keywords": [
        "中暑",
        "热射病",
        "热射",
        "高温",
        "暴晒",
        "降温",
        "出汗多",
        "热天头晕"
      ],
      "life_threatening": true,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "马上移到阴凉通风处",
            "tool": null
          },
          {
            "text": "平躺，松开衣扣腰带",
            "tool": null
          },
          {
            "text": "凉水擦身，扇风降温",
            "tool": null
          },
          {
            "text": "边降温边打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          }
        ],
        "next": [
          {
            "text": "冰袋敷脖子腋窝大腿根",
            "tool": null
          },
          {
            "text": "清醒没吐才小口补液",
            "tool": null
          },
          {
            "text": "转运路上继续降温",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "别大面积擦酒精降温",
            "tool": null
          },
          {
            "text": "别直接冰敷前胸或肚子",
            "tool": null
          },
          {
            "text": "别吃布洛芬等退烧药",
            "tool": null
          },
          {
            "text": "意识模糊别经口喂水",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "中国疾病预防控制中心《科学应对高温中暑，守护劳动者职业健康》",
        "url": "https://www.chinacdc.cn/jkkp/zyjk/zyjk/zybfzzs/202607/t20260729_1838473.html",
        "date": "2026-11-21",
        "quote": "移： 迅速移至阴凉通风处或空调房，平卧、松开衣扣、腰带。 降： 迅速启动物理降温。使用无冰刺感凉水（手背触碰 微 感 冰凉 ）擦拭患者全身，搭配风扇加速体表散热；冰袋 等 冷敷颈部、腋窝、腹股沟。"
      },
      "daily": {
        "summary": "中暑核心是快快降温。重症会死人，降温的同时必须打 120。",
        "why": "中暑是身体产热和散热失衡，热量积在体内散不出去，重症会发展成热射病，几小时内就能危及生命。所以现场最要紧的是把人和热源分开、把体表的温度降下来。发病后 30 分钟内是降温黄金期，这段时间别浪费在等待观望上。",
        "prevention": [
          "热天每 15-30 分钟喝点水",
          "别在正午最热时久待户外",
          "老人房间要通风、开空调"
        ],
        "misconception": "中暑发高烧就吃退烧药——错，中暑高热严禁自行服用布洛芬等退烧药。"
      },
      "offline": true,
      "version": "0.1",
      "status": "published",
      "review": {
        "author": "待指派",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "原文中逐字定位成功"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-21",
      "updated_at": "2026-11-21"
    },
    "scald_burn": {
      "schema_version": "1.0",
      "id": "scald_burn",
      "name": "烧烫伤",
      "aliases": [
        "烫伤",
        "烧伤",
        "烧烫伤",
        "开水烫",
        "热水烫",
        "烫起泡",
        "被油烫"
      ],
      "category": "scald_burn",
      "keywords": [
        "烫伤",
        "烧伤",
        "烫到",
        "烫了",
        "烫起泡",
        "油烫",
        "开水",
        "热水"
      ],
      "life_threatening": false,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "马上用冷水冲或浸泡伤口",
            "tool": null
          },
          {
            "text": "尽快脱去或剪开浸湿的衣服",
            "tool": null
          },
          {
            "text": "衣服着火就地卧倒滚动压灭",
            "tool": null
          },
          {
            "text": "检查全身有没有别的伤",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "用干净衣物或被单包住伤面",
            "tool": null
          },
          {
            "text": "清醒时少量多次喝淡盐水",
            "tool": null
          },
          {
            "text": "尽快送到就近医院",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "尽量不要弄破水泡",
            "tool": null
          },
          {
            "text": "创面不要自己抹药或偏方",
            "tool": null
          },
          {
            "text": "热金属粘住时不要泼水",
            "tool": null
          },
          {
            "text": "不要用脏布或棉花敷伤面",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "中国红十字会《怎样进行烧伤急救?》（现场急救要点「一灭二查三防四包五送」）",
        "url": "https://www.redcross.org.cn/autoweb/hlwmh/third/hlwmh_hlwmhsmjk_251130.html",
        "date": "2026-11-18",
        "quote": "热液烧伤，应尽快脱去（或剪去）被热液浸渍的衣服。烧伤部位要立即用冷水喷洒或浸泡于冷水中，如热塑料液粘附体表，用冷水或冷的湿毛巾使局部快速降温。",
        "supplementary": [
          {
            "name": "全国12320管理中心《使用浴缸时如何防止儿童烫伤？》",
            "url": "https://www.js12320.org.cn/wx1/main.encyclopedia_detail.id.3231.html",
            "date": "2007-01-19",
            "quote": "把电热水器的温度设定为“温水”，或者是50摄氏度左右，如果是燃气热水器则要特别注意水温。",
            "supports": "daily.prevention：热水器温度设在50摄氏度左右"
          },
          {
            "name": "全国12320管理中心《使用浴缸时如何防止儿童烫伤？》（第2条）",
            "url": "https://www.js12320.org.cn/wx1/main.encyclopedia_detail.id.3231.html",
            "date": "2007-01-19",
            "quote": "把孩子放进浴缸之前，用手试试水温，最好用温度计测试一下，水温在37-38摄氏度最为适宜。",
            "supports": "daily.prevention：给孩子洗澡先放冷水再加热水，水温37-38摄氏度最适宜"
          }
        ]
      },
      "daily": {
        "summary": "烧烫伤先用冷水冲或浸泡，再用干净衣物包住伤面，尽快送医。别挑破水泡。",
        "why": "热量会继续往皮肤深层传导，冷水冲或浸泡能快速降温，减轻疼痛和损伤。创面自己抹药会污染伤口、增加感染，也让医生难以判断伤情。水泡皮是天然的保护层，挑破容易感染。",
        "prevention": [
          "热水壶、汤锅把手朝里放",
          "端热汤前先提醒一声",
          "给孩子洗澡先放冷水再加热水",
          "灶台前不要放凳子让孩子爬上",
          "热水器温度设在50摄氏度左右；洗澡水温37-38摄氏度最适宜"
        ],
        "misconception": "烫伤后涂牙膏能止痛——错，牙膏会污染创面，还会增加医生清创难度。"
      },
      "offline": true,
      "version": "1.2",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-18",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文逐字定位成功；补强 2/2 pass（2026-11-21 人工抓取核对）",
          "supplementary": [
            {
              "url": "https://www.js12320.org.cn/wx1/main.encyclopedia_detail.id.3231.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功（热水器温度条）"
            },
            {
              "url": "https://www.js12320.org.cn/wx1/main.encyclopedia_detail.id.3231.html",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功（洗澡水温条）"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-21"
    },
    "severe_bleeding": {
      "schema_version": "1.0",
      "id": "severe_bleeding",
      "name": "大出血",
      "aliases": [
        "大出血",
        "流血不止",
        "血止不住",
        "流了好多血",
        "割伤了",
        "划伤了"
      ],
      "category": "severe_bleeding",
      "keywords": [
        "出血",
        "流血",
        "伤口",
        "割伤",
        "划伤",
        "止不住",
        "血流不止",
        "血一直流",
        "血不停",
        "血哗哗流",
        "血流得"
      ],
      "life_threatening": true,
      "triage": {
        "question": "用手压住伤口，血能压住吗？",
        "options": [
          {
            "value": "cannot_stop",
            "label": "压不住 / 找不到哪出血",
            "override": {
              "immediate": [
                {
                  "text": "压住伤口，扎上止血带",
                  "tool": null
                },
                {
                  "text": "马上打 120",
                  "tool": {
                    "name": "dial",
                    "number": "120"
                  }
                }
              ]
            }
          },
          {
            "value": "can_stop",
            "label": "能压住",
            "override": null
          }
        ]
      },
      "steps": {
        "immediate": [
          {
            "text": "马上用手压住伤口",
            "tool": null
          },
          {
            "text": "用干净布加压包扎",
            "tool": null
          },
          {
            "text": "马上打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          }
        ],
        "next": [
          {
            "text": "脸和脖子出血，塞住再压",
            "tool": null
          },
          {
            "text": "压的时候手别松开",
            "tool": null
          },
          {
            "text": "止血带宽 5 厘米以上",
            "tool": null
          },
          {
            "text": "绑在伤口上方 5~8 厘米",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "流鼻血别仰头，要低头",
            "tool": null
          },
          {
            "text": "血止不住别只硬压",
            "tool": null
          },
          {
            "text": "止血带别绑超过 2 小时",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "《院前创伤急救止血专家共识（2025年版）》中华急诊医学杂志 2025,34(4):469-477",
        "url": "http://www.cem.org.cn/public/html/202504/20250403/index.htm",
        "date": "2026-11-18",
        "quote": "对于体表活动性出血，如面部、躯干、四肢，应立即采取局部压迫或加压包扎止血。面部深层创口还可用止血敷料填塞并冷敷；牙龈或鼻腔出血可填塞纱条或棉球压迫止血，并保持头部前倾以防血液倒流入气道；四肢压迫止血无效时或无法快速定位出血点时，应及时使用止血带。【证据质量：1C。推荐强度：强】",
        "supplementary": [
          {
            "name": "同上（相关证据段，止血带规格与时限）",
            "url": "http://www.cem.org.cn/public/html/202504/20250403/index.htm",
            "date": "2026-11-21",
            "quote": "止血带宽度至少5 cm，长度需足够绕肢体两圈以上，绑扎于出血近心端5~8 cm处，避开关节并确保压力有效止血 [ 47 ] 。为减少并发症风险，止血带的使用时间应严格控制在2 h内 [ 48 ]",
            "supports": "新增 next[2]（止血带宽度≥5cm、绑在近心端5~8cm）与 never[2]（不超过2小时）；2h 是本场景最硬的安全红线"
          }
        ]
      },
      "daily": {
        "summary": "大出血最要紧的是立刻压住伤口，别等。",
        "why": "血流失太快会危及生命。直接用手掌压住伤口，或用干净布加压包扎，是最快也最有效的止血办法。脸、脖子这些地方压不住，要先用干净布塞住伤口再压。四肢压不住，或者找不到哪里出血，就要用止血带，同时打 120。",
        "prevention": [
          "家里备干净纱布和绷带",
          "刀具用完马上收好",
          "玻璃杯碗别放在桌边"
        ],
        "misconception": "流鼻血要仰头——错，要低头前倾，防止血流进气管。"
      },
      "offline": true,
      "version": "0.3",
      "status": "published",
      "review": {
        "author": "xieyouqing",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "主源：原文中逐字定位成功；补强 1/1 pass",
          "supplementary": [
            {
              "url": "http://www.cem.org.cn/public/html/202504/20250403/index.htm",
              "result": "pass",
              "checked_at": "2026-11-21",
              "detail": "原文中逐字定位成功"
            }
          ]
        },
        "reject_reason": null
      },
      "created_at": "2026-11-20",
      "updated_at": "2026-11-21"
    },
    "stroke": {
      "schema_version": "1.0",
      "id": "stroke",
      "name": "卒中（中风）",
      "aliases": [
        "中风了",
        "嘴歪了",
        "半边身子动不了",
        "说话不清",
        "突然晕倒",
        "脑梗",
        "脑出血"
      ],
      "category": "stroke",
      "keywords": [
        "中风",
        "卒中",
        "脑梗",
        "脑出血",
        "嘴歪",
        "口角歪斜",
        "说话不清",
        "半边无力"
      ],
      "life_threatening": true,
      "triage": null,
      "steps": {
        "immediate": [
          {
            "text": "看脸歪不歪",
            "tool": null
          },
          {
            "text": "两支胳膊平举看有没力",
            "tool": null
          },
          {
            "text": "听说话清不清",
            "tool": null
          },
          {
            "text": "立刻打 120",
            "tool": {
              "name": "dial",
              "number": "120"
            }
          },
          {
            "text": "别自己开车去医院",
            "tool": null
          }
        ],
        "next": [
          {
            "text": "让他平躺，头稍抬高",
            "tool": null
          },
          {
            "text": "昏迷或呕吐就侧卧",
            "tool": null
          },
          {
            "text": "不要喂水喂食",
            "tool": null
          },
          {
            "text": "记下发病时间",
            "tool": null
          }
        ],
        "never": [
          {
            "text": "别自行服药",
            "tool": null
          },
          {
            "text": "别等它自己好",
            "tool": null
          },
          {
            "text": "别自己开车或让家人送",
            "tool": null
          }
        ]
      },
      "emergency_number": "120",
      "source": {
        "name": "国家医疗保障局《4.5小时，190万个脑细胞：大脑给的“最后通牒”你接住了吗？》",
        "url": "https://www.nhsa.gov.cn/art/2026/7/26/art_14_21566.html",
        "date": "2026-11-21",
        "quote": "“1”看一张脸：是否出现口角歪斜、面部不对称。 “2”查两只手臂：双臂平行举起，是否一侧无力下垂。 “0”聆听语言：说话是否含糊不清、表达困难。"
      },
      "daily": {
        "summary": "脸歪、胳膊抬不起、说话不清，任何一项突然出现，就是卒中，立刻打 120。",
        "why": "卒中分缺血性和出血性两种，用药完全相反，未经确诊随便吃药可能加重病情。所以现场能做的只有三件事：认出来、立刻打 120、让病人安静平躺。卒中每分钟大约有 190 万个脑细胞死亡，越早到能治卒中的医院，救回来的脑组织越多。",
        "prevention": [
          "血压血糖血脂都要管住",
          "戒烟、少喝酒",
          "房颤病人按医嘱抗凝"
        ],
        "misconception": "等一等看看会不会自己好——错，时间就是大脑，等症状消失会错过救治窗口。"
      },
      "offline": true,
      "version": "0.1",
      "status": "published",
      "review": {
        "author": "待指派",
        "approved_by": [
          "xieyouqing"
        ],
        "approved_at": "2026-11-21",
        "checklist": {
          "step_order_ok": true,
          "never_non_empty": true,
          "source_quote_verbatim": true
        },
        "agent_check": {
          "source_quote": "pass",
          "checked_at": "2026-11-21",
          "detail": "原文中逐字定位成功"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-21",
      "updated_at": "2026-11-21"
    }
  }
};

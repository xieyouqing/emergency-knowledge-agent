/* 自动生成，请勿手改。源：knowledge/*.json 中 status=published 的条目。重新生成：python tools/build_knowledge_js.py */
window.KNOWLEDGE = {
  "generated_at": "2026-11-18",
  "data_date": "2026-11-18",
  "slot_count": 9,
  "entry_count": 9,
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
      "id": "airway_obstruction",
      "name": "气道梗阻",
      "icon": "airway_obstruction",
      "order": 70
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
      "triage": null,
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
        "quote": "一氧化碳比空气比重稍微轻一点，所以救助人员进入一氧化碳中毒现场，匍匐行动比站立要更安全。进入一氧化碳中毒的现场，要严禁明火，室内一旦一氧化碳浓度比较高，开闭电灯造成的火花往往引起爆炸。"
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
      "triage": null,
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
        "quote": "应迅速切断电源，使触电者尽快脱离电源。确认自己无触电危险再进行救护。"
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
        "quote": "如果老年人跌倒，首先要保持冷静，不要慌张。不要着急起身，先自行判断有无受伤，受伤部位、程度，能否自行站起等。经尝试后，如自己无法起身，不要强行站起；可以通过大声呼喊，打电话，敲打房门、地板、管道等物品发出声音求助，但要注意保持体力。在等待救助期间，可用垫子、衣物、床单等保暖。"
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
      "triage": null,
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
        "quote": "穿过浓烟逃生时，要尽量使身体贴近地面，并用湿毛巾捂住口鼻。"
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
        "quote": "热液烧伤，应尽快脱去（或剪去）被热液浸渍的衣服。烧伤部位要立即用冷水喷洒或浸泡于冷水中，如热塑料液粘附体表，用冷水或冷的湿毛巾使局部快速降温。"
      },
      "daily": {
        "summary": "烧烫伤先用冷水冲或浸泡，再用干净衣物包住伤面，尽快送医。别挑破水泡。",
        "why": "热量会继续往皮肤深层传导，冷水冲或浸泡能快速降温，减轻疼痛和损伤。创面自己抹药会污染伤口、增加感染，也让医生难以判断伤情。水泡皮是天然的保护层，挑破容易感染。",
        "prevention": [
          "热水壶、汤锅把手朝里放",
          "端热汤前先提醒一声",
          "给孩子洗澡先放冷水再加热水",
          "灶台前不要放凳子让孩子爬上"
        ],
        "misconception": "烫伤后涂牙膏能止痛——错，牙膏会污染创面，还会增加医生清创难度。"
      },
      "offline": true,
      "version": "1.1",
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
    }
  }
};

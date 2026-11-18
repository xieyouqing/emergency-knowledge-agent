/* 自动生成，请勿手改。源：knowledge/*.json 中 status=published 的条目。重新生成：python tools/build_knowledge_js.py */
window.KNOWLEDGE = {
  "generated_at": "2026-11-18",
  "data_date": "2026-11-18",
  "slot_count": 3,
  "entry_count": 3,
  "slots": [
    {
      "id": "gas_leak",
      "name": "燃气泄漏",
      "icon": "gas_leak",
      "order": 10
    },
    {
      "id": "fall_elderly",
      "name": "老人跌倒",
      "icon": "fall_elderly",
      "order": 40
    },
    {
      "id": "elevator_trapped",
      "name": "电梯困人",
      "icon": "elevator_trapped",
      "order": 100
    }
  ],
  "entries": {
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
          "detail": "原文中逐字定位成功"
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
          "detail": "原文中逐字定位成功"
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
          "detail": "原文中逐字定位成功"
        },
        "reject_reason": null
      },
      "created_at": "2026-11-18",
      "updated_at": "2026-11-18"
    }
  }
};

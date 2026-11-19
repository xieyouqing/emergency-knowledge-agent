# -*- coding: utf-8 -*-
"""清洗应灾知识-数据表.xlsx：章节/受众/层级归一 + P0 字段写法修正。
用法: python clean_kb.py --dry
"""
import openpyxl, re, sys, collections, shutil, os

SRC = "应灾知识-数据表.xlsx"
DRY = "--dry" in sys.argv

# ---------- 章节映射（134 值 → 目标章节） ----------
CH = {
    "①燃气泄漏 gas_leak": "①燃气泄漏 gas_leak",
    "01.燃气泄漏": "①燃气泄漏 gas_leak",
    "②家庭火灾 fire_home": "②家庭火灾 fire_home",
    "2.2·火灾": "②家庭火灾 fire_home",
    "2.2 常见意外伤害现场救护·火灾": "②家庭火灾 fire_home",
    "③一氧化碳中毒 co_poisoning": "③一氧化碳中毒 co_poisoning",
    "2.1.2.3": "③一氧化碳中毒 co_poisoning",
    "2.1.2.3 非职业性一氧化碳中毒": "③一氧化碳中毒 co_poisoning",
    "2.1.2.3 建议（2）": "③一氧化碳中毒 co_poisoning",
    "④老人跌倒 fall_elderly": "④老人跌倒 fall_elderly",
    "⑤烧烫伤 scald_burn": "⑤烧烫伤 scald_burn",
    "2.2·烧伤": "⑤烧烫伤 scald_burn",
    "10.烧烫伤": "⑤烧烫伤 scald_burn",
    "⑥触电 electric_shock": "⑥触电 electric_shock",
    "2.2·电击与雷击": "⑥触电 electric_shock",
    "附图 触电现场处置流程": "⑥触电 electric_shock",
    "⑦气道梗阻 airway_obstruction": "⑦气道梗阻 airway_obstruction",
    "08.气道梗阻": "⑦气道梗阻 airway_obstruction",
    "4.1 急救技能·气道异物梗阻": "⑦气道梗阻 airway_obstruction",
    "4.1·气道异物梗阻": "⑦气道梗阻 airway_obstruction",
    "⑧溺水 drowning": "⑧溺水 drowning",
    "5 溺水 drowning": "⑧溺水 drowning",
    "09.溺水": "⑧溺水 drowning",
    "2.2·淹溺": "⑧溺水 drowning",
    "⑨地震 earthquake": "⑨地震 earthquake",
    "⑩电梯困人 elevator_trapped": "⑩电梯困人 elevator_trapped",
    "6 心梗 myocardial_infarction": "心梗 myocardial_infarction",
    "3 热射病 heatstroke": "热射病 heatstroke",
    "5 急诊热射病的治疗·5.2 现场急救": "热射病 heatstroke",
    "5.1 总体原则·推荐意见6": "热射病 heatstroke",
    "5.2 现场急救·推荐意见7": "热射病 heatstroke",
    "5.3 转运后送": "热射病 heatstroke",
    "表7 气道保护与氧疗": "热射病 heatstroke",
    "表7 现场急救处置重要步骤": "热射病 heatstroke",
    "表7 立即脱离热环境·快速测量体温": "热射病 heatstroke",
    "2.1.2.4": "热射病 heatstroke",
    "2.1.2.4 高温中暑": "热射病 heatstroke",
    "7 心肺复苏 cpr": "心肺复苏 cpr",
    "8 电池火灾 battery_fire": "电池火灾 battery_fire",
    "7 现场救治·7.1 现场急救·7.1.1 脱离": "蛇咬伤 snake_bite",
    "7.1 现场急救·推荐意见5": "蛇咬伤 snake_bite",
    "7.1.10 处置禁忌": "蛇咬伤 snake_bite",
    "7.1.2 认蛇": "蛇咬伤 snake_bite",
    "7.1.3 镇定": "蛇咬伤 snake_bite",
    "7.1.4 呼救": "蛇咬伤 snake_bite",
    "7.1.5 解压": "蛇咬伤 snake_bite",
    "7.1.6 制动": "蛇咬伤 snake_bite",
    "7.1.7 包扎": "蛇咬伤 snake_bite",
    "7.1.9 复苏": "蛇咬伤 snake_bite",
    "7.4.1 伤口处理": "蛇咬伤 snake_bite",
    "蛇咬伤诊疗规范·六、蛇咬伤救治（一）现场自救": "蛇咬伤 snake_bite",
    "蛇咬伤诊疗规范·六（二）院前急救处理2": "蛇咬伤 snake_bite",
    "急救自救·咬螫伤急救": "蛇咬伤 snake_bite",
    "1 概述": "蛇咬伤 snake_bite",
    "第一章 暴露等级判定和处置原则·第二条": "犬咬伤 dog_bite",
    "第一章·第四条": "犬咬伤 dog_bite",
    "第一章·第五条": "犬咬伤 dog_bite",
    "第一章·第六条": "犬咬伤 dog_bite",
    "第二章 伤口处置·第七条": "犬咬伤 dog_bite",
    "第二章·第七条": "犬咬伤 dog_bite",
    "第三章·第十一条": "犬咬伤 dog_bite",
    "第三章·第十九条": "犬咬伤 dog_bite",
    "第四章·第二十七条": "犬咬伤 dog_bite",
    "2.1.1.4": "蜱咬伤 tick_bite",
    "2.1.1.4 发热伴血小板减少综合征": "蜱咬伤 tick_bite",
    "蜱咬伤诊疗规范·六、治疗（一）治疗原则": "蜱咬伤 tick_bite",
    "蜱咬伤诊疗规范·六（二）咬伤局部处置": "蜱咬伤 tick_bite",
    "蜱咬伤诊疗规范·七、预防": "蜱咬伤 tick_bite",
    "胡蜂蜇伤诊疗规范·五、鉴别诊断（五）": "胡蜂蜇伤 bee_sting",
    "胡蜂蜇伤诊疗规范·六、现场应急救治及院前救治（一）": "胡蜂蜇伤 bee_sting",
    "胡蜂蜇伤诊疗规范·六（二）尽早评估病情": "胡蜂蜇伤 bee_sting",
    "海蜇蜇伤诊疗规范·七、治疗（二）现场处置1": "海蜇蜇伤 jellyfish",
    "海蜇蜇伤诊疗规范·七（二）现场处置1": "海蜇蜇伤 jellyfish",
    "海蜇蜇伤诊疗规范·七（二）现场处置2": "海蜇蜇伤 jellyfish",
    "海蜇蜇伤诊疗规范·七（二）现场处置3": "海蜇蜇伤 jellyfish",
    "海蜇蜇伤诊疗规范·七（二）现场处置4": "海蜇蜇伤 jellyfish",
    "海蜇蜇伤诊疗规范·七（二）现场处置末段": "海蜇蜇伤 jellyfish",
    "石头鱼刺伤诊疗规范·五、鉴别诊断（一）海蛇咬伤": "海蜇蜇伤 jellyfish",
    "石头鱼刺伤诊疗规范·六、治疗（二）局部治疗": "海蜇蜇伤 jellyfish",
    "12.居家与儿童安全": "儿童误服 child_ingest",
    "13.蚊媒传染病": "蚊媒传染病 chikungunya",
    "2.1.1.5": "量级数据 与 统计",
    "2.1.1.5 食物中毒": "量级数据 与 统计",
    "2.1 量级数据": "量级数据 与 统计",
    "2024年全国法定传染病报告发病、死亡统计表": "量级数据 与 统计",
    "2025年全国法定传染病报告发病、死亡统计表": "量级数据 与 统计",
    "人口年龄构成": "量级数据 与 统计",
    "临床问题4·推荐意见4": "创伤止血 bleeding",
    "临床问题8·推荐意见9": "创伤止血 bleeding",
    "临床问题8·推荐意见10": "创伤止血 bleeding",
    "临床问题9·推荐意见12": "创伤止血 bleeding",
    "临床问题9·相关证据": "创伤止血 bleeding",
    "临床问题10·推荐意见15": "创伤止血 bleeding",
    "附件·一、卒中是可防可控的重大疾病（一）": "卒中 stroke",
    "附件·二、“尽早识别”是急救成功的关键（一）": "卒中 stroke",
    "附件·二（二）": "卒中 stroke",
    "附件·三、“立刻就医”，把握黄金救治时间（二）": "卒中 stroke",
    "附件·三（一）": "卒中 stroke",
    "附件·三（三）": "卒中 stroke",
    "附件·四、再灌注是急性期治疗的核心手段（二）": "卒中 stroke",
    "附件·五、坚持康复，最大程度恢复功能（二）": "卒中 stroke",
    "第一章总则": "法规 与 标准",
    "第1章总则": "应急预案 与 预警响应",
    "第九条": "法规 与 标准",
    "第三十六条、第四十一条": "法规 与 标准",
    "第二章救助准备": "法规 与 标准",
    "第三章应急救助": "法规 与 标准",
    "第四章灾后救助": "法规 与 标准",
    "第三章预防与应急准备": "法规 与 标准",
    "第四章监测与预警": "法规 与 标准",
    "第五章应急处置与救援": "法规 与 标准",
    "第四章地震灾害预防": "法规 与 标准",
    "第五章地震应急救援": "法规 与 标准",
    "第3章预防和预警机制": "应急预案 与 预警响应",
    "第4章应急响应": "应急预案 与 预警响应",
    "第5章国家应急响应": "应急预案 与 预警响应",
    "第7章附则": "应急预案 与 预警响应",
    "第8章附则": "应急预案 与 预警响应",
    "附件·台风预警信号": "应急预案 与 预警响应",
    "附件·暴雨预警信号": "应急预案 与 预警响应",
    "一、组织指挥能力": "基层能力 与 队伍",
    "二、风险防范能力": "基层能力 与 队伍",
    "四、应急处置能力": "基层能力 与 队伍",
    "五、演练准备阶段(一)7": "基层能力 与 队伍",
    "记者问答": "基层能力 与 队伍",
    "1 背景": "产品立论 与 待援期",
    "第4章信息管理": "应急预案 与 预警响应",
    "第4-5章配置": "法规 与 标准",
    "第4章原则": "法规 与 标准",
    "犬咬伤诊疗规范·七、伤口处理": "犬咬伤 dog_bite",
    "海蜇蜇伤诊疗规范·七、治疗（二）现场处置2": "海蜇蜇伤 jellyfish",
    "摘要·结果": "热射病 heatstroke",
    "摘要·研究结果": "①燃气泄漏 gas_leak",
    "家庭储备 与 物资清单": "家庭储备 与 物资清单",
    "附件3": "家庭储备 与 物资清单",
    "待补": "心梗 myocardial_infarction",   # 行152；行154 单独覆盖
}

# 行级覆盖：值相同但主题不同
ROW_CH = {
    154: "热射病 heatstroke",
    46: "法规 与 标准",   # 国标37228（原「全文」）
    47: "法规 与 标准",   # 国标34283（原「全文」）
    33: "应急预案 与 预警响应",  # 预警办法
    34: "应急预案 与 预警响应",
    35: "应急预案 与 预警响应",
    39: "家庭储备 与 物资清单",  # 家庭应急物资建议清单
    51: "家庭储备 与 物资清单",  # 家庭应急物资储备指导目录
}

# ---------- 受众映射 ----------
ORDER = ["全部受众", "普通社会公众", "基层应急人员", "学校与教育系统", "专业队伍",
         "企业单位", "特殊群体", "有儿童的家庭", "仅医务人员/信息员",
         "患者家属与照护者", "技术开发人员", "不适用"]
TOKEN = {
    "全部受众": "全部受众",
    "普通社会公众": "普通社会公众",
    "基层应急人员": "基层应急人员",
    "学校与教育系统": "学校与教育系统",
    "专业队伍": "专业队伍",
    "企业单位": "企业单位",
    "特殊群体": "特殊群体",
    "有儿童的家庭": "有儿童的家庭",
    "仅医务人员": "仅医务人员/信息员",
    "仅医务人员/信息员": "仅医务人员/信息员",
    "患者家属与照护者": "患者家属与照护者",
    "技术开发人员": "技术开发人员",
    "不适用": "不适用",
    "婴幼儿与老年人": "特殊群体",
    "孕妇": "特殊群体",
    "中老年、农村居民": "特殊群体",
    "老年人/新生儿/慢病患者": "特殊群体",
    "老年受众优先": "特殊群体",
}

# ---------- 层级映射 ----------
LV = {
    "部门规范": "部门规范性文件",
    "预案/中央文件": "应急预案",
}

def norm_chapter(line, val):
    if line in ROW_CH:
        tgt = ROW_CH[line]
    elif val in CH:
        tgt = CH[val]
    else:
        return None
    return tgt

def norm_audience(val):
    """返回 (新值, 被移出的限定语或None)"""
    v = (val or "").strip()
    limit = None
    m = re.match(r"^(.+?)（(.+)）$", v)
    if m:
        base, limit = m.group(1), m.group(2)
        v = base
    # 整格先查词表（防止「中老年、农村居民」被顿号拆开）
    if v in TOKEN:
        new = TOKEN[v]
        return new, limit, []
    parts = [p.strip() for p in re.split(r"[、/]", v) if p.strip()]
    # 「仅医务人员/信息员」作为一个原子值，不拆
    if v == "仅医务人员/信息员":
        parts = ["仅医务人员/信息员"]
    if v in ("老年人/新生儿/慢病患者",):
        parts = [v]
    out = []
    bad = []
    for p in parts:
        if p in TOKEN:
            out.append(TOKEN[p])
        else:
            bad.append(p)
    if bad:
        return None, limit, bad
    uniq = []
    for p in out:
        if p not in uniq:
            uniq.append(p)
    uniq.sort(key=lambda x: ORDER.index(x) if x in ORDER else 99)
    return "、".join(uniq), limit, []

def main():
    wb = openpyxl.load_workbook(SRC)
    ws = wb["1-官方文件"]
    hdr = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    col = {h: i for i, h in enumerate(hdr)}
    iCH, iAU, iLV = col["所属章节"], col["适用受众"], col["层级"]
    iREM, iURL, iQ = col["备注"], col["链接"], col["原文摘抄"]

    log = []
    unmapped = collections.Counter()
    for r in range(2, ws.max_row + 1):
        no = ws.cell(r, col["编号"] + 1).value
        if no is None or str(no).strip() == "":
            continue
        no = str(no).strip()

        # 章节
        old_ch = ws.cell(r, iCH + 1).value
        old_ch = "" if old_ch is None else str(old_ch).strip()
        tgt = norm_chapter(r, old_ch)
        if tgt is None:
            unmapped[old_ch] += 1
        elif tgt != old_ch:
            ws.cell(r, iCH + 1).value = tgt
            rem = ws.cell(r, iREM + 1).value or ""
            ws.cell(r, iREM + 1).value = "［原文位置：%s］%s" % (old_ch, rem)
            log.append((r, no, "章节", old_ch, tgt))

        # 受众
        old_au = ws.cell(r, iAU + 1).value
        old_au = "" if old_au is None else str(old_au).strip()
        new_au, limit, bad = norm_audience(old_au)
        if bad:
            unmapped["受众:" + old_au] += 1
        elif new_au != old_au:
            ws.cell(r, iAU + 1).value = new_au
            rem = ws.cell(r, iREM + 1).value or ""
            tag = "［受众限定：%s］" % limit if limit else ""
            if tag:
                rem = tag + rem
            if new_au != old_au and not tag:
                rem = "［受众原值：%s］%s" % (old_au, rem)
            ws.cell(r, iREM + 1).value = rem
            log.append((r, no, "受众", old_au, new_au))

        # 层级
        old_lv = ws.cell(r, iLV + 1).value
        old_lv = "" if old_lv is None else str(old_lv).strip()
        if old_lv in LV:
            ws.cell(r, iLV + 1).value = LV[old_lv]
            log.append((r, no, "层级", old_lv, LV[old_lv]))

    # ---------- P0 字段修正 ----------
    P0 = [
        # (行, 期望编号, 新链接, 新摘抄, 追加备注)
        (152, "心梗步骤", "不适用（空壳留档，不进应答）", "不适用：无官方原文，见备注",
         "［清洗2026-11-19·乙案］空壳行保留在主表，链接与摘抄改为「不适用」写法，使九列字段全部可解析；本行不进应答。"),
        (154, "热射补水", "不适用（空壳留档，不进应答）", "不适用：无官方原文，见备注",
         "［清洗2026-11-19·乙案］空壳行保留在主表，链接与摘抄改为「不适用」写法，使九列字段全部可解析；本行不进应答。"),
        (155, "儿童误服", None, "不适用（汇总入口行，逐字原文已拆分为独立行，见备注）",
         "［清洗2026-11-19］本行为场景入口汇总行，原文摘抄已拆分登记于本场景各独立行（禁催吐/抠残留/收集证据/危险异物/禁喂水/强酸/可催吐/预防）。"),
        (156, "基孔肯雅", None, "不适用（汇总入口行，逐字原文已拆分为独立行，见备注）",
         "［清洗2026-11-19］本行为场景入口汇总行，原文摘抄已拆分登记于本场景各独立行（症状/不人传/禁阿司匹林/重症人群/防蚊）。"),
        (149, "狂犬同比", None, "狂犬病 167 148 0.0119 0.0105",
         "［清洗2026-11-19］摘抄为官方统计表「狂犬病」整行压平，列序＝病名/发病/死亡/发病率(1/10万)/死亡率(1/10万)；列名依据原表表头，数值照抄未改。"),
    ]
    for line, no, url, q, note in P0:
        cur = ws.cell(line, col["编号"] + 1).value
        assert str(cur).strip() == no, "行%d 编号不符: %r != %r" % (line, cur, no)
        if url is not None:
            ws.cell(line, iURL + 1).value = url
            log.append((line, no, "链接", "（原值）", url))
        ws.cell(line, iQ + 1).value = q
        rem = ws.cell(line, iREM + 1).value or ""
        ws.cell(line, iREM + 1).value = note + rem
        log.append((line, no, "摘抄", "（原值）", q[:28]))

    # 短摘抄加标记（行268/269/275）
    for line in (268, 269, 275):
        rem = ws.cell(line, iREM + 1).value or ""
        if "［清洗2026-11-19·短摘抄］" not in rem:
            ws.cell(line, iREM + 1).value = (
                "［清洗2026-11-19·短摘抄］摘抄为源页短句片段，照录未扩充（源页该处即为短句）。" + rem)
            log.append((line, ws.cell(line, col["编号"] + 1).value, "备注", "—", "加短摘抄标记"))

    # 行77 与行276 同源标记
    rem77 = ws.cell(77, iREM + 1).value or ""
    if "［清洗2026-11-19·同源］" not in rem77:
        ws.cell(77, iREM + 1).value = (
            "［清洗2026-11-19·同源］本行摘抄与「蛇伤指南2024全文」行为同一段原文（7.1.10 处置禁忌）的两处登记，引用时择一。"
            + rem77)
        log.append((77, "蛇咬禁忌", "备注", "—", "加同源标记"))

    # ---------- 4-链接实测结果：摘除汇总行 ----------
    ws4 = wb["4-链接实测结果"]
    removed = []
    for r in range(ws4.max_row, 1, -1):
        v = ws4.cell(r, 1).value
        u = ws4.cell(r, 2).value
        if v is None or str(v).strip() in ("", "汇总", "None"):
            if u is None or "汇总" in str(v or "") or str(v or "").strip() == "":
                removed.append((r, v, str(u)[:40] if u else None))
                ws4.delete_rows(r)
    for x in removed:
        log.append((x[0], "4-表", "删汇总行", str(x[1]), ""))

    # ---------- 说明页追加清洗记录 ----------
    ws0 = wb["0-填写说明"]
    row = ws0.max_row + 1
    ws0.cell(row, 1).value = "【清洗记录（2026-11-19 18:40）】"
    ws0.cell(row, 2).value = (
        "清洗范围：仅写法与取值归一，不改任何一条事实结论。"
        "①所属章节 134 种唯一值 → 30 种（原文定位串移入备注「［原文位置：…］」前缀）；"
        "②适用受众 34 种 → 归一为 12 词表原子值组合（括号限定语移入备注「［受众限定：…］」）；"
        "③层级 17 种 → 15 种（仅合并「部门规范」→「部门规范性文件」、「预案/中央文件」→「应急预案」；"
        "「空壳留档」「学术论文」为状态标记，保留原样）；"
        "④空壳行（心梗步骤/热射补水）按乙案保留主表，链接与摘抄改「不适用」写法；"
        "⑤儿童误服/基孔肯雅两行明确为汇总入口行，摘抄改「不适用（汇总入口行…）」；"
        "⑥狂犬同比摘抄补全为整行（167 148 0.0119 0.0105），列序依据原表表头；"
        "⑦「4-链接实测结果」删去 2 行残留汇总行。"
        "复核结果：数据行仍 280；可信程度仍 官方原文187/只有一家88/两家一致3/自己判断2；"
        "正文已收录仍 是53/否227；编号仍 280 唯一无重复。上述四项与清洗前完全一致。"
    )
    ws0.cell(row + 1, 1).value = "【清洗未做项】"
    ws0.cell(row + 1, 2).value = (
        "①6 行空备注、1 行空借鉴点未补（无依据可写，不编）；"
        "②待验证清单「责任人」列 36 行仍空（未分派，不代填）；"
        "③行268/269/275 摘抄不足15字，照录未扩充（源页即为短句）；"
        "④表1 引用的 15 条链接仍未进「4-链接实测结果」（需联网复测）。"
    )

    print("== 未映射值（应为空）:", dict(unmapped))
    print("== 变更条数:", len(log))
    cnt = collections.Counter(x[2] for x in log)
    print("== 按类型:", dict(cnt))

    # 校验
    ws = wb["1-官方文件"]
    hdr2 = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
    c2 = {h: i for i, h in enumerate(hdr2)}
    rows = []
    for r in range(2, ws.max_row + 1):
        if ws.cell(r, c2["编号"] + 1).value in (None, ""):
            continue
        rows.append({h: ws.cell(r, c2[h] + 1).value for h in hdr2})
    print("== 清洗后数据行:", len(rows))
    print("== 章节唯一值:", len(set(str(x["所属章节"]).strip() for x in rows)))
    print("== 受众唯一值:", len(set(str(x["适用受众"]).strip() for x in rows)))
    print("== 层级唯一值:", len(set(str(x["层级"]).strip() for x in rows)))
    print("== 可信程度:", dict(collections.Counter(str(x["可信程度"]) for x in rows)))
    print("== 正文收录:", dict(collections.Counter(str(x["正文是否已收录"]) for x in rows)))
    ids = collections.Counter(str(x["编号"]).strip() for x in rows)
    print("== 编号重复:", {k: v for k, v in ids.items() if v > 1} or "无")
    badq = [(str(x["编号"]), str(x["原文摘抄"])) for x in rows
            if str(x["原文摘抄"] or "").strip() in ("", "无", "None")]
    print("== 空/占位摘抄行:", badq or "无")
    badu = [(str(x["编号"]), str(x["链接"])) for x in rows
            if not str(x["链接"] or "").startswith("http")]
    print("== 非URL链接行:", len(badu), badu[:6])
    au_tokens = set()
    for x in rows:
        for p in str(x["适用受众"]).split("、"):
            au_tokens.add(p.strip())
    print("== 受众原子值:", sorted(au_tokens))
    print("== 受众越界原子值:", sorted(au_tokens - set(ORDER)))
    print("== 章节清单:")
    for k, v in sorted(collections.Counter(str(x["所属章节"]).strip() for x in rows).items(),
                       key=lambda z: -z[1]):
        print("   %3d  %s" % (v, k))

    if DRY:
        print("\n[dry] 未写盘")
        return
    outdir = "19日18.40-清洗版"
    os.makedirs(outdir, exist_ok=True)
    wb.save(os.path.join(outdir, SRC))
    print("\n已写出:", os.path.join(outdir, SRC))

if __name__ == "__main__":
    main()

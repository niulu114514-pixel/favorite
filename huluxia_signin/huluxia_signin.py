# -*- coding: utf-8 -*-
"""
葫芦侠三楼 每日自动签到脚本（服务器版）

- 账号内置：直接填写下面的 ACCOUNTS，无需环境变量
- 无推送：签到结果仅打印到日志
- 依赖：仅 requests（pip install requests）

使用方法：
    1. 编辑 ACCOUNTS，填入你的账号，格式 {"手机号": "密码"}，可同时配置多个账号
    2. 运行：python3 huluxia_signin.py
    3. 每日定时执行（见底部 CRON 示例）
"""
import hashlib
import json
import logging
import random
import time
from datetime import datetime

import requests

# ===================== 请在此填写你的账号（内置账号） =====================
# 格式：{"手机号": "密码"}
# 注意：使用前请先在葫芦侠 APP 中解除 QQ 绑定，
#       否则会提示“账号保护已开启，请使用QQ登录”。
ACCOUNTS = {
    "13800000000": "请输入你的密码",
    # "13900000000": "第二个账号的密码",
}
# ========================================================================

# 葫芦侠三楼 版块id -> 版块名
CAT_ID = {
    "1": "3楼公告版",
    "2": "泳池",
    "3": "自拍",
    "4": "游戏",
    "6": "意见反馈",
    "15": "葫芦山",
    "16": "玩机广场",
    "22": "英雄联盟",
    "29": "次元阁",
    "43": "实用软件",
    "44": "玩机教程",
    "45": "原创技术",
    "57": "头像签名",
    "58": "恶搞",
    "60": "未知版块",
    "63": "我的世界",
    "67": "MC贴子",
    "68": "资源审核",
    "69": "优秀资源",
    "70": "福利活动",
    "71": "王者荣耀",
    "76": "娱乐天地",
    "81": "手机美化",
    "82": "3楼学院",
    "84": "3楼精选",
    "92": "模型玩具",
    "94": "三楼活动",
    "96": "技术分享",
    "98": "制图工坊",
    "108": "新游推荐",
    "111": "Steam",
    "115": "金铲铲之战",
    "119": "爱国爱党",
    "125": "妙易堂",
    "126": "三角洲行动",
    "127": "夏日炎炎",
    "128": "AI星球",
    "129": "洛克王国: 世界",
}

# ===================== 日志配置 =====================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s]:  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("huluxia")
# ===================================================

# 随机设备配置
PHONE_BRAND_TYPES = ["MI", "Huawei", "UN", "OPPO", "VO"]
DEVICE_CODE_RANDOM = random.randint(111, 987)

PLATFORM = "2"
GKEY = "000000"
APP_VERSION = "4.3.1.5.2"
VERSIONCODE = "398"
MARKET_ID = "floor_web"
DEVICE_CODE = f"%5Bd%5D5125c3c6-f{DEVICE_CODE_RANDOM}-4c6b-81cf-9bc467522d61"
PHONE_BRAND_TYPE = random.choice(PHONE_BRAND_TYPES)

HEADERS = {
    "Connection": "close",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "User-Agent": "okhttp/3.8.1",
    "Host": "floor.huluxia.com",
}

SESSION = requests.Session()


def md5(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def timestamp() -> int:
    return int(time.time())


class HuluxiaSignin:
    def __init__(self):
        self._key = ""
        self.userid = ""
        self.cat_id = ""
        self.signin_continue_days = ""

    def psd_login(self, account: str, password: str) -> dict:
        """手机号/邮箱 + 密码登录，返回原始响应"""
        device_model = f"iPhone{random.randint(14, 17)}%2C{random.randint(1, 6)}"
        login_url = ("https://floor.huluxia.com/account/login/IOS/1.0?"
                     "access_token=&app_version=1.2.2&code=&device_code=" + DEVICE_CODE +
                     "&device_model=" + device_model +
                     "&email=" + account +
                     "&market_id=floor_huluxia&openid=&password=" + md5(password) +
                     "&phone=&platform=1")
        return SESSION.get(url=login_url, headers=HEADERS).json()

    def set_config(self, acc: str, psd: str):
        data = self.psd_login(acc, psd)
        status = data.get("status")
        if status == 0:
            raise ValueError("手机号或密码错误")
        self._key = data["_key"]
        self.userid = data["user"]["userID"]
        return self._key

    def user_info(self) -> tuple:
        get_info_url = ("http://floor.huluxia.com/user/info/ANDROID/4.1.8?"
                        f"platform={PLATFORM}&gkey={GKEY}&app_version={APP_VERSION}"
                        f"&versioncode={VERSIONCODE}&market_id={MARKET_ID}&_key={self._key}"
                        f"&device_code={DEVICE_CODE}&phone_brand_type={PHONE_BRAND_TYPE}"
                        f"&user_id={self.userid}")
        info = requests.get(url=get_info_url, headers=HEADERS).json()
        return info["nick"], info["level"], info["exp"], info["nextExp"]

    def mask_nickname(self, nickname: str) -> str:
        if len(nickname) > 2:
            return nickname[0] + "*" * (len(nickname) - 2) + nickname[-1]
        elif len(nickname) == 2:
            return "*" + nickname[-1]
        return nickname

    def sign_get(self) -> str:
        """生成签到签名"""
        n = self.cat_id
        i = str(timestamp())
        r = "fa1c28a5b62e79c3e63d9030b6142e4b"
        return md5("cat_id" + n + "time" + i + r).upper()

    def huluxia_signin(self, acc: str, psd: str):
        # 登录
        self.set_config(acc, psd)
        info = self.user_info()
        masked_nickname = self.mask_nickname(info[0])
        logger.info(f"正在为{masked_nickname}签到 | 等级：Lv.{info[1]} | 经验值：{info[2]}/{info[3]}")

        total_exp = 0
        for ct in CAT_ID.keys():
            self.cat_id = ct
            sign = self.sign_get()
            signin_url = (
                f"http://floor.huluxia.com/user/signin/ANDROID/4.1.8?"
                f"platform={PLATFORM}&gkey={GKEY}&app_version={APP_VERSION}&versioncode={VERSIONCODE}"
                f"&market_id={MARKET_ID}&_key={self._key}&device_code={DEVICE_CODE}"
                f"&phone_brand_type={PHONE_BRAND_TYPE}&cat_id={self.cat_id}&time={timestamp()}"
            )
            post_data = {"sign": sign}
            try:
                signin_res = SESSION.post(url=signin_url, headers=HEADERS, data=post_data).json()
            except Exception as e:
                logger.error(f"签到过程中出现错误：{e}")
                break

            if signin_res.get("status") == 0:
                logger.warning(f"【{CAT_ID[self.cat_id]}】签到失败，请手动签到。")
                time.sleep(3)
                continue

            signin_exp = signin_res.get("experienceVal", 0)
            self.signin_continue_days = signin_res.get("continueDays", 0)
            logger.info(f"【{CAT_ID[self.cat_id]}】签到成功，经验值 +{signin_exp}")
            total_exp += signin_exp
            time.sleep(3)

        logger.info(f"本次为{masked_nickname}签到共获得：{total_exp} 经验值")

        final_info = self.user_info()
        masked_final_nickname = self.mask_nickname(final_info[0])
        remaining_days = (int(final_info[3]) - int(final_info[2])) // total_exp + 1 if total_exp else "未知"
        logger.info(
            f"已为{masked_final_nickname}完成签到 | 等级：Lv.{final_info[1]} | "
            f"经验值：{final_info[2]}/{final_info[3]} | 已连续签到 {self.signin_continue_days} 天 | "
            f"还需签到 {remaining_days} 天"
        )


def main():
    if not ACCOUNTS:
        logger.error("ACCOUNTS 为空，请先在脚本顶部填写账号")
        return
    signer = HuluxiaSignin()
    for phone, password in ACCOUNTS.items():
        try:
            signer.huluxia_signin(phone, password)
            logger.info(f"账号 {phone} 签到成功")
        except Exception as e:
            logger.error(f"账号 {phone} 签到失败: {e}")
        time.sleep(60)  # 两个账号之间间隔 60 秒


if __name__ == "__main__":
    logger.info(f"签到开始，共 {len(ACCOUNTS)} 个账号，当前时间 {datetime.now():%Y-%m-%d %H:%M:%S}")
    main()
    logger.info("全部签到任务执行完毕")

"""
每日定时执行（cron，服务器时间为 UTC）：
    每天定时运行一次，例如北京时间 00:00（对应 UTC 16:00）：
    crontab -e 中添加一行：
    0 16 * * * cd /path/to/huluxia_signin && python3 huluxia_signin.py >> signin.log 2>&1
"""
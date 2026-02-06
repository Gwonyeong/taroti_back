/**
 * TossClient - 토스 Apps-in-Toss API 통신 클라이언트
 * mTLS 인증서를 사용하여 OAuth2 토큰 교환 및 사용자 정보 조회를 담당합니다.
 */
const https = require("https");

class TossClient {
  constructor() {
    this.baseUrl =
      process.env.TOSS_BASE_URL || "https://apps-in-toss-api.toss.im";
    this.certKey = process.env.TOSS_CERT_KEY;
    this.privateKey = process.env.TOSS_PRIVATE_KEY;
  }

  /**
   * mTLS를 사용하여 HTTPS 요청을 수행합니다.
   */
  async request(endpoint, options = {}) {
    const url = new URL(endpoint, this.baseUrl);

    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        cert: this.certKey,
        key: this.privateKey,
        rejectUnauthorized: true,
      };

      const req = https.request(requestOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const error = new Error(parsed.message || "API 요청 실패");
              error.response = { data: parsed, status: res.statusCode };
              reject(error);
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`응답 파싱 실패: ${data}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      if (options.data) {
        req.write(JSON.stringify(options.data));
      }
      req.end();
    });
  }

  /**
   * 인가 코드로 액세스 토큰을 교환합니다.
   */
  async generateToken(authorizationCode, referrer) {
    return this.request(
      "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
      {
        method: "POST",
        data: { authorizationCode, referrer },
      }
    );
  }

  /**
   * 액세스 토큰으로 사용자 정보를 조회합니다.
   */
  async getUserInfo(accessToken) {
    return this.request("/api-partner/v1/apps-in-toss/user/oauth2/login-me", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  /**
   * 액세스 토큰으로 OAuth 연결을 해제합니다.
   */
  async removeByAccessToken(accessToken) {
    return this.request(
      "/api-partner/v1/apps-in-toss/user/oauth2/access/remove",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
  }

  /**
   * userKey로 OAuth 연결을 해제합니다.
   */
  async removeByUserKey(userKey) {
    return this.request(
      "/api-partner/v1/apps-in-toss/user/oauth2/access/remove-by-user-key",
      {
        method: "POST",
        data: { userKey },
      }
    );
  }

  /**
   * 프로모션 리워드 지급을 위한 Key를 발급받습니다.
   * @param {string} promotionCode - 프로모션 코드 (예: "ATTENDANCE_DAILY")
   * @param {number} amount - 지급 금액 (원)
   * @param {string} userKey - 토스 사용자 고유 키
   * @returns {Promise<{key: string}>} - 발급된 Key
   *
   * 주의사항:
   * - 발급받은 Key의 유효시간은 1시간
   * - 이미 사용한 Key로 재지급 시도하면 4113 에러 발생
   * - 1회 지급만 허용하려면 자체적으로 제어 필요
   */
  async getPromotionRewardKey(promotionCode, amount, userKey) {
    return this.request(
      "/api-partner/v1/apps-in-toss/promotion/execute-promotion/get-key",
      {
        method: "POST",
        data: {
          promotionCode,
          amount,
          userKey,
        },
      }
    );
  }

  /**
   * 발급받은 Key로 프로모션 리워드를 지급합니다.
   * @param {string} promotionCode - 프로모션 코드
   * @param {string} key - getPromotionRewardKey로 발급받은 Key
   * @param {number} amount - 지급 금액 (원)
   * @param {string} userKey - 토스 사용자 고유 키
   * @returns {Promise<{resultType: string, success: {key: string}}>}
   *
   * 지급 시 프로모션 예산에서 차감되며, 실제 지급까지는 약간의 지연이 발생할 수 있습니다.
   */
  async executePromotionReward(promotionCode, key, amount, userKey) {
    return this.request(
      "/api-partner/v1/apps-in-toss/promotion/execute-promotion",
      {
        method: "POST",
        headers: {
          "x-toss-user-key": userKey,
        },
        data: {
          promotionCode,
          key,
          amount,
        },
      }
    );
  }
}

// 싱글톤 인스턴스
let tossClientInstance = null;

const getTossClient = () => {
  if (!tossClientInstance) {
    tossClientInstance = new TossClient();
  }
  return tossClientInstance;
};

module.exports = { TossClient, getTossClient };

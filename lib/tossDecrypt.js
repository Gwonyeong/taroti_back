/**
 * TossDecrypt - 토스 사용자 정보 AES-256-GCM 복호화 클래스
 * 토스는 민감한 사용자 정보를 AES-256-GCM으로 암호화하여 전송합니다.
 */
const crypto = require("crypto");

class TossDecrypt {
  constructor() {
    // Base64 인코딩된 32바이트 키
    this.mtlsKey = process.env.TOSS_MTLS;
    // Additional Authenticated Data
    this.aad = process.env.TOSS_AAD || "TOSS";
  }

  /**
   * 암호화된 데이터를 복호화합니다.
   * @param {string} encryptedData - Base64 인코딩된 암호화 데이터
   * @returns {string|null} 복호화된 문자열 또는 null
   */
  decrypt(encryptedData) {
    if (!encryptedData) return null;

    try {
      const encryptedBuffer = Buffer.from(encryptedData, "base64");
      const key = Buffer.from(this.mtlsKey, "base64");
      const aad = Buffer.from(this.aad, "utf8");

      // 데이터 구조: [IV(12bytes)][Ciphertext][AuthTag(16bytes)]
      const ivLength = 12;
      const tagLength = 16;

      const iv = encryptedBuffer.subarray(0, ivLength);
      const authTag = encryptedBuffer.subarray(encryptedBuffer.length - tagLength);
      const ciphertext = encryptedBuffer.subarray(ivLength, encryptedBuffer.length - tagLength);

      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, null, "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      return null;
    }
  }

  /**
   * 토스 사용자 정보 객체의 암호화된 필드들을 복호화합니다.
   * @param {Object} userData - 토스에서 받은 사용자 정보 (중첩 구조 지원)
   * @returns {Object} 복호화된 사용자 정보
   */
  decryptUserData(userData) {
    // Toss API 응답이 { resultType, success: { ... } } 구조인 경우 처리
    if (userData.resultType === "SUCCESS" && userData.success) {
      const success = { ...userData.success };

      const encryptedFields = ["name", "phone", "birthday", "ci", "gender", "nationality"];

      encryptedFields.forEach((field) => {
        if (success[field]) {
          success[field] = this.decrypt(success[field]);
        }
      });

      return {
        ...userData,
        success,
        // 편의를 위해 최상위에도 복호화된 값 제공
        name: success.name,
        phone: success.phone,
        birthday: success.birthday,
        ci: success.ci,
        gender: success.gender,
        nationality: success.nationality,
        userKey: success.userKey,
        scope: success.scope,
      };
    }

    // 기존 방식 (직접 필드 접근) 지원
    return {
      ...userData,
      name: this.decrypt(userData.name),
      phone: this.decrypt(userData.phone),
      birthday: this.decrypt(userData.birthday),
      ci: this.decrypt(userData.ci),
      gender: this.decrypt(userData.gender),
      nationality: this.decrypt(userData.nationality),
    };
  }
}

const tossDecrypt = new TossDecrypt();

module.exports = { TossDecrypt, tossDecrypt };

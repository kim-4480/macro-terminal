// 브라우저별 편의 설정(언어, 마지막 뉴스 주제, 차트 기간). 저장이 막힌 환경에서도 앱은 동작한다.
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`macro-terminal:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`macro-terminal:${key}`, value);
    } catch {
      /* 저장 불가 환경 */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(`macro-terminal:${key}`);
    } catch {
      /* 저장 불가 환경 */
    }
  },
};

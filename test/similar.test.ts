import { describe, expect, it } from "vitest";
import { similarQuery } from "../shared/similar";

describe("similarQuery", () => {
  it("keeps the brand and model code, and drops promo text", () => {
    expect(similarQuery("【免運現貨】Skechers 女鞋 210811BBK 獨家 運費")).toBe("Skechers 210811BBK");
    expect(similarQuery("Skechers 210811BBK 女款 慢跑鞋 現貨 獨家")).toBe("Skechers 210811BBK");
  });

  it("drops bracket ads but keeps a brand written inside brackets", () => {
    const title =
      "【Samsung 三星】Galaxy Z Fold8 5G 7.6吋(12G/512G/Snapdragon 8 Elite Gen 5/5000萬畫素超廣角/AI手機)";
    expect(similarQuery(title)).toBe("Samsung Galaxy Z Fold8");
  });

  it("joins a split model such as Fold 8 and still limits the length", () => {
    expect(similarQuery("Samsung Galaxy Z Fold 8 Ultra 512GB 現貨")).toBe("Samsung Galaxy Z Fold 8");
    const query = similarQuery("甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸 超長標題沒有型號 黑色 現貨 獨家");
    expect(query.length).toBeLessThanOrEqual(40);
    expect(query).not.toMatch(/現貨|獨家/);
  });

  it("uses the first keywords when there is no model code", () => {
    expect(similarQuery("無線藍牙 耳罩式耳機 黑色 現貨 運費")).toBe("無線藍牙 耳罩式耳機 黑色");
  });

  it("simplifies the PChome Fold8 title that hides the brand in the description line", () => {
    expect(similarQuery("【S+級福利品】Samsung Galaxy Z Fold8 (12G/512G)")).toBe("Samsung Galaxy Z Fold8");
    expect(similarQuery("Samsung Galaxy Z Fold8 Ultra (12G/512G)")).toBe("Samsung Galaxy Z Fold8");
  });

  it("keeps a code like WH-CH520 and ignores the warranty note", () => {
    expect(similarQuery("WH-CH520 無線藍牙 耳罩式耳機《公司貨註冊保固1年》")).toBe("WH-CH520");
  });
});

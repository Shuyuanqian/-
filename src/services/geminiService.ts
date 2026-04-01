import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * 语法解释评价服务 - 全量接入版
 * 对所有题目开启 AI 动态判定，并提供引导式反馈
 */
export async function evaluateExplanation(
  userExplanation: string,
  questionData: any,
  passKeywords: string[]
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  // 关键词匹配逻辑（用于 AI 失败兜底）
  const getKeywordResult = () => {
    const hasKeyword = passKeywords.some(kw => userExplanation.toLowerCase().includes(kw.toLowerCase()));
    return {
      status: hasKeyword ? "pass" : "fail",
      comment: hasKeyword ? "你的解释中提到了核心关键词，很棒！" : "解释似乎没有触及核心语法点，再试一次吧。"
    };
  };

  const prompt = `你是一位英语老师。评价学生对语法题的解释。
题目: ${questionData.stem}
正确答案: ${questionData.correctAnswer}
语法点: ${questionData.grammarPoint}
参考解析: ${questionData.explanationSummary}
核心关键词: ${passKeywords.join(", ")}
学生解释: "${userExplanation}"

判定标准:
1. pass: 解释准确完整。
2. partial: 核心点对但表述不全。指出缺失维度（如：再想想主语人称？），引导学生补全。严禁给答案！
3. fail: 逻辑错误或未触及核心。
4. error: 无关内容或乱码。

要求:
- 返回 JSON: { "status": "pass"|"partial"|"fail"|"error", "comment": "1句简短中文评语" }
- 评语风格: 友好、启发式。`;

  try {
    // 添加 10 秒超时控制，防止 UI 卡死
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("AI_TIMEOUT")), 10000)
    );

    const aiPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["pass", "partial", "fail", "error"] },
            comment: { type: Type.STRING }
          },
          required: ["status", "comment"]
        }
      }
    });

    const response = await Promise.race([aiPromise, timeoutPromise]) as any;
    const result = JSON.parse(response.text || "{}");
    return result;
  } catch (error) {
    console.error("AI Evaluation Error or Timeout:", error);
    return getKeywordResult();
  }
}

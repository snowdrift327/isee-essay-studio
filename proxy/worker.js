// ===========================================================================
// ISEE Essay Studio — 评价代理 (Cloudflare Worker)
// ---------------------------------------------------------------------------
// 作用:替前端保管 Anthropic API key,并在服务器端构造评分提示词。
// 前端只发送 { prompt, rewrite, essay },Worker 返回解析好的评价 JSON。
//
// 部署(二选一):
//  A) wrangler:  cd proxy && wrangler login && wrangler deploy
//     设置密钥:  wrangler secret put ANTHROPIC_API_KEY
//                 (可选) wrangler secret put APP_SECRET
//  B) Cloudflare 仪表盘:新建 Worker,把本文件内容粘进去,
//     在 Settings → Variables 添加 Secret:ANTHROPIC_API_KEY(必填)、APP_SECRET(可选)
//
// 安全:rubric(模型、max_tokens、system)都写死在服务器端,前端无法滥用你的 key
//       去做任意对话。建议把下面 ALLOWED_ORIGIN 改成你的 Pages 域名。
// ===========================================================================

// 把 "*" 换成你的站点,例如 "https://snowdrift327.github.io" 可减少被盗用风险。
const ALLOWED_ORIGIN = "*";

// ---- 评分标准:按"优秀 G6 申请者"的尺子(要调严/调松,改这里) ----
const SYSTEM =
  "You are a demanding writing evaluator for a strong Grade 6 applicant to competitive New York City private schools. Judge this 30-minute expository/descriptive personal essay against the standard of an EXCELLENT Grade 6 writer — not an average 10-year-old. Expect a clear thesis, purposeful organization, vivid and specific personal detail, varied and controlled sentence structure, precise word choice, and near-clean mechanics. Hold a high bar and do not inflate ratings. The writer is about 10, so keep your wording clear and direct, but keep the standard high and the critique honest and specific. Return ONLY valid JSON, no preamble, no markdown.";

function buildUserMessage({ prompt, rewrite, essay }) {
  const words = essay && essay.trim() ? essay.trim().split(/\s+/).length : 0;
  const schema = `Return JSON with exactly this shape:
{
 "summary": "2-3 sentence overall read in plain language",
 "responsiveness": "1-2 sentences: did the essay actually answer the assigned prompt and stay on topic?",
 "rewriteCheck": "1 sentence: on the real ISEE the student must rewrite the prompt at the top of the page. Note whether they did this (compare the 'Prompt copied by student' to the assigned prompt).",
 "dimensions": [
   {"name":"Structure & Paragraphing","rating":"Strong|On Track|Developing","comment":"1-2 sentences"},
   {"name":"Focus on You (specific detail)","rating":"Strong|On Track|Developing","comment":"1-2 sentences"},
   {"name":"Sentence Variety & Word Choice","rating":"Strong|On Track|Developing","comment":"1-2 sentences"},
   {"name":"Grammar, Spelling & Punctuation","rating":"Strong|On Track|Developing","comment":"1-2 sentences"}
 ],
 "mistakes": [
   {"quote":"short exact snippet from the student's essay","issue":"what is wrong","fix":"the corrected version or how to fix it"}
 ],
 "strengths": ["2-3 specific things done well"],
 "priorities": ["2-3 concrete things to practice next, most important first"]
}
List up to 8 of the most useful mistakes (grammar, spelling, capitalization, punctuation, run-ons, vague or weak wording, missed chances for stronger word choice). Quote the student's actual words. Calibrate ratings to an EXCELLENT Grade 6 benchmark: "Strong" = would genuinely impress a selective admissions reader; "On Track" = solid but with clear gaps before that bar; "Developing" = needs real work to reach it. Reserve "Strong" for work that truly earns it. If the essay is very short or empty, say so honestly and lower the ratings.`;

  return `ASSIGNED PROMPT:\n${prompt || "(none)"}\n\nPROMPT COPIED BY STUDENT (what they wrote at the top):\n${rewrite || "(left blank)"}\n\nSTUDENT ESSAY (${words} words):\n${essay || "(blank)"}\n\n${schema}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-app-secret",
  };
}

export default {
  async fetch(request, env) {
    const headers = { ...corsHeaders(), "Content-Type": "application/json" };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });

    // 可选的简单防盗用
    if (env.APP_SECRET && request.headers.get("x-app-secret") !== env.APP_SECRET)
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });

    if (!env.ANTHROPIC_API_KEY)
      return new Response(JSON.stringify({ error: "server missing ANTHROPIC_API_KEY" }), { status: 500, headers });

    try {
      const body = await request.json();
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          system: SYSTEM,
          messages: [{ role: "user", content: buildUserMessage(body) }],
        }),
      });

      const raw = await upstream.text();
      if (!upstream.ok) {
        return new Response(
          JSON.stringify({ error: "上游接口报错", detail: raw.slice(0, 300) }),
          { status: 502, headers }
        );
      }

      const data = JSON.parse(raw);

      // 如果回复因为长度被截断,直接给出可读提示而不是抛解析错
      if (data.stop_reason === "max_tokens") {
        return new Response(
          JSON.stringify({ error: "评价内容过长被截断,请把作文略缩短或重试。" }),
          { status: 502, headers }
        );
      }

      let text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .replace(/```json|```/g, "")
        .trim();

      // 稳健提取:只取第一个 { 到最后一个 } 之间的内容,容忍模型多写的前后文字
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        text = text.slice(first, last + 1);
      }

      const evaluation = JSON.parse(text);
      return new Response(JSON.stringify(evaluation), { headers });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "评价生成失败,请重试。", detail: String(e && e.message) }),
        { status: 500, headers }
      );
    }
  },
};

export async function onRequestPost(context) {
  const { request, env } = context;
  
  // CORS headers для работы с GitHub Pages
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  
  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const body = await request.json();
    
    // Валидация входных данных
    if (!body.soil || !body.crop || typeof body.area !== "number") {
      return new Response(
        JSON.stringify({ error: "Неверные входные данные" }),
        { status: 400, headers: corsHeaders }
      );
    }
    
    if (!env.OPENAI_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_KEY не настроен" }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    const prompt = `Ты профессиональный агро-эксперт. Проанализируй данные:

pH: ${body.soil.ph}
N: ${body.soil.n}
P: ${body.soil.p}
K: ${body.soil.k}
Влажность: ${body.soil.moisture}%
Органическое вещество: ${body.soil.om}%
Культура: ${body.crop}
Площадь: ${body.area} га

Ответ строго в формате JSON (без markdown блоков, только чистый JSON):

{
  "yieldIncrease": число_от_5_до_20,
  "profit": число_от_1000_до_100000,
  "fertilizerPlan": "текст рекомендации по удобрениям на русском языке",
  "carePlan": "текст плана ухода, каждый пункт с новой строки"
}`;
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      })
    });
    
    if (!response.ok) {
      let errorMsg = `OpenAI API error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.error?.message || errorData.error || errorMsg;
      } catch {
        const errorText = await response.text();
        errorMsg = errorText || errorMsg;
      }
      return new Response(
        JSON.stringify({ error: `AI processing error: ${errorMsg}` }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      return new Response(
        JSON.stringify({ error: "Не удалось распарсить ответ от OpenAI" }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      return new Response(
        JSON.stringify({ error: "Неверный формат ответа от OpenAI. Нет choices[0].message" }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    let text = data.choices[0].message.content.trim();
    
    if (!text) {
      return new Response(
        JSON.stringify({ error: "Пустой ответ от AI" }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    // Убираем markdown код блоки, если есть
    if (text.startsWith("```json")) {
      text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (text.startsWith("```")) {
      text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    
    // Парсим JSON
    let aiResult;
    try {
      aiResult = JSON.parse(text);
    } catch (parseError) {
      return new Response(
        JSON.stringify({ 
          error: `Не удалось распарсить JSON ответ. Текст: ${text.substring(0, 200)}` 
        }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    // Валидация структуры ответа
    if (typeof aiResult.yieldIncrease !== "number") {
      return new Response(
        JSON.stringify({ error: `Неверный тип yieldIncrease: ${typeof aiResult.yieldIncrease}` }),
        { status: 500, headers: corsHeaders }
      );
    }
    if (typeof aiResult.profit !== "number") {
      return new Response(
        JSON.stringify({ error: `Неверный тип profit: ${typeof aiResult.profit}` }),
        { status: 500, headers: corsHeaders }
      );
    }
    if (typeof aiResult.fertilizerPlan !== "string") {
      return new Response(
        JSON.stringify({ error: `Неверный тип fertilizerPlan: ${typeof aiResult.fertilizerPlan}` }),
        { status: 500, headers: corsHeaders }
      );
    }
    if (typeof aiResult.carePlan !== "string") {
      return new Response(
        JSON.stringify({ error: `Неверный тип carePlan: ${typeof aiResult.carePlan}` }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    return new Response(JSON.stringify(aiResult), {
      headers: corsHeaders
    });
    
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Внутренняя ошибка: ${error.message || String(error)}` 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
  
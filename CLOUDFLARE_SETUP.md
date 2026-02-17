# Инструкция по настройке Cloudflare Workers для AgroAI

## Структура проекта

Ваш бэкенд должен быть развернут как **Cloudflare Worker** (не Pages Function).

Файл `functions/analyze.js` нужно скопировать в отдельный Worker проект или использовать напрямую.

## Вариант 1: Cloudflare Worker (рекомендуется)

### Шаг 1: Создание Worker

1. Зайдите в [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Выберите **Workers & Pages** → **Create application**
3. Выберите **Create Worker**
4. Назовите Worker: `agro-ai-backend`
5. Нажмите **Deploy**

### Шаг 2: Настройка кода

1. В редакторе Worker замените весь код на содержимое файла **`worker.js`** (это версия для Workers)
2. Или используйте `functions/analyze.js`, но измените экспорт на формат Worker:
   ```javascript
   export default {
     async fetch(request, env) {
       // ... код функции (используйте env вместо context.env)
     }
   }
   ```

### Шаг 3: Настройка переменных окружения

1. В настройках Worker перейдите в **Settings** → **Variables**
2. В секции **Environment Variables** нажмите **Add variable**
3. Добавьте переменную:
   - **Variable name**: `OPENAI_KEY`
   - **Value**: ваш API ключ от OpenAI (начинается с `sk-...`)
4. Нажмите **Save**

### Шаг 4: Настройка домена

1. В настройках Worker перейдите в **Settings** → **Triggers**
2. Убедитесь, что Worker доступен по адресу:
   - `agro-ai-backend.<ваш-субдомен>.workers.dev`
   - Или настройте кастомный домен

### Шаг 5: Обновление URL во фронтенде

В файле `script.js` строка 838 должна содержать правильный URL вашего Worker:

```javascript
const response = await fetch("https://agro-ai-backend.<ваш-субдомен>.workers.dev", {
```

Замените `<ваш-субдомен>` на ваш реальный субдомен Cloudflare (например, `alexandromir3`).

## Вариант 2: Cloudflare Pages Functions

Если вы используете Cloudflare Pages:

1. Убедитесь, что файл `functions/analyze.js` находится в папке `functions/` в корне проекта
2. Структура должна быть:
   ```
   agro/
   ├── functions/
   │   └── analyze.js
   ├── index.html
   ├── styles.css
   └── script.js
   ```
3. В Cloudflare Pages настройте переменную окружения `OPENAI_KEY`:
   - **Settings** → **Environment Variables**
   - Добавьте `OPENAI_KEY` с вашим OpenAI API ключом

## Проверка работы

1. После деплоя откройте сайт на GitHub Pages
2. Заполните форму и запустите анализ
3. Откройте консоль браузера (F12)
4. Проверьте логи:
   - Если видите "OPENAI_KEY не настроен" → проверьте переменные окружения
   - Если видите "OpenAI API error: 401" → проверьте правильность API ключа
   - Если видите "OpenAI API error: 429" → превышен лимит запросов

## Получение OpenAI API ключа

1. Зайдите на [platform.openai.com](https://platform.openai.com/)
2. Войдите в аккаунт
3. Перейдите в **API keys** → **Create new secret key**
4. Скопируйте ключ (он начинается с `sk-...`)
5. Вставьте его в переменную `OPENAI_KEY` в Cloudflare

## Важно

- **Никогда не коммитьте API ключ в git!** Используйте только переменные окружения
- Убедитесь, что Worker имеет доступ к интернету (по умолчанию включено)
- Проверьте, что CORS headers настроены правильно (уже есть в коде)

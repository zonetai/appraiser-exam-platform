// 站台設定。部署 AI 批改（supabase/functions/grade）後，把端點網址填在這裡，所有訪客的題目頁就會出現「AI 批改」按鈕。
// aiAnonKey 填 Supabase 的 anon／publishable key（公開金鑰，可放前端）；函式若以 --no-verify-jwt 部署則可留空。
window.APP_CONFIG = {
  aiEndpoint: 'https://snyjmzwrgtupbutoppqf.supabase.co/functions/v1/grade',
  aiAnonKey: '',
};

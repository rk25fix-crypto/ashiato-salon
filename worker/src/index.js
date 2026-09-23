// あしあとさろん 管理用Worker。エントリポイント(ルーティングだけ)。
// 「パスワード認証」と「GitHubリポジトリへのコミット」だけを行う薄い中継役。
// 仕様は worker/API.md が唯一の正。実装本体は ./lib.js。

import { corsHeaders, json, handleLogin, handleGetContent, handleSave } from './lib.js';
// Wrangler の Text module rule(wrangler.toml)でビルド時に同梱される。
// テンプレートを変えたら再デプロイが必要。
import template from '../../index.template.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders() });
      if (url.pathname === '/login' && request.method === 'POST') return await handleLogin(request, env);
      if (url.pathname === '/content' && request.method === 'GET') return await handleGetContent(request, env, template);
      if (url.pathname === '/save' && request.method === 'POST') return await handleSave(request, env, template);
      return json(404, { error: 'Not Found' });
    } catch (e) {
      console.error(e);
      return json(500, { error: 'エラーが発生しました。しばらくしてからもう一度お試しください' });
    }
  },
};

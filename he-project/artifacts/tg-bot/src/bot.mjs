import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';
const PLAYER_URL = process.env.PLAYER_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (() => {
    const d = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0] || '';
    return d ? `https://${d}/cinebot-app/` : '';
  })();
const MINI_APP_BASE = PLAYER_URL;

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');

const SELF_URL = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/health`
  : null;

if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL, { signal: AbortSignal.timeout(10000) })
      .then(() => console.log('[KeepAlive] Ping sent'))
      .catch((err) => console.warn('[KeepAlive] Ping failed:', err.message));
  }, 14 * 60 * 1000);
  console.log(`[KeepAlive] Self-ping enabled → ${SELF_URL}`);
}

process.on('unhandledRejection', (err) => console.error('[UnhandledRejection]', err?.message || err));
process.on('uncaughtException',  (err) => console.error('[UncaughtException]',  err?.message || err));

const _cache = new Map();
function cacheGet(key) {
  const e = _cache.get(key);
  if (e && Date.now() - e.ts < 5 * 60 * 1000) return e.val;
  _cache.delete(key);
  return null;
}
function cacheSet(key, val) { _cache.set(key, { val, ts: Date.now() }); }

function h(text) {
  if (text == null) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function truncate(text, max = 700) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max) + '…' : text;
}

async function mbApi(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const cacheKey = url.toString();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  cacheSet(cacheKey, data);
  return data;
}

function buildSearchResultKeyboard(items) {
  if (!items || items.length === 0) return null;
  return items.slice(0, 10).map(item => {
    const title = item.title || item.name || 'Untitled';
    const year = item.year ? `(${item.year})` : '';
    const icon = item.type === 'movie' || item.subjectType === 1 ? '🎬' : '📺';
    const rating = item.rating ? `⭐ ${item.rating}` : '';
    const label = `${icon} ${title} ${year} ${rating}`.trim().substring(0, 60);
    const cbType = item.type === 'movie' || item.subjectType === 1 ? 'mb_movie' : 'mb_tv';
    return [{ text: label, callback_data: `${cbType}_${item.subjectId}` }];
  });
}

function buildHomeFeedKeyboard(items) {
  if (!items || items.length === 0) return null;
  return items.slice(0, 10).map(item => {
    const title = item.title || item.name || 'Untitled';
    const year = item.year ? `(${item.year})` : '';
    const icon = (item.type === 'movie' || item.subjectType === 1) ? '🎬' : '📺';
    const label = `${icon} ${title} ${year}`.trim().substring(0, 60);
    const cbType = (item.type === 'movie' || item.subjectType === 1) ? 'mb_movie' : 'mb_tv';
    return [{ text: label, callback_data: `${cbType}_${item.subjectId}` }];
  });
}

const bot = new Bot(TOKEN);

async function safeSend(chatId, text, opts = {}) {
  try {
    return await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', ...opts });
  } catch (err) {
    console.error('[safeSend HTML error]', err?.message);
    try {
      return await bot.api.sendMessage(chatId, text.replace(/<[^>]+>/g, ''), { ...opts, parse_mode: undefined });
    } catch (err2) {
      console.error('[safeSend plain error]', err2?.message);
    }
  }
}

async function safeEdit(chatId, messageId, text, opts = {}) {
  if (!messageId) return safeSend(chatId, text, opts);
  try {
    return await bot.api.editMessageText(chatId, messageId, text, { parse_mode: 'HTML', ...opts });
  } catch (err) {
    if (err?.message?.includes('message is not modified')) return;
    console.error('[safeEdit]', err?.message);
    try { return safeSend(chatId, text, opts); } catch (_) {}
  }
}

async function safePhoto(chatId, url, caption, opts = {}) {
  try {
    return await bot.api.sendPhoto(chatId, url, { caption, parse_mode: 'HTML', ...opts });
  } catch (err) {
    console.error('[safePhoto]', err?.message);
    return safeSend(chatId, caption, opts);
  }
}

async function handleTrending(chatId) {
  const waitMsg = await safeSend(chatId, '🔥 Loading trending today...');
  try {
    const data = await mbApi('/stream/mb-home', { page: 1 });
    const items = (data?.items || []).slice(0, 10);
    const keyboard = buildHomeFeedKeyboard(items);
    if (!keyboard) return safeEdit(chatId, waitMsg?.message_id, '❌ No trending data available.');
    await safeEdit(chatId, waitMsg?.message_id, `🔥 <b>Trending Now:</b>\n🎬 = Movie  📺 = Series\n\nTap for details &amp; watch links:`, {
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    console.error('/trending error:', err?.message);
    await safeEdit(chatId, waitMsg?.message_id, '⚠️ Could not load trending. Try again later.');
  }
}

async function handleSearch(chatId, query, typeFilter) {
  const waitMsg = await safeSend(chatId, `🔍 Searching for <b>${h(query)}</b>...`);
  try {
    const data = await mbApi('/stream/mb-search', { q: query });
    let items = data?.items || data?.results || [];
    if (typeFilter === 'movie') {
      items = items.filter(i => i.type === 'movie' || i.subjectType === 1);
    } else if (typeFilter === 'tv') {
      items = items.filter(i => i.type === 'tv' || i.subjectType !== 1);
    }
    const keyboard = buildSearchResultKeyboard(items);
    if (!keyboard) {
      return safeEdit(chatId, waitMsg?.message_id, `❌ Nothing found for "<b>${h(query)}</b>". Try a different spelling.`);
    }
    const icon = typeFilter === 'movie' ? '🎬' : typeFilter === 'tv' ? '📺' : '🔎';
    await safeEdit(chatId, waitMsg?.message_id, `${icon} <b>Results for "${h(query)}":</b>\n🎬 = Movie  📺 = Series\n\nTap for details &amp; watch links:`, {
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    console.error('search error:', err?.message);
    await safeEdit(chatId, waitMsg?.message_id, '⚠️ Search failed. Please try again later.');
  }
}

async function showMovieDetail(chatId, subjectId) {
  const waitMsg = await safeSend(chatId, '⏳ Fetching movie details...');
  try {
    const detail = await mbApi('/stream/mb-detail', { subjectId });
    if (!detail) {
      return safeEdit(chatId, waitMsg?.message_id, '❌ Movie not found.');
    }
    const title = detail.title || 'Untitled';
    const year = detail.year || '';
    const overview = truncate(detail.description || detail.overview || 'No overview available.', 200);
    const rating = detail.rating ? `⭐ ${detail.rating}/10` : '';
    const genres = detail.genres?.join(', ') || detail.tags?.join(', ') || '';

    let msg = `🎬 <b>${h(title)}</b>`;
    if (year) msg += ` <i>(${year})</i>`;
    msg += '\n\n';
    if (rating) msg += `${rating}\n`;
    if (genres) msg += `🎭 ${h(genres)}\n`;
    msg += `\n📝 <i>${h(overview)}</i>`;

    const buttons = [];
    const appParams = new URLSearchParams({
      subjectId: String(subjectId),
      title,
      type: 'movie',
      ...(detail.coverUrl && { poster: detail.coverUrl }),
    });
    const appUrl = `${MINI_APP_BASE}?${appParams.toString()}`;
    buttons.push([{ text: '▶️  Watch Free — No Ads', url: appUrl }]);

    try { await bot.api.deleteMessage(chatId, waitMsg?.message_id); } catch (_) {}

    const imgUrl = detail.coverUrl || detail.poster || null;
    if (imgUrl) {
      await safePhoto(chatId, imgUrl, msg, { reply_markup: { inline_keyboard: buttons } });
    } else {
      await safeSend(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    }
  } catch (err) {
    console.error('movie detail error:', err?.message);
    await safeEdit(chatId, waitMsg?.message_id, '⚠️ Could not load movie details. Please try again.');
  }
}

async function showTvDetail(chatId, subjectId) {
  const waitMsg = await safeSend(chatId, '⏳ Fetching series details...');
  try {
    const detail = await mbApi('/stream/mb-detail', { subjectId });
    if (!detail) {
      return safeEdit(chatId, waitMsg?.message_id, '❌ Series not found.');
    }
    const title = detail.title || 'Untitled';
    const year = detail.year || '';
    const overview = truncate(detail.description || detail.overview || 'No overview available.', 200);
    const rating = detail.rating ? `⭐ ${detail.rating}/10` : '';
    const genres = detail.genres?.join(', ') || detail.tags?.join(', ') || '';

    let msg = `📺 <b>${h(title)}</b>`;
    if (year) msg += ` <i>(${year})</i>`;
    msg += '\n\n';
    if (rating) msg += `${rating}\n`;
    if (genres) msg += `🎭 ${h(genres)}\n`;
    msg += `\n📝 <i>${h(overview)}</i>`;

    const buttons = [];

    let seasons = [];
    try {
      const seasonData = await mbApi('/stream/mb-seasons', { subjectId });
      seasons = seasonData?.seasons || seasonData?.list || [];
    } catch {}

    if (seasons.length > 0) {
      msg += `\n\n📦 <b>${seasons.length} Season${seasons.length > 1 ? 's' : ''}</b>`;
      const seasonButtons = seasons.slice(0, 8).map(s => ({
        text: `📂 ${s.name || `Season ${s.seasonNumber || s.season}`}`,
        callback_data: `mb_season_${subjectId}_${s.seasonNumber || s.season || s.id}`,
      }));
      for (let i = 0; i < seasonButtons.length; i += 2) {
        buttons.push(seasonButtons.slice(i, i + 2));
      }
    }

    const appParams = new URLSearchParams({
      subjectId: String(subjectId),
      title,
      type: 'tv',
      ...(detail.coverUrl && { poster: detail.coverUrl }),
    });
    const appUrl = `${MINI_APP_BASE}?${appParams.toString()}`;
    buttons.push([{ text: '▶️  Watch S1E1 — No Ads', url: appUrl }]);

    try { await bot.api.deleteMessage(chatId, waitMsg?.message_id); } catch (_) {}

    const imgUrl = detail.coverUrl || detail.poster || null;
    if (imgUrl) {
      await safePhoto(chatId, imgUrl, msg, { reply_markup: { inline_keyboard: buttons } });
    } else {
      await safeSend(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    }
  } catch (err) {
    console.error('tv detail error:', err?.message);
    await safeEdit(chatId, waitMsg?.message_id, '⚠️ Could not load series details. Please try again.');
  }
}

async function showSeasonEpisodes(chatId, subjectId, seasonNumber) {
  const waitMsg = await safeSend(chatId, `📂 Loading Season ${seasonNumber} episodes...`);
  try {
    const seasonData = await mbApi('/stream/mb-seasons', { subjectId });
    const seasons = seasonData?.seasons || seasonData?.list || [];
    const season = seasons.find(s => (s.seasonNumber || s.season) == seasonNumber);
    const episodes = season?.episodes || [];

    if (episodes.length === 0) {
      return safeEdit(chatId, waitMsg?.message_id, '❌ No episodes found for this season.');
    }

    let detail;
    try {
      detail = await mbApi('/stream/mb-detail', { subjectId });
    } catch {}
    const title = detail?.title || 'Series';

    const buttons = episodes.slice(0, 20).map(ep => {
      const epNum = ep.episodeNumber || ep.episode || ep.ep;
      const epName = ep.name || ep.title || `Episode ${epNum}`;
      const label = `E${epNum}: ${epName}`.substring(0, 55);
      const appParams = new URLSearchParams({
        subjectId: String(subjectId),
        title,
        type: 'tv',
        season: String(seasonNumber),
        episode: String(epNum),
        ...(detail?.coverUrl && { poster: detail.coverUrl }),
      });
      const appUrl = `${MINI_APP_BASE}?${appParams.toString()}`;
      return [{ text: `▶️ ${label}`, url: appUrl }];
    });

    buttons.push([{ text: '⬅️ Back to Seasons', callback_data: `mb_tv_${subjectId}` }]);

    await safeEdit(chatId, waitMsg?.message_id,
      `📂 <b>${h(title)} — Season ${seasonNumber}</b>\n${episodes.length} episodes\n\nTap to watch:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    console.error('season episodes error:', err?.message);
    await safeEdit(chatId, waitMsg?.message_id, '⚠️ Could not load episodes. Please try again.');
  }
}

bot.command('start', async (ctx) => {
  const name = h(ctx.from?.first_name || 'there');
  await ctx.reply(
    `🎬 <b>Hey ${name}, welcome to CineBot!</b>\n\n` +
    `Stream any movie or series — <b>free, no ads, no redirects</b> — right inside Telegram.\n\n` +
    `<b>Just type a movie or series name</b> to search instantly.\n\n` +
    `Or use the buttons below to explore 👇`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔥 Trending', callback_data: 'quick_trending' }],
        ],
      },
    }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    `🎬 <b>CineBot — Help</b>\n\n` +
    `/movie &lt;title&gt; — Search movies\n` +
    `/series &lt;title&gt; — Search web series\n` +
    `/search &lt;title&gt; — Search both\n` +
    `/trending — What's trending now\n\n` +
    `<b>Each result shows:</b>\n` +
    `• Watch button to stream free\n` +
    `• Season &amp; episode picker for series\n` +
    `• Rating &amp; overview\n\n` +
    `<i>No downloads — stream directly!</i>`,
    { parse_mode: 'HTML' }
  );
});

bot.command('movie', async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply('Usage: /movie &lt;title&gt;\nExample: /movie Inception', { parse_mode: 'HTML' });
  }
  await handleSearch(ctx.chat.id, query, 'movie');
});

bot.command('series', async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply('Usage: /series &lt;title&gt;\nExample: /series Breaking Bad', { parse_mode: 'HTML' });
  }
  await handleSearch(ctx.chat.id, query, 'tv');
});

bot.command('search', async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply('Usage: /search &lt;title&gt;\nExample: /search Dark Knight', { parse_mode: 'HTML' });
  }
  await handleSearch(ctx.chat.id, query, null);
});

bot.command('trending', (ctx) => handleTrending(ctx.chat.id));

bot.on('callback_query:data', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const data = ctx.callbackQuery.data || '';

  try { await ctx.answerCallbackQuery(); } catch (_) {}

  if (data === 'quick_trending') { handleTrending(chatId); return; }

  if (data.startsWith('mb_movie_')) {
    const subjectId = data.slice('mb_movie_'.length);
    showMovieDetail(chatId, subjectId);
    return;
  }

  if (data.startsWith('mb_tv_')) {
    const subjectId = data.slice('mb_tv_'.length);
    showTvDetail(chatId, subjectId);
    return;
  }

  if (data.startsWith('mb_season_')) {
    const parts = data.slice('mb_season_'.length);
    const lastUnderscore = parts.lastIndexOf('_');
    const subjectId = parts.substring(0, lastUnderscore);
    const seasonNumber = parts.substring(lastUnderscore + 1);
    showSeasonEpisodes(chatId, subjectId, seasonNumber);
    return;
  }
});

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (!text || text.startsWith('/') || text.length < 2) return;
  await handleSearch(ctx.chat.id, text.trim(), null);
});

bot.catch((err) => {
  const msg = err?.message || String(err);
  if (msg.includes('404') || msg.includes('401')) {
    console.error('[Bot] Invalid token or bot not found. Check TELEGRAM_BOT_TOKEN.');
  } else if (msg.includes('409')) {
    console.error('[Bot] Conflict — another instance is running. Stop it first.');
  } else {
    console.error('[Bot Error]', msg);
  }
});

bot.api.setMyCommands([
  { command: 'movie',    description: '🎬 Search a movie' },
  { command: 'series',   description: '📺 Search a web series' },
  { command: 'search',   description: '🔎 Search movies & series' },
  { command: 'trending', description: '🔥 Trending now' },
  { command: 'help',     description: '❓ How to use CineBot' },
]).catch((err) => console.error('[setMyCommands]', err?.message));

run(bot);

console.log('🎬 CineBot is running with MovieBox API!');
